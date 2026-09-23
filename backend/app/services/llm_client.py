"""Shared LLM client factory.

Single source of truth for constructing AsyncOpenAI-compatible clients.
All LLM calls in vision.py and agent.py import from here.

Hybrid mode  (LOCAL_LLM_BASE_URL is set)
─────────────────────────────────────────
  vision_client   → local Ollama (moondream) via ngrok
                    screenshot → text description only
  llm_client      → Groq (qwen3.8-27b)
                    receives TEXT description, not the image → no token cost
  active_vision_model → "moondream"
  active_llm_model    → settings.vision_model  (Groq model)

Groq-only mode  (LOCAL_LLM_BASE_URL is blank)
──────────────────────────────────────────────
  Both clients → Groq (qwen3.8-27b multimodal)
  Screenshot is sent directly as an image_url block.

Ngrok header
────────────
ngrok free-tier returns an HTML warning page unless the request carries
``ngrok-skip-browser-warning: true``.  Injected automatically when the
base URL contains "ngrok".
"""

import logging

import httpx
from openai import AsyncOpenAI

from app.config import settings

logger = logging.getLogger(__name__)


def _make_ngrok_http_client(timeout: float) -> httpx.AsyncClient:
    """Return an httpx.AsyncClient with the ngrok bypass header pre-set.

    Args:
        timeout: Request timeout in seconds.

    Returns:
        Configured ``httpx.AsyncClient`` instance.
    """
    return httpx.AsyncClient(
        headers={"ngrok-skip-browser-warning": "true"},
        timeout=timeout,
    )


def _build_client(base_url: str, api_key: str, timeout: float) -> AsyncOpenAI:
    """Construct an AsyncOpenAI-compatible client.

    Injects the ngrok bypass header when the base URL contains "ngrok".

    Args:
        base_url: Full base URL including ``/v1`` suffix.
        api_key: API key (``"ollama"`` for local; real Groq key for cloud).
        timeout: Request timeout in seconds.

    Returns:
        A configured ``AsyncOpenAI`` client.
    """
    is_ngrok = "ngrok" in base_url.lower()
    http_client = _make_ngrok_http_client(timeout) if is_ngrok else None

    kwargs: dict = dict(
        api_key=api_key,
        base_url=base_url,
        max_retries=1,
        timeout=timeout,
    )
    if http_client is not None:
        kwargs["http_client"] = http_client

    return AsyncOpenAI(**kwargs)  # type: ignore[arg-type]


def _is_local() -> bool:
    """Return True when a local Ollama vision endpoint is configured."""
    return bool(settings.local_llm_base_url.strip())


# ── Groq client (always present — used for reasoning + vision fallback) ───────
# Exported so vision.py can fall back to Groq if the local vision model times out.
# max_retries=1 + timeout=20s: stays within ngrok's 30s window.
groq_client: AsyncOpenAI = _build_client(
    base_url="https://api.groq.com/openai/v1",
    api_key=settings.groq_api_key,
    timeout=20.0,
)

# ── Client singletons exported to vision.py and agent.py ─────────────────────

if _is_local():
    logger.warning(
        "⚠️  LOCAL two-step pipeline ACTIVE — caption: %s  reasoning: %s  @ %s"
        "  |  This adds 5-30s latency. Set LOCAL_LLM_BASE_URL= to use fast Groq-only mode.",
        settings.local_vision_model,
        settings.local_llm_model,
        settings.local_llm_base_url,
    )
    # Step 1 — moondream: screenshot → plain-text description (no JSON required)
    vision_client: AsyncOpenAI = _build_client(
        base_url=settings.local_llm_base_url,
        api_key=settings.local_llm_api_key,
        timeout=settings.local_vision_timeout,
    )
    active_vision_model: str = settings.local_vision_model

    # Step 2 — qwen2.5:3b: text description + goal → JSON steps (no image)
    llm_client: AsyncOpenAI = _build_client(
        base_url=settings.local_llm_base_url,
        api_key=settings.local_llm_api_key,
        timeout=settings.local_llm_timeout,
    )
    active_llm_model: str = settings.local_llm_model

else:
    logger.info(
        "Groq-only mode (fast) — vision + reasoning: %s",
        settings.vision_model,
    )
    # Single step — Groq multimodal handles image + JSON generation directly
    vision_client = groq_client
    llm_client = groq_client
    active_vision_model = settings.vision_model
    active_llm_model = settings.vision_model
