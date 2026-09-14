"""Vision pipeline — transcript → beacon steps.

Uses Groq's Qwen3-8B-27b (text model, free tier) via the OpenAI-compatible
API to identify UI elements from a voice transcript and return structured
beacon step coordinates.

Note on model selection: Groq's previous vision model (llama-4-scout) is no
longer available on this account. qwen/qwen3.8-27b is the best available
reasoning model on this Groq account. It receives the screenshot encoded as
a base64 data URL inside the text prompt — Qwen3's large context window
(128k tokens) can handle the base64 payload of a typical screenshot.
"""

import json
import logging
import re

from openai import AsyncOpenAI

from app.config import settings
from app.schemas.vision import BeaconStep, VisionResult

logger = logging.getLogger(__name__)

# Groq OpenAI-compatible client (text/chat completions)
_groq_vision_client = AsyncOpenAI(
    api_key=settings.groq_api_key,
    base_url="https://api.groq.com/openai/v1",
)

# System prompt — instructs the model to return ONLY valid JSON.
# The BeaconStep schema is embedded inline so the model knows the exact shape.
# The screenshot is passed as a base64 data URL in the user message text.
_SYSTEM_PROMPT = """You are a UI navigation assistant for Hover AI.

You will receive:
1. A voice instruction (transcript) from the user.
2. A base64-encoded PNG screenshot of the user's screen embedded in the message.

Your task is to identify the exact UI elements the user should interact with
and return step-by-step instructions as structured JSON.

RESPONSE FORMAT — return ONLY a raw JSON object, no markdown fences, no explanation:
{
  "summary": "one sentence describing what the user wants to do",
  "steps": [
    {
      "step": 1,
      "instruction": "Click the blue Submit button",
      "x": 0.72,
      "y": 0.45,
      "w": 0.08,
      "h": 0.04
    }
  ]
}

COORDINATE RULES:
- All coordinate values (x, y, w, h) are fractions of the screen dimensions: 0.0 to 1.0
- x and y are the CENTRE of the target element
- w and h are the WIDTH and HEIGHT of the bounding box
- Example: an element at pixel (720, 450) on a 1920x1080 screen → x=0.375, y=0.417
- If you cannot determine exact coordinates from the screenshot, make a best estimate
  based on typical UI layouts for the described application

INSTRUCTION RULES:
- Write instructions in the user's language (indicated in the user message)
- Be specific: name the button/field/link the user should interact with
- Keep each instruction under 20 words
- If the request is unclear or no relevant UI element is visible, return a single
  step with instruction explaining what was not found and x=0.5, y=0.5, w=0.1, h=0.05

Return ONLY the JSON object. No markdown. No preamble. No explanation. No <think> tags."""


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
    """Extract beacon steps from a transcript using Groq Qwen3-8B-27b.

    Sends the voice transcript and the full-screen screenshot (as a base64
    data URL embedded in the text prompt) to Qwen3. The model returns a JSON
    object with beacon steps, each with fractional screen coordinates.

    On JSON parse failure the call is retried once with a stricter prompt.
    If the second attempt also fails, a ``VisionParseError`` is raised.

    Args:
        screenshot_b64: Base64-encoded PNG/JPEG of the full screen. May be
                        a plain base64 string or a ``data:image/...`` URI —
                        both are handled.
        transcript: Primary transcript from STT (Sahara or fallback).
        language: Hover AI language code (e.g. ``"en-pidgin"``). Passed to
                  the model so instructions are written in the right language.

    Returns:
        A ``VisionResult`` containing the list of beacon steps and a summary.

    Raises:
        VisionParseError: If both the first and retry attempt fail to produce
            parseable JSON.
    """
    # Normalise to a data URI so the model understands what it is receiving
    if not screenshot_b64.startswith("data:"):
        screenshot_b64 = f"data:image/png;base64,{screenshot_b64}"

    user_message = (
        f"Voice instruction (language: {language}):\n{transcript}\n\n"
        f"Screenshot (base64 PNG data URL):\n{screenshot_b64}\n\n"
        "Analyse the screenshot and the voice instruction, then identify the "
        "UI elements and return beacon steps as JSON."
    )

    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user_message},
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
