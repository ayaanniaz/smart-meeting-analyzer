# Smart Meeting Analyzer

An AI-powered meeting analysis tool that transcribes videos, generates embeddings, and enables intelligent Q&A using RAG (Retrieval-Augmented Generation).

## Features

-  **Video Upload** - Drag & drop video files for processing
-  **Automatic Transcription** - Uses OpenAI Whisper for accurate speech-to-text
-  **Semantic Search** - Vector embeddings enable intelligent context retrieval
-  **AI Chat** - Ask questions about your meetings with citations
-  **Timestamp Navigation** - Click timestamps to jump to specific moments
-  **Meeting History** - Access previously processed meetings

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Next.js 16, React 19, Tailwind CSS |
| Backend | FastAPI, SQLAlchemy, Celery |
| Database | PostgreSQL + pgvector |
| Storage | MinIO (S3-compatible) |
| Cache | Redis |
| LLM | Groq API (Llama 3.3 70B) |
| Embeddings | Sentence-Transformers (all-MiniLM-L6-v2) |
| Transcription | OpenAI Whisper |

## Prerequisites

- Python 3.10+
- Node.js 18+
- Docker & Docker Compose
- Groq API Key ([Get one here](https://console.groq.com/))

## Quick Start

### 1. Clone the repository
```bash
git clone https://github.com/ayaanniaz/smart-meeting-analyzer.git
cd smart-meeting-analyzer
```

### 2. Start infrastructure services
```bash
docker-compose up -d
```

### 3. Configure environment variables
```bash
cp .env.example .env
# Edit .env and add your GROQ_API_KEY
```

### 4. Start the backend
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload
```

### 5. Start the Celery worker (new terminal)
```bash
cd backend
python -m celery -A worker.celery_app worker --loglevel=info -P solo
```

### 6. Start the frontend (new terminal)
```bash
cd frontend
npm install
npm run dev
```

### 7. Open the app
Navigate to [http://localhost:3000](http://localhost:3000)

## Project Structure

```
smart-meeting-analyzer/
├── backend/
│   ├── main.py          # FastAPI endpoints
│   ├── models.py        # Database models
│   ├── schemas.py       # Pydantic schemas
│   ├── tasks.py         # Celery tasks
│   ├── llm_service.py   # Groq & embeddings
│   └── requirements.txt
├── frontend/
│   ├── app/
│   │   └── page.tsx     # Main UI
│   ├── components/
│   │   └── VideoPlayer.tsx
│   └── package.json
├── docker-compose.yml
└── .env.example
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/upload` | Upload a video for processing |
| GET | `/status/{id}` | Get processing status |
| POST | `/chat` | Ask questions about a meeting |
| GET | `/meetings` | List all completed meetings |
| GET | `/meetings/{id}/video` | Get video stream URL |
| DELETE | `/meetings/{id}` | Delete a meeting |

## License

MIT
