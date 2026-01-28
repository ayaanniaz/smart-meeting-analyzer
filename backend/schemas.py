from pydantic import BaseModel
from typing import Optional, List
from uuid import UUID
from datetime import datetime
from enum import Enum

class MeetingStatus(str, Enum):
    UPLOADED = "UPLOADED"
    TRANSCRIBING = "TRANSCRIBING"
    TRANSCRIBED = "TRANSCRIBED"
    EMBEDDING = "EMBEDDING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

class MeetingBase(BaseModel):
    video_url: str

class MeetingCreate(MeetingBase):
    pass

class Meeting(MeetingBase):
    id: UUID
    status: MeetingStatus
    error_log: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

class ChatRequest(BaseModel):
    meeting_id: UUID
    query: str

class Citation(BaseModel):
    text: str
    start_time: float
    confidence_score: float

class ChatResponse(BaseModel):
    ai_answer: str
    citations: List[Citation]

class MeetingSummary(BaseModel):
    id: UUID
    status: MeetingStatus
    created_at: datetime
    filename: Optional[str] = None

    class Config:
        from_attributes = True
