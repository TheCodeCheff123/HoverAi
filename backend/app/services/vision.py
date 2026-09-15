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

from openai import AsyncOpenAI

from app.config import settings
from app.schemas.vision import BeaconStep, VisionResult

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


# Groq OpenAI-compatible client (text/chat completions)
# max_retries=1 + timeout=20s: prevents the default 2×11s retry from blowing
# ngrok's 30s free-tier request timeout.
_groq_vision_client = AsyncOpenAI(
    api_key=settings.groq_api_key,
    base_url="https://api.groq.com/openai/v1",
    max_retries=1,
    timeout=20.0,
)

# System prompt — instructs the model to return ONLY valid JSON.
# The BeaconStep schema is embedded inline so the model knows the exact shape.
# The screenshot is passed as a vision content block (type: image_url) so the
# model actually decodes the image — NOT as raw base64 text in the string.
_SYSTEM_PROMPT = """You are Hover — a smart, warm AI buddy that lives inside the user's computer \
and controls their mouse for them.

You receive a screenshot of the user's screen (compressed but accurate) and a voice instruction.
Your job is to find the EXACT pixel location of what they need and move the mouse there.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESPONSE FORMAT — raw JSON only, no markdown, no explanation:
{
  "summary": "Warm spoken reply — 1-2 sentences, directly to the user",
  "steps": [
    {
      "step": 1,
      "action": "click",
      "instruction": "Click the Chrome icon on the taskbar",
      "x": 0.04,
      "y": 0.97,
      "w": 0.03,
      "h": 0.05
    }
  ]
}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COORDINATE RULES — BE PRECISE:
- x, y, w, h are fractions of screen size: 0.0 to 1.0
- x and y are the EXACT CENTRE of the clickable element — not near it, ON IT
- The image you receive is a downscaled screenshot. When estimating coordinates,
  account for the original screen resolution (typically 1920×1080 or 2560×1440).
- For small icons (taskbar, desktop): they are usually 32–64px wide on the real screen.
  A taskbar icon at x=0.04 means 76px from the left on a 1920px screen — be that precise.
- Scan the WHOLE image methodically before deciding coordinates.
- For desktop icons: they are arranged in a grid. Count the icon's column and row position.
  Desktop grid typically starts at x≈0.03 (first column) with ~0.08 spacing between icons.
  First row is typically y≈0.10, with ~0.12 spacing between rows.
- For taskbar icons (Windows bottom bar, macOS dock): y is close to 0.95–1.0.
  Each icon is spaced roughly every 0.04 units horizontally.
- For browser tabs: y≈0.03–0.05. Each tab is roughly 0.15 wide.
- For application menus (File, Edit, View): y≈0.03, x follows the menu label position.

ACTION FIELD — what should happen at these coordinates:
- "click"       — single left click (opening apps, buttons, links)
- "double_click"— double click (opening files/folders on desktop)
- "right_click" — right click (context menus)
- "type"        — type text (x/y point to the input field; add "text" field with what to type)
- "key"         — keyboard shortcut (add "keys" field, e.g. "Ctrl+S", "Alt+F4", "Win+D")
- "scroll"      — scroll at position (add "direction": "up"/"down", "amount": 3)

For keyboard actions that don't need mouse movement, set x=0.5, y=0.5.

MULTI-STEP TASKS — think like an agent:
- If the task requires multiple actions, break it into ALL necessary steps.
- Example: "minimize this and open Chrome from desktop":
    step 1: action=key, keys="Alt+F4" or keys="Win+Down" (minimize), x=0.5, y=0.5
    step 2: action=double_click, target the Chrome icon on the desktop
- Example: "open the settings menu":
    step 1: click the ⚙ Settings icon or the three-dot menu
- Example: "save this file":
    step 1: action=key, keys="Ctrl+S", x=0.5, y=0.5
- Do NOT stop at one step if the task clearly needs more.
- Order steps exactly as they must be executed — the app runs them in sequence.

SUMMARY RULES — spoken aloud via TTS, so make it sound natural:
- Speak directly to the user: "I can see you're on VSCode!", "Sure, on it!"
- Name what you see: the app, the page, the context
- Keep it under 2 sentences
- Sound like a helpful friend, not a robot
- Match the user's language (given in the instruction)
- NEVER say "The user wants..." or "The user is asking..." — always say "you"

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


def _parse_vision_response(raw: str) -> VisionResult:
    """Parse the raw model response string into a VisionResult.

    Strips Qwen3 <think> blocks and accidental markdown fences before parsing.

    Args:
        raw: Raw string output from the vision LLM.

    Returns:
        A validated ``VisionResult`` instance.

    Raises:
        VisionParseError: If the string is not valid JSON or does not
            match the expected schema.
    """
    cleaned = _strip_thinking(raw)

    # Strip markdown fences if the model added them despite instructions
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        cleaned = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    try:
        data = json.loads(cleaned)
        steps = [BeaconStep(**s) for s in data.get("steps", [])]
        return VisionResult(steps=steps, summary=data.get("summary", ""))
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        raise VisionParseError(raw) from exc


async def run_vision(
    screenshot_b64: str,
    transcript: str,
    language: str,
) -> VisionResult:
    """Extract beacon steps from a screenshot + transcript using Groq Qwen3-8B-27b.

    Compresses the screenshot to 512x288 JPEG at 35% quality (~1,100-1,450
    image tokens) and sends it as a proper vision content block alongside the
    voice transcript. Total token budget stays well under 7,000 ITPM.

    The image is passed as ``{"type": "image_url", "image_url": {"url": ...}}``
    inside the content array — NOT as raw base64 text in the message string.
    Raw base64 text is read as plain characters (spending ~10k tokens with zero
    visual understanding); the image_url block triggers actual image decoding.

    On JSON parse failure the call is retried once with a stricter prompt.
    If the second attempt also fails, a ``VisionParseError`` is raised.

    Args:
        screenshot_b64: Base64-encoded PNG/JPEG of the full screen. May be
                        a plain base64 string or a ``data:image/...`` URI —
                        both are handled. Compressed before sending.
        transcript: Primary transcript from STT used to identify UI elements.
        language: Hover AI language code (e.g. ``"en-pidgin"``). Passed to
                  the model so instructions are written in the right language.

    Returns:
        A ``VisionResult`` containing the list of beacon steps and a summary.

    Raises:
        VisionParseError: If both the first and retry attempt fail to produce
            parseable JSON.
    """
    # Compress to 512x288 JPEG q=35 — keeps image tokens ~1,100-1,450
    compressed_b64 = _compress_screenshot(screenshot_b64)
    image_data_uri = f"data:image/jpeg;base64,{compressed_b64}"

    # Vision content block — the model decodes this as an actual image.
    # Passing base64 as plain text in the string instead would read it as
    # raw characters and spend ~10k tokens with no visual understanding.
    user_content = [
        {
            "type": "image_url",
            "image_url": {"url": image_data_uri},
        },
        {
            "type": "text",
            "text": (
                f"Voice instruction (language: {language}):\n{transcript}\n\n"
                "Analyse the screenshot and the voice instruction, then identify "
                "the UI elements and return beacon steps as JSON."
            ),
        },
    ]

    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]

    for attempt in range(2):
        if attempt == 1:
            messages.append({
                "role": "user",
                "content": (
                    "Your previous response was not valid JSON. "
                    "Return ONLY the raw JSON object with no extra text, "
                    "no <think> tags, no markdown."
                ),
            })

        try:
            response = await _groq_vision_client.chat.completions.create(
                model=settings.vision_model,
                messages=messages,  # type: ignore[arg-type]
                temperature=0.1,    # low temperature for deterministic JSON output
                max_tokens=1024,
            )
            raw = response.choices[0].message.content or ""
            result = _parse_vision_response(raw)
            if attempt > 0:
                logger.info("Vision parsed successfully on retry attempt %d", attempt + 1)
            return result

        except VisionParseError:
            if attempt == 1:
                logger.error(
                    "Vision model returned unparseable JSON after retry. "
                    "transcript=%r",
                    transcript[:100],
                )
                raise
            logger.warning("Vision parse failed on attempt %d, retrying...", attempt + 1)
        except Exception as exc:
            logger.error("Vision LLM error: %s", exc, exc_info=True)
            raise

    # Unreachable — range(2) always returns or raises on both attempts.
    raise VisionParseError("Vision loop exited without returning")  # pragma: no cover
