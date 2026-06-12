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
   * `grok agent stdio --help` is bare on 0.2.3 (only `-h/--help`) and still
   * undocumented on 0.2.32 (it gains only the global `--leader-socket`
   * plumbing flag that every subcommand carries), so the ACP wire protocol
   * remains undocumented at the CLI. This stays false until a future CLI
   * version documents stdio-specific options.
   */
  agentStdioDocumented: boolean
  openAcpQuestions: string[]
  answeredAcpQuestions: string[]
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
 * ACP-spike questions ANSWERED by the G1–G5c implementation arc (GrokAcpClient
 * / GrokAcpProtocol fixtures from the real agent, plus gated live traces).
 * Carried in the probe output so the findings record what is settled and how.
 */
export const GROK_ANSWERED_ACP_QUESTIONS: readonly string[] = [
  'JSON-RPC methods: initialize → session/new → session/prompt; streaming session/update notifications; inbound session/request_permission; session/cancel for interrupts (GrokAcpClient).',
  'session/new accepts cwd + mcpServers (a malformed mcpServers entry fails with -32602); model/permission posture ride the prompt + deny rules, not session/new params.',
  'Assistant deltas arrive via session/update agent_message_chunk (GrokAcpProtocol fixtures).',
  'Cancellation is session/cancel (protocol) followed by SIGINT; normal turn end is SIGINT after the stopReason.',
  'Local shell/file ops are Grok-NATIVE execution. Grok asks via session/request_permission for native tools, but the live trace showed MCP tools can AUTO-RUN with no permission request — the advertised tool list + tools/call rejection is the boundary there.',
  'The TaskWraith MCP server registers per-run via session/new mcpServers — no ~/.grok config mutation (the `grok mcp add` surface is never used).'
]

/**
 * The ACP questions still open before the remaining Grok trust expansions
 * (ACP-side resume, usage telemetry, relaxing TASKWRAITH_GROK_READONLY_MCP).
 * Carried in the probe output so the findings always travel with the open
 * unknowns.
 */
export const GROK_OPEN_ACP_QUESTIONS: readonly string[] = [
  'Does ACP expose usage / token metadata? (None observed through 0.2.32 — credits are scraped from the TUI /usage screen instead.)',
  'Does ACP expose a stable, RESUMABLE session id (session/load or equivalent)? Headless `-r/--resume` exists; the ACP client still starts a fresh session/new per turn.',
  'Can native write/shell tools be disabled per-seat over ACP while MCP stays available, instead of relying on request_permission auto-deny?',
  'Do newer CLIs (0.2.51+) emit tool_call session/updates and session/request_permission for MCP tools? The 0.2.32-era trace showed MCP auto-run without permission — re-verify before relaxing TASKWRAITH_GROK_READONLY_MCP.'
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
 * Global plumbing flags clap attaches to EVERY subcommand's help — their
 * presence on `agent stdio --help` says nothing about the stdio/ACP surface
 * itself. `--leader-socket` appeared globally in 0.2.32 (verified on the
 * stdio, mcp, mcp add/list, inspect, and update help screens alike) and was
 * flipping the old any-flag-beyond-help heuristic to a false positive.
 */
const GROK_GLOBAL_PLUMBING_FLAGS = new Set(['--help', '--leader-socket'])

/**
 * `grok agent stdio --help` documents nothing but `-h/--help` on 0.2.3 and
 * nothing but help + the global `--leader-socket` plumbing flag on 0.2.32.
 * "documented" = the help exposes any stdio-SPECIFIC option (a proxy for the
 * stdio/ACP surface gaining real documentation in a later CLI version).
 */
export function agentStdioIsDocumented(raw: string): boolean {
  return extractFlags(raw).some((flag) => !GROK_GLOBAL_PLUMBING_FLAGS.has(flag))
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
    answeredAcpQuestions: [...GROK_ANSWERED_ACP_QUESTIONS],
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
