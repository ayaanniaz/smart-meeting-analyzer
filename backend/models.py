import uuid
from sqlalchemy import Column, Integer, String, Float, ForeignKey, Enum, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from pgvector.sqlalchemy import Vector
from database import Base
import datetime

import enum

class MeetingStatus(str, enum.Enum):
    UPLOADED = "UPLOADED"
    TRANSCRIBING = "TRANSCRIBING"
    TRANSCRIBED = "TRANSCRIBED"
    EMBEDDING = "EMBEDDING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

class Meeting(Base):
    __tablename__ = 'meetings'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    video_url = Column(String, nullable=False)
    status = Column(Enum(MeetingStatus, name="meeting_status_enum"), default=MeetingStatus.UPLOADED)
    error_log = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    chunks = relationship("TranscriptChunk", back_populates="meeting")

class TranscriptChunk(Base):
    __tablename__ = 'transcript_chunks'

    id = Column(Integer, primary_key=True, index=True)
    meeting_id = Column(UUID(as_uuid=True), ForeignKey('meetings.id'))
    start_time = Column(Float, nullable=False)
    end_time = Column(Float, nullable=False)
    text = Column(String, nullable=False)
    
    # Using 384 dimensions for all-MiniLM-L6-v2
    embedding = Column(Vector(384))

    meeting = relationship("Meeting", back_populates="chunks")
