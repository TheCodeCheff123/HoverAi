"""Speech-to-text pipeline — three concurrent engines.

Runs Groq Whisper (benchmark #2) and HuggingFace AfriSpeech Whisper
(benchmark #3) concurrently in-request using asyncio.gather.

Intron Sahara (primary) is split into two steps so the route returns
fast (~10-15 s) rather than blocking for the 2-3 min Sahara poll:

  _sahara_upload  -- uploads audio, returns file_id in ~1-2 s.
                     Called inside the request before the response.
  _sahara_poll    -- polls until FILE_TRANSCRIBED (2-3 min).
                     Called by a FastAPI BackgroundTask after the
                     response is already sent to the client.

Language code mapping (confirmed from https://docs.voice.intron.io):

  Hover AI code  |  Sahara / Intron  |  Notes
  en-pidgin      |  pcm              |  Nigerian Pidgin
  yo             |  yo               |  Yoruba-English
  ha             |  ha               |  Hausa-English
  ig             |  ig               |  Igbo-English
  fr             |  fr               |  French
  en             |  en               |  English
"""

import asyncio
import io
import logging
import time

import httpx
from openai import AsyncOpenAI

from app.config import settings
from app.schemas.stt import STTResult

logger = logging.getLogger(__name__)

# Maps Hover AI language codes → Intron Sahara language codes
# Codes confirmed from https://docs.voice.intron.io
LANGUAGE_MAP: dict[str, str] = {
    "en-pidgin": "pcm",  # Nigerian Pidgin Creole — code-switched
    "yo": "yo",          # Yoruba-English — code-switched
    "ha": "ha",          # Hausa-English — code-switched
    "ig": "ig",          # Igbo-English — code-switched
    "fr": "fr",          # French
    "en": "en",          # English
}

# Groq OpenAI-compatible client — shared across requests (thread-safe)
# max_retries=1 + timeout=15s: Whisper is fast; cap retries to stay within
# ngrok's 30s free-tier window.
_groq_client = AsyncOpenAI(
    api_key=settings.groq_api_key,
    base_url="https://api.groq.com/openai/v1",
    max_retries=1,
    timeout=15.0,
)


def _sahara_language(hover_lang: str) -> str:
    """Map a Hover AI language code to the Intron Sahara language code.

    Falls back to ``"en"`` for any unrecognised code so the request still
    proceeds rather than failing hard.

    Args:
        hover_lang: Language code used by the Hover AI front-end.

    Returns:
        The corresponding Intron Sahara language code string.
    """
    return LANGUAGE_MAP.get(hover_lang, "en")


async def _sahara_upload(audio_bytes: bytes, language: str) -> tuple[str | None, int]:
    """Upload audio to Intron Sahara and return the file_id (fast step).

    Only performs the upload — does not poll. Completes in ~1-2 s so it
    can run inside the request/response cycle without blocking the client.

    WebM is submitted directly — no format conversion needed for Sahara.

    Args:
        audio_bytes: Raw audio bytes (WebM or any Sahara-supported format).
        language: Hover AI language code (mapped to Sahara code internally).

    Returns:
        A tuple of ``(file_id, elapsed_ms)``.  ``file_id`` is ``None`` when
        the upload fails so the caller can skip the background poll.
    """
    start = time.monotonic()
    sahara_lang = _sahara_language(language)

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            upload_resp = await client.post(
                f"{settings.intron_stt_base_url}/file/v1/upload",
                headers={"Authorization": f"Bearer {settings.intron_api_key}"},
                files={"audio_file_blob": ("audio.webm", audio_bytes, "audio/webm")},
                data={
                    "audio_file_name": "hover_query",
                    "use_language_asr_input": sahara_lang,
                },
            )
            upload_resp.raise_for_status()
            upload_data = upload_resp.json()

            if upload_data.get("status") != "Ok":
                logger.error("Sahara upload failed: %s", upload_data)
                return (None, int((time.monotonic() - start) * 1000))

            file_id: str = upload_data["data"]["file_id"]
            elapsed = int((time.monotonic() - start) * 1000)
            logger.debug("Sahara upload OK in %dms — file_id: %s", elapsed, file_id)
            return (file_id, elapsed)

    except Exception as exc:
        elapsed = int((time.monotonic() - start) * 1000)
        logger.error("Sahara upload error: %s", exc, exc_info=True)
        return (None, elapsed)


