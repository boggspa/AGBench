import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { spawn, exec, ChildProcess } from 'child_process'
import icon from '../../resources/icon.png?asset'

let mainWindow: BrowserWindow | null = null
let geminiProcess: ChildProcess | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
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

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC Handlers
  ipcMain.handle('select-workspace', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  ipcMain.handle('run-gemini', async (event, workspace: string, prompt: string) => {
    if (geminiProcess) {
      geminiProcess.kill()
      geminiProcess = null
    }

    // Safety checks could go here (e.g. checking denylist). 
    // The UI handles path selection, but we could enforce it further.

    // Using shell: true so it picks up the user's PATH (important for global npm/cargo binaries)
    geminiProcess = spawn('gemini', ['-p', prompt, '--output-format', 'stream-json'], {
      cwd: workspace,
      shell: true, 
      env: { ...process.env, FORCE_COLOR: '0' } // Ensure plain text where possible
    })

    geminiProcess.stdout?.on('data', (data) => {
      event.sender.send('gemini-output', data.toString())
    })

    geminiProcess.stderr?.on('data', (data) => {
      event.sender.send('gemini-error', data.toString())
    })

    geminiProcess.on('close', (code) => {
      event.sender.send('gemini-exit', code)
      geminiProcess = null
    })

    geminiProcess.on('error', (err) => {
      event.sender.send('gemini-error', `Failed to start process: ${err.message}`)
      event.sender.send('gemini-exit', -1)
      geminiProcess = null
    })
  })

  ipcMain.handle('cancel-gemini', async () => {
    if (geminiProcess) {
      geminiProcess.kill()
      geminiProcess = null
    }
  })

  ipcMain.handle('get-diff', async (_, workspace: string) => {
    return new Promise((resolve) => {
      // Execute git diff --no-ext-diff
      exec('git status -s && echo "---" && git diff --no-ext-diff', { cwd: workspace }, (error, stdout, stderr) => {
        if (error) {
          if (stderr.includes('not a git repository')) {
            resolve('Not a git repository. Cannot show diff.')
            return
          }
          resolve(`Error getting diff: ${stderr || error.message}`)
          return
        }
        resolve(stdout || 'No changes detected.')
      })
    })
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
