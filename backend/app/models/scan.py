from sqlalchemy import Column, Integer, BigInteger, Text, DateTime, Enum, JSON
from sqlalchemy.orm import relationship
import enum

from app.models import Base


class ScanStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class Scan(Base):
    __tablename__ = "scans"

    id = Column(Integer, primary_key=True)
    folder_path = Column(Text, nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(Enum(ScanStatus), nullable=False, default=ScanStatus.pending)
    total_files = Column(Integer, default=0)
    total_size = Column(BigInteger, default=0)
    total_lines = Column(BigInteger, default=0)
    settings_snapshot = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)

    files = relationship("ScannedFile", back_populates="scan", cascade="all, delete-orphan")
    duplicates = relationship("Duplicate", back_populates="scan", cascade="all, delete-orphan")
