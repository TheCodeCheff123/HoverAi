"""Query route — POST /api/v1/query.

Main feature endpoint. Accepts audio + screenshot from Electron,
transcribes with Groq Whisper (~1-2s), uploads to Sahara in parallel,
runs the vision pipeline, returns guided steps + TTS in ~5-15s.

The DB write and Sahara poll both run as background tasks after the
response is already sent — nothing blocks the hot path except STT + vision + TTS.
"""

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.config import settings
from app.db import AsyncSessionLocal, get_session
from app.models.models import QueryLog, User, UserSettings
from app.schemas.query import QueryResponse
from app.schemas.users import VOICE_GENDER_MAP
from app.services.audio import AudioConversionError, convert_to_wav
from app.services.stt import _sahara_poll, run_stt
from app.services.sahara_tts import SAHARA_VOICE_MAP, synthesise_sahara
from app.services.tts import synthesise
from app.services.vision import VisionParseError, _compress_screenshot, run_vision

logger = logging.getLogger(__name__)

router = APIRouter()


async def _write_log_and_poll_sahara(
    log_kwargs: dict[str, Any],
    sahara_file_id: str | None,
) -> None:
    """Background task: write QueryLog to DB then optionally poll Sahara.

    Runs entirely after the HTTP response has been sent — nothing in the
    hot path waits for this.  Uses its own session from AsyncSessionLocal.

    Args:
        log_kwargs: Keyword arguments passed directly to QueryLog().
        sahara_file_id: Sahara file_id to poll; ``None`` skips polling.
    """
    async with AsyncSessionLocal() as session:
        log = QueryLog(**log_kwargs)
        session.add(log)
        await session.flush()   # assign log.id before polling

        if sahara_file_id:
            # Poll Sahara in the same background coroutine so we can
            # update the same row without a second DB round-trip.
            transcript, elapsed_ms = await _sahara_poll(sahara_file_id)
            log.transcript_sahara = transcript
            log.sahara_latency_ms = elapsed_ms
            session.add(log)

        await session.commit()
        logger.info("QueryLog written — id=%s  sahara=%s", log.id, bool(sahara_file_id))


@router.post("", response_model=QueryResponse)
async def query(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(..., description="WebM audio from Electron MediaRecorder"),
    screenshot: str = Form(..., description="Base64-encoded PNG of the full screen"),
    language: str = Form(default="en-pidgin", description="Hover AI language code"),
    current_user: User = Depends(get_current_user),
    _session: AsyncSession = Depends(get_session),  # kept to satisfy auth dependency chain
) -> QueryResponse:
    """Run the voice-to-guided-steps pipeline with TTS response.

    Hot path (blocks until response is sent):
        1. Load voice preference from DB (tiny, uses injected session).
        2. Read audio + WAV conversion.
        3. Groq Whisper + Sahara upload concurrently.
        4. Vision pipeline (moondream → qwen2.5 or Groq fallback).
        5. TTS.
        6. Return response.

    Background (fires after response, non-blocking):
        • Write QueryLog to DB.
        • Poll Sahara → update QueryLog with African-language transcript.

    Raises:
        HTTPException 422: Groq Whisper returned empty transcript.
        HTTPException 502: Vision LLM failed after all retries.
    """
    # ── 1. Load voice preference (one small DB read, reuses injected session) ─
    from sqlmodel import select  # noqa: PLC0415
    settings_result = await _session.execute(
        select(UserSettings).where(UserSettings.user_id == current_user.id)
    )
    user_settings = settings_result.scalar_one_or_none()
    voice_gender = getattr(user_settings, "voice_gender", "female") if user_settings else "female"
    tts_voice = VOICE_GENDER_MAP.get(voice_gender, "autumn")

    # ── 2. Read audio + WAV conversion ───────────────────────────────────────
    audio_bytes = await audio.read()
    try:
        wav_bytes = convert_to_wav(audio_bytes)
    except AudioConversionError as exc:
        logger.error("Audio conversion failed: %s", exc)
        wav_bytes = b""

    # ── 3. STT + screenshot compression concurrently ─────────────────────────
    # _compress_screenshot is CPU-bound (PIL resize + JPEG encode, ~200-400ms).
    # It only needs the screenshot — independent of WAV/audio — so we can run
    # it in a thread executor while Groq Whisper is in-flight.
    loop = asyncio.get_event_loop()
    stt_result, compressed_b64 = await asyncio.gather(
        run_stt(audio_bytes, wav_bytes, language),
        loop.run_in_executor(None, _compress_screenshot, screenshot),
    )

    if not stt_result.transcript:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Speech recognition failed — Groq Whisper returned an empty transcript.",
        )

    # ── 4. Vision pipeline ────────────────────────────────────────────────────
    try:
        vision_result = await run_vision(
            screenshot, stt_result.transcript, language, compressed_b64=compressed_b64
        )
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

    # ── 5. TTS ────────────────────────────────────────────────────────────────
    # Route: Sahara TTS for African languages (authentic voice), Groq Orpheus
    # for English/French or when Sahara is disabled/fails.
    speech_b64 = ""
    if settings.tts_enabled:
        use_sahara = settings.sahara_tts_enabled and language in SAHARA_VOICE_MAP
        if use_sahara:
            speech_b64, _ = await synthesise_sahara(
                vision_result.summary, language, voice_gender=voice_gender
            )
            if not speech_b64:
                # Sahara failed — fall back to Groq Orpheus
                logger.warning("Sahara TTS failed for language=%s — falling back to Groq Orpheus", language)
                speech_b64, _ = await synthesise(vision_result.summary, voice=tts_voice)
        else:
            speech_b64, _ = await synthesise(vision_result.summary, voice=tts_voice)

    # ── 6. Return response (DB write happens after this) ─────────────────────
    steps_list = [s.model_dump() for s in vision_result.steps]
    background_tasks.add_task(
        _write_log_and_poll_sahara,
        {
            "user_id": current_user.id,
            "language_used": language,
            "transcript_whisper": stt_result.transcript,
            "whisper_latency_ms": stt_result.whisper_latency_ms,
            "transcript_sahara": None,
            "sahara_latency_ms": None,
            "vision_response": {"summary": vision_result.summary, "steps": steps_list},
            "beacon_steps": steps_list,
        },
        stt_result.sahara_file_id,
    )

    return QueryResponse(
        transcript=stt_result.transcript,
        steps=vision_result.steps,
        summary=vision_result.summary,
        speech_b64=speech_b64,
    )
