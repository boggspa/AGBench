import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ChatRecord } from '../../../main/store/types'
import { AgentIdentityContext } from './AgentIdentityContext'
import { ParticipantMention } from './ParticipantMention'

// Minimal contexts — ParticipantMention only reads
// `chat.ensemble.participants` (id / role / provider), so partial casts
// keep the fixtures readable.
const emptyEnsembleChat = { ensemble: { participants: [] } } as unknown as ChatRecord
const reviewerChat = {
  ensemble: { participants: [{ id: 'p1', provider: 'claude', role: 'Reviewer' }] }
} as unknown as ChatRecord

describe('ParticipantMention', () => {
  it('renders @user / @human / @you as a distinct user-address chip', () => {
    for (const word of ['user', 'human', 'you']) {
      const html = renderToStaticMarkup(
        <AgentIdentityContext.Provider value={emptyEnsembleChat}>
          <ParticipantMention reference={word}>@{word}</ParticipantMention>
        </AgentIdentityContext.Provider>
      )
      // Distinct user-address styling, not the bare-text fallback.
      expect(html).toContain('participant-mention--user')
      expect(html).toContain('--user-bubble-base')
      expect(html).toContain(`@${word}`)
    }
  })

  it('leaves an unresolved non-user mention as plain text (no chip)', () => {
    const html = renderToStaticMarkup(
      <AgentIdentityContext.Provider value={emptyEnsembleChat}>
        <ParticipantMention reference="nobody">@nobody</ParticipantMention>
      </AgentIdentityContext.Provider>
    )
    expect(html).not.toContain('participant-mention')
    expect(html).toContain('@nobody')
  })

  it('still renders a resolved participant as a provider-tinted chip', () => {
    const html = renderToStaticMarkup(
      <AgentIdentityContext.Provider value={reviewerChat}>
        <ParticipantMention reference="Reviewer">@Reviewer</ParticipantMention>
      </AgentIdentityContext.Provider>
    )
    expect(html).toContain('class="participant-mention"')
    expect(html).not.toContain('participant-mention--user')
    expect(html).toContain('--provider-claude-color')
  })
})
