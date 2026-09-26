// ─── Wake-word live test ───────────────────────────────────────────────────────
//
// Usage (from hoverai-desktop/src-tauri/):
//
//   cargo run --bin wake_test -- path/to/hey_hover.onnx
//
// Ctrl-C to stop.

use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use livekit_wakeword::wakeword::WakeWordModel;

const THRESHOLD: f32 = 0.41;
const COOLDOWN: Duration = Duration::from_millis(1500);

/// Model sample rate we feed into livekit-wakeword.
const MODEL_SR: u32 = 16_000;

/// How often we run predict (ms).
const STEP_MS: usize = 80;

/// How much audio context to feed each predict (ms).
/// livekit-wakeword often needs closer to ~1–2s, not only 80ms.
const CONTEXT_MS: usize = 2000;

fn main() {
    let model_path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "hey_hover.onnx".to_string());

    println!("[wake_test] model: {model_path}");

    // ── Microphone ──
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .expect("no input device found");
    let supported = device
        .default_input_config()
        .expect("could not get default input config");

    let in_sr = supported.sample_rate().0 as usize;
    let in_channels = supported.channels() as usize;
    println!(
        "[wake_test] mic: {in_sr} Hz, {in_channels} ch, fmt={:?}",
        supported.sample_format()
    );

    let stream_cfg = cpal::StreamConfig {
        channels: supported.channels(),
        sample_rate: supported.sample_rate(),
        buffer_size: cpal::BufferSize::Default,
    };

    // Tell the crate the sample rate of audio WE will pass to predict().
    // We resample to 16 kHz ourselves below.
    let mut model = WakeWordModel::new(&[model_path.as_str()], MODEL_SR)
        .expect("failed to load WakeWordModel");
    println!("[wake_test] model loaded — say 'Hey Hover' clearly");

    let model_step = MODEL_SR as usize * STEP_MS / 1000; // 1280
    let model_context = MODEL_SR as usize * CONTEXT_MS / 1000; // 32000
    let native_step = in_sr * STEP_MS / 1000;

    println!("[wake_test] step={STEP_MS}ms  context={CONTEXT_MS}ms");
    println!("[wake_test] model_step={model_step}  model_context={model_context}");
    println!("[wake_test] threshold={THRESHOLD}");
    println!("[wake_test] Ctrl-C to stop\n");

    // Ring buffer in native mono f32
    let ring: Arc<Mutex<VecDeque<f32>>> =
        Arc::new(Mutex::new(VecDeque::with_capacity(in_sr * 4)));
    let ring_w = ring.clone();

    let stream = device
        .build_input_stream(
            &stream_cfg,
            move |data: &[f32], _| {
                let mut r = ring_w.lock().unwrap();
                for frame in data.chunks(in_channels) {
                    let mono = frame.iter().sum::<f32>() / in_channels as f32;
                    r.push_back(mono);
                }
                // keep at most ~4 seconds
                let max_len = in_sr * 4;
                while r.len() > max_len {
                    r.pop_front();
                }
            },
            |e| eprintln!("[wake_test] cpal error: {e}"),
            None,
        )
        .expect("could not build input stream");

    stream.play().expect("could not start stream");

    // Rolling 16 kHz mono history for predict()
    let mut hist_16k: VecDeque<i16> = VecDeque::with_capacity(model_context * 2);
    let mut last_trigger = Instant::now()
        .checked_sub(COOLDOWN)
        .unwrap_or_else(Instant::now);
    let mut printed_keys = false;

    loop {
        // Wait until we have one native step of audio
        let native_samples: Vec<f32> = {
            let mut r = ring.lock().unwrap();
            if r.len() < native_step {
                drop(r);
                std::thread::sleep(Duration::from_millis(5));
                continue;
            }
            r.drain(..native_step).collect()
        };

        // Mic level check (are we hearing anything?)
        let rms = {
            let sum_sq: f32 = native_samples.iter().map(|x| x * x).sum();
            (sum_sq / native_samples.len() as f32).sqrt()
        };

        // Resample this step to 16 kHz with linear interpolation
        let step_16k: Vec<i16> = (0..model_step)
            .map(|i| {
                let pos = i as f64 * (native_samples.len() - 1) as f64
                    / (model_step.max(1) - 1).max(1) as f64;
                let lo = pos.floor() as usize;
                let hi = (lo + 1).min(native_samples.len() - 1);
                let frac = pos - lo as f64;
                let s = native_samples[lo] as f64 * (1.0 - frac)
                    + native_samples[hi] as f64 * frac;
                (s * 32767.0).clamp(-32768.0, 32767.0) as i16
            })
            .collect();

        for s in step_16k {
            hist_16k.push_back(s);
        }
        while hist_16k.len() > model_context {
            hist_16k.pop_front();
        }

        // Need full context before scoring
        if hist_16k.len() < model_context {
            println!(
                "[wake_test] warming up... {}/{}  rms={rms:.4}",
                hist_16k.len(),
                model_context
            );
            continue;
        }

        let chunk: Vec<i16> = hist_16k.iter().copied().collect();

        match model.predict(&chunk) {
            Ok(preds) => {
                if !printed_keys {
                    println!(
                        "[wake_test] prediction keys = {:?}",
                        preds.keys().collect::<Vec<_>>()
                    );
                    printed_keys = true;
                }

                // Prefer hey_hover, else first available score
                let (key, score) = if let Some((k, v)) = preds.iter().next() {
                    if let Some(v2) = preds.get("hey_hover") {
                        ("hey_hover", *v2)
                    } else {
                        (k.as_str(), *v)
                    }
                } else {
                    println!("[wake_test] empty preds map  rms={rms:.4}");
                    continue;
                };

                let bar_len = ((score * 40.0) as usize).min(40);
                let bar = "#".repeat(bar_len);
                println!(
                    "key={key:<16} score={score:.4} rms={rms:.4} |{bar:<40}|"
                );

                if score > THRESHOLD {
                    let now = Instant::now();
                    if now.duration_since(last_trigger) >= COOLDOWN {
                        last_trigger = now;
                        println!("\n*** DETECTED *** key={key} score={score:.3}\n");
                    }
                }
            }
            Err(e) => eprintln!("[wake_test] predict error: {e}"),
        }
    }
}
