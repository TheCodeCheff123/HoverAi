import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  systemPreferences,
  session,
  screen,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  desktopCapturer,
  safeStorage,
} from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { mouse, keyboard, straightTo, Point, Button, Key } from '@nut-tree-fork/nut-js'

// Speed up mouse movement — default is very slow
mouse.config.mouseSpeed = 1500

// ─── Config ───────────────────────────────────────────────────────────────────
// VITE_API_BASE is injected by electron-vite's define at build time (from .env).
// Falls back to localhost so the app still works without a .env file in dev.
const API_BASE: string =
  (typeof import.meta !== 'undefined' && (import.meta as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE) ||
  'http://localhost:8000/api/v1'

// ─── Settings store ───────────────────────────────────────────────────────────

export type AppSettings = {
  launchAtLogin: boolean
  showInTaskbar: boolean
  overlayOpacity: number       // 0.4 – 1.0
  overlaySize: 'compact' | 'default' | 'large'
  micSensitivity: number       // 1 – 10
  soundEffects: boolean
  notifications: boolean
  language: string
  wakeWordEnabled: boolean
  voiceGender: 'female' | 'male'
  shortcutKey: string          // persisted accelerator e.g. "CommandOrControl+Shift+H"
}

const DEFAULT_SETTINGS: AppSettings = {
  launchAtLogin: false,
  showInTaskbar: false,
  overlayOpacity: 1,
  overlaySize: 'default',
  micSensitivity: 5,
  soundEffects: true,
  notifications: true,
  language: 'en-pidgin',
  wakeWordEnabled: false,
  voiceGender: 'female',
  shortcutKey: '',
}

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

// ─── Token store (safeStorage) ────────────────────────────────────────────────

function getTokensPath(): string {
  return join(app.getPath('userData'), 'tokens.json')
}

function storeTokens(access: string, refresh: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    // Fallback: store plain (dev machines without keychain support)
    writeFileSync(getTokensPath(), JSON.stringify({ access, refresh }), 'utf-8')
    return
  }
  const payload = JSON.stringify({
    access: safeStorage.encryptString(access).toString('base64'),
    refresh: safeStorage.encryptString(refresh).toString('base64'),
    encrypted: true,
  })
  writeFileSync(getTokensPath(), payload, 'utf-8')
}

function getStoredTokens(): { access: string; refresh: string } | null {
  try {
    const raw = readFileSync(getTokensPath(), 'utf-8')
    const parsed = JSON.parse(raw) as { access: string; refresh: string; encrypted?: boolean }
    if (parsed.encrypted && safeStorage.isEncryptionAvailable()) {
      return {
        access: safeStorage.decryptString(Buffer.from(parsed.access, 'base64')),
        refresh: safeStorage.decryptString(Buffer.from(parsed.refresh, 'base64')),
      }
    }
    return { access: parsed.access, refresh: parsed.refresh }
  } catch {
    return null
  }
}

function clearTokens(): void {
  try { unlinkSync(getTokensPath()) } catch { /* already gone */ }
}

/**
 * Decode the `exp` claim from a JWT without verifying the signature.
 * Used only to check if the access token is still fresh enough to skip re-auth.
 */
function jwtExpiry(token: string): number {
  try {
    const payload = token.split('.')[1]
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as { exp?: number }
    return decoded.exp ?? 0
  } catch {
    return 0
  }
}

