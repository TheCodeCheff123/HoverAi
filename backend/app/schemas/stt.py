"""STT result schema."""

from pydantic import BaseModel


class STTResult(BaseModel):
    """Aggregated result from all three STT engines.

    The ``transcript`` field (from Sahara) is the primary output used
    downstream for vision processing. The other two transcripts are stored
    in ``query_logs`` for the hackathon benchmark report.

    Attributes:
        transcript: Sahara transcript — the primary output used for vision.
        sahara_latency_ms: End-to-end Sahara latency including polling wait.
        transcript_whisper: Groq whisper-large-v3-turbo transcript.
        whisper_latency_ms: Groq Whisper round-trip latency in milliseconds.
        transcript_afrispeech: HuggingFace afrispeech-whisper-medium-all transcript.
        afrispeech_latency_ms: HuggingFace Inference API latency in milliseconds.
    """

    transcript: str
    sahara_latency_ms: int
    transcript_whisper: str
    whisper_latency_ms: int
    transcript_afrispeech: str
    afrispeech_latency_ms: int
