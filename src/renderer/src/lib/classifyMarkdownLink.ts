/*
 * classifyMarkdownLink — pure classifier for href strings encountered
 * in transcript markdown. Used by MarkdownMessage's `a` override to
 * decide what to do on click (open externally, open in OS, treat as
 * agent chip, or refuse).
 *
 * Phase K1 — the renderer used to fall back to a bare `<a href>` for
 * non-http links. Plain left-click then triggered BrowserWindow
 * navigation away from the bundled index.html, blanking the entire
 * app (the renderer process didn't crash — it just navigated to the
 * `.ts` file or `about:blank`). This module + the click handler in
 * MarkdownMessage prevent that by classifying every link up front
 * and routing it through the preload bridge or refusing to act.
 */

export type MarkdownLinkKind = 'external' | 'path' | 'agent' | 'unknown'

export interface MarkdownLinkClassification {
  kind: MarkdownLinkKind
  /**
   * Resolved canonical href.
   *  - `external`: original href trimmed
   *  - `agent`: original `agent://...` URI trimmed
   *  - `path`: absolute or relative path string (no `file://` prefix,
   *    no `:line:col` suffix — those won't survive `shell.openPath`)
   *  - `unknown`: original href trimmed (for logging / diagnostics)
   */
  resolved: string
  /** For `path` only: optional line / col preserved from a `:N:M` suffix. */
  line?: number
  column?: number
}

const UNSAFE_SCHEMES = new Set(['javascript', 'data', 'vbscript'])
const EXTERNAL_SCHEMES = new Set(['http', 'https', 'mailto'])

function stripLineColSuffix(input: string): { path: string; line?: number; column?: number } {
  // Matches trailing `:N` or `:N:M` — common in compiler / agent output
  // (e.g. `src/foo.ts:42:7`). Only digits qualify so `foo:bar` (no
  // line number) is left untouched.
  const match = /^(.*?)(?::(\d+))(?::(\d+))?$/.exec(input)
  if (!match) return { path: input }
  return {
    path: match[1],
    line: Number(match[2]),
    column: match[3] !== undefined ? Number(match[3]) : undefined
  }
}

export function classifyMarkdownLink(href: string | undefined | null): MarkdownLinkClassification {
  const raw = typeof href === 'string' ? href.trim() : ''
  if (!raw) return { kind: 'unknown', resolved: '' }

  if (raw.startsWith('agent://')) {
    return { kind: 'agent', resolved: raw }
  }

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(raw)
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase()

    // Single-letter "scheme" is overwhelmingly a Windows drive letter
    // (`C:\path\to\file.ts`). Treat as a path so Windows users aren't
    // locked out by an over-eager scheme parser.
    if (scheme.length === 1) {
      const stripped = stripLineColSuffix(raw)
      return {
        kind: 'path',
        resolved: stripped.path,
        line: stripped.line,
        column: stripped.column
      }
    }

    if (UNSAFE_SCHEMES.has(scheme)) {
      return { kind: 'unknown', resolved: raw }
    }
    if (EXTERNAL_SCHEMES.has(scheme)) {
      return { kind: 'external', resolved: raw }
    }
    if (scheme === 'file') {
      try {
        const url = new URL(raw)
        const decoded = decodeURIComponent(url.pathname)
        const stripped = stripLineColSuffix(decoded)
        return {
          kind: 'path',
          resolved: stripped.path,
          line: stripped.line,
          column: stripped.column
        }
      } catch {
        return { kind: 'unknown', resolved: raw }
      }
    }
    // Any other scheme (ssh:, ftp:, custom protocols) — refuse to act.
    return { kind: 'unknown', resolved: raw }
  }

  // No scheme — treat as a path. Covers `/abs/path.ts`, `./rel/path`,
  // `../rel/path`, and bare filenames like `README.md`.
  const stripped = stripLineColSuffix(raw)
  return {
    kind: 'path',
    resolved: stripped.path,
    line: stripped.line,
    column: stripped.column
  }
}
