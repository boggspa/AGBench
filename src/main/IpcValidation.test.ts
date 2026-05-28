import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateIpcArgs, IPC_ARGUMENT_SCHEMAS } from './IpcValidation'

describe('IpcValidation', () => {
  // `installIpcValidation` wraps EVERY `ipcMain.handle(channel, …)` and
  // calls `validateIpcArgs`, which THROWS "No IPC schema registered for
  // <channel>" when the channel is missing from IPC_ARGUMENT_SCHEMAS — so
  // the handler crashes the first time it's invoked. This has bitten
  // twice as a latent runtime crash (external-path:pick-and-persist in
  // EW71, fx-rates:get later). This test statically extracts every
  // handled channel from `index.ts` and asserts each is registered, so
  // the whole class is caught at build time instead of by users.
  it('registers an arg schema for every ipcMain.handle channel', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const handled = new Set<string>()
    const re = /ipcMain\.handle\(\s*['"`]([^'"`]+)['"`]/g
    let match: RegExpExecArray | null
    while ((match = re.exec(source)) !== null) {
      const channel = match[1]
      // Skip dynamically-composed channel names (template interpolation);
      // those can't be statically registered.
      if (channel.includes('${')) continue
      handled.add(channel)
    }
    expect(handled.size).toBeGreaterThan(0)
    const missing = [...handled].filter((channel) => !(channel in IPC_ARGUMENT_SCHEMAS)).sort()
    expect(missing).toEqual([])
  })

  it('accepts valid run-agent payloads', () => {
    expect(() =>
      validateIpcArgs('run-agent', [
        {
          scope: 'workspace',
          provider: 'gemini',
          workspace: '/tmp/workspace',
          prompt: 'hello',
          imagePaths: []
        }
      ])
    ).not.toThrow()
  })

  it('accepts global run-agent payloads without workspace paths', () => {
    expect(() => validateIpcArgs('create-global-chat', [])).not.toThrow()
    expect(() =>
      validateIpcArgs('run-agent', [
        {
          scope: 'global',
          provider: 'codex',
          appChatId: 'chat-global-1',
          prompt: 'plan a system-wide task'
        }
      ])
    ).not.toThrow()
    expect(() =>
      validateIpcArgs('run-agent', [
        {
          scope: 'global',
          provider: 'codex',
          prompt: 'missing chat id'
        }
      ])
    ).toThrow(/chat/)
  })

  it('rejects invalid providers and relative workspaces', () => {
    expect(() =>
      validateIpcArgs('run-agent', [
        { provider: 'bad', workspace: '/tmp/workspace', prompt: 'hello' }
      ])
    ).toThrow(/known provider/)
    expect(() =>
      validateIpcArgs('run-agent', [{ provider: 'gemini', workspace: 'relative', prompt: 'hello' }])
    ).toThrow(/absolute workspace/)
  })

  it('validates approval actions and external grant access', () => {
    expect(() => validateIpcArgs('respond-agent-approval', ['approval-1', 'accept'])).not.toThrow()
    expect(() => validateIpcArgs('respond-agent-approval', ['approval-1', 'maybe'])).toThrow(
      /approval action/
    )
    expect(() => validateIpcArgs('select-external-path-grant', ['execute'])).toThrow(
      /read or write/
    )
  })

  // Regression test for the bug discovered 2026-05-16: the Phase B6
  // ComposerService extraction added a `compose-run` IPC handler but
  // forgot to register a schema in IPC_SCHEMAS, which made the
  // IpcValidation layer throw `No IPC schema registered for
  // compose-run` on every Send-message attempt. Pin the schema's
  // presence so the same bug can't sneak back.
  it('accepts compose-run payloads', () => {
    expect(() =>
      validateIpcArgs('compose-run', [
        {
          chatId: 'chat-1',
          provider: 'gemini',
          scope: 'workspace',
          workspace: '/tmp/workspace',
          userInput: 'hello'
        }
      ])
    ).not.toThrow()
    // Non-object args still rejected.
    expect(() => validateIpcArgs('compose-run', ['just a string'])).toThrow()
  })

  // Regression test for the bug reported 2026-05-28 (1.0.6-EW69): the
  // composer workspace-manager add flows (proactive folder grant +
  // attach-known-workspace-as-secondary) go through
  // `external-path:pick-and-persist`, which was never registered in
  // IPC_ARGUMENT_SCHEMAS — so installIpcValidation threw "No IPC schema
  // registered for external-path:pick-and-persist" the moment any add
  // fired. Pin the schema's presence + object-arg shape.
  it('accepts external-path:pick-and-persist payloads', () => {
    expect(() =>
      validateIpcArgs('external-path:pick-and-persist', [{ chatId: 'chat-1', access: 'read' }])
    ).not.toThrow()
    expect(() =>
      validateIpcArgs('external-path:pick-and-persist', [
        { chatId: 'chat-1', access: 'write', path: '/tmp/workspace' }
      ])
    ).not.toThrow()
    // Non-object args still rejected.
    expect(() => validateIpcArgs('external-path:pick-and-persist', ['nope'])).toThrow()
  })

  it('accepts ensemble and sub-thread chat IPC payloads', () => {
    expect(() => validateIpcArgs('create-ensemble-chat', [])).not.toThrow()
    expect(() => validateIpcArgs('create-ensemble-chat', [undefined])).not.toThrow()
    expect(() =>
      validateIpcArgs('create-ensemble-chat', [
        { workspaceId: 'workspace-1', workspacePath: '/tmp/workspace' }
      ])
    ).not.toThrow()
    expect(() =>
      validateIpcArgs('run-ensemble-round', [
        { chatId: 'ensemble-1', prompt: 'Review this change', mode: 'normal' }
      ])
    ).not.toThrow()
    expect(() => validateIpcArgs('cancel-ensemble-round', ['ensemble-1'])).not.toThrow()
    expect(() =>
      validateIpcArgs('create-sub-thread', [
        {
          parentChatId: 'parent-1',
          provider: 'claude',
          delegationPrompt: 'Read this module and report risks.',
          returnResultToParent: true,
          workspaceId: 'workspace-1',
          workspacePath: '/tmp/workspace'
        }
      ])
    ).not.toThrow()
    expect(() => validateIpcArgs('get-sub-threads', ['parent-1'])).not.toThrow()
    expect(() => validateIpcArgs('cancel-ensemble-round', [''])).toThrow(/non-empty/)
  })

  it('does not expose renderer-written durable run events', () => {
    expect(() => validateIpcArgs('append-run-event', [{ runId: 'run-1' }])).toThrow(/No IPC schema/)
    expect(() => validateIpcArgs('append-run-events', [[]])).toThrow(/No IPC schema/)
    expect(() => validateIpcArgs('record-workspace-run-change', [{}])).toThrow(/No IPC schema/)
    expect(() =>
      validateIpcArgs('compute-run-diff', ['run-1', {}, {}, { workspacePath: '/tmp/workspace' }])
    ).not.toThrow()
  })

  it('rejects renderer-written workspace grants', () => {
    expect(() => validateIpcArgs('update-settings', [{ agenticWorkspaceGrants: [] }])).toThrow(
      /workspace grants/
    )
  })

  it('accepts explicit PTY stop requests', () => {
    expect(() => validateIpcArgs('stop-pty', ['terminal-1'])).not.toThrow()
  })

  it('validates safe shell-open bridge arguments', () => {
    expect(() => validateIpcArgs('shell:open-link', ['https://example.com'])).not.toThrow()
    expect(() => validateIpcArgs('shell:open-link', [''])).toThrow(/non-empty/)
  })

  it('accepts bridge daemon status and toggle APIs', () => {
    expect(() => validateIpcArgs('bridge-networking-status', [])).not.toThrow()
    expect(() => validateIpcArgs('set-bridge-daemon-enabled', [true])).not.toThrow()
    expect(() => validateIpcArgs('set-bridge-daemon-enabled', ['true'])).toThrow(/boolean/)
  })

  it('accepts bridge allowlist admin APIs', () => {
    expect(() => validateIpcArgs('bridge-allowlist-list', [])).not.toThrow()
    expect(() =>
      validateIpcArgs('bridge-allowlist-upsert', [
        {
          workspaceId: 'Gemini Smoke',
          path: '/Users/dev/Desktop/gemini-workbench',
          mode: 'read-write',
          allowedProviders: ['gemini', 'codex', 'claude', 'kimi'],
          allowedApprovalModes: ['default', 'plan']
        }
      ])
    ).not.toThrow()
    expect(() => validateIpcArgs('bridge-allowlist-upsert', ['bad'])).toThrow(/object/)
    expect(() => validateIpcArgs('bridge-allowlist-remove', ['Gemini Smoke'])).not.toThrow()
    expect(() => validateIpcArgs('bridge-allowlist-remove', [''])).toThrow(/non-empty/)
    expect(() => validateIpcArgs('bridge-allowlist-clear', [])).not.toThrow()
  })

  it('accepts read-only startup/status APIs used by the shell', () => {
    expect(() => validateIpcArgs('get-claude-auth-status', [])).not.toThrow()
    expect(() => validateIpcArgs('get-kimi-auth-status', [])).not.toThrow()
    expect(() => validateIpcArgs('agentic-yolo-get', [])).not.toThrow()
    expect(() => validateIpcArgs('agentic-yolo-set', [true])).not.toThrow()
    expect(() => validateIpcArgs('agentic-yolo-set', ['true'])).toThrow(/boolean/)
    expect(() => validateIpcArgs('get-runtime-profiles', ['codex'])).not.toThrow()
    expect(() => validateIpcArgs('get-runtime-profiles', ['bad-provider'])).toThrow(
      /known provider/
    )
    expect(() => validateIpcArgs('get-handoff-cards', [{ provider: 'claude' }])).not.toThrow()
  })

  it('validates main-owned run queue transition APIs', () => {
    expect(() =>
      validateIpcArgs('request-run-queue-job', [
        {
          runId: 'run-1',
          provider: 'gemini',
          workspacePath: '/tmp/workspace',
          source: 'manual'
        }
      ])
    ).not.toThrow()
    expect(() => validateIpcArgs('lease-run-queue-job', [{ provider: 'gemini' }])).not.toThrow()
    expect(() =>
      validateIpcArgs('transition-run-queue-job', ['run-1', 'completed', {}])
    ).not.toThrow()
    expect(() => validateIpcArgs('transition-run-queue-job', ['run-1', 'bogus', {}])).toThrow(
      /run queue status/
    )
    expect(() => validateIpcArgs('save-run-queue-job', [{}])).toThrow(/No IPC schema/)
  })

  // Tester-feedback intake (1.0.1) — the bugReportPayload guard pins
  // the shape the renderer ships to `submit-bug-report`. Title must
  // be a non-empty string; severity must be one of four; the context
  // block has to carry the five auto-captured strings. Without these
  // guards a malformed payload could slip past IpcValidation and
  // break the markdown file the main process appends to.
  it('accepts a well-formed submit-bug-report payload', () => {
    expect(() => validateIpcArgs('get-app-version', [])).not.toThrow()
    expect(() =>
      validateIpcArgs('submit-bug-report', [
        {
          title: 'Composer freezes after Cmd+K',
          description: 'Steps...',
          expected: 'Composer accepts input.',
          severity: 'major',
          context: {
            timestamp: '2026-05-24T19:10:00.000Z',
            version: '1.0.1',
            provider: 'codex',
            workspace: '/Users/dev/projects/agbench',
            shell: 'default',
            surface: 'Ensemble',
            chatKind: 'ensemble',
            settingsTab: 'mcp',
            inspectorTab: 'safety',
            theme: 'midnight',
            promptBubble: 'blue',
            ensemble: '4 participants'
          }
        }
      ])
    ).not.toThrow()
  })

  it('rejects bug-report payloads with bad severity / empty title / missing context', () => {
    const goodContext = {
      timestamp: '2026-05-24T19:10:00.000Z',
      version: '1.0.1',
      provider: 'codex',
      workspace: '/tmp/ws',
      shell: 'default',
      surface: 'Transcript'
    }
    // Bad severity.
    expect(() =>
      validateIpcArgs('submit-bug-report', [
        {
          title: 't',
          description: '',
          expected: '',
          severity: 'critical',
          context: goodContext
        }
      ])
    ).toThrow(/severity/)
    // Empty title.
    expect(() =>
      validateIpcArgs('submit-bug-report', [
        {
          title: '   ',
          description: '',
          expected: '',
          severity: 'minor',
          context: goodContext
        }
      ])
    ).toThrow(/non-empty/)
    // Missing context shape.
    expect(() =>
      validateIpcArgs('submit-bug-report', [
        {
          title: 't',
          description: '',
          expected: '',
          severity: 'minor'
        }
      ])
    ).toThrow(/context must be an object/)
    // Context missing a required field.
    expect(() =>
      validateIpcArgs('submit-bug-report', [
        {
          title: 't',
          description: '',
          expected: '',
          severity: 'minor',
          context: { ...goodContext, shell: undefined as unknown as string }
        }
      ])
    ).toThrow(/context\.shell/)
    expect(() =>
      validateIpcArgs('submit-bug-report', [
        {
          title: 't',
          description: '',
          expected: '',
          severity: 'minor',
          context: { ...goodContext, surface: 42 as unknown as string }
        }
      ])
    ).toThrow(/context\.surface/)
  })
})