async def _sahara_poll(file_id: str) -> tuple[str, int]:
    """Poll Intron Sahara until transcription completes (slow step).

    Runs as a FastAPI BackgroundTask after the HTTP response has already
    been returned to the client.  Polls every
    ``settings.sahara_poll_interval_s`` seconds for up to
    ``settings.sahara_poll_timeout_s`` seconds.

    Args:
        file_id: The Sahara ``file_id`` returned by ``_sahara_upload``.

    Returns:
        A tuple of ``(transcript, elapsed_ms)``.  ``transcript`` is an
        empty string when the job fails or times out.
    """
    start = time.monotonic()

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            deadline = time.monotonic() + settings.sahara_poll_timeout_s

            while time.monotonic() < deadline:
                await asyncio.sleep(settings.sahara_poll_interval_s)

                status_resp = await client.get(
                    f"{settings.intron_stt_base_url}/file/v1/status/{file_id}",
                    headers={"Authorization": f"Bearer {settings.intron_api_key}"},
                )
                status_resp.raise_for_status()
                status_data = status_resp.json()
                job_status: str = status_data.get("data", {}).get("status", "")

                logger.debug(
                    "Sahara poll — file_id: %s status: %s",
                    file_id,
                    job_status,
                )

                if job_status == "FILE_TRANSCRIBED":
                    data = status_data.get("data", {})
                    # Confirm the exact field name once tested with a real API key.
                    # Common candidates: data.transcription | data.transcript | data.text
                    transcript: str = (
                        data.get("transcription")
                        or data.get("transcript")
                        or data.get("text")
                        or ""
                    )
                    elapsed = int((time.monotonic() - start) * 1000)
                    logger.info(
                        "Sahara poll complete in %dms — file_id: %s",
                        elapsed,
                        file_id,
                    )
                    return (transcript, elapsed)

                if job_status == "FILE_PROCESSING_FAILED":
                    logger.error(
                        "Sahara transcription failed — file_id=%s: %s",
                        file_id,
                        status_data,
                    )
                    return ("", int((time.monotonic() - start) * 1000))

            # Timed out
            logger.error(
                "Sahara poll timed out after %.1fs — file_id=%s",
                settings.sahara_poll_timeout_s,
                file_id,
            )
            return ("", int((time.monotonic() - start) * 1000))

    except Exception as exc:
        elapsed = int((time.monotonic() - start) * 1000)
        logger.error("Sahara poll error: %s", exc, exc_info=True)
        return ("", elapsed)


# ISO 639-1 codes that Groq Whisper explicitly supports.
# African codes not in this set (ig, pcm) must be omitted — Whisper
# auto-detects the language and handles them correctly without a hint.
_GROQ_WHISPER_SUPPORTED: frozenset[str] = frozenset([
    "en", "fr", "de", "es", "pt", "it", "nl", "pl", "ru", "zh",
    "ja", "ko", "ar", "hi", "bn", "ur", "fa", "tr", "vi", "th",
    "id", "ms", "yo", "ha",
])


async def _call_groq_whisper(wav_bytes: bytes, language: str) -> tuple[str, int]:
    """Transcribe audio using Groq Whisper (benchmark #2).

    Uses Groq's OpenAI-compatible API endpoint. The audio must be in WAV
    format — convert from WebM first using ``audio.convert_to_wav()``.

    The ``language`` hint is only passed when it is a code Whisper supports.
    Unsupported African codes (``ig``, ``pcm``) are omitted so Whisper
    auto-detects the language and avoids a 400 ``invalid_language`` error.

    Args:
        wav_bytes: WAV audio bytes at 16 kHz mono (output of convert_to_wav).
        language: Hover AI language code (e.g. ``"ig"``, ``"en-pidgin"``).

    Returns:
        A tuple of ``(transcript, elapsed_ms)``.
        Returns ``("", elapsed_ms)`` on any failure.
    """
    start = time.monotonic()

    # Map to ISO 639-1 then check support — unsupported → None (auto-detect)
    _iso = LANGUAGE_MAP.get(language, "en")
    whisper_lang: str | None = _iso if _iso in _GROQ_WHISPER_SUPPORTED else None

    try:
        if whisper_lang is not None:
            response = await _groq_client.audio.transcriptions.create(
                model=settings.whisper_model,
                file=("audio.wav", wav_bytes, "audio/wav"),
                language=whisper_lang,
            )
        else:
            # Omit language entirely — Whisper auto-detects unsupported codes
            response = await _groq_client.audio.transcriptions.create(
                model=settings.whisper_model,
                file=("audio.wav", wav_bytes, "audio/wav"),
            )
        elapsed = int((time.monotonic() - start) * 1000)
        transcript = response.text if hasattr(response, "text") else str(response)
        logger.info("Groq Whisper transcription complete in %dms", elapsed)
        return (transcript, elapsed)
    except Exception as exc:
        elapsed = int((time.monotonic() - start) * 1000)
        logger.error("Groq Whisper STT error: %s", exc, exc_info=True)
        return ("", elapsed)


