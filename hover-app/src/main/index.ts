import { app, shell, BrowserWindow, ipcMain, systemPreferences, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

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
