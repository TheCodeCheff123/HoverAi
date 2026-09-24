"""Query route — POST /api/v1/query.

Main feature endpoint. Accepts audio + screenshot from Electron,
transcribes with Groq Whisper (~1-2s), runs the vision pipeline,
returns guided steps + TTS in ~5-15s.

The DB write runs as a background task after the response is already
sent — nothing blocks the hot path except STT + vision + TTS.
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
from app.services.conversation import get_or_create_conversation, save_turn
from app.services.stt import run_stt
from app.services.sahara_tts import SAHARA_VOICE_MAP, synthesise_sahara
from app.services.tts import synthesise
from app.services.vision import VisionParseError, _compress_screenshot, run_vision

logger = logging.getLogger(__name__)

router = APIRouter()


async def _write_query_log(log_kwargs: dict[str, Any]) -> None:
    """Background task: write QueryLog to DB after the response is sent.

    Runs entirely after the HTTP response has been sent — nothing in the
    hot path waits for this.  Uses its own session from AsyncSessionLocal.

    Args:
        log_kwargs: Keyword arguments passed directly to QueryLog().
    """
    async with AsyncSessionLocal() as session:
        log = QueryLog(**log_kwargs)
        session.add(log)
        await session.commit()
        logger.info("QueryLog written — id=%s", log.id)


@router.post("", response_model=QueryResponse)
async def query(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(..., description="WebM audio from Electron MediaRecorder"),
    screenshot: str = Form(..., description="Base64-encoded PNG of the full screen"),
    language: str = Form(default="", description="Hover AI language code — defaults to user's saved preference"),
    current_user: User = Depends(get_current_user),
    _session: AsyncSession = Depends(get_session),
) -> QueryResponse:
    """Run the voice-to-guided-steps pipeline with TTS response.

    Hot path (blocks until response is sent):
        1. Resolve language + load voice preference from DB.
        2. Read audio + WAV conversion.
        3. STT (Sahara streaming or Groq Whisper) + screenshot compression concurrently.
        4. Vision pipeline (Groq multimodal or local two-step fallback).
        5. TTS (Sahara for African languages, Groq Orpheus for en/fr).
        6. Return response.

    Background (fires after response, non-blocking):
        • Write QueryLog to DB.

    Raises:
        HTTPException 422: STT returned empty transcript.
        HTTPException 502: Vision LLM failed after all retries.
    """
    # ── 1. Resolve language + load voice preference ───────────────────────────
    # Language priority: form field (client override) → user's saved preference
    from sqlmodel import select  # noqa: PLC0415
    effective_language = language.strip() or current_user.language or "en-pidgin"

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

    # ── 3. STT + screenshot compression + conversation history concurrently ───
    loop = asyncio.get_event_loop()
    (stt_result, compressed_b64, conv_ctx) = await asyncio.gather(
        run_stt(audio_bytes, wav_bytes, effective_language),
        loop.run_in_executor(None, _compress_screenshot, screenshot),
        get_or_create_conversation(current_user.id),
    )

    if not stt_result.transcript:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Speech recognition failed — STT returned an empty transcript.",
        )

    # ── 4. Vision pipeline ────────────────────────────────────────────────────
    try:
        vision_result = await run_vision(
            screenshot,
            stt_result.transcript,
            effective_language,
            compressed_b64=compressed_b64,
            history=conv_ctx.recent_messages or None,
            rolling_summary=conv_ctx.rolling_summary,
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
    # Sahara TTS is primary for African languages (authentic voice).
    # Groq Orpheus is primary for en/fr, and fallback when Sahara fails.
    speech_b64 = ""
    if settings.tts_enabled:
        use_sahara = settings.sahara_tts_enabled and effective_language in SAHARA_VOICE_MAP
        if use_sahara:
            speech_b64, _ = await synthesise_sahara(
                vision_result.summary, effective_language, voice_gender=voice_gender
            )
            if not speech_b64:
                logger.warning(
                    "Sahara TTS failed for language=%s — falling back to Groq Orpheus",
                    effective_language,
                )
                speech_b64, _ = await synthesise(vision_result.summary, voice=tts_voice)
        else:
            speech_b64, _ = await synthesise(vision_result.summary, voice=tts_voice)

    # ── 6. Return response (DB writes happen after this) ─────────────────────
    steps_list = [s.model_dump() for s in vision_result.steps]
    background_tasks.add_task(
        _write_query_log,
        {
            "user_id": current_user.id,
            "language_used": effective_language,
            "transcript_whisper": stt_result.transcript,
            "whisper_latency_ms": stt_result.whisper_latency_ms,
            "vision_response": {"summary": vision_result.summary, "steps": steps_list},
            "beacon_steps": steps_list,
        },
    )
    background_tasks.add_task(
        save_turn,
        current_user.id,
        conv_ctx.conversation_id,
        stt_result.transcript,
        vision_result.summary,
    )

    return QueryResponse(
        transcript=stt_result.transcript,
        steps=vision_result.steps,
        summary=vision_result.summary,
        speech_b64=speech_b64,
        conversation_id=conv_ctx.conversation_id,
    )
