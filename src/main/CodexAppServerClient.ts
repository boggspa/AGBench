import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { homedir } from 'os'
import { delimiter, join } from 'path'
import { createInterface, type Interface as ReadlineInterface } from 'readline'

type JsonRpcId = number | string

interface PendingRequest {
  resolve: (value: any) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

export interface CodexApprovalResponse {
  requestId: string
  action: 'accept' | 'acceptForSession' | 'decline' | 'cancel'
}

function createCliEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const pathEntries = [
    ...(process.env.PATH || '').split(delimiter),
    join(homedir(), '.local', 'bin'),
    join(homedir(), '.npm-global', 'bin'),
    join(homedir(), '.bun', 'bin'),
    join(homedir(), '.cargo', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ].filter(Boolean)

  return {
    ...process.env,
    PATH: Array.from(new Set(pathEntries)).join(delimiter),
    ...extra
  }
}

export class CodexAppServerClient {
  private proc: ChildProcessWithoutNullStreams | null = null
  private stdoutReader: ReadlineInterface | null = null
  private nextId = 1
  private pending = new Map<JsonRpcId, PendingRequest>()
  private startPromise: Promise<void> | null = null
  private notificationHandler: ((message: any) => void) | null = null
  private requestHandler: ((message: any) => void) | null = null
  private stderrHandler: ((chunk: string) => void) | null = null

  setNotificationHandler(handler: ((message: any) => void) | null) {
    this.notificationHandler = handler
  }

  setRequestHandler(handler: ((message: any) => void) | null) {
    this.requestHandler = handler
  }

  setStderrHandler(handler: ((chunk: string) => void) | null) {
    this.stderrHandler = handler
  }

  async ensureStarted(appVersion: string): Promise<void> {
    if (this.proc && !this.proc.killed) {
      return
    }
    if (this.startPromise) {
      return this.startPromise
    }

    this.startPromise = this.start(appVersion).finally(() => {
      this.startPromise = null
    })
    return this.startPromise
  }

  async request<T = any>(method: string, params: any = {}, timeoutMs = 30_000): Promise<T> {
    if (!this.proc || this.proc.killed || !this.proc.stdin.writable) {
      throw new Error('Codex app-server is not running.')
    }

    const id = this.nextId++
    const payload = { id, method, params }
    const result = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex app-server request timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timeout })
    })
    this.write(payload)
    return result
  }

  notify(method: string, params: any = {}) {
    if (!this.proc || this.proc.killed || !this.proc.stdin.writable) {
      throw new Error('Codex app-server is not running.')
    }
    this.write({ method, params })
  }

  respond(id: JsonRpcId, result: any) {
    if (!this.proc || this.proc.killed || !this.proc.stdin.writable) {
      throw new Error('Codex app-server is not running.')
    }
    this.write({ id, result })
  }

  reject(id: JsonRpcId, message: string) {
    if (!this.proc || this.proc.killed || !this.proc.stdin.writable) {
      throw new Error('Codex app-server is not running.')
    }
    this.write({ id, error: { code: -32000, message } })
  }

  dispose() {
    this.stdoutReader?.close()
    this.stdoutReader = null
    if (this.proc && !this.proc.killed) {
      this.proc.kill()
    }
    this.proc = null
    this.rejectPending(new Error('Codex app-server stopped.'))
  }

  private async start(appVersion: string): Promise<void> {
    this.proc = spawn('codex', ['app-server'], {
      shell: false,
      stdio: 'pipe',
      env: createCliEnv({
        FORCE_COLOR: '0',
        NO_COLOR: '1'
      })
    })

    this.stdoutReader = createInterface({ input: this.proc.stdout })
    this.stdoutReader.on('line', (line) => this.handleLine(line))

    this.proc.stderr.on('data', (chunk) => {
      this.stderrHandler?.(chunk.toString('utf8'))
    })

    this.proc.on('close', (code) => {
      this.stderrHandler?.(`Codex app-server exited with code ${typeof code === 'number' ? code : 'unknown'}.`)
      this.proc = null
      this.stdoutReader?.close()
      this.stdoutReader = null
      this.rejectPending(new Error('Codex app-server exited.'))
    })

    this.proc.on('error', (error) => {
      this.proc = null
      this.rejectPending(error)
    })

    await this.request('initialize', {
      clientInfo: {
        name: 'guigemini',
        title: 'GUIGemini',
        version: appVersion
      },
      capabilities: {
        experimentalApi: true
      }
    }, 15_000)
    this.notify('initialized')
  }

  private handleLine(line: string) {
    if (!line.trim()) return

    let parsed: any
    try {
      parsed = JSON.parse(line)
    } catch {
      this.stderrHandler?.(`Malformed Codex app-server JSON: ${line}`)
      return
    }

    const id = parsed?.id
    if (id !== undefined && (Object.prototype.hasOwnProperty.call(parsed, 'result') || Object.prototype.hasOwnProperty.call(parsed, 'error'))) {
      const pending = this.pending.get(id)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pending.delete(id)
      if (parsed.error) {
        pending.reject(new Error(parsed.error.message || JSON.stringify(parsed.error)))
      } else {
        pending.resolve(parsed.result)
      }
      return
    }

    if (id !== undefined && parsed?.method) {
      this.requestHandler?.(parsed)
      return
    }

    if (parsed?.method) {
      this.notificationHandler?.(parsed)
    }
  }

  private write(payload: any) {
    this.proc?.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
