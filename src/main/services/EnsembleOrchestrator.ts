import type { AgentRunPayload, AgentRunRoute } from '../index'
import { resolveEffectiveRunPermissions } from '../EffectiveRunPermissions'
import {
  buildEnsembleParticipantPrompt,
  getOrderedEnsembleParticipants
} from '../EnsemblePrompt'
import type {
  AppSettings,
  ChatMessage,
  ChatRecord,
  ChatRun,
  EffectiveRunPermissions,
  EnsembleParticipant,
  EnsembleParticipantStatus,
  EnsembleRunIdentity,
  EnsembleRoundState,
  ProviderId
} from '../store/types'

export type EnsembleRunMode = 'normal' | 'queue' | 'steer'

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

interface ActiveParticipantRun {
  chatId: string
  roundId: string
  runId: string
  participant: EnsembleParticipant
  promptMessageId: string
  assistantMessageId: string
  startedAt: string
  content: string
  status: EnsembleParticipantStatus
  lastContentItemId?: string
  actualModel?: string
  providerSessionId?: string
  stats?: any
  completion?: (status: EnsembleParticipantStatus) => void
  flushTimer?: ReturnType<typeof setTimeout>
}

interface ActiveRoundRuntime {
  chatId: string
  roundId: string
  sender: Electron.WebContents
  prompt: string
  cancelled: boolean
  queuedPrompt?: string
  activeRunId?: string
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
      existing.queuedPrompt = prompt
      this.updateChatRound(input.chatId, (round) =>
        round ? { ...round, queuedPrompt: prompt } : round
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
    runtime.queuedPrompt = undefined
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
        run.content += `${itemTransition ? '\n\n---\n\n' : ''}${text}`
        if (itemId) run.lastContentItemId = itemId
        this.scheduleFlush(run)
      } else if (itemId) {
        run.lastContentItemId = itemId
      }
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
    dmTargetParticipantId?: string
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
    const round: EnsembleRoundState = {
      roundId,
      status: 'running',
      prompt,
      startedAt,
      participants: ordered.map((participant) => ({
        participantId: participant.id,
        provider: participant.provider,
        role: participant.role,
        order: participant.order,
        status: 'idle'
      }))
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
      cancelled: false
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
    while (remaining.length > 0) {
      if (runtime.cancelled) break
      const chat = this.deps.getChat(runtime.chatId)
      if (!chat?.ensemble) break
      const participant = remaining.shift()!
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
      const dispatched = await this.deps.dispatch(payload, { sender: runtime.sender })
      if (!dispatched.dispatched) {
        this.finalizeRun(run, 'failed', 'Dispatch failed.')
      } else {
        await completion
      }
      runtime.activeRunId = undefined
      if (runtime.queuedPrompt) break
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
      if (runtime.yieldTarget) {
        const idx = resolveYieldTargetIndex(remaining, runtime.yieldTarget)
        if (idx > 0) {
          const [moved] = remaining.splice(idx, 1)
          remaining.unshift(moved)
          this.appendRoundStatus(
            runtime.chatId,
            runtime.roundId,
            `Yielded to ${moved.role || moved.provider} (${moved.provider}).`
          )
        }
        runtime.yieldTarget = undefined
      }
    }

    const queuedPrompt = runtime.queuedPrompt
    this.finishRound(runtime.chatId, runtime.roundId, runtime.cancelled ? 'cancelled' : 'completed')
    this.clearRuntimeIfCurrent(runtime)
    if (queuedPrompt && !runtime.cancelled) {
      this.beginRound(runtime.chatId, queuedPrompt, runtime.sender)
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
    const assistantIndex = messages.findIndex((message) => message.id === run.assistantMessageId)
    if (run.content.trim()) {
      const assistantMessage: ChatMessage = {
        ...(assistantIndex >= 0 ? messages[assistantIndex] : {}),
        id: run.assistantMessageId,
        role: 'assistant',
        content: run.content,
        timestamp,
        runId: run.runId,
        metadata: {
          kind: 'ensembleParticipant',
          ensembleRoundId: run.roundId,
          ensembleParticipantId: run.participant.id,
          ensembleProvider: run.participant.provider,
          ensembleRole: run.participant.role,
          ensembleOrder: run.participant.order,
          ensembleStatus: run.status
        }
      }
      if (assistantIndex >= 0) messages[assistantIndex] = assistantMessage
      else messages = [...messages, assistantMessage]
    } else if (final && (run.status === 'yielded' || run.status === 'failed')) {
      messages = [
        ...messages,
        {
          id: `ensemble-status-${run.runId}`,
          role: 'system',
          content:
            run.status === 'yielded'
              ? `${run.participant.role || run.participant.provider} yielded.${reason ? ` ${reason}` : ''}`
              : `${run.participant.role || run.participant.provider} failed.${reason ? ` ${reason}` : ''}`,
          timestamp,
          runId: run.runId,
          metadata: {
            kind: 'ensembleParticipantStatus',
            ensembleRoundId: run.roundId,
            ensembleParticipantId: run.participant.id,
            ensembleProvider: run.participant.provider,
            ensembleRole: run.participant.role,
            ensembleOrder: run.participant.order,
            ensembleStatus: run.status
          }
        }
      ]
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
 * loop back). Whitespace + 'me' / 'self' targets are rejected so a
 * model that mis-fills the field doesn't recurse onto itself.
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
