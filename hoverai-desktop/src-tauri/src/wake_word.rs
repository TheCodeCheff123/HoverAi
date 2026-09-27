// ─── Wake-word detection ──────────────────────────────────────────────────────
//
// Uses the livekit-wakeword Rust crate which handles the full pipeline
// internally — resampling, melspectrogram, speech embedding, classifier.
//
// We only ship hey_hover.onnx in resources/.
// melspectrogram.onnx and embedding_model.onnx are bundled inside the crate.
//
// Flow:
//   cpal (native SR, any channels)
//     → downmix to mono f32 → convert to i16
//     → ring buffer
//     → drain 80 ms chunks at native rate
//     → WakeWordModel::predict() — resamples to 16 kHz internally
//     → score("hey_hover") > 0.41 → trigger_capture() + 1.5 s cooldown

use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use livekit_wakeword::wakeword::WakeWordModel;
use tauri::AppHandle;

// ── Constants ─────────────────────────────────────────────────────────────────

const THRESHOLD: f32 = 0.41;
const COOLDOWN: Duration = Duration::from_millis(1500);
/// The model expects 16 kHz mono input.
const MODEL_SR: u32 = 16_000;
/// 2-second window the model scores (32000 samples at 16 kHz).
const WINDOW_SAMPLES: usize = 32_000;
/// How many new 16 kHz samples we accumulate before running inference.
/// 500 ms = 8000 samples → low latency while covering the full phrase.
const HOP_SAMPLES_16K: usize = 8_000;

// ── Stop signal ───────────────────────────────────────────────────────────────

pub struct StopSignal;

// ── Public API ────────────────────────────────────────────────────────────────

pub fn start(app: AppHandle) -> std::sync::mpsc::SyncSender<StopSignal> {
    let (tx, rx) = std::sync::mpsc::sync_channel::<StopSignal>(1);
    std::thread::spawn(move || {
        if let Err(e) = run_detector(app, rx) {
            eprintln!("[wake-word] detector error: {e}");
        }
    });
    tx
}

// ── Detector ─────────────────────────────────────────────────────────────────

