import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerAuditHandlers } from './auditHandlers'
import type { AuditRunRecord } from '../store/types'
import type { AuditOrchestrator } from '../audit/AuditOrchestrator'

const ipcHandlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler)
    }
  }
}))

function auditRun(overrides: Partial<AuditRunRecord> = {}): AuditRunRecord {
  return {
    schemaVersion: 1,
    id: 'audit-1',
    mode: 'quick',
    chatId: 'chat-1',
    workspacePath: '/repo',
    status: 'completed',
    phases: [],
    dimensions: [],
    participants: [],
    findings: [],
    verdicts: [],
    gates: [],
    budget: { maxAgents: 1, spentAgents: 1, spentTokens: 0, truncated: false },
    createdAt: 't0',
    updatedAt: 't1',
    ...overrides
  }
}

describe('registerAuditHandlers', () => {
  beforeEach(() => {
    ipcHandlers.clear()
  })

  it('validates preferredProvider before reserving the in-flight audit slot', async () => {
    let inFlight = false
    let beginCalls = 0
    let endCalls = 0
    const run = vi.fn(async () => auditRun())

    registerAuditHandlers({
      getAuditOrchestrator: () => ({ run }) as unknown as AuditOrchestrator,
      getAuditRun: () => null,
      getAuditRuns: () => [],
      beginAuditRun: () => {
        beginCalls += 1
        if (inFlight) return false
        inFlight = true
        return true
      },
      endAuditRun: () => {
        endCalls += 1
        inFlight = false
      },
      markAuditRunCancelled: () => {},
      clearAuditRunCancelled: () => {}
    })

    const start = ipcHandlers.get('audit-run:start')
    expect(start).toBeDefined()

    await expect(
      start?.({}, { chatId: 'chat-1', workspacePath: '/repo', preferredProvider: 'bogus' })
    ).rejects.toThrow()

    expect(beginCalls).toBe(0)
    expect(endCalls).toBe(0)
    expect(run).not.toHaveBeenCalled()

    await expect(
      start?.({}, { chatId: 'chat-1', workspacePath: '/repo', preferredProvider: 'claude' })
    ).resolves.toMatchObject({ id: 'audit-1', status: 'completed' })

    expect(beginCalls).toBe(1)
    expect(endCalls).toBe(1)
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'chat-1', preferredProvider: 'claude' })
    )
  })

  it('validates the workspace path before reserving the in-flight audit slot', async () => {
    let beginCalls = 0
    let endCalls = 0
    const run = vi.fn(async () => auditRun())

    registerAuditHandlers({
      getAuditOrchestrator: () => ({ run }) as unknown as AuditOrchestrator,
      getAuditRun: () => null,
      getAuditRuns: () => [],
      validateWorkspacePath: () => {
        throw new Error('Workspace must be selected through TaskWraith.')
      },
      beginAuditRun: () => {
        beginCalls += 1
        return true
      },
      endAuditRun: () => {
        endCalls += 1
      },
      markAuditRunCancelled: () => {},
      clearAuditRunCancelled: () => {}
    })

    const start = ipcHandlers.get('audit-run:start')
    await expect(
      start?.({}, { chatId: 'chat-1', workspacePath: '/missing', preferredProvider: 'claude' })
    ).rejects.toThrow('Workspace must be selected through TaskWraith.')

    expect(beginCalls).toBe(0)
    expect(endCalls).toBe(0)
    expect(run).not.toHaveBeenCalled()
  })

  it('passes the canonical validated workspace path to the orchestrator', async () => {
    const run = vi.fn(async () => auditRun({ workspacePath: '/repo-canonical' }))

    registerAuditHandlers({
      getAuditOrchestrator: () => ({ run }) as unknown as AuditOrchestrator,
      getAuditRun: () => null,
      getAuditRuns: () => [],
      validateWorkspacePath: () => '/repo-canonical',
      beginAuditRun: () => true,
      endAuditRun: () => {},
      markAuditRunCancelled: () => {},
      clearAuditRunCancelled: () => {}
    })

    const start = ipcHandlers.get('audit-run:start')
    await expect(
      start?.({}, { chatId: 'chat-1', workspacePath: '/repo', preferredProvider: 'claude' })
    ).resolves.toMatchObject({ workspacePath: '/repo-canonical' })

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ workspacePath: '/repo-canonical' }))
  })
})
