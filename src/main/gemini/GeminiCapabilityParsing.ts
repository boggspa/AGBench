import { MAX_CAPABILITY_OUTPUT_CHARS } from '../geminiCapabilityTypes'
export function stripAnsi(value: string): string {
  return value.replace(new RegExp(String.raw`\u001b\[[0-?]*[ -/]*[@-~]`, 'g'), '')
}

export function appendLimitedOutput(
  current: string,
  chunk: Buffer
): { value: string; truncated: boolean } {
  const next = current + chunk.toString('utf8')
  if (next.length <= MAX_CAPABILITY_OUTPUT_CHARS) {
    return { value: next, truncated: false }
  }

  return {
    value: `${next.slice(0, MAX_CAPABILITY_OUTPUT_CHARS)}\n[output truncated]`,
    truncated: true
  }
}

export function stringifyJsonFragment(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

export function readStringField(record: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = record[field]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }
  }
  return undefined
}
