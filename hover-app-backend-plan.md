# Hover AI — FastAPI Backend Plan

## Top-Level Overview

Build a FastAPI backend that serves three concerns:

1. **Auth** — real user accounts (email + password, JWT), user settings persisted server-side in Supabase/Postgres
2. **Query pipeline** — the core feature: receives an audio blob + full screenshot from Electron, runs STT (Sahara primary + Whisper + Google for benchmark), passes transcript + screenshot to a vision LLM, returns a structured list of beacon steps with screen coordinates
3. **Benchmark logging** — every query logs STT results from all three engines to the database for comparison

The Electron app communicates with this backend over plain HTTPS REST (no WebSocket needed — each query is a single round-trip). The overlay waits in a loading state while the request is in-flight, then renders the returned beacon steps.

---

## Sub-Tasks

---

### Sub-Task 1 — Project scaffold & configuration

**Intent**
Stand up a clean FastAPI project with the right folder structure, dependency management, and environment config before any feature code is written.

**Expected Outcomes**
- `backend/` directory at repo root with `pyproject.toml` / `requirements.txt`
- FastAPI app boots with `uvicorn`
- `.env` file template covers all secrets (Supabase URL + key, JWT secret, Sahara key, OpenAI/OpenRouter key, Google STT credentials)
- CORS configured to accept requests from `localhost` (Electron renderer dev origin) and production origins
- Health-check route `GET /health` returns `{"status": "ok"}`

**Todo List**
- [ ] Create `backend/` directory with `app/` package inside
- [ ] Add `requirements.txt` with: `fastapi`, `uvicorn[standard]`, `python-dotenv`, `supabase`, `python-jose[cryptography]`, `passlib[bcrypt]`, `httpx`, `openai`, `google-cloud-speech`, `pydantic-settings`
- [ ] Create `app/main.py` — FastAPI app instance, CORS middleware, router includes, lifespan handler
- [ ] Create `app/config.py` — `pydantic-settings` class reading all env vars
- [ ] Create `.env.example` listing every required secret
- [ ] Add `GET /health` route

**Relevant Context**
- Backend lives at `backend/` in the repo root (alongside `hover-app/` and `landing_page/`)
- Electron renderer in dev runs at `http://localhost:5173` — must be in CORS allowed origins
- Secrets needed: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `JWT_SECRET`, `JWT_ALGORITHM` (HS256), `JWT_EXPIRE_MINUTES`, `SAHARA_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`

**Status** — `[ ] pending`

---

### Sub-Task 2 — Database schema (Supabase/Postgres)

**Intent**
Define the tables needed to support users, their settings, and benchmark query logs. All schema is applied as Supabase SQL migrations.

**Expected Outcomes**
- Three tables exist in Supabase: `users`, `user_settings`, `query_logs`
- `users` — `id` (uuid PK), `email` (unique), `hashed_password`, `created_at`
- `user_settings` — `user_id` (FK → users), `language`, `mic_sensitivity`, `wake_word_enabled`, `overlay_opacity`, `overlay_size`, `sound_effects`, `notifications`, `updated_at`
- `query_logs` — `id`, `user_id` (FK), `created_at`, `transcript_sahara`, `transcript_whisper`, `transcript_google`, `sahara_latency_ms`, `whisper_latency_ms`, `google_latency_ms`, `vision_response` (jsonb), `language_used`
- SQL migration file committed to `backend/migrations/`

**Todo List**
- [ ] Write `backend/migrations/001_initial.sql` with all three table definitions
- [ ] Apply migration in Supabase dashboard (or via Supabase CLI)
- [ ] Create `app/db.py` — Supabase client singleton using `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`
- [ ] Verify tables are accessible from Python with a simple test query

**Relevant Context**
- `AppSettings` in the Electron app (`src/preload/index.d.ts`) defines the same fields that `user_settings` must store — keep them in sync
- `query_logs.vision_response` stores the full JSON returned by the vision LLM so it can be inspected later for benchmarking

**Status** — `[ ] pending`

---

### Sub-Task 3 — Auth routes (sign-up, sign-in, JWT)

**Intent**
Implement email/password auth with hashed passwords and JWT access tokens. The Electron app stores the token and sends it as `Authorization: Bearer <token>` on every subsequent request.

**Expected Outcomes**
- `POST /auth/signup` — creates user + default settings row, returns JWT
- `POST /auth/signin` — verifies password, returns JWT
- `GET /users/me` — returns authenticated user's profile (requires valid JWT)
- Invalid credentials return 401; duplicate email returns 409
- Reusable `get_current_user` dependency extracts and validates JWT from headers

