// ─── Token storage ────────────────────────────────────────────────────────────
// Stores JWT access + refresh tokens in a JSON file under app data dir.
// In production consider using tauri-plugin-keychain for OS-level encryption.

use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Serialize, Deserialize)]
struct TokenFile {
    access: String,
    refresh: String,
}

fn tokens_path(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_data_dir()
        .expect("no app data dir")
        .join("tokens.json")
}

pub fn store(app: &tauri::AppHandle, access: &str, refresh: &str) {
    let path = tokens_path(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let content = serde_json::to_string(&TokenFile {
        access: access.to_string(),
        refresh: refresh.to_string(),
    })
    .unwrap_or_default();
    let _ = fs::write(&path, content);
}

pub fn get(app: &tauri::AppHandle) -> Option<(String, String)> {
    let raw = fs::read_to_string(tokens_path(app)).ok()?;
    let tf: TokenFile = serde_json::from_str(&raw).ok()?;
    Some((tf.access, tf.refresh))
}

pub fn clear(app: &tauri::AppHandle) {
    let _ = fs::remove_file(tokens_path(app));
}

/// Decode the `exp` claim from a JWT without verifying the signature.
pub fn jwt_expiry(token: &str) -> i64 {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 {
        return 0;
    }
    // base64url decode the payload
    let payload = parts[1];
    let padded = match payload.len() % 4 {
        2 => format!("{}==", payload),
        3 => format!("{}=", payload),
        _ => payload.to_string(),
    };
    use base64::Engine;
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(&padded))
        .unwrap_or_default();
    let json: serde_json::Value = serde_json::from_slice(&decoded).unwrap_or_default();
    json["exp"].as_i64().unwrap_or(0)
}
