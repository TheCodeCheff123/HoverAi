"""Tests for the audio conversion service."""

import io
import wave

import pytest

from app.services.audio import AudioConversionError, convert_to_wav


def _make_wav_bytes(sample_rate: int = 44100, channels: int = 2, duration_ms: int = 100) -> bytes:
    """Generate a minimal valid WAV file in memory for testing.

    Args:
        sample_rate: Sample rate in Hz.
        channels: Number of audio channels.
        duration_ms: Duration in milliseconds.

    Returns:
        Raw WAV bytes.
    """
    num_frames = int(sample_rate * duration_ms / 1000)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(b"\x00\x00" * channels * num_frames)
    return buf.getvalue()


class TestConvertToWav:
    """Tests for the convert_to_wav function."""

    def test_converts_wav_to_16khz_mono(self):
        """A 44.1 kHz stereo WAV is resampled to 16 kHz mono."""
        input_wav = _make_wav_bytes(sample_rate=44100, channels=2)
        output = convert_to_wav(input_wav)

        buf = io.BytesIO(output)
        with wave.open(buf, "rb") as wf:
            assert wf.getframerate() == 16000
            assert wf.getnchannels() == 1
            assert wf.getsampwidth() == 2  # 16-bit

    def test_already_16khz_mono_passthrough(self):
        """A 16 kHz mono WAV is re-exported correctly (no degradation)."""
        input_wav = _make_wav_bytes(sample_rate=16000, channels=1)
        output = convert_to_wav(input_wav)

        buf = io.BytesIO(output)
        with wave.open(buf, "rb") as wf:
            assert wf.getframerate() == 16000
            assert wf.getnchannels() == 1

    def test_returns_bytes(self):
        """convert_to_wav always returns bytes."""
        input_wav = _make_wav_bytes()
        result = convert_to_wav(input_wav)
        assert isinstance(result, bytes)
        assert len(result) > 44  # at least WAV header size

    def test_invalid_audio_raises_audio_conversion_error(self):
        """Garbage bytes raise AudioConversionError, not a raw exception."""
        with pytest.raises(AudioConversionError):
            convert_to_wav(b"this is not audio")
