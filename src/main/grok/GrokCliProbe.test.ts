import { describe, it, expect, vi } from 'vitest'
import {
  agentStdioIsDocumented,
  GROK_ANSWERED_ACP_QUESTIONS,
  GROK_OPEN_ACP_QUESTIONS,
  parseGrokHelp,
  parseGrokVersion,
  probeGrokCli,
  type GrokProbeCaptureResult
} from './GrokCliProbe'

// Captured verbatim from `grok --no-auto-update --version` on 0.2.3.
const VERSION_FIXTURE = 'grok 0.2.3 (14d81fd875e) [stable]'

// Representative subset of `grok --no-auto-update --help` on 0.2.3 — keeps the
// real Options + Commands layout (indentation, value enums, the "Claude Code:"
// hints inside descriptions) so the parser is exercised against the real shape.
const HELP_FIXTURE = `Grok Build TUI

Usage: grok [OPTIONS] [COMMAND]

Options:
      --allow <RULE>
          Permission allow rule (Claude Code: --allowedTools)

      --always-approve
          Auto-approve all tool executions

      --cwd <CWD>
          Working directory

      --deny <RULE>
          Permission deny rule (Claude Code: --disallowedTools)

      --disable-web-search
          Disable web search and web fetch tools

  -h, --help
          Print help (see a summary with '-h')

  -m, --model <MODEL>
          Model ID to use

      --output-format <OUTPUT_FORMAT>
          Output format for headless mode

          [default: plain]
          [possible values: plain, json, streaming-json]

  -p, --single <PROMPT>
          Single-turn prompt. Prints the response to stdout and exits

      --permission-mode <MODE>
          Permission mode

          [possible values: default, acceptEdits, auto, dontAsk, bypassPermissions, plan]

  -r, --resume [<SESSION_ID>]
          Resume a session by ID, or the most recent if omitted

Commands:
  agent        Run Grok without the interactive UI
  completions  Generate shell completion scripts (bash, zsh, fish, powershell, ...)
  export       Export a session transcript as Markdown
  inspect      Show the configuration Grok discovers for this directory
  mcp          Manage MCP server configurations
  models       List available models and exit
  sessions     List, search, or restore sessions
  help         Print this message or the help of the given subcommand(s)`

// Captured verbatim from `grok --no-auto-update agent stdio --help` on 0.2.3 —
// deliberately bare (only -h/--help), which is why the ACP spike is deferred.
const STDIO_HELP_FIXTURE = `Run the agent over stdio

Usage: grok agent stdio

Options:
  -h, --help  Print help`

// Captured verbatim from `grok --no-auto-update agent stdio --help` on 0.2.32.
// The only addition is the global `--leader-socket` plumbing flag, which clap
// attaches to EVERY subcommand (mcp, mcp add/list, inspect, update all show
// it) — the stdio/ACP surface itself is still undocumented.
const STDIO_HELP_FIXTURE_0_2_32 = `Run the agent over stdio

Usage: grok agent stdio [OPTIONS]

Options:
  -h, --help
          Print help (see a summary with '-h')

      --leader-socket <PATH>
          Use a custom leader socket path instead of the default \`~/.grok/leader.sock\`.

          Both this client and the leader process it spawns bind this path (propagated via the \`GROK_LEADER_SOCKET\` env var), so a local/branch build can run an isolated leader without colliding with the default one already running on the machine.`

// Representative subset of \`grok --no-auto-update --help\` on 0.2.32 — the
// Commands table grew considerably (import/leader/login/memory/plugin/setup/
// ssh/trace/update/version/worktree) and Options gained --leader-socket.
const HELP_FIXTURE_0_2_32 = `Grok Build TUI

Usage: grok [OPTIONS] [COMMAND]

Options:
      --allow <RULE>
          Permission allow rule (Claude Code: --allowedTools)

      --deny <RULE>
          Permission deny rule (Claude Code: --disallowedTools)

      --effort <LEVEL>
          Effort level

          [possible values: low, medium, high, xhigh, max]

  -h, --help
          Print help (see a summary with '-h')

      --leader-socket <PATH>
          Use a custom leader socket path instead of the default \`~/.grok/leader.sock\`.

      --permission-mode <MODE>
          Permission mode

          [possible values: default, acceptEdits, auto, dontAsk, bypassPermissions, plan]

  -r, --resume [<SESSION_ID>]
          Resume a session by ID, or the most recent if omitted

Commands:
  agent        Run Grok without the interactive UI
  completions  Generate shell completion scripts (bash, zsh, fish, powershell, ...)
  export       Export a session transcript as Markdown
  help         Print this message or the help of the given subcommand(s)
  import       Import sessions into Grok
  inspect      Show the configuration Grok discovers for this directory
  leader       Manage running leader processes
  login        Sign in to Grok
  logout       Sign out and clear cached credentials
  mcp          Manage MCP server configurations
  memory       Manage cross-session memory
  models       List available models and exit
  plugin       Manage plugins and marketplace sources
  sessions     List, search, or restore sessions
  setup        Fetch and install managed deployment configuration
  ssh          Run ssh with local clipboard support
  trace        Export or upload session trace data
  update       Check for updates or install a specific version
  version      Print version information [aliases: v]
  worktree     Manage git worktrees`

describe('parseGrokVersion', () => {
  it('extracts the semver from the real version banner', () => {
    expect(parseGrokVersion(VERSION_FIXTURE)).toBe('0.2.3')
  })

  it('extracts a bare "grok x.y.z" form', () => {
    expect(parseGrokVersion('grok 1.10.0')).toBe('1.10.0')
  })

  it('returns null when no version is present', () => {
    expect(parseGrokVersion('missing')).toBeNull()
    expect(parseGrokVersion('unknown')).toBeNull()
    expect(parseGrokVersion('')).toBeNull()
  })
})

describe('parseGrokHelp', () => {
  const { flags, subcommands } = parseGrokHelp(HELP_FIXTURE)

  it('extracts the read-only run levers as long flags', () => {
    for (const flag of [
      '--allow',
      '--always-approve',
      '--cwd',
      '--deny',
      '--disable-web-search',
      '--help',
      '--model',
      '--output-format',
      '--single',
      '--permission-mode',
      '--resume'
    ]) {
      expect(flags).toContain(flag)
    }
  })

  it('does not harvest flag-like tokens out of description prose', () => {
    // "(Claude Code: --allowedTools)" sits inside a description line — its
    // lowercase prefix must not leak into the parsed flag list.
    expect(flags).not.toContain('--allowed')
    expect(flags).not.toContain('--allowedtools')
    expect(flags).not.toContain('--disallowedtools')
  })

  it('extracts the subcommand table', () => {
    expect(subcommands).toEqual([
      'agent',
      'completions',
      'export',
      'inspect',
      'mcp',
      'models',
      'sessions',
      'help'
    ])
  })

  it('returns empty arrays for empty input', () => {
    expect(parseGrokHelp('')).toEqual({ flags: [], subcommands: [] })
  })
})

describe('agentStdioIsDocumented', () => {
  it('is false for the bare 0.2.3 stdio help (only -h/--help)', () => {
    expect(agentStdioIsDocumented(STDIO_HELP_FIXTURE)).toBe(false)
  })

  it('is false for the 0.2.32 stdio help — --leader-socket is global plumbing, not stdio docs', () => {
    expect(agentStdioIsDocumented(STDIO_HELP_FIXTURE_0_2_32)).toBe(false)
  })

  it('becomes true once the stdio surface documents real options', () => {
    const documented = `Run the agent over stdio

Usage: grok agent stdio [OPTIONS]

Options:
      --protocol <PROTO>  Wire protocol to speak
  -h, --help              Print help`
    expect(agentStdioIsDocumented(documented)).toBe(true)
  })

  it('stays true for real options even when plumbing flags are also present', () => {
    const documented = `Run the agent over stdio

Usage: grok agent stdio [OPTIONS]

Options:
      --protocol <PROTO>      Wire protocol to speak
      --leader-socket <PATH>  Use a custom leader socket path
  -h, --help                  Print help`
    expect(agentStdioIsDocumented(documented)).toBe(true)
  })
})

