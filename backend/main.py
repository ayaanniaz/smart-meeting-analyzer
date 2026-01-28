from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import text
import models, schemas, database
import shutil
import os
import uuid

app = FastAPI(title="Smart Meeting Analyzer")

from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allow all origins for dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Dependency
def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.on_event("startup")
def startup_event():
    # Ensure vector extension exists
    # We use a separate session for this startup check
    db = database.SessionLocal()
    try:
        # Check if extension exists, if not create it
        db.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        db.commit()
    except Exception as e:
        print(f"Warning: Could not create vector extension (might already exist or permission error): {e}")
        db.rollback()
    finally:
        db.close()
    
    # Ensure S3 Bucket Exists
    try:
        s3_client.head_bucket(Bucket=S3_BUCKET_NAME)
    except Exception:
        try:
            print(f"Bucket {S3_BUCKET_NAME} not found. Creating...")
            s3_client.create_bucket(Bucket=S3_BUCKET_NAME)
        except Exception as e:
            print(f"Failed to create bucket: {e}")

    # Create tables
    models.Base.metadata.create_all(bind=database.engine)

import boto3
from config import S3_ENDPOINT_URL, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET_NAME

s3_client = boto3.client(
    's3',
    endpoint_url=S3_ENDPOINT_URL,
    aws_access_key_id=S3_ACCESS_KEY,
    aws_secret_access_key=S3_SECRET_KEY
)

@app.post("/upload", response_model=schemas.Meeting)
async def upload_video(file: UploadFile = File(...), db: Session = Depends(get_db)):
    # Generate ID
    meeting_id = uuid.uuid4()
    
    # Upload to MinIO/S3
    try:
        # Reset file pointer just in case
        await file.seek(0)
        # upload_fileobj is synchronous, so it might block the event loop slightly.
        # But for this use case, it is acceptable or we can wrap it in run_in_executor if needed.
        # For simplicity in this fix, we'll keep it as is or use the async friendly way if boto3 supports it (it doesn't natively).
        # Better pattern for asyncio is to use file.read() and put_object if small, or run_in_executor.
        # However, since we are using 'await file.seek', we are in async land.
        # Let's just use the s3_client synchronously here, it will block one thread but it works.
        s3_client.upload_fileobj(
            file.file,
            S3_BUCKET_NAME,
            f"{meeting_id}/{file.filename}"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"S3 Upload Failed: {str(e)}")
    
    video_path = f"s3://{S3_BUCKET_NAME}/{meeting_id}/{file.filename}"
    
    db_meeting = models.Meeting(id=meeting_id, video_url=video_path, status=models.MeetingStatus.UPLOADED)
    db.add(db_meeting)
    db.commit()
    db.refresh(db_meeting)
    
    # Trigger Celery Task
    # Import inside function to avoid circular imports if any
    from tasks import process_video
    process_video.delay(str(meeting_id))
    
    return db_meeting

@app.get("/status/{meeting_id}", response_model=schemas.Meeting)
def get_status(meeting_id: uuid.UUID, db: Session = Depends(get_db)):
    meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting

@app.post("/chat", response_model=schemas.ChatResponse)
def chat(request: schemas.ChatRequest, db: Session = Depends(get_db)):
    from llm_service import generate_embedding, generate_answer
    
    # 1. Generate Query Embedding
    try:
        query_vec = generate_embedding(request.query)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating embedding: {e}")

    # 2. Vector Search (Cosine Similarity)
    # pgvector '<=>' operator is cosine distance. 1 - distance = similarity
    vec_str = str(query_vec)
    sql = text("""
        SELECT text, start_time, 1 - (embedding <=> :query_embedding) as score
        FROM transcript_chunks
        WHERE meeting_id = :meeting_id
        ORDER BY score DESC LIMIT 5
    """)
    
    # Execute raw SQL
    results = db.execute(sql, {"query_embedding": vec_str, "meeting_id": str(request.meeting_id)}).fetchall()
    
    if not results:
        return {
            "ai_answer": "I couldn't find any relevant context in the meeting to answer your question.",
            "citations": []
        }

    # 3. Form Context
    context_text = ""
    citations = []
    for row in results:
        # row: (text, start_time, score)
        text_content = row[0]
        start_time = row[1]
        score = row[2]
        
        context_text += f"- [{start_time:.2f}s]: {text_content}\n"
        citations.append(schemas.Citation(
            text=text_content,
            start_time=start_time,
            confidence_score=float(score)
        ))
    
    # 4. Generate AI Answer
    ai_answer = generate_answer(request.query, context_text)
    
    return {
        "ai_answer": ai_answer,
        "citations": citations
    }

