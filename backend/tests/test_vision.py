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
            "summary": "Click the submit button",
            "steps": [
                {"step": 1, "instruction": "Click Submit", "x": 0.5, "y": 0.5, "w": 0.1, "h": 0.05}
            ],
        })
        result = _parse_vision_response(raw)
        assert isinstance(result, VisionResult)
        assert len(result.steps) == 1
        assert result.summary == "Click the submit button"

    def test_strips_markdown_fences(self):
        """JSON wrapped in ```json fences is parsed correctly."""
        inner = json.dumps({
            "summary": "Open menu",
            "steps": [
                {"step": 1, "instruction": "Click menu", "x": 0.1, "y": 0.1, "w": 0.05, "h": 0.05}
            ],
        })
        raw = f"```json\n{inner}\n```"
        result = _parse_vision_response(raw)
        assert result.steps[0].instruction == "Click menu"

    def test_strips_plain_fences(self):
        """JSON wrapped in plain ``` fences (no language tag) is also parsed."""
        inner = json.dumps({
            "summary": "s",
            "steps": [
                {"step": 1, "instruction": "tap", "x": 0.2, "y": 0.3, "w": 0.1, "h": 0.1}
            ],
        })
        raw = f"```\n{inner}\n```"
        result = _parse_vision_response(raw)
        assert result.steps[0].x == pytest.approx(0.2)

    def test_invalid_json_raises_vision_parse_error(self):
        """Non-JSON input raises VisionParseError."""
        with pytest.raises(VisionParseError):
            _parse_vision_response("this is not json at all")

    def test_empty_steps_allowed(self):
        """A response with an empty steps list is valid."""
        raw = json.dumps({"summary": "Nothing found", "steps": []})
        result = _parse_vision_response(raw)
        assert result.steps == []

    def test_beacon_step_coordinates_in_range(self):
        """BeaconStep rejects coordinates outside 0.0–1.0."""
        with pytest.raises(Exception):  # pydantic ValidationError
            BeaconStep(step=1, instruction="bad", x=1.5, y=0.5, w=0.1, h=0.05)

    def test_multiple_steps_preserved(self):
        """All steps in a multi-step response are returned."""
        raw = json.dumps({
            "summary": "Two steps",
            "steps": [
                {"step": 1, "instruction": "First", "x": 0.1, "y": 0.1, "w": 0.1, "h": 0.05},
                {"step": 2, "instruction": "Second", "x": 0.9, "y": 0.9, "w": 0.1, "h": 0.05},
            ],
        })
        result = _parse_vision_response(raw)
        assert len(result.steps) == 2
        assert result.steps[1].step == 2
