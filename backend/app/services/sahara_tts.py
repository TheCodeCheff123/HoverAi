"""Sahara TTS service — African-language text-to-speech via Intron.

Uses Intron Sahara's queue API (enqueue + poll + download) to synthesise
speech in African languages and accents that Groq Orpheus cannot produce.

Confirmed voice map (verified against Sahara /tts/v1/voices endpoint):
  Hover code  voice_language  voice_accent   Language
  ──────────────────────────────────────────────────────────
  en-pidgin   pcm             pidgin         Nigerian Pidgin
  yo          yo              yoruba         Yoruba
  ha          ha              hausa          Hausa
  ig          ig              igbo           Igbo
  af          af              afrikaans      Afrikaans
  am          am              amharic        Amharic
  rw          rw              kinyarwanda    Kinyarwanda
  lg          lg              luganda        Luganda
  om          om              oromo          Oromo
  sn          sn              shona          Shona
  sw          sw              swahili        Swahili
  wo          wo              wolof          Wolof
  zu          en              zulu           Zulu (no native TTS — English voice + Zulu accent)

Note: "en" and "fr" are not in SAHARA_VOICE_MAP — they fall through to
Groq Orpheus TTS which is faster and higher quality for those languages.

Pipeline:
  1. POST /tts/v1/enqueue  → text_id  (~1-2s)
  2. GET  /tts/v1/status/{text_id}  poll until TTS_TEXT_AUDIO_GENERATED  (~2-4s)
  3. GET  audio_path (S3 URL)  → download WAV bytes  (~1-2s)

Total end-to-end: ~5-8s.  This is slower than Groq Orpheus (~1-2s) but
produces an authentic African voice.  The caller decides which to use based
on the selected language.
"""

import asyncio
import base64
import logging
import time

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# Hover AI language code → (voice_language, voice_accent) for Sahara TTS.
# Only languages where Sahara adds value over Groq Orpheus are mapped here.
# "en" falls through to Groq Orpheus (faster, good quality).
SAHARA_VOICE_MAP: dict[str, tuple[str, str]] = {
    "en-pidgin": ("pcm", "pidgin"),
    "yo":        ("yo",  "yoruba"),
    "ha":        ("ha",  "hausa"),
    "ig":        ("ig",  "igbo"),
    "af":        ("af",  "afrikaans"),
    "am":        ("am",  "amharic"),
    "rw":        ("rw",  "kinyarwanda"),
    "lg":        ("lg",  "luganda"),
    "om":        ("om",  "oromo"),
    "sn":        ("sn",  "shona"),
    "sw":        ("sw",  "swahili"),
    "wo":        ("wo",  "wolof"),
    "zu":        ("en",  "zulu"),   # no native zu TTS — English voice + Zulu accent
}

# Maximum seconds to wait for Sahara TTS to finish processing.
# Measured at ~2-4s in testing; 20s gives generous headroom.
_POLL_TIMEOUT_S: float = 20.0
_POLL_INTERVAL_S: float = 1.0


class SaharaTTSError(Exception):
    """Raised when Sahara TTS fails to produce audio."""


async def _enqueue(
    text: str,
    voice_language: str,
    voice_accent: str,
    voice_gender: str,
) -> str:
    """Submit text to the Sahara TTS queue and return the text_id.

    Args:
        text: The text to synthesise.
        voice_language: Sahara language code (e.g. ``"pcm"``).
        voice_accent: Sahara accent code (e.g. ``"pidgin"``).
        voice_gender: ``"female"`` or ``"male"``.

    Returns:
        The ``text_id`` string for polling.

    Raises:
        SaharaTTSError: On HTTP error or unexpected API response shape.
    """
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{settings.intron_stt_base_url}/tts/v1/enqueue",
            headers={"Authorization": f"Bearer {settings.intron_api_key}"},
            json={
                "text": text,
                "voice_language": voice_language,
                "voice_accent": voice_accent,
                "voice_gender": voice_gender,
                "output_audio_format": "wav",
            },
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") != "Ok":
            raise SaharaTTSError(f"Sahara TTS enqueue failed: {data.get('message')}")
        text_id: str = data["data"]["text_id"]
        return text_id


