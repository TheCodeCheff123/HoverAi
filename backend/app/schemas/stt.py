"""STT result schema."""

from pydantic import BaseModel


class STTResult(BaseModel):
    """Result from the in-request STT pipeline.

    **Live path (blocks until response):**
    Groq Whisper (~1-2s) provides the transcript that drives vision + TTS.
    It is the only transcription engine that runs in the request/response cycle.

    **Background path (fires after response is sent):**
    Sahara upload (~1-2s) runs concurrently with Groq during the request to
    obtain a ``file_id``.  A background task then polls Sahara (2-3 min) for
    the African-language transcript and writes it to the DB as a benchmark
    record — it never feeds back into the live response.

    Sahara *cannot* be used as the live transcription path because it takes
    2-3 minutes to return a transcript. Groq Whisper handles all African
    languages (``yo``, ``ha``, ``ig``, ``pcm``) via auto-detection and is
    the correct fast-path engine.

    Attributes:
        transcript: Groq Whisper transcript — used immediately for vision.
        whisper_latency_ms: Groq Whisper round-trip latency in milliseconds.
        sahara_file_id: Sahara file_id for the background poll task.
            ``None`` when the upload failed — background poll is skipped.
    """

    transcript: str = ""
    whisper_latency_ms: int = 0
    sahara_file_id: str | None = None
