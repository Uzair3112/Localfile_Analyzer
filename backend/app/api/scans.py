import asyncio
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, async_session
from app.models.scan import Scan, ScanStatus
from app.models.scan_settings import ScanSettings
from app.schemas.scan import (
    StartScanRequest,
    ScanResponse,
    ScanListResponse,
)
from app.scanner.runner import run_scan

router = APIRouter(prefix="/scans", tags=["scans"])


def _scan_to_response(scan: Scan) -> ScanResponse:
    return ScanResponse(
        scan_id=scan.id,
        status=scan.status,
        folder_path=scan.folder_path,
        started_at=scan.started_at,
        completed_at=scan.completed_at,
        total_files=scan.total_files or 0,
        total_size=scan.total_size or 0,
        total_lines=scan.total_lines or 0,
        error_message=scan.error_message,
    )


def _error_response(code: str, message: str, status: int = 422):
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message}},
    )


@router.post("", status_code=202)
async def create_scan(
    body: StartScanRequest,
    db: AsyncSession = Depends(get_db),
):
    folder = Path(body.folder_path)
    if not folder.is_absolute():
        return _error_response("INVALID_PATH", "Path must be absolute")
    if not folder.exists():
        return _error_response("INVALID_PATH", "Path does not exist")
    if not folder.is_dir():
        return _error_response("INVALID_PATH", "Path is not a directory")

    result = await db.execute(select(ScanSettings).limit(1))
    global_settings = result.scalar_one_or_none()
    settings_snapshot = {}
    if global_settings:
        settings_snapshot = {
            "ignore_hidden": global_settings.ignore_hidden,
            "ignore_node_modules": global_settings.ignore_node_modules,
            "max_file_size": global_settings.max_file_size,
            "custom_ignore_globs": list(global_settings.custom_ignore_globs or []),
        }
    else:
        settings_snapshot = {
            "ignore_hidden": True,
            "ignore_node_modules": True,
            "max_file_size": 52428800,
            "custom_ignore_globs": [],
        }

    if body.settings_override:
        settings_snapshot.update(body.settings_override)

    scan = Scan(
        folder_path=str(folder),
        status=ScanStatus.pending,
        settings_snapshot=settings_snapshot,
    )
    db.add(scan)
    await db.commit()
    await db.refresh(scan)

    asyncio.create_task(run_scan(scan_id=scan.id, session_factory=async_session))

    return _scan_to_response(scan)


@router.get("/{scan_id}")
async def get_scan(
    scan_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Scan).where(Scan.id == scan_id))
    scan = result.scalar_one_or_none()
    if not scan:
        return _error_response("SCAN_NOT_FOUND", f"No scan exists with id {scan_id}", status=404)
    return _scan_to_response(scan)


@router.get("")
async def list_scans(
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
    count_result = await db.execute(select(func.count(Scan.id)))
    total = count_result.scalar() or 0

    result = await db.execute(
        select(Scan)
        .order_by(Scan.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    scans = result.scalars().all()

    return ScanListResponse(
        scans=[_scan_to_response(s) for s in scans],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.delete("/{scan_id}")
async def delete_scan(
    scan_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Scan).where(Scan.id == scan_id))
    scan = result.scalar_one_or_none()
    if not scan:
        return _error_response("SCAN_NOT_FOUND", f"No scan exists with id {scan_id}", status=404)

    await db.delete(scan)
    await db.commit()
    return {"status": "deleted", "scan_id": scan_id}
