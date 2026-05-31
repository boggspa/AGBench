import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ChatRecord } from '../../../main/store/types'
import { AgentIdentityContext } from './AgentIdentityContext'
import { AgentMention } from './AgentMention'

function chatWithIdentity(): ChatRecord {
  return {
    appChatId: 'chat-mention',
    scope: 'workspace',
    provider: 'claude',
    title: 'Mention test',
    workspaceId: 'ws-1',
    workspacePath: '/repo',
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    messages: [],
    runs: [],
    providerMetadata: {
      agentIdentities: {
        'agent-1': {
          agentId: 'agent-1',
          name: 'Harmonium',
          color: '#ff5f5f',
          role: 'Reviewer',
          source: 'pool',
          assignedAt: '2026-05-31T00:00:00.000Z'
        }
      }
    }
  }
}

describe('AgentMention', () => {
  it('renders known sub-agent mentions with the seeded identicon', () => {
    const html = renderToStaticMarkup(
      <AgentIdentityContext.Provider value={chatWithIdentity()}>
        <AgentMention agentId="agent-1">@Harmonium</AgentMention>
      </AgentIdentityContext.Provider>
    )

    expect(html).toContain('agent-mention has-identity')
    expect(html).toContain('agent-identicon')
    expect(html).toContain('@Harmonium')
    expect(html).toContain('color:#ff5f5f')
  })
})
