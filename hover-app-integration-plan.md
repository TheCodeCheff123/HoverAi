# Hover App — Electron ↔ Backend Integration Plan

## Top-Level Overview

Wire the existing Electron app (`hover-app/`) to the live FastAPI backend. The
backend is fully built and tested. The Electron app has all UI, IPC, and
window management in place but every backend interaction is either a stub or
missing entirely.

Six integration points must be implemented:

1. **Auth** — AuthPage form calls real signup/signin endpoints, tokens stored
   securely via `safeStorage`, refreshed automatically when expired.
2. **API client** — a typed fetch wrapper in the renderer that attaches the
   Bearer token and handles 401 → refresh → retry transparently.
3. **Capture pipeline** — `capture-done` in `src/main/index.ts` sends audio +
   screenshot to `POST /api/v1/query` and pushes the beacon steps + TTS audio
   to the overlay renderer.
4. **Overlay response UI** — OverlayWidget replaces the drag-select UI with a
   loading state → beacon dots layer + audio playback when results arrive.
5. **Settings sync** — SettingsPage reads and writes user settings from the
   backend (with local JSON as offline fallback); account section shows real
   user data.
6. **Sign-out** — clears stored tokens, revokes refresh token on server, resets
   onboarding state.

---

## Architecture

```
Renderer (AuthPage / SettingsPage)
    │  window.api.*  (contextBridge)
    ▼
Preload (index.ts / index.d.ts)
    │  ipcRenderer.invoke / ipcRenderer.send
    ▼
Main Process (src/main/index.ts)
    │  node-fetch / fetch  → Authorization: Bearer <access_token>
    ▼
FastAPI Backend  (http://localhost:8000 dev / Render prod)
    ├── POST /api/v1/auth/signup
    ├── POST /api/v1/auth/signin
    ├── POST /api/v1/auth/refresh
    ├── POST /api/v1/auth/signout
    ├── GET  /api/v1/users/me
    ├── GET  /api/v1/users/me/settings
    ├── PATCH /api/v1/users/me/settings
    └── POST /api/v1/query
```

Token storage lives exclusively in the **main process** via
`safeStorage.encryptString` / `safeStorage.decryptString`. The renderer never
touches raw tokens — it calls preload bridge methods instead.

---

## Environment Variable

Add to `hover-app/.env`:
```
VITE_API_BASE_URL=http://localhost:8000
```
Production Render URL overrides this in the production build environment.
Read in renderer via `import.meta.env.VITE_API_BASE_URL`.

---

## New IPC Channels

| Channel | Direction | Payload | Purpose |
|---------|-----------|---------|---------|
| `store-tokens` | renderer → main | `{access_token, refresh_token}` | Persist tokens after auth |
| `get-access-token` | renderer ↔ main | — / `string` | Retrieve token for API calls |
| `clear-tokens` | renderer → main | — | Delete stored tokens on sign-out |
| `query-result` | main → overlay | `QueryResponse` | Push beacon steps + speech to overlay |
| `query-error` | main → overlay | `string` (detail) | Push error message to overlay |

---

## Sub-Task 1 — Preload Bridge Extension

**Intent**: Expose the new IPC channels to the renderer without leaking token
values directly. The renderer asks for the access token by channel; the main
process retrieves it from `safeStorage` and returns it. Auth routes call
`store-tokens` and `clear-tokens`.

**Expected Outcomes**
- `window.api.storeTokens(tokens)` stores both tokens via IPC
- `window.api.getAccessToken()` returns the decrypted access token string
- `window.api.clearTokens()` deletes both stored tokens
- `window.api.onQueryResult(cb)` subscribes to query result push events
- `window.api.onQueryError(cb)` subscribes to query error push events
- All new methods are typed in `index.d.ts`

**Todo**
- [ ] Add `store-tokens` handler in `src/main/index.ts` — encrypt + write to
      a `tokens.json` in `app.getPath('userData')` via `safeStorage`
- [ ] Add `get-access-token` handler — decrypt + return access token string or null
- [ ] Add `clear-tokens` handler — delete the tokens file
- [ ] Add `query-result` / `query-error` push listeners in preload using
      `ipcRenderer.on()` with unsubscribe cleanup (same pattern as `onCaptureStart`)
