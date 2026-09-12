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
} from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// ─── Settings store ───────────────────────────────────────────────────────────

export type AppSettings = {
  launchAtLogin: boolean
  showInTaskbar: boolean
  overlayOpacity: number       // 0.4 – 1.0
  overlaySize: 'compact' | 'default' | 'large'
  micSensitivity: number       // 1 – 10
  soundEffects: boolean
  notifications: boolean
}

const DEFAULT_SETTINGS: AppSettings = {
  launchAtLogin: false,
  showInTaskbar: false,
  overlayOpacity: 1,
  overlaySize: 'default',
  micSensitivity: 5,
  soundEffects: true,
  notifications: true,
}

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
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

function createTray(onOpenOverlay: () => void, onQuit: () => void): void {
  if (tray) return

  const icon = createTrayIcon()
  tray = new Tray(icon)
  tray.setToolTip('HoverAI — press the registered shortcut to capture')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'HoverAI',
      enabled: false,
      // Shown as a non-clickable header
    },
    { type: 'separator' },
    {
      label: 'Show overlay',
      click: onOpenOverlay,
    },
    {
      label: 'Hide overlay',
      click: () => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.hide()
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit HoverAI',
      click: onQuit,
    },
  ])

  tray.setContextMenu(contextMenu)

  // Left-click on the tray icon toggles the overlay (Windows / Linux behaviour)
  // On macOS left-click shows the context menu by default; this is fine.
  tray.on('click', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      if (overlayWindow.isVisible()) {
        overlayWindow.hide()
      } else {
        overlayWindow.show()
      }
    } else {
      onOpenOverlay()
    }
  })
}

// ─── Overlay / capture window ─────────────────────────────────────────────────

let overlayWindow: BrowserWindow | null = null
let overlayReady = false   // true once the renderer has finished loading

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

// Renderer signals capture is done (selection made or cancelled)
ipcMain.on('capture-done', (_event, result: { x: number; y: number; w: number; h: number } | null) => {
  endCapture()
  if (result) {
    // TODO: pass the selected region to AI processing
    console.log('[capture] region selected:', result)
  }
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

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media')
  })
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.hoverai')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

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
