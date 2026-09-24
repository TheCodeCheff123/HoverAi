"""STT result schema."""

from pydantic import BaseModel


class STTResult(BaseModel):
    """Result from the in-request STT pipeline.

    Groq Whisper (~1-2s) is the default transcription engine.
    When ``SAHARA_STT_STREAM_ENABLED=true``, Sahara streaming STT is
    used instead for African-language requests, with Groq as fallback.

    Attributes:
        transcript: Transcript used immediately for vision + TTS.
        whisper_latency_ms: STT round-trip latency in milliseconds.
    """

    transcript: str = ""
    whisper_latency_ms: int = 0
