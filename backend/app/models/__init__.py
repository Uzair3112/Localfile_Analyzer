from sqlalchemy.orm import declarative_base

Base = declarative_base()

from app.models.scan import Scan
from app.models.scanned_file import ScannedFile
from app.models.duplicate import Duplicate
from app.models.scan_settings import ScanSettings

__all__ = ["Base", "Scan", "ScannedFile", "Duplicate", "ScanSettings"]
