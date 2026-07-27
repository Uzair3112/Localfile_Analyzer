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
    ScannedFileResponse,
    ScannedFileListResponse,
    DuplicateFileInfo,
    DuplicateGroup,
    DuplicateListResponse,
)
from app.scanner.runner import run_scan
from app.models.scanned_file import ScannedFile
from app.models.duplicate import Duplicate

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


@router.get("/{scan_id}/files")
async def get_scan_files(
    scan_id: int,
    page: int = 1,
    page_size: int = 50,
    extension: str | None = None,
    search: str | None = None,
    sort: str = "filename",
    order: str = "asc",
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Scan).where(Scan.id == scan_id))
    scan = result.scalar_one_or_none()
    if not scan:
        return _error_response("SCAN_NOT_FOUND", f"No scan exists with id {scan_id}", status=404)

    query = select(ScannedFile).where(ScannedFile.scan_id == scan_id)

    if extension:
        query = query.where(ScannedFile.extension == extension)
    if search:
        query = query.where(
            ScannedFile.filename.ilike(f"%{search}%")
            | ScannedFile.full_path.ilike(f"%{search}%")
        )

    count_query = select(func.count()).select_from(query.subquery())
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0

    sort_col = getattr(ScannedFile, sort, ScannedFile.filename)
    if order == "desc":
        sort_col = sort_col.desc()
    else:
        sort_col = sort_col.asc()
    query = query.order_by(sort_col).offset((page - 1) * page_size).limit(page_size)

    rows = (await db.execute(query)).scalars().all()

    return ScannedFileListResponse(
        files=[ScannedFileResponse.model_validate(f) for f in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{scan_id}/duplicates")
async def get_scan_duplicates(
    scan_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Scan).where(Scan.id == scan_id))
    scan = result.scalar_one_or_none()
    if not scan:
        return _error_response("SCAN_NOT_FOUND", f"No scan exists with id {scan_id}", status=404)

    if scan.status != ScanStatus.completed:
        return _error_response("SCAN_NOT_COMPLETED", "Duplicates are available only after scan completes")

    dup_file_ids_subq = (
        select(Duplicate.file1_id)
        .where(Duplicate.scan_id == scan_id)
        .union(
            select(Duplicate.file2_id).where(Duplicate.scan_id == scan_id)
        )
        .subquery()
    )

    result = await db.execute(
        select(ScannedFile)
        .where(ScannedFile.id.in_(select(dup_file_ids_subq.c)))
        .order_by(ScannedFile.sha256, ScannedFile.full_path)
    )
    dup_files = result.scalars().all()

    groups_map: dict[str, list[ScannedFile]] = {}
    for sf in dup_files:
        if sf.sha256 not in groups_map:
            groups_map[sf.sha256] = []
        groups_map[sf.sha256].append(sf)

    groups_list = []
    total_wasted = 0
    for file_hash, files in groups_map.items():
        if len(files) < 2:
            continue
        file_infos = [
            DuplicateFileInfo(
                id=f.id,
                filename=f.filename,
                full_path=f.full_path,
                extension=f.extension,
                size=f.size,
            )
            for f in files
        ]
        wasted = (len(files) - 1) * files[0].size
        total_wasted += wasted
        groups_list.append(DuplicateGroup(
            hash=file_hash,
            files=file_infos,
            total_savings=wasted,
        ))

    total_dup_files = sum(len(g.files) for g in groups_list)

    return DuplicateListResponse(
        groups=groups_list,
        total_groups=len(groups_list),
        total_duplicates=total_dup_files,
        total_wasted_bytes=total_wasted,
    )
