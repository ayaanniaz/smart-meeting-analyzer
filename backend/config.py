import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env'))


# Database
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost:5432/meeting_db")

# Redis
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# MinIO / S3
S3_ENDPOINT_URL = os.getenv("S3_ENDPOINT_URL", "http://localhost:9000")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "minioadmin")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "minioadmin")
S3_BUCKET_NAME = os.getenv("S3_BUCKET_NAME", "mybucket") # using default from createbuckets if needed, but we'll use 'videos'

# GROQ
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
print(f"DEBUG: Loaded GROQ_API_KEY: {'[SET]' if GROQ_API_KEY else '[NOT SET]'}")
