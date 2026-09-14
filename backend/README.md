# Hover AI Backend

FastAPI backend for the Hover AI Electron app — African-language voice-guided UI assistant.
Built for the Intron Innovation Voice AI Hackathon.

## Stack

- **Python 3.11** — managed by `uv` (isolated `.venv/`, nothing installed globally)
- **FastAPI** + **uvicorn** — async web framework
- **asyncpg** — async PostgreSQL driver (no ORM)
- **Render free PostgreSQL** — hosted database
- **Intron Sahara** — primary African-language STT
- **Groq** — Whisper transcription (benchmark #2) + Llama-4-Scout vision LLM
- **HuggingFace Inference API** — AfriSpeech Whisper (benchmark #3)

## Prerequisites

### 1. ffmpeg (required for audio conversion)

Sahara accepts WebM directly. `ffmpeg` is only needed to convert WebM → WAV for
Groq Whisper and HuggingFace AfriSpeech.

**Ubuntu / Debian / Render:**
```bash
sudo apt-get install -y ffmpeg
```

**macOS:**
```bash
brew install ffmpeg
```

### 2. uv

Already installed at `/home/knox/.local/bin/uv`. Everything else lives in `.venv/`.

## Setup

```bash
# 1. Clone and enter the backend directory
cd backend/

# 2. Install all dependencies into .venv (first time or after lockfile changes)
uv sync

# 3. Copy the env template and fill in your keys
cp .env.example .env
# Edit .env — add your INTRON_API_KEY, GROQ_API_KEY, HF_API_KEY, DATABASE_URL

# 4. Apply the database migration (run once against your Render Postgres instance)
# Connect to your Render DB using the DATABASE_URL and run:
psql $DATABASE_URL -f migrations/001_initial.sql

# 5. Start the development server
uv run uvicorn app.main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`.
Interactive docs: `http://localhost:8000/docs`
Health check: `http://localhost:8000/api/v1/health`

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

| Variable | Description | Where to get it |
|---|---|---|
| `DATABASE_URL` | Render PostgreSQL connection string | Render dashboard → External Database URL |
| `JWT_SECRET` | Random 32+ char secret | `openssl rand -hex 32` |
| `INTRON_API_KEY` | Your hackathon access token | Registration email from Intron Innovation |
| `GROQ_API_KEY` | Groq API key | https://console.groq.com |
| `HF_API_KEY` | HuggingFace access token | https://huggingface.co/settings/tokens |

## Project Structure

```
backend/
├── app/
│   ├── main.py          # FastAPI app, CORS, lifespan, router mounts
│   ├── config.py        # All env vars — single source of truth
│   ├── db.py            # asyncpg pool + get_db() dependency
│   ├── auth.py          # JWT + password utilities
│   ├── routers/
│   │   ├── auth.py      # POST /auth/signup, POST /auth/signin
│   │   ├── users.py     # GET/PATCH /users/me, /users/me/settings
│   │   └── query.py     # POST /query (main feature pipeline)
│   ├── services/
│   │   ├── audio.py     # WebM → WAV conversion
│   │   ├── stt.py       # Sahara + Groq Whisper + HF AfriSpeech (concurrent)
│   │   └── vision.py    # Groq Llama-4-Scout beacon step extraction
│   └── schemas/
│       ├── auth.py      # Pydantic models for auth
│       ├── users.py     # Pydantic models for user/settings
│       ├── stt.py       # STTResult
│       ├── vision.py    # BeaconStep, VisionResult
│       └── query.py     # QueryResponse, BenchmarkResult
├── migrations/
│   └── 001_initial.sql  # Run once to create all tables
├── pyproject.toml
├── uv.lock
└── .env.example
```

## Common Commands

```bash
uv sync                                          # install / update deps from lockfile
uv add <package>                                 # add a new dependency
uv run uvicorn app.main:app --reload             # dev server with hot reload
uv run uvicorn app.main:app --host 0.0.0.0       # bind to all interfaces (Render)
uv run python -m pytest                          # run tests (when added)
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/health` | Liveness check |
| POST | `/api/v1/auth/signup` | Create account, returns JWT |
| POST | `/api/v1/auth/signin` | Sign in, returns JWT |
| GET | `/api/v1/users/me` | Get current user profile |
| GET | `/api/v1/users/me/settings` | Get user settings |
| PATCH | `/api/v1/users/me/settings` | Update user settings |
| POST | `/api/v1/query` | Full pipeline: audio → STT → vision → beacon steps |
