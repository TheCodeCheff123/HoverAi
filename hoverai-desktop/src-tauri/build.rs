fn main() {
    // Read .env from the workspace root (one level up from src-tauri/) so that
    // VITE_API_BASE is available to Rust via env!() at compile time.
    // This mirrors what Vite does for the renderer.
    let env_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()   // hoverai-desktop/
        .unwrap()
        .join(".env");

    if env_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&env_path) {
            for line in content.lines() {
                let line = line.trim();
                if line.starts_with('#') || line.is_empty() {
                    continue;
                }
                if let Some((key, value)) = line.split_once('=') {
                    let key = key.trim();
                    let value = value.trim().trim_matches('"').trim_matches('\'');
                    if key == "VITE_API_BASE" {
                        // Expose to Rust code via option_env!("VITE_API_BASE")
                        println!("cargo:rustc-env=VITE_API_BASE={value}");
                    }
                }
            }
        }
    }

    // Re-run if .env changes
    println!("cargo:rerun-if-changed=../.env");
    println!("cargo:rerun-if-changed=.env");

    tauri_build::build()
}
