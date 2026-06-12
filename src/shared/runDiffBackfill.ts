/*
 * Run-diff line-count backfill from tool-activity evidence.
 *
 * In a non-git workspace the snapshot differ (DiffService.computeRunDiff)
 * cannot count lines for modified or deleted files — `git diff` has nothing
 * to say, and a deleted file's content is gone by the time the diff runs. So
 * the Run-summary File-changes card and the composer diff row showed +N for
 * created files but never a −M.
 *
 * The run's WRITE TOOL ACTIVITIES carry exactly that evidence: string
 * replaces know old/new line counts, patches parse per-file ±s. This module
 * sums per-file evidence from successful activities and fills ONLY the
 * counts the filesystem lane left undefined — git-derived numbers are never
 * touched. Shared by main (bridge-run finalize) and the renderer
 * (desktop-run post-compute).
 */

import type { RunDiffResult, ToolActivity, DiffFileSummary } from '../main/store/types'

export interface ToolLineEvidence {
  additions: number
  deletions: number
}

/** Sum per-file ± evidence from a run's SUCCESSFUL write activities.
 * Multi-file patches contribute via diffSummary.files; single-file edits
 * fall back to activity.filePath + totals. Keys are kept as reported
 * (absolute or workspace-relative) — `lookupEvidence` suffix-matches. */
export function toolEvidenceFromActivities(
  activities: Array<ToolActivity | undefined | null> | undefined
): Map<string, ToolLineEvidence> {
  const evidence = new Map<string, ToolLineEvidence>()
  const add = (path: string | undefined, additions?: number, deletions?: number): void => {
    if (!path) return
    const existing = evidence.get(path) ?? { additions: 0, deletions: 0 }
    existing.additions += Math.max(0, additions ?? 0)
    existing.deletions += Math.max(0, deletions ?? 0)
    evidence.set(path, existing)
  }
  for (const activity of activities ?? []) {
    if (!activity || activity.status !== 'success') continue
    const summary = activity.diffSummary
    if (!summary) continue
    const files = Array.isArray(summary.files)
      ? summary.files.filter((file) => Boolean(file?.path))
      : []
    if (files.length > 0) {
      for (const file of files) add(file.path, file.additions, file.deletions)
    } else if (activity.filePath) {
      add(activity.filePath, summary.additions, summary.deletions)
    }
  }
  return evidence
}

/** Find evidence for a (usually workspace-relative) diff path. Activity
 * paths are often absolute — match exact first, then by `/`-boundary
 * suffix in either direction. */
export function lookupEvidence(
  evidence: ReadonlyMap<string, ToolLineEvidence>,
  path: string
): ToolLineEvidence | undefined {
  const direct = evidence.get(path)
  if (direct) return direct
  for (const [key, value] of evidence) {
    if (key.endsWith(`/${path}`) || path.endsWith(`/${key}`)) return value
  }
  return undefined
}

function backfillSummaries(
  summaries: DiffFileSummary[],
  evidence: ReadonlyMap<string, ToolLineEvidence>
): { summaries: DiffFileSummary[]; changed: boolean } {
  let changed = false
  const next = summaries.map((summary) => {
    // Only fill what the filesystem lane could NOT determine — git-derived
    // counts (and synthetic created-file counts) stay authoritative.
    if (summary.additions !== undefined || summary.deletions !== undefined) return summary
    const found = lookupEvidence(evidence, summary.path)
    if (!found || (found.additions === 0 && found.deletions === 0)) return summary
    changed = true
    return { ...summary, additions: found.additions, deletions: found.deletions }
  })
  return { summaries: next, changed }
}

/** Fill missing modified/deleted line counts in a run diff from tool
 * evidence. Returns the same reference when nothing was filled. */
export function backfillRunDiffCounts(
  diff: RunDiffResult,
  evidence: ReadonlyMap<string, ToolLineEvidence>
): RunDiffResult {
  if (evidence.size === 0) return diff
  const modified = backfillSummaries(diff.modifiedFiles ?? [], evidence)
  const deleted = backfillSummaries(diff.deletedFiles ?? [], evidence)
  if (!modified.changed && !deleted.changed) return diff
  return {
    ...diff,
    modifiedFiles: modified.summaries,
    deletedFiles: deleted.summaries
  }
}
