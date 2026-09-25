// ─── HTTP client with auth + refresh ─────────────────────────────────────────
// Mirrors fetchWithAuth from hover-app/src/main/index.ts.

use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::tokens;

#[derive(Debug, Deserialize)]
pub struct RefreshResponse {
    pub access_token: String,
    pub refresh_token: String,
}

/// Make an authenticated HTTP request. On 401, refresh the token and retry once.
/// Returns the response bytes and the HTTP status code.
pub async fn fetch_with_auth(
    app: &tauri::AppHandle,
    client: &Client,
    request: reqwest::RequestBuilder,
    // We need to be able to clone the request — pass a factory closure
) -> Result<reqwest::Response, String> {
    // We can't clone RequestBuilder directly, so the caller must pass a factory.
    // This version receives a built Request.
    let req = request
        .build()
        .map_err(|e| format!("request build error: {e}"))?;

    let token = tokens::get(app).map(|(a, _)| a);
    let url = req.url().clone();
    let method = req.method().clone();
    let headers_orig = req.headers().clone();
    let body_bytes = req.body().and_then(|b| b.as_bytes()).map(|b| b.to_vec());

    // Helper to rebuild the request with a given bearer token
    let build_req = |t: Option<&str>| {
        let mut rb = client.request(method.clone(), url.clone());
        rb = rb.headers(headers_orig.clone());
        if let Some(tok) = t {
            rb = rb.bearer_auth(tok);
        }
        if let Some(ref bytes) = body_bytes {
            rb = rb.body(bytes.clone());
        }
        rb
    };

    let resp = build_req(token.as_deref())
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;

    if resp.status() == 401 {
        // Try to refresh
        if let Some(new_token) = refresh_token(app, client).await {
            let retry = build_req(Some(&new_token))
                .send()
                .await
                .map_err(|e| format!("retry network error: {e}"))?;
            return Ok(retry);
        }
        // Refresh failed — return original 401
    }

    Ok(resp)
}

async fn refresh_token(app: &tauri::AppHandle, client: &Client) -> Option<String> {
    let (_, refresh) = tokens::get(app)?;
    let api_base = crate::api_base();

    #[derive(Serialize)]
    struct RefreshBody {
        refresh_token: String,
    }

    let resp = client
        .post(format!("{api_base}/auth/refresh"))
        .json(&RefreshBody { refresh_token: refresh })
        .header("ngrok-skip-browser-warning", "true")
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        tokens::clear(app);
        return None;
    }

    let data: RefreshResponse = resp.json().await.ok()?;
    tokens::store(app, &data.access_token, &data.refresh_token);
    Some(data.access_token)
}