function loadSettings(): AppSettings {
  try {
    const raw = readFileSync(getSettingsPath(), 'utf-8')
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function saveSettings(settings: AppSettings): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}

// ─── Tray icon — HoverAI branded PNG from resources/ ─────────────────────────

let tray: Tray | null = null
let settingsWindow: BrowserWindow | null = null

function createTrayIcon(): Electron.NativeImage {
  // resources/icon.png  — 32×32 purple circle with white HoverAI logo mark
  // resources/icon@2x.png — 64×64 for HiDPI displays
  // In dev, __dirname is <project>/out/main; in prod it's inside the asar.
  // electron-builder's asarUnpack: ['resources/**'] keeps resources/ accessible.
  const base = is.dev
    ? join(__dirname, '../../resources')
    : join(process.resourcesPath, 'resources')

  const icon = nativeImage.createFromPath(join(base, 'icon.png'))

  // Provide the @2x variant so Electron picks the right resolution automatically
  icon.addRepresentation({
    scaleFactor: 2,
    buffer: readFileSync(join(base, 'icon@2x.png')),
    width: 64,
    height: 64,
  })

  // macOS: template image lets the OS invert the icon for dark/light menu bar.
  // Our icon has a purple background so we skip template mode — it looks better
  // as a full-colour icon on all platforms.
  return icon
}

let activeShortcutKey = ''

function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 680,
    resizable: false,
    frame: false,
    transparent: false,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  settingsWindow.on('ready-to-show', () => {
    settingsWindow?.show()
  })

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    settingsWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/settings.html`)
  } else {
    settingsWindow.loadFile(join(__dirname, '../renderer/settings.html'))
  }
}

function createTray(_onOpenOverlay: () => void, onQuit: () => void): void {
  if (tray) return

  const icon = createTrayIcon()
  tray = new Tray(icon)
  tray.setToolTip('HoverAI — press the registered shortcut to capture')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'HoverAI',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: openSettingsWindow,
    },
    { type: 'separator' },
    {
      label: 'Stop HoverAI',
      click: onQuit,
    },
  ])

  tray.setContextMenu(contextMenu)

  // Left-click opens Settings (Windows / Linux).
  // On macOS left-click shows the context menu by default — that's fine.
  tray.on('click', () => {
    openSettingsWindow()
  })
}

// ─── Overlay / capture window ─────────────────────────────────────────────────

let overlayWindow: BrowserWindow | null = null
let overlayReady = false   // true once the renderer has finished loading
let lastScreenshot = ''    // dataUrl of the most recent screenshot sent to overlay

function getOrCreateOverlayWindow(): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow

  // Use the display that currently contains the cursor
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { bounds } = display

  overlayWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    // Hidden until an active capture — avoids the black-screen-on-Linux problem
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  overlayReady = false
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayWindow.setIgnoreMouseEvents(true, { forward: true })

  overlayWindow.webContents.once('did-finish-load', () => {
    overlayReady = true
    console.log('[overlay] renderer ready')
  })

  overlayWindow.on('closed', () => {
    overlayWindow = null
    overlayReady = false
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    overlayWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/overlay.html`)
  } else {
    overlayWindow.loadFile(join(__dirname, '../renderer/overlay.html'))
  }

  return overlayWindow
}

// ─── Screen capture ───────────────────────────────────────────────────────────

async function triggerCapture(): Promise<void> {
  console.log('[capture] shortcut fired')

  // Find the display the cursor is currently on
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { bounds, scaleFactor } = display

  console.log('[capture] display bounds:', bounds, 'scaleFactor:', scaleFactor)

  // Take the screenshot BEFORE showing the overlay so we get the real desktop.
  // thumbnailSize must be in physical pixels (CSS pixels × scaleFactor).
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(bounds.width * scaleFactor),
      height: Math.round(bounds.height * scaleFactor),
    },
  })

  console.log('[capture] sources found:', sources.length, sources.map(s => s.name))

  // Match the source whose bounds align with the target display
  const source =
    sources.find((s) => {
      // On multi-monitor setups the source id often contains the display index
      // Fallback: just use the first source if only one screen
      return sources.length === 1 || s.display_id === String(display.id)
    }) ?? sources[0]

  if (!source) {
    console.error('[capture] no source found')
    return
  }

  const dataUrl = source.thumbnail.toDataURL()
  lastScreenshot = dataUrl
  console.log('[capture] screenshot dataUrl length:', dataUrl.length)

  const win = getOrCreateOverlayWindow()

  // Reposition to the correct display in case cursor moved since window creation
  win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })

  const sendCapture = () => {
    win.setIgnoreMouseEvents(false)
    win.setFocusable(true)
    win.showInactive()
    win.focus()
    win.webContents.send('capture-start', dataUrl, activeShortcutKey)
    console.log('[capture] capture-start sent to renderer')
  }

  // If renderer isn't ready yet, wait for it
  if (overlayReady) {
    sendCapture()
  } else {
    console.log('[capture] waiting for renderer to be ready...')
    win.webContents.once('did-finish-load', sendCapture)
  }
}

// ─── Query pipeline ───────────────────────────────────────────────────────────