**Todo List**
- [ ] Create `app/routers/auth.py` with signup and signin routes
- [ ] Create `app/routers/users.py` with `GET /users/me` and `PATCH /users/me/settings`
- [ ] Create `app/auth.py` — `hash_password`, `verify_password`, `create_access_token`, `get_current_user` dependency
- [ ] On signup: insert into `users` + insert default row into `user_settings`
- [ ] Request/response Pydantic models: `SignupRequest`, `SigninRequest`, `TokenResponse`, `UserResponse`
- [ ] Include routers in `main.py`

**Relevant Context**
- `AuthPage.tsx` collects `email`, `password`, `full_name` (signup), `language` — all go in the signup request body
- After successful signin/signup, the Electron app must store the JWT (in-memory or Electron `safeStorage`) and attach it to all future calls
- The `sign-out` flow in Electron already closes the settings window and re-opens onboarding — no server-side token invalidation needed for MVP (stateless JWT)

**Status** — `[ ] pending`

---

### Sub-Task 4 — User settings sync route

**Intent**
Allow the settings window to load settings from the server on open and save changes back. This replaces (or supplements) the local `settings.json` file for account-linked settings.

**Expected Outcomes**
- `GET /users/me/settings` — returns current `user_settings` row
- `PATCH /users/me/settings` — partial update, returns updated settings
- Both routes require JWT auth

**Todo List**
- [ ] Add `GET /users/me/settings` route to `app/routers/users.py`
- [ ] Add `PATCH /users/me/settings` route with `UserSettingsUpdate` Pydantic model (all fields optional)
- [ ] Response model `UserSettingsResponse` matches `AppSettings` shape from `src/preload/index.d.ts`

**Relevant Context**
- `SettingsPage.tsx` calls `window.api.getSettings()` and `window.api.saveSettings()` on mount and on every change — these IPC calls currently read/write local JSON; they will need a new `window.api` method to call the backend instead (that is an Electron-side change, handled after this sub-task)
- Local `settings.json` can remain as a fallback when offline

**Status** — `[ ] pending`

---

### Sub-Task 5 — STT pipeline (Sahara primary + benchmarks)

**Intent**
Build the speech-to-text layer that runs Sahara API as the primary engine and Whisper + Google concurrently for benchmarking. Returns the Sahara transcript for downstream use and logs all three results.

**Expected Outcomes**
- Internal async function `run_stt(audio_bytes, language) -> STTResult` that:
  - Fires all three engines concurrently with `asyncio.gather`
  - Returns `{transcript: str, sahara_ms: int, whisper_ms: int, google_ms: int, whisper_transcript: str, google_transcript: str}`
- Sahara API v2.5 endpoint called with language hint
- Whisper called via OpenAI API (`whisper-1` model)
- Google Speech-to-Text called with language code mapped from user language preference
- Each call individually timed

**Todo List**
- [ ] Create `app/services/stt.py` with `run_stt()` and three private async helper functions: `_call_sahara()`, `_call_whisper()`, `_call_google()`
- [ ] Map Hover AI language codes (`en-pidgin`, `yo`, `ha`, `ig`, `fr`, `en`) to Sahara and Google BCP-47 codes — document the mapping in `stt.py`
- [ ] Handle per-engine errors gracefully — if one engine fails, log the error and return an empty string for that engine (do not fail the whole request)
- [ ] Write `app/schemas/stt.py` with `STTResult` Pydantic model

**Relevant Context**
- PRD section 6 specifies: Sahara (primary), Whisper (baseline), Google (accent evaluation)
- User language comes from `user_settings.language` passed in the request
- Audio format from Electron will be WebM/Opus (Web MediaRecorder default) — confirm Sahara accepts this or convert to WAV via `pydub` if needed

**Status** — `[ ] pending`

---

### Sub-Task 6 — Vision LLM pipeline (screenshot + transcript → beacon steps)

**Intent**
Pass the full screenshot and Sahara transcript to a vision-capable LLM. The model returns a structured list of steps, each with a screen coordinate and instruction text. This drives the beacon overlay in Electron.

**Expected Outcomes**
- Internal async function `run_vision(screenshot_base64, transcript, language) -> VisionResult`
- Prompt instructs the model to: identify the UI element(s) relevant to the query, return a JSON array of steps each with `{step: int, instruction: str, x: float, y: float, w: float, h: float}` — coordinates as fractions of screen dimensions (0.0–1.0)
- `VisionResult` contains `steps: list[BeaconStep]` and `summary: str`
- Model: Claude 3.5 Sonnet or GPT-4o via OpenRouter (configurable via env var `VISION_MODEL`)

**Todo List**
- [ ] Create `app/services/vision.py` with `run_vision()` function
- [ ] Write the system prompt that instructs the model to return only valid JSON matching the `BeaconStep` schema
- [ ] Parse and validate model response with Pydantic — if JSON parsing fails, retry once then return an error step
- [ ] Create `app/schemas/vision.py` with `BeaconStep` and `VisionResult` models
- [ ] Make model name configurable via `VISION_MODEL` env var

