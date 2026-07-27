from sqlalchemy import Column, Integer, BigInteger, Text, DateTime, ForeignKey, String
from sqlalchemy.orm import relationship

from app.models import Base


class ScannedFile(Base):
    __tablename__ = "scanned_files"

    id = Column(Integer, primary_key=True)
    scan_id = Column(Integer, ForeignKey("scans.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(Text, nullable=False)
    full_path = Column(Text, nullable=False)
    extension = Column(Text, nullable=True, index=True)
    size = Column(BigInteger, nullable=False)
    line_count = Column(Integer, nullable=True)
    sha256 = Column(String(64), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    modified_at = Column(DateTime(timezone=True), nullable=True)

    scan = relationship("Scan", back_populates="files")
    todos = relationship("Todo", back_populates="file", cascade="all, delete-orphan")