- [ ] Extend `window.api` in `src/preload/index.ts` with all new methods
- [ ] Add type declarations in `src/preload/index.d.ts`

**Relevant Context**
- Existing push event pattern: `onCaptureStart` / `onCaptureEnd` in `index.ts`
- `safeStorage` is available in `electron` package — import in main
- Token file path: `path.join(app.getPath('userData'), 'tokens.enc.json')`
- `safeStorage` methods: `encryptString(str)` → Buffer, `decryptString(buf)` → string

**Status** — `[ ] pending`

---

## Sub-Task 2 — API Client (Renderer)

**Intent**: Create a single typed fetch wrapper in the renderer that all pages
use to call the backend. It attaches the Bearer token automatically, handles
401 → refresh → retry once, and throws typed errors the pages can display.

**Expected Outcomes**
- `src/renderer/src/lib/api.ts` exports `apiClient` with methods for every
  backend endpoint the renderer calls directly
- A 401 automatically triggers `POST /auth/refresh`, stores the new tokens via
  `window.api.storeTokens()`, and retries the original request
- If refresh also returns 401, tokens are cleared and an `AuthError` is thrown
  so the caller can redirect to sign-in
- All response shapes are typed (re-use or mirror the backend schemas)

**Todo**
- [ ] Create `src/renderer/src/lib/api.ts`
- [ ] Implement `request(path, options)` private helper — reads token via
      `window.api.getAccessToken()`, sets `Authorization: Bearer`, calls `fetch`
- [ ] Implement refresh intercept — on 401, call `POST /auth/refresh`, store
      new tokens, retry original request once
- [ ] Export typed methods:
      `signup(body)`, `signin(body)`, `refresh(token)`, `signout(token)`,
      `getMe()`, `getSettings()`, `patchSettings(partial)`
- [ ] Export `AuthError` class for sign-in failure and session expiry
- [ ] `VITE_API_BASE_URL` read from `import.meta.env.VITE_API_BASE_URL` with
      `http://localhost:8000` fallback

**Relevant Context**
- No HTTP library in `package.json` — use the browser native `fetch` API
  (available in Electron renderer via Chromium)
- Backend base path: `/api/v1/`
- `TokenResponse` shape: `{ access_token, refresh_token, token_type }`
- `QueryResponse` shape: `{ transcript, steps, summary, speech_b64, benchmark }`

**Status** — `[ ] pending`

---

## Sub-Task 3 — Auth Page Wiring

**Intent**: Replace the stub `onComplete()` call in AuthPage with real
signup/signin API calls. On success, store the tokens and advance onboarding.
Show inline validation errors on failure.

**Expected Outcomes**
- Signup calls `POST /auth/signup` with email, full_name, password, language,
  device_id (`"electron-linux"` / `"electron-mac"` / `"electron-win"`)
- Signin calls `POST /auth/signin` with email and password
- On success: tokens stored via `window.api.storeTokens()`, `onComplete()` called
- 409 on signup shows "An account with this email already exists."
- 401 on signin shows "Invalid email or password."
- Submit button shows a loading spinner during the request
- Network error shows a generic "Could not connect to server" message

**Todo**
- [ ] Add `isLoading` and `error` state to `AuthPage`
- [ ] `onSubmit` calls `api.signup()` or `api.signin()` depending on active tab
- [ ] On success: `window.api.storeTokens(response)` then `onComplete()`
- [ ] Map HTTP error codes to user-facing messages
- [ ] Disable submit button and show spinner while `isLoading`
- [ ] `device_id` derived from `process.platform` — pass as static string

**Relevant Context**
- `AuthPage` file: `src/renderer/src/pages/AuthPage.tsx`
- `onSubmit` stub: line 158 — `e.preventDefault(); onComplete()`
- Language dropdown already renders values matching backend language codes
- `process.platform` is available in the renderer via Vite's define config or
  via a preload-exposed constant

**Status** — `[ ] pending`

---

## Sub-Task 4 — Capture Pipeline (Main Process)

**Intent**: Wire the `capture-done` TODO in `src/main/index.ts` to the full
backend query pipeline. When the user completes a capture, the main process
records audio, bundles it with the screenshot, calls `POST /api/v1/query`, and
pushes the result to the overlay renderer via `query-result` IPC.

