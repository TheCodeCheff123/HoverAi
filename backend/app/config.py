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

    # ── Model names (Groq fallback) ───────────────────────────────────────────
    vision_model: str = "qwen/qwen3.8-27b"
    whisper_model: str = "whisper-large-v3"
    hf_asr_model: str = "openai/whisper-large-v3"

    # ── TTS (Groq Orpheus — English) ──────────────────────────────────────────
    tts_model: str = "canopylabs/orpheus-v1-english"
    tts_voice: str = "autumn"  # valid: autumn | diana | hannah | austin | daniel | troy
    tts_enabled: bool = True   # set False to skip TTS and return empty speech_b64

    # ── Sahara TTS (Intron — African languages) ───────────────────────────────
    # When sahara_tts_enabled=True, African-language requests use Sahara TTS
    # (pcm+pidgin, yo+yoruba, ha+hausa, ig+igbo) for an authentic voice.
    # Groq Orpheus is used as fallback if Sahara fails, and for "en" / "fr".
    sahara_tts_enabled: bool = True

    # ── Local Ollama two-step pipeline (optional) ─────────────────────────────
    # Step 1: local_vision_model (moondream) — describes the screenshot in plain text
    # Step 2: local_llm_model (qwen2.5:3b)  — takes description + goal → JSON steps
    # Groq is used as automatic fallback if either step times out or fails.
    # Leave LOCAL_LLM_BASE_URL blank to use Groq for everything (single step).
    local_llm_base_url: str = ""            # e.g. "https://abc123.ngrok-free.app/v1"
    local_llm_api_key: str = "ollama"       # Ollama ignores the key but AsyncOpenAI requires one
    local_vision_model: str = "moondream"   # captioning model — describes the screenshot
    local_llm_model: str = "qwen2.5:3b"     # instruction-following model — generates JSON steps
    local_vision_timeout: float = 60.0      # moondream caption timeout
    local_llm_timeout: float = 90.0         # qwen2.5 reasoning timeout


# Module-level singleton — import this everywhere instead of instantiating Settings()
settings = Settings()  # type: ignore[call-arg]  # fields are populated from .env at runtime
