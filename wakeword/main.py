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
run_extraction(config)
run_train(config)
onnx_path = run_export(config)

results = run_eval(config, onnx_path)
print(results)
print(f"Model: {onnx_path}")

