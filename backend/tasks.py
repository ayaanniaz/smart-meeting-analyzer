from worker import celery_app
from database import SessionLocal
import models
import os
import whisper
import boto3
from llm_service import generate_embedding
import shutil
import logging
import uuid
import time
from sqlalchemy import text # For vector operations if needed

# Setup Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# S3 Client
s3_client = boto3.client(
    's3',
    endpoint_url=os.getenv("S3_ENDPOINT_URL", "http://localhost:9000"),
    aws_access_key_id=os.getenv("S3_ACCESS_KEY", "minioadmin"),
    aws_secret_access_key=os.getenv("S3_SECRET_KEY", "minioadmin")
)
S3_BUCKET = "videos"

@celery_app.task(bind=True, name="tasks.process_video")
def process_video(self, meeting_id_str):
    db = SessionLocal()
    meeting = None
    local_video_path = None
    
    try:
        meeting_id = uuid.UUID(meeting_id_str)
        meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
        
        if not meeting:
            logger.error(f"Meeting {meeting_id_str} not found in DB")
            return "Meeting Not Found"

        logger.info(f"Processing Meeting {meeting_id} - Current Status: {meeting.status}")

        # ------------------------------------------------------------------
        # PHASE 1: TRANSCRIPTION
        # ------------------------------------------------------------------
        if meeting.status in [models.MeetingStatus.UPLOADED, models.MeetingStatus.FAILED]:
            # Reset error log
            meeting.status = models.MeetingStatus.TRANSCRIBING
            meeting.error_log = None
            db.commit()

            # 1.1 Download Video
            # Expected url format: s3://videos/{uuid}/{filename}
            # Or just {uuid}/{filename} if we are simple
            # We will try to parse the key.
            try:
                # Mocking logic: If the file is local (from upload endpoint), use it.
                # If it's S3, download it.
                # For this MVP, we assume the file was saved to a shared temp dir or we download from MinIO
                
                # Let's assume the key is passed in video_url or derived
                # video_url = "s3://videos/..."
                if "s3://" in meeting.video_url:
                    key = meeting.video_url.replace(f"s3://{S3_BUCKET}/", "")
                else:
                    key = meeting.video_url # simplify
                
                local_video_path = f"temp_{meeting_id}.mp4"
                
                logger.info(f"Downloading {key} to {local_video_path}...")
                s3_client.download_file(S3_BUCKET, key, local_video_path)
                logger.info("Download Complete.")

            except Exception as e:
                # If download fails, maybe it's just a local file test?
                logger.warning(f"S3 Download failed ({e}). Checking local file fallback.")
                if not os.path.exists(local_video_path):
                     # Fail strictly if we can't get the video
                     raise Exception(f"Video file could not be retrieved: {e}")

            # 1.2 Check Dependencies
            if shutil.which("ffmpeg") is None:
                raise Exception("FFMPEG is missing from the system path. Cannot transcribe.")

            # 1.3 Run Whisper
            logger.info("Loading Whisper Model...")
            model = whisper.load_model("base", device="cpu") # Force CPU for safety
            
            logger.info("Transcribing...")
            # fp16=False is needed for CPU
            result = model.transcribe(local_video_path, fp16=False)
            
            # 1.4 Save Chunks
            # Clear old chunks first (Idempotency)
            db.query(models.TranscriptChunk).filter(models.TranscriptChunk.meeting_id == meeting_id).delete()
            
            logger.info(f"Saving {len(result['segments'])} segments...")
            for segment in result['segments']:
                chunk = models.TranscriptChunk(
                    meeting_id=meeting.id,
                    start_time=segment['start'],
                    end_time=segment['end'],
                    text=segment['text']
                )
                db.add(chunk)
            
            meeting.status = models.MeetingStatus.TRANSCRIBED
            db.commit()
            logger.info("Phase 1 (Transcription) Complete.")

        # ------------------------------------------------------------------
        # PHASE 2: EMBEDDING
        # ------------------------------------------------------------------
        if meeting.status == models.MeetingStatus.TRANSCRIBED:
            meeting.status = models.MeetingStatus.EMBEDDING
            db.commit()
            
            logger.info("Fetching chunks for embedding...")
            chunks = db.query(models.TranscriptChunk).filter(models.TranscriptChunk.meeting_id == meeting.id).all()
            
            for i, chunk in enumerate(chunks):
                # Rate limiting might be needed for Gemini API
                if i % 10 == 0:
                    time.sleep(1) # Basic throttling
                
                vector = generate_embedding(chunk.text)
                chunk.embedding = vector
            
            meeting.status = models.MeetingStatus.COMPLETED
            db.commit()
            logger.info("Phase 2 (Embedding) Complete. Processing Finished.")

    except Exception as e:
        logger.error(f"Processing Failed: {e}")
        if meeting:
            meeting.status = models.MeetingStatus.FAILED
            meeting.error_log = str(e)
            db.commit()
    finally:
        db.close()
        # Cleanup temp file
        if local_video_path and os.path.exists(local_video_path):
            os.remove(local_video_path)
