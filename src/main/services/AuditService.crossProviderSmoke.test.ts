import { describe, expect, it, vi } from 'vitest'
import { AuditService, type ApprovalRouteContext, type AuditServiceDeps } from './AuditService'
import type { ApprovalLedgerRequestInput } from '../store/types'
import type { RunManager } from '../RunManager'
import type { ProviderId } from '../store/types'

/*
 * 1.0.4-AV5 — cross-provider auto-allow smoke verification.
 *
 * From the panel review sign-off list: "Auto-allow ledger
 * consistency: AR3 landed related fixes, but I'd still want the
 * exact cross-provider live smoke from the panel: one Write +
 * one MCP call from Claude/Codex/Gemini/Kimi with policy
 * auto-allow, then verify run-scoped approval_status."
 *
 * This test exercises the full {provider × service} matrix
 * through the AuditService (the single sink every auto-allow
 * path eventually flows through) and asserts:
 *
 *   1. Every {provider, service} combination produces a ledger
 *      row with the same SHAPE (same keys, same types).
 *   2. The shape is INDEPENDENT of provider — no provider gets
 *      a missing field or a different type for the same field.
 *      This is the invariant the AR3 audit cared about.
 *   3. The `status`, `decision`, `decisionSource`, `grantedScope`
 *      fields land where downstream consumers like
 *      `approval_status` expect them.
 *
 * Live end-to-end (actually starting four provider runtimes and
 * tripping each auto-allow path) requires real CLIs + auth,
 * which the renderer harness doesn't carry. This test pins the
 * shared sink the orchestrator routes ALL providers through,
 * which is where any cross-provider divergence would have to
 * land.
 */

const FIXED_NOW = new Date('2026-05-27T12:00:00.000Z')

function makeService(): {
  service: AuditService
  records: ApprovalLedgerRequestInput[]
} {
  const records: ApprovalLedgerRequestInput[] = []
  const context: ApprovalRouteContext = {
    session: {
      providerSessionId: 'session-id',
      providerRunId: 'provider-run-id',
      workspacePath: '/workspace'
    },
    runId: 'app-run-1',
    chatId: 'app-chat-1',
    workspaceId: 'workspace-1',
    workspacePath: '/workspace'
  }
  const deps: AuditServiceDeps = {
    runManager: { get: vi.fn() } as unknown as RunManager<unknown>,
    resolveApprovalResponse: vi.fn(),
    recordApprovalLedgerDecision: vi.fn((input: ApprovalLedgerRequestInput) => {
      records.push(input)
    }),
    approvalRouteContext: vi.fn(() => context),
    now: vi.fn(() => FIXED_NOW),
    idSuffix: vi.fn(() => 'smoke'),
    logError: vi.fn()
  }
  return { service: new AuditService(deps), records }
}

const PROVIDERS: ProviderId[] = ['claude', 'codex', 'gemini', 'kimi']

describe('Auto-allow ledger — cross-provider smoke (AV5)', () => {
  it('records identically-shaped rows for {Claude, Codex, Gemini, Kimi} × {Write, MCP}', () => {
    const { service, records } = makeService()
    for (const provider of PROVIDERS) {
      service.recordAutomaticApprovalDecision(
        provider,
        { appRunId: 'app-run-1', appChatId: 'app-chat-1' },
        'fileChanges',
        '/workspace',
        {
          method: 'fileChanges/write',
          title: `${provider} write`,
          body: 'edit some-file.ts'
        },
        'autoAllow',
        'policy',
        'request',
        { policy: 'allow', smoke: 'write' }
      )
      service.recordAutomaticApprovalDecision(
        provider,
        { appRunId: 'app-run-1', appChatId: 'app-chat-1' },
        'mcpTools',
        '/workspace',
        {
          method: 'mcp/call',
          title: `${provider} mcp`,
          body: 'mcp tool call'
        },
        'autoAllow',
        'policy',
        'request',
        { policy: 'allow', smoke: 'mcp' }
      )
    }

    // 4 providers × 2 services = 8 rows.
    expect(records).toHaveLength(8)

    // Pin the shape invariant: every row must carry the same
    // top-level keys. If a future change drops or adds a field
    // for one provider, this assertion catches it.
    const referenceKeys = Object.keys(records[0]).sort()
    for (const row of records) {
      expect(Object.keys(row).sort()).toEqual(referenceKeys)
    }

    // Every row must have these critical fields populated. The
    // panel review's worry was that some providers were leaving
    // service/chatId/runId unset; this pins them.
    for (const row of records) {
      expect(row.provider).toMatch(/^(claude|codex|gemini|kimi)$/)
      expect(row.service).toMatch(/^(fileChanges|mcpTools)$/)
      expect(row.status).toBe('approved')
      expect(row.decision).toBe('autoAllow')
      expect(row.decisionSource).toBe('policy')
      expect(row.grantedScope).toBe('request')
      expect(row.runId).toBe('app-run-1')
      expect(row.chatId).toBe('app-chat-1')
      expect(row.workspaceId).toBe('workspace-1')
      expect(row.workspacePath).toBe('/workspace')
      expect(typeof row.approvalId).toBe('string')
      expect(row.approvalId.length).toBeGreaterThan(10)
      expect(row.requestedAt).toBe(FIXED_NOW.toISOString())
      expect(row.respondedAt).toBe(FIXED_NOW.toISOString())
      expect(row.expiration?.mode).toBe('none')
      expect(row.metadata).toMatchObject({ policy: 'allow' })
    }

    // Each provider should produce exactly 2 rows (one write,
    // one mcp). Catches a provider being silently double-counted
    // or skipped.
    for (const provider of PROVIDERS) {
      const rowsForProvider = records.filter((r) => r.provider === provider)
      expect(rowsForProvider).toHaveLength(2)
      expect(rowsForProvider.map((r) => r.service).sort()).toEqual(['fileChanges', 'mcpTools'])
    }
  })

  it('preserves the same expiration shape for autoAllow across providers (request scope)', () => {
    const { service, records } = makeService()
    for (const provider of PROVIDERS) {
      service.recordAutomaticApprovalDecision(
        provider,
        { appRunId: 'app-run-1' },
        'mcpTools',
        undefined,
        { method: 'mcp/call', title: `${provider} mcp`, body: 'x' },
        'autoAllow',
        'policy',
        'request',
        {}
      )
    }
    const firstExpiration = records[0].expiration
    for (const row of records) {
      // Same expiration shape (mode + description) across every
      // provider for the same {decision, grantedScope} combo.
      expect(row.expiration).toEqual(firstExpiration)
    }
  })

  it('autoDeny rows carry status="denied" and consistent expiration across providers', () => {
    const { service, records } = makeService()
    for (const provider of PROVIDERS) {
      service.recordAutomaticApprovalDecision(
        provider,
        { appRunId: 'app-run-1' },
        'shellCommands',
        '/workspace',
        { method: 'shell/run', title: `${provider} shell`, body: 'rm -rf /' },
        'autoDeny',
        'policy',
        'request',
        { policy: 'deny' }
      )
    }
    expect(records).toHaveLength(4)
    for (const row of records) {
      expect(row.decision).toBe('autoDeny')
      expect(row.status).toBe('denied')
    }
    // Same expiration shape across all four providers for the
    // {autoDeny, request} combo.
    const firstExpiration = records[0].expiration
    for (const row of records) {
      expect(row.expiration).toEqual(firstExpiration)
    }
  })
})
