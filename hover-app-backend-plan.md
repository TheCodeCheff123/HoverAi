# Hover AI — FastAPI Backend Plan

## Top-Level Overview

Build a FastAPI backend that serves three concerns:

1. **Auth** — email + password, bcrypt hashing, stateless JWT. Render PostgreSQL via `asyncpg`. No Supabase, no ORM.
2. **Query pipeline** — receives WebM audio + base64 screenshot from Electron → converts audio → runs three STT models concurrently → passes Sahara transcript + screenshot to Groq vision LLM → returns structured beacon steps.
3. **Benchmark logging** — every query logs all three STT transcripts + latencies to `query_logs`. This is the hackathon deliverable (30% of judging weight).

**Hackathon context**: Intron Innovation Voice AI Hackathon. Submission deadline 15 September 2026.
The highest-weighted criterion (30%) is code-switching benchmark quality — rigorous comparison across
3+ STT models. Every `POST /query` call both powers the app and generates benchmark data.

---

## Confirmed External API Contracts

### Intron Sahara STT (async, two-step)

```
# Step 1 — upload (WebM accepted natively, no conversion needed)
POST https://infer.voice.intron.io/file/v1/upload
Authorization: Bearer <INTRON_API_KEY>
Content-Type: multipart/form-data
Fields:
  audio_file_name        string   any identifier string
  audio_file_blob        file     audio bytes (WAV/WebM/MP3/OGG/FLAC supported)
  use_language_asr_input string   language code: pcm | yo | ha | ig | en | fr | sw
Response: { "data": { "file_id": "..." }, "status": "Ok" }

# Step 2 — poll until transcribed
GET https://infer.voice.intron.io/file/v1/status/{file_id}
Authorization: Bearer <INTRON_API_KEY>
Poll until status == "FILE_TRANSCRIBED" or "FILE_PROCESSING_FAILED"
Rate limit: 100 req/min on status endpoint
# TODO: confirm exact transcript field name in FILE_TRANSCRIBED response
#       (likely data.transcription or data.transcript)
```

### Groq Whisper (OpenAI-compatible, free tier)

```
POST https://api.groq.com/openai/v1/audio/transcriptions
Authorization: Bearer <GROQ_API_KEY>
Model: whisper-large-v3-turbo
Input: WAV file (converted from WebM)
```

### HuggingFace AfriSpeech Whisper (free Inference API, benchmark #3)

```
POST https://api-inference.huggingface.co/models/intronhealth/afrispeech-whisper-medium-all
Authorization: Bearer <HF_API_KEY>
Content-Type: application/octet-stream
Body: raw WAV bytes
Response: {"text": "..."}
```
Model: `intronhealth/afrispeech-whisper-medium-all` — Whisper medium fine-tuned on AfriSpeech.
Chosen because it is domain-adapted for African speech, creating a meaningful three-way comparison:
commercial African STT vs general Whisper vs open-source African-adapted Whisper.

### Groq Vision — Llama-4-Scout (OpenAI-compatible, free tier)

```
POST https://api.groq.com/openai/v1/chat/completions
Authorization: Bearer <GROQ_API_KEY>
Model: meta-llama/llama-4-scout-17b-16e-instruct
Input: messages with image_url (base64 PNG data URL) + text transcript
```

---

## Language Code Mapping (confirmed from Intron docs)

```python
# Maps Hover AI language codes → Intron Sahara language codes
# Codes confirmed from https://docs.voice.intron.io
LANGUAGE_MAP: dict[str, str] = {
    "en-pidgin": "pcm",  # Nigerian Pidgin — code-switched, confirmed
    "yo":        "yo",   # Yoruba-English — code-switched, confirmed
    "ha":        "ha",   # Hausa-English — code-switched, confirmed
    "ig":        "ig",   # Igbo-English — code-switched, confirmed
    "fr":        "fr",   # French, confirmed
    "en":        "en",   # English, confirmed
}
```

---

