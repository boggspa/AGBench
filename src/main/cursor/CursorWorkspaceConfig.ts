// CR6 — workspace-local Cursor permission config for AGBench-owned WRITE mode.
//
// The CR3 spike proved a bare `cursor-agent -p` runs native write+shell
// UNMEDIATED, and that a `.cursor/cli.json` deny-list hard-blocks them. Cursor
// has no `--deny` argv flag (unlike Grok) — permissions are file-based — so
// write-capable runs write a transient workspace-local `.cursor/cli.json` that
// **denies native shell** (`Shell(**)`) while leaving file edits allowed. Edits
// then land in the workspace and are surfaced through AGBench's run-diff /
// "Review changes" authority surface (the same net Grok's headless write mode
// uses); native shell is simply impossible. Restored after the run.
//
// SAFETY: never touches global `~/.cursor`. Merges (not clobbers) any existing
// workspace `.cursor/cli.json` — we only ADD the shell deny — and restores the
// exact original bytes on completion. A crash that skips restore leaves only an
// extra Shell(**) deny (conservative, never destructive). The caller falls back
// to read-only (`--mode plan`) if this config can't be applied.

export interface CursorCliConfig {
  permissions: { allow: string[]; deny: string[] }
  [key: string]: unknown
}

/** Native side effects denied in write mode. Edits stay allowed (diff-reviewed);
 *  shell is blocked outright. */
export const CURSOR_WRITE_MODE_DENY_RULES: readonly string[] = ['Shell(**)']

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/**
 * Merge `denyRules` into an existing `.cursor/cli.json` shape (or {}), preserving
 * any existing allow/deny entries + unknown top-level keys, deduping deny rules.
 * Pure.
 */
export function mergeCursorDenyRules(
  existing: unknown,
  denyRules: readonly string[]
): CursorCliConfig {
  const base = asRecord(existing)
  const perms = asRecord(base.permissions)
  const allow = stringArray(perms.allow)
  const deny = stringArray(perms.deny)
  for (const rule of denyRules) {
    if (!deny.includes(rule)) deny.push(rule)
  }
  return { ...base, permissions: { allow, deny } }
}

/** Minimal sync-fs surface (subset of node:fs) — injected for testability. */
export interface CursorConfigFs {
  existsSync(path: string): boolean
  readFileSync(path: string, encoding: 'utf8'): string
  writeFileSync(path: string, data: string): void
  mkdirSync(path: string, options: { recursive: boolean }): void
  rmSync(path: string, options: { force?: boolean; recursive?: boolean }): void
}

/**
 * Apply the write-mode deny-list to `configPath` (inside `dirPath` = workspace
 * `.cursor/`). Returns an idempotent `restore()` to call when the run ends:
 * rewrites the original bytes if a config existed, else removes the file (and
 * the `.cursor` dir if we created it). Never throws on restore (best-effort).
 */
export function applyCursorWriteModeConfig(
  fs: CursorConfigFs,
  configPath: string,
  dirPath: string
): () => void {
  const fileExisted = fs.existsSync(configPath)
  let original: string | null = null
  if (fileExisted) {
    try {
      original = fs.readFileSync(configPath, 'utf8')
    } catch {
      original = null
    }
  }
  const dirExisted = fs.existsSync(dirPath)
  let existing: unknown = null
  if (original) {
    try {
      existing = JSON.parse(original)
    } catch {
      existing = null
    }
  }
  const merged = mergeCursorDenyRules(existing, CURSOR_WRITE_MODE_DENY_RULES)
  if (!dirExisted) fs.mkdirSync(dirPath, { recursive: true })
  fs.writeFileSync(configPath, `${JSON.stringify(merged, null, 2)}\n`)

  let restored = false
  return () => {
    if (restored) return
    restored = true
    try {
      if (fileExisted && original != null) {
        fs.writeFileSync(configPath, original)
      } else {
        fs.rmSync(configPath, { force: true })
        if (!dirExisted) {
          try {
            fs.rmSync(dirPath, { force: true, recursive: true })
          } catch {
            // .cursor may hold other files; leave it.
          }
        }
      }
    } catch {
      // Best-effort restore; never throws.
    }
  }
}
