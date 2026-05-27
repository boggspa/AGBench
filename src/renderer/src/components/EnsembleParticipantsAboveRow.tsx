/*
 * EnsembleParticipantsAboveRow — 1.0.3 ship-night.
 *
 * Replaces the bottom-pinned `EnsembleSetupSheet` modal AND the
 * top-of-chat `EnsembleParticipantStrip`, consolidating both into a
 * single composer above-row that sits below the existing file-changes
 * + Create PR row and above the composer textarea.
 *
 * Slice F v2 (1.0.3 — same ship-night rework): instead of opening a
 * per-chip flyout for editing, clicking a chip SELECTS it. The
 * composer's existing `CombinedModelPicker` + `CombinedPermissionsPicker`
 * then rebind to read/write the selected participant's settings. This
 * means there's one set of pickers in the app (the composer's), and
 * the chips just retarget who they configure.
 *
 *   - Click chip → onSelectParticipant(id). The chip gets a thick
 *     accent border to signal selection.
 *   - Drag horizontally → reorder the speaking sequence (HTML5
 *     native drag-and-drop, persisted via onChatChange).
 *   - On the selected chip only, a `⋯` overflow button surfaces an
 *     inline mini-popover for the two affordances that don't have
 *     a natural home in the composer pickers: `enabled` toggle and
 *     `role` rename.
 *   - Disabled participants render dimmed; they're still selectable
 *     so the user can re-enable from the overflow.
 *
 * Selection state lives in the parent (App.tsx) so the composer
 * pickers can read it. Auto-follow-active-speaker logic also lives
 * upstream — this component is otherwise display-only beyond click +
 * drag + the overflow editor.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  ChatRecord,
  EnsembleParticipant,
  ProviderId
} from '../../../main/store/types'
import { getDefaultEnsembleParticipantConfig } from '../lib/ensembleProviderDefaults'
import { withSessionActivityLedger } from '../lib/sessionActivityLedger'
import { getProviderName, ProviderBadgeIcon } from './Sidebar'

// 1.0.4-AR2 — global ceiling raised from 6 → 8 so the panel can host
// the broader four-provider roster plus alternates (e.g. two Claudes
// in different roles). The hard minimum is enforced in
// `removeParticipant` below at `<= 2` so a panel is never reduced to
// a solo speaker — keeps the ensemble distinct from a single-provider
// chat throughout its lifecycle.
const MAX_ENSEMBLE_PARTICIPANTS = 8
const MIN_ENSEMBLE_PARTICIPANTS = 2

/**
 * Monoline status icon for a participant chip (1.0.3 polish).
 *
 * Replaces the pre-existing uppercase text labels ("IDLE", "SPEAKING",
 * "YIELDED", etc.) inside the chip's `.ensemble-above-chip-status`
 * pill. Each icon uses `stroke="currentColor"` so the existing
 * `.status-{name}` colour rules in main.css continue to drive the
 * tint — the icon naturally reads "yielded amber", "answered green",
 * etc. without per-icon hard-coded fills.
 *
 * 16x16 viewBox with 1.5 stroke width keeps the glyphs visually
 * consistent with the rest of the chip-strip iconography (the
 * provider badge SVGs use the same density). 13×13 rendered size is
 * roughly the visual weight of a single uppercase letter in the
 * pre-existing label — small enough to feel like a status hint, big
 * enough to read at glance.
 *
 * Status taxonomy mirrors `EnsembleParticipantStatus` plus the
 * synthetic `'speaking'` label the parent uses for the currently-
 * active participant:
 *   - speaking / running → megaphone (active output)
 *   - idle              → ZZZ stack (waiting its turn)
 *   - yielded           → curved-rightward handoff arrow (deliberate
 *                          pass — distinct from skip which is
 *                          involuntary)
 *   - answered          → checkmark (turn complete, content delivered)
 *   - failed            → warning triangle with !
 *   - skipped           → skip-forward double-triangle (passed over)
 *   - cancelled         → circle-slash (round-level cancel)
 *   - default           → ZZZ (unknown status falls through to idle
 *                          glyph for safety)
 */
