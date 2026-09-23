"""Vision pipeline — transcript → beacon steps.

Uses Groq qwen/qwen3.8-27b (multimodal, free tier) via the OpenAI-compatible
API to identify UI elements from a screenshot + voice transcript.

The screenshot is compressed to 512×288 JPEG at 35% quality before sending.
This keeps the image token count to ~1,100–1,450, well under the 7,000 ITPM
free-tier limit. The image is passed as a proper vision content block
(type: image_url with a data: URI) — NOT as raw base64 text in the message
string, which would be read as characters rather than decoded as an image.

Previous failure mode: the image was embedded as plain text in the content
string — Qwen3 read the literal base64 characters, spending ~9,966 tokens
with zero visual understanding, which caused the 413 ITPM error.
"""

import base64
import io
import json
import logging
import re

import openai

from app.config import settings
from app.schemas.vision import BeaconStep, VisionResult
from app.services.llm_client import active_vision_model, groq_client, vision_client

logger = logging.getLogger(__name__)

# Compression targets.
# We need to balance two competing constraints:
#   1. Stay under Groq's 7,000 ITPM free-tier limit.
#   2. Preserve enough detail for Qwen3 to pinpoint small UI elements (icons,
#      buttons) that may be 32–64 px on a 1920×1080 display.
#
# At 512×288 a desktop icon becomes a ~17×17 blob — too small for accurate
# centre estimation.  Bumping to 768×432 keeps each icon ~21×21 px which
# meaningfully improves hit rate.  Token cost rises to ~2,000–2,500 leaving
# ~4,500 tokens headroom — still comfortably under the 7k cap.
_MAX_WIDTH = 768
_MAX_HEIGHT = 432
_JPEG_QUALITY = 40


def _compress_screenshot(screenshot_b64: str) -> str:
    """Resize and JPEG-compress a base64 screenshot to reduce token count.

    Strips any data URI prefix, decodes the image, resizes it to fit within
    ``_MAX_WIDTH`` × ``_MAX_HEIGHT`` while preserving aspect ratio, then
    re-encodes it as JPEG at ``_JPEG_QUALITY``% quality.

    Args:
        screenshot_b64: Base64-encoded PNG or JPEG, with or without a
                        ``data:image/...;base64,`` prefix.

    Returns:
        A plain base64 string (no data URI prefix) of the compressed JPEG.
        Returns the original string unchanged if any error occurs.
    """
    try:
        from PIL import Image  # local import — only needed here

        raw = screenshot_b64
        if "," in raw:
            raw = raw.split(",", 1)[1]

        img_bytes = base64.b64decode(raw)
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        img.thumbnail((_MAX_WIDTH, _MAX_HEIGHT), Image.Resampling.LANCZOS)

        out = io.BytesIO()
        img.save(out, format="JPEG", quality=_JPEG_QUALITY, optimize=True)
        compressed = base64.b64encode(out.getvalue()).decode()

        logger.debug(
            "Screenshot compressed: %dkB → %dkB (%dx%d)",
            len(raw) * 3 // 4 // 1024,
            len(out.getvalue()) // 1024,
            img.width,
            img.height,
        )
        return compressed

    except Exception as exc:
        logger.warning("Screenshot compression failed, using original: %s", exc)
        if "," in screenshot_b64:
            return screenshot_b64.split(",", 1)[1]
        return screenshot_b64


# Per-language instructions injected into the system prompt.
# Key: Hover AI language code.  Value: (label, tone_instruction, summary_example)
#   label            — human-readable name shown to the model
#   tone_instruction — exact register/dialect the model must write in
#   summary_example  — a one-sentence example summary in that language/dialect
_LANGUAGE_CONFIGS: dict[str, tuple[str, str, str]] = {
    "en-pidgin": (
        "Nigerian Pidgin English",
        (
            "Write ALL text in warm, natural Nigerian Pidgin English — the way a helpful "
            "Lagos friend would explain things. Use pidgin vocabulary and rhythm: "
            "'You don click am', 'Abeg click here', 'E go work', 'Make you', 'I don see am', "
            "'Na so e dey work', 'Click the thing wey dey on top'. "
            "Mix in everyday English words for technical terms (Excel, button, menu) but "
            "keep the sentence structure and feel as pidgin. Never switch to formal English."
        ),
        "I don see your Excel spreadsheet! Make I show you how to do am.",
    ),
    "yo": (
        "Yoruba",
        (
            "Write ALL text in Yoruba. Use clear, natural Yoruba as a helpful friend would speak. "
            "Technical terms (Excel, button, menu, click) may remain in English since they have "
            "no standard Yoruba equivalents — but all other text must be in Yoruba."
        ),
        "Mo ti ri iwe-iṣiro Excel rẹ! Jẹ́ kí n ṣe àlàyé bí o ṣe lè ṣe é.",
    ),
    "ha": (
        "Hausa",
        (
            "Write ALL text in Hausa. Use clear, natural Hausa as a helpful friend would speak. "
            "Technical terms (Excel, button, menu, click) may remain in English since they have "
            "no standard Hausa equivalents — but all other text must be in Hausa."
        ),
        "Na ga takarda Excel ɗinka! Bari in nuna maka yadda za ka yi shi.",
    ),
    "ig": (
        "Igbo",
        (
            "Write ALL text in Igbo. Use clear, natural Igbo as a helpful friend would speak. "
            "Technical terms (Excel, button, menu, click) may remain in English since they have "
            "no standard Igbo equivalents — but all other text must be in Igbo."
        ),
        "Ahụrụ m ihe Excel gị! Ka m gọọ gị otú esi eme ya.",
    ),
    "fr": (
        "French",
        "Write ALL text in French. Use clear, warm, natural French.",
        "Je vois votre feuille Excel ! Voici comment procéder.",
    ),
    "en": (
        "English",
        "Write ALL text in clear, warm, natural English.",
        "I can see your Excel spreadsheet! Here's how to do it.",
    ),
}

