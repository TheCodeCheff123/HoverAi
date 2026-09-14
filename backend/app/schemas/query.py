"""Query endpoint request/response schemas."""

from pydantic import BaseModel

from app.schemas.vision import BeaconStep


class BenchmarkResult(BaseModel):
    """STT benchmark data included in every query response.

    Sent back to the client so the Electron app can display latency info
    and the benchmark report script can collect it without a separate DB query.

    Attributes:
        sahara_ms: Sahara end-to-end latency (upload + polling) in milliseconds.
        whisper_ms: Groq Whisper round-trip latency in milliseconds.
        afrispeech_ms: HuggingFace AfriSpeech round-trip latency in milliseconds.
        tts_ms: Groq Orpheus TTS synthesis latency in milliseconds.
        transcript_whisper: Groq Whisper transcript text.
        transcript_afrispeech: HuggingFace AfriSpeech transcript text.
    """

    sahara_ms: int
    whisper_ms: int
    afrispeech_ms: int
    tts_ms: int
    transcript_whisper: str
    transcript_afrispeech: str


class QueryResponse(BaseModel):
    """Response returned from POST /query.

    Attributes:
        transcript: Primary STT transcript used for the query.
        steps: Ordered list of beacon steps for the Electron overlay.
        summary: One-sentence description of what the model understood.
        speech_b64: Base64-encoded WAV audio of the summary spoken aloud by
            Groq Orpheus TTS. Decode and play in Electron with the Web Audio
            API. Empty string if TTS is disabled or failed.
        benchmark: Latency and transcript data from all three STT engines.
    """

    transcript: str
    steps: list[BeaconStep]
    summary: str
    speech_b64: str
    benchmark: BenchmarkResult
