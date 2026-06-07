import { fileURLToPath } from 'url'

export type ShellOpenDecision =
  | { action: 'external'; href: string }
  | { action: 'path'; path: string }
  | { action: 'deny'; error: string }

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'x-apple.systempreferences:'])
const UNSAFE_PROTOCOLS = /^(javascript|data|vbscript):/i
const MACOS_SYSTEM_SETTINGS_PROTOCOL = /^x-apple\.systempreferences:/i

export function classifyShellOpenTarget(hrefRaw: unknown): ShellOpenDecision {
  const href = typeof hrefRaw === 'string' ? hrefRaw.trim() : ''
  if (!href) return { action: 'deny', error: 'Empty href' }

  if (MACOS_SYSTEM_SETTINGS_PROTOCOL.test(href)) {
    return { action: 'external', href }
  }

  if (/^file:/i.test(href)) {
    try {
      return { action: 'path', path: fileURLToPath(href) }
    } catch (error) {
      return {
        action: 'deny',
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  if (UNSAFE_PROTOCOLS.test(href)) {
    return { action: 'deny', error: 'Refused unsafe scheme' }
  }

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href)
  if (schemeMatch) {
    const scheme = schemeMatch[1]
    if (scheme.length === 1) {
      return { action: 'path', path: href }
    }
    try {
      const url = new URL(href)
      if (EXTERNAL_PROTOCOLS.has(url.protocol)) {
        return { action: 'external', href: url.toString() }
      }
      return { action: 'deny', error: `Refused unsupported scheme: ${scheme}` }
    } catch (error) {
      return {
        action: 'deny',
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  return { action: 'path', path: href }
}
