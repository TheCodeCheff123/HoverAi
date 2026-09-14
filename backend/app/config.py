"""Application configuration.

All environment variables are read exclusively from this module.
No other module should call os.getenv() directly — import `settings` instead.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Typed settings loaded from the .env file and environment variables.

    Attributes:
        database_url: Render PostgreSQL connection string.
        jwt_secret: Secret key used to sign JWT tokens. Must be >= 32 chars.
        jwt_algorithm: JWT signing algorithm (default HS256).
        jwt_expire_minutes: Token lifetime in minutes (default 7 days).
        intron_api_key: Intron hackathon access token — used as Bearer token.
        intron_stt_base_url: Base URL for the Intron Sahara inference API.
        sahara_poll_interval_s: Seconds to wait between status poll requests.
        sahara_poll_timeout_s: Maximum seconds to wait for a Sahara transcription.
        groq_api_key: Groq API key for Whisper transcription and Llama-4 vision.
        hf_api_key: HuggingFace access token for the free Inference API.
        vision_model: Groq model identifier for the vision LLM.
        whisper_model: Groq model identifier for Whisper transcription.
        hf_asr_model: HuggingFace model identifier for AfriSpeech Whisper.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # ── Database ──────────────────────────────────────────────────────────────
    database_url: str

    # ── Auth ──────────────────────────────────────────────────────────────────
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 15           # access token — 15 minutes
    jwt_refresh_expire_days: int = 90      # refresh token — 90 days

    # ── Intron Sahara STT ─────────────────────────────────────────────────────
    intron_api_key: str
    intron_stt_base_url: str = "https://infer.voice.intron.io"
    sahara_poll_interval_s: float = 2.0
    sahara_poll_timeout_s: float = 120.0

    # ── Groq (Whisper transcription + Llama-4-Scout vision) ───────────────────
    groq_api_key: str

    # ── HuggingFace (AfriSpeech Whisper — benchmark #3) ───────────────────────
    hf_api_key: str

    # ── Model names ───────────────────────────────────────────────────────────
    vision_model: str = "qwen/qwen3.8-27b"
    whisper_model: str = "whisper-large-v3"
    hf_asr_model: str = "openai/whisper-large-v3"

    # ── TTS (Groq Orpheus) ────────────────────────────────────────────────────
    tts_model: str = "canopylabs/orpheus-v1-english"
    tts_voice: str = "autumn"  # valid: autumn | diana | hannah | austin | daniel | troy
    tts_enabled: bool = True   # set False to skip TTS and return empty speech_b64


# Module-level singleton — import this everywhere instead of instantiating Settings()
settings = Settings()  # type: ignore[call-arg]  # fields are populated from .env at runtime
