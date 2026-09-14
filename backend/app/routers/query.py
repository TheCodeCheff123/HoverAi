"""Query route — POST /api/v1/query.

The main feature endpoint. Accepts audio + screenshot from Electron,
runs three STT engines concurrently, passes the transcript and screenshot
to the vision LLM, synthesises the summary to speech via TTS, logs
everything to query_logs, and returns beacon steps + audio to the overlay.
"""

import asyncio
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth import get_current_user
from app.config import settings
from app.db import get_session
from app.models.models import QueryLog, User, UserSettings
from app.schemas.query import BenchmarkResult, QueryResponse
from app.schemas.users import VOICE_GENDER_MAP
from app.services.audio import AudioConversionError, convert_to_wav
from app.services.stt import run_stt
from app.services.tts import synthesise
from app.services.vision import VisionParseError, run_vision

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("", response_model=QueryResponse)
async def query(
    audio: UploadFile = File(..., description="WebM audio from Electron MediaRecorder"),
    screenshot: str = Form(..., description="Base64-encoded PNG of the full screen"),
    language: str = Form(default="en-pidgin", description="Hover AI language code"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> QueryResponse:
    """Run the full voice-to-beacon-steps pipeline with TTS response.

    Accepts a WebM audio recording and a base64 screenshot from the Electron
    overlay, runs three STT engines concurrently, passes the transcript and
    screenshot to the Groq vision LLM, synthesises the summary to speech via
    Groq Orpheus TTS, logs all data to ``query_logs``, and returns structured
    beacon steps plus a base64 WAV for audio playback.

    Pipeline:
        1. Read audio bytes from the uploaded file.
        2. Convert to WAV (for Groq Whisper and HuggingFace AfriSpeech).
        3. Run all three STT engines concurrently (asyncio.gather).
        4. Run vision LLM to get beacon steps + summary text.
        5. Run TTS on the summary concurrently with DB write.
        6. Insert benchmark data into query_logs.
        7. Return QueryResponse with beacon steps and speech audio.

    Args:
        audio: Uploaded audio file from Electron's MediaRecorder (WebM/WAV).
        screenshot: Base64-encoded PNG of the full screen at query time.
        language: Hover AI language code (e.g. ``"en-pidgin"``).
        current_user: Authenticated ``User`` injected by ``get_current_user``.
        session: Async database session injected by ``get_session``.

    Returns:
        A ``QueryResponse`` with transcript, beacon steps, summary, base64
        WAV speech audio, and benchmark latency data from all three engines.

    Raises:
        HTTPException 422: If all three STT engines returned empty transcripts.
        HTTPException 502: If the vision LLM fails after retry.
    """
    # ── 0. Load user's voice preference from settings ─────────────────────────
    settings_result = await session.execute(
        select(UserSettings).where(UserSettings.user_id == current_user.id)
    )
    user_settings = settings_result.scalar_one_or_none()
    voice_gender = getattr(user_settings, "voice_gender", "female") if user_settings else "female"
    tts_voice = VOICE_GENDER_MAP.get(voice_gender, "autumn")

    # ── 1. Read audio bytes ───────────────────────────────────────────────────
    audio_bytes = await audio.read()

    # ── 2. Convert to WAV for Whisper engines ─────────────────────────────────
    # Sahara accepts the original bytes directly — WAV only needed for Groq + HF.
    try:
        wav_bytes = convert_to_wav(audio_bytes)
    except AudioConversionError as exc:
        logger.error("Audio conversion failed: %s", exc)
        wav_bytes = b""

    # ── 3. Run all three STT engines concurrently ─────────────────────────────
    stt_result = await run_stt(audio_bytes, wav_bytes, language)

    if not any([
        stt_result.transcript,
        stt_result.transcript_whisper,
        stt_result.transcript_afrispeech,
    ]):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Speech recognition failed — all three engines returned empty results.",
        )

    # Fall back to the best available transcript if Sahara failed
    primary_transcript = (
        stt_result.transcript
        or stt_result.transcript_whisper
        or stt_result.transcript_afrispeech
    )

    # ── 4. Vision LLM ─────────────────────────────────────────────────────────
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

    # ── 5. TTS — synthesise summary concurrently with DB write ────────────────
    # TTS and DB flush are independent — run them at the same time to save
    # ~300-500ms. TTS failure returns ("", 0) and never blocks the response.
    steps_list = [s.model_dump() for s in vision_result.steps]
    vision_dict = {"summary": vision_result.summary, "steps": steps_list}

    log = QueryLog(
        user_id=current_user.id,
        language_used=language,
        transcript_sahara=stt_result.transcript,
        sahara_latency_ms=stt_result.sahara_latency_ms,
        transcript_whisper=stt_result.transcript_whisper,
        whisper_latency_ms=stt_result.whisper_latency_ms,
        transcript_afrispeech=stt_result.transcript_afrispeech,
        afrispeech_latency_ms=stt_result.afrispeech_latency_ms,
        vision_response=vision_dict,  # type: ignore[arg-type]
        beacon_steps=steps_list,      # type: ignore[arg-type]
    )
    session.add(log)

    async def _tts_disabled() -> tuple[str, int]:
        return ("", 0)

    tts_coro = synthesise(vision_result.summary, voice=tts_voice) if settings.tts_enabled else _tts_disabled()

    (speech_b64, tts_ms), _ = await asyncio.gather(
        tts_coro,
        session.flush(),
    )

    # ── 6. Return response ────────────────────────────────────────────────────
    return QueryResponse(
        transcript=primary_transcript,
        steps=vision_result.steps,
        summary=vision_result.summary,
        speech_b64=speech_b64,
        benchmark=BenchmarkResult(
            sahara_ms=stt_result.sahara_latency_ms,
            whisper_ms=stt_result.whisper_latency_ms,
            afrispeech_ms=stt_result.afrispeech_latency_ms,
            tts_ms=tts_ms,
            transcript_whisper=stt_result.transcript_whisper,
            transcript_afrispeech=stt_result.transcript_afrispeech,
        ),
    )