fn run_detector(
    app: AppHandle,
    stop_rx: std::sync::mpsc::Receiver<StopSignal>,
) -> Result<(), String> {
    use tauri::Manager;

    // ── Resolve model path ──
    let model_path = app
        .path()
        .resolve("resources/hey_hover.onnx", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("resolve model path: {e}"))?;

    // ── Open microphone ──
    let host = cpal::default_host();
    let device = host.default_input_device().ok_or("no input device")?;
    let supported = device
        .default_input_config()
        .map_err(|e| format!("default input config: {e}"))?;

    let in_sr = supported.sample_rate().0 as usize;
    let in_channels = supported.channels() as usize;
    println!(
        "[wake-word] mic: {in_sr} Hz, {in_channels} ch, native_fmt={:?}",
        supported.sample_format()
    );

    let stream_cfg = cpal::StreamConfig {
        channels: supported.channels(),
        sample_rate: supported.sample_rate(),
        buffer_size: cpal::BufferSize::Default,
    };

    // ── Load WakeWordModel at exactly 16 kHz ──
    // We resample to 16 kHz ourselves so the crate's internal resampler is a
    // no-op. The Python API shows predict() needs a 2-second / 32000-sample
    // window — we maintain a rolling buffer and score it every 500 ms.
    let model_path_str = model_path
        .to_str()
        .ok_or("model path is not valid UTF-8")?;

    let model = Arc::new(Mutex::new(
        WakeWordModel::new(&[model_path_str], MODEL_SR)
            .map_err(|e| format!("load WakeWordModel: {e}"))?,
    ));
    println!("[wake-word] model loaded (window={WINDOW_SAMPLES} samples, hop={HOP_SAMPLES_16K})");

    // How many native-rate samples correspond to one 500 ms hop at 16 kHz.
    let native_hop = HOP_SAMPLES_16K * in_sr / MODEL_SR as usize;
    println!("[wake-word] native_hop={native_hop} @ {in_sr} Hz → {HOP_SAMPLES_16K} @ {MODEL_SR} Hz");

    // ── Ring buffer: native-rate f32 mono ──
    let ring: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::with_capacity(in_sr * 4)));
    let ring_w = ring.clone();

    let stream = {
        let err_fn = |e| eprintln!("[wake-word] cpal error: {e}");
        device
            .build_input_stream(
                &stream_cfg,
                move |data: &[f32], _| {
                    let mut r = ring_w.lock().unwrap();
                    for frame in data.chunks(in_channels) {
                        r.push(frame.iter().sum::<f32>() / in_channels as f32);
                    }
                },
                err_fn,
                None,
            )
            .map_err(|e| format!("build stream: {e}"))?
    };
    stream.play().map_err(|e| format!("stream play: {e}"))?;

    // Rolling 2-second window of 16 kHz f32 samples.
    // Starts empty — we only begin scoring once the window is fully populated
    // with real mic audio so the zero-padded cold-start doesn't false-trigger.
    let mut window_16k: Vec<f32> = Vec::with_capacity(WINDOW_SAMPLES);
    // Count of 16 kHz hops accumulated so far.
    let mut hops_filled: usize = 0;
    let hops_to_fill = WINDOW_SAMPLES / HOP_SAMPLES_16K; // 4 hops = 2 s

    let mut last_trigger = Instant::now()
        .checked_sub(COOLDOWN)
        .unwrap_or_else(Instant::now);

    // ── Inference loop ──
    loop {
        // Stop check (non-blocking)
        match stop_rx.try_recv() {
            Ok(_) | Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
            Err(std::sync::mpsc::TryRecvError::Empty) => {}
        }

        // Accumulate one hop worth of native-rate samples
        let native_samples: Vec<f32> = {
            let mut r = ring.lock().unwrap();
            if r.len() < native_hop {
                drop(r);
                std::thread::sleep(Duration::from_millis(5));
                continue;
            }
            r.drain(..native_hop).collect()
        };

        // Downsample native_hop → HOP_SAMPLES_16K via linear interpolation
        let hop_16k: Vec<f32> = (0..HOP_SAMPLES_16K)
            .map(|i| {
                let pos = i as f64 * (native_hop - 1) as f64 / (HOP_SAMPLES_16K - 1) as f64;
                let lo = pos.floor() as usize;
                let hi = (lo + 1).min(native_hop - 1);
                let frac = (pos - lo as f64) as f32;
                native_samples[lo] * (1.0 - frac) + native_samples[hi] * frac
            })
            .collect();

        // Fill or slide the 2-second window
        if window_16k.len() < WINDOW_SAMPLES {
            // Still warming up — append until full
            window_16k.extend_from_slice(&hop_16k);
            hops_filled += 1;
            if hops_filled < hops_to_fill {
                // Not ready yet
                continue;
            }
            // Exactly full now — fall through to score
        } else {
            // Slide: drop oldest hop, append new one
            window_16k.drain(..HOP_SAMPLES_16K);
            window_16k.extend_from_slice(&hop_16k);
        }

        // Convert the full 2-second window to i16 for predict()
        let window_i16: Vec<i16> = window_16k
            .iter()
            .map(|&s| (s * 32767.0).clamp(-32768.0, 32767.0) as i16)
            .collect();

        // Score the window
        let mut mdl = model.lock().unwrap();
        match mdl.predict(&window_i16) {
            Ok(preds) => {
                if let Some(&score) = preds.get("hey_hover") {
                    if score > THRESHOLD {
                        let now = Instant::now();
                        if now.duration_since(last_trigger) >= COOLDOWN {
                            last_trigger = now;
                            println!("[wake-word] *** DETECTED *** score={score:.3}");
                            let app_clone = app.clone();
                            tauri::async_runtime::spawn(async move {
                                crate::trigger_capture(app_clone).await;
                            });
                        }
                    }
                }
            }
            Err(e) => eprintln!("[wake-word] predict error: {e}"),
        }
    }

    drop(stream);
    println!("[wake-word] detector stopped");
    Ok(())
}
