"""Query route — POST /api/v1/query.

The main feature endpoint. Accepts audio + screenshot from Electron,
runs Groq Whisper and HF AfriSpeech concurrently (fast), uploads to
Sahara (fast, ~1-2 s), returns a response in ~10-15 s, then continues
polling Sahara in a BackgroundTask that updates the query_logs row once
the transcript arrives (2-3 min later).
"""

import asyncio
import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth import get_current_user
from app.config import settings
from app.db import AsyncSessionLocal, get_session
from app.models.models import QueryLog, User, UserSettings
from app.schemas.query import BenchmarkResult, QueryResponse
from app.schemas.users import VOICE_GENDER_MAP
from app.services.audio import AudioConversionError, convert_to_wav
from app.services.stt import _sahara_poll, run_stt
from app.services.tts import synthesise
from app.services.vision import VisionParseError, run_vision

logger = logging.getLogger(__name__)

router = APIRouter()


async def sahara_poll_and_update(file_id: str, log_id: uuid.UUID) -> None:
    """Background task: poll Sahara until done, then write result to query_logs.

    Runs after the HTTP response has been sent to the client.  Uses its own
    database session (from ``AsyncSessionLocal``) because the request session
    is already closed by the time this executes.

    Args:
        file_id: Sahara file_id returned by the upload step.
        log_id: Primary key of the QueryLog row to update.
    """
    transcript, elapsed_ms = await _sahara_poll(file_id)

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(QueryLog).where(QueryLog.id == log_id))
        log = result.scalar_one_or_none()
        if log is None:
            logger.error(
                "sahara_poll_and_update: QueryLog %s not found — discarding result",
                log_id,
            )
            return
        log.transcript_sahara = transcript
        log.sahara_latency_ms = elapsed_ms
        session.add(log)
        await session.commit()
        logger.info(
            "Sahara result written to query_logs — log_id=%s elapsed=%dms",
            log_id,
            elapsed_ms,
        )