async function refreshAccessToken(): Promise<string | null> {
  const tokens = getStoredTokens()
  if (!tokens?.refresh) return null
  try {
    const resp = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: tokens.refresh }),
    })
    if (!resp.ok) {
      clearTokens()
      return null
    }
    const data = await resp.json() as { access_token: string; refresh_token: string }
    storeTokens(data.access_token, data.refresh_token)
    return data.access_token
  } catch {
    return null
  }
}

async function fetchWithAuth(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let token = getStoredTokens()?.access ?? null
  let resp = await fetch(url, {
    ...init,
    headers: { ...init.headers as Record<string, string>, Authorization: `Bearer ${token}` },
  })
  if (resp.status === 401) {
    token = await refreshAccessToken()
    if (!token) return resp  // caller handles unauthenticated
    resp = await fetch(url, {
      ...init,
      headers: { ...init.headers as Record<string, string>, Authorization: `Bearer ${token}` },
    })
  }
  return resp
}

// ─── Agent pipeline helpers ───────────────────────────────────────────────────

/**
 * Parse a key combo string like "Ctrl+S", "Win+D", "Alt+F4" into nut-js Key values.
 * Falls back to an empty array if a token can't be resolved.
 */
function parseKeys(combo: string): Key[] {
  const map: Record<string, Key> = {
    ctrl: Key.LeftControl, control: Key.LeftControl,
    shift: Key.LeftShift,
    alt: Key.LeftAlt,
    win: Key.LeftWin, windows: Key.LeftWin, super: Key.LeftSuper, cmd: Key.LeftCmd,
    tab: Key.Tab, enter: Key.Return, return: Key.Return,
    backspace: Key.Backspace, delete: Key.Delete, escape: Key.Escape, esc: Key.Escape,
    space: Key.Space, home: Key.Home, end: Key.End,
    pageup: Key.PageUp, pagedown: Key.PageDown,
    up: Key.Up, down: Key.Down, left: Key.Left, right: Key.Right,
    f1: Key.F1, f2: Key.F2, f3: Key.F3, f4: Key.F4,
    f5: Key.F5, f6: Key.F6, f7: Key.F7, f8: Key.F8,
    f9: Key.F9, f10: Key.F10, f11: Key.F11, f12: Key.F12,
  }
  return combo.split('+').map((token) => {
    const t = token.trim().toLowerCase()
    if (map[t]) return map[t]
    const upper = token.trim().toUpperCase()
    if (upper in Key) return Key[upper as keyof typeof Key]
    const num = `Num${upper}`
    if (num in Key) return Key[num as keyof typeof Key]
    console.warn(`[agent] unknown key token: "${token}"`)
    return null
  }).filter((k): k is Key => k !== null)
}


type AgentAction = {
  action: 'click' | 'double_click' | 'right_click' | 'type' | 'key' | 'scroll'
  instruction: string
  x: number; y: number; w: number; h: number
  text?: string | null
  keys?: string | null
  direction?: 'up' | 'down' | null
  amount?: number | null
}

type AgentResponse = {
  session_id: string
  action: AgentAction | null
  summary: string
  speech_b64: string
  done: boolean
  turn: number
}

/** Take a fresh screenshot of the display under the cursor and return base64 PNG */
async function captureScreenshot(): Promise<string> {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { bounds, scaleFactor } = display
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(bounds.width * scaleFactor),
      height: Math.round(bounds.height * scaleFactor),
    },
  })
  const source = sources.find((s) =>
    sources.length === 1 || s.display_id === String(display.id)
  ) ?? sources[0]
  if (!source) throw new Error('no screen source found')
  return source.thumbnail.toPNG().toString('base64')
}

async function runAgentPipeline(
  audioData: number[],
  screenshotDataUrl: string,
): Promise<void> {
  console.log('[agent] starting pipeline')
  if (!overlayWindow || overlayWindow.isDestroyed()) return

  const screenshotB64 = nativeImage.createFromDataURL(screenshotDataUrl).toPNG().toString('base64')
  const audioBuffer = Buffer.from(audioData)
  const language = loadSettings().language

  // ── Step 1: POST /agent/start with audio + screenshot + language ────────────
  const boundary = `----HoverAIBoundary${Date.now()}`
  const crlf = '\r\n'
  const parts: Buffer[] = []

  parts.push(Buffer.from(
    `--${boundary}${crlf}` +
    `Content-Disposition: form-data; name="audio"; filename="audio.webm"${crlf}` +
    `Content-Type: audio/webm${crlf}${crlf}`
  ))
  parts.push(audioBuffer)
  parts.push(Buffer.from(crlf))
  parts.push(Buffer.from(
    `--${boundary}${crlf}Content-Disposition: form-data; name="screenshot"${crlf}${crlf}${screenshotB64}${crlf}`
  ))
  parts.push(Buffer.from(
    `--${boundary}${crlf}Content-Disposition: form-data; name="language"${crlf}${crlf}${language}${crlf}`
  ))
  parts.push(Buffer.from(`--${boundary}--${crlf}`))

  let agentResp: AgentResponse
  try {
    const resp = await fetchWithAuth(`${API_BASE}/agent/start`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: Buffer.concat(parts),
    })
    if (!resp.ok) {
      const err = await resp.text().catch(() => `HTTP ${resp.status}`)
      console.error('[agent] start error:', err)
      overlayWindow?.webContents.send('agent-error', `Agent failed: ${err}`)
      return
    }
    agentResp = await resp.json() as AgentResponse
  } catch (err) {
    console.error('[agent] start fetch error:', err)
    overlayWindow?.webContents.send('agent-error', 'Network error — check backend is running.')
    return
  }

  // ── Agent loop ──────────────────────────────────────────────────────────────
  while (true) {
    console.log(`[agent] turn ${agentResp.turn}, done=${agentResp.done}, action=${agentResp.action?.action ?? 'none'}`)

    if (agentResp.done || !agentResp.action) {
      // All done — send final response and break
      overlayWindow?.webContents.send('agent-done', agentResp)
      break
    }

    // Push this turn's action to the overlay so it can show the beacon
    overlayWindow?.webContents.send('agent-turn', agentResp)

    // Execute the action
    let actionResult: 'success' | 'error' = 'success'
    try {
      await executeAction(agentResp.action)
    } catch (err) {
      console.error(`[agent] action failed:`, err)
      actionResult = 'error'
    }

    // Wait 600ms for the OS to process the action
    await new Promise<void>((r) => setTimeout(r, 600))

    // Take a fresh screenshot to show the backend what changed
    let newScreenshotB64: string
    try {
      newScreenshotB64 = await captureScreenshot()
    } catch (err) {
      console.error('[agent] screenshot failed:', err)
      newScreenshotB64 = screenshotB64 // fallback to original
    }

    // POST /agent/turn — must be multipart/form-data, same as /agent/start
    try {
      const turnBoundary = `----HoverAIBoundary${Date.now()}`
      const turnCrlf = '\r\n'
      const turnParts: Buffer[] = []

      turnParts.push(Buffer.from(
        `--${turnBoundary}${turnCrlf}` +
        `Content-Disposition: form-data; name="session_id"${turnCrlf}${turnCrlf}` +
        `${agentResp.session_id}${turnCrlf}`
      ))
      turnParts.push(Buffer.from(
        `--${turnBoundary}${turnCrlf}` +
        `Content-Disposition: form-data; name="screenshot"${turnCrlf}${turnCrlf}` +
        `${newScreenshotB64}${turnCrlf}`
      ))
      turnParts.push(Buffer.from(
        `--${turnBoundary}${turnCrlf}` +
        `Content-Disposition: form-data; name="action_result"${turnCrlf}${turnCrlf}` +
        `${actionResult}${turnCrlf}`
      ))
      turnParts.push(Buffer.from(`--${turnBoundary}--${turnCrlf}`))

      const resp = await fetchWithAuth(`${API_BASE}/agent/turn`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${turnBoundary}` },
        body: Buffer.concat(turnParts),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => `HTTP ${resp.status}`)
        console.error('[agent] turn error:', err)
        overlayWindow?.webContents.send('agent-error', `Agent turn failed: ${err}`)
        return
      }
      agentResp = await resp.json() as AgentResponse
    } catch (err) {
      console.error('[agent] turn fetch error:', err)
      overlayWindow?.webContents.send('agent-error', 'Network error on agent turn.')
      return
    }
  }
}

/** Execute a single AgentAction using nut-js */
async function executeAction(action: AgentAction): Promise<void> {
  const { bounds } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const absX = Math.round(action.x * bounds.width) + bounds.x
  const absY = Math.round(action.y * bounds.height) + bounds.y

  console.log(`[agent] executing ${action.action} at (${absX}, ${absY})`)

  switch (action.action) {
    case 'click':
      await mouse.move(straightTo(new Point(absX, absY)))
      await mouse.leftClick()
      break
    case 'double_click':
      await mouse.move(straightTo(new Point(absX, absY)))
      await mouse.doubleClick(Button.LEFT)
      break
    case 'right_click':
      await mouse.move(straightTo(new Point(absX, absY)))
      await mouse.rightClick()
      break
    case 'type':
      if (action.text) await keyboard.type(action.text)
      break
    case 'key': {
      const keys = parseKeys(action.keys ?? '')
      if (keys.length > 0) await keyboard.type(...keys)
      break
    }
    case 'scroll':
      await mouse.move(straightTo(new Point(absX, absY)))
      if (action.direction === 'up') await mouse.scrollUp(action.amount ?? 3)
      else await mouse.scrollDown(action.amount ?? 3)
      break
  }
}

function endCapture(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  overlayWindow.hide()
  overlayWindow.setIgnoreMouseEvents(true, { forward: true })
  overlayWindow.setFocusable(false)
  overlayWindow.webContents.send('capture-end')
  console.log('[capture] ended')
}

// ─── Main onboarding window ───────────────────────────────────────────────────

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    resizable: false,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ─── Permission IPC handlers ─────────────────────────────────────────────────

ipcMain.handle('request-permission', async (_event, id: string): Promise<'granted' | 'denied'> => {
  if (id === 'microphone') {
    if (process.platform === 'darwin') {
      const status = await systemPreferences.askForMediaAccess('microphone')
      return status ? 'granted' : 'denied'
    }
    if (process.platform === 'win32') {
      const status = systemPreferences.getMediaAccessStatus('microphone')
      return status === 'granted' ? 'granted' : 'denied'
    }
    return 'granted'
  }

  if (id === 'screen') {
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('screen')
      if (status === 'granted') return 'granted'
      const { desktopCapturer } = await import('electron')
      await desktopCapturer.getSources({ types: ['screen'] })
      const recheck = systemPreferences.getMediaAccessStatus('screen')
      return recheck === 'granted' ? 'granted' : 'denied'
    }
    return 'granted'
  }

  return 'denied'
})

// Renderer calls this when onboarding completes — create tray (overlay is on-demand)
ipcMain.on('launch-overlay', () => {
  // Pre-load the overlay window in the background so first capture is instant
  getOrCreateOverlayWindow()
  createTray(() => { /* no-op: overlay has no persistent visible state */ }, () => app.quit())
})

// Renderer signals capture is done — runs the agent pipeline
ipcMain.on(
  'capture-done',
  (_event, payload: { audioData: number[] } | null) => {
    endCapture()
    if (!payload) return
    runAgentPipeline(payload.audioData, lastScreenshot).catch(console.error)
  },
)

// Move the system mouse cursor to fractional screen coordinates
ipcMain.on('move-mouse', (_event, x: number, y: number) => {
  const { bounds } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const absX = Math.round(x * bounds.width) + bounds.x
  const absY = Math.round(y * bounds.height) + bounds.y
  mouse.move(straightTo(new Point(absX, absY))).catch(console.error)
})

// Renderer can request a fresh screenshot (used for future assessment logic)
ipcMain.handle('take-screenshot', async () => {
  return captureScreenshot().catch(() => '')
})

ipcMain.on('close-main-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  win?.close()
})

// ─── Shortcut IPC ─────────────────────────────────────────────────────────────

// Test if a key combo is available without permanently claiming it
ipcMain.handle('test-shortcut', (_event, key: string): boolean => {
  if (!key || key.includes('Unidentified')) return false
  try {
    const ok = globalShortcut.register(key, () => {})
    if (ok) globalShortcut.unregister(key)
    return ok
  } catch {
    return false
  }
})

// Permanently register the user's chosen shortcut
ipcMain.handle('register-shortcut', (_event, key: string): boolean => {
  // Unregister any previously registered shortcut first
  if (activeShortcutKey) {
    globalShortcut.unregister(activeShortcutKey)
    activeShortcutKey = ''
  }
  const ok = globalShortcut.register(key, () => {
    triggerCapture().catch(console.error)
  })
  if (ok) {
    activeShortcutKey = key
    saveSettings({ ...loadSettings(), shortcutKey: key })
    tray?.setToolTip(`HoverAI — press ${key} to capture`)
    console.log(`[shortcut] registered: ${key}`)
  }
  return ok
})

// ─── Settings IPC ─────────────────────────────────────────────────────────────

ipcMain.handle('get-settings', (): AppSettings => loadSettings())

ipcMain.handle('save-settings', (_event, settings: AppSettings): void => {
  saveSettings(settings)
  // Apply side-effects immediately
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin })
})

ipcMain.handle('get-active-shortcut', (): string => activeShortcutKey)

ipcMain.on('open-settings', () => {
  openSettingsWindow()
})

ipcMain.on('close-settings-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  win?.close()
})

ipcMain.on('sign-out', async () => {
  // Fire-and-forget: revoke refresh token server-side (don't block on network)
  const tokens = getStoredTokens()
  if (tokens?.refresh) {
    fetch(`${API_BASE}/auth/signout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: tokens.refresh }),
    }).catch(() => { /* ignore network failures on sign-out */ })
  }

  // Always clear local tokens immediately
  clearTokens()

  // Close settings window
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close()
  }
  // Unregister shortcut so onboarding can re-claim it
  if (activeShortcutKey) {
    globalShortcut.unregister(activeShortcutKey)
    activeShortcutKey = ''
  }
  // Re-open the onboarding window (auth page)
  createWindow()
})

ipcMain.handle('register-shortcut-from-settings', (_event, key: string): boolean => {
  if (activeShortcutKey) {
    globalShortcut.unregister(activeShortcutKey)
    activeShortcutKey = ''
  }
  const ok = globalShortcut.register(key, () => {
    triggerCapture().catch(console.error)
  })
  if (ok) {
    activeShortcutKey = key
    saveSettings({ ...loadSettings(), shortcutKey: key })
    tray?.setToolTip(`HoverAI — press ${key} to capture`)
    console.log(`[shortcut] re-registered from settings: ${key}`)
  }
  return ok
})

// ─── Token storage IPC ────────────────────────────────────────────────────────

ipcMain.handle('store-tokens', (_event, access: string, refresh: string): void => {
  storeTokens(access, refresh)
})

ipcMain.handle('get-access-token', (): string | null => {
  const tokens = getStoredTokens()
  return tokens?.access ?? null
})

ipcMain.handle('clear-tokens', (): void => {
  clearTokens()
})

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media')
  })
})

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.hoverai')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // ── Validate token against the server before skipping onboarding ─────────
  // A locally non-expired JWT may still be invalid (e.g. DB was wiped).
  // Always probe GET /users/me — if it 401s or errors, clear tokens and show onboarding.
  const tokens = getStoredTokens()
  const nowSec = Math.floor(Date.now() / 1000)
  const tokenPresent = tokens !== null && jwtExpiry(tokens.access) > nowSec + 60

  let skipOnboarding = false
  if (tokenPresent) {
    try {
      const resp = await fetchWithAuth(`${API_BASE}/users/me`, { method: 'GET' })
      if (resp.ok) {
        console.log('[auth] server confirmed valid token — skipping onboarding')
        skipOnboarding = true
      } else {
        console.log(`[auth] server rejected token (${resp.status}) — clearing and showing onboarding`)
        clearTokens()
      }
    } catch (err) {
      console.log('[auth] could not reach server to validate token — showing onboarding', err)
      clearTokens()
    }
  }

  if (skipOnboarding) {
    // Re-register the saved shortcut so it works without re-opening settings
    const saved = loadSettings()
    if (saved.shortcutKey) {
      const ok = globalShortcut.register(saved.shortcutKey, () => {
        triggerCapture().catch(console.error)
      })
      if (ok) {
        activeShortcutKey = saved.shortcutKey
        console.log(`[shortcut] restored on startup: ${saved.shortcutKey}`)
      } else {
        console.warn(`[shortcut] could not restore ${saved.shortcutKey} — already taken`)
      }
    }
    getOrCreateOverlayWindow()
    createTray(() => {}, () => app.quit())
  } else {
    createWindow()
  }

  app.on('activate', function () {
    // On macOS re-open the onboarding window if all windows are closed
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Don't quit when the onboarding window closes — the tray keeps the app alive.
  // Only quit when explicitly requested via the tray menu.
  if (process.platform !== 'darwin' && !tray) {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