function ParticipantStatusIcon({ status }: { status: string }): React.JSX.Element {
  const key = status.toLowerCase()
  const baseSvgProps = {
    width: 13,
    height: 13,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const
  }
  if (key === 'speaking' || key === 'running') {
    // Megaphone: rectangular body + flared mouth + two sound waves.
    return (
      <svg {...baseSvgProps}>
        <path d="M3 6.5h2L10 4v8L5 9.5H3Z" />
        <path d="M3 6.5v3" />
        <path d="M12 6c.7 1 .7 3 0 4" />
        <path d="M13.8 4.5c1.1 1.6 1.1 5.4 0 7" />
      </svg>
    )
  }
  if (key === 'yielded') {
    // Curved handoff arrow: small leftward stem rises then arcs
    // rightward — "I'm done, the next person can go". Distinct from
    // a plain rightward arrow (which we use for skipped) so the
    // glyph reads as deliberate handoff vs forced skip.
    return (
      <svg {...baseSvgProps}>
        <path d="M3 12V8a3 3 0 0 1 3-3h7" />
        <path d="m10 2.5 3 2.5-3 2.5" />
      </svg>
    )
  }
  if (key === 'answered') {
    // Plain checkmark. The .status-answered colour rule gives it the
    // success-green tint.
    return (
      <svg {...baseSvgProps}>
        <path d="m3 8.5 3.5 3.5L13 5" />
      </svg>
    )
  }
  if (key === 'failed') {
    // Warning triangle with exclamation.
    return (
      <svg {...baseSvgProps}>
        <path d="M8 2.5 14.5 13.5h-13z" />
        <path d="M8 7v3" />
        <path d="M8 12h.01" strokeWidth={2} />
      </svg>
    )
  }
  if (key === 'skipped') {
    // Skip-forward: two right-pointing triangles. Solid fill so it
    // reads as a media-control glyph even at 13px.
    return (
      <svg {...baseSvgProps}>
        <path d="M3 4v8l5-4z" fill="currentColor" stroke="none" />
        <path d="M8.5 4v8l5-4z" fill="currentColor" stroke="none" />
      </svg>
    )
  }
  if (key === 'cancelled') {
    // Circle-slash. The .status-cancelled colour rule keeps it in
    // the danger-tinted family.
    return (
      <svg {...baseSvgProps}>
        <circle cx="8" cy="8" r="5" />
        <path d="m4.7 11.3 6.6-6.6" />
      </svg>
    )
  }
  if (key === 'unreachable') {
    // 1.0.4-AD — broken-chain icon for participants the pre-flight
    // probe couldn't verify at round start. Two staggered link-shaped
    // ovals with a clear gap between them: reads as "connection
    // severed" at glance. The .status-unreachable colour rule (added
    // in main.css) carries the danger-amber tint so the pill stands
    // apart from `answered` (green) and `failed` (also amber but
    // mid-round rather than pre-flight). Hover tooltip wires the
    // `lastFailureReason` from the round state.
    return (
      <svg {...baseSvgProps}>
        <path d="M5.5 6.5a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h1.2" />
        <path d="M10.5 9.5a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2H9.3" />
        <path d="m3 13 10-10" strokeWidth={1.3} />
      </svg>
    )
  }
  // idle (default fall-through): three Z marks descending — sleeping
  // / dormant. Drawn as nested polylines so the staircase is the
  // shape, not glyphs (avoids font-rendering inconsistencies).
  return (
    <svg {...baseSvgProps}>
      <path d="M9 3h3l-3 3h3" strokeWidth={1.2} />
      <path d="M5 7h4l-4 4h4" />
      <path d="M3 12h2l-2 2h2" strokeWidth={1.2} />
    </svg>
  )
}

