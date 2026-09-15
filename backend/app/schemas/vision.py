"""Vision pipeline schemas — BeaconStep and VisionResult."""

from typing import Literal

from pydantic import BaseModel, Field


class BeaconStep(BaseModel):
    """A single UI interaction step with fractional screen coordinates.

    Coordinates are expressed as fractions of the screen dimensions (0.0–1.0)
    so the Electron overlay can scale them to any display resolution without
    needing to know the actual pixel dimensions server-side.

    Attributes:
        step: 1-based step number in the sequence.
        action: The type of interaction to perform at these coordinates.
            ``click`` — single left click.
            ``double_click`` — double click (opening files/folders).
            ``right_click`` — right click (context menus).
            ``type`` — type text into the focused element (use ``text`` field).
            ``key`` — fire a keyboard shortcut (use ``keys`` field).
            ``scroll`` — scroll at position (use ``direction`` + ``amount``).
        instruction: Human-readable instruction for this step, in the user's
                     preferred language.
        x: Horizontal centre of the target element (0.0 = left, 1.0 = right).
        y: Vertical centre of the target element (0.0 = top, 1.0 = bottom).
        w: Width of the target bounding box as a fraction of screen width.
        h: Height of the target bounding box as a fraction of screen height.
        text: Text to type — only used when ``action == "type"``.
        keys: Keyboard shortcut string — only used when ``action == "key"``
              (e.g. ``"Ctrl+S"``, ``"Alt+F4"``, ``"Win+D"``).
        direction: Scroll direction — only used when ``action == "scroll"``.
        amount: Scroll amount in ticks — only used when ``action == "scroll"``.
    """

    step: int = Field(ge=1)
    action: Literal["click", "double_click", "right_click", "type", "key", "scroll"] = "click"
    instruction: str
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    w: float = Field(ge=0.0, le=1.0)
    h: float = Field(ge=0.0, le=1.0)
    # Optional fields — only present for specific action types
    text: str | None = None
    keys: str | None = None
    direction: Literal["up", "down"] | None = None
    amount: int | None = None


class VisionResult(BaseModel):
    """Output from the vision LLM pipeline.

    Attributes:
        steps: Ordered list of UI interaction steps with screen coordinates.
        summary: One-sentence summary of what the user asked to do.
    """

    steps: list[BeaconStep]
    summary: str
