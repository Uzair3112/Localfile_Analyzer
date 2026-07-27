from sqlalchemy import Column, Integer, Text, ForeignKey, Enum
from sqlalchemy.orm import relationship
import enum

from app.models import Base


class TodoType(str, enum.Enum):
    TODO = "TODO"
    FIXME = "FIXME"


class Todo(Base):
    __tablename__ = "todos"

    id = Column(Integer, primary_key=True)
    file_id = Column(Integer, ForeignKey("scanned_files.id", ondelete="CASCADE"), nullable=False, index=True)
    line_number = Column(Integer, nullable=False)
    type = Column(Enum(TodoType), nullable=False)
    message = Column(Text, nullable=True)

    file = relationship("ScannedFile", back_populates="todos")
