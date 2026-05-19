import { describe, expect, it } from 'vitest'
import { validateIpcArgs } from './IpcValidation'

describe('IpcValidation', () => {
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
})
