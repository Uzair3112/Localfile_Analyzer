from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.models.scan import ScanStatus


class StartScanRequest(BaseModel):
    folder_path: str
    settings_override: Optional[dict[str, Any]] = None


class ScanResponse(BaseModel):
    scan_id: int
    status: ScanStatus
    folder_path: str
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    total_files: int = 0
    total_size: int = 0
    total_lines: int = 0
    error_message: Optional[str] = None


class ScanListResponse(BaseModel):
    scans: list[ScanResponse]
    total: int
    page: int
    page_size: int


class ScannedFileResponse(BaseModel):
    id: int
    scan_id: int
    filename: str
    full_path: str
    extension: Optional[str] = None
    size: int
    line_count: Optional[int] = None
    sha256: Optional[str] = None
    created_at: Optional[datetime] = None
    modified_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ScannedFileListResponse(BaseModel):
    files: list[ScannedFileResponse]
    total: int
    page: int
    page_size: int


class DuplicateFileInfo(BaseModel):
    id: int
    filename: str
    full_path: str
    extension: Optional[str] = None
    size: int

    model_config = {"from_attributes": True}


class DuplicateGroup(BaseModel):
    hash: str
    files: list[DuplicateFileInfo]
    total_savings: int


class DuplicateListResponse(BaseModel):
    groups: list[DuplicateGroup]
    total_groups: int
    total_duplicates: int
    total_wasted_bytes: int


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail


class ExtensionBreakdownItem(BaseModel):
    extension: str
    count: int
    total_size: int
    percentage: float

    model_config = {"from_attributes": True}


class ExtensionBreakdownResponse(BaseModel):
    extensions: list[ExtensionBreakdownItem]
    total_extensions: int
    total_files: int
    files_without_extension: int
