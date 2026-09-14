"""Vision pipeline schemas — BeaconStep and VisionResult."""

from pydantic import BaseModel, Field


class BeaconStep(BaseModel):
    """A single UI interaction step with fractional screen coordinates.

    Coordinates are expressed as fractions of the screen dimensions (0.0–1.0)
    so the Electron overlay can scale them to any display resolution without
    needing to know the actual pixel dimensions server-side.

    Attributes:
        step: 1-based step number in the sequence.
        instruction: Human-readable instruction for this step, in the user's
                     preferred language.
        x: Horizontal centre of the target element (0.0 = left, 1.0 = right).
        y: Vertical centre of the target element (0.0 = top, 1.0 = bottom).
        w: Width of the target bounding box as a fraction of screen width.
        h: Height of the target bounding box as a fraction of screen height.
    """

    step: int = Field(ge=1)
    instruction: str
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    w: float = Field(ge=0.0, le=1.0)
    h: float = Field(ge=0.0, le=1.0)


class VisionResult(BaseModel):
    """Output from the vision LLM pipeline.

    Attributes:
        steps: Ordered list of UI interaction steps with screen coordinates.
        summary: One-sentence summary of what the user asked to do.
    """

    steps: list[BeaconStep]
    summary: str
