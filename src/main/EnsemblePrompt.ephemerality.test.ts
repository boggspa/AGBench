/**
 * M6 (1.0.7) — end-to-end thinking-ephemerality regression.
 *
 * Separate from EnsemblePrompt.test.ts (kept additive) — asserts the prompt
 * builder, with the stripReasoningChains guard wired into buildTaggedTranscript,
 * drops an inlined reasoning chain from an EPHEMERAL-reasoning provider's prior
 * message while RETAINING one from Codex (durable). This pins the invariant at
 * the integration layer, not just the unit layer.
 */
import { describe, expect, it } from 'vitest'
import { buildEnsembleParticipantPrompt, type BuildEnsemblePromptInput } from './EnsemblePrompt'
import type {
  ChatMessage,
  ChatRecord,
  EnsembleConfig,
  EnsembleParticipant,
  ProviderId
} from './store/types'

function participant(id: string, provider: ProviderId, role: string, order: number): EnsembleParticipant {
  return { id, provider, role, enabled: true, order }
}

function assistantMessage(provider: ProviderId, role: string, content: string): ChatMessage {
  return {
    id: `m-${provider}-${order(provider)}`,
    role: 'assistant',
    content,
    timestamp: '2026-01-01T00:00:00.000Z',
    metadata: { ensembleProvider: provider, ensembleRole: role }
  }
}
let counter = 0
function order(_p: string): number {
  counter += 1
  return counter
}

function makeChat(messages: ChatMessage[]): ChatRecord {
  return {
    appChatId: 'chat-1',
    title: 'Test',
    provider: 'codex',
    messages,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  } as ChatRecord
}

const participants = [
  participant('p-codex', 'codex', 'Engineer', 0),
  participant('p-claude', 'claude', 'Reviewer', 1)
]

const config: EnsembleConfig = {
  enabled: true,
  maxParticipants: 6,
  participants,
  orchestrationMode: 'turn_bound'
} as EnsembleConfig

function buildWith(messages: ChatMessage[]): string {
  const input: BuildEnsemblePromptInput = {
    chat: makeChat(messages),
    config,
    participant: participants[0],
    currentPrompt: 'Continue.',
    roundId: 'round-2'
  }
  return buildEnsembleParticipantPrompt(input)
}

describe('M6 — thinking-ephemerality in the built prompt', () => {
  it('strips a Claude reasoning chain from the transcript fed to the next round', () => {
    const prompt = buildWith([
      assistantMessage('claude', 'Reviewer', 'Visible conclusion.\n<think>private claude cot</think>')
    ])
    expect(prompt).toContain('Visible conclusion.')
    expect(prompt).not.toContain('private claude cot')
  })

  it('retains a Codex reasoning chain (durable streamed reasoning)', () => {
    const prompt = buildWith([
      assistantMessage('codex', 'Engineer', 'Codex answer.\n<think>codex durable reasoning</think>')
    ])
    expect(prompt).toContain('Codex answer.')
    expect(prompt).toContain('codex durable reasoning')
  })

  it('handles a mixed transcript — drops the ephemeral chain, keeps the durable one', () => {
    const prompt = buildWith([
      assistantMessage('codex', 'Engineer', 'Codex says X.\n<think>keep me</think>'),
      assistantMessage('claude', 'Reviewer', 'Claude says Y.\n<think>drop me</think>')
    ])
    expect(prompt).toContain('keep me')
    expect(prompt).not.toContain('drop me')
    expect(prompt).toContain('Codex says X.')
    expect(prompt).toContain('Claude says Y.')
  })

  it('leaves ordinary prose untouched (no false positives)', () => {
    const prompt = buildWith([
      assistantMessage('claude', 'Reviewer', 'I kept thinking about the tradeoffs before deciding.')
    ])
    expect(prompt).toContain('I kept thinking about the tradeoffs before deciding.')
  })
})
