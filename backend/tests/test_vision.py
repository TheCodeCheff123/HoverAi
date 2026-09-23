"""Tests for the vision pipeline — parse logic and error handling."""

import json

import pytest

from app.schemas.vision import BeaconStep, VisionResult
from app.services.vision import VisionParseError, _parse_vision_response


class TestParseVisionResponse:
    """Unit tests for _parse_vision_response — no network calls needed."""

    def test_valid_json_returns_vision_result(self):
        """Valid JSON matching the schema returns a VisionResult."""
        raw = json.dumps({
            "summary": "Here is how to sum those rows.",
            "steps": [
                {"step": 1, "instruction": "Click on the target cell.", "keys": None, "tip": None}
            ],
        })
        result = _parse_vision_response(raw)
        assert isinstance(result, VisionResult)
        assert len(result.steps) == 1
        assert result.summary == "Here is how to sum those rows."

    def test_strips_markdown_fences(self):
        """JSON wrapped in ```json fences is parsed correctly."""
        inner = json.dumps({
            "summary": "Open menu",
            "steps": [
                {"step": 1, "instruction": "Click the File menu.", "keys": None, "tip": None}
            ],
        })
        raw = f"```json\n{inner}\n```"
        result = _parse_vision_response(raw)
        assert result.steps[0].instruction == "Click the File menu."

    def test_strips_plain_fences(self):
        """JSON wrapped in plain ``` fences (no language tag) is also parsed."""
        inner = json.dumps({
            "summary": "s",
            "steps": [
                {"step": 1, "instruction": "Tap the button.", "keys": None, "tip": None}
            ],
        })
        raw = f"```\n{inner}\n```"
        result = _parse_vision_response(raw)
        assert result.steps[0].instruction == "Tap the button."

    def test_invalid_json_raises_vision_parse_error(self):
        """Non-JSON input raises VisionParseError."""
        with pytest.raises(VisionParseError):
            _parse_vision_response("this is not json at all")

    def test_empty_steps_allowed(self):
        """A response with an empty steps list is valid."""
        raw = json.dumps({"summary": "Nothing found", "steps": []})
        result = _parse_vision_response(raw)
        assert result.steps == []

    def test_keys_and_tip_optional(self):
        """BeaconStep accepts steps with and without keys/tip fields."""
        step_with = BeaconStep(step=1, instruction="Press save.", keys="Ctrl+S", tip="Works on all platforms.")
        assert step_with.keys == "Ctrl+S"
        assert step_with.tip == "Works on all platforms."

        step_without = BeaconStep(step=2, instruction="Click OK.")
        assert step_without.keys is None
        assert step_without.tip is None

    def test_multiple_steps_preserved(self):
        """All steps in a multi-step response are returned."""
        raw = json.dumps({
            "summary": "Two steps",
            "steps": [
                {"step": 1, "instruction": "First step.", "keys": None, "tip": None},
                {"step": 2, "instruction": "Second step.", "keys": "Ctrl+S", "tip": "Save your work."},
            ],
        })
        result = _parse_vision_response(raw)
        assert len(result.steps) == 2
        assert result.steps[1].step == 2
        assert result.steps[1].keys == "Ctrl+S"
