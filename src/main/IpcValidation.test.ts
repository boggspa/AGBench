import { describe, expect, it } from 'vitest'
import { validateIpcArgs } from './IpcValidation'

describe('IpcValidation', () => {
  it('accepts valid run-agent payloads', () => {
    expect(() =>
      validateIpcArgs('run-agent', [{
        scope: 'workspace',
        provider: 'gemini',
        workspace: '/tmp/workspace',
        prompt: 'hello',
        imagePaths: []
      }])
    ).not.toThrow()
  })

  it('accepts global run-agent payloads without workspace paths', () => {
    expect(() =>
      validateIpcArgs('create-global-chat', [])
    ).not.toThrow()
    expect(() =>
      validateIpcArgs('run-agent', [{
        scope: 'global',
        provider: 'codex',
        appChatId: 'chat-global-1',
        prompt: 'plan a system-wide task'
      }])
    ).not.toThrow()
    expect(() =>
      validateIpcArgs('run-agent', [{
        scope: 'global',
        provider: 'codex',
        prompt: 'missing chat id'
      }])
    ).toThrow(/chat/)
  })

  it('rejects invalid providers and relative workspaces', () => {
    expect(() =>
      validateIpcArgs('run-agent', [{ provider: 'bad', workspace: '/tmp/workspace', prompt: 'hello' }])
    ).toThrow(/known provider/)
    expect(() =>
      validateIpcArgs('run-agent', [{ provider: 'gemini', workspace: 'relative', prompt: 'hello' }])
    ).toThrow(/absolute workspace/)
  })

  it('validates approval actions and external grant access', () => {
    expect(() => validateIpcArgs('respond-agent-approval', ['approval-1', 'accept'])).not.toThrow()
    expect(() => validateIpcArgs('respond-agent-approval', ['approval-1', 'maybe'])).toThrow(/approval action/)
    expect(() => validateIpcArgs('select-external-path-grant', ['execute'])).toThrow(/read or write/)
  })

  it('does not expose renderer-written durable run events', () => {
    expect(() => validateIpcArgs('append-run-event', [{ runId: 'run-1' }])).toThrow(/No IPC schema/)
    expect(() => validateIpcArgs('append-run-events', [[]])).toThrow(/No IPC schema/)
    expect(() => validateIpcArgs('record-workspace-run-change', [{}])).toThrow(/No IPC schema/)
    expect(() => validateIpcArgs('compute-run-diff', ['run-1', {}, {}, { workspacePath: '/tmp/workspace' }])).not.toThrow()
  })

  it('rejects renderer-written workspace grants', () => {
    expect(() => validateIpcArgs('update-settings', [{ agenticWorkspaceGrants: [] }])).toThrow(/workspace grants/)
  })

  it('accepts explicit PTY stop requests', () => {
    expect(() => validateIpcArgs('stop-pty', ['terminal-1'])).not.toThrow()
  })

  it('validates main-owned run queue transition APIs', () => {
    expect(() => validateIpcArgs('request-run-queue-job', [{
      runId: 'run-1',
      provider: 'gemini',
      workspacePath: '/tmp/workspace',
      source: 'manual'
    }])).not.toThrow()
    expect(() => validateIpcArgs('lease-run-queue-job', [{ provider: 'gemini' }])).not.toThrow()
    expect(() => validateIpcArgs('transition-run-queue-job', ['run-1', 'completed', {}])).not.toThrow()
    expect(() => validateIpcArgs('transition-run-queue-job', ['run-1', 'bogus', {}])).toThrow(/run queue status/)
    expect(() => validateIpcArgs('save-run-queue-job', [{}])).toThrow(/No IPC schema/)
  })
})