## Stack

| Concern           | Tool                                              | Notes                                     |
|-------------------|---------------------------------------------------|-------------------------------------------|
| Package manager   | **`uv`**                                          | pyproject.toml + uv.lock                  |
| Framework         | FastAPI + uvicorn                                 |                                           |
| Database          | Render free PostgreSQL + `asyncpg`                | No ORM, raw SQL                           |
| STT Primary       | Intron Sahara                                     | infer.voice.intron.io — hackathon token   |
| STT Benchmark #2  | Groq `whisper-large-v3-turbo`                     | Free tier                                 |
| STT Benchmark #3  | `intronhealth/afrispeech-whisper-medium-all`      | HuggingFace free Inference API            |
| Vision LLM        | Groq `meta-llama/llama-4-scout-17b-16e-instruct`  | Vision-capable, free tier                 |
| Auth              | `python-jose[cryptography]` + `passlib[bcrypt]`   | Stateless JWT                             |
| Audio conversion  | `pydub` + ffmpeg                                  | WebM→WAV for Groq + HF only (not Sahara) |
| HTTP client       | `httpx`                                           | Async, for Sahara polling loop            |

---

## Project Structure

```
backend/
├── pyproject.toml           # uv-managed — all deps here
├── uv.lock                  # committed lockfile
├── .env.example
├── README.md                # setup, uv commands, ffmpeg note
├── migrations/
│   └── 001_initial.sql
└── app/
    ├── __init__.py
    ├── main.py              # FastAPI instance, CORS, lifespan, router mounts
    ├── config.py            # pydantic-settings Settings — single source of truth
    ├── db.py                # asyncpg Pool + get_db() dependency
    ├── auth.py              # hash_password, verify_password, create_access_token, get_current_user
    ├── routers/
    │   ├── __init__.py
    │   ├── auth.py          # POST /auth/signup, POST /auth/signin
    │   ├── users.py         # GET /users/me, GET+PATCH /users/me/settings
    │   └── query.py         # POST /query
    ├── services/
    │   ├── __init__.py
    │   ├── audio.py         # convert_to_wav() — WebM→WAV 16kHz mono
    │   ├── stt.py           # run_stt(), _call_sahara(), _call_groq_whisper(), _call_hf_afrispeech()
    │   └── vision.py        # run_vision() — Groq Llama-4-Scout
    └── schemas/
        ├── __init__.py
        ├── auth.py          # SignupRequest, SigninRequest, TokenResponse
        ├── users.py         # UserResponse, UserSettingsResponse, UserSettingsUpdate
        ├── stt.py           # STTResult
        ├── vision.py        # BeaconStep, VisionResult
        └── query.py         # QueryResponse, BenchmarkResult
```

---

## Coding Standards (apply to every file)

- **Google-style docstrings** on every function and class
- **Full type annotations** on all parameters and return values
- **SRP**: one responsibility per module — no cross-cutting logic
- **No business logic in `main.py`** — only wiring (CORS, lifespan, router mounts)
- **`config.py` is the single source of truth** for all env vars — never call `os.getenv()` elsewhere
- **SOLID principles** throughout — particularly SRP and DIP (depend on abstractions via FastAPI `Depends`)
- **No bare `except`** — always catch specific exceptions and log them

---

## .env.example

```dotenv
# Database (Render free PostgreSQL — copy External Database URL)
DATABASE_URL=postgresql://user:password@host:5432/hoverai

# JWT
JWT_SECRET=change-me-minimum-32-chars
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=10080

# Intron Sahara STT — your hackathon access token IS this value
INTRON_API_KEY=your-intron-hackathon-access-token
INTRON_STT_BASE_URL=https://infer.voice.intron.io

# Groq — free tier (whisper-large-v3-turbo + llama-4-scout vision)
GROQ_API_KEY=your-groq-key

# HuggingFace — free Inference API (afrispeech-whisper-medium-all)
HF_API_KEY=your-huggingface-token

# Model names (override in prod if needed)
VISION_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
WHISPER_MODEL=whisper-large-v3-turbo
HF_ASR_MODEL=intronhealth/afrispeech-whisper-medium-all

# Sahara polling config
SAHARA_POLL_INTERVAL_S=1.0
SAHARA_POLL_TIMEOUT_S=60.0
```