@router.post("", response_model=QueryResponse)
async def query(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(..., description="WebM audio from Electron MediaRecorder"),
    screenshot: str = Form(..., description="Base64-encoded PNG of the full screen"),
    language: str = Form(default="en-pidgin", description="Hover AI language code"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> QueryResponse:
    """Run the full voice-to-beacon-steps pipeline with TTS response.

    Accepts a WebM audio recording and a base64 screenshot from the Electron
    overlay.  Returns beacon steps and a base64 WAV in ~10-15 s.

    Pipeline (in-request, ~10-15 s):
        1. Load user voice preference.
        2. Read audio bytes.
        3. Convert to WAV for Whisper engines.
        4. Groq Whisper + HF AfriSpeech concurrently (asyncio.gather).
        5. Sahara upload (fast, ~1-2 s) — returns file_id.
        6. Pick primary transcript (Groq fallback → HF).
        7. Vision LLM.
        8. Insert QueryLog (transcript_sahara=None, sahara_latency_ms=None).
        9. TTS + session.flush() concurrently.
        10. Register background task to poll Sahara and update the log row.
        11. Return QueryResponse.

    Background task (~2-3 min after response):
        sahara_poll_and_update — polls Sahara, writes transcript_sahara +
        sahara_latency_ms back to query_logs.

    Args:
        background_tasks: FastAPI BackgroundTasks injected by the framework.
        audio: Uploaded audio file from Electron's MediaRecorder (WebM/WAV).
        screenshot: Base64-encoded PNG of the full screen at query time.
        language: Hover AI language code (e.g. ``"en-pidgin"``).
        current_user: Authenticated ``User`` injected by ``get_current_user``.
        session: Async database session injected by ``get_session``.

    Returns:
        A ``QueryResponse`` with transcript, beacon steps, summary, base64
        WAV speech audio, and benchmark latency data from Groq + HF engines.
        The ``benchmark.sahara_ms`` field is ``None`` — it will be populated
        in the database once the background task finishes.

    Raises:
        HTTPException 422: If both fast engines returned empty transcripts.
        HTTPException 502: If the vision LLM fails after retry.
    """
    # ── 0. Load user's voice preference ──────────────────────────────────────
    settings_result = await session.execute(
        select(UserSettings).where(UserSettings.user_id == current_user.id)
    )
    user_settings = settings_result.scalar_one_or_none()
    voice_gender = getattr(user_settings, "voice_gender", "female") if user_settings else "female"
    tts_voice = VOICE_GENDER_MAP.get(voice_gender, "autumn")

    # ── 1. Read audio bytes ───────────────────────────────────────────────────
    audio_bytes = await audio.read()

    # ── 2. Convert to WAV for Whisper engines ─────────────────────────────────
    try:
        wav_bytes = convert_to_wav(audio_bytes)
    except AudioConversionError as exc:
        logger.error("Audio conversion failed: %s", exc)
        wav_bytes = b""

    # ── 3+4+5. STT — Groq + HF concurrent, then Sahara upload ────────────────
    # run_stt returns immediately after the upload; the poll runs in background.
    stt_result = await run_stt(audio_bytes, wav_bytes, language)

    if not any([stt_result.transcript_whisper, stt_result.transcript_afrispeech]):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Speech recognition failed — both fast engines returned empty results.",
        )

    # Groq is the primary fast transcript; fall back to HF if Groq failed
    primary_transcript = stt_result.transcript_whisper or stt_result.transcript_afrispeech

    # ── 6. Vision LLM ─────────────────────────────────────────────────────────
    try:
        vision_result = await run_vision(screenshot, primary_transcript, language)
    except VisionParseError as exc:
        logger.error("Vision pipeline failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Vision processing failed — could not parse LLM response.",
        )
    except Exception as exc:
        logger.error("Vision pipeline unexpected error: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Vision processing failed.",
        )

    # ── 7. Build log row — Sahara fields are None until background task runs ──
    steps_list = [s.model_dump() for s in vision_result.steps]
    vision_dict = {"summary": vision_result.summary, "steps": steps_list}

    log = QueryLog(
        user_id=current_user.id,
        language_used=language,
        transcript_sahara=None,
        sahara_latency_ms=None,
        transcript_whisper=stt_result.transcript_whisper,
        whisper_latency_ms=stt_result.whisper_latency_ms,
        transcript_afrispeech=stt_result.transcript_afrispeech,
        afrispeech_latency_ms=stt_result.afrispeech_latency_ms,
        vision_response=vision_dict,  # type: ignore[arg-type]
        beacon_steps=steps_list,      # type: ignore[arg-type]
    )
    session.add(log)

    # ── 8. TTS + flush concurrently ───────────────────────────────────────────
    async def _tts_disabled() -> tuple[str, int]:
        return ("", 0)

    tts_coro = synthesise(vision_result.summary, voice=tts_voice) if settings.tts_enabled else _tts_disabled()

    (speech_b64, tts_ms), _ = await asyncio.gather(
        tts_coro,
        session.flush(),
    )

    # ── 9. Register Sahara background poll ────────────────────────────────────
    if stt_result.sahara_file_id is not None:
        background_tasks.add_task(
            sahara_poll_and_update,
            stt_result.sahara_file_id,
            log.id,
        )

    # ── 10. Return response ───────────────────────────────────────────────────
    return QueryResponse(
        transcript=primary_transcript,
        steps=vision_result.steps,
        summary=vision_result.summary,
        speech_b64=speech_b64,
        benchmark=BenchmarkResult(
            sahara_ms=None,
            whisper_ms=stt_result.whisper_latency_ms,
            afrispeech_ms=stt_result.afrispeech_latency_ms,
            tts_ms=tts_ms,
            transcript_whisper=stt_result.transcript_whisper,
            transcript_afrispeech=stt_result.transcript_afrispeech,
        ),
    )
