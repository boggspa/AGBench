import { describe, it, expect } from 'vitest'
import {
  formatComposerModelChip,
  reasoningDisplayLabel,
  shortModelName
} from './composerChipFormat'

describe('shortModelName', () => {
  it('extracts Codex version digit + capitalised suffix', () => {
    expect(shortModelName('codex', 'GPT-5.5', 'gpt-5.5')).toBe('5.5')
    expect(shortModelName('codex', 'GPT-5.4-Mini', 'gpt-5.4-mini')).toBe('5.4-Mini')
    expect(shortModelName('codex', 'GPT-5.3-Codex-Spark', 'gpt-5.3-codex-spark')).toBe(
      '5.3-Codex-Spark'
    )
  })

  it('extracts Claude family + version', () => {
    expect(shortModelName('claude', 'Claude Opus 4.7', 'claude-opus-4-7')).toBe('Opus 4.7')
    expect(shortModelName('claude', 'Claude Sonnet 4.6 (thinking)', 'claude-sonnet-4-6-thinking')).toBe(
      'Sonnet 4.6'
    )
    expect(shortModelName('claude', 'Claude Haiku 4.0', 'claude-haiku-4-0')).toBe('Haiku 4.0')
  })

  it('extracts Kimi version', () => {
    expect(shortModelName('kimi', 'Kimi K2.6 Thinking', 'kimi-k2.6-thinking')).toBe('K2.6')
    expect(shortModelName('kimi', 'Kimi K2.6', 'kimi-k2.6')).toBe('K2.6')
  })

  it('extracts Gemini variant', () => {
    expect(shortModelName('gemini', 'Gemini 2.5 Pro', 'gemini-2.5-pro')).toBe('2.5 Pro')
    expect(shortModelName('gemini', 'Gemini Flash Lite', 'gemini-flash-lite')).toBe('Flash Lite')
  })

  it('falls back to the human label when no provider pattern matches', () => {
    expect(shortModelName('codex', 'Custom Model X', 'custom-model-x')).toBe('Custom Model X')
  })

  it('renders Cursor Composer model ids as human labels', () => {
    expect(shortModelName('cursor', '', 'composer-2.5-fast')).toBe('Composer 2.5 Fast')
    expect(shortModelName('cursor', '', 'composer-2.5')).toBe('Composer 2.5')
  })

  it('renders the Grok CLI model as Grok Build 0.1', () => {
    expect(shortModelName('grok', '', 'grok-build')).toBe('Grok Build 0.1')
  })

  it("resolves the cli-default sentinel to each provider's real default", () => {
    // Kimi + Grok dispatch with the bare sentinel → show their actual default.
    expect(shortModelName('kimi', '', 'cli-default')).toBe('K2.6')
    expect(shortModelName('grok', '', 'cli-default')).toBe('Grok Build 0.1')
    // Providers that resolve a concrete id before dispatch keep the neutral label.
    expect(shortModelName('codex', '', 'cli-default')).toBe('CLI Default')
    expect(shortModelName('claude', '', 'cli-default')).toBe('CLI Default')
    expect(shortModelName('gemini', '', 'cli-default')).toBe('CLI Default')
    expect(shortModelName('cursor', '', 'cli-default')).toBe('CLI Default')
  })
})

