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


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail
