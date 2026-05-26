import type { AgentRunPayload, AgentRunRoute } from '../index'
import { resolveEffectiveRunPermissions } from '../EffectiveRunPermissions'
import {
  buildEnsembleParticipantPrompt,
  getOrderedEnsembleParticipants,
  providerLabel
} from '../EnsemblePrompt'
import type {
  AppSettings,
  ChatMessage,
  ChatRecord,
  ChatRun,
  EffectiveRunPermissions,
  EnsembleConfig,
  EnsembleOrchestrationMode,
  EnsembleParticipant,
  EnsembleParticipantStatus,
  EnsembleRunIdentity,
  EnsembleRoundState,
  ProviderId,
  ToolActivity,
  ToolActivityStatus
} from '../store/types'
import {
  findFirstMention,
  resolvePhraseToParticipant
} from './EnsembleMentionAlias'
import {
  classifyDispatchError,
  formatAllUnreachableNote,
  formatDispatchFailureNote,
  formatYieldTargetUnreachableNote,
  type DispatchFailureReason
} from '../EnsembleErrors'

export type EnsembleRunMode = 'normal' | 'queue' | 'steer'

const DEFAULT_CONTINUATION_HOP_LIMIT = 6
const MAX_CONTINUATION_HOP_LIMIT = 12

export interface EnsembleDispatchEvent {
  sender: Electron.WebContents
}

export interface EnsembleOrchestratorDeps {
  getChat: (chatId: string) => ChatRecord | null
  saveChat: (chat: ChatRecord) => void
  getSettings: () => AppSettings
  dispatch: (
    payload: AgentRunPayload,
    event: EnsembleDispatchEvent
  ) => Promise<{ dispatched: boolean; appRunId: string }>
  cancelRun: (provider: ProviderId, runId?: string) => Promise<unknown>
  createRunId: (provider: ProviderId) => string
  now: () => number
  nowIso: () => string
}

/**
 * Per-run chronological event log. Each entry preserves the order
 * the orchestrator observed content / tool events, so the flush
 * pass can materialise the participant's turn as a sequence of
 * interleaved messages (the natural "speak, do, speak, do" flow
 * most agents follow). Pre-1.0.3-post-ship the orchestrator
 * batched all content into one assistant message + all tool calls
 * into one tool message, which read as "wall of text, then wall
 * of operations" — not the inline experience Chris wanted.
 *
 *   - `{ kind: 'content', text }` — accumulated content for this
 *     chunk. Consecutive content events without an intervening tool
 *     concatenate into the SAME entry. New content after a tool
 *     event opens a fresh entry.
 *   - `{ kind: 'tool', toolId }` — references the tool activity by
 *     id (stored in `run.toolActivities`). Tool results pair back
 *     into the activity but don't add a new timeline entry — the
 *     existing tool entry's activity gets updated in place.
 */
type ParticipantTimelineEntry =
  | { kind: 'content'; text: string }
  | { kind: 'tool'; toolId: string }

interface ActiveParticipantRun {
  chatId: string
  roundId: string
  runId: string
  participant: EnsembleParticipant
  promptMessageId: string
  /**
   * Legacy single-slot id, kept so existing code that references
   * `run.assistantMessageId` still compiles. The timeline-based
   * flush below now generates per-entry ids via `timelineMessageId`,
   * but the legacy id is still set on `seedParticipantRun` for any
   * back-compat consumers (none remain in this file).
   */
  assistantMessageId: string
  /**
   * Per-run tool-activity accumulator. The renderer-side activity
   * objects (toolName, status, params, etc.) live here; the
   * timeline references them by id.
   */
  toolActivities?: ToolActivity[]
  /**
   * Ordered list of message-materialisation entries. Content + tool
   * entries are interleaved as the orchestrator observes them, so
   * `flushRun` can emit a sequence of messages that mirrors the
   * actual turn chronology.
   */
  timeline?: ParticipantTimelineEntry[]
  startedAt: string
  /**
   * Aggregate text for back-compat consumers (per-run token stats,
   * "did this run produce any output" checks, etc.). Stays in sync
   * with the concatenation of every content timeline entry.
   */
  content: string
  status: EnsembleParticipantStatus
  lastContentItemId?: string
  actualModel?: string
  providerSessionId?: string
  stats?: any
  completion?: (status: EnsembleParticipantStatus) => void
  flushTimer?: ReturnType<typeof setTimeout>
}

/** Stable per-timeline-entry message id. Includes the runId + the
 * entry's ordinal so the same entry always resolves to the same id
 * across flush passes, letting `flushRun` replace-in-place rather
 * than emit duplicates. */
function timelineMessageId(runId: string, index: number, kind: 'content' | 'tool'): string {
  return `ensemble-${kind}-${runId}-${index}`
}

/** Push a content fragment into the run's timeline, merging into
 * the last entry if it's also content. This is how the "speak,
 * tool, speak, tool" interleaving emerges — tools break the chunk;
 * consecutive content stays in one entry. */
function appendTimelineContent(run: ActiveParticipantRun, text: string): void {
  if (!run.timeline) run.timeline = []
  const last = run.timeline[run.timeline.length - 1]
  if (last && last.kind === 'content') {
    last.text += text
    return
  }
  run.timeline.push({ kind: 'content', text })
}

/** Push a tool entry into the timeline. The toolActivities array
 * has been updated by the caller; this just records the position
 * where the activity falls in the chronology so the flush can
 * materialise the matching `role: 'tool'` message inline. */
function appendTimelineTool(run: ActiveParticipantRun, toolId: string): void {
  if (!run.timeline) run.timeline = []
  run.timeline.push({ kind: 'tool', toolId })
}

/**
 * Minimal tool-activity builders for the orchestrator. The renderer's
 * `ToolParser.ts` has richer extraction (file-path heuristics, diff
 * summaries, display-name humanising) but lives under `src/renderer/`
 * which `tsconfig.node.json` doesn't include. For ensemble tool
 * messages the basics are enough — the renderer's display layer can
 * still humanise on read by inspecting `rawUseEvent` / `rawResultEvent`.
 */
