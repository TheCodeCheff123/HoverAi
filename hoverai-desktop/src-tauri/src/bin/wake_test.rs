// ─── Wake-word live test ───────────────────────────────────────────────────────
//
// Runs the full detection pipeline against the real microphone without
// starting Tauri or the frontend at all.
//
// Usage (from hoverai-desktop/src-tauri/):
//
//   cargo run --bin wake_test -- path/to/hey_hover.onnx
//
// If no path is given it looks for hey_hover.onnx in the current directory.
//
// Press Ctrl-C to stop.
//
// How it works (matching the Python reference script):
//   - Maintains a rolling 2-second window of 16 kHz mono audio (32000 samples)
//   - Every 500 ms of new audio, slides the window and calls predict()
//   - score > 0.41 → detected

use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use livekit_wakeword::wakeword::WakeWordModel;

const THRESHOLD: f32 = 0.41;
const COOLDOWN: Duration = Duration::from_millis(1500);
const MODEL_SR: u32 = 16_000;
const WINDOW_SAMPLES: usize = 32_000; // 2 s at 16 kHz
const HOP_SAMPLES_16K: usize = 8_000; // 500 ms hop

fn main() {
    let model_path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "hey_hover.onnx".to_string());

    println!("[wake_test] model : {model_path}");
    println!("[wake_test] window: {WINDOW_SAMPLES} samples (2 s at {MODEL_SR} Hz)");
    println!("[wake_test] hop   : {HOP_SAMPLES_16K} samples (500 ms)");
    println!("[wake_test] thresh: {THRESHOLD}");

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
        "[wake_test] mic: {in_sr} Hz, {in_channels} ch, native_fmt={:?}",
        supported.sample_format()
    );

    let stream_cfg = cpal::StreamConfig {
        channels: supported.channels(),
        sample_rate: supported.sample_rate(),
        buffer_size: cpal::BufferSize::Default,
    };

    // ── Load model ──
    let mut model = WakeWordModel::new(&[model_path.as_str()], MODEL_SR)
        .expect("failed to load WakeWordModel");
    println!("[wake_test] model loaded — say 'Hey Hover' | Ctrl-C to stop\n");

    // Native-rate samples per 500 ms hop
    let native_hop = HOP_SAMPLES_16K * in_sr / MODEL_SR as usize;
    println!("[wake_test] native_hop={native_hop} @ {in_sr} Hz → {HOP_SAMPLES_16K} @ {MODEL_SR} Hz\n");

    // ── Ring buffer ──
    let ring: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::with_capacity(in_sr * 4)));
    let ring_w = ring.clone();

    let stream = device
        .build_input_stream(
            &stream_cfg,
            move |data: &[f32], _| {
                let mut r = ring_w.lock().unwrap();
                for frame in data.chunks(in_channels) {
                    r.push(frame.iter().sum::<f32>() / in_channels as f32);
                }
            },
            |e| eprintln!("[wake_test] cpal error: {e}"),
            None,
        )
        .expect("could not build input stream");

    stream.play().expect("could not start stream");

    // Rolling 2-second window at 16 kHz.
    // Starts empty so the cold-start zero-padding doesn't fire a false positive.
    let mut window_16k: Vec<f32> = Vec::with_capacity(WINDOW_SAMPLES);
    let mut hops_filled: usize = 0;
    let hops_to_fill = WINDOW_SAMPLES / HOP_SAMPLES_16K; // 4 hops = 2 s

    let mut last_trigger = Instant::now()
        .checked_sub(COOLDOWN)
        .unwrap_or_else(Instant::now);

    // ── Inference loop ──
    loop {
        // Wait for native_hop samples
        let native_samples: Vec<f32> = {
            let mut r = ring.lock().unwrap();
            if r.len() < native_hop {
                drop(r);
                std::thread::sleep(Duration::from_millis(5));
                continue;
            }
            r.drain(..native_hop).collect()
        };

        // Downsample: native_hop f32 → HOP_SAMPLES_16K f32 via linear interpolation
        let hop_16k: Vec<f32> = (0..HOP_SAMPLES_16K)
            .map(|i| {
                let pos = i as f64 * (native_hop - 1) as f64 / (HOP_SAMPLES_16K - 1) as f64;
                let lo = pos.floor() as usize;
                let hi = (lo + 1).min(native_hop - 1);
                let frac = (pos - lo as f64) as f32;
                native_samples[lo] * (1.0 - frac) + native_samples[hi] * frac
            })
            .collect();

        // Fill or slide the window
        if window_16k.len() < WINDOW_SAMPLES {
            window_16k.extend_from_slice(&hop_16k);
            hops_filled += 1;
            if hops_filled < hops_to_fill {
                println!("[wake_test] warming up... {hops_filled}/{hops_to_fill}");
                continue;
            }
            // Window just became full — fall through to score
        } else {
            window_16k.drain(..HOP_SAMPLES_16K);
            window_16k.extend_from_slice(&hop_16k);
        }

        // Convert to i16 for predict()
        let window_i16: Vec<i16> = window_16k
            .iter()
            .map(|&s| (s * 32767.0).clamp(-32768.0, 32767.0) as i16)
            .collect();

        match model.predict(&window_i16) {
            Ok(preds) => {
                if let Some(&score) = preds.get("hey_hover") {
                    let bar_len = (score * 50.0) as usize;
                    let bar = "#".repeat(bar_len);
                    let marker = if score > THRESHOLD { " ◄ ABOVE THRESHOLD" } else { "" };
                    println!("score={score:.4}  |{bar:<50}|{marker}");

                    if score > THRESHOLD {
                        let now = Instant::now();
                        if now.duration_since(last_trigger) >= COOLDOWN {
                            last_trigger = now;
                            println!("\n╔══════════════════════════╗");
                            println!("║  *** HEY HOVER DETECTED ***  score={score:.3}");
                            println!("╚══════════════════════════╝\n");
                        }
                    }
                }
            }
            Err(e) => eprintln!("[wake_test] predict error: {e}"),
        }
    }
}