**Expected Outcomes**
- `capture-done` handler records a short WAV/WebM audio clip from the
  microphone (using the Electron renderer's MediaRecorder or a Node audio lib)
- Main process calls `POST /api/v1/query` with `multipart/form-data`:
  `audio` (file), `screenshot` (base64 string), `language` (from settings)
- Bearer token fetched via `safeStorage` directly in main (no IPC round-trip)
- On success: `query-result` IPC pushed to overlay renderer window
- On 401: token refresh attempted once, then retry
- On failure: `query-error` IPC pushed to overlay renderer
- Loading state sent to overlay while request is in-flight

**Todo**
- [ ] In `src/main/index.ts`, after `endCapture()` is called, start mic
      recording via the overlay renderer's `MediaRecorder` (IPC-triggered) or
      a Node audio capture library
- [ ] Collect audio bytes + screenshot dataURL from `capture-done` payload
- [ ] Read access token via `safeStorage` directly in main
- [ ] Implement `callQuery(audioBlob, screenshotB64, language)` helper in main
      using Node `fetch` (available in Electron ≥ 21 via global `fetch`)
- [ ] On 401: read refresh token, call `/auth/refresh`, store new tokens,
      retry once
- [ ] Push result via `overlayWin.webContents.send('query-result', data)`
- [ ] Push error via `overlayWin.webContents.send('query-error', message)`

**Relevant Context**
- `capture-done` listener: `src/main/index.ts` line 362
- `endCapture()` function: lines 280–291
- `overlayWin` variable: returned from `getOrCreateOverlayWindow()`
- Screenshot is already captured in `triggerCapture()` as `dataURL` — pass it
  through the `capture-done` payload or store in module scope between events
- Global `fetch` is available in Electron main process (Chromium runtime)
- Audio: the simplest approach is to have the overlay renderer record audio
  during the capture window and send bytes back via IPC with `capture-done`

**Status** — `[ ] pending`

---

## Sub-Task 5 — Overlay Response UI

**Intent**: Replace the drag-select overlay UI with a two-phase overlay:
(1) loading spinner while the query is in-flight, (2) beacon dots at the
coordinates returned by the backend + audio playback of `speech_b64`.

**Expected Outcomes**
- While query is in-flight: full-screen frozen screenshot + centred spinner
- On `query-result`: beacon dots rendered at fractional coordinates scaled to
  screen dimensions, pulsing with the same `#6c63ff` brand colour
- `speech_b64` decoded and played via Web Audio API immediately on receipt
- On `query-error`: brief error toast at top of screen, then overlay hides
- Escape key still cancels at any point

**Todo**
- [ ] Add `overlayState` to `OverlayWidget`:
      `'idle' | 'capturing' | 'loading' | 'result' | 'error'`
- [ ] Subscribe to `window.api.onQueryResult(cb)` and `window.api.onQueryError(cb)`
      in `useEffect` with cleanup unsubscribers
- [ ] Remove drag-select mouse event handlers (mousedown/mousemove/mouseup)
- [ ] Render loading spinner when `overlayState === 'loading'`
- [ ] Render `BeaconDot` components mapped from `steps[]` in result:
      position calculated as `step.x * screenWidth`, `step.y * screenHeight`
      with `step.w * screenWidth`, `step.h * screenHeight` bounding box
- [ ] Play audio: decode `speech_b64` → `ArrayBuffer` → `AudioContext.decodeAudioData` → play
- [ ] Auto-hide overlay after 4 seconds or on next keypress
- [ ] `BeaconDot` component: pulsing circle + step number label

**Relevant Context**
- `OverlayWidget.tsx`: `src/renderer/src/overlay/OverlayWidget.tsx`
- Existing `capture-start` / `capture-end` IPC subscriptions: lines 35–56
- Existing drag-select logic to remove: lines 80–140 approx
- `CaptureRegion` type: `{ x, y, w, h }` — fractional in backend, pixel-based
  in current Electron code — note the difference
- Screen dimensions: `window.screen.width` / `window.screen.height` in renderer

**Status** — `[ ] pending`

---

## Sub-Task 6 — Settings Sync + Account Card

**Intent**: SettingsPage reads and writes user settings from the backend.
The account card shows the real signed-in user's name and email. Local JSON
remains as the offline fallback.

**Expected Outcomes**
- On mount: `GET /api/v1/users/me/settings` merged over local settings
- Every `update(key, value)` call also fires `PATCH /api/v1/users/me/settings`
- `GET /api/v1/users/me` populates the account card (real name + email)
- If backend is unreachable, settings fall back to local JSON silently
- `voice_gender` field added to `AppSettings` type and settings UI:
  a toggle or segmented control — "Female" / "Male"

**Todo**
- [ ] In `SettingsPage.tsx`, after loading local settings, call
      `api.getSettings()` and merge remote over local
- [ ] After every `update()`, call `api.patchSettings({ [key]: value })`
      fire-and-forget (don't block UI on it)
- [ ] Call `api.getMe()` on mount, store `{ email, full_name }` in state,
      render in account card replacing hardcoded values
- [ ] Add `voice_gender: 'female' | 'male'` to `AppSettings` type in
      `src/preload/index.d.ts` with default `'female'`
- [ ] Add Voice Gender toggle to SettingsPage UI (Female / Male label)
- [ ] Map camelCase `AppSettings` keys ↔ snake_case backend keys in the
      API client layer (e.g. `overlayOpacity` ↔ `overlay_opacity`)

**Relevant Context**
- `SettingsPage.tsx`: `src/renderer/src/pages/SettingsPage.tsx`
- `getSettings()` / `saveSettings()` IPC: already wired, reads from local JSON
- Hardcoded account: search for "amara@studio.com" in SettingsPage
- `AppSettings` type: defined in `src/preload/index.d.ts`
- Backend settings keys are snake_case; Electron uses camelCase — mapping
  must happen in `src/renderer/src/lib/api.ts`

**Status** — `[ ] pending`

---

## Sub-Task 7 — Sign-Out

**Intent**: Sign-out clears tokens locally, revokes the refresh token on the
server, and resets the onboarding flow so the user lands back on the auth page.

**Expected Outcomes**
- `window.api.signOut()` (already wired to a button) calls `POST /auth/signout`
  with the stored refresh token, then calls `clear-tokens` IPC
- Main process closes settings window, unregisters global shortcut, reopens
  the onboarding window (existing behaviour kept intact)
- On next app launch with no valid token: onboarding starts at `'auth'` step

**Todo**
- [ ] In `src/main/index.ts`, `sign-out` handler: read refresh token from
      `safeStorage`, call `POST /auth/signout` (fire-and-forget, don't block
      UI on network), then clear tokens
- [ ] On app launch: read access token from `safeStorage`; if present and
      not expired (decode JWT exp), skip `'auth'` step and start at
      `'permissions'`; if absent or expired attempt refresh; if refresh fails,
      start at `'auth'`
- [ ] Pass `initialStep` prop to `App.tsx` so the onboarding state machine can
      start at `'permissions'` or `'shortcut'` for already-authenticated users

**Relevant Context**
- `sign-out` handler: `src/main/index.ts` — closes settings, unregisters
  shortcut, destroys windows, calls `createWindow()` to reopen onboarding
- `App.tsx` OnboardingStep union: `'auth' | 'permissions' | 'shortcut'`
- JWT decode for expiry check: use `atob()` on the payload segment (no library
  needed — just split on `.` and JSON.parse the base64 middle segment)

**Status** — `[ ] pending`

---

## Dependency Order

```
Sub-Task 1 (preload bridge)
    └─> Sub-Task 2 (api client)
            ├─> Sub-Task 3 (auth page)
            │       └─> Sub-Task 7 (sign-out)
            ├─> Sub-Task 4 (capture pipeline)
            │       └─> Sub-Task 5 (overlay UI)
            └─> Sub-Task 6 (settings sync)
```

Sub-Tasks 3, 4, and 6 can be worked in parallel once Sub-Tasks 1 and 2 are done.
Sub-Task 5 depends only on Sub-Task 4's IPC channels being defined.
Sub-Task 7 depends on Sub-Task 3 (tokens must exist before sign-out can revoke them).