---

## Sub-Task 1 — Scaffold & Configuration

**Intent**: Stand up the project structure, `uv` environment, and env config before any feature code.

**Todo**
- [x] `uv init backend` at repo root
- [x] `uv add` all dependencies
- [x] `app/` package with all `__init__.py` files
- [x] `app/main.py` — FastAPI instance, CORS, lifespan, router mounts
- [x] `app/config.py` — `Settings(BaseSettings)` with all fields typed
- [x] `.env.example`
- [x] `GET /health` → `{"status": "ok", "version": "0.1.0"}`
- [x] `README.md` with setup instructions

**Status** — `[x] complete`


---

## Sub-Task 2 — Database Schema

**Intent**: Three tables in Render Postgres. Raw SQL — no ORM, no migration framework.

**Todo**
- [x] Write `migrations/001_initial.sql`
- [ ] Create Render PostgreSQL free instance, copy External Database URL → `DATABASE_URL`
- [x] `app/db.py` — asyncpg `Pool`, `get_db()` dependency, pool created/closed in lifespan
- [x] `GET /health` runs `SELECT 1` to confirm DB connectivity

**Schema**: See `migrations/001_initial.sql`

`users` — id (uuid PK), email (unique), full_name, hashed_password, language, created_at
`user_settings` — user_id (FK→users), overlay_opacity, overlay_size, mic_sensitivity,
                   sound_effects, notifications, wake_word_enabled, launch_at_login,
                   show_in_taskbar, updated_at
`query_logs` — id, user_id (FK), created_at, language_used, audio_duration_ms,
               transcript_sahara, sahara_latency_ms,
               transcript_whisper, whisper_latency_ms,
               transcript_afrispeech, afrispeech_latency_ms,
               vision_response (jsonb), beacon_steps (jsonb)

**Status** — `[x] complete` *(Render instance still needs to be created and DATABASE_URL set)*

---

## Sub-Task 3 — Auth Routes

**Intent**: Sign-up and sign-in with bcrypt + JWT. Stateless — no server-side session.
`app/auth.py` is a pure utility module with zero DB knowledge (SRP).

**Routes**
- `POST /auth/signup` → insert users + user_settings rows, return JWT. 409 on duplicate email.
- `POST /auth/signin` → verify password, return JWT. 401 on wrong credentials.
- `GET /users/me` → JWT required, returns user profile.

**Todo**
- [x] `app/schemas/auth.py` — SignupRequest, SigninRequest, TokenResponse
- [x] `app/auth.py` — hash_password, verify_password, create_access_token, get_current_user
- [x] `app/routers/auth.py`
- [x] `app/routers/users.py` — GET /users/me
- [x] Wire both into `app/main.py`

**Status** — `[x] complete`

---

## Sub-Task 4 — User Settings Sync

**Intent**: Electron settings window reads/writes settings from server.
Local `settings.json` remains the offline fallback (Electron-side).

**Routes**
- `GET /users/me/settings` → returns user_settings row
- `PATCH /users/me/settings` → partial update (only provided fields changed)

`UserSettingsResponse` must mirror `AppSettings` in `hover-app/src/preload/index.d.ts` exactly.

**Todo**
- [x] `app/schemas/users.py` — UserResponse, UserSettingsResponse, UserSettingsUpdate (all fields Optional)
- [x] Add GET + PATCH routes to `app/routers/users.py`

**Status** — `[x] complete`

---

## Sub-Task 5 — Audio Conversion

**Intent**: Sahara accepts WebM natively — no conversion for Sahara.
Conversion to WAV 16kHz mono is only needed for Groq Whisper and HF AfriSpeech.