describe('parseGrokHelp on the 0.2.32 shape', () => {
  const { flags, subcommands } = parseGrokHelp(HELP_FIXTURE_0_2_32)

  it('extracts the grown flag set including the global plumbing flag', () => {
    for (const flag of ['--allow', '--deny', '--effort', '--leader-socket', '--permission-mode']) {
      expect(flags).toContain(flag)
    }
  })

  it('extracts the grown Commands table', () => {
    for (const subcommand of ['agent', 'inspect', 'mcp', 'update', 'worktree']) {
      expect(subcommands).toContain(subcommand)
    }
    expect(subcommands).toHaveLength(20)
  })
})

describe('probeGrokCli', () => {
  const makeCapture = (
    map: Record<string, Partial<GrokProbeCaptureResult>>
  ): ((command: string, args: string[]) => Promise<GrokProbeCaptureResult>) => {
    return async (_command, args) => {
      const key = args.join(' ')
      return { stdout: '', stderr: '', code: 0, ...(map[key] ?? {}) }
    }
  }

  it('returns structured findings on the happy path (no errors)', async () => {
    const findings = await probeGrokCli({
      resolveBinary: async () => ({
        binaryPath: '/Users/dev/.grok/bin/grok',
        source: 'common'
      }),
      capture: makeCapture({
        '--no-auto-update --version': { stdout: VERSION_FIXTURE },
        '--no-auto-update --help': { stdout: HELP_FIXTURE },
        '--no-auto-update agent stdio --help': { stdout: STDIO_HELP_FIXTURE }
      })
    })

    expect(findings.binaryPath).toBe('/Users/dev/.grok/bin/grok')
    expect(findings.binarySource).toBe('common')
    expect(findings.version).toBe('0.2.3')
    expect(findings.topLevelFlags).toContain('--permission-mode')
    expect(findings.topLevelFlags).toContain('--output-format')
    expect(findings.subcommands).toContain('agent')
    expect(findings.subcommands).toContain('mcp')
    expect(findings.agentStdioDocumented).toBe(false)
    expect(findings.openAcpQuestions).toEqual([...GROK_OPEN_ACP_QUESTIONS])
    expect(findings.answeredAcpQuestions).toEqual([...GROK_ANSWERED_ACP_QUESTIONS])
    expect(findings.errors).toEqual([])
  })

  it('records the resolver error and never spawns when the binary is missing', async () => {
    const capture = vi.fn(async () => ({ stdout: '', stderr: '', code: 0 }))
    const findings = await probeGrokCli({
      resolveBinary: async () => ({
        binaryPath: null,
        source: 'missing',
        error: 'Grok CLI was not found on PATH.'
      }),
      capture
    })

    expect(capture).not.toHaveBeenCalled()
    expect(findings.binaryPath).toBeNull()
    expect(findings.binarySource).toBe('missing')
    expect(findings.version).toBeNull()
    expect(findings.errors).toContain('Grok CLI was not found on PATH.')
  })

  it('surfaces a capture failure as a recorded error without throwing', async () => {
    const findings = await probeGrokCli({
      resolveBinary: async () => ({ binaryPath: '/usr/local/bin/grok', source: 'path' }),
      capture: makeCapture({
        '--no-auto-update --version': { code: null, error: 'Timed out.', timedOut: true },
        '--no-auto-update --help': { stdout: HELP_FIXTURE },
        '--no-auto-update agent stdio --help': { stdout: STDIO_HELP_FIXTURE }
      })
    })

    expect(findings.errors).toContain('version probe failed: Timed out.')
    // The help probe still succeeds, so later findings are populated.
    expect(findings.subcommands).toContain('agent')
  })
})
