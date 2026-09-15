import { contextBridge, shell, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { CaptureDonePayload, AgentResponse } from './index.d'

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
  getActiveShortcut: (): Promise<string> => ipcRenderer.invoke('get-active-shortcut'),
  registerShortcutFromSettings: (key: string): Promise<boolean> =>
    ipcRenderer.invoke('register-shortcut-from-settings', key),
  closeSettingsWindow: () => ipcRenderer.send('close-settings-window'),
  signOut: () => ipcRenderer.send('sign-out'),

  moveMouse: (x: number, y: number) => ipcRenderer.send('move-mouse', x, y),

  // ── Token storage (delegates to safeStorage in main process) ───────────────
  storeTokens: (access: string, refresh: string): Promise<void> =>
    ipcRenderer.invoke('store-tokens', access, refresh),
  getAccessToken: (): Promise<string | null> => ipcRenderer.invoke('get-access-token'),
  clearTokens: (): Promise<void> => ipcRenderer.invoke('clear-tokens'),

  // ── Screen capture ──────────────────────────────────────────────────────────
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
  captureDone: (result: CaptureDonePayload) => ipcRenderer.send('capture-done', result),
  takeScreenshot: (): Promise<string> => ipcRenderer.invoke('take-screenshot'),

  // ── Agent pipeline push results ─────────────────────────────────────────────
  onAgentTurn: (cb: (resp: AgentResponse) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, resp: AgentResponse) => cb(resp)
    ipcRenderer.on('agent-turn', handler)
    return () => ipcRenderer.off('agent-turn', handler)
  },
  onAgentDone: (cb: (resp: AgentResponse) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, resp: AgentResponse) => cb(resp)
    ipcRenderer.on('agent-done', handler)
    return () => ipcRenderer.off('agent-done', handler)
  },
  onAgentError: (cb: (message: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, message: string) => cb(message)
    ipcRenderer.on('agent-error', handler)
    return () => ipcRenderer.off('agent-error', handler)
  },
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
