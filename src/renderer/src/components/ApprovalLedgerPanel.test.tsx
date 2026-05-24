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
})