**Todo**
- [x] `app/services/audio.py` — `convert_to_wav(audio_bytes, source_format="webm") -> bytes`
- [x] Output: 16000 Hz, mono, 16-bit PCM WAV via pydub
- [x] `AudioConversionError` custom exception
- [x] Document ffmpeg as system dependency in README.md

**Status** — `[x] complete`

---

## Sub-Task 6 — STT Pipeline

**Intent**: Run all three STT engines concurrently with `asyncio.gather`.
Sahara's async poll loop runs inside `_call_sahara()` — awaitable, compatible with gather.

**`_call_sahara(audio_bytes, language) -> tuple[str, int]`**
```
1. POST /file/v1/upload — multipart: audio_file_name, audio_file_blob, use_language_asr_input
2. Extract file_id from response["data"]["file_id"]
3. Poll GET /file/v1/status/{file_id} every SAHARA_POLL_INTERVAL_S seconds
4. On FILE_TRANSCRIBED: extract transcript, return (transcript, elapsed_ms)
5. On FILE_PROCESSING_FAILED or timeout: return ("", elapsed_ms), log error
# TODO: confirm exact transcript field name when FILE_TRANSCRIBED (likely data.transcription)
```

**`_call_groq_whisper(wav_bytes, language) -> tuple[str, int]`**
```python
client = AsyncOpenAI(api_key=settings.groq_api_key, base_url="https://api.groq.com/openai/v1")
await client.audio.transcriptions.create(
    model=settings.whisper_model, file=("audio.wav", wav_bytes, "audio/wav")
)
```

**`_call_hf_afrispeech(wav_bytes, language) -> tuple[str, int]`**
```python
# POST raw WAV bytes to HuggingFace Inference API
POST https://api-inference.huggingface.co/models/intronhealth/afrispeech-whisper-medium-all
Authorization: Bearer <HF_API_KEY>
Content-Type: application/octet-stream
Body: wav_bytes
Response: {"text": "..."}
```

**`STTResult` schema**
```
transcript          str   Sahara result — used downstream for vision
sahara_latency_ms   int
transcript_whisper  str
whisper_latency_ms  int
transcript_afrispeech str
afrispeech_latency_ms int
```

Per-engine errors return ("", 0) and log — never propagate to run_stt().

**Todo**
- [x] `app/services/stt.py` — run_stt() + three private helpers, full Google docstrings
- [x] LANGUAGE_MAP constant at module level with inline comments
- [x] `app/schemas/stt.py` — STTResult

**Status** — `[x] complete`

---

## Sub-Task 7 — Vision Pipeline

**Intent**: Sahara transcript + full screenshot → Groq Llama-4-Scout → BeaconStep list.
Coordinates are fractional 0.0–1.0 so Electron can scale to any display resolution.

**Model**: `meta-llama/llama-4-scout-17b-16e-instruct` via Groq (vision-capable, free tier, Llama 4 — not deprecated).

**System prompt strategy**: Embeds BeaconStep JSON Schema inline. Instructs model to return ONLY
a valid JSON array. On parse failure → retry once with stricter prompt → raise VisionParseError.

**Todo**
- [x] `app/schemas/vision.py` — BeaconStep (step, instruction, x, y, w, h all 0.0–1.0), VisionResult
- [x] `app/services/vision.py` — run_vision(), VisionParseError, system prompt as module constant
- [x] Google docstrings on all functions

**Status** — `[x] complete`

---

## Sub-Task 8 — Main Query Route POST /query

**Intent**: Assemble the full pipeline. One endpoint, one HTTP round-trip from Electron.

**Request**: multipart/form-data
- `audio: UploadFile` — WebM from Electron MediaRecorder
- `screenshot: str` — base64 PNG of full screen
- `language: str` — Hover AI language code (e.g. "en-pidgin")

