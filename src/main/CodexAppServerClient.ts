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

/**
 * Phase I2: Codex's app-server is spawned once per AGBench session
 * (long-lived JSON-RPC daemon). To give Codex agents the same MCP
 * tool surface that Gemini gets — including the new
 * `delegate_to_subthread` tool — we register an inline MCP server via
 * the CLI's `-c mcp_servers.<name>.*` config-override syntax at spawn
 * time. The bridge subprocess inherits AGENTBENCH_PARENT_PROVIDER
 * from the Codex CLI's env (via either process env inheritance OR
 * the explicit `mcp_servers.AGBench.env` config) so it can stamp
 * every broker request with `parentProvider='codex'`. AGBench main
 * then routes the approval modal + audit event to Codex specifically
 * — Gemini's workspace grants don't auto-allow Codex delegation.
 *
 * Callers populate this via `setMcpConfig` before `ensureStarted`.
 * Leaving it null (or `enabled=false`) preserves the pre-I2
 * behaviour: Codex spawns without the AGBench MCP server, so the
 * Codex agent can't call `delegate_to_subthread` — useful when the
 * user has the AGBench MCP bridge toggle disabled.
 */
export interface CodexMcpAgentbenchConfig {
  enabled: boolean
  bridgeBinaryPath: string
  bridgeArgs: string[]
  parentProvider: 'codex'
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

/**
 * Format a JS string for safe embedding inside a TOML double-quoted
 * string (i.e. the value half of a `-c key="value"` Codex CLI
 * override). TOML's basic-string rules require escaping `"` and `\`,
 * plus control characters. The values we feed in here are filesystem
 * paths + hex tokens + CLI flag literals, so we don't expect control
 * chars in practice — but escaping defensively keeps the surface
 * resilient if Electron ever returns a path containing a backslash
 * (notably on Windows builds).
 */
function tomlEscapeString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

/**
 * Build the `-c mcp_servers.AGBench.*` CLI argument list for Codex
 * CLI. Exported so the I2 tests can pin the exact shape of the
 * inline MCP config (TOML escaping + arg order matter). The
 * mixed-case `AGBench` server key matches the registration name
 * the agent sees in its tool list (`AGBench__delegate_to_subthread`);
 * TOML keys are case-sensitive so the casing here must match the
 * `GEMINI_MCP_SERVER_NAME` constant in `index.ts`. The env var stays
 * `AGENTBENCH_PARENT_PROVIDER` to avoid changing the IPC contract
 * between the spawned bridge subprocess and main.
 */
export function buildCodexAgentbenchMcpArgs(config: CodexMcpAgentbenchConfig): string[] {
  if (!config.enabled) return []
  const command = tomlEscapeString(config.bridgeBinaryPath)
  const args = config.bridgeArgs.map((arg) => `"${tomlEscapeString(arg)}"`).join(', ')
  const parentProvider = tomlEscapeString(config.parentProvider)
  return [
    '-c', `mcp_servers.AGBench.command="${command}"`,
    '-c', `mcp_servers.AGBench.args=[${args}]`,
    '-c', `mcp_servers.AGBench.env={ AGENTBENCH_PARENT_PROVIDER = "${parentProvider}" }`
  ]
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
  private mcpConfig: CodexMcpAgentbenchConfig | null = null

  setNotificationHandler(handler: ((message: any) => void) | null) {
    this.notificationHandler = handler
  }

  setRequestHandler(handler: ((message: any) => void) | null) {
    this.requestHandler = handler
  }

  setStderrHandler(handler: ((chunk: string) => void) | null) {
    this.stderrHandler = handler
  }

  /**
   * Phase I2: configure the AGBench MCP server that Codex CLI
   * registers at spawn. Must be called BEFORE `ensureStarted` —
   * once Codex's app-server is running we don't restart it just to
   * pick up new MCP config (Codex would lose its in-flight threads).
   * Pass `null` to clear; the next start spawns without any MCP
   * config overrides. Safe to call multiple times before start.
   */
  setMcpConfig(config: CodexMcpAgentbenchConfig | null): void {
    this.mcpConfig = config
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
    // Phase I2: prepend `-c mcp_servers.AGBench.*` config flags so
    // the Codex CLI registers the AGBench MCP bridge as an MCP server
    // for the whole app-server lifetime. The bridge subprocess
    // inherits AGENTBENCH_PARENT_PROVIDER='codex' from the env map AND
    // from the inline `mcp_servers.AGBench.env` override (belt &
    // braces — Codex CLI strips inherited env from MCP subprocesses
    // on some platforms, so we set it both ways).
    const mcpArgs = buildCodexAgentbenchMcpArgs(this.mcpConfig ?? { enabled: false, bridgeBinaryPath: '', bridgeArgs: [], parentProvider: 'codex' })
    const codexArgs = [...mcpArgs, 'app-server']
    const codexEnv: Record<string, string> = {
      FORCE_COLOR: '0',
      NO_COLOR: '1'
    }
    if (this.mcpConfig?.enabled) {
      codexEnv.AGENTBENCH_PARENT_PROVIDER = this.mcpConfig.parentProvider
    }
    this.proc = spawn('codex', codexArgs, {
      shell: false,
      stdio: 'pipe',
      env: createCliEnv(codexEnv)
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
