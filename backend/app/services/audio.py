"""Audio conversion service.

Converts raw audio bytes (any ffmpeg-supported format) to WAV 16 kHz mono PCM.
The format is auto-detected from the file header — no hint needed.
This conversion is only needed for Groq Whisper and HuggingFace AfriSpeech;
Intron Sahara accepts the original bytes directly.
"""

import io
import logging

from pydub import AudioSegment

logger = logging.getLogger(__name__)

# Target format expected by Groq Whisper and HuggingFace Inference API
_TARGET_SAMPLE_RATE = 16_000
_TARGET_CHANNELS = 1
_TARGET_SAMPLE_WIDTH = 2  # 16-bit PCM


class AudioConversionError(Exception):
    """Raised when pydub/ffmpeg cannot decode or resample the input audio.

    Attributes:
        message: Human-readable description of what went wrong.
    """

    def __init__(self, message: str) -> None:
        """Initialise with a descriptive error message.

        Args:
            message: Description of the conversion failure.
        """
        super().__init__(message)
        self.message = message


def convert_to_wav(audio_bytes: bytes) -> bytes:
    """Convert raw audio bytes to WAV 16 kHz mono 16-bit PCM.

    Used to prepare audio for Groq Whisper and HuggingFace AfriSpeech.
    Intron Sahara does not need this — it accepts the original bytes directly.

    The format is auto-detected by ffmpeg from the file header — no format
    hint is required or accepted. This means WAV, WebM, OGG, MP3, and any
    other ffmpeg-supported container all work without the caller specifying
    the source format.

    The conversion pipeline:
      1. Auto-detect and decode input bytes via pydub (delegates to ffmpeg).
      2. Resample to 16 000 Hz.
      3. Downmix to mono (1 channel).
      4. Set sample width to 16-bit (2 bytes).
      5. Export as WAV and return the raw bytes.

    Args:
        audio_bytes: Raw audio bytes — any format ffmpeg can decode
                     (WebM/Opus, WAV, OGG, MP3, FLAC, etc.).

    Returns:
        WAV bytes at 16 000 Hz, mono, 16-bit PCM — ready for Whisper APIs.

    Raises:
        AudioConversionError: If ffmpeg cannot decode the input or the
            resampling fails for any reason.
    """
    try:
        # No format hint — ffmpeg probes the file header automatically.
        # This handles WebM from Electron, WAV from Swagger tests, and
        # any other container without the caller needing to specify it.
        segment = AudioSegment.from_file(io.BytesIO(audio_bytes))
        segment = (
            segment.set_frame_rate(_TARGET_SAMPLE_RATE)
            .set_channels(_TARGET_CHANNELS)
            .set_sample_width(_TARGET_SAMPLE_WIDTH)
        )
        buf = io.BytesIO()
        segment.export(buf, format="wav")
        wav_bytes = buf.getvalue()
        logger.debug(
            "Audio converted: %d bytes → %d bytes WAV (16kHz mono)",
            len(audio_bytes),
            len(wav_bytes),
        )
        return wav_bytes
    except Exception as exc:
        raise AudioConversionError(
            f"Failed to convert audio to WAV: {exc}"
        ) from exc
