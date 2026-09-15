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

export type AgentAction = {
  action: 'click' | 'double_click' | 'right_click' | 'type' | 'key' | 'scroll'
  instruction: string
  x: number
  y: number
  w: number
  h: number
  text?: string | null
  keys?: string | null
  direction?: 'up' | 'down' | null
  amount?: number | null
}

export type AgentResponse = {
  session_id: string
  action: AgentAction | null
  summary: string
  speech_b64: string
  done: boolean
  turn: number
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
      moveMouse: (x: number, y: number) => void
      takeScreenshot: () => Promise<string>
      // Push listeners — overlay subscribes to agent pipeline results
      onCaptureStart: (cb: (screenshotDataUrl: string, shortcutKey: string) => void) => () => void
      onCaptureEnd: (cb: () => void) => () => void
      captureDone: (result: CaptureDonePayload) => void
      onAgentTurn: (cb: (resp: AgentResponse) => void) => () => void
      onAgentDone: (cb: (resp: AgentResponse) => void) => () => void
      onAgentError: (cb: (message: string) => void) => () => void
    }
  }
}
