/*
 * Pure ± diff-stat derivation for the bridge run lane (phone-initiated and
 * background runs whose transcripts are built in MAIN, not the renderer).
 *
 * The renderer has its own richer derivation (ToolParser.deriveToolDiffSummary)
 * for desktop-initiated runs; this module mirrors its semantics for the
 * provider/MCP shapes the bridge lane actually sees, so Edit-file rows on
 * remote clients carry the same +N/−M chips as the desktop transcript:
 *   - string replaces (TaskWraith MCP `replace`, Claude `Edit`): old/new line counts
 *   - whole-file writes (`write_file`, `create_file`): content line count
 *   - patches (`apply_patch`, codex patchPreview): ± line counting
 *   - codex `changes` arrays with explicit per-entry counts
 *   - create-kind edits whose only evidence is the new file's CONTENT
 *     (codex `fileChange` add items preview content, not a unified diff)
 */

import type { ToolDiffSummary } from '../store/types'

/** Lenient non-negative integer reader for provider change entries. */
export function bridgeNumberish(value: unknown): number | undefined {
  const numeric =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : undefined
}

/** Count ±lines in text that is structurally a unified diff (hunk header,
 * `diff --git`, or a `+++`/`---` pair). The structure gate keeps prose with
 * leading +/- (markdown bullets in reasoning traces) from minting phantom
 * stats — same rule as the renderer's parseUnifiedDiffSummary. */
export function bridgeUnifiedDiffStats(
  text: string
): { additions: number; deletions: number } | undefined {
  if (!text.trim()) return undefined
  const hasDiffStructure =
    /^@@ .*@@/m.test(text) ||
    /^diff --git /m.test(text) ||
    (/^\+\+\+ /m.test(text) && /^--- /m.test(text))
  if (!hasDiffStructure) return undefined
  let additions = 0
  let deletions = 0
  for (const line of text.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++
  }
  if (additions === 0 && deletions === 0) return undefined
  return { additions, deletions }
}

function changesFlatStats(changes: unknown): ToolDiffSummary | undefined {
  if (!Array.isArray(changes) || changes.length === 0) return undefined
  let additions = 0
  let deletions = 0
  let hasStats = false
  for (const item of changes) {
    const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const add = bridgeNumberish(
      entry.additions ?? entry.added ?? entry.linesAdded ?? entry.insertions
    )
    const del = bridgeNumberish(
      entry.deletions ?? entry.deleted ?? entry.linesDeleted ?? entry.removals
    )
    if (add !== undefined || del !== undefined) hasStats = true
    additions += add ?? 0
    deletions += del ?? 0
  }
  if (hasStats && (additions > 0 || deletions > 0)) {
    return { additions, deletions, source: 'codex_changes', confidence: 'exact' }
  }
  return undefined
}

function lineCount(text: string): number {
  return text.length ? text.split('\n').length : 0
}

/** A change `kind` that means "this file is being created" — the preview is
 * the new file's CONTENT, so line-counting it as additions is honest. */
function isCreateKind(kind: unknown): boolean {
  const value = String(kind ?? '').toLowerCase()
  return value === 'add' || value === 'create' || value === 'created' || value === 'new'
}

/** Per-edit diff stats derivable from the tool INPUT — what the desktop
 * shows for write tools instead of truncated result text. */
export function bridgeToolDiffStats(
  toolName: string,
  input: Record<string, unknown>
): ToolDiffSummary | undefined {
  const oldString = typeof input.old_string === 'string' ? input.old_string : undefined
  const newString = typeof input.new_string === 'string' ? input.new_string : undefined
  if (oldString !== undefined && newString !== undefined) {
    return {
      additions: lineCount(newString),
      deletions: lineCount(oldString),
      source: 'string_replace',
      confidence: 'exact'
    }
  }
  // Codex app-server fileChange items carry a `changes` array; when entries
  // expose explicit line counts, trust them (renderer parseChanges parity).
  const flat = changesFlatStats(input.changes)
  if (flat) return flat
  // `patchPreview` is what emitCodexPatchUpdate stamps on edit_file tool
  // uses — without it Codex edits showed no ±odometer on remote clients.
  const patch =
    (typeof input.patch === 'string' && input.patch) ||
    (typeof input.diff === 'string' && input.diff) ||
    (typeof input.patchPreview === 'string' && input.patchPreview) ||
    (typeof input.patch_preview === 'string' && input.patch_preview) ||
    (typeof input.unifiedDiff === 'string' && input.unifiedDiff) ||
    (typeof input.unified_diff === 'string' && input.unified_diff) ||
    undefined
  if (patch) {
    let additions = 0
    let deletions = 0
    for (const line of patch.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++
    }
    // A ±0/0 "patch" is not a patch — it's file content riding a patch
    // field (codex add/create previews). Fall through so the content
    // branches below can count it instead of minting a 0/0 'exact' that
    // blocks later evidence.
    if (additions > 0 || deletions > 0) {
      return { additions, deletions, source: 'patch_preview', confidence: 'exact' }
    }
    if (isCreateKind(input.kind)) {
      return {
        additions: lineCount(patch),
        deletions: 0,
        source: 'content',
        confidence: 'estimated'
      }
    }
  }
  if (/write|create/i.test(toolName)) {
    const content =
      (typeof input.content === 'string' && input.content) ||
      (typeof input.file_text === 'string' && input.file_text) ||
      undefined
    if (content !== undefined) {
      return {
        additions: lineCount(content),
        deletions: 0,
        source: 'content',
        confidence: 'estimated'
      }
    }
  }
  return undefined
}

/** Diff stats from a tool RESULT event: explicit change counts forwarded by
 * the emitter beat structural ±counting of the result text, which beats the
 * create-kind content fallback (a created file's "result" is its content —
 * count its lines, estimated). Reasoning/plan pseudo-tools never derive. */
export function bridgeResultDiffStats(args: {
  toolName: string
  summary: string
  changes?: unknown
  kind?: unknown
}): ToolDiffSummary | undefined {
  if (/reasoning|thinking|plan/i.test(args.toolName)) return undefined
  const flat = changesFlatStats(args.changes)
  if (flat) return flat
  const structural = bridgeUnifiedDiffStats(args.summary)
  if (structural) {
    return { ...structural, source: 'result_diff', confidence: 'estimated' }
  }
  if (isCreateKind(args.kind) && args.summary.trim()) {
    return {
      additions: lineCount(args.summary),
      deletions: 0,
      source: 'content',
      confidence: 'estimated'
    }
  }
  return undefined
}
