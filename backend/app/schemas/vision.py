"""Vision pipeline schemas — GuidedStep and VisionResult.

Guided-assistant mode: the AI produces human-readable step-by-step
instructions that the user follows manually.  No coordinates or automated
actions — just clear, numbered instructions shown in the overlay panel.
"""

from pydantic import BaseModel, Field


class BeaconStep(BaseModel):
    """A single guided instruction step shown in the overlay panel.

    The user reads the instruction and performs it manually.
    No screen coordinates or automated actions are involved.

    Attributes:
        step: 1-based step number in the sequence.
        instruction: Full human-readable instruction for this step, written
                     in the user's preferred language.  Should be a complete
                     sentence describing exactly what to do, e.g.:
                     "Click on cell B2 to select it."
                     "Press Ctrl+Shift+L to apply a filter."
        keys: Optional keyboard shortcut to highlight in the overlay
              (e.g. ``"Ctrl+S"``).  ``None`` if no shortcut is involved.
        tip: Optional extra context or warning for this step — shown in a
             smaller font below the instruction.  ``None`` if not needed.
    """

    step: int = Field(ge=1)
    instruction: str
    keys: str | None = None
    tip: str | None = None


class VisionResult(BaseModel):
    """Output from the vision + LLM guidance pipeline.

    Attributes:
        steps: Ordered list of guided instruction steps for the overlay panel.
        summary: Warm one-sentence spoken summary of what the AI understood
                 and is about to guide the user through.  Read aloud via TTS.
    """

    steps: list[BeaconStep]
    summary: str
