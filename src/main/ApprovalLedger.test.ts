import { describe, expect, it } from 'vitest'
import {
  PENDING_APPROVAL_TTL_MS,
  createApprovalLedgerRecord,
  expireScopedApprovalLedgerRecords,
  filterApprovalLedgerRecords,
  recoverExpiredApprovalLedgerRecords,
  resolveApprovalLedgerRecord
} from './ApprovalLedger'
import type { AgentApprovalAction } from './store/types'

describe('ApprovalLedger', () => {
  const baseRequest = {
    approvalId: 'approval-1',
    provider: 'codex' as const,
    service: 'shellCommands' as const,
    method: 'item/permissions/requestApproval',
    title: 'Approve shell command',
    body: 'Run swift build',
    actions: [
      'accept',
      'acceptForSession',
      'acceptForWorkspace',
      'decline'
    ] as AgentApprovalAction[],
    runId: 'run-1',
    chatId: 'chat-1',
    workspaceId: 'workspace-1',
    workspacePath: '/workspace'
  }

  it('creates pending records with a 24 hour timeout', () => {
    const requestedAt = '2026-05-07T00:00:00.000Z'
    const record = createApprovalLedgerRecord(baseRequest, requestedAt)

    expect(record.schemaVersion).toBe(1)
    expect(record.approvalId).toBe('approval-1')
    expect(record.status).toBe('pending')
    expect(record.expiration.mode).toBe('pending_timeout')
    expect(new Date(record.expiration.expiresAt || '').getTime()).toBe(
      new Date(requestedAt).getTime() + PENDING_APPROVAL_TTL_MS
    )
  })

  it('maps user approval decisions to durable scopes and expirations', () => {
    const pending = createApprovalLedgerRecord(baseRequest, '2026-05-07T00:00:00.000Z')
    const runApproval = resolveApprovalLedgerRecord(pending, 'accept', '2026-05-07T00:01:00.000Z')
    const sessionApproval = resolveApprovalLedgerRecord(
      pending,
      'acceptForSession',
      '2026-05-07T00:02:00.000Z'
    )
    const workspaceApproval = resolveApprovalLedgerRecord(
      pending,
      'acceptForWorkspace',
      '2026-05-07T00:03:00.000Z'
    )

    expect(runApproval.status).toBe('approved')
    expect(runApproval.grantedScope).toBe('run')
    expect(runApproval.expiration.mode).toBe('run_end')
    expect(sessionApproval.grantedScope).toBe('session')
    expect(sessionApproval.expiration.mode).toBe('session_end')
    expect(workspaceApproval.grantedScope).toBe('workspace')
    expect(workspaceApproval.expiration.mode).toBe('workspace_revocation')
  })

  it('records declines and cancels as terminal request decisions', () => {
    const pending = createApprovalLedgerRecord(baseRequest, '2026-05-07T00:00:00.000Z')
    const denied = resolveApprovalLedgerRecord(pending, 'decline', '2026-05-07T00:01:00.000Z')
    const cancelled = resolveApprovalLedgerRecord(pending, 'cancel', '2026-05-07T00:02:00.000Z')

    expect(denied.status).toBe('denied')
    expect(denied.grantedScope).toBe('request')
    expect(denied.expiration.expiredAt).toBe('2026-05-07T00:01:00.000Z')
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.expiration.expiredReason).toBe('cancel')
  })

  it('recovers stale pending records as expired', () => {
    const pending = createApprovalLedgerRecord(baseRequest, '2026-05-07T00:00:00.000Z')
    const recovered = recoverExpiredApprovalLedgerRecords([pending], '2026-05-08T00:00:01.000Z')

    expect(recovered[0].status).toBe('expired')
    expect(recovered[0].expiration.expiredReason).toBe('pending_timeout')
  })

  it('expires approved run and session scoped grants by run', () => {
    const pending = createApprovalLedgerRecord(baseRequest, '2026-05-07T00:00:00.000Z')
    const runApproval = resolveApprovalLedgerRecord(pending, 'accept', '2026-05-07T00:01:00.000Z')
    const sessionApproval = resolveApprovalLedgerRecord(
      { ...pending, approvalId: 'approval-2', id: 'approval-2' },
      'acceptForSession',
      '2026-05-07T00:02:00.000Z'
    )
    const workspaceApproval = resolveApprovalLedgerRecord(
      { ...pending, approvalId: 'approval-3', id: 'approval-3' },
      'acceptForWorkspace',
      '2026-05-07T00:03:00.000Z'
    )

    const expired = expireScopedApprovalLedgerRecords(
      [runApproval, sessionApproval, workspaceApproval],
      { runId: 'run-1', scopes: ['run', 'session'], reason: 'run_completed' },
      '2026-05-07T00:04:00.000Z'
    )

    expect(expired.find((record) => record.approvalId === 'approval-1')?.status).toBe('expired')
    expect(expired.find((record) => record.approvalId === 'approval-2')?.status).toBe('expired')
    expect(expired.find((record) => record.approvalId === 'approval-3')?.status).toBe('approved')
  })

  it('filters ledger records while hiding expired history by default', () => {
    const pending = createApprovalLedgerRecord(baseRequest, '2026-05-07T00:00:00.000Z')
    const expired = recoverExpiredApprovalLedgerRecords(
      [{ ...pending, approvalId: 'approval-expired', id: 'approval-expired' }],
      '2026-05-08T00:00:01.000Z'
    )[0]

    expect(filterApprovalLedgerRecords([pending, expired], { provider: 'codex' })).toHaveLength(1)
    expect(
      filterApprovalLedgerRecords([pending, expired], {
        provider: 'codex',
        includeExpired: true
      })
    ).toHaveLength(2)
    expect(filterApprovalLedgerRecords([pending], { service: 'fileChanges' })).toHaveLength(0)
  })
})