_DEFAULT_LANGUAGE_CONFIG = _LANGUAGE_CONFIGS["en"]


def _build_system_prompt(language: str) -> str:
    """Build the vision system prompt with a concrete language instruction.

    Replaces the vague "write in the user's language" rule with an explicit
    register description, tone guidance, and a concrete example sentence so
    the model knows exactly what dialect/register to write in.

    Args:
        language: Hover AI language code (e.g. ``"en-pidgin"``).

    Returns:
        Full system prompt string with language instruction injected.
    """
    label, tone_instruction, summary_example = _LANGUAGE_CONFIGS.get(
        language, _DEFAULT_LANGUAGE_CONFIG
    )

    return f"""You are Hover — a warm, knowledgeable AI assistant that guides \
users step-by-step through tasks on their computer.

You receive a screenshot of the user's screen and a voice instruction.
Your job is to look at what is on screen and give the user clear, numbered \
instructions they can follow themselves to complete the task.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESPONSE FORMAT — raw JSON only, no markdown, no explanation, no <think> tags:
{{
  "summary": "{summary_example}",
  "steps": [
    {{
      "step": 1,
      "instruction": "...",
      "keys": null,
      "tip": null
    }},
    {{
      "step": 2,
      "instruction": "...",
      "keys": "Enter",
      "tip": "..."
    }}
  ]
}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LANGUAGE — {label}:
{tone_instruction}

STEP RULES:
- Write each instruction as a clear, complete sentence a non-technical user can follow.
- Be specific: name the exact button, menu item, cell, or key to use.
- Reference what you actually see on screen — if you can see the app name, menu labels,
  cell references, or button text, use those exact names.
- If a step involves a keyboard shortcut, put it in the "keys" field (e.g. "Ctrl+S").
- Use the "tip" field for extra context, warnings, or variations (keep it short).
- Break the task into as many steps as needed — do not skip steps or combine unrelated actions.
- Order steps exactly as they must be performed.

STEP EXAMPLES by task type:
- "sum rows in Excel": click target cell → type =SUM(range) → Enter
- "open a file": File menu → Open → navigate to file → double-click it
- "save as PDF": File → Export / Save As → choose PDF format → Save
- "apply a filter": select header row → Data tab → Filter button
- "bold text in Word": select the text → Ctrl+B or click Bold button on toolbar
- "create a chart": select data range → Insert tab → Chart → choose type → OK

SUMMARY RULES — this is spoken aloud via TTS:
- Speak directly and warmly using the {label} tone above.
- Name the app and what you see on screen.
- Keep it to 1-2 sentences maximum.
- NEVER say "The user wants..." — always say "you" / "your".

Return ONLY the JSON object. No markdown. No preamble. No extra text. No <think> tags."""


class VisionParseError(Exception):
    """Raised when the vision LLM response cannot be parsed as valid JSON.

    Attributes:
        raw_response: The raw string returned by the model before parsing.
    """

    def __init__(self, raw_response: str) -> None:
        """Initialise with the unparseable model response.

        Args:
            raw_response: The raw model output that failed JSON parsing.
        """
        super().__init__(f"Vision model returned unparseable JSON: {raw_response[:200]}")
        self.raw_response = raw_response


def _strip_thinking(raw: str) -> str:
    """Strip Qwen3 chain-of-thought <think>...</think> blocks from output.

    Qwen3 sometimes emits a reasoning block before the JSON answer. This
    function removes it so the JSON parser only sees the final answer.

    Args:
        raw: Raw model output, possibly containing <think>...</think> tags.

    Returns:
        The raw string with any <think> block removed and whitespace stripped.
    """
    # Remove everything inside <think>...</think> (non-greedy, dotall)
    cleaned = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL)
    return cleaned.strip()


