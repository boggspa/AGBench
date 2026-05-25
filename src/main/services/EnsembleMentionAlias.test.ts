import { describe, expect, it } from 'vitest'
import type { EnsembleParticipant } from '../store/types'
import {
  buildParticipantAliasMap,
  findAllMentions,
  findFirstMention,
  generateModelAliases,
  getParticipantAliases,
  hasMention,
  isReservedMentionToken,
  normalizeAlias,
  resolvePhraseToParticipant
} from './EnsembleMentionAlias'

/**
 * Smoke + behaviour tests for the shared `@`-mention alias resolver.
 *
 * The resolver underpins three production surfaces (composer overlay
 * tokeniser, send-side DM routing, orchestrator auto-promotion) so
 * coverage here doubles as a regression net for all three. Tests are
 * deliberately tied to realistic 1.0.3+ model strings so that when
 * 1.0.4 introduces same-provider participants (two Claudes, two
 * Codexes, etc.), the model-name disambiguation keeps working.
 */

function participant(p: Partial<EnsembleParticipant> & Pick<EnsembleParticipant, 'id' | 'provider'>): EnsembleParticipant {
  return {
    enabled: true,
    role: '',
    instructions: '',
    order: 0,
    ...p
  } as EnsembleParticipant
}

const CODEX = participant({
  id: 'ensemble-codex',
  provider: 'codex',
  role: 'Planner',
  model: 'gpt-5.5'
})
const CODEX_MINI = participant({
  id: 'ensemble-codex-mini',
  provider: 'codex',
  role: 'Reviewer',
  model: 'gpt-5.4-mini',
  order: 1
})
const CLAUDE = participant({
  id: 'ensemble-claude',
  provider: 'claude',
  role: 'Critic',
  model: 'claude-sonnet-4-7',
  order: 2
})
const GEMINI = participant({
  id: 'ensemble-gemini',
  provider: 'gemini',
  role: 'Researcher',
  model: 'gemini-2.5-flash-lite',
  order: 3
})
const KIMI = participant({
  id: 'ensemble-kimi',
  provider: 'kimi',
  role: 'Coder',
  model: 'kimi-k2.6-thinking',
  order: 4
})

const QUARTET = [CODEX, CLAUDE, GEMINI, KIMI]

describe('normalizeAlias', () => {
  it('lowercases and collapses whitespace + hyphens + underscores', () => {
    expect(normalizeAlias('GPT-5.5')).toBe('gpt 5.5')
    expect(normalizeAlias('Sonnet  4.7')).toBe('sonnet 4.7')
    expect(normalizeAlias('Kimi_K2.6')).toBe('kimi k2.6')
    expect(normalizeAlias('  Flash--Lite  ')).toBe('flash lite')
  })
})

describe('generateModelAliases', () => {
  it('codex: includes bare version + gpt-prefixed + suffix variants', () => {
    const aliases = generateModelAliases('codex', 'gpt-5.5')
    expect(aliases).toContain('5.5')
    expect(aliases).toContain('gpt 5.5')
    // Concat form for fast typists.
    expect(aliases).toContain('gpt5.5')
  })

  it('codex: handles mini / suffix variants', () => {
    const aliases = generateModelAliases('codex', 'gpt-5.4-mini')
    expect(aliases).toContain('5.4 mini')
    expect(aliases).toContain('gpt 5.4 mini')
    expect(aliases).toContain('5.4')
  })

  it('claude: includes family + family+version + claude-prefixed forms', () => {
    const aliases = generateModelAliases('claude', 'claude-sonnet-4-7')
    expect(aliases).toContain('sonnet')
    expect(aliases).toContain('sonnet 4.7')
    expect(aliases).toContain('claude sonnet 4.7')
  })

  it('kimi: K2.6 + Kimi K2.6 + suffix forms', () => {
    const aliases = generateModelAliases('kimi', 'kimi-k2.6-thinking')
    expect(aliases).toContain('k2.6')
    expect(aliases).toContain('kimi k2.6')
    expect(aliases).toContain('k2.6 thinking')
  })

  it('gemini: variant + tail-only aliases for Flash Lite et al.', () => {
    const aliases = generateModelAliases('gemini', 'gemini-2.5-flash-lite')
    expect(aliases).toContain('2.5 flash lite')
    expect(aliases).toContain('flash lite')
    expect(aliases).toContain('gemini 2.5 flash lite')
    // Final-word alias so two Geminis distinguished by Pro / Flash /
    // Lite can be tagged by the trailing word alone.
    expect(aliases).toContain('lite')
  })
})

