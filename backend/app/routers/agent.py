"""Agent routes — POST /api/v1/agent/start and /api/v1/agent/turn.

These endpoints power the multi-turn agentic loop.  The Electron overlay
calls /agent/start once (with the voice transcript + initial screenshot),
executes the returned action, takes a new screenshot, then calls
/agent/turn with the result.  This repeats until done=True.

Both routes accept multipart/form-data (same encoding as /query) so the
Electron main process can build requests the same way for both endpoints.
"""

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth import get_current_user
from app.db import get_session
from app.models.models import User, UserSettings
from app.schemas.agent import AgentResponse
from app.schemas.users import VOICE_GENDER_MAP
from app.services.agent import MAX_AGENT_TURNS, agent_start, agent_turn
from app.services.audio import AudioConversionError, convert_to_wav
from app.services.stt import run_stt

logger = logging.getLogger(__name__)

router = APIRouter()


async def _get_tts_voice(current_user: User, session: AsyncSession) -> str:
    """Resolve the TTS voice for the current user's gender preference.

    Args:
        current_user: Authenticated user.
        session: Async database session.

    Returns:
        Orpheus voice identifier string (e.g. ``"autumn"`` or ``"daniel"``).
    """
    result = await session.execute(
        select(UserSettings).where(UserSettings.user_id == current_user.id)
    )
    user_settings = result.scalar_one_or_none()
    voice_gender = getattr(user_settings, "voice_gender", "female") if user_settings else "female"
    return VOICE_GENDER_MAP.get(voice_gender, "autumn")


@router.post("/start", response_model=AgentResponse)
async def agent_start_route(
    audio: UploadFile = File(..., description="WebM audio from Electron MediaRecorder"),
    screenshot: str = Form(..., description="Base64-encoded PNG of the full screen"),
    language: str = Form(default="en-pidgin", description="Hover AI language code"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AgentResponse:
    """Start a new agent session.

    Accepts a WebM audio recording and the current screenshot as
    multipart/form-data — the same encoding the /query route uses so the
    Electron main process can reuse the same request builder.

    Transcribes the audio via Groq Whisper, then starts an agent session.
    Returns the first action for the overlay to execute, a spoken reply,
    and a session_id to carry forward to /agent/turn.

    The overlay should:
      1. Execute ``response.action`` (click, key, type, etc.)
      2. Wait 600 ms for the OS to process the action
      3. Take a new screenshot
      4. POST to /agent/turn with session_id + new screenshot + action_result

    Args:
        audio: WebM audio file from Electron MediaRecorder.
        screenshot: Base64-encoded PNG of the screen at query time.
        language: Hover AI language code (e.g. ``"en-pidgin"``).
        current_user: Authenticated user from JWT.
        session: Database session for settings lookup.

    Returns:
        ``AgentResponse`` with the first action and ``done=False``.

    Raises:
        HTTPException 422: If STT returned an empty transcript.
        HTTPException 502: If the LLM call fails.
    """
    tts_voice = await _get_tts_voice(current_user, session)

    # ── Transcribe audio (same pipeline as /query) ────────────────────────────
    audio_bytes = await audio.read()
    try:
        wav_bytes = convert_to_wav(audio_bytes)
    except AudioConversionError as exc:
        logger.error("Agent audio conversion failed: %s", exc)
        wav_bytes = b""

    stt_result = await run_stt(audio_bytes, wav_bytes, language)
    transcript = stt_result.transcript

    if not transcript.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Speech recognition returned empty transcript — please try again.",
        )

    try:
        return await agent_start(
            transcript=transcript,
            screenshot_b64=screenshot,
            language=language,
            tts_voice=tts_voice,
        )
    except Exception as exc:
        logger.error("agent_start failed: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Agent failed to start — please try again.",
        )


@router.post("/turn", response_model=AgentResponse)
async def agent_turn_route(
    session_id: str = Form(..., description="Session ID from /agent/start response"),
    screenshot: str = Form(..., description="Base64-encoded PNG taken after last action"),
    action_result: str = Form(default="success", description="success | no_change | error"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AgentResponse:
    """Continue an existing agent session after an action was executed.

    The overlay calls this after executing each action.  It sends the new
    screenshot and whether the action appeared to succeed.

    The agent looks at the new screenshot, decides if the goal is achieved,
    and returns the next action — or ``done=True`` when finished.

    Overlay behaviour on receiving the response:
      - If ``done=False``: execute action, wait 600 ms, screenshot, call /turn again
      - If ``done=True``: play speech_b64, show summary, close overlay

    Args:
        session_id: Session ID from the /agent/start response.
        screenshot: Base64 PNG of the screen after the last action executed.
        action_result: ``"success"``, ``"no_change"``, or ``"error"``.
        current_user: Authenticated user from JWT.
        session: Database session for settings lookup.

    Returns:
        ``AgentResponse`` with the next action or ``done=True``.

    Raises:
        HTTPException 404: If the session_id is not found or has expired.
        HTTPException 502: If the LLM call fails.
    """
    tts_voice = await _get_tts_voice(current_user, session)

    try:
        return await agent_turn(
            session_id=session_id,
            screenshot_b64=screenshot,
            action_result=action_result,
            tts_voice=tts_voice,
        )
    except KeyError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"Agent session '{session_id}' not found or expired. "
                "Sessions expire after 5 minutes of inactivity. "
                "Please start a new session."
            ),
        )
    except Exception as exc:
        logger.error("agent_turn failed: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Agent turn failed — please try again.",
        )


@router.get("/info", tags=["agent"])
async def agent_info() -> dict[str, object]:
    """Return agent configuration constants.

    Useful for the Electron overlay to know the max turns before giving up.

    Returns:
        Dict with ``max_turns`` and ``session_ttl_s``.
    """
    from app.services.agent import SESSION_TTL_S  # noqa: PLC0415
    return {
        "max_turns": MAX_AGENT_TURNS,
        "session_ttl_s": SESSION_TTL_S,
    }
