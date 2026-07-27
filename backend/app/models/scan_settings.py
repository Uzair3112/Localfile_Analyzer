from sqlalchemy import Column, Integer, Boolean, BigInteger, ARRAY, Text

from app.models import Base


class ScanSettings(Base):
    __tablename__ = "scan_settings"

    id = Column(Integer, primary_key=True)
    ignore_hidden = Column(Boolean, nullable=False, default=True)
    ignore_node_modules = Column(Boolean, nullable=False, default=True)
    max_file_size = Column(BigInteger, nullable=False, default=52428800)
    custom_ignore_globs = Column(ARRAY(Text), default=[])
