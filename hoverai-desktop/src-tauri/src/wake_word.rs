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
/// The model always runs at 16 kHz — we resample to this before predict().
const MODEL_SR: u32 = 16_000;
/// 80 ms of audio at 16 kHz.
const MODEL_CHUNK: usize = 1_280;

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
    // We downsample to 16 kHz ourselves before every predict() call, so the
    // crate receives audio that's already at the target rate and its internal
    // resampler is a no-op. Passing the native 48 kHz rate caused the internal
    // resampler (resampler v0.4.1) to output silence until primed → 0.0000.
    let model_path_str = model_path
        .to_str()
        .ok_or("model path is not valid UTF-8")?;

    let model = Arc::new(Mutex::new(
        WakeWordModel::new(&[model_path_str], MODEL_SR)
            .map_err(|e| format!("load WakeWordModel: {e}"))?,
    ));
    println!("[wake-word] model loaded (expects {MODEL_SR} Hz)");

    // Native samples that map to one MODEL_CHUNK (1280) at 16 kHz.
    // e.g. 48000/16000 * 1280 = 3840.
    let native_chunk = MODEL_CHUNK * in_sr / MODEL_SR as usize;
    println!("[wake-word] native_chunk={native_chunk} → {MODEL_CHUNK} samples at {MODEL_SR} Hz");

    // ── Ring buffer: native-rate f32 mono ──
    let ring: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::with_capacity(in_sr * 2)));
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

        // Drain native_chunk f32 samples
        let native_samples: Vec<f32> = {
            let mut r = ring.lock().unwrap();
            if r.len() < native_chunk {
                drop(r);
                std::thread::sleep(Duration::from_millis(5));
                continue;
            }
            r.drain(..native_chunk).collect()
        };

        // Linear interpolation: native_chunk f32 → MODEL_CHUNK i16 at 16 kHz
        let chunk: Vec<i16> = (0..MODEL_CHUNK)
            .map(|i| {
                let pos = i as f64 * (native_chunk - 1) as f64 / (MODEL_CHUNK - 1) as f64;
                let lo = pos.floor() as usize;
                let hi = (lo + 1).min(native_chunk - 1);
                let frac = pos - lo as f64;
                let s = native_samples[lo] as f64 * (1.0 - frac)
                    + native_samples[hi] as f64 * frac;
                (s * 32767.0).clamp(-32768.0, 32767.0) as i16
            })
            .collect();

        // Run all three pipeline stages in one call
        let mut mdl = model.lock().unwrap();
        match mdl.predict(&chunk) {
            Ok(preds) => {
                if let Some(&score) = preds.get("hey_hover") {
                    println!("[wake-word] score={score:.4}");
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
