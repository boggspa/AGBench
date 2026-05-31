import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RemoteDeviceAuditLedger } from './RemoteDeviceAuditLedger'

describe('RemoteDeviceAuditLedger', () => {
  let tmpDir: string
  let storagePath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'remote-device-audit-'))
    storagePath = join(tmpDir, 'remote-device-audit-ledger.json')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('appends device-attributed audit rows and persists them as JSON', () => {
    const ledger = new RemoteDeviceAuditLedger({
      storagePath,
      now: () => '2026-05-31T21:00:00.000Z',
      idFactory: () => 'audit-1'
    })

    const record = ledger.append({
      deviceId: 'pair-1',
      capability: 'startTurn',
      action: 'composerPrompt',
      chatId: 'chat-1',
      decision: 'allowed',
      reason: 'accepted'
    })

    expect(record).toEqual({
      id: 'audit-1',
      deviceId: 'pair-1',
      capability: 'startTurn',
      action: 'composerPrompt',
      chatId: 'chat-1',
      decision: 'allowed',
      reason: 'accepted',
      timestamp: '2026-05-31T21:00:00.000Z'
    })
    expect(JSON.parse(readFileSync(storagePath, 'utf-8'))).toEqual([record])
  })

  it('is idempotent when the same audit id is appended again', () => {
    const ledger = new RemoteDeviceAuditLedger({
      storagePath,
      now: () => '2026-05-31T21:00:00.000Z'
    })

    const first = ledger.append({
      id: 'remote-action:pair-1:a-1:startTurn:allowed',
      deviceId: 'pair-1',
      capability: 'startTurn',
      action: 'composerPrompt',
      decision: 'allowed',
      reason: 'accepted'
    })
    const second = ledger.append({
      id: 'remote-action:pair-1:a-1:startTurn:allowed',
      deviceId: 'pair-1',
      capability: 'startTurn',
      action: 'composerPrompt',
      decision: 'allowed',
      reason: 'accepted again'
    })

    expect(second).toBe(first)
    expect(ledger.list()).toHaveLength(1)
    expect(JSON.parse(readFileSync(storagePath, 'utf-8'))).toHaveLength(1)
  })

  it('loads existing rows and skips malformed entries', () => {
    writeFileSync(
      storagePath,
      JSON.stringify([
        {
          id: 'good',
          deviceId: 'pair-1',
          capability: 'approve',
          action: 'approvalReply',
          decision: 'denied',
          reason: 'capability denied',
          timestamp: '2026-05-31T21:00:00.000Z'
        },
        {
          id: 'bad',
          deviceId: 'pair-2'
        }
      ]),
      'utf-8'
    )

    const ledger = new RemoteDeviceAuditLedger({ storagePath })

    expect(ledger.list()).toEqual([
      {
        id: 'good',
        deviceId: 'pair-1',
        capability: 'approve',
        action: 'approvalReply',
        decision: 'denied',
        reason: 'capability denied',
        timestamp: '2026-05-31T21:00:00.000Z'
      }
    ])
  })
})
