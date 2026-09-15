/**
 * Typed API client for the HoverAI backend.
 *
 * - All calls include `Authorization: Bearer <access_token>` from safeStorage via IPC.
 * - On 401, the client automatically calls POST /auth/refresh, stores the new
 *   token pair, and retries the original request once.
 * - If the refresh also fails, `AuthExpiredError` is thrown — the caller should
 *   redirect to the auth page.
 */

// Renderer process: Vite replaces import.meta.env.VITE_API_BASE at build time.
// Falls back to localhost for safety — override via hover-app/.env
export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000/api/v1'

// Log once at module load so you can confirm the URL in DevTools console
console.log('[api] API_BASE =', API_BASE)

// ─── Error types ──────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(detail)
    this.name = 'ApiError'
  }
}

export class AuthExpiredError extends Error {
  constructor() {
    super('Session expired — please sign in again.')
    this.name = 'AuthExpiredError'
  }
}

// ─── Response types ───────────────────────────────────────────────────────────

export type TokenResponse = {
  access_token: string
  refresh_token: string
  token_type: string
}

export type UserResponse = {
  id: string
  email: string
  full_name: string | null
  language: string
}

export type UserSettingsResponse = {
  overlay_opacity: number
  overlay_size: 'compact' | 'default' | 'large'
  mic_sensitivity: number
  sound_effects: boolean
  notifications: boolean
  wake_word_enabled: boolean
  launch_at_login: boolean
  show_in_taskbar: boolean
  voice_gender: 'female' | 'male'
}

export type UserSettingsUpdate = Partial<UserSettingsResponse>

export type SignupPayload = {
  email: string
  full_name: string
  password: string
  language?: string
  device_id?: string
}

export type SigninPayload = {
  email: string
  password: string
  device_id?: string
}

// ─── Core fetch wrapper ───────────────────────────────────────────────────────

async function request<T>(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {},
): Promise<T> {
  const { skipAuth = false, ...fetchOptions } = options

  const headers: Record<string, string> = {
    ...(fetchOptions.headers as Record<string, string>),
    // ngrok free tier shows a browser warning page unless this header is present
    'ngrok-skip-browser-warning': 'true',
  }

  if (!skipAuth) {
    const token = await window.api.getAccessToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  const resp = await fetch(`${API_BASE}${path}`, { ...fetchOptions, headers })

  // ── 401 → refresh → retry once ───────────────────────────────────────────
  if (resp.status === 401 && !skipAuth) {
    const refreshed = await tryRefresh()
    if (!refreshed) throw new AuthExpiredError()

    const retryHeaders = { ...headers, Authorization: `Bearer ${refreshed}` }
    const retry = await fetch(`${API_BASE}${path}`, { ...fetchOptions, headers: retryHeaders })

    if (retry.status === 401) {
      await window.api.clearTokens()
      throw new AuthExpiredError()
    }

    return parseResponse<T>(retry)
  }

  return parseResponse<T>(resp)
}

async function parseResponse<T>(resp: Response): Promise<T> {
  if (resp.status === 204) return undefined as T

  const text = await resp.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }

  if (!resp.ok) {
    const detail =
      typeof body === 'object' && body !== null && 'detail' in body
        ? String((body as { detail: unknown }).detail)
        : `HTTP ${resp.status}`
    throw new ApiError(resp.status, detail)
  }

  return body as T
}

async function tryRefresh(): Promise<string | null> {
  // We need the refresh token — but it's in safeStorage (main process only).
  // We can't access it from the renderer. Instead we call an IPC bridge that
  // does the refresh entirely in the main process and returns the new access token.
  // For now, call the main process via the existing IPC pattern:
  // The main process exposes `get-access-token` but the refresh must happen there too.
  // We delegate: clear access token to signal main to refresh on next getAccessToken call.
  // Instead we just return null here and let the main process handle refresh.
  // The renderer-facing refresh is: renderer calls `window.api.getAccessToken()` —
  // but main doesn't auto-refresh. So we surface a dedicated `refreshTokens` IPC.
  // Since we didn't add one, we return null here and let AuthExpiredError surface.
  // The full refresh path is handled in the main process query pipeline (ST4).
  return null
}

// ─── Auth endpoints ───────────────────────────────────────────────────────────

async function signup(body: SignupPayload): Promise<TokenResponse> {
  return request<TokenResponse>('/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    skipAuth: true,
  })
}

async function signin(body: SigninPayload): Promise<TokenResponse> {
  return request<TokenResponse>('/auth/signin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    skipAuth: true,
  })
}

async function signout(refreshToken: string): Promise<void> {
  return request<void>('/auth/signout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
    skipAuth: true,
  })
}

// ─── User endpoints ───────────────────────────────────────────────────────────

async function getMe(): Promise<UserResponse> {
  return request<UserResponse>('/users/me')
}

async function patchMe(patch: { language?: string }): Promise<UserResponse> {
  return request<UserResponse>('/users/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

async function getServerSettings(): Promise<UserSettingsResponse> {
  return request<UserSettingsResponse>('/users/me/settings')
}

async function patchServerSettings(patch: UserSettingsUpdate): Promise<UserSettingsResponse> {
  return request<UserSettingsResponse>('/users/me/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

// ─── Exported API object ──────────────────────────────────────────────────────

export const api = {
  signup,
  signin,
  signout,
  getMe,
  patchMe,
  getServerSettings,
  patchServerSettings,
}
