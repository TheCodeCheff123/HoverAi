import { contextBridge, shell, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  openExternal: (url: string) => shell.openExternal(url),
  requestPermission: (id: string): Promise<'granted' | 'denied'> =>
    ipcRenderer.invoke('request-permission', id),
  launchOverlay: () => ipcRenderer.send('launch-overlay'),
  testShortcut: (key: string): Promise<boolean> => ipcRenderer.invoke('test-shortcut', key),
  registerShortcut: (key: string): Promise<boolean> => ipcRenderer.invoke('register-shortcut', key),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('save-settings', settings),

  // Screen capture
  onCaptureStart: (cb: (screenshotDataUrl: string, shortcutKey: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, dataUrl: string, shortcutKey: string) =>
      cb(dataUrl, shortcutKey)
    ipcRenderer.on('capture-start', handler)
    return () => ipcRenderer.off('capture-start', handler)
  },
  onCaptureEnd: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('capture-end', handler)
    return () => ipcRenderer.off('capture-end', handler)
  },
  captureDone: (result: { x: number; y: number; w: number; h: number } | null) =>
    ipcRenderer.send('capture-done', result),
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
