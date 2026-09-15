"""STT result schema."""

from pydantic import BaseModel


class STTResult(BaseModel):
    """Aggregated result from all three STT engines.

    Sahara runs as a background task after the HTTP response is returned,
    so ``transcript`` and ``sahara_latency_ms`` are initially ``None`` /
    empty and filled in asynchronously once the poll completes.

    Attributes:
        transcript: Sahara transcript — the primary output used for vision.
            Initially an empty string; set once the background poll finishes.
        sahara_file_id: Intron Sahara ``file_id`` returned by the upload step.
            Passed to the background task so it can poll and write the result.
            ``None`` when the upload failed.
        sahara_latency_ms: End-to-end Sahara latency including polling wait.
            ``None`` until the background task completes.
        transcript_whisper: Groq whisper-large-v3 transcript.
        whisper_latency_ms: Groq Whisper round-trip latency in milliseconds.
        transcript_afrispeech: HuggingFace whisper-large-v3 transcript.
        afrispeech_latency_ms: HuggingFace Inference API latency in milliseconds.
    """

    transcript: str = ""
    sahara_file_id: str | None = None
    sahara_latency_ms: int | None = None
    transcript_whisper: str
    whisper_latency_ms: int
    transcript_afrispeech: str
    afrispeech_latency_ms: int