@app.get("/meetings", response_model=list[schemas.MeetingSummary])
def list_meetings(db: Session = Depends(get_db)):
    """List all completed meetings that can be retrieved."""
    meetings = db.query(models.Meeting).filter(
        models.Meeting.status == models.MeetingStatus.COMPLETED
    ).order_by(models.Meeting.created_at.desc()).all()
    
    result = []
    for m in meetings:
        # Extract filename from video_url (s3://bucket/id/filename)
        filename = None
        if m.video_url:
            parts = m.video_url.split('/')
            if len(parts) > 0:
                filename = parts[-1]
        
        result.append(schemas.MeetingSummary(
            id=m.id,
            status=m.status,
            created_at=m.created_at,
            filename=filename
        ))
    
    return result

@app.get("/meetings/{meeting_id}/video")
def get_video_url(meeting_id: uuid.UUID, db: Session = Depends(get_db)):
    """Get a presigned URL to stream the video from MinIO/S3."""
    meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    
    # Parse the s3:// URL to get bucket and key
    # Format: s3://bucket/id/filename
    video_url = meeting.video_url
    if not video_url or not video_url.startswith("s3://"):
        raise HTTPException(status_code=400, detail="Invalid video URL format")
    
    # Remove s3:// prefix
    path = video_url[5:]  # "bucket/id/filename"
    parts = path.split("/", 1)
    if len(parts) < 2:
        raise HTTPException(status_code=400, detail="Invalid video path")
    
    bucket = parts[0]
    key = parts[1]
    
    try:
        # Generate presigned URL (valid for 1 hour)
        presigned_url = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': bucket, 'Key': key},
            ExpiresIn=3600
        )
        return {"url": presigned_url, "meeting_id": str(meeting_id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate video URL: {str(e)}")

@app.delete("/meetings/{meeting_id}")
def delete_meeting(meeting_id: uuid.UUID, db: Session = Depends(get_db)):
    """Delete a meeting and all associated data (transcript chunks, video file)."""
    meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    
    # 1. Delete transcript chunks from database
    db.query(models.TranscriptChunk).filter(models.TranscriptChunk.meeting_id == meeting_id).delete()
    
    # 2. Delete video from MinIO/S3
    video_url = meeting.video_url
    print(f"Attempting to delete video: {video_url}")
    
    if video_url and video_url.startswith("s3://"):
        try:
            path = video_url[5:]  # Remove "s3://"
            parts = path.split("/", 1)
            if len(parts) >= 2:
                bucket = parts[0]
                key = parts[1]
                
                print(f"Deleting from bucket: {bucket}, key: {key}")
                
                # Delete the specific file
                response = s3_client.delete_object(Bucket=bucket, Key=key)
                print(f"Delete response: {response}")
                
                # Also try to delete the folder (prefix) in case there are other files
                # List all objects with the meeting_id prefix
                folder_prefix = f"{meeting_id}/"
                try:
                    objects = s3_client.list_objects_v2(Bucket=bucket, Prefix=folder_prefix)
                    if 'Contents' in objects:
                        for obj in objects['Contents']:
                            print(f"Deleting additional object: {obj['Key']}")
                            s3_client.delete_object(Bucket=bucket, Key=obj['Key'])
                except Exception as list_err:
                    print(f"Warning: Could not list/delete folder contents: {list_err}")
                    
        except Exception as e:
            print(f"ERROR: Failed to delete S3 object: {e}")
            import traceback
            traceback.print_exc()
            # Continue even if S3 deletion fails
    
    # 3. Delete meeting record from database
    db.delete(meeting)
    db.commit()
    
    print(f"Meeting {meeting_id} deleted successfully")
    return {"message": "Meeting deleted successfully", "meeting_id": str(meeting_id)}