# Hard cap on HF inference — free-tier cold starts can take 20-40 s.
# If HF hasn't responded within this budget the result is discarded and
# an empty transcript is returned so the rest of the pipeline isn't gated.
_HF_TIMEOUT_S: float = 8.0


async def _call_hf_afrispeech(wav_bytes: bytes, language: str) -> tuple[str, int]:  # noqa: ARG001
    """Transcribe audio using HuggingFace Inference API (benchmark #3).

    Calls the HuggingFace free serverless Inference API for the model
    configured in ``settings.hf_asr_model`` (default: ``openai/whisper-large-v3``).

    The call is capped at ``_HF_TIMEOUT_S`` seconds.  HF free-tier models
    cold-start in 20–40 s which would gate the entire pipeline.  Since Groq
    Whisper already provides the primary transcript, HF is benchmark-only and
    an empty result on timeout is acceptable.

    Args:
        wav_bytes: WAV audio bytes at 16 kHz mono (output of convert_to_wav).
        language: Hover AI language code (unused — Whisper auto-detects language).

    Returns:
        A tuple of ``(transcript, elapsed_ms)``.
        Returns ``("", elapsed_ms)`` on timeout or any failure.
    """
    start = time.monotonic()
    url = f"https://router.huggingface.co/hf-inference/models/{settings.hf_asr_model}"

    try:
        async with httpx.AsyncClient(timeout=_HF_TIMEOUT_S) as client:
            response = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {settings.hf_api_key}",
                    "Content-Type": "audio/wav",
                },
                content=wav_bytes,
            )
            response.raise_for_status()
            data = response.json()
            transcript: str = data.get("text", "")
            elapsed = int((time.monotonic() - start) * 1000)
            logger.info("HF AfriSpeech transcription complete in %dms", elapsed)
            return (transcript, elapsed)
    except httpx.TimeoutException:
        elapsed = int((time.monotonic() - start) * 1000)
        logger.warning("HF AfriSpeech timed out after %.1fs — skipping benchmark", _HF_TIMEOUT_S)
        return ("", elapsed)
    except Exception as exc:
        elapsed = int((time.monotonic() - start) * 1000)
        logger.error("HF AfriSpeech STT error: %s", exc, exc_info=True)
        return ("", elapsed)


async def run_stt(audio_bytes: bytes, wav_bytes: bytes, language: str) -> STTResult:
    """Run the fast STT engines concurrently and kick off the Sahara upload.

    Fires Groq Whisper and HuggingFace AfriSpeech simultaneously using
    ``asyncio.gather`` — both complete in ~3-8 s.

    Sahara is split into two phases:
      * Upload (this function): runs after the gather, takes ~1-2 s,
        returns a file_id stored in STTResult.sahara_file_id.
      * Poll (background task in the router): runs after the HTTP
        response is sent; takes 2-3 min on the free-tier queue.

    Args:
        audio_bytes: Raw WebM bytes from Electron MediaRecorder — sent
                     directly to Sahara (no conversion needed).
        wav_bytes: WAV bytes at 16 kHz mono — used for Groq Whisper and
                   HuggingFace AfriSpeech (produced by convert_to_wav).
        language: Hover AI language code (e.g. ``"en-pidgin"``).

    Returns:
        An STTResult with Groq + HF transcripts set, transcript empty
        (filled later by background task), and sahara_file_id set when
        the upload succeeded.
    """
    # ── Fast engines — concurrent ─────────────────────────────────────────
    (whisper_text, whisper_ms), (hf_text, hf_ms) = await asyncio.gather(
        _call_groq_whisper(wav_bytes, language),
        _call_hf_afrispeech(wav_bytes, language),
    )

    # ── Sahara upload — fast (~1-2 s), must finish before we respond ──────
    file_id, _upload_ms = await _sahara_upload(audio_bytes, language)

    return STTResult(
        transcript="",          # filled by sahara_poll_and_update background task
        sahara_file_id=file_id, # None when upload failed — poll will be skipped
        sahara_latency_ms=None, # filled by background task
        transcript_whisper=whisper_text,
        whisper_latency_ms=whisper_ms,
        transcript_afrispeech=hf_text,
        afrispeech_latency_ms=hf_ms,
    )
