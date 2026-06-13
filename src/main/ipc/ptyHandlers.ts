import { ipcMain } from 'electron'
import * as pty from 'node-pty'
import os from 'os'
import { optionalString } from '../settings/MainSanitizers'
import type { AgenticServiceId, ProviderId } from '../store/types'

/**
 * Trust Assistant PTY handlers (`start-pty`, `stop-pty`, `pty-write`,
 * `pty-resize`) — the first slice carved out of the ~21k-line main-process
 * IPC god-module in index.ts. Lifted verbatim from the `app.whenReady()`
 * block; behavior is unchanged.
 *
 * The two per-session collections (`ptyProcesses` / `stoppedPtySessions`)
 * were already PTY-local in index.ts (no other handler touched them) and
 * move here intact. The two index-local collaborators the handlers close
 * over — `requireRegisteredWorkspace` and `requestAgenticServiceApproval` —
 * are injected via {@link PtyHandlerDeps} so this module never imports back
 * into index.ts (no import cycle).
 *
 * `ipcMain` is the same Electron singleton that `installIpcValidation(ipcMain)`
 * patches in index.ts before any registration runs, so every channel below
 * still flows through `validateIpcArgs`. `IpcValidation.test.ts` statically
 * scans `src/main/ipc/*.ts` in addition to index.ts, so these channels' arg
 * schemas stay enforced at build time.
 */
export interface PtyHandlerDeps {
  requireRegisteredWorkspace: (workspacePath: string, label?: string) => string
  requestAgenticServiceApproval: (
    sender: Electron.WebContents | null,
    provider: ProviderId,
    service: AgenticServiceId,
    workspacePath: string | undefined,
    request: {
      method: string
      title: string
      body: string
      preview?: unknown
    }
  ) => Promise<boolean>
}

export function registerPtyHandlers(deps: PtyHandlerDeps): void {
  const { requireRegisteredWorkspace, requestAgenticServiceApproval } = deps

  // PTY for Trust Assistant
  const ptyProcesses = new Map<string, pty.IPty>()
  const stoppedPtySessions = new Set<string>()

  ipcMain.handle(
    'start-pty',
    async (event, workspacePath: string, sessionId: string = 'default') => {
      const registeredWorkspace = requireRegisteredWorkspace(workspacePath)
      const ptySessionId = optionalString(sessionId) || 'default'
      stoppedPtySessions.delete(ptySessionId)
      const allowed = await requestAgenticServiceApproval(
        event.sender,
        'gemini',
        'shellCommands',
        registeredWorkspace,
        {
          method: 'pty/start',
          title: 'Approve setup terminal',
          body: `${registeredWorkspace}\n${process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : 'bash')}`,
          preview: {
            kind: 'terminal',
            workspacePath: registeredWorkspace,
            sessionId: ptySessionId
          }
        }
      )
      if (!allowed) {
        event.sender.send(
          'pty-data',
          'Terminal start denied by TaskWraith approval policy.\r\n',
          ptySessionId
        )
        event.sender.send('pty-exit', -1, ptySessionId)
        return
      }
      if (stoppedPtySessions.delete(ptySessionId)) {
        event.sender.send('pty-exit', null, ptySessionId)
        return
      }

      const existing = ptyProcesses.get(ptySessionId)
      if (existing) {
        existing.kill()
        ptyProcesses.delete(ptySessionId)
      }

      const shellCommand =
        os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash'

      const ptyProcess = pty.spawn(shellCommand, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: registeredWorkspace,
        env: process.env as Record<string, string>
      })
      ptyProcesses.set(ptySessionId, ptyProcess)

      ptyProcess.onData((data) => {
        event.sender.send('pty-data', data, ptySessionId)
      })

      ptyProcess.onExit((e) => {
        event.sender.send('pty-exit', e.exitCode, ptySessionId)
        if (ptyProcesses.get(ptySessionId) === ptyProcess) {
          ptyProcesses.delete(ptySessionId)
        }
      })
    }
  )

  ipcMain.handle('stop-pty', (_, sessionId: string = 'default') => {
    const ptySessionId = optionalString(sessionId) || 'default'
    const ptyProcess = ptyProcesses.get(ptySessionId)
    if (ptyProcess) {
      ptyProcess.kill()
      ptyProcesses.delete(ptySessionId)
    } else {
      stoppedPtySessions.add(ptySessionId)
    }
  })

  ipcMain.handle('pty-write', (_, data: string, sessionId: string = 'default') => {
    const ptyProcess = ptyProcesses.get(optionalString(sessionId) || 'default')
    if (ptyProcess) {
      ptyProcess.write(data)
    }
  })

  ipcMain.handle('pty-resize', (_, cols: number, rows: number, sessionId: string = 'default') => {
    const ptyProcess = ptyProcesses.get(optionalString(sessionId) || 'default')
    if (ptyProcess) {
      ptyProcess.resize(cols, rows)
    }
  })
}
