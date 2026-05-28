/**
 * 1.0.6-TV7 — per-WRITE-workspace run diff summaries.
 *
 * A multi-workspace run (a primary workspace + additional WRITE
 * workspaces attached through the composer picker) writes files in more
 * than one place, but the run's stored `runDiff` only captures the
 * PRIMARY workspace. This pure helper projects the run's tool-reported
 * file changes (the same `getLiveToolFileDiffSummaries` source that
 * powers the WRITE workspace rows + the "this run" summary view) into a
 * per-path map so each WRITE workspace is independently reviewable in
 * Diff Studio (TV8).
 *
 * Renderer-only + derived from `messages` — no filesystem snapshots, so
 * it adds no main-process surface and cannot affect the authoritative
 * primary-path snapshot diff. Best-effort: a path with no (non-noise)
 * changes is omitted entirely.
 */

import type { ChatMessage, DiffFileSummary, ExternalPathGrant } from '../../../main/store/types'
import { getLiveToolFileDiffSummaries } from './LiveFileDiffSummary'

/** Distinct, in-order WRITE-grant paths (dedupes repeated grants). */
export function selectWriteWorkspacePaths(grants: ExternalPathGrant[] | undefined): string[] {
  if (!Array.isArray(grants)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const grant of grants) {
    if (!grant || grant.access !== 'write') continue
    const path = typeof grant.path === 'string' ? grant.path : ''
    if (!path || seen.has(path)) continue
    seen.add(path)
    out.push(path)
  }
  return out
}

/**
 * Build the per-WRITE-path file-change summary map for a completed run.
 * Only paths with at least one non-noise change are included.
 */
export function buildRunDiffByPath(
  messages: ChatMessage[] | undefined,
  grants: ExternalPathGrant[] | undefined
): Record<string, DiffFileSummary[]> {
  const result: Record<string, DiffFileSummary[]> = {}
  const safeMessages = Array.isArray(messages) ? messages : []
  for (const path of selectWriteWorkspacePaths(grants)) {
    const summaries = getLiveToolFileDiffSummaries(safeMessages, path).filter(
      (entry) => !entry.isNoise
    )
    if (summaries.length > 0) result[path] = summaries
  }
  return result
}
