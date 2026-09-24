"""Translation helper — NLLB Space (free) with Groq LLM fallback.

Primary path: public NLLB-200 HuggingFace Space
  Endpoint: https://winstxnhdw-nllb-api.hf.space/api/v4/translator
  No API key required. Supports 200 languages including all major African ones.
  Timeout: 8s — free Space can cold-start; falls back to LLM if slow.

Fallback path: Groq LLM (qwen3.8-27b)
  A strict single-output prompt that returns only the translation.
  Uses the shared groq_client from llm_client.py — no extra client needed.

FLORES-200 codes used by NLLB:
  yo  → yor_Latn   Yoruba
  ha  → hau_Latn   Hausa
  ig  → ibo_Latn   Igbo
  pcm → pcm_Latn   Nigerian Pidgin Creole
  sw  → swh_Latn   Swahili
  zu  → zul_Latn   Zulu
  en  → eng_Latn   English
  fr  → fra_Latn   French
"""

import logging

import httpx

from app.config import settings
from app.services.llm_client import groq_client

logger = logging.getLogger(__name__)

# Maps Hover AI language codes → FLORES-200 codes used by NLLB-200.
# FLORES codes confirmed from the NLLB-200 model card.
FLORES_CODES: dict[str, str] = {
    "en":        "eng_Latn",
    "en-pidgin": "pcm_Latn",  # Nigerian Pidgin Creole
    "yo":        "yor_Latn",
    "ha":        "hau_Latn",
    "ig":        "ibo_Latn",
    "af":        "afr_Latn",
    "am":        "amh_Ethi",
    "rw":        "kin_Latn",
    "lg":        "lug_Latn",
    "om":        "gaz_Latn",  # Borana-Arsi-Guji Oromo
    "sn":        "sna_Latn",
    "sw":        "swh_Latn",
    "wo":        "wol_Latn",
    "zu":        "zul_Latn",
    "fr":        "fra_Latn",
}

# Human-readable names used in the LLM fallback prompt
LANG_NAMES: dict[str, str] = {
    "en":        "English",
    "en-pidgin": "Nigerian Pidgin",
    "yo":        "Yoruba",
    "ha":        "Hausa",
    "ig":        "Igbo",
    "af":        "Afrikaans",
    "am":        "Amharic",
    "rw":        "Kinyarwanda",
    "lg":        "Luganda",
    "om":        "Oromo",
    "sn":        "Shona",
    "sw":        "Swahili",
    "wo":        "Wolof",
    "zu":        "Zulu",
    "fr":        "French",
}

_NLLB_URL = "https://winstxnhdw-nllb-api.hf.space/api/v4/translator"
_NLLB_TIMEOUT_S: float = 8.0


def _to_flores(code: str) -> str:
    """Normalise a language code to FLORES-200 format.

    Passes through codes that are already in FLORES format (contain ``_``),
    otherwise looks up the mapping and falls back to ``eng_Latn``.

    Args:
        code: Hover AI language code (e.g. ``"yo"``) or FLORES code.

    Returns:
        FLORES-200 language code string.
    """
    if "_" in code:
        return code  # already a FLORES code
    return FLORES_CODES.get(code, "eng_Latn")


async def _try_nllb(text: str, source_flores: str, target_flores: str) -> str | None:
    """Attempt translation via the public NLLB HuggingFace Space.

    Args:
        text: Text to translate.
        source_flores: FLORES-200 source language code.
        target_flores: FLORES-200 target language code.

    Returns:
        Translated string, or ``None`` if the request fails or times out.
    """
    try:
        async with httpx.AsyncClient(timeout=_NLLB_TIMEOUT_S) as client:
            resp = await client.get(
                _NLLB_URL,
                params={
                    "text": text,
                    "source": source_flores,
                    "target": target_flores,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            # Response shape: {"translatedText": "..."} or {"translation": "..."}
            result: str = (
                data.get("translatedText")
                or data.get("translation")
                or ""
            )
            if result.strip():
                logger.info(
                    "NLLB translation OK — %s → %s (%d chars)",
                    source_flores, target_flores, len(result),
                )
                return result.strip()
            logger.warning("NLLB returned empty translation — will fall back to LLM")
            return None

    except httpx.TimeoutException:
        logger.warning(
            "NLLB timed out after %.1fs — falling back to LLM", _NLLB_TIMEOUT_S
        )
        return None
    except Exception as exc:
        logger.warning("NLLB error: %s — falling back to LLM", exc)
        return None


async def _try_llm(text: str, source: str, target: str) -> str:
    """Translate via Groq LLM (qwen3.8-27b) as fallback.

    Uses a strict prompt that returns only the translation — no explanations,
    no quotes, no markdown.

    Args:
        text: Text to translate.
        source: Hover AI language code for the source language.
        target: Hover AI language code for the target language.

    Returns:
        Translated string. Returns the original ``text`` on any failure so
        the caller always gets something usable.
    """
    source_name = LANG_NAMES.get(source, source)
    target_name = LANG_NAMES.get(target, target)

    prompt = (
        f"Translate the following text from {source_name} to {target_name}.\n"
        f"Output ONLY the translation. No explanations, no quotes, no extra text.\n\n"
        f"Text: {text}"
    )

    try:
        response = await groq_client.chat.completions.create(
            model=settings.vision_model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=512,
            temperature=0.1,
        )
        result = response.choices[0].message.content or ""
        result = result.strip()
        logger.info(
            "LLM translation OK — %s → %s (%d chars)", source_name, target_name, len(result)
        )
        return result or text
    except Exception as exc:
        logger.error("LLM translation error: %s — returning original text", exc)
        return text


async def translate(text: str, source: str, target: str) -> str:
    """Translate text from one language to another.

    Tries the free public NLLB Space first. Falls back to Groq LLM if NLLB
    times out, returns empty, or errors.

    ``source`` and ``target`` can be short Hover AI codes (``"yo"``, ``"ha"``)
    or full FLORES-200 codes (``"yor_Latn"``).

    Args:
        text: Text to translate.
        source: Source language code.
        target: Target language code.

    Returns:
        Translated string. Never raises — returns the original ``text`` on
        complete failure so the caller's pipeline is never blocked.
    """
    if not text.strip():
        return text

    source_flores = _to_flores(source)
    target_flores = _to_flores(target)

    # Skip translation if source and target are the same language
    if source_flores == target_flores:
        return text

    result = await _try_nllb(text, source_flores, target_flores)
    if result is not None:
        return result

    return await _try_llm(text, source, target)