**Pipeline**
```
1. read audio bytes from UploadFile
2. convert_to_wav(audio_bytes) → wav_bytes        (for Groq + HF only)
3. asyncio.gather(
     _call_sahara(audio_bytes, lang),              ← WebM sent directly
     _call_groq_whisper(wav_bytes, lang),
     _call_hf_afrispeech(wav_bytes, lang)
   ) → STTResult
4. run_vision(screenshot_b64, stt.transcript, lang) → VisionResult
5. INSERT INTO query_logs (all STT results + latencies + vision output)
6. return QueryResponse
```

**Error contract**
- All three STT engines returned "" → HTTP 422 `{"detail": "Speech recognition failed"}`
- Vision failure → HTTP 502 `{"detail": "Vision processing failed"}`

**Response**
```
transcript            str            Sahara transcript
steps                 BeaconStep[]   beacon overlay positions
summary               str            one-line description of what to do
benchmark             BenchmarkResult
  sahara_ms           int
  whisper_ms          int
  afrispeech_ms       int
  transcript_whisper  str
  transcript_afrispeech str
```

**Todo**
- [x] `app/schemas/query.py` — QueryResponse, BenchmarkResult
- [x] `app/routers/query.py` — full pipeline, JWT required, Google docstrings
- [x] Wire into `app/main.py` with prefix `/query`

**Status** — `[x] complete`

---

## Sub-Task 9 — Electron Integration

**Intent**: Wire Electron's stub auth form and TODO capture handler to the real backend.

**What changes in Electron**

| File | Current state | Change needed |
|------|--------------|---------------|
| `AuthPage.tsx` | onSubmit calls onComplete() immediately | POST to /auth/signup or /auth/signin, store JWT via IPC |
| `src/main/index.ts` | capture-done → TODO comment (line ~362) | Record audio → POST /query → push query-result IPC to overlay |
| `OverlayWidget.tsx` | Drag-select UI | Replace with loading spinner → beacon dots layer |
| `src/preload/index.d.ts` | Existing window.api surface | Add onQueryResult(cb), storeToken(t), getToken() |
| `SettingsPage.tsx` | Reads/writes local settings.json | Add server sync, fall back to local JSON when offline |

**New IPC channels**
- `query-result` (main → overlay renderer): pushes QueryResponse beacon steps
- `store-token` / `get-token` (renderer ↔ main): JWT via safeStorage.encryptString

**Status** — `[x] complete`

---

## Dependency Order

```
Sub-Task 1 (scaffold)
    └─> Sub-Task 2 (schema)
            ├─> Sub-Task 3 (auth routes)
            │       └─> Sub-Task 4 (settings sync)
            ├─> Sub-Task 5 (audio convert)  ─────┐
            └─> Sub-Task 7 (vision pipeline) ──┐  │
                                               │  └─> Sub-Task 6 (STT pipeline)
                                               └──┬─> Sub-Task 8 (query route)
                                                  │
                                    Sub-Task 4 ───┘
                                                  └─> Sub-Task 9 (Electron)
```

Sub-Tasks 5, 6, and 7 can be built in parallel once Sub-Task 2 is done.
Sub-Task 9 can only start after Sub-Task 8 is testable end-to-end.

---

## Benchmark Report (separate from app — run before Sep 15 2026)

The hackathon requires a benchmark report comparing 3+ STT models.
This is a **separate script**, not part of the app itself.

**Dataset**: `intronhealth/AfriSwitch` streamed via HuggingFace `datasets` library
**Sample size**: ~100–200 samples (~50–100 MB download, not 2–5 GB)
**Script location**: `backend/benchmark/run_benchmark.py`
**Output**: WER/CER table per language per model → `benchmark/results.csv` + `benchmark/report.md`

The three models benchmarked are identical to the app's STT pipeline:
1. Intron Sahara (`sahara`)
2. Groq `whisper-large-v3-turbo` (`groq_whisper`)
3. `intronhealth/afrispeech-whisper-medium-all` (`hf_afrispeech`)

