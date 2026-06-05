import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { createRequire } from 'module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  runApprovalTitleBackfill
}: {
  runApprovalTitleBackfill: (options: {
    dryRun: boolean
    ledgerPath: string
    outDir?: string
    quietUnchanged?: boolean
  }) => {
    changed: number
    unchanged: number
    backupPath: string | null
    diffPath: string
    staleRowsAfter: unknown[]
  }
} = require('./approval-title-backfill.cjs')

describe('approval-title-backfill script', () => {
  it('dry-runs against a copied ledger without mutating the source file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'taskwraith-approval-title-backfill-'))
    try {
      const ledgerPath = path.join(dir, 'approval-ledger.copy.json')
      const originalRows = [
        {
          schemaVersion: 1,
          id: 'copy-row',
          approvalId: 'copy-row',
          provider: 'codex',
          service: 'mcpTools',
          method: 'codex-mcp/workspace_search',
          title: 'Approve Gemini tool call',
          actions: ['accept', 'decline'],
          status: 'pending',
          requestedAt: '2026-05-07T00:00:00.000Z',
          expiration: { mode: 'pending_timeout', description: 'test' }
        }
      ]
      writeFileSync(ledgerPath, `${JSON.stringify(originalRows, null, 2)}\n`)
      const before = readFileSync(ledgerPath, 'utf8')

      const result = runApprovalTitleBackfill({
        dryRun: true,
        ledgerPath,
        outDir: dir,
        quietUnchanged: true
      })

      expect(result.changed).toBe(1)
      expect(result.backupPath).toBeNull()
      expect(readFileSync(ledgerPath, 'utf8')).toBe(before)
      const diff = JSON.parse(readFileSync(result.diffPath, 'utf8')) as {
        dryRun: boolean
        changes: Array<{ previousTitle: string; nextTitle: string }>
        unchangedRows: unknown[]
      }
      expect(diff.dryRun).toBe(true)
      expect(diff.changes[0]).toMatchObject({
        previousTitle: 'Approve Gemini tool call',
        nextTitle: 'Approve Codex tool call'
      })
      expect(diff.unchangedRows).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes a backup on wet-run and is idempotent on rerun', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'taskwraith-approval-title-backfill-'))
    try {
      const ledgerPath = path.join(dir, 'approval-ledger.copy.json')
      writeFileSync(
        ledgerPath,
        `${JSON.stringify(
          [
            {
              schemaVersion: 1,
              id: 'write-row',
              approvalId: 'write-row',
              provider: 'claude',
              service: 'subThreadDelegation',
              method: 'claude-mcp/delegate_to_subthread',
              title: 'Gemini wants to delegate to Codex sub-thread',
              actions: ['accept', 'decline'],
              status: 'pending',
              requestedAt: '2026-05-07T00:00:00.000Z',
              expiration: { mode: 'pending_timeout', description: 'test' }
            }
          ],
          null,
          2
        )}\n`
      )

      const writeResult = runApprovalTitleBackfill({
        dryRun: false,
        ledgerPath,
        outDir: dir,
        quietUnchanged: true
      })
      const rows = JSON.parse(readFileSync(ledgerPath, 'utf8')) as Array<{ title: string }>
      expect(writeResult.changed).toBe(1)
      expect(writeResult.backupPath).toBeTruthy()
      expect(rows[0].title).toBe('Claude wants to delegate to Codex sub-thread')

      const rerun = runApprovalTitleBackfill({
        dryRun: true,
        ledgerPath,
        outDir: dir,
        quietUnchanged: true
      })
      expect(rerun.changed).toBe(0)
      expect(rerun.staleRowsAfter).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
