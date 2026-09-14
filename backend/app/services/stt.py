"""Speech-to-text pipeline — three concurrent engines.

Runs Intron Sahara (primary), Groq Whisper (benchmark #2), and
HuggingFace AfriSpeech Whisper (benchmark #3) concurrently using
asyncio.gather. The Sahara transcript is used downstream for vision;
all three transcripts are stored in query_logs for the benchmark report.

Language code mapping (confirmed from https://docs.voice.intron.io):

  Hover AI code  │  Sahara / Intron  │  Notes
  ───────────────┼───────────────────┼──────────────────────────────
  en-pidgin      │  pcm              │  Nigerian Pidgin — code-switched
  yo             │  yo               │  Yoruba-English — code-switched
  ha             │  ha               │  Hausa-English — code-switched
  ig             │  ig               │  Igbo-English — code-switched
  fr             │  fr               │  French
  en             │  en               │  English
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
_groq_client = AsyncOpenAI(
    api_key=settings.groq_api_key,
    base_url="https://api.groq.com/openai/v1",
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


async def _call_sahara(audio_bytes: bytes, language: str) -> tuple[str, int]:
    """Transcribe audio using the Intron Sahara STT API (async, two-step).

    Step 1: Upload the audio file to the Sahara queue.
    Step 2: Poll the status endpoint until transcription completes.

    WebM is submitted directly — no format conversion needed for Sahara.

    Args:
        audio_bytes: Raw audio bytes (WebM or any Sahara-supported format).
        language: Hover AI language code (mapped to Sahara code internally).

    Returns:
        A tuple of ``(transcript, elapsed_ms)`` where ``transcript`` is the
        recognised text and ``elapsed_ms`` is total wall-clock time in ms.
        Returns ``("", elapsed_ms)`` on any failure so the caller can
        continue with the other engines.
    """
    start = time.monotonic()
    sahara_lang = _sahara_language(language)

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # ── Step 1: upload ────────────────────────────────────────────────
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
                return ("", int((time.monotonic() - start) * 1000))

            file_id: str = upload_data["data"]["file_id"]
            logger.debug("Sahara upload OK — file_id: %s", file_id)

            # ── Step 2: poll until FILE_TRANSCRIBED ───────────────────────────
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
                    "Sahara poll — file_id: %s status: %s full_data: %s",
                    file_id,
                    job_status,
                    status_data,
                )

                if job_status == "FILE_TRANSCRIBED":
                    # TODO: confirm the exact transcript field name from the
                    # Intron docs once tested with a real API key.
                    # Common candidates: data.transcription | data.transcript | data.text
                    data = status_data.get("data", {})
                    transcript: str = (
                        data.get("transcription")
                        or data.get("transcript")
                        or data.get("text")
                        or ""
                    )
                    elapsed = int((time.monotonic() - start) * 1000)
                    logger.info(
                        "Sahara transcription complete in %dms (lang=%s)",
                        elapsed,
                        sahara_lang,
                    )
                    return (transcript, elapsed)

                if job_status == "FILE_PROCESSING_FAILED":
                    logger.error(
                        "Sahara transcription failed for file_id=%s: %s",
                        file_id,
                        status_data,
                    )
                    return ("", int((time.monotonic() - start) * 1000))

            # Timed out
            logger.error(
                "Sahara poll timed out after %.1fs for file_id=%s",
                settings.sahara_poll_timeout_s,
                file_id,
            )
            return ("", int((time.monotonic() - start) * 1000))

    except Exception as exc:
        elapsed = int((time.monotonic() - start) * 1000)
        logger.error("Sahara STT error: %s", exc, exc_info=True)
        return ("", elapsed)


async def _call_groq_whisper(wav_bytes: bytes, language: str) -> tuple[str, int]:
    """Transcribe audio using Groq's whisper-large-v3-turbo (benchmark #2).

    Uses Groq's OpenAI-compatible API endpoint. The audio must be in WAV
    format — convert from WebM first using ``audio.convert_to_wav()``.

    Args:
        wav_bytes: WAV audio bytes at 16 kHz mono (output of convert_to_wav).
        language: Hover AI language code. Mapped to ISO 639-1 for Whisper
                  (``"en-pidgin"`` → ``"en"`` since Whisper has no pcm code).

    Returns:
        A tuple of ``(transcript, elapsed_ms)``.
        Returns ``("", elapsed_ms)`` on any failure.
    """
    start = time.monotonic()
    # Whisper uses ISO 639-1 codes; map pidgin to English since Whisper has
    # no dedicated Pidgin model — it will still transcribe Pidgin speech.
    whisper_lang = "en" if language == "en-pidgin" else LANGUAGE_MAP.get(language, "en")

    try:
        response = await _groq_client.audio.transcriptions.create(
            model=settings.whisper_model,
            file=("audio.wav", wav_bytes, "audio/wav"),
            language=whisper_lang,
        )
        elapsed = int((time.monotonic() - start) * 1000)
        transcript = response.text if hasattr(response, "text") else str(response)
        logger.info("Groq Whisper transcription complete in %dms", elapsed)
        return (transcript, elapsed)
    except Exception as exc:
        elapsed = int((time.monotonic() - start) * 1000)
        logger.error("Groq Whisper STT error: %s", exc, exc_info=True)
        return ("", elapsed)


async def _call_hf_afrispeech(wav_bytes: bytes, language: str) -> tuple[str, int]:  # noqa: ARG001
    """Transcribe audio using HuggingFace Inference API (benchmark #3).

    Calls the HuggingFace free serverless Inference API for the model
    configured in ``settings.hf_asr_model`` (default: ``openai/whisper-large-v3``).

    This gives a third independent latency and accuracy measurement: the same
    Whisper large-v3 weights running on HF's infrastructure rather than Groq's,
    producing a meaningful infrastructure-level comparison for the benchmark.

    Args:
        wav_bytes: WAV audio bytes at 16 kHz mono (output of convert_to_wav).
        language: Hover AI language code (unused — Whisper auto-detects language).

    Returns:
        A tuple of ``(transcript, elapsed_ms)``.
        Returns ``("", elapsed_ms)`` on any failure.
    """
    start = time.monotonic()
    url = f"https://router.huggingface.co/hf-inference/models/{settings.hf_asr_model}"

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
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
            # HuggingFace Inference API returns {"text": "..."} for ASR models
            transcript: str = data.get("text", "")
            elapsed = int((time.monotonic() - start) * 1000)
            logger.info("HF AfriSpeech transcription complete in %dms", elapsed)
            return (transcript, elapsed)
    except Exception as exc:
        elapsed = int((time.monotonic() - start) * 1000)
        logger.error("HF AfriSpeech STT error: %s", exc, exc_info=True)
        return ("", elapsed)


async def run_stt(audio_bytes: bytes, wav_bytes: bytes, language: str) -> STTResult:
    """Run all three STT engines concurrently and return aggregated results.

    Fires Sahara (with raw WebM), Groq Whisper, and HuggingFace AfriSpeech
    simultaneously using ``asyncio.gather``. Each engine is individually
    timed and error-isolated — if one engine fails it returns an empty string
    without affecting the others.

    The Sahara transcript is the authoritative result used downstream for
    vision processing. The other two are benchmark data only.

    Args:
        audio_bytes: Raw WebM bytes from Electron MediaRecorder — sent
                     directly to Sahara (no conversion needed).
        wav_bytes: WAV bytes at 16 kHz mono — used for Groq Whisper and
                   HuggingFace AfriSpeech (produced by convert_to_wav).
        language: Hover AI language code (e.g. ``"en-pidgin"``).

    Returns:
        An ``STTResult`` containing all three transcripts and their latencies.
    """
    (sahara_text, sahara_ms), (whisper_text, whisper_ms), (hf_text, hf_ms) = (
        await asyncio.gather(
            _call_sahara(audio_bytes, language),
            _call_groq_whisper(wav_bytes, language),
            _call_hf_afrispeech(wav_bytes, language),
        )
    )

    return STTResult(
        transcript=sahara_text,
        sahara_latency_ms=sahara_ms,
        transcript_whisper=whisper_text,
        whisper_latency_ms=whisper_ms,
        transcript_afrispeech=hf_text,
        afrispeech_latency_ms=hf_ms,
    )
