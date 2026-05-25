import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ApprovalLedgerPanel } from './ApprovalLedgerPanel'
import type { AgenticWorkspaceGrant } from '../../../main/store/types'

function makeGrant(overrides: Partial<AgenticWorkspaceGrant> = {}): AgenticWorkspaceGrant {
  return {
    id: 'grant-1',
    provider: 'codex',
    service: 'fileChanges',
    workspacePath: '/Users/dev/Documents/GUIGemini',
    createdAt: '2026-05-24T12:00:00.000Z',
    updatedAt: '2026-05-24T12:00:00.000Z',
    expiresOn: 'workspace_revocation',
    ...overrides
  }
}

describe('ApprovalLedgerPanel', () => {
  it('renders active workspace grants above the ledger controls', () => {
    const html = renderToStaticMarkup(
      <ApprovalLedgerPanel
        workspaceGrants={[makeGrant()]}
        onRevokeWorkspaceGrant={() => undefined}
      />
    )

    expect(html).toContain('Workspace grants')
    expect(html).toContain('Codex · File changes')
    expect(html).toContain('GUIGemini')
    expect(html).toContain('Revoke')
  })

  it('renders an empty workspace-grant state', () => {
    const html = renderToStaticMarkup(<ApprovalLedgerPanel workspaceGrants={[]} />)

    expect(html).toContain('No active workspace grants.')
  })

  // Slice (1.0.3) — bulk-forget affordance. The button surfaces only
  // when there's at least one sub-thread delegation grant scoped to
  // the current workspace.
  it('surfaces the bulk forget button when sub-thread delegation grants exist here', () => {
    const grants = [
      makeGrant({ id: 'g1', provider: 'codex', service: 'subThreadDelegation' }),
      makeGrant({ id: 'g2', provider: 'claude', service: 'subThreadDelegation' }),
      // Unrelated service in same workspace — must not be counted.
      makeGrant({ id: 'g3', provider: 'codex', service: 'fileChanges' }),
      // Sub-thread grant in a different workspace — must not be counted.
      makeGrant({
        id: 'g4',
        provider: 'gemini',
        service: 'subThreadDelegation',
        workspacePath: '/Users/dev/Documents/Other'
      })
    ]
    const html = renderToStaticMarkup(
      <ApprovalLedgerPanel
        workspaceGrants={grants}
        currentWorkspacePath="/Users/dev/Documents/GUIGemini"
        onRevokeWorkspaceGrant={() => undefined}
      />
    )

    expect(html).toContain('Forget all sub-thread delegations for this workspace (2)')
  })

  it('hides the bulk forget button when no matching grants exist', () => {
    const html = renderToStaticMarkup(
      <ApprovalLedgerPanel
        workspaceGrants={[makeGrant({ service: 'fileChanges' })]}
        currentWorkspacePath="/Users/dev/Documents/GUIGemini"
        onRevokeWorkspaceGrant={() => undefined}
      />
    )

    expect(html).not.toContain('Forget all sub-thread delegations')
  })

  it('hides the bulk forget button when no workspace path is provided', () => {
    const html = renderToStaticMarkup(
      <ApprovalLedgerPanel
        workspaceGrants={[
          makeGrant({ service: 'subThreadDelegation' })
        ]}
        onRevokeWorkspaceGrant={() => undefined}
      />
    )

    expect(html).not.toContain('Forget all sub-thread delegations')
  })
})