describe('getParticipantAliases', () => {
  it('includes id, provider, role, and model aliases', () => {
    const aliases = new Set(getParticipantAliases(CODEX))
    expect(aliases.has('ensemble codex')).toBe(true)
    expect(aliases.has('codex')).toBe(true)
    expect(aliases.has('planner')).toBe(true)
    expect(aliases.has('gpt 5.5')).toBe(true)
    expect(aliases.has('5.5')).toBe(true)
  })

  it('skips reserved tokens that might land in role slot', () => {
    const sneaky = participant({
      id: 'ensemble-user',
      provider: 'codex',
      role: 'me',
      model: 'gpt-5.5'
    })
    const aliases = new Set(getParticipantAliases(sneaky))
    expect(aliases.has('me')).toBe(false)
  })
})

describe('isReservedMentionToken', () => {
  it('reserves the user-referencing pronouns', () => {
    expect(isReservedMentionToken('me')).toBe(true)
    expect(isReservedMentionToken('self')).toBe(true)
    expect(isReservedMentionToken('user')).toBe(true)
    expect(isReservedMentionToken('human')).toBe(true)
    expect(isReservedMentionToken('codex')).toBe(false)
  })
})

describe('buildParticipantAliasMap', () => {
  it('points each alias to the claiming participant(s)', () => {
    const map = buildParticipantAliasMap(QUARTET)
    expect(map.byAlias.get('codex')?.[0]).toBe(CODEX)
    expect(map.byAlias.get('gpt 5.5')?.[0]).toBe(CODEX)
    expect(map.byAlias.get('sonnet 4.7')?.[0]).toBe(CLAUDE)
    expect(map.byAlias.get('flash lite')?.[0]).toBe(GEMINI)
    expect(map.byAlias.get('k2.6')?.[0]).toBe(KIMI)
  })

  it('tracks word counts so longest-prefix wins', () => {
    const map = buildParticipantAliasMap(QUARTET)
    expect(map.aliasWordCount.get('codex')).toBe(1)
    expect(map.aliasWordCount.get('gpt 5.5')).toBe(2)
    expect(map.aliasWordCount.get('claude sonnet 4.7')).toBe(3)
  })
})

describe('findFirstMention — legacy single-token (back-compat)', () => {
  it('matches @codex by provider name', () => {
    const result = findFirstMention('@codex go ahead', QUARTET)
    expect(result?.participant.id).toBe(CODEX.id)
    expect(result?.text).toBe('codex')
    expect(result?.consumedLength).toBe('@codex'.length)
  })

  it('matches @Planner by role', () => {
    const result = findFirstMention('@Planner can you draft this?', QUARTET)
    expect(result?.participant.id).toBe(CODEX.id)
    expect(result?.text).toBe('Planner')
  })

  it('rejects email-style @ inside a word', () => {
    expect(findFirstMention('email chris@example.com', QUARTET)).toBeNull()
  })

  it('rejects reserved @me / @self', () => {
    expect(findFirstMention('thanks @me', QUARTET)).toBeNull()
    expect(findFirstMention('back to @user', QUARTET)).toBeNull()
  })
})

