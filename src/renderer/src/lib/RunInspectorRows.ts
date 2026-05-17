import type { RunEventRecord, RunEventKind } from '../../../main/store/types'

/**
 * RunInspectorRows — Phase K1 Slice 1B.
 *
 * Pure helper that turns a raw `RunEventRecord` into a render-ready
 * Inspector row. The Inspector renders one row per event, so the
 * discrimination needs to be granular enough to support distinct
 * visual treatments for approvals, tool calls, file edits, sub-thread
 * spawns/returns, replies, provider raw, and lifecycle events.
 *
 * Coordination note:
 *   - `RunEventClassifier.ts` is a *different* helper, owned by RunCard
 *     (Slice 1A / Codex), with a coarser 4-way classification suited
 *     to RunCard's aggregation needs. We intentionally do NOT share
 *     here, to keep parallel write-scope clean. Some helper logic
 *     (record-shape sniffing, path extraction) is duplicated; a
 *     reconciliation pass once both slices land is acceptable.
 *
 * Design constraints:
 *   - Never throws. Unknown / malformed events fall through to
 *     `{ kind: 'raw' }` so the Inspector always has something to render.
 *   - Sub-discrimination for approvals reads `payload.preview.kind`
 *     because the existing codebase tags "what the approval is FOR"
 *     (tool/permission/diff/edit/write/…) there, not at the top level.
 *   - File-path extraction is best-effort. Multiple provider variants
 *     stash paths in different keys; we try the common ones.
 */

export type InspectorRow =
  | {
      kind: 'approval_request'
      title: string
      /** Discriminator from `payload.preview.kind` (tool/permission/diff/edit/write/…). */
      approvalKind?: string
      toolName?: string
      paths?: string[]
      raw: RunEventRecord
    }
  | {
      kind: 'approval_response'
      decision: 'accept' | 'acceptForSession' | 'acceptForWorkspace' | 'decline' | 'cancel' | 'unknown'
      raw: RunEventRecord
    }
  | {
      kind: 'approval_timer'
      phase: 'armed' | 'timeout'
      raw: RunEventRecord
    }
  | {
      kind: 'tool_call'
      toolName?: string
      raw: RunEventRecord
    }
  | {
      kind: 'file_edit'
      paths: string[]
      operation?: 'edit' | 'write'
      raw: RunEventRecord
    }
  | {
      kind: 'diff'
      paths?: string[]
      raw: RunEventRecord
    }
  | {
      kind: 'subthread_spawn'
      subThreadId?: string
      provider?: string
      delegationPrompt?: string
      raw: RunEventRecord
    }
  | {
      kind: 'subthread_return'
      subThreadId?: string
      summaryText?: string
      raw: RunEventRecord
    }
  | {
      kind: 'subthread_dispatch_failed'
      reason?: string
      raw: RunEventRecord
    }
  | {
      kind: 'delegation'
      raw: RunEventRecord
    }
  | {
      kind: 'reply'
      length?: number
      raw: RunEventRecord
    }
  | {
      kind: 'lifecycle'
      raw: RunEventRecord
    }
  | {
      kind: 'provider_raw'
      raw: RunEventRecord
    }
  | {
      kind: 'provider_error'
      message?: string
      raw: RunEventRecord
    }
  | {
      kind: 'provider_exit'
      code?: number | null
      raw: RunEventRecord
    }
  | {
      kind: 'timeline'
      raw: RunEventRecord
    }
  | {
      kind: 'raw'
      raw: RunEventRecord
    }

export type InspectorRowKind = InspectorRow['kind']

// ──────────────────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === 'object' && !Array.isArray(v))
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function extractPathsFromPreview(payload: unknown): string[] | undefined {
  if (!isRecord(payload)) return undefined
  const preview = payload.preview
  if (!isRecord(preview)) return undefined
  const changes = preview.changes
  if (!Array.isArray(changes)) return undefined
  const out: string[] = []
  for (const entry of changes) {
    if (isRecord(entry) && typeof entry.path === 'string') {
      out.push(entry.path)
    }
  }
  return out.length > 0 ? out : undefined
}

function approvalPreviewKind(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  const preview = payload.preview
  if (!isRecord(preview)) return undefined
  return asString(preview.kind)
}

function approvalToolName(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  const preview = payload.preview
  if (!isRecord(preview)) return undefined
  return asString(preview.toolName)
}

type ApprovalDecision = Extract<InspectorRow, { kind: 'approval_response' }>['decision']

