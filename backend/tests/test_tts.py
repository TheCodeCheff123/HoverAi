"""Tests for the TTS synthesis service."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.tts import synthesise


class TestSynthesize:
    """Tests for the synthesise() function."""

    @pytest.mark.asyncio
    async def test_returns_base64_wav_on_success(self):
        """A successful TTS call returns a non-empty base64 string and elapsed ms."""
        # Minimal valid WAV header (44 bytes) + silence
        fake_wav = b"RIFF" + b"\x00" * 40

        mock_response = MagicMock()
        mock_response.content = fake_wav

        with patch("app.services.tts._groq_tts_client") as mock_client:
            mock_client.audio.speech.create = AsyncMock(return_value=mock_response)
            speech_b64, elapsed_ms = await synthesise("Click the save button.")

        assert speech_b64 != ""
        assert elapsed_ms >= 0
        # Decode to confirm it's valid base64 and matches the fake WAV
        import base64
        decoded = base64.b64decode(speech_b64)
        assert decoded == fake_wav

    @pytest.mark.asyncio
    async def test_empty_text_returns_empty_string(self):
        """Calling synthesise with empty text returns ('', 0) without hitting the API."""
        with patch("app.services.tts._groq_tts_client") as mock_client:
            mock_client.audio.speech.create = AsyncMock()
            speech_b64, elapsed_ms = await synthesise("")

        mock_client.audio.speech.create.assert_not_called()
        assert speech_b64 == ""
        assert elapsed_ms == 0

    @pytest.mark.asyncio
    async def test_whitespace_only_text_returns_empty_string(self):
        """Whitespace-only text is treated as empty — no API call made."""
        with patch("app.services.tts._groq_tts_client") as mock_client:
            mock_client.audio.speech.create = AsyncMock()
            speech_b64, elapsed_ms = await synthesise("   ")

        mock_client.audio.speech.create.assert_not_called()
        assert speech_b64 == ""

    @pytest.mark.asyncio
    async def test_api_error_returns_empty_string_not_exception(self):
        """A TTS API error returns ('', elapsed_ms) — never propagates."""
        with patch("app.services.tts._groq_tts_client") as mock_client:
            mock_client.audio.speech.create = AsyncMock(
                side_effect=Exception("Groq TTS unavailable")
            )
            speech_b64, elapsed_ms = await synthesise("Hello world.")

        assert speech_b64 == ""
        assert elapsed_ms >= 0

    @pytest.mark.asyncio
    async def test_calls_api_with_correct_parameters(self):
        """synthesise() passes the correct model, voice, and format to the API."""
        fake_wav = b"RIFF" + b"\x00" * 40
        mock_response = MagicMock()
        mock_response.content = fake_wav

        with patch("app.services.tts._groq_tts_client") as mock_client:
            mock_client.audio.speech.create = AsyncMock(return_value=mock_response)
            await synthesise("Open the settings menu.")

        call_kwargs = mock_client.audio.speech.create.call_args.kwargs
        assert call_kwargs["response_format"] == "wav"
        assert call_kwargs["input"] == "Open the settings menu."
        assert "voice" in call_kwargs
        assert "model" in call_kwargs
