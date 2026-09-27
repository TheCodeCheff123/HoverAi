""" This script builds a custom wake word for hover ai
E.g User says Hey, Hover .... and that should start the hover ai system
This is basically to train the model to know about our custom wakeword
"""

from livekit.wakeword import (
    WakeWordConfig,
    load_config,
    run_generate,
    run_augment,
    run_extraction,
    run_train,
    run_export,
    run_eval,
)
from livekit.wakeword.data import align_clip_to_end

def add_live_position_negatives(config: WakeWordConfig) -> None:
    """Add negative clips aligned to the end of the live inference window."""
    import re

    import soundfile as sf

    target_length = int(config.augmentation.clip_duration * 16000)
    source_pattern = re.compile(r"^clip_\d{6}\.wav$")

    for split in ("negative_train", "negative_test"):
        directory = config.model_output_dir / split
        for source_path in sorted(directory.glob("*.wav")):
            if not source_pattern.match(source_path.name):
                continue

            audio, _ = sf.read(source_path)
            if audio.ndim > 1:
                audio = audio[:, 0]
            aligned = align_clip_to_end(
                audio.astype("float32"), target_length, jitter_samples=0
            )
            output_path = source_path.with_name(f"{source_path.stem}_r1.wav")
            sf.write(output_path, aligned, 16000)


# Load from YAML
# config = load_config("hey_hover.yaml")

# Or build a config programmatically
config = WakeWordConfig(
    model_name="hey_hover",
    target_phrases=["hey hover"],
    n_samples=5000,
    steps=30000,
)

run_generate(config)
run_augment(config)
add_live_position_negatives(config)
run_extraction(config)
run_train(config)
onnx_path = run_export(config)

results = run_eval(config, onnx_path)
print(results)
print(f"Model: {onnx_path}")