async def _poll_until_ready(text_id: str) -> str:
    """Poll Sahara TTS status until audio is generated and return the S3 URL.

    Args:
        text_id: The ``text_id`` returned by ``_enqueue``.

    Returns:
        The ``audio_path`` URL (public S3 WAV file).

    Raises:
        SaharaTTSError: If the job fails, or times out after ``_POLL_TIMEOUT_S``.
    """
    deadline = time.monotonic() + _POLL_TIMEOUT_S
    async with httpx.AsyncClient(timeout=15.0) as client:
        while time.monotonic() < deadline:
            await asyncio.sleep(_POLL_INTERVAL_S)
            resp = await client.get(
                f"{settings.intron_stt_base_url}/tts/v1/status/{text_id}",
                headers={"Authorization": f"Bearer {settings.intron_api_key}"},
            )
            resp.raise_for_status()
            data = resp.json()
            job_status: str = data.get("data", {}).get("processing_status", "")
            logger.debug("Sahara TTS poll — text_id=%s status=%s", text_id, job_status)

            if job_status == "TTS_TEXT_AUDIO_GENERATED":
                audio_path: str = data["data"]["audio_path"]
                return audio_path

            if "FAIL" in job_status.upper():
                raise SaharaTTSError(f"Sahara TTS job failed — status: {job_status}")

    raise SaharaTTSError(f"Sahara TTS timed out after {_POLL_TIMEOUT_S}s — text_id={text_id}")


async def _download_wav(audio_url: str) -> bytes:
    """Download the generated WAV file from the S3 URL.

    Args:
        audio_url: Public S3 URL returned by ``_poll_until_ready``.

    Returns:
        Raw WAV bytes.

    Raises:
        SaharaTTSError: On HTTP error.
    """
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(audio_url)
        resp.raise_for_status()
        return resp.content


async def synthesise_sahara(
    text: str,
    language: str,
    voice_gender: str = "female",
) -> tuple[str, int]:
    """Synthesise speech using Sahara TTS for African languages.

    Looks up the Sahara voice parameters for the given Hover AI language
    code, runs the full enqueue→poll→download pipeline, and returns the
    result as a base64 WAV string matching the shape of ``tts.synthesise``.

    Returns ``("", elapsed_ms)`` when the language is not in
    ``SAHARA_VOICE_MAP`` (caller should use Groq Orpheus instead) or on
    any error, so the caller can always fall back gracefully.

    Args:
        text: The text to synthesise.
        language: Hover AI language code (e.g. ``"en-pidgin"``).
        voice_gender: ``"female"`` (default) or ``"male"``.

    Returns:
        ``(speech_b64, elapsed_ms)`` — base64 WAV and total round-trip ms.
        Returns ``("", elapsed_ms)`` on any failure or unsupported language.
    """
    start = time.monotonic()

    if not text.strip():
        return ("", 0)

    voice_params = SAHARA_VOICE_MAP.get(language)
    if voice_params is None:
        # Language not in Sahara map — caller should use Groq Orpheus
        return ("", 0)

    voice_language, voice_accent = voice_params

    try:
        text_id = await _enqueue(text, voice_language, voice_accent, voice_gender)
        logger.debug(
            "Sahara TTS enqueued — text_id=%s  lang=%s  accent=%s",
            text_id, voice_language, voice_accent,
        )

        audio_url = await _poll_until_ready(text_id)
        wav_bytes = await _download_wav(audio_url)

        speech_b64 = base64.b64encode(wav_bytes).decode()
        elapsed = int((time.monotonic() - start) * 1000)
        logger.info(
            "Sahara TTS complete in %dms — lang=%s accent=%s %d bytes",
            elapsed, voice_language, voice_accent, len(wav_bytes),
        )
        return (speech_b64, elapsed)

    except Exception as exc:
        elapsed = int((time.monotonic() - start) * 1000)
        logger.error("Sahara TTS error: %s", exc, exc_info=True)
        return ("", elapsed)
