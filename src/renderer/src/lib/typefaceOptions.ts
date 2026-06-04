export const LEGACY_AGBENCH_FONT_STACK =
  '"SF Pro", "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Roboto, Arial, sans-serif'

export const FONT_STACKS = {
  agbench:
    '"Avenir Next", Avenir, system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif',
  compact: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif',
  humanist:
    '"Avenir Next", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  editorial: '"New York", Georgia, "Times New Roman", serif',
  defaultSerif: '"New York", Georgia, "Times New Roman", serif',
  system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
} as const

export const COMPOSER_FONT_MATCH_TRANSCRIPT = 'match-transcript'
export const CUSTOM_FONT_SELECT_VALUE = '__custom_font__'
export const CUSTOM_FONT_FALLBACK =
  '"Avenir Next", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

export type TypefaceOption = {
  value: string
  label: string
  helper?: string
}

export const TRANSCRIPT_FONT_OPTIONS: TypefaceOption[] = [
  { value: FONT_STACKS.agbench, label: 'AGBench default' },
  { value: FONT_STACKS.compact, label: 'Compact Sans' },
  { value: FONT_STACKS.humanist, label: 'Humanist Sans' },
  { value: FONT_STACKS.editorial, label: 'Editorial Serif' },
  { value: FONT_STACKS.defaultSerif, label: 'Default Serif' },
  { value: FONT_STACKS.system, label: 'System UI' }
]

export const COMPOSER_FONT_OPTIONS: TypefaceOption[] = [
  { value: COMPOSER_FONT_MATCH_TRANSCRIPT, label: 'Match transcript' },
  { value: FONT_STACKS.agbench, label: 'AGBench default' },
  { value: FONT_STACKS.compact, label: 'Compact Sans' },
  { value: FONT_STACKS.humanist, label: 'Humanist Sans' },
  { value: FONT_STACKS.editorial, label: 'Editorial Serif' },
  { value: FONT_STACKS.defaultSerif, label: 'Default Serif' },
  { value: FONT_STACKS.system, label: 'System UI' }
]

export function normalizeFontFamily(
  value: unknown,
  fallback: string = FONT_STACKS.agbench
): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (trimmed === LEGACY_AGBENCH_FONT_STACK) return FONT_STACKS.agbench
  return trimmed.length > 0 ? trimmed : fallback
}

export function normalizeComposerFontFamily(value: unknown): string {
  if (value === COMPOSER_FONT_MATCH_TRANSCRIPT) return COMPOSER_FONT_MATCH_TRANSCRIPT
  return normalizeFontFamily(value, COMPOSER_FONT_MATCH_TRANSCRIPT)
}

export function resolveComposerFontFamily(
  composerFontFamily: unknown,
  transcriptFontFamily: unknown
): string {
  const transcript = normalizeFontFamily(transcriptFontFamily, FONT_STACKS.agbench)
  if (composerFontFamily === COMPOSER_FONT_MATCH_TRANSCRIPT) return transcript
  return normalizeFontFamily(composerFontFamily, transcript)
}

export function getFontSelectValue(options: TypefaceOption[], value: string): string {
  const normalizedValue = normalizeFontFamily(value, value)
  return options.some((option) => option.value === normalizedValue)
    ? normalizedValue
    : CUSTOM_FONT_SELECT_VALUE
}

export function quoteInstalledFontFamily(fontFamily: string): string {
  const safeFamily = fontFamily.replace(/\\/g, '\\\\').replace(/"/g, '\\"').trim()
  return `"${safeFamily}", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
}
