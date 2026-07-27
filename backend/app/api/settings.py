from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.scan_settings import ScanSettings


class SettingsResponse(BaseModel):
    ignore_hidden: bool = True
    ignore_node_modules: bool = True
    max_file_size: int = 52428800
    custom_ignore_globs: list[str] = []


class SettingsUpdate(BaseModel):
    ignore_hidden: bool | None = None
    ignore_node_modules: bool | None = None
    max_file_size: int | None = None
    custom_ignore_globs: list[str] | None = None


router = APIRouter(prefix="/settings", tags=["settings"])


def _defaults() -> SettingsResponse:
    return SettingsResponse()


async def _get_or_create_settings(db: AsyncSession) -> ScanSettings:
    result = await db.execute(select(ScanSettings).limit(1))
    settings = result.scalar_one_or_none()
    if not settings:
        settings = ScanSettings()
        db.add(settings)
        await db.commit()
        await db.refresh(settings)
    return settings


@router.get("")
async def get_settings(db: AsyncSession = Depends(get_db)):
    settings = await _get_or_create_settings(db)
    return SettingsResponse(
        ignore_hidden=settings.ignore_hidden,
        ignore_node_modules=settings.ignore_node_modules,
        max_file_size=settings.max_file_size,
        custom_ignore_globs=list(settings.custom_ignore_globs or []),
    )


@router.put("")
async def update_settings(
    body: SettingsUpdate,
    db: AsyncSession = Depends(get_db),
):
    settings = await _get_or_create_settings(db)
    if body.ignore_hidden is not None:
        settings.ignore_hidden = body.ignore_hidden
    if body.ignore_node_modules is not None:
        settings.ignore_node_modules = body.ignore_node_modules
    if body.max_file_size is not None:
        settings.max_file_size = body.max_file_size
    if body.custom_ignore_globs is not None:
        settings.custom_ignore_globs = body.custom_ignore_globs
    await db.commit()
    await db.refresh(settings)
    return SettingsResponse(
        ignore_hidden=settings.ignore_hidden,
        ignore_node_modules=settings.ignore_node_modules,
        max_file_size=settings.max_file_size,
        custom_ignore_globs=list(settings.custom_ignore_globs or []),
    )
