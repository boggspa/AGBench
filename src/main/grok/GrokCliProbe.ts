// Pure, dependency-injected probe for the Grok Build CLI.
//
// Kept free of Electron / fs / child_process imports so the parsers are
// directly unit-testable and the orchestrator can run against injected
// fakes (no real process spawned in tests). The real app wires
// `resolveBinary` to resolveCliProviderBinary('grok') and `capture` to
// captureProcessOutput.
//
// READ-ONLY by construction: only `--version` / `--help` style probes,
// always prefixed with `--no-auto-update`. It never runs a prompt, never
// mutates ~/.grok, and never reads credential files. This is the G0
// foundation for the gated Grok provider arc.

export interface GrokProbeFindings {
  probedAt: string
  binaryPath: string | null
  binarySource: string | null
  version: string | null
  versionRaw: string
  topLevelFlags: string[]
  subcommands: string[]
  /**
   * `grok agent stdio --help` is bare on 0.2.3 (only `-h/--help`), so the
   * ACP wire protocol is undocumented at the CLI. This stays false until a
   * future CLI version documents the stdio surface.
   */
  agentStdioDocumented: boolean
  openAcpQuestions: string[]
  errors: string[]
}

/** Minimal shape of resolveCliProviderBinary('grok') — avoids importing the
 *  Electron-heavy index.ts into a pure module / unit test. */
export interface GrokProbeBinary {
  binaryPath: string | null
  source?: string
  error?: string
}

/** Minimal shape of captureProcessOutput's resolved value. */
export interface GrokProbeCaptureResult {
  stdout: string
  stderr: string
  code: number | null
  error?: string
  timedOut?: boolean
}

export interface GrokProbeDeps {
  resolveBinary: () => Promise<GrokProbeBinary>
  capture: (command: string, args: string[]) => Promise<GrokProbeCaptureResult>
}

/**
 * The ACP-spike questions that must be answered before a write-capable Grok
 * adapter (deferred G1/G4/G5). Carried in the probe output so the findings
 * always travel with the open unknowns.
 */
export const GROK_OPEN_ACP_QUESTIONS: readonly string[] = [
  'What exact JSON-RPC methods does `grok agent stdio` require (initialize / session.new / session.prompt / session.update / session.cancel)?',
  'Does session creation accept cwd, model, permission-mode, and MCP servers?',
  'Are assistant deltas delivered only via session/update agent_message_chunk?',
  'Is cancellation a protocol method or process-kill only?',
  'Does ACP expose usage / token metadata?',
  'Does ACP expose a stable, resumable session id?',
  'Are local shell/file operations client callbacks, MCP calls, or Grok-native execution?',
  'Can native write/shell tools be disabled while MCP stays available?',
  'Can the AGBench MCP server be registered per-run without mutating global ~/.grok config?'
]

/** Flag every probe invocation carries to avoid a self-update side effect. */
export const GROK_READ_ONLY_PROBE_FLAG = '--no-auto-update'

/**
 * Extract the semver-ish version from `grok --version` output, e.g.
 * "grok 0.2.3 (14d81fd875e) [stable]" → "0.2.3". Returns null when absent
 * (e.g. "missing" / "unknown").
 */
export function parseGrokVersion(raw: string): string | null {
  if (!raw) return null
  const match = raw.match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/)
  return match ? match[1] : null
}

function extractFlags(text: string): string[] {
  const flags = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    // Only option lines start with a dash; description / value-enum lines do
    // not, so we never pick flag-like tokens out of prose (e.g. the
    // "(Claude Code: --allowedTools)" hint sits on the same option line and
    // is harmless, while "[possible values: ...]" lines are skipped).
    if (!trimmed.startsWith('-')) continue
    for (const m of trimmed.matchAll(/--[a-z][a-z0-9-]*/g)) {
      flags.add(m[0])
    }
  }
  return [...flags].sort()
}

function extractSubcommands(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => /^Commands:\s*$/.test(line.trim()))
  if (start === -1) return []
  const subcommands: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) break // a blank line terminates the Commands block
    // Subcommand rows look like "  agent        Run Grok without the ...".
    const match = line.match(/^\s{2,}([a-z][a-z0-9-]*)\s{2,}\S/)
    if (match) subcommands.push(match[1])
  }
  return subcommands
}

export function parseGrokHelp(raw: string): { flags: string[]; subcommands: string[] } {
  return { flags: extractFlags(raw), subcommands: extractSubcommands(raw) }
}

/**
 * `grok agent stdio --help` documents nothing but `-h/--help` on 0.2.3.
 * "documented" = the help exposes any option beyond help (a proxy for the
 * stdio/ACP surface gaining real documentation in a later CLI version).
 */
export function agentStdioIsDocumented(raw: string): boolean {
  return extractFlags(raw).some((flag) => flag !== '--help')
}

export async function probeGrokCli(deps: GrokProbeDeps): Promise<GrokProbeFindings> {
  const errors: string[] = []
  const findings: GrokProbeFindings = {
    probedAt: new Date().toISOString(),
    binaryPath: null,
    binarySource: null,
    version: null,
    versionRaw: '',
    topLevelFlags: [],
    subcommands: [],
    agentStdioDocumented: false,
    openAcpQuestions: [...GROK_OPEN_ACP_QUESTIONS],
    errors
  }

  const resolved = await deps.resolveBinary()
  findings.binaryPath = resolved.binaryPath
  findings.binarySource = resolved.source ?? null
  if (!resolved.binaryPath) {
    errors.push(resolved.error || 'Grok binary was not found.')
    return findings
  }
  const bin = resolved.binaryPath

  const versionRes = await deps.capture(bin, [GROK_READ_ONLY_PROBE_FLAG, '--version'])
  findings.versionRaw = (versionRes.stdout || versionRes.stderr || '').trim()
  findings.version = parseGrokVersion(findings.versionRaw)
  if (versionRes.error) errors.push(`version probe failed: ${versionRes.error}`)

  const helpRes = await deps.capture(bin, [GROK_READ_ONLY_PROBE_FLAG, '--help'])
  const help = parseGrokHelp(helpRes.stdout || helpRes.stderr || '')
  findings.topLevelFlags = help.flags
  findings.subcommands = help.subcommands
  if (helpRes.error) errors.push(`help probe failed: ${helpRes.error}`)

  const stdioRes = await deps.capture(bin, [GROK_READ_ONLY_PROBE_FLAG, 'agent', 'stdio', '--help'])
  findings.agentStdioDocumented = agentStdioIsDocumented(stdioRes.stdout || stdioRes.stderr || '')
  if (stdioRes.error) errors.push(`agent stdio probe failed: ${stdioRes.error}`)

  return findings
}