function extractToolId(event: any): string {
  if (!event || typeof event !== 'object') {
    return `ensemble-tool-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
  return (
    event.tool_id ||
    event.toolId ||
    event.id ||
    event.call_id ||
    event.tool_call_id ||
    `ensemble-tool-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
}

function extractToolName(event: any): string {
  if (!event || typeof event !== 'object') return 'unknown'
  return (
    event.tool_name ||
    event.toolName ||
    event.name ||
    event.function?.name ||
    event.tool ||
    'unknown'
  )
}

function extractToolParameters(event: any): Record<string, unknown> {
  if (!event || typeof event !== 'object') return {}
  const raw =
    event.parameters ||
    event.params ||
    event.arguments ||
    event.input ||
    event.function?.arguments ||
    {}
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
}

function stripToolNamespace(toolName: string): string {
  const name = (toolName || '').toLowerCase().trim()
  if (!name) return 'unknown'
  if (name.startsWith('mcp__')) {
    const idx = name.indexOf('__', 5)
    return idx > 5 ? name.slice(idx + 2) : name
  }
  if (name.startsWith('mcp_') && !name.startsWith('mcp__')) {
    const knownServerPrefixes = ['mcp_agbench_', 'mcp_agentbench_']
    for (const prefix of knownServerPrefixes) {
      if (name.startsWith(prefix)) return name.slice(prefix.length)
    }
  }
  if (name.startsWith('agbench__')) return name.slice('agbench__'.length)
  if (name.startsWith('agentbench__')) return name.slice('agentbench__'.length)
  if (name.startsWith('agbench_')) return name.slice('agbench_'.length)
  if (name.startsWith('agentbench_')) return name.slice('agentbench_'.length)
  return name
}

function getStringParameter(parameters: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = parameters[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function titleCaseToolName(toolName: string): string {
  return toolName
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function participantLabel(participant?: EnsembleParticipant): string {
  if (!participant) return 'Participant'
  return participant.role || participant.provider
}

function getEnsembleToolCategory(toolName: string): ToolActivity['category'] {
  const name = stripToolNamespace(toolName)
  if (
    name === 'ensemble_yield' ||
    name === 'update_topic' ||
    name === 'summary' ||
    name === 'intent' ||
    name === 'progress' ||
    name === 'tool_progress'
  ) {
    return 'task'
  }
  if (name === 'read_file' || name === 'list_directory') return 'read'
  if (FILE_WRITE_TOOL_NAMES.has(name)) return 'write'
  if (name === 'grep_search' || name === 'grep' || name === 'rg' || name === 'web_search')
    return 'search'
  if (name === 'run_shell_command' || name === 'shell') return 'shell'
  return 'unknown'
}

function getEnsembleToolDisplayName(
  toolName: string,
  parameters: Record<string, unknown>,
  participant?: EnsembleParticipant
): string {
  const name = stripToolNamespace(toolName)
  if (name === 'ensemble_yield') {
    const target = getStringParameter(parameters, ['target', 'participant', 'to', 'next'])
    const actor = participantLabel(participant)
    return target ? `${actor} yielding to ${target}` : `${actor} yielding`
  }
  if (name === 'update_topic') {
    const topic = getStringParameter(parameters, ['title', 'topic', 'name'])
    return topic ? `Topic update: ${topic}` : 'Topic update'
  }
  if (name === 'read_file') {
    const path = getStringParameter(parameters, ['file_path', 'path'])
    return path ? `Read ${path}` : 'Read file'
  }
  if (name === 'list_directory') {
    const path = getStringParameter(parameters, ['file_path', 'path'])
    return path ? `Listed ${path}` : 'Listed directory'
  }
  if (FILE_WRITE_TOOL_NAMES.has(name)) {
    const path = getStringParameter(parameters, ['file_path', 'path'])
    return path ? `Edited ${path}` : 'Edited file'
  }
  if (name === 'run_shell_command' || name === 'shell') return 'Shell command'
  return titleCaseToolName(name) || toolName || 'Used tool'
}

/** File-write tool names that should populate a `diffSummary` so the
 * renderer's `latestRunDiffStats` useMemo counts the file. Mirrors
 * the canonical names recognised by the renderer's solo-path
 * `ToolParser.deriveToolDiffSummary`. */
const FILE_WRITE_TOOL_NAMES = new Set([
  'edit_file',
  'write_file',
  'create_file',
  'apply_patch',
  'patch_file',
  'str_replace',
  'str_replace_editor',
  'multiedit',
  'fs_write',
  'fs_edit',
  'fs_patch',
  'create_directory'
])

function buildEnsembleToolActivity(
  event: any,
  startedAt: string,
  participant?: EnsembleParticipant
): ToolActivity {
  const toolName = extractToolName(event)
  const canonicalToolName = stripToolNamespace(toolName)
  const parameters = extractToolParameters(event)
  const filePath =
    typeof parameters.file_path === 'string'
      ? (parameters.file_path as string)
      : typeof parameters.path === 'string'
        ? (parameters.path as string)
        : undefined
  // Seed a minimal `diffSummary` for known file-write tool names so
  // the renderer's files-changed counter picks them up. The orchestrator
  // doesn't try to compute actual additions/deletions (that lives in
  // the renderer's richer `ToolParser`) — but emitting a `files: [...]`
  // entry is enough for the counter (which only counts unique paths).
  // Without this, even when tool messages persist correctly, the
  // counter would still read zero for ensemble runs.
  const diffSummary =
    filePath && FILE_WRITE_TOOL_NAMES.has(canonicalToolName)
      ? {
          files: [
            {
              path: filePath,
              status: 'modified' as const,
              additions: 0,
              deletions: 0
            }
          ],
          additions: 0,
          deletions: 0,
          source: 'unknown' as const,
          confidence: 'estimated' as const
        }
      : undefined
  return {
    id: extractToolId(event),
    toolName,
    displayName: getEnsembleToolDisplayName(toolName, parameters, participant),
    category: getEnsembleToolCategory(toolName),
    status: 'running',
    startedAt,
    parameters,
    filePath,
    ...(diffSummary ? { diffSummary } : {}),
    rawUseEvent: event
  }
}

function pairEnsembleToolResult(
  activity: ToolActivity,
  event: any,
  endedAt: string
): ToolActivity {
  const status: ToolActivityStatus =
    event?.success === false || event?.error || event?.is_error ? 'error' : 'success'
  const durationMs = activity.startedAt
    ? new Date(endedAt).getTime() - new Date(activity.startedAt).getTime()
    : undefined
  const output =
    typeof event?.content === 'string'
      ? event.content
      : typeof event?.output === 'string'
        ? event.output
        : typeof event?.result === 'string'
          ? event.result
          : ''
  const truncated = output.length > 500 ? `${output.substring(0, 500)}...` : output
  const displayName =
    status === 'success' && stripToolNamespace(activity.toolName) === 'ensemble_yield'
      ? activity.displayName.replace(/\byielding\b/i, 'yielded')
      : activity.displayName
  return {
    ...activity,
    status,
    displayName,
    endedAt,
    durationMs,
    resultSummary: truncated,
    outputPreview: truncated,
    rawResultEvent: event
  }
}

interface ActiveRoundRuntime {
  chatId: string
  roundId: string
  sender: Electron.WebContents
  prompt: string
  cancelled: boolean
  /**
   * FIFO queue of prompts to dispatch as fresh rounds after the
   * current round finishes. The user can stack multiple sends
   * during a running round; each lands here in order. Earlier
   * iterations used a single `queuedPrompt: string` which silently
   * overwrote when the user queued a second message — Chris hit
   * that limit during the 1.0.3 smoke and confirmed the
   * accidental-steer caused a parallel Codex run that broke MCP
   * routing. Accumulating instead of overwriting fixes both.
   */
  queuedPrompts: string[]
  activeRunId?: string
  orchestrationMode: EnsembleOrchestrationMode
  continuationHops: number
  maxContinuationHops: number
  continuationLimitNotified?: boolean
  /**
   * Slice C extension (1.0.3) — when a participant calls
   * `ensemble_yield` with an explicit `target` argument, the
   * orchestrator stashes the raw target string here. `runRound`'s
   * loop consults it after each turn to reorder the remaining
   * participants so the named target speaks next. Cleared after
   * resolution (or ignored if the string doesn't resolve to a
   * remaining participant).
   */
  yieldTarget?: string
}

export class EnsembleOrchestrator {
  private roundsByChatId = new Map<string, ActiveRoundRuntime>()
  private runsByRunId = new Map<string, ActiveParticipantRun>()

  constructor(private deps: EnsembleOrchestratorDeps) {}

  startRound(input: {
    chatId: string
    prompt: string
    event: EnsembleDispatchEvent
    mode?: EnsembleRunMode
    /**
     * A2 (1.0.3) — when set, scope the round to just this participant
     * (the "DM" routing the chip strip + composer pickers feed when
     * the user holds Cmd while sending). The round still flows through
     * the orchestrator's machinery (so per-participant status pills +
     * activeRound state + the per-participant token tally all keep
     * working), it just iterates a one-element participant list
     * instead of the full enabled set.
     */
    dmTargetParticipantId?: string
  }): { status: 'started' | 'queued' | 'steered' | 'ignored'; roundId?: string } {
    const prompt = input.prompt.trim()
    if (!prompt) return { status: 'ignored' }
    const existing = this.roundsByChatId.get(input.chatId)
    if (existing && !existing.cancelled) {
      if (input.mode === 'steer') {
        void this.cancelRound(input.chatId, 'steered')
        const roundId = this.beginRound(
          input.chatId,
          prompt,
          input.event.sender,
          input.dmTargetParticipantId
        )
        this.appendRoundStatus(
          input.chatId,
          roundId,
          'Ensemble steered: interrupted the active speaker and started a fresh round.'
        )
        return { status: 'steered', roundId }
      }
      // Multi-entry queue: append rather than overwrite. The
      // chat-round state mirrors the runtime's `queuedPrompts` so the
      // renderer's stack picks up every entry.
      existing.queuedPrompts.push(prompt)
      const nextQueuedPrompts = [...existing.queuedPrompts]
      this.updateChatRound(input.chatId, (round) =>
        round
          ? {
              ...round,
              // Keep legacy `queuedPrompt` in sync with the head of
              // the array so back-compat readers still see the next
              // one. New readers should iterate `queuedPrompts`.
              queuedPrompt: nextQueuedPrompts[0],
              queuedPrompts: nextQueuedPrompts
            }
          : round
      )
      return { status: 'queued', roundId: existing.roundId }
    }
    const roundId = this.beginRound(
      input.chatId,
      prompt,
      input.event.sender,
      input.dmTargetParticipantId
    )
    return { status: 'started', roundId }
  }

  async cancelRound(chatId: string, reason = 'cancelled'): Promise<boolean> {
    const runtime = this.roundsByChatId.get(chatId)
    if (!runtime) return false
    runtime.cancelled = true
    runtime.queuedPrompts = []
    const roundId = runtime.roundId
    const active = runtime.activeRunId ? this.runsByRunId.get(runtime.activeRunId) : undefined
    if (active) {
      this.finalizeRun(active, 'cancelled', reason)
    }
    this.updateParticipantState(chatId, roundId, active?.participant.id, 'cancelled', reason)
    this.updateChatRound(chatId, (round) =>
      round?.roundId === roundId
        ? {
            ...round,
            status: 'cancelled',
            queuedPrompt: undefined,
            queuedPrompts: [],
            activeParticipantId: undefined,
            endedAt: this.deps.nowIso()
          }
        : round
    )
    this.clearRuntimeIfCurrent(runtime)
    if (active) {
      await this.deps.cancelRun(active.participant.provider, active.runId).catch(() => undefined)
    }
    return true
  }

  /**
   * User-driven mid-round skip (1.0.3 post-ship).
   *
   * Cancels the active participant's provider run and finalises them
   * as `'skipped'`. The orchestrator's `runRound` while-loop sees the
   * completion promise resolve and naturally advances to the next
   * participant — so the round continues without restart, unlike the
   * existing Steer pattern (which cancels + re-dispatches the same
   * participant). Returns `true` if a skip was applied, `false` if
   * there's no active run for this chat (e.g. the user clicked Skip
   * after the round already moved on).
   *
   * Distinct from `markYielded` (participant-driven, "I voluntarily
   * pass") and from `cancelRound` (user-driven, "stop the entire
   * ensemble"). The composer's existing Stop button still handles
   * full-round cancellation via `cancelRound`.
   */
  async skipActiveParticipant(chatId: string): Promise<boolean> {
    const runtime = this.roundsByChatId.get(chatId)
    if (!runtime) return false
    const activeRunId = runtime.activeRunId
    if (!activeRunId) return false
    const active = this.runsByRunId.get(activeRunId)
    if (!active) return false
    // Stop the provider stream first so we don't accumulate any more
    // content after the skip lands. The cancel call is best-effort —
    // some providers may have already finished mid-network.
    await this.deps
      .cancelRun(active.participant.provider, active.runId)
      .catch(() => undefined)
    this.finalizeRun(active, 'skipped', 'Skipped by user.')
    return true
  }

  markYielded(runId: string, reason?: string, target?: string): boolean {
    const run = this.runsByRunId.get(runId)
    if (!run) return false
    run.status = 'yielded'
    // Slice C extension (1.0.3) — if the participant named a target,
    // remember it on the round runtime so `runRound` can reorder
    // remaining participants before the next turn. We always set
    // runtime.yieldTarget on the round that owns this run, regardless
    // of how the orchestrator's loop resolves it (resolution + clear
    // happens in runRound after the current turn finalises).
    if (target) {
      const runtime = this.roundsByChatId.get(run.chatId)
      if (runtime) runtime.yieldTarget = target
    }
    this.finalizeRun(run, 'yielded', reason || 'Participant yielded.')
    return true
  }

  markRunExited(runId: string | undefined, exitCode: number): boolean {
    if (!runId) return false
    const run = this.runsByRunId.get(runId)
    if (!run || run.status === 'answered' || run.status === 'yielded') return false
    const status: EnsembleParticipantStatus = exitCode === 0 ? 'skipped' : 'failed'
    this.finalizeRun(run, status, exitCode === 0 ? 'Exited without result.' : `Exited with code ${exitCode}.`)
    return true
  }

  handleProviderOutput(provider: ProviderId, routed: AgentRunRoute, payload: any): boolean {
    const runId = routed.appRunId
    if (!runId) return false
    const run = this.runsByRunId.get(runId)
    if (!run || run.participant.provider !== provider) return false
    if (routed.appChatId && routed.appChatId !== run.chatId) return false

    const sessionId = extractProviderSessionId(payload)
    if (sessionId) run.providerSessionId = sessionId
    if (payload?.type === 'init' && typeof payload.model === 'string') {
      run.actualModel = payload.model
      this.flushRun(run)
      return true
    }
    if (payload?.type === 'content' && typeof payload.text === 'string') {
      const itemId =
        typeof payload.itemId === 'string' && payload.itemId ? payload.itemId : undefined
      const text = payload.text
      if (text) {
        const itemTransition =
          itemId !== undefined &&
          run.lastContentItemId !== undefined &&
          itemId !== run.lastContentItemId &&
          run.content.length > 0
        const chunk = `${itemTransition ? '\n\n---\n\n' : ''}${text}`
        run.content += chunk
        appendTimelineContent(run, chunk)
        if (itemId) run.lastContentItemId = itemId
        this.scheduleFlush(run)
      } else if (itemId) {
        run.lastContentItemId = itemId
      }
      return true
    }
    // Gemini CLI fallback path emits `{ type: 'message', role: 'assistant',
    // delta: true, content }` events instead of `{ type: 'content', text }`.
    // Without this branch the orchestrator never accumulates anything for
    // Gemini participants in ensemble mode — `run.content` stays empty,
    // `flushRun()` skips the assistant-message append (`if
    // (run.content.trim())`), and the authoritative chat save clobbers
    // whatever the renderer had locally appended from the same delta
    // stream. Symptom: Gemini's turn appears as "still working…" forever,
    // raw logs full of deltas, transcript empty. Codex / Claude / Kimi
    // are unaffected — they all emit `type: 'content'`.
    //
    // A final non-delta `{ type: 'message', role: 'assistant', content }`
    // is treated the same way (append). The trailing `type: 'result'`
    // event still drives finalisation via the branch below.
    if (
      payload?.type === 'message' &&
      payload?.role === 'assistant' &&
      typeof payload.content === 'string'
    ) {
      const text = payload.content
      if (text) {
        run.content += text
        appendTimelineContent(run, text)
        this.scheduleFlush(run)
      }
      return true
    }
    if (payload?.type === 'tool_use' || payload?.type === 'tool_call') {
      // Tool calls in ensemble mode previously vanished — the renderer-
      // side tool accumulator (App.tsx:10292+) only runs for solo runs
      // (the active-run-context registry is populated by `executeRun`
      // which ensemble doesn't go through). Without an orchestrator-
      // side persist, tool messages never landed in the authoritative
      // chat.messages, so the transcript stayed silent even when
      // participants used tools. Build the activity, push it into
      // the run's timeline at the current position so flushRun can
      // emit it inline between content chunks.
      if (!run.toolActivities) run.toolActivities = []
      const activity = buildEnsembleToolActivity(payload, this.deps.nowIso(), run.participant)
      run.toolActivities.push(activity)
      appendTimelineTool(run, activity.id)
      // Diagnostic for the 1.0.3 ship-night investigation — single
      // line per event, low volume, safe to leave in.
      // eslint-disable-next-line no-console
      console.log(
        `[ensemble:tool_use] provider=${provider} run=${run.runId} tool=${activity.toolName} id=${activity.id}`
      )
      this.scheduleFlush(run)
      return true
    }
    if (
      payload?.type === 'tool_result' ||
      payload?.type === 'tool_output' ||
      payload?.type === 'tool_response'
    ) {
      if (!run.toolActivities || run.toolActivities.length === 0) return true
      const id = extractToolId(payload)
      const idx = run.toolActivities.findIndex((a) => a.id === id)
      if (idx >= 0) {
        run.toolActivities[idx] = pairEnsembleToolResult(
          run.toolActivities[idx],
          payload,
          this.deps.nowIso()
        )
      } else {
        // Orphan result — pair with a synthetic activity so the
        // outcome still surfaces. Same pattern as the renderer's
        // fallback at App.tsx:10336.
        const orphan = buildEnsembleToolActivity(
          { ...payload, type: 'tool_use', tool_id: id },
          this.deps.nowIso(),
          run.participant
        )
        run.toolActivities.push(
          pairEnsembleToolResult(orphan, payload, this.deps.nowIso())
        )
      }
      this.scheduleFlush(run)
      return true
    }
    if (payload?.type === 'result') {
      run.stats = payload.stats
      const failed = payload.status === 'failed' || payload.subtype === 'error'
      this.finalizeRun(run, failed ? 'failed' : run.content.trim() ? 'answered' : 'skipped')
      return true
    }
    return true
  }

  private beginRound(
    chatId: string,
    prompt: string,
    sender: Electron.WebContents,
    dmTargetParticipantId?: string,
    /**
     * Carry-over queue from a previous round's `queuedPrompts` (FIFO
     * after we shifted off `prompt`). Lets the chain continue
     * through every queued message until the queue drains.
     */
    carryOverQueue: string[] = []
  ): string {
    const chat = this.deps.getChat(chatId)
    if (!chat?.ensemble) throw new Error('Ensemble chat not found.')
    const roundId = `ensemble-${this.deps.now()}-${Math.random().toString(36).slice(2)}`
    const orderedFull = getOrderedEnsembleParticipants(chat.ensemble, prompt)
    // A2 (1.0.3) — when DM, filter to just the targeted participant.
    // We still allow disabled participants when explicitly targeted —
    // the user clicked their chip and held Cmd, that's an unambiguous
    // intent. The filter falls back to the full ordered set if the
    // id doesn't match (safety net; should never hit in practice).
    const ordered = dmTargetParticipantId
      ? (() => {
          const target = chat.ensemble.participants.find(
            (p) => p.id === dmTargetParticipantId
          )
          return target ? [target] : orderedFull
        })()
      : orderedFull
    const startedAt = this.deps.nowIso()
    const orchestrationMode = resolveEnsembleOrchestrationMode(chat.ensemble)
    const maxContinuationHops = resolveMaxContinuationHops(chat.ensemble)
    const round: EnsembleRoundState = {
      roundId,
      status: 'running',
      prompt,
      startedAt,
      orchestrationMode,
      continuationHops: 0,
      maxContinuationHops,
      participants: ordered.map((participant) => ({
        participantId: participant.id,
        provider: participant.provider,
        role: participant.role,
        order: participant.order,
        status: 'idle'
      })),
      // Surface any carry-over queue on the chat record so the
      // renderer's queued-messages above-row reflects everything
      // still pending. Mirrors `runtime.queuedPrompts` below.
      ...(carryOverQueue.length > 0
        ? { queuedPrompt: carryOverQueue[0], queuedPrompts: [...carryOverQueue] }
        : {})
    }
    const userMessage: ChatMessage = {
      id: `ensemble-user-${roundId}`,
      role: 'user',
      content: prompt,
      timestamp: startedAt,
      metadata: {
        kind: 'ensembleRoundPrompt',
        ensembleRoundId: roundId
      }
    }
    const updated: ChatRecord = {
      ...chat,
      title:
        chat.messages.length === 0 && chat.title === 'New Ensemble'
          ? prompt.length > 30
            ? `${prompt.slice(0, 30)}...`
            : prompt
          : chat.title,
      messages: [...chat.messages, userMessage],
      ensemble: {
        ...chat.ensemble,
        activeRound: round,
        updatedAt: startedAt
      },
      updatedAt: this.deps.now()
    }
    this.deps.saveChat(updated)
    const runtime: ActiveRoundRuntime = {
      chatId,
      roundId,
      sender,
      prompt,
      cancelled: false,
      queuedPrompts: [...carryOverQueue],
      orchestrationMode,
      continuationHops: 0,
      maxContinuationHops
    }
    this.roundsByChatId.set(chatId, runtime)
    void this.runRound(runtime, ordered)
    return roundId
  }

  private async runRound(
    runtime: ActiveRoundRuntime,
    participants: EnsembleParticipant[]
  ): Promise<void> {
    // Slice C extension (1.0.3) — convert the fixed for-loop into a
    // mutable remaining-queue so `ensemble_yield(target:...)` can
    // reorder upcoming turns after each completion. The original
    // for-loop iterated `participants` directly; reordering required
    // a queue + while-loop pattern.
    const remaining: EnsembleParticipant[] = [...participants]
    // 1.0.4 — participant id of the just-promoted yield target. Set
    // at the end of the previous iteration when ensemble_yield's
    // target landed at remaining[0]; consumed at the top of the next
    // iteration so the dispatch-failure branch can surface a yield-
    // specific transcript note ("Yield target X unreachable. Routing
    // to next-in-rotation Y.") instead of the generic skip note.
    let yieldedTargetParticipantId: string | null = null
    // 1.0.4 — round-end all-unreachable fallback. Counts every
    // dispatch attempt and how many of those attempts failed with
    // `kind: 'unreachable'`. If the round exhausts `remaining` with
    // every attempt unreachable, we emit a final "no reachable
    // participants left" note so the user knows to re-launch.
    let dispatchAttempts = 0
    let unreachableFailures = 0
    while (remaining.length > 0) {
      if (runtime.cancelled) break
      const chat = this.deps.getChat(runtime.chatId)
      if (!chat?.ensemble) break
      const participant = remaining.shift()!
      const wasYieldTarget = yieldedTargetParticipantId === participant.id
      yieldedTargetParticipantId = null
      const run = this.seedParticipantRun(chat, runtime, participant)
      runtime.activeRunId = run.runId
      const completion = new Promise<EnsembleParticipantStatus>((resolve) => {
        run.completion = resolve
      })
      const permissions = this.resolveParticipantPermissions(chat, participant)
      const prompt = buildEnsembleParticipantPrompt({
        chat,
        config: chat.ensemble,
        participant,
        currentPrompt: runtime.prompt,
        roundId: runtime.roundId,
        chatContextTurns: this.deps.getSettings().chatContextTurns
      })
      // Slice D (1.0.3) — per-participant reasoning + speed + thinking
      // settings flow through the same AgentRunPayload fields the
      // composer uses for solo runs. Provider adapters already accept
      // these at the per-run level; we only fill the field that
      // matches the participant's provider so adapters don't see
      // cross-provider noise. Falls back silently when a participant
      // pre-dates the setup-sheet picker rework.
      const codexReasoning =
        participant.provider === 'codex' ? participant.reasoningEffort : undefined
      const codexServiceTier =
        participant.provider === 'codex'
          ? participant.serviceTier ?? (participant.fastModeEnabled ? 'fast' : '')
          : undefined
      const claudeReasoning =
        participant.provider === 'claude' ? participant.reasoningEffort : undefined
      const claudeFastMode =
        participant.provider === 'claude' ? Boolean(participant.fastModeEnabled) : undefined
      const kimiThinking =
        participant.provider === 'kimi' ? Boolean(participant.thinkingEnabled) : undefined

      const payload: AgentRunPayload = {
        provider: participant.provider,
        scope: chat.scope === 'global' ? 'global' : 'workspace',
        ...(chat.scope === 'global' ? {} : { workspace: chat.workspacePath || '' }),
        prompt,
        appRunId: run.runId,
        appChatId: chat.appChatId,
        model: participant.model || 'cli-default',
        approvalMode: permissions.approvalMode,
        runtimeProfileId: participant.runtimeProfileId,
        geminiAuthProfileId:
          participant.provider === 'gemini' ? participant.geminiAuthProfileId || null : null,
        providerSessionId: participant.linkedProviderSessionId || null,
        externalPathGrants: permissions.externalPathGrants,
        effectivePermissions: permissions,
        ensembleRun: ensembleRunIdentity(runtime.roundId, participant),
        ...(codexReasoning !== undefined ? { reasoningEffort: codexReasoning } : {}),
        ...(codexServiceTier !== undefined ? { serviceTier: codexServiceTier } : {}),
        ...(claudeReasoning !== undefined ? { claudeReasoningEffort: claudeReasoning } : {}),
        ...(claudeFastMode !== undefined ? { claudeFastMode } : {}),
        ...(kimiThinking !== undefined ? { kimiThinking } : {})
      }
      // 1.0.4 — wrap dispatch in try/catch so socket-level errors
      // (ECONNREFUSED on a dead MCP bridge, ETIMEDOUT on a hung
      // provider, ENOENT on a missing CLI binary) classify into a
      // typed failure and emit a structured transcript note rather
      // than crashing the whole round on the first dead participant.
      // The round-self-heal path was already correct structurally —
      // while-loop continues to the next participant in `remaining`
      // after a failed dispatch — this just adds the diagnostic.
      //
      // See `src/main/EnsembleErrors.ts` for the classifier; the
      // note shape is `formatDispatchFailureNote(participant, reason)`.
      // Origin: Claude/Explorer's introspective feedback in
      // production when ensemble_yield hit ECONNREFUSED on Gemini.
      let dispatchedResult: { dispatched: boolean; appRunId: string } | null = null
      let dispatchFailure: DispatchFailureReason | null = null
      try {
        dispatchedResult = await this.deps.dispatch(payload, { sender: runtime.sender })
      } catch (error) {
        dispatchFailure = classifyDispatchError(error)
      }
      if (dispatchFailure || !dispatchedResult?.dispatched) {
        // Reason precedence: the typed classification from a thrown
        // error wins over the generic `dispatched: false` path,
        // because the classifier carries more information (posix
        // code, preflight message). For the `dispatched: false`
        // case with no thrown error, we surface as `unknown` since
        // RunCoordinator already consumed the error in its preflight
        // try/catch and we don't have access to the original.
        dispatchAttempts += 1
        const reason: DispatchFailureReason =
          dispatchFailure || { kind: 'unknown', message: '' }
        if (reason.kind === 'unreachable') unreachableFailures += 1
        const note = formatDispatchFailureNote(participant, reason)
        // 1.0.4 — yield-target-specific transcript note. When the
        // just-shifted participant was promoted to the front via
        // ensemble_yield(target:...) and we couldn't reach them, the
        // round-status line should explicitly call out the yield
        // routing (it's more informative than the generic skip note
        // for this case). The per-participant run still records the
        // generic note as its reason so the chip strip / status pill
        // copy stays consistent with non-yield failures.
        if (wasYieldTarget && reason.kind === 'unreachable') {
          this.appendRoundStatus(
            runtime.chatId,
            runtime.roundId,
            formatYieldTargetUnreachableNote(
              participant,
              reason.underlyingCode,
              remaining[0] || null
            )
          )
        } else {
          this.appendRoundStatus(runtime.chatId, runtime.roundId, note)
        }
        this.finalizeRun(run, 'failed', note)
      } else {
        dispatchAttempts += 1
        await completion
      }
      runtime.activeRunId = undefined
      // Short-circuit the for-loop once anything is queued — the
      // round-end handler below picks the next prompt off the array
      // and starts a fresh round. The remaining unspoken participants
      // of this round are dropped intentionally: queued sends imply
      // the user wants a new turn, not the leftover of this one.
      if (runtime.queuedPrompts.length > 0) break
      // Slice C extension (1.0.3) — if the just-finished participant
      // yielded with `target`, find that target in `remaining` and
      // shuffle it to the front so it speaks next. Resolution rules
      // (first match wins):
      //   1. exact match on participant.id (e.g. 'ensemble-codex')
      //   2. case-insensitive provider name ('Codex' / 'codex')
      //   3. case-insensitive role match ('Worker' / 'worker')
      // Unresolved targets fall through to default ordering so a
      // typo doesn't strand the round. Cleared regardless so a
      // future yield without `target` reverts to default order.
      let routedByYieldTarget = false
      if (runtime.yieldTarget) {
        const idx = resolveYieldTargetIndex(remaining, runtime.yieldTarget)
        if (idx > 0) {
          const [moved] = remaining.splice(idx, 1)
          remaining.unshift(moved)
          routedByYieldTarget = true
          this.appendRoundStatus(
            runtime.chatId,
            runtime.roundId,
            `Yielded to ${moved.role || moved.provider} (${moved.provider}).`
          )
        } else if (idx === 0) {
          routedByYieldTarget = true
        } else if (runtime.orchestrationMode === 'continuous') {
          const target = resolveYieldTargetParticipant(
            chat.ensemble.participants || [],
            runtime.yieldTarget,
            participant
          )
          if (target?.enabled) {
            routedByYieldTarget = this.tryAppendContinuationTurn(
              runtime,
              remaining,
              target,
              `Yielded back to ${target.role || target.provider} (${target.provider}).`
            )
          }
        }
        runtime.yieldTarget = undefined
      }
      // @-mention auto-promotion (1.0.3 post-ship).
      //
      // When a participant tags another participant in their reply
      // ("Yielding to @Researcher for fact-check", "@GPT 5.5 take a
      // look"), promote that tagged participant to the front of the
      // remaining queue OR append them if they've already had their
      // turn in this round. The result: collaborative back-and-forth
      // doesn't stall at the round boundary — agents can call each
      // other by name and the orchestrator routes the next turn
      // there.
      //
      // Resolution lives in `EnsembleMentionAlias.findFirstMention`,
      // shared with the renderer-side composer overlay + DM router so
      // tagging behaves identically across the three surfaces. New in
      // 1.0.3: multi-word model-name aliases (`@GPT 5.5`,
      // `@Sonnet 4.7`, `@Flash Lite`, `@Kimi K2.6`) for the 1.0.4
      // same-provider-multiple-models case.
      //
      // Skips self-mentions (agents talking about themselves) — the
      // `excludeIds` arg drops the speaker from the alias-map result
      // so an agent narrating its own role can't promote itself into
      // an infinite loop. First match wins per turn — multiple
      // `@A @B @C` mentions only promote A.
      //
      // `chat` is already in scope from the top of the while loop —
      // no need to re-fetch.
      const allParticipants = chat?.ensemble?.participants || []
      const tagMatch = routedByYieldTarget
        ? null
        : findFirstMention(run.content, allParticipants, new Set([participant.id]))

      // 1.0.4 — explicit `@user` handoff. The speaker said "back
      // to the human" inline. Terminate the round immediately by
      // draining `remaining` so the while-loop exits next
      // iteration. Skips auto-promotion entirely; emits a status
      // note so the transcript records WHY the round closed early.
      if (tagMatch && tagMatch.kind === 'user') {
        const speakerLabel = participant.role || providerLabel(participant.provider)
        this.appendRoundStatus(
          runtime.chatId,
          runtime.roundId,
          `${speakerLabel} handed control back to the user via @${tagMatch.text}. Round closed.`
        )
        remaining.length = 0
      } else if (tagMatch && tagMatch.kind === 'participant' && tagMatch.participant.enabled) {
        // 1.0.4 same-provider disambiguation. The shared resolver
        // returns `ambiguousAmong` when the alias (e.g. plain
        // `@codex`) could have resolved to >1 participant after the
        // speaker was excluded. Two policies kick in:
        //
        //   1. Re-pick: among candidates, prefer the next-in-rotation
        //      that hasn't spoken yet in this round (still in
        //      `remaining`). Falls back to the resolver's ensemble-
        //      order pick if no candidate is still in remaining.
        //   2. Warn: emit a transcript system message so the user can
        //      see WHICH same-provider participant was actually
        //      addressed, and learn the explicit alias forms.
        //
        // Unambiguous matches (single role-name / single model alias)
        // skip both policies, matching pre-1.0.4 behaviour.
        let tagged = tagMatch.participant
        let ambiguityWarning: string | undefined
        if (tagMatch.ambiguousAmong && tagMatch.ambiguousAmong.length > 0) {
          const candidates = [tagMatch.participant, ...tagMatch.ambiguousAmong]
          const preferred = candidates.find((p) =>
            remaining.some((r) => r.id === p.id)
          )
          if (preferred) tagged = preferred
          const totalPeers = candidates.length
          ambiguityWarning =
            `@-mention: \`@${tagMatch.text}\` was ambiguous (${totalPeers} ${providerLabel(tagged.provider)} participants). ` +
            `Routed to ${tagged.role || tagged.provider} (next in rotation). ` +
            `Use @<role> or @<model> for explicit targeting.`
        }
        const existingIdx = remaining.findIndex((p) => p.id === tagged.id)
        if (existingIdx > 0) {
          // Already queued for this round — bring them forward.
          const [moved] = remaining.splice(existingIdx, 1)
          remaining.unshift(moved)
          if (ambiguityWarning) {
            this.appendRoundStatus(runtime.chatId, runtime.roundId, ambiguityWarning)
          }
          this.appendRoundStatus(
            runtime.chatId,
            runtime.roundId,
            `@-mention: ${moved.role || moved.provider} promoted to speak next.`
          )
        } else if (existingIdx === -1 && runtime.orchestrationMode === 'continuous') {
          // Already spoke this round (or never on the roster) — append
          // an extra turn at the FRONT so the back-and-forth continues
          // immediately. The participant gets a fresh `seedParticipantRun`
          // with a new runId, so no state collides. This extra-turn
          // path is only available in explicit Continuous mode; the
          // default Turn-bound mode treats @mentions as routing hints
          // for still-unspoken participants only.
          if (ambiguityWarning) {
            this.appendRoundStatus(runtime.chatId, runtime.roundId, ambiguityWarning)
          }
          this.tryAppendContinuationTurn(
            runtime,
            remaining,
            tagged,
            `@-mention: extra turn appended for ${tagged.role || tagged.provider}.`
          )
        } else if (existingIdx === 0 && ambiguityWarning) {
          // Already at the front — no rotation change, but the
          // ambiguity is still real and the user should see why the
          // resolver picked this particular Codex/Claude/etc.
          this.appendRoundStatus(runtime.chatId, runtime.roundId, ambiguityWarning)
        }
      }
      // 1.0.4 — remember whose dispatch is "the yield target" for
      // the next iteration so a failed dispatch on that participant
      // emits the yield-specific transcript note. Only the yield
      // path sets this; the @-mention block above promotes via its
      // own logic but doesn't get the yield-specific treatment (the
      // generic skip note still names the participant, which is
      // sufficient for that case).
      if (routedByYieldTarget && remaining.length > 0) {
        yieldedTargetParticipantId = remaining[0].id
      }
    }

    // 1.0.4 — user-fallback note. When every dispatch in this round
    // failed with `unreachable`, the round closed with no speaker.
    // Tell the user explicitly so they know to re-launch their
    // providers — otherwise the transcript just shows back-to-back
    // skip notes with no overall verdict. Bounded by:
    //   - `remaining.length === 0` — we exhausted every participant
    //     (didn't break early on queued prompts or cancellation)
    //   - `!runtime.cancelled` — user-initiated cancel has its own
    //     cancellation transcript line
    //   - `dispatchAttempts > 0` — empty participant list shouldn't
    //     trigger this (DM target was disabled, ordered set empty)
    //   - all attempts unreachable — at least one non-unreachable
    //     reason means the user has a per-participant note to act
    //     on; the fallback note would be misleading there
    if (
      remaining.length === 0 &&
      !runtime.cancelled &&
      dispatchAttempts > 0 &&
      unreachableFailures === dispatchAttempts
    ) {
      this.appendRoundStatus(
        runtime.chatId,
        runtime.roundId,
        formatAllUnreachableNote()
      )
    }

    // Dequeue the next prompt (FIFO) for the follow-up round. Anything
    // remaining stays in `runtime.queuedPrompts` and gets transferred
    // to the new runtime in `beginRound` so the chain continues
    // through every queued message until the queue drains.
    const [nextPrompt, ...remainingQueue] = runtime.queuedPrompts
    this.finishRound(runtime.chatId, runtime.roundId, runtime.cancelled ? 'cancelled' : 'completed')
    this.clearRuntimeIfCurrent(runtime)
    if (nextPrompt && !runtime.cancelled) {
      this.beginRound(runtime.chatId, nextPrompt, runtime.sender, undefined, remainingQueue)
    }
  }

  private seedParticipantRun(
    chat: ChatRecord,
    runtime: ActiveRoundRuntime,
    participant: EnsembleParticipant
  ): ActiveParticipantRun {
    const startedAt = this.deps.nowIso()
    const runId = this.deps.createRunId(participant.provider)
    const promptMessageId = `ensemble-prompt-${runtime.roundId}-${participant.id}`
    const assistantMessageId = `ensemble-assistant-${runtime.roundId}-${participant.id}`
    const run: ChatRun = {
      runId,
      provider: participant.provider,
      startedAt,
      promptMessageId,
      requestedModel: participant.model || 'cli-default',
      approvalMode: participant.permissionPresetId || 'default',
      status: 'running',
      ensembleRoundId: runtime.roundId,
      ensembleParticipantId: participant.id,
      ensembleRole: participant.role,
      ensembleOrder: participant.order,
      runtimeProfileId: participant.runtimeProfileId,
      ...(participant.provider === 'gemini' && participant.geminiAuthProfileId
        ? { geminiAuthProfileId: participant.geminiAuthProfileId }
        : {}),
      ...(participant.linkedProviderSessionId ? { providerThreadId: participant.linkedProviderSessionId } : {})
    }
    const activeRun: ActiveParticipantRun = {
      chatId: chat.appChatId,
      roundId: runtime.roundId,
      runId,
      participant,
      promptMessageId,
      assistantMessageId,
      startedAt,
      content: '',
      status: 'running'
    }
    this.runsByRunId.set(runId, activeRun)
    const updatedRuns = [...chat.runs, run]
    this.deps.saveChat({
      ...chat,
      runs: updatedRuns,
      ensemble: {
        ...chat.ensemble!,
        activeRound: updateRoundParticipant(chat.ensemble!.activeRound, participant.id, {
          status: 'running',
          runId,
          startedAt
        }),
        updatedAt: startedAt
      },
      updatedAt: this.deps.now()
    })
    return activeRun
  }

  private tryAppendContinuationTurn(
    runtime: ActiveRoundRuntime,
    remaining: EnsembleParticipant[],
    participant: EnsembleParticipant,
    statusMessage: string
  ): boolean {
    if (runtime.orchestrationMode !== 'continuous') return false
    if (runtime.continuationHops >= runtime.maxContinuationHops) {
      if (!runtime.continuationLimitNotified) {
        runtime.continuationLimitNotified = true
        this.appendRoundStatus(
          runtime.chatId,
          runtime.roundId,
          `Continuous handoff limit reached (${runtime.continuationHops}/${runtime.maxContinuationHops}); returning control to the user.`
        )
      }
      return false
    }
    runtime.continuationHops += 1
    remaining.unshift(participant)
    this.updateChatRound(runtime.chatId, (round) =>
      round?.roundId === runtime.roundId
        ? {
            ...round,
            continuationHops: runtime.continuationHops,
            maxContinuationHops: runtime.maxContinuationHops
          }
        : round
    )
    this.appendRoundStatus(
      runtime.chatId,
      runtime.roundId,
      `${statusMessage} Continuous handoff ${runtime.continuationHops}/${runtime.maxContinuationHops}.`
    )
    return true
  }

  private finalizeRun(
    run: ActiveParticipantRun,
    status: EnsembleParticipantStatus,
    reason?: string
  ): void {
    run.status = status
    this.flushRun(run, true, reason)
    run.completion?.(status)
    this.runsByRunId.delete(run.runId)
  }

  private flushRun(run: ActiveParticipantRun, final = false, reason?: string): void {
    if (run.flushTimer) {
      clearTimeout(run.flushTimer)
      run.flushTimer = undefined
    }
    const chat = this.deps.getChat(run.chatId)
    if (!chat?.ensemble) return
    const timestamp = this.deps.nowIso()
    let messages = [...chat.messages]

    // Timeline-driven materialisation. Each entry in `run.timeline`
    // becomes a message in the transcript, preserving the speak →
    // do → speak → do chronology agents naturally follow. Each
    // message id is deterministic on (runId, ordinal, kind) so
    // subsequent flushes replace in place — no message duplication
    // even across many delta events.
    //
    // Per-run cleanup: any previously-emitted timeline messages
    // for this run whose ids are no longer present in the current
    // timeline get removed (defends against the rare case where
    // the orchestrator decides to collapse adjacent entries on a
    // later flush — currently we always preserve order, but the
    // cleanup makes the rebuild idempotent regardless).
    const timeline = run.timeline || []
    const desiredIds = new Set<string>()
    const desiredMessages: ChatMessage[] = []
    for (let i = 0; i < timeline.length; i += 1) {
      const entry = timeline[i]
      if (entry.kind === 'content') {
        const id = timelineMessageId(run.runId, i, 'content')
        desiredIds.add(id)
        if (!entry.text.trim()) continue
        desiredMessages.push({
          id,
          role: 'assistant',
          content: entry.text,
          timestamp,
          runId: run.runId,
          metadata: {
            kind: 'ensembleParticipant',
            ensembleRoundId: run.roundId,
            ensembleParticipantId: run.participant.id,
            ensembleProvider: run.participant.provider,
            ensembleRole: run.participant.role,
            ensembleOrder: run.participant.order,
            ensembleStatus: run.status,
            ensembleTimelineIndex: i,
            // Model preview: pass the participant's configured model so
            // the renderer can show e.g. "Codex / GPT 5.5" next to the
            // bubble. Crucial preview for 1.0.4's same-provider
            // ensembles where the role+provider alone won't tell the
            // user which Claude/Codex is speaking.
            ensembleModel: run.participant.model,
            // Reasoning suffix companion to `ensembleModel`. The
            // renderer's `formatAssistantMessageLabel` appends this via
            // `reasoningDisplayLabel` so the header reads "5.5 Extra
            // High" / "Opus 4.7 · Max" / "K2.6 Thinking" — matching
            // the composer chip the user picked. Only the field that
            // applies to this participant's provider is set; the others
            // stay undefined.
            ...ensembleReasoningMetadata(run.participant)
          }
        })
      } else {
        const id = timelineMessageId(run.runId, i, 'tool')
        desiredIds.add(id)
        const activity = run.toolActivities?.find((a) => a.id === entry.toolId)
        if (!activity) continue
        desiredMessages.push({
          id,
          role: 'tool',
          content: '',
          timestamp,
          runId: run.runId,
          toolActivities: [activity],
          metadata: {
            kind: 'ensembleParticipantTools',
            ensembleRoundId: run.roundId,
            ensembleParticipantId: run.participant.id,
            ensembleProvider: run.participant.provider,
            ensembleRole: run.participant.role,
            ensembleOrder: run.participant.order,
            ensembleTimelineIndex: i,
            ensembleModel: run.participant.model,
            ...ensembleReasoningMetadata(run.participant)
          }
        })
      }
    }

    // Strip any prior timeline messages for this run from the chat
    // (other messages — round-prompt user msgs, status cards from
    // OTHER runs, etc. — stay untouched). Then re-insert the fresh
    // ordered sequence at the end. Insertion-at-end is correct here
    // because the orchestrator flushes participants in turn order
    // and each participant's content is contiguous within the
    // transcript anyway.
    messages = messages.filter((message) => {
      if (message.runId !== run.runId) return true
      if (message.role !== 'assistant' && message.role !== 'tool') return true
      // Only filter our own timeline-ids; non-timeline assistant
      // messages from older code paths (none remain in this file
      // but defending in depth) stay.
      const stableId = typeof message.id === 'string' ? message.id : ''
      return !stableId.startsWith(`ensemble-content-${run.runId}-`) &&
        !stableId.startsWith(`ensemble-tool-${run.runId}-`) &&
        // Legacy single-id flush from earlier 1.0.3 builds — also
        // remove so migrated chats don't show stale duplicates.
        message.id !== run.assistantMessageId &&
        !stableId.startsWith(`ensemble-tool-${run.runId}`)
    })
    messages = [...messages, ...desiredMessages]

    // Status card for yielded / failed / skipped, appended after
    // the timeline messages so it reads as a coda. Unchanged from
    // the pre-timeline version aside from running after the new
    // messages are materialised.
    if (
      final &&
      (run.status === 'yielded' || run.status === 'failed' || run.status === 'skipped')
    ) {
      const statusLine = (() => {
        const who = run.participant.role || run.participant.provider
        const suffix = reason ? ` ${reason}` : ''
        if (run.status === 'yielded') return `${who} yielded.${suffix}`
        if (run.status === 'failed') return `${who} failed.${suffix}`
        return `${who} skipped.${suffix}`
      })()
      const statusId = `ensemble-status-${run.runId}`
      // Replace existing status card if one is already in messages
      // (defensive — we filtered timeline messages above but the
      // status card has its own id namespace).
      const existingStatusIdx = messages.findIndex((m) => m.id === statusId)
      const statusMsg: ChatMessage = {
        id: statusId,
        role: 'system',
        content: statusLine,
        timestamp,
        runId: run.runId,
        metadata: {
          kind: 'ensembleParticipantStatus',
          ensembleRoundId: run.roundId,
          ensembleParticipantId: run.participant.id,
          ensembleProvider: run.participant.provider,
          ensembleRole: run.participant.role,
          ensembleOrder: run.participant.order,
          ensembleStatus: run.status,
          ensembleModel: run.participant.model,
          ...ensembleReasoningMetadata(run.participant)
        }
      }
      if (existingStatusIdx >= 0) {
        messages[existingStatusIdx] = statusMsg
      } else {
        messages = [...messages, statusMsg]
      }
    }

    const runs = chat.runs.map((existingRun) =>
      existingRun.runId === run.runId
        ? {
            ...existingRun,
            actualModel: run.actualModel || existingRun.actualModel,
            providerThreadId: run.providerSessionId || existingRun.providerThreadId,
            stats: run.stats || existingRun.stats,
            status: final ? statusToRunStatus(run.status) : existingRun.status || 'running',
            endedAt: final ? timestamp : existingRun.endedAt
          }
        : existingRun
    )

    const participants = (chat.ensemble.participants || []).map((participant) => {
      if (participant.id !== run.participant.id) return participant
      const tokenTotals = mergeTokenTotals(participant.tokenTotals, run.stats)
      return {
        ...participant,
        ...(run.providerSessionId ? { linkedProviderSessionId: run.providerSessionId } : {}),
        ...(tokenTotals ? { tokenTotals } : {})
      }
    })
    const activeRound = updateRoundParticipant(chat.ensemble.activeRound, run.participant.id, {
      status: run.status,
      runId: run.runId,
      ...(reason ? { reason } : {}),
      ...(final ? { endedAt: timestamp } : {})
    })
    this.deps.saveChat({
      ...chat,
      messages,
      runs,
      ensemble: {
        ...chat.ensemble,
        participants,
        activeRound,
        updatedAt: timestamp
      },
      updatedAt: this.deps.now()
    })
  }

  private scheduleFlush(run: ActiveParticipantRun): void {
    if (run.flushTimer) return
    run.flushTimer = setTimeout(() => this.flushRun(run), 250)
  }

  private updateParticipantState(
    chatId: string,
    roundId: string,
    participantId: string | undefined,
    status: EnsembleParticipantStatus,
    reason?: string
  ): void {
    if (!participantId) return
    this.updateChatRound(chatId, (round) =>
      round?.roundId === roundId
        ? updateRoundParticipant(round, participantId, { status, reason, endedAt: this.deps.nowIso() })
        : round
    )
  }

  private finishRound(
    chatId: string,
    roundId: string,
    status: EnsembleRoundState['status']
  ): void {
    const endedAt = this.deps.nowIso()
    this.updateChatRound(chatId, (round) =>
      round?.roundId === roundId
        ? {
            ...round,
            status,
            activeParticipantId: undefined,
            endedAt,
            participants: round.participants.map((participant) =>
              participant.status === 'idle'
                ? {
                    ...participant,
                    status: status === 'cancelled' ? 'cancelled' : 'skipped',
                    reason:
                      status === 'cancelled'
                        ? 'Round cancelled before this participant spoke.'
                        : 'Round superseded before this participant spoke.',
                    endedAt
                  }
                : participant
            )
          }
        : round
    )
  }

  private appendRoundStatus(chatId: string, roundId: string, content: string): void {
    const chat = this.deps.getChat(chatId)
    if (!chat?.ensemble) return
    const timestamp = this.deps.nowIso()
    this.deps.saveChat({
      ...chat,
      messages: [
        ...chat.messages,
        {
          id: `ensemble-round-status-${roundId}`,
          role: 'system',
          content,
          timestamp,
          metadata: {
            kind: 'ensembleRoundStatus',
            ensembleRoundId: roundId
          }
        }
      ],
      updatedAt: this.deps.now()
    })
  }

  private clearRuntimeIfCurrent(runtime: ActiveRoundRuntime): void {
    if (this.roundsByChatId.get(runtime.chatId)?.roundId === runtime.roundId) {
      this.roundsByChatId.delete(runtime.chatId)
    }
  }

  private updateChatRound(
    chatId: string,
    update: (round: EnsembleRoundState | undefined) => EnsembleRoundState | undefined
  ): void {
    const chat = this.deps.getChat(chatId)
    if (!chat?.ensemble) return
    const activeRound = update(chat.ensemble.activeRound)
    this.deps.saveChat({
      ...chat,
      ensemble: {
        ...chat.ensemble,
        ...(activeRound ? { activeRound } : {}),
        updatedAt: this.deps.nowIso()
      },
      updatedAt: this.deps.now()
    })
  }

  private resolveParticipantPermissions(
    chat: ChatRecord,
    participant: EnsembleParticipant
  ): EffectiveRunPermissions {
    return resolveEffectiveRunPermissions({
      provider: participant.provider,
      workspacePath: chat.scope === 'global' ? undefined : chat.workspacePath,
      settings: this.deps.getSettings(),
      presetId: participant.permissionPresetId,
      overrides: participant.permissionOverrides || null
    })
  }
}

function ensembleRunIdentity(
  roundId: string,
  participant: EnsembleParticipant
): EnsembleRunIdentity {
  return {
    roundId,
    participantId: participant.id,
    provider: participant.provider,
    role: participant.role,
    order: participant.order
  }
}

/**
 * Companion fields to `ensembleModel` on the assistant message metadata
 * so the transcript header can append a reasoning suffix that mirrors
 * what the user picked in the composer chip
 * (`reasoningDisplayLabel` in `composerChipFormat.ts`).
 *
 * Only the field that applies to this participant's provider is set:
 *   codex / claude  → `ensembleReasoningEffort` (token: low/medium/high/xhigh/off)
 *   kimi            → `ensembleThinkingEnabled` (boolean)
 *   gemini          → nothing (no reasoning axis)
 *
 * Returning an object that gets spread keeps the call-sites compact and
 * avoids stamping `undefined` keys onto the metadata when the field
 * doesn't apply.
 */
function ensembleReasoningMetadata(
  participant: EnsembleParticipant
): Record<string, unknown> {
  if (participant.provider === 'codex' || participant.provider === 'claude') {
    return participant.reasoningEffort
      ? { ensembleReasoningEffort: participant.reasoningEffort }
      : {}
  }
  if (participant.provider === 'kimi') {
    return { ensembleThinkingEnabled: Boolean(participant.thinkingEnabled) }
  }
  return {}
}

function updateRoundParticipant(
  round: EnsembleRoundState | undefined,
  participantId: string,
  partial: Partial<EnsembleRoundState['participants'][number]>
): EnsembleRoundState | undefined {
  if (!round) return round
  return {
    ...round,
    activeParticipantId:
      partial.status === 'running'
        ? participantId
        : round.activeParticipantId === participantId
          ? undefined
          : round.activeParticipantId,
    participants: round.participants.map((participant) =>
      participant.participantId === participantId ? { ...participant, ...partial } : participant
    )
  }
}

function statusToRunStatus(status: EnsembleParticipantStatus): string {
  if (status === 'answered' || status === 'yielded' || status === 'skipped') return 'success'
  if (status === 'cancelled') return 'cancelled'
  return 'failed'
}

function mergeTokenTotals(existing: EnsembleParticipant['tokenTotals'], stats: any) {
  if (!stats || typeof stats !== 'object') return existing
  const next = { ...(existing || {}) }
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens', 'duration_ms'] as const) {
    const value = Number(stats[key])
    if (Number.isFinite(value) && value > 0) next[key] = (next[key] || 0) + value
  }
  return Object.keys(next).length > 0 ? next : existing
}

function extractProviderSessionId(payload: any): string | undefined {
  const raw =
    payload?.providerThreadId ??
    payload?.providerSessionId ??
    payload?.session_id ??
    payload?.sessionId ??
    payload?.thread_id ??
    payload?.threadId
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
}

function resolveEnsembleOrchestrationMode(
  config: Pick<EnsembleConfig, 'orchestrationMode'> | null | undefined
): EnsembleOrchestrationMode {
  return config?.orchestrationMode === 'continuous' ? 'continuous' : 'turn_bound'
}

function resolveMaxContinuationHops(
  config: Pick<EnsembleConfig, 'maxContinuationHops'> | null | undefined
): number {
  const raw = Number(config?.maxContinuationHops)
  if (!Number.isFinite(raw)) return DEFAULT_CONTINUATION_HOP_LIMIT
  return Math.max(1, Math.min(MAX_CONTINUATION_HOP_LIMIT, Math.floor(raw)))
}

/**
 * Slice C extension (1.0.3) — resolve a free-form yield `target`
 * string (as passed to `ensemble_yield`) against the round's remaining
 * participants. Returns the index of the first match, or -1 if no
 * remaining participant matches. Tries (in order):
 *   1. exact participant.id ('ensemble-codex')
 *   2. case-insensitive provider name ('codex')
 *   3. case-insensitive role ('Worker')
 *
 * Only consults the `remaining` array — yielding to a participant
 * who has already spoken in this round is a no-op (the round won't
 * loop back through this helper). Continuous-mode loop-back is handled
 * separately after the remaining-queue lookup fails. Whitespace +
 * 'me' / 'self' targets are rejected so a model that mis-fills the
 * field doesn't recurse onto itself.
 */
export function resolveYieldTargetIndex(
  remaining: EnsembleParticipant[],
  target: string
): number {
  const trimmed = target?.trim()
  if (!trimmed) return -1
  const lc = trimmed.toLowerCase()
  if (lc === 'me' || lc === 'self' || lc === 'user' || lc === 'human') return -1
  const byId = remaining.findIndex((p) => p.id === trimmed)
  if (byId !== -1) return byId
  const byProvider = remaining.findIndex((p) => p.provider.toLowerCase() === lc)
  if (byProvider !== -1) return byProvider
  const byRole = remaining.findIndex((p) => (p.role || '').toLowerCase() === lc)
  if (byRole !== -1) return byRole
  return -1
}

function resolveYieldTargetParticipant(
  participants: EnsembleParticipant[],
  target: string,
  speaker?: EnsembleParticipant
): EnsembleParticipant | null {
  const trimmed = target?.trim()
  if (!trimmed) return null
  const lc = trimmed.toLowerCase()
  if (lc === 'me' || lc === 'self' || lc === 'user' || lc === 'human') return null
  const byId = participants.find((p) => p.id === trimmed)
  if (byId && byId.id !== speaker?.id) return byId
  const resolved = resolvePhraseToParticipant(
    trimmed,
    participants,
    speaker ? new Set([speaker.id]) : undefined
  )
  return resolved || null
}

/**
 * Scan a participant's emitted content for `@Token` mentions.
 * Returns the first matched phrase (without the `@`) so the caller
 * can resolve against the ensemble's participant list.
 *
 * NOTE: legacy export kept so older tests + any plugin code that
 * imports it stays working. The runtime call path (`runRound`'s
 * auto-promotion) now uses `findFirstMention` directly so it can
 * resolve multi-word model aliases (`@GPT 5.5`, `@Sonnet 4.7`,
 * `@Flash Lite`, `@Kimi K2.6`) without losing the trailing words.
 *
 * Pattern mirrors the renderer-side composer overlay tokeniser via
 * the shared `EnsembleMentionAlias` module so coverage stays aligned:
 * word boundary before `@`, letter-led identifier, max 33 chars per
 * chunk, up to 4 chunks total. The boundary check skips email-style
 * tokens like `chris@example.com` (the `@` there is preceded by a
 * letter, not a boundary char).
 */
export function extractFirstAtMentionTarget(content: string): string | null {
  if (!content || !content.includes('@')) return null
  const re = /(^|[\s(\[{<>"'`!?,;:.])@([A-Za-z][A-Za-z0-9._-]{0,32}(?:\s+[A-Za-z0-9][A-Za-z0-9._-]{0,32}){0,3})/g
  const match = re.exec(content)
  return match ? match[2] : null
}

/**
 * Resolve an `@Token` (or `@Multi-Word`) mention against a participant
 * list. Delegates to the shared `EnsembleMentionAlias` resolver so the
 * orchestrator's auto-promotion path and the renderer-side surfaces
 * see identical results. Filters out the speaker themself so agents
 * that happen to reference their own role in narration don't get
 * promoted into an infinite self-loop.
 */
export function resolveAtMentionTarget(
  token: string,
  participants: EnsembleParticipant[],
  speaker?: EnsembleParticipant
): EnsembleParticipant | null {
  const trimmed = token?.trim()
  if (!trimmed) return null
  const excludeIds = speaker ? new Set([speaker.id]) : undefined
  return resolvePhraseToParticipant(trimmed, participants, excludeIds)
}