interface EnsembleParticipantsAboveRowProps {
  chat: ChatRecord
  selectedParticipantId: string | null
  onSelectParticipant: (id: string) => void
  onChatChange: (next: ChatRecord) => void
  /**
   * "Skip" the currently-speaking participant. Cancels the active
   * provider run and lets the orchestrator's round-loop advance to
   * the next participant without restarting the round. The composer's
   * existing Stop button (wired to `handleCancel` → `cancelEnsembleRound`)
   * handles full-round cancellation, so the chip strip's previous
   * "Stop Ensemble" button was redundant and got dropped in favour of
   * this gentler Skip affordance.
   */
  onSkipActive?: () => void
  /**
   * 1.0.4-AK2 — Stop the active Work Session. Cancels the in-flight
   * round + clears queued continuations + flips
   * `workSession.status` to `'cancelled'`. Wired to
   * `handleStopWorkSession` in App.tsx; omitted in non-Work-Session
   * surfaces (e.g. older harness tests) so the strip degrades to
   * disabled.
   */
  onStopWorkSession?: () => void
}

export function EnsembleParticipantsAboveRow({
  chat,
  selectedParticipantId,
  onSelectParticipant,
  onChatChange,
  onSkipActive,
  onStopWorkSession
}: EnsembleParticipantsAboveRowProps): React.JSX.Element | null {
  if (chat.chatKind !== 'ensemble' || !chat.ensemble) return null

  const participants = [...(chat.ensemble.participants || [])].sort((a, b) => a.order - b.order)
  const activeRound = chat.ensemble.activeRound
  const isRoundRunning = activeRound?.status === 'running'
  const canAddParticipant = !isRoundRunning && participants.length < MAX_ENSEMBLE_PARTICIPANTS

  const [overflowOpenId, setOverflowOpenId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const updateParticipant = (id: string, patch: Partial<EnsembleParticipant>): void => {
    if (isRoundRunning) return
    const next = participants.map((p) => (p.id === id ? { ...p, ...patch } : p))
    persist(next)
  }

  const persist = (nextParticipants: EnsembleParticipant[]): void => {
    // 1.0.4-AR2 — preserve any existing per-chat `maxParticipants`
    // override that's already in range [MIN, MAX]. Pre-AR2 every
    // persist clobbered the cap to the global ceiling, silently
    // expanding a user's deliberately-tightened 3-of-N panel back
    // to the default whenever they toggled a participant. Fall back
    // to the ceiling only when the stored value is missing /
    // nonsensical / out of range.
    const existingMax = chat.ensemble?.maxParticipants
    const clampedMax =
      Number.isFinite(existingMax) &&
      (existingMax as number) >= MIN_ENSEMBLE_PARTICIPANTS &&
      (existingMax as number) <= MAX_ENSEMBLE_PARTICIPANTS
        ? (existingMax as number)
        : MAX_ENSEMBLE_PARTICIPANTS
    const nextChat: ChatRecord = {
      ...chat,
      ensemble: {
        ...chat.ensemble!,
        maxParticipants: clampedMax,
        participants: nextParticipants.map((p, idx) => ({ ...p, order: idx + 1 })),
        updatedAt: new Date().toISOString()
      }
    }
    onChatChange(withSessionActivityLedger(chat, nextChat))
  }

  const addParticipant = (): void => {
    if (!canAddParticipant) return
    const source =
      participants.find((participant) => participant.id === selectedParticipantId) ||
      participants[participants.length - 1]
    const provider: ProviderId = source?.provider || 'codex'
    const defaults = getDefaultEnsembleParticipantConfig(provider)
    const sourceIndex = source
      ? participants.findIndex((participant) => participant.id === source.id)
      : participants.length - 1
    const newParticipant: EnsembleParticipant = {
      id: nextParticipantId(participants),
      provider,
      enabled: true,
      role: nextRoleLabel(source?.role || getProviderName(provider), participants),
      instructions:
        source?.instructions || `Contribute as ${getProviderName(provider)} for this ensemble.`,
      order: participants.length + 1,
      model: source?.model || defaults.model,
      runtimeProfileId: source?.runtimeProfileId,
      geminiAuthProfileId: provider === 'gemini' ? source?.geminiAuthProfileId || null : null,
      permissionPresetId: source?.permissionPresetId || defaults.permissionPresetId,
      reasoningEffort: source?.reasoningEffort || defaults.reasoningEffort,
      fastModeEnabled: source?.fastModeEnabled ?? defaults.fastModeEnabled,
      thinkingEnabled: source?.thinkingEnabled ?? defaults.thinkingEnabled,
      serviceTier: source?.serviceTier ?? defaults.serviceTier
    }
    const next = [...participants]
    next.splice(Math.max(0, sourceIndex + 1), 0, newParticipant)
    persist(next)
    onSelectParticipant(newParticipant.id)
  }

  const removeParticipant = (id: string): void => {
    // 1.0.4-AR2 — hard floor of 2 participants. Pre-AR2 this was
    // `<= 1` (i.e. you could always have a solo ensemble), which
    // defeats the point of the ensemble surface. The chip strip
    // already renders the trash button disabled when at the floor;
    // this guard is the defense-in-depth for IPC-driven roster edits.
    if (isRoundRunning || participants.length <= MIN_ENSEMBLE_PARTICIPANTS) return
    const next = participants.filter((participant) => participant.id !== id)
    persist(next)
    if (selectedParticipantId === id && next[0]) {
      onSelectParticipant(next[0].id)
    }
  }

  const handleReorder = (sourceId: string, targetId: string | null): void => {
    setDragId(null)
    setDragOverId(null)
    if (isRoundRunning) return
    if (!targetId || sourceId === targetId) return
    const fromIdx = participants.findIndex((p) => p.id === sourceId)
    const toIdx = participants.findIndex((p) => p.id === targetId)
    if (fromIdx === -1 || toIdx === -1) return
    const next = [...participants]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    persist(next)
  }

  // 1.0.4-AK2 — Work Session status strip. Renders ABOVE the chip
  // strip when a Work Session exists in any non-idle state so the
  // user always knows the round is running autonomously vs.
  // interactively. The strip surfaces the objective, current
  // budget consumption, elapsed/remaining time, and a Stop action.
  // Below-budget hops + statuses fall through with muted styling.
  const workSession = chat.ensemble?.workSession
  const workSessionStatus = workSession?.status
  const showWorkSessionStrip =
    workSession?.enabled &&
    (workSessionStatus === 'active' ||
      workSessionStatus === 'paused' ||
      workSessionStatus === 'completed' ||
      workSessionStatus === 'cancelled' ||
      workSessionStatus === 'limit_reached')

  // Elapsed / remaining time computed from startedAt + maxDurationMs.
  // Cached on the render to avoid jitter; the parent re-renders
  // every 30s while the strip is visible (cheap interval).
  const workSessionTime = (() => {
    if (!workSession?.startedAt) return null
    const started = new Date(workSession.startedAt).getTime()
    if (!Number.isFinite(started)) return null
    const elapsedMs = Math.max(0, Date.now() - started)
    const remainingMs = Math.max(0, (workSession.maxDurationMs || 0) - elapsedMs)
    return { elapsedMs, remainingMs }
  })()

  const formatDuration = (ms: number): string => {
    if (ms < 60_000) return `${Math.floor(ms / 1000)}s`
    const minutes = Math.floor(ms / 60_000)
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    const remMinutes = minutes % 60
    return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`
  }

  // Per-provider budget summary — picks the provider with the
  // highest usage so the strip shows the participant closest to
  // its cap. "Codex 8/38" reads more usefully than a sum.
  const workSessionBudget = (() => {
    if (!workSession) return null
    const entries = Object.entries(workSession.roundsUsed || {}).filter(
      ([, used]) => (used || 0) > 0
    )
    if (entries.length === 0) {
      return `0 / ${workSession.maxRoundsPerProvider}`
    }
    entries.sort((a, b) => (b[1] || 0) - (a[1] || 0))
    const [provider, used] = entries[0]
    return `${used} / ${workSession.maxRoundsPerProvider} (${provider})`
  })()

  const workSessionStatusLabel = (() => {
    switch (workSessionStatus) {
      case 'active':
        return '🎯 Working on'
      case 'paused':
        return '⏸ Paused'
      case 'completed':
        return '✓ Completed'
      case 'cancelled':
        return '✕ Stopped'
      case 'limit_reached':
        return '⏱ Limit reached'
      default:
        return '🎯 Work Session'
    }
  })()

  return (
    <div className="ensemble-above-row" role="region" aria-label="Ensemble participants">
      {showWorkSessionStrip && workSession && (
        <div
          className="work-session-strip"
          data-status={workSessionStatus}
          role="status"
          aria-live="polite"
        >
          <span className="work-session-strip-glyph" aria-hidden="true" />
          <span className="work-session-strip-objective" title={workSession.objective}>
            <strong>{workSessionStatusLabel}:</strong> {workSession.objective}
          </span>
          <span className="work-session-strip-meta">
            <span>Rounds {workSessionBudget}</span>
            {workSessionTime && (
              <span>
                {formatDuration(workSessionTime.elapsedMs)} elapsed ·{' '}
                {formatDuration(workSessionTime.remainingMs)} left
              </span>
            )}
          </span>
          {workSessionStatus === 'active' || workSessionStatus === 'paused' ? (
            <span className="work-session-strip-actions">
              <button
                type="button"
                className="work-session-strip-action work-session-strip-action--stop"
                onClick={() => onStopWorkSession?.()}
                disabled={!onStopWorkSession}
                title="Stop the Work Session and cancel any queued continuations."
              >
                Stop
              </button>
            </span>
          ) : (
            workSession.endedReason && (
              <span className="work-session-strip-meta" title={workSession.endedReason}>
                <em>{workSession.endedReason}</em>
              </span>
            )
          )}
        </div>
      )}
      <div className="ensemble-above-row-chips">
        {participants.map((participant) => {
          const state = activeRound?.participants.find(
            (item) => item.participantId === participant.id
          )
          const active = activeRound?.activeParticipantId === participant.id
          const statusLabel = active ? 'speaking' : state?.status || 'idle'
          const isSelected = participant.id === selectedParticipantId
          // 1.0.4-AD — surface the pre-flight probe's failure reason
          // (or any subsequent failure reason stamped on the round
          // state) so the chip's status pill tooltip explains WHY a
          // participant is unreachable / failed without diving into
          // the transcript. Empty string when the round state has no
          // failure metadata so the chip falls back to the bare
          // status label.
          const lastFailureReason =
            state?.lastFailureReason || (state?.status === 'failed' ? state?.reason : '') || ''
          return (
            <ParticipantChip
              key={participant.id}
              participant={participant}
              statusLabel={statusLabel}
              statusTooltip={lastFailureReason}
              dimmed={!participant.enabled}
              isSelected={isSelected}
              isDragOver={dragOverId === participant.id && dragId !== participant.id}
              isDragging={dragId === participant.id}
              overflowOpen={overflowOpenId === participant.id}
              onClick={() => {
                onSelectParticipant(participant.id)
                // Clicking a different chip closes any open overflow.
                if (overflowOpenId && overflowOpenId !== participant.id) setOverflowOpenId(null)
              }}
              onToggleOverflow={() =>
                setOverflowOpenId((curr) => (curr === participant.id ? null : participant.id))
              }
              onCloseOverflow={() => setOverflowOpenId(null)}
              onPatch={(patch) => updateParticipant(participant.id, patch)}
              onRemove={() => removeParticipant(participant.id)}
              canRemove={participants.length > 1}
              locked={isRoundRunning}
              onDragStart={() => setDragId(participant.id)}
              onDragHover={(overId) => setDragOverId(overId)}
              onDragEnd={(droppedOnId) => handleReorder(participant.id, droppedOnId)}
            />
          )
        })}
        <button
          type="button"
          className="ensemble-above-add-participant"
          onClick={addParticipant}
          disabled={!canAddParticipant}
          title={
            isRoundRunning
              ? 'Participant changes are locked while a round is running.'
              : participants.length >= MAX_ENSEMBLE_PARTICIPANTS
                ? 'Ensembles support up to eight participants.'
                : 'Add another participant'
          }
          aria-label="Add Ensemble participant"
        >
          +
        </button>
      </div>
      <div className="ensemble-above-row-actions">
        {/* "Queued next round" label intentionally not rendered here —
            the queued-messages above-row (sibling in the composer
            above-bar stack) now surfaces ensemble `queuedPrompt`
            entries as a full row with Edit / Delete / Steer actions,
            so duplicating the bare label here would be noise. See
            `QueuedMessagesAboveRow.tsx` + the
            `queuedMessagesAboveRowEntries` builder in App.tsx for
            the ensemble-queued branch. */}
        {activeRound?.status === 'running' && activeRound.activeParticipantId && onSkipActive && (
          <button
            type="button"
            className="btn btn-sm btn-ghost ensemble-above-row-skip"
            onClick={onSkipActive}
            title="Skip the currently-speaking participant and let the round continue with the next one. The composer's Stop button still cancels the whole round."
          >
            Skip
          </button>
        )}
      </div>
    </div>
  )
}

interface ParticipantChipProps {
  participant: EnsembleParticipant
  statusLabel: string
  /**
   * 1.0.4-AD — optional human-readable explanation surfaced in the
   * status-pill `title` tooltip. Populated from the round state's
   * `lastFailureReason` for `unreachable` (and `failed`) participants
   * so the user sees, e.g. "Codex app-server probe timed out after
   * 1000ms" without opening the transcript. Empty string falls back
   * to the bare status label.
   */
  statusTooltip: string
  dimmed: boolean
  isSelected: boolean
  isDragOver: boolean
  isDragging: boolean
  overflowOpen: boolean
  onClick: () => void
  onToggleOverflow: () => void
  onCloseOverflow: () => void
  onPatch: (patch: Partial<EnsembleParticipant>) => void
  onRemove: () => void
  canRemove: boolean
  locked: boolean
  /**
   * Pointer-based drag callbacks (replaces HTML5 native drag).
   *
   * The HTML5 `draggable` attribute on a button — even one with a
   * working onClick handler — suppresses click events in Electron's
   * Chromium build. Tried wrapper-only draggable + button-only
   * draggable across two commits; both kept the symptom. Switched
   * to pointer events:
   *   - `pointerdown` on the chip starts a potential drag
   *   - if the pointer moves > 6px while held, it becomes a real
   *     drag (`onDragStart` fires)
   *   - `pointermove` updates the hover target via
   *     `document.elementFromPoint`
   *   - `pointerup` either fires `onClick` (pure tap, no movement)
   *     or `onDragEnd` with the chip id under the release point
   *     (a real drop)
   * Click events on the chip body now land reliably because no
   * native drag is competing for the pointer stream.
   */
  onDragStart: () => void
  onDragHover: (overParticipantId: string | null) => void
  onDragEnd: (droppedOnParticipantId: string | null) => void
}

function ParticipantChip({
  participant,
  statusLabel,
  statusTooltip,
  dimmed,
  isSelected,
  isDragOver,
  isDragging,
  overflowOpen,
  onClick,
  onToggleOverflow,
  onCloseOverflow,
  onPatch,
  onRemove,
  canRemove,
  locked,
  onDragStart,
  onDragHover,
  onDragEnd
}: ParticipantChipProps): React.JSX.Element {
  const chipRef = useRef<HTMLDivElement | null>(null)
  // Slug the status onto the class so CSS can colour-code the pill
  // (running=warm, yielded=amber, answered=green, cancelled=muted, etc.).
  const statusClass = `status-${statusLabel.toLowerCase().replace(/\s+/g, '-')}`
  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Left-click only. Right-click / middle-click fall through to
      // the browser default — no drag, no select.
      if (event.button !== 0) return
      // Don't start a drag when the user is clicking the overflow
      // affordance — the ⋯ button stops propagation on its own
      // pointerdown too, but a defensive check here keeps the drag
      // logic robust if anything between us mishandles the event.
      const target = event.target as HTMLElement
      if (target.closest('.ensemble-above-chip-overflow')) return
      if (locked) {
        onClick()
        return
      }

      const startX = event.clientX
      const startY = event.clientY
      let dragged = false
      let lastHoverId: string | null = null

      const findChipUnderPointer = (x: number, y: number): string | null => {
        const el = document.elementFromPoint(x, y) as HTMLElement | null
        const chip = el?.closest(
          '.ensemble-above-chip[data-participant-id]'
        ) as HTMLElement | null
        return chip?.getAttribute('data-participant-id') || null
      }

      const handleMove = (moveEvent: PointerEvent): void => {
        const dx = Math.abs(moveEvent.clientX - startX)
        const dy = Math.abs(moveEvent.clientY - startY)
        // 6px movement threshold — under this is a tap, over is a drag.
        // Same magnitude HTML5 native drag uses; feels right on a
        // trackpad without making intentional drags feel sluggish.
        if (!dragged && (dx > 6 || dy > 6)) {
          dragged = true
          onDragStart()
        }
        if (dragged) {
          const overId = findChipUnderPointer(moveEvent.clientX, moveEvent.clientY)
          if (overId !== lastHoverId) {
            lastHoverId = overId
            onDragHover(overId)
          }
        }
      }

      const handleUp = (upEvent: PointerEvent): void => {
        document.removeEventListener('pointermove', handleMove)
        document.removeEventListener('pointerup', handleUp)
        document.removeEventListener('pointercancel', handleUp)
        if (dragged) {
          const dropId = findChipUnderPointer(upEvent.clientX, upEvent.clientY)
          onDragEnd(dropId && dropId !== participant.id ? dropId : null)
        } else {
          // Pure tap: no significant movement → fire the click handler.
          onClick()
        }
      }

      document.addEventListener('pointermove', handleMove)
      document.addEventListener('pointerup', handleUp)
      document.addEventListener('pointercancel', handleUp)
    },
    [participant.id, onClick, onDragStart, onDragHover, onDragEnd]
  )

  return (
    <div
      ref={chipRef}
      data-participant-id={participant.id}
      data-linked-session={participant.linkedProviderSessionId ? 'true' : undefined}
      onPointerDown={handlePointerDown}
      className={`ensemble-above-chip provider-${participant.provider} ${isSelected ? 'is-selected' : ''} ${dimmed ? 'is-dimmed' : ''} ${isDragOver ? 'is-drag-over' : ''} ${isDragging ? 'is-dragging' : ''}`}
      // 1.0.4-AT1 — surface the participant's linked provider
      // session in the tooltip so the user can verify which thread
      // the next dispatch will resume against. Pre-AT1 there was
      // no chip-level signal at all; users had to dig into the
      // participant's detail popover to see linkage state.
      title={
        participant.linkedProviderSessionId
          ? `${getProviderName(participant.provider)} — ${participant.role || 'Participant'} · Linked session: ${participant.linkedProviderSessionId}`
          : `${getProviderName(participant.provider)} — ${participant.role || 'Participant'}`
      }
    >
      {/*
        Body is a `<div role="button">`, not a `<button>` element.
        Buttons + the surrounding pointerdown-based drag detection
        had subtle interactions (browser default mousedown handling
        on a button can interfere with capture-phase listeners),
        and a role-button div behaves identically for screen
        readers + keyboard while keeping the pointer pipeline
        completely under our control.
      */}
      <div
        className="ensemble-above-chip-body"
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onClick()
          }
        }}
      >
        <ProviderBadgeIcon provider={participant.provider} />
        <span className="ensemble-above-chip-role">{participant.role || getProviderName(participant.provider)}</span>
        <span
          className={`ensemble-above-chip-status ${statusClass}`}
          aria-label={statusTooltip ? `${statusLabel}: ${statusTooltip}` : statusLabel}
          title={statusTooltip ? `${statusLabel} — ${statusTooltip}` : statusLabel}
        >
          <ParticipantStatusIcon status={statusLabel} />
        </span>
      </div>
      {isSelected && (
        <button
          type="button"
          className="ensemble-above-chip-overflow"
          // Stop pointerdown propagation so the parent chip's drag
          // detection doesn't fire when the user is clicking ⋯.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onToggleOverflow()
          }}
          aria-haspopup="dialog"
          aria-expanded={overflowOpen}
          aria-label={`More options for ${getProviderName(participant.provider)}`}
          title="Toggle enabled / rename role"
        >
          ⋯
        </button>
      )}
      {overflowOpen && (
        <OverflowPopover
          anchor={chipRef.current}
          participant={participant}
          onPatch={onPatch}
          onRemove={onRemove}
          canRemove={canRemove}
          locked={locked}
          onClose={onCloseOverflow}
        />
      )}
    </div>
  )
}

interface OverflowPopoverProps {
  anchor: HTMLElement | null
  participant: EnsembleParticipant
  onPatch: (patch: Partial<EnsembleParticipant>) => void
  onRemove: () => void
  canRemove: boolean
  locked: boolean
  onClose: () => void
}

function OverflowPopover({
  anchor,
  participant,
  onPatch,
  onRemove,
  canRemove,
  locked,
  onClose
}: OverflowPopoverProps): React.JSX.Element | null {
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled || !anchor) return
      const rect = anchor.getBoundingClientRect()
      const flyoutWidth = 260
      const left = Math.max(8, Math.min(window.innerWidth - flyoutWidth - 8, rect.left))
      const top = rect.top - 8
      setPosition({ left, top })
    })
    return () => {
      cancelled = true
    }
  }, [anchor])

  useEffect(() => {
    const handleClick = (event: MouseEvent): void => {
      if (popoverRef.current?.contains(event.target as Node)) return
      // Clicking the overflow button itself toggles via onToggleOverflow;
      // don't double-fire by also closing on outside-click for that hit.
      const target = event.target as HTMLElement
      if (target.closest('.ensemble-above-chip-overflow')) return
      onClose()
    }
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick, true)
    document.addEventListener('keydown', handleKey, true)
    return () => {
      document.removeEventListener('mousedown', handleClick, true)
      document.removeEventListener('keydown', handleKey, true)
    }
  }, [onClose])

  if (!position) return null

  const content = (
    <div
      ref={popoverRef}
      className={`ensemble-above-overflow provider-${participant.provider}`}
      style={{
        position: 'fixed',
        left: `${position.left}px`,
        top: `${position.top}px`,
        transform: 'translateY(-100%)'
      }}
      role="dialog"
      aria-label={`Edit ${getProviderName(participant.provider)} role and enabled state`}
    >
      <label className="ensemble-above-overflow-enable">
        <input
          type="checkbox"
          checked={participant.enabled}
          disabled={locked}
          onChange={(event) => onPatch({ enabled: event.target.checked })}
        />
        <span>Enabled in ensemble rounds</span>
      </label>
      <label className="ensemble-above-overflow-role">
        <span className="ensemble-above-overflow-label">Role</span>
        <input
          type="text"
          value={participant.role}
          disabled={locked}
          onChange={(event) => onPatch({ role: event.target.value })}
          placeholder={`${getProviderName(participant.provider)} role`}
        />
      </label>
      <button
        type="button"
        className="ensemble-above-overflow-remove"
        onClick={onRemove}
        disabled={locked || !canRemove}
      >
        Remove participant
      </button>
      <p className="ensemble-above-overflow-hint">
        {locked
          ? 'Participant membership is locked while a round is running.'
          : 'Model, provider, reasoning, fast mode, and permissions live in the composer pickers below — they apply to the chip selected here.'}
      </p>
    </div>
  )

  return createPortal(content, document.body)
}

function nextParticipantId(participants: EnsembleParticipant[]): string {
  const existing = new Set(participants.map((participant) => participant.id))
  for (let index = participants.length + 1; index < participants.length + 32; index += 1) {
    const id = `ensemble-participant-${index}`
    if (!existing.has(id)) return id
  }
  return `ensemble-participant-${Date.now().toString(36)}`
}

function nextRoleLabel(baseRole: string, participants: EnsembleParticipant[]): string {
  const base = (baseRole || 'Participant').replace(/\s+\d+$/, '').trim() || 'Participant'
  const existing = new Set(
    participants.map((participant) => String(participant.role || '').trim().toLowerCase())
  )
  if (!existing.has(base.toLowerCase())) return base
  for (let index = 2; index < 32; index += 1) {
    const candidate = `${base} ${index}`
    if (!existing.has(candidate.toLowerCase())) return candidate
  }
  return `${base} ${participants.length + 1}`
}

/*
 * `defaultEnsembleParticipants()` + `defaultRole()` deleted in 1.0.3.
 * The main process owns ensemble defaults via `EnsembleDefaults.ts` —
 * the renderer had a parallel implementation here from Slice D when
 * the setup-sheet modal seeded its own state, but with that modal
 * retired in Slice F there are no consumers in the renderer. Default
 * shape is whatever `chatService.createEnsembleChat()` returns from
 * the main process.
 */
