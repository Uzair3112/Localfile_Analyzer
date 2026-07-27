from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship

from app.models import Base


class Duplicate(Base):
    __tablename__ = "duplicates"

    id = Column(Integer, primary_key=True)
    scan_id = Column(Integer, ForeignKey("scans.id", ondelete="CASCADE"), nullable=False, index=True)
    hash = Column(String(64), nullable=False)
    file1_id = Column(Integer, ForeignKey("scanned_files.id"), nullable=False)
    file2_id = Column(Integer, ForeignKey("scanned_files.id"), nullable=False)

    scan = relationship("Scan", back_populates="duplicates")
