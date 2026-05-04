import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      selectWorkspace: () => Promise<string | null>
      runGemini: (workspace: string, prompt: string) => Promise<void>
      cancelGemini: () => Promise<void>
      getDiff: (workspace: string) => Promise<string>
      onGeminiOutput: (callback: (data: string) => void) => void
      onGeminiError: (callback: (error: string) => void) => void
      onGeminiExit: (callback: (code: number | null) => void) => void
      removeListeners: () => void
    }
  }
}