def _extract_json(raw: str) -> str:
    """Extract the JSON object from a model response robustly.

    Handles: bare JSON, ```json fences, ``` fences, prose prefixes,
    and <think> blocks (Qwen3 chain-of-thought).

    Args:
        raw: Raw model output string.

    Returns:
        Extracted JSON string ready for ``json.loads``.
    """
    text = _strip_thinking(raw).strip()
    # Strip any markdown code fence
    fence = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    # Pull out first {...} block if response doesn't start with {
    if not text.startswith("{"):
        brace = re.search(r"\{.*\}", text, re.DOTALL)
        if brace:
            text = brace.group(0)
    return text


def _parse_vision_response(raw: str) -> VisionResult:
    """Parse the raw model response string into a VisionResult.

    Args:
        raw: Raw string output from the vision LLM.

    Returns:
        A validated ``VisionResult`` instance.

    Raises:
        VisionParseError: If the string is not valid JSON or does not
            match the expected schema.
    """
    try:
        data = json.loads(_extract_json(raw))
        steps = [BeaconStep(**s) for s in data.get("steps", [])]
        return VisionResult(steps=steps, summary=data.get("summary", ""))
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        raise VisionParseError(raw) from exc


async def _groq_vision(
    image_data_uri: str,
    transcript: str,
    language: str,
) -> VisionResult:
    """Single-step Groq vision: image + transcript → JSON steps directly.

    Groq's qwen3.8-27b is multimodal and instruction-following, so it can
    accept the image and produce the JSON steps in one call.

    Args:
        image_data_uri: ``data:image/jpeg;base64,...`` URI of the compressed screenshot.
        transcript: User's voice instruction.
        language: Hover AI language code.

    Returns:
        Parsed ``VisionResult``.

    Raises:
        VisionParseError: If the model returns unparseable JSON after one retry.
    """
    user_content = [
        {"type": "image_url", "image_url": {"url": image_data_uri}},
        {
            "type": "text",
            "text": (
                f"Voice instruction (language: {language}):\n{transcript}\n\n"
                "Look at the screenshot and give the user step-by-step instructions "
                "to complete their request. Return JSON."
            ),
        },
    ]
    messages: list[dict] = [
        {"role": "system", "content": _build_system_prompt(language)},
        {"role": "user", "content": user_content},
    ]
    for attempt in range(2):
        if attempt == 1:
            messages.append({
                "role": "user",
                "content": "Invalid JSON. Return ONLY the raw JSON object, no markdown, no <think> tags.",
            })
        try:
            resp = await groq_client.chat.completions.create(
                model=settings.vision_model,
                messages=messages,  # type: ignore[arg-type]
                temperature=0.1,
                max_tokens=512,
            )
            raw = resp.choices[0].message.content or ""
            result = _parse_vision_response(raw)
            if attempt > 0:
                logger.info("Groq vision parsed on retry attempt %d", attempt + 1)
            return result
        except VisionParseError:
            if attempt == 1:
                logger.error("Groq vision unparseable after retry. transcript=%r", transcript[:80])
                raise
            logger.warning("Groq vision parse failed attempt %d, retrying...", attempt + 1)
        except Exception as exc:
            logger.error("Groq vision error: %s", exc, exc_info=True)
            raise
    raise VisionParseError("Groq vision loop exited")  # pragma: no cover


