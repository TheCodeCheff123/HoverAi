import type { ElectronAPI } from '@electron-toolkit/preload'

export type AppSettings = {
  launchAtLogin: boolean
  showInTaskbar: boolean
  overlayOpacity: number
  overlaySize: 'compact' | 'default' | 'large'
  micSensitivity: number
  soundEffects: boolean
  notifications: boolean
  language: string
  wakeWordEnabled: boolean
}

export type CaptureRegion = { x: number; y: number; w: number; h: number }

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      openExternal: (url: string) => Promise<void>
      requestPermission: (id: string) => Promise<'granted' | 'denied'>
      launchOverlay: () => void
      testShortcut: (key: string) => Promise<boolean>
      registerShortcut: (key: string) => Promise<boolean>
      getSettings: () => Promise<AppSettings>
      saveSettings: (settings: AppSettings) => Promise<void>
      getActiveShortcut: () => Promise<string>
      registerShortcutFromSettings: (key: string) => Promise<boolean>
      closeSettingsWindow: () => void
      signOut: () => void
      onCaptureStart: (cb: (screenshotDataUrl: string, shortcutKey: string) => void) => () => void
      onCaptureEnd: (cb: () => void) => () => void
      captureDone: (result: CaptureRegion | null) => void
    }
  }
}
