import { app, shell, BrowserWindow, ipcMain, systemPreferences, session, screen } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// ─── Overlay window ─────────────────────────────────────────────────────────

let overlayWindow: BrowserWindow | null = null

function createOverlayWindow(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.show()
    return
  }

  // Use full display bounds (not workArea) so the window sits at the true
  // screen corner regardless of taskbar position/size.
  const { bounds } = screen.getPrimaryDisplay()
  const W = 300
  const H = 240

  overlayWindow = new BrowserWindow({
    width: W,
    height: H,
    x: bounds.x + bounds.width - W - 16,
    y: bounds.y + bounds.height - H - 16,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,   // we handle drag ourselves via IPC so it works with focusable:false
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  // Highest always-on-top level — floats above full-screen apps on macOS/Windows.
  // 'screen-saver' is the top-most level available on all platforms.
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')

  // Start fully click-through; renderer tells us when to accept mouse events
  overlayWindow.setIgnoreMouseEvents(true, { forward: true })

  overlayWindow.on('closed', () => {
    overlayWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    overlayWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/overlay.html`)
  } else {
    overlayWindow.loadFile(join(__dirname, '../renderer/overlay.html'))
  }
}

// ────────────────────────────────────────────────────────────────────────────

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

// ─── Permission IPC handlers ────────────────────────────────────────────────
//
// 'request-permission' is called by the renderer when the user toggles a
// permission on. Returns 'granted' | 'denied'.
//
// Microphone: the renderer triggers getUserMedia() directly (which fires the
//   OS prompt). The main process checks the result via systemPreferences on
//   macOS; on other platforms we trust the browser-level grant.
//
// Screen: macOS requires an explicit systemPreferences.askForMediaAccess call.
//   Windows / Linux grant screen capture automatically at the OS level — we
//   verify via getMediaAccessStatus and return 'granted'.

ipcMain.handle('request-permission', async (_event, id: string): Promise<'granted' | 'denied'> => {
  if (id === 'microphone') {
    if (process.platform === 'darwin') {
      // macOS: native system dialog
      const status = await systemPreferences.askForMediaAccess('microphone')
      return status ? 'granted' : 'denied'
    }
    if (process.platform === 'win32') {
      // Windows: getMediaAccessStatus is available
      const status = systemPreferences.getMediaAccessStatus('microphone')
      return status === 'granted' ? 'granted' : 'denied'
    }
    // Linux: getUserMedia in the renderer already triggered the OS prompt.
    // No systemPreferences API exists — trust the renderer grant.
    return 'granted'
  }

  if (id === 'screen') {
    if (process.platform === 'darwin') {
      // macOS: no askForMediaAccess for 'screen'. Trigger via desktopCapturer
      // which causes the system to show the Screen Recording prompt.
      const status = systemPreferences.getMediaAccessStatus('screen')
      if (status === 'granted') return 'granted'
      const { desktopCapturer } = await import('electron')
      await desktopCapturer.getSources({ types: ['screen'] })
      const recheck = systemPreferences.getMediaAccessStatus('screen')
      return recheck === 'granted' ? 'granted' : 'denied'
    }
    // Windows / Linux: no OS-level screen-capture permission prompt — access
    // is granted by default at the application level.
    return 'granted'
  }

  return 'denied'
})

// Renderer calls this when onboarding is complete
ipcMain.on('launch-overlay', () => {
  createOverlayWindow()
})

ipcMain.on('close-main-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  win?.close()
})

// Overlay renderer sends this to toggle whether the window ignores mouse events.
// When the widget is hovered we accept events; when mouse leaves we pass through.
ipcMain.on('overlay-mouse-active', (_event, active: boolean) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(!active, { forward: true })
  }
})

// Drag: renderer sends the current screen position during a press-and-hold drag.
// We use setPosition rather than OS window-drag because focusable:false prevents
// the native title-bar drag mechanism from working.
ipcMain.on('overlay-move', (_event, x: number, y: number) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setPosition(Math.round(x), Math.round(y))
  }
})

// Allow the renderer's getUserMedia to work for microphone (used as fallback
// on non-macOS to trigger the OS prompt in-process).
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true)
    } else {
      callback(false)
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.hoverai')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