**Relevant Context**
- Coordinates must be fractional (0–1) so the Electron overlay can scale them to any screen resolution — Electron knows the actual display bounds
- The overlay already handles both single-beacon and multi-step rendering (option C confirmed by user)
- `vision_response` column in `query_logs` stores the full JSON for later analysis

**Status** — `[ ] pending`

---

### Sub-Task 7 — Main query route `POST /query`

**Intent**
Assemble the full pipeline: receive audio + screenshot from Electron, run STT and vision concurrently where possible, log everything, return beacon steps.

**Expected Outcomes**
- `POST /query` accepts `multipart/form-data` with fields: `audio` (file), `screenshot` (base64 string), `language` (string)
- Requires JWT auth (`get_current_user` dependency)
- Pipeline: STT runs first (needs transcript) → vision runs with transcript + screenshot → results logged → response returned
- Response body: `{transcript: str, steps: [{step, instruction, x, y, w, h}], summary: str}`
- Query is logged to `query_logs` table with all benchmark data

**Todo List**
- [ ] Create `app/routers/query.py` with `POST /query` route
- [ ] Accept `UploadFile` for audio, `str` for screenshot (base64), `str` for language
- [ ] Call `run_stt(audio_bytes, language)` — await result
- [ ] Call `run_vision(screenshot_base64, transcript, language)` — await result
- [ ] Insert row into `query_logs` with all fields
- [ ] Return `QueryResponse` Pydantic model
- [ ] Include router in `main.py`
- [ ] Add error handling: if STT fails entirely, return 422; if vision fails, return 502

**Relevant Context**
- The `capture-done` IPC handler in `main/index.ts` (line ~362) currently has a `// TODO: pass the selected region to AI processing` comment — this is where the Electron side will call the backend
- The user confirmed: no manual region select — Electron sends the full screenshot, the vision model identifies relevant regions
- This means `OverlayWidget.tsx` region-select behaviour will be replaced with a loading state + beacon render (separate Electron-side task, not part of this backend plan)

**Status** — `[ ] pending`

---

### Sub-Task 8 — Electron integration (wire backend calls into the app)

**Intent**
Update the Electron app to call the FastAPI backend for auth and query. This sub-task is entirely on the Electron side but is listed here so it is planned alongside the backend.

**Expected Outcomes**
- `AuthPage.tsx` form submits to `POST /auth/signup` or `POST /auth/signin` — JWT stored in Electron `safeStorage`
- `SettingsPage.tsx` loads from and saves to `GET/PATCH /users/me/settings` — falls back to local JSON if offline
- Shortcut trigger: records audio via `getUserMedia` + MediaRecorder until VAD detects silence, then sends audio + screenshot to `POST /query`
- Overlay switches from region-select mode to: loading spinner → beacon render
- New IPC channels needed: `start-recording`, `stop-recording`, `query-result` (main → renderer push)
- New `window.api` methods needed: `startRecording`, `onQueryResult(cb)`
- Backend base URL configurable via env var `VITE_API_URL` in Electron renderer

**Todo List**
- [ ] Add `VITE_API_URL` to `.env` (defaults to `http://localhost:8000`)
- [ ] Create `app/services/api.ts` in renderer — typed fetch wrapper that attaches JWT Bearer header
- [ ] Update `AuthPage.tsx` to submit real credentials and store JWT on success
- [ ] Update `SettingsPage.tsx` to fetch/save settings via API with JWT
- [ ] Add audio recording to main process (or renderer): MediaRecorder → VAD silence detection → sends audio blob to main process
- [ ] Main process: on shortcut fire, take screenshot + start recording; on VAD stop, POST to `/query`; push result to overlay via `query-result` IPC
- [ ] Update `OverlayWidget.tsx`: replace drag-select UI with loading state → beacon layer rendering steps

**Relevant Context**
- JWT should be stored with `safeStorage.encryptString` in Electron main process (not in renderer localStorage — CSP blocks it)
- VAD: use a simple energy threshold in the renderer audio pipeline or the `@ricky0123/vad-web` library
- The `capture-done` → `endCapture()` flow in main process will be replaced by `query-result` push from the backend response handler

**Status** — `[ ] pending`

---

## Dependency Order

```
Sub-Task 1 (scaffold)
    └─> Sub-Task 2 (schema)
            └─> Sub-Task 3 (auth routes)
                    └─> Sub-Task 4 (settings sync)
Sub-Task 5 (STT)  ─────┐
Sub-Task 6 (vision) ───┴─> Sub-Task 7 (query route)
                                └─> Sub-Task 8 (Electron integration)
```

Sub-tasks 5 and 6 can be built in parallel once sub-task 2 is done. Sub-task 8 can only start after sub-task 7 is complete and the query endpoint is testable.