function approvalDecision(payload: unknown): ApprovalDecision {
  if (isRecord(payload) && typeof payload.decision === 'string') {
    const d = payload.decision
    if (
      d === 'accept' ||
      d === 'acceptForSession' ||
      d === 'acceptForWorkspace' ||
      d === 'decline' ||
      d === 'cancel'
    ) {
      return d
    }
  }
  return 'unknown'
}

function extractDiffPaths(event: RunEventRecord): string[] | undefined {
  const payload = event.payload
  if (!isRecord(payload)) return undefined
  if (typeof payload.path === 'string') return [payload.path]
  if (Array.isArray(payload.paths)) {
    const out: string[] = []
    for (const p of payload.paths) {
      if (typeof p === 'string') out.push(p)
    }
    return out.length > 0 ? out : undefined
  }
  return undefined
}

// ──────────────────────────────────────────────────────────────────────────────

/**
 * Classify a single `RunEventRecord` into an `InspectorRow`. Never
 * throws. Unknown kinds fall through to `{ kind: 'raw' }`.
 */
export function classifyForInspector(event: RunEventRecord): InspectorRow {
  const kind: RunEventKind = event.kind

  switch (kind) {
    case 'approval_request':
      return {
        kind: 'approval_request',
        title: event.summary ?? 'Approval requested',
        approvalKind: approvalPreviewKind(event.payload),
        toolName: approvalToolName(event.payload),
        paths: extractPathsFromPreview(event.payload),
        raw: event
      }

    case 'approval_response':
      return {
        kind: 'approval_response',
        decision: approvalDecision(event.payload),
        raw: event
      }

    case 'approval_timer_armed':
      return { kind: 'approval_timer', phase: 'armed', raw: event }

    case 'approval_timer_timeout':
      return { kind: 'approval_timer', phase: 'timeout', raw: event }

    case 'tool': {
      const toolName = isRecord(event.payload) ? asString(event.payload.toolName) : undefined
      return { kind: 'tool_call', toolName, raw: event }
    }

    case 'diff':
      return {
        kind: 'diff',
        paths: extractPathsFromPreview(event.payload) ?? extractDiffPaths(event),
        raw: event
      }

    case 'subthread_spawned': {
      const p = isRecord(event.payload) ? event.payload : {}
      return {
        kind: 'subthread_spawn',
        subThreadId: asString(p.subThreadId),
        provider: asString(p.provider),
        delegationPrompt: asString(p.delegationPrompt),
        raw: event
      }
    }

    case 'subthread_returned': {
      const p = isRecord(event.payload) ? event.payload : {}
      const summaryText = asString(p.summary) ?? asString(p.result) ?? event.summary
      return {
        kind: 'subthread_return',
        subThreadId: asString(p.subThreadId),
        summaryText,
        raw: event
      }
    }

    case 'subthread_dispatch_failed': {
      const p = isRecord(event.payload) ? event.payload : {}
      return {
        kind: 'subthread_dispatch_failed',
        reason: asString(p.reason) ?? asString(p.error) ?? event.summary,
        raw: event
      }
    }

    case 'delegation':
      return { kind: 'delegation', raw: event }

    case 'final_message': {
      const p = isRecord(event.payload) ? event.payload : {}
      const text = asString(p.text) ?? asString(p.message) ?? ''
      return {
        kind: 'reply',
        length: text ? text.length : undefined,
        raw: event
      }
    }

    case 'lifecycle':
      return { kind: 'lifecycle', raw: event }

    case 'timeline':
      return { kind: 'timeline', raw: event }

    case 'provider_raw':
      return { kind: 'provider_raw', raw: event }

    case 'provider_error': {
      const p = isRecord(event.payload) ? event.payload : {}
      const message = asString(p.error) ?? asString(p.message) ?? event.summary
      return { kind: 'provider_error', message, raw: event }
    }

    case 'provider_exit': {
      const p = isRecord(event.payload) ? event.payload : {}
      return {
        kind: 'provider_exit',
        code: asNumber(p.code) ?? null,
        raw: event
      }
    }

    default: {
      // Exhaustive guard: if RunEventKind grows a new variant the
      // compiler complains; until then fall through cleanly.
      const _exhaustive: never = kind
      void _exhaustive
      return { kind: 'raw', raw: event }
    }
  }
}

/** Classify an ordered list of events. Preserves order. */
export function classifyEventsForInspector(events: RunEventRecord[]): InspectorRow[] {
  return events.map(classifyForInspector)
}
