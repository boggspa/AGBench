export interface ComposerMentionTrigger {
  anchorIndex: number
  query: string
}

export function parseComposerMentionTrigger(
  value: string,
  caretIndex: number = value.length
): ComposerMentionTrigger | null {
  const caret = Math.max(0, Math.min(caretIndex, value.length))
  const before = value.slice(0, caret)
  const match = before.match(/(^|\s)@([^\s@]*)$/)
  if (!match) return null
  return {
    anchorIndex: caret - (match[2].length + 1),
    query: match[2]
  }
}

export function formatComposerPathMention(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return ''
  if (/\s/.test(trimmed)) return `${JSON.stringify(trimmed)} `
  return `${trimmed} `
}
