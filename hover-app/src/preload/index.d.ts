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
  voiceGender: 'female' | 'male'
  shortcutKey: string
}

export type CaptureRegion = { x: number; y: number; w: number; h: number }

export type BeaconStep = {
  step: number
  instruction: string
  keys: string | null
  tip: string | null
}

export type QueryResponse = {
  transcript: string
  steps: BeaconStep[]
  summary: string
  speech_b64: string
  benchmark: Record<string, unknown>
}

export type CaptureDonePayload = {
  audioData: number[]
} | null

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
      // Token storage (safeStorage — main process only)
      storeTokens: (access: string, refresh: string) => Promise<void>
      getAccessToken: () => Promise<string | null>
      clearTokens: () => Promise<void>
      refreshTokens: () => Promise<string | null>
      moveMouse: (x: number, y: number) => void
      takeScreenshot: () => Promise<string>
      // Capture lifecycle
      onCaptureStart: (cb: (screenshotDataUrl: string, shortcutKey: string) => void) => () => void
      onCaptureEnd: (cb: () => void) => () => void
      captureDone: (result: CaptureDonePayload) => void
      // Query pipeline push results
      onQueryResult: (cb: (resp: QueryResponse) => void) => () => void
      onQueryError: (cb: (message: string) => void) => () => void
    }
  }
}
