import { describe, expect, it } from 'vitest'
import {
  COMPOSER_FONT_MATCH_TRANSCRIPT,
  COMPOSER_FONT_OPTIONS,
  CUSTOM_FONT_SELECT_VALUE,
  FONT_STACKS,
  LEGACY_AGBENCH_FONT_STACK,
  TRANSCRIPT_FONT_OPTIONS,
  getFontSelectValue,
  normalizeComposerFontFamily,
  normalizeFontFamily,
  quoteInstalledFontFamily,
  resolveComposerFontFamily
} from './typefaceOptions'

describe('typeface option lists', () => {
  it('keeps transcript options focused on concrete font stacks', () => {
    expect(TRANSCRIPT_FONT_OPTIONS.map((option) => option.label)).toEqual([
      'AGBench default',
      'Compact Sans',
      'Humanist Sans',
      'Editorial Serif',
      'Default Serif',
      'System UI'
    ])
    expect(TRANSCRIPT_FONT_OPTIONS).not.toContainEqual(
      expect.objectContaining({ value: COMPOSER_FONT_MATCH_TRANSCRIPT })
    )
    expect(FONT_STACKS.agbench).toContain('"Avenir Next", Avenir')
  })

  it('puts match-transcript first for composer options', () => {
    expect(COMPOSER_FONT_OPTIONS[0]).toEqual({
      value: COMPOSER_FONT_MATCH_TRANSCRIPT,
      label: 'Match transcript'
    })
  })
})

describe('normalizeFontFamily', () => {
  it('returns trimmed custom font stacks', () => {
    expect(normalizeFontFamily('  "Inter", sans-serif  ')).toBe('"Inter", sans-serif')
  })

  it('uses the requested fallback for non-string and blank values', () => {
    expect(normalizeFontFamily(undefined, FONT_STACKS.system)).toBe(FONT_STACKS.system)
    expect(normalizeFontFamily('   ', FONT_STACKS.compact)).toBe(FONT_STACKS.compact)
  })

  it('normalizes the old SF Pro AGBench default to the current default stack', () => {
    expect(normalizeFontFamily(LEGACY_AGBENCH_FONT_STACK)).toBe(FONT_STACKS.agbench)
  })
})

describe('composer font resolution', () => {
  it('preserves the match-transcript sentinel during normalization', () => {
    expect(normalizeComposerFontFamily(COMPOSER_FONT_MATCH_TRANSCRIPT)).toBe(
      COMPOSER_FONT_MATCH_TRANSCRIPT
    )
  })

  it('resolves match-transcript to the normalized transcript font', () => {
    expect(
      resolveComposerFontFamily(COMPOSER_FONT_MATCH_TRANSCRIPT, ` ${FONT_STACKS.humanist} `)
    ).toBe(FONT_STACKS.humanist)
  })

  it('falls back to the transcript font when composer value is invalid', () => {
    expect(resolveComposerFontFamily('', FONT_STACKS.editorial)).toBe(FONT_STACKS.editorial)
  })
})

describe('getFontSelectValue', () => {
  it('returns known option values unchanged', () => {
    expect(getFontSelectValue(TRANSCRIPT_FONT_OPTIONS, FONT_STACKS.agbench)).toBe(
      FONT_STACKS.agbench
    )
  })

  it('maps the old SF Pro AGBench default to the current default option', () => {
    expect(getFontSelectValue(TRANSCRIPT_FONT_OPTIONS, LEGACY_AGBENCH_FONT_STACK)).toBe(
      FONT_STACKS.agbench
    )
  })

  it('maps unknown custom stacks to the custom select value', () => {
    expect(getFontSelectValue(TRANSCRIPT_FONT_OPTIONS, '"Custom", sans-serif')).toBe(
      CUSTOM_FONT_SELECT_VALUE
    )
  })
})

describe('quoteInstalledFontFamily', () => {
  it('quotes and appends a stable fallback stack', () => {
    expect(quoteInstalledFontFamily('Berkeley Mono')).toBe(
      '"Berkeley Mono", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    )
  })

  it('escapes quotes and backslashes before wrapping the family name', () => {
    expect(quoteInstalledFontFamily('ACME \\"Code"')).toContain('"ACME \\\\\\"Code\\""')
  })
})
