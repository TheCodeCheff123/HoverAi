import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      openExternal: (url: string) => Promise<void>
      requestPermission: (id: string) => Promise<'granted' | 'denied'>
      launchOverlay: () => void
      overlayMouseActive: (active: boolean) => void
      overlayMove: (x: number, y: number) => void
    }
  }
}