describe('findFirstMention — multi-word model aliases (the 1.0.4 lift)', () => {
  it('resolves @GPT 5.5 to the codex participant', () => {
    const result = findFirstMention('Hey @GPT 5.5 take a look', QUARTET)
    expect(result?.participant.id).toBe(CODEX.id)
    expect(result?.text).toBe('GPT 5.5')
    expect(result?.consumedLength).toBe('@GPT 5.5'.length)
  })

  it('resolves @Sonnet 4.7 to the claude participant', () => {
    const result = findFirstMention('plz review @Sonnet 4.7', QUARTET)
    expect(result?.participant.id).toBe(CLAUDE.id)
    expect(result?.text).toBe('Sonnet 4.7')
  })

  it('resolves @Flash Lite to the gemini participant', () => {
    const result = findFirstMention('@Flash Lite please summarise', QUARTET)
    expect(result?.participant.id).toBe(GEMINI.id)
    expect(result?.text).toBe('Flash Lite')
  })

  it('resolves @Kimi K2.6 to the kimi participant', () => {
    const result = findFirstMention('@Kimi K2.6 weigh in', QUARTET)
    expect(result?.participant.id).toBe(KIMI.id)
    expect(result?.text).toBe('Kimi K2.6')
  })

  it('prefers longest-prefix when shorter prefixes also resolve', () => {
    // "kimi" alone resolves to KIMI, but "kimi k2.6 thinking" is a
    // 3-word alias that must win when present.
    const result = findFirstMention('@Kimi K2.6 thinking please', QUARTET)
    expect(result?.participant.id).toBe(KIMI.id)
    expect(result?.text).toBe('Kimi K2.6 thinking')
  })

  it('falls back to shorter prefix when the longer one does not match', () => {
    // "@codex super-duper" — no "codex super-duper" alias, so it
    // resolves "codex" alone and leaves "super-duper" as trailing text.
    const result = findFirstMention('@codex super-duper move', QUARTET)
    expect(result?.participant.id).toBe(CODEX.id)
    expect(result?.text).toBe('codex')
  })

  it('excludes self-mentions via excludeIds', () => {
    const result = findFirstMention(
      '@codex I am Codex, deferring',
      QUARTET,
      new Set([CODEX.id])
    )
    // Codex narrating itself by provider name → null when excluded.
    expect(result).toBeNull()
  })

  it('handles hyphen + concat alias forms', () => {
    // `@gpt-5.5` should resolve as well as `@GPT 5.5` and `@gpt5.5`.
    expect(findFirstMention('@gpt-5.5 hi', QUARTET)?.participant.id).toBe(CODEX.id)
    expect(findFirstMention('@gpt5.5 hi', QUARTET)?.participant.id).toBe(CODEX.id)
    expect(findFirstMention('@GPT 5.5 hi', QUARTET)?.participant.id).toBe(CODEX.id)
  })
})

describe('findAllMentions', () => {
  it('returns multiple mentions in order', () => {
    const all = findAllMentions('First @codex then @Sonnet 4.7 and @Flash Lite', QUARTET)
    expect(all).toHaveLength(3)
    expect(all[0].participant.id).toBe(CODEX.id)
    expect(all[1].participant.id).toBe(CLAUDE.id)
    expect(all[2].participant.id).toBe(GEMINI.id)
  })

  it('preserves indices that point at the `@` character', () => {
    const text = 'hi @codex go'
    const all = findAllMentions(text, QUARTET)
    expect(text[all[0].atIndex]).toBe('@')
  })
})

describe('hasMention', () => {
  it('short-circuits with no @ in the text', () => {
    expect(hasMention('plain text', QUARTET)).toBe(false)
  })
  it('returns true for resolved mentions', () => {
    expect(hasMention('hi @codex', QUARTET)).toBe(true)
    expect(hasMention('hi @GPT 5.5', QUARTET)).toBe(true)
  })
  it('returns false for emails / unresolved tokens', () => {
    expect(hasMention('chris@example.com', QUARTET)).toBe(false)
    expect(hasMention('@unknownmodel', QUARTET)).toBe(false)
  })
})

describe('resolvePhraseToParticipant (legacy single-phrase entry point)', () => {
  it('resolves bare provider name', () => {
    expect(resolvePhraseToParticipant('codex', QUARTET)?.id).toBe(CODEX.id)
  })
  it('resolves multi-word model phrase', () => {
    expect(resolvePhraseToParticipant('gpt 5.5', QUARTET)?.id).toBe(CODEX.id)
    expect(resolvePhraseToParticipant('sonnet 4.7', QUARTET)?.id).toBe(CLAUDE.id)
  })
  it('honours excludeIds', () => {
    expect(
      resolvePhraseToParticipant('codex', QUARTET, new Set([CODEX.id]))
    ).toBeNull()
  })
})

describe('Same-provider disambiguation (1.0.4 forward-look)', () => {
  it('GPT 5.5 vs GPT 5.4 Mini route to the right Codex participant', () => {
    const set = [CODEX, CODEX_MINI]
    expect(findFirstMention('@GPT 5.5 go', set)?.participant.id).toBe(CODEX.id)
    expect(findFirstMention('@GPT 5.4 Mini go', set)?.participant.id).toBe(
      CODEX_MINI.id
    )
    // The shared "codex" alias falls back to ensemble-order (CODEX
    // first), which is the deterministic + documented behaviour.
    expect(findFirstMention('@codex go', set)?.participant.id).toBe(CODEX.id)
  })
})