async def _local_two_step_vision(
    image_data_uri: str,
    transcript: str,
    language: str,
) -> VisionResult:
    """Two-step local pipeline: moondream captions → qwen2.5:3b generates JSON.

    Step 1 — moondream (vision only, no JSON):
        Receives the screenshot with a simple "describe what you see" prompt.
        Returns a plain-text description — moondream is NOT instruction-following
        and cannot produce JSON, so we never ask it to.

    Step 2 — qwen2.5:3b (text only, no image):
        Receives the screen description + user goal.
        Produces the full JSON steps response.

    Falls back to ``_groq_vision`` on any timeout or error.

    Args:
        image_data_uri: ``data:image/jpeg;base64,...`` URI of the compressed screenshot.
        transcript: User's voice instruction.
        language: Hover AI language code.

    Returns:
        Parsed ``VisionResult``.
    """
    # ── Step 1: moondream caption ─────────────────────────────────────────────
    caption_prompt = (
        f"The user wants to: {transcript}\n\n"
        "Describe everything you see on this screen. "
        "Include: the application name, all visible menus, buttons, text fields, "
        "toolbars, content, and any relevant text. Be specific and detailed."
    )
    screen_description = ""
    try:
        caption_resp = await vision_client.chat.completions.create(
            model=active_vision_model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": image_data_uri}},
                        {"type": "text", "text": caption_prompt},
                    ],
                }
            ],
            max_tokens=150,
            temperature=0.1,
        )
        screen_description = caption_resp.choices[0].message.content or ""
        logger.info(
            "Moondream caption complete (%d chars): %s",
            len(screen_description),
            screen_description[:120],
        )
    except (openai.APITimeoutError, openai.APIConnectionError) as exc:
        logger.warning(
            "Moondream caption timed out (%s) — falling back to Groq", exc.__class__.__name__
        )
        return await _groq_vision(image_data_uri, transcript, language)
    except Exception as exc:
        logger.warning("Moondream caption failed (%s) — falling back to Groq", exc)
        return await _groq_vision(image_data_uri, transcript, language)

    if not screen_description.strip():
        logger.warning("Moondream returned empty caption — falling back to Groq")
        return await _groq_vision(image_data_uri, transcript, language)

    # ── Step 2: qwen2.5:3b → JSON steps (text only, no image) ────────────────
    reasoning_user_content = (
        f"The user said (language: {language}): {transcript}\n\n"
        f"Current screen:\n{screen_description}\n\n"
        "Based on what is on screen and what the user wants, "
        "provide step-by-step instructions as JSON."
    )
    reasoning_messages: list[dict] = [
        {"role": "system", "content": _build_system_prompt(language)},
        {"role": "user", "content": reasoning_user_content},
    ]
    for attempt in range(2):
        if attempt == 1:
            reasoning_messages.append({
                "role": "user",
                "content": "Invalid JSON. Return ONLY the raw JSON object, no markdown.",
            })
        try:
            from app.services.llm_client import llm_client, active_llm_model  # noqa: PLC0415
            resp = await llm_client.chat.completions.create(
                model=active_llm_model,
                messages=reasoning_messages,  # type: ignore[arg-type]
                temperature=0.1,
                max_tokens=512,
            )
            raw = resp.choices[0].message.content or ""
            result = _parse_vision_response(raw)
            if attempt > 0:
                logger.info("Local reasoning parsed on retry attempt %d", attempt + 1)
            return result
        except VisionParseError:
            if attempt == 1:
                logger.warning(
                    "Local reasoning unparseable after retry — falling back to Groq"
                )
                return await _groq_vision(image_data_uri, transcript, language)
            logger.warning("Local reasoning parse failed attempt %d, retrying...", attempt + 1)
        except (openai.APITimeoutError, openai.APIConnectionError) as exc:
            logger.warning(
                "Local reasoning model timed out (%s) — falling back to Groq",
                exc.__class__.__name__,
            )
            return await _groq_vision(image_data_uri, transcript, language)
        except Exception as exc:
            logger.warning("Local reasoning model error (%s) — falling back to Groq", exc)
            return await _groq_vision(image_data_uri, transcript, language)

    return await _groq_vision(image_data_uri, transcript, language)  # pragma: no cover


async def run_vision(
    screenshot_b64: str,
    transcript: str,
    language: str,
    compressed_b64: str | None = None,
) -> VisionResult:
    """Generate guided step-by-step instructions from a screenshot + voice transcript.

    Routes to the appropriate pipeline based on configuration:
      - Local mode (LOCAL_LLM_BASE_URL set): moondream captions → qwen2.5:3b JSON
        with automatic Groq fallback on any timeout or failure.
      - Groq-only mode: single call to qwen3.8-27b (multimodal).

    Args:
        screenshot_b64: Base64-encoded PNG/JPEG of the full screen.
        transcript: Primary STT transcript.
        language: Hover AI language code (e.g. ``"en-pidgin"``).
        compressed_b64: Pre-compressed base64 JPEG from a parallel compression
            task. When provided, the internal ``_compress_screenshot`` call is
            skipped entirely, saving ~200-400ms.

    Returns:
        A ``VisionResult`` with ordered ``BeaconStep`` instructions and a summary.

    Raises:
        VisionParseError: Only raised if Groq also fails after all retries.
    """
    if compressed_b64 is None:
        compressed_b64 = _compress_screenshot(screenshot_b64)
    image_data_uri = f"data:image/jpeg;base64,{compressed_b64}"

    # Local two-step: moondream caption → qwen2.5:3b JSON (Groq fallback built-in)
    if vision_client is not groq_client:
        logger.info(
            "Vision: local two-step pipeline (%s caption → %s reasoning)",
            active_vision_model,
            settings.local_llm_model,
        )
        return await _local_two_step_vision(image_data_uri, transcript, language)

    # Groq-only: single multimodal call
    logger.info("Vision: Groq-only pipeline (%s)", settings.vision_model)
    return await _groq_vision(image_data_uri, transcript, language)