describe('reasoningDisplayLabel', () => {
  it('Codex xhigh becomes Extra High', () => {
    expect(
      reasoningDisplayLabel({
        provider: 'codex',
        composerStyle: 'codex',
        modelId: 'gpt-5.5',
        modelLabel: 'GPT-5.5',
        codexReasoningEffort: 'xhigh'
      })
    ).toBe('Extra High')
  })

  it('Codex other levels capitalised', () => {
    expect(
      reasoningDisplayLabel({
        provider: 'codex',
        composerStyle: 'codex',
        modelId: 'gpt-5.5',
        modelLabel: 'GPT-5.5',
        codexReasoningEffort: 'medium'
      })
    ).toBe('Medium')
  })

  it('Claude high becomes Max (Claude Code convention)', () => {
    expect(
      reasoningDisplayLabel({
        provider: 'claude',
        composerStyle: 'claude',
        modelId: 'claude-opus-4-7',
        modelLabel: 'Claude Opus 4.7',
        claudeReasoningEffort: 'high'
      })
    ).toBe('Max')
  })

  it('Claude off returns empty', () => {
    expect(
      reasoningDisplayLabel({
        provider: 'claude',
        composerStyle: 'claude',
        modelId: 'claude-opus-4-7',
        modelLabel: 'Claude Opus 4.7',
        claudeReasoningEffort: 'off'
      })
    ).toBe('')
  })

  it('Kimi maps boolean to Thinking / empty', () => {
    expect(
      reasoningDisplayLabel({
        provider: 'kimi',
        composerStyle: 'kimi',
        modelId: 'kimi-k2.6-thinking',
        modelLabel: 'Kimi K2.6 Thinking',
        kimiThinkingEnabled: true
      })
    ).toBe('Thinking')
    expect(
      reasoningDisplayLabel({
        provider: 'kimi',
        composerStyle: 'kimi',
        modelId: 'kimi-k2.6',
        modelLabel: 'Kimi K2.6',
        kimiThinkingEnabled: false
      })
    ).toBe('')
  })

  it('Gemini returns empty (no reasoning concept yet)', () => {
    expect(
      reasoningDisplayLabel({
        provider: 'gemini',
        composerStyle: 'gemini',
        modelId: 'gemini-2.5-pro',
        modelLabel: 'Gemini 2.5 Pro'
      })
    ).toBe('')
  })
})

describe('formatComposerModelChip', () => {
  it('Codex shell + codex provider → "5.5 Extra High"', () => {
    expect(
      formatComposerModelChip({
        provider: 'codex',
        composerStyle: 'codex',
        modelId: 'gpt-5.5',
        modelLabel: 'GPT-5.5',
        codexReasoningEffort: 'xhigh'
      })
    ).toBe('5.5 Extra High')
  })

  it('Claude shell + claude provider + high → "Opus 4.7 · Max"', () => {
    expect(
      formatComposerModelChip({
        provider: 'claude',
        composerStyle: 'claude',
        modelId: 'claude-opus-4-7',
        modelLabel: 'Claude Opus 4.7',
        claudeReasoningEffort: 'high'
      })
    ).toBe('Opus 4.7 · Max')
  })

  it('Kimi shell + kimi provider + on → "K2.6 Thinking"', () => {
    expect(
      formatComposerModelChip({
        provider: 'kimi',
        composerStyle: 'kimi',
        modelId: 'kimi-k2.6-thinking',
        modelLabel: 'Kimi K2.6 Thinking',
        kimiThinkingEnabled: true
      })
    ).toBe('K2.6 Thinking')
  })

  it('AGBench native shell + codex provider falls back to "GPT-5.5 · High"', () => {
    expect(
      formatComposerModelChip({
        provider: 'codex',
        composerStyle: 'default',
        modelId: 'gpt-5.5',
        modelLabel: 'GPT-5.5',
        codexReasoningEffort: 'high'
      })
    ).toBe('GPT-5.5 · High')
  })

  it('Creative shells use the default format (no shell-specific match)', () => {
    expect(
      formatComposerModelChip({
        provider: 'codex',
        composerStyle: 'terminal',
        modelId: 'gpt-5.5',
        modelLabel: 'GPT-5.5',
        codexReasoningEffort: 'high'
      })
    ).toBe('GPT-5.5 · High')
  })

  it('Omits reasoning suffix when reasoning is off / empty', () => {
    expect(
      formatComposerModelChip({
        provider: 'claude',
        composerStyle: 'claude',
        modelId: 'claude-opus-4-7',
        modelLabel: 'Claude Opus 4.7',
        claudeReasoningEffort: 'off'
      })
    ).toBe('Opus 4.7')
  })

  it('Mismatched shell + provider falls back to default', () => {
    expect(
      formatComposerModelChip({
        provider: 'kimi',
        composerStyle: 'claude',
        modelId: 'kimi-k2.6-thinking',
        modelLabel: 'Kimi K2.6 Thinking',
        kimiThinkingEnabled: true
      })
    ).toBe('Kimi K2.6 Thinking · Thinking')
  })
})
