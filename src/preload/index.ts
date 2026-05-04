import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  selectWorkspace: () => ipcRenderer.invoke('select-workspace'),
  runGemini: (workspace: string, prompt: string) => ipcRenderer.invoke('run-gemini', workspace, prompt),
  cancelGemini: () => ipcRenderer.invoke('cancel-gemini'),
  getDiff: (workspace: string) => ipcRenderer.invoke('get-diff', workspace),
  
  onGeminiOutput: (callback: (data: string) => void) => {
    ipcRenderer.on('gemini-output', (_event, data) => callback(data))
  },
  onGeminiError: (callback: (error: string) => void) => {
    ipcRenderer.on('gemini-error', (_event, error) => callback(error))
  },
  onGeminiExit: (callback: (code: number | null) => void) => {
    ipcRenderer.on('gemini-exit', (_event, code) => callback(code))
  },
  removeListeners: () => {
    ipcRenderer.removeAllListeners('gemini-output')
    ipcRenderer.removeAllListeners('gemini-error')
    ipcRenderer.removeAllListeners('gemini-exit')
  }
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
