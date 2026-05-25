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

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  ChatRecord,
  EnsembleParticipant
} from '../../../main/store/types'
import { getProviderName, ProviderBadgeIcon } from './Sidebar'

interface EnsembleParticipantsAboveRowProps {
  chat: ChatRecord
  selectedParticipantId: string | null
  onSelectParticipant: (id: string) => void
  onChatChange: (next: ChatRecord) => void
  onStop?: () => void
}

export function EnsembleParticipantsAboveRow({
  chat,
  selectedParticipantId,
  onSelectParticipant,
  onChatChange,
  onStop
}: EnsembleParticipantsAboveRowProps): React.JSX.Element | null {
  if (chat.chatKind !== 'ensemble' || !chat.ensemble) return null

  const participants = [...(chat.ensemble.participants || [])].sort((a, b) => a.order - b.order)
  const activeRound = chat.ensemble.activeRound

  const [overflowOpenId, setOverflowOpenId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const updateParticipant = (id: string, patch: Partial<EnsembleParticipant>): void => {
    const next = participants.map((p) => (p.id === id ? { ...p, ...patch } : p))
    persist(next)
  }

  const persist = (nextParticipants: EnsembleParticipant[]): void => {
    onChatChange({
      ...chat,
      ensemble: {
        ...chat.ensemble!,
        participants: nextParticipants.map((p, idx) => ({ ...p, order: idx + 1 })),
        updatedAt: new Date().toISOString()
      }
    })
  }

  const handleDrop = (targetId: string): void => {
    if (!dragId || dragId === targetId) {
      setDragId(null)
      setDragOverId(null)
      return
    }
    const fromIdx = participants.findIndex((p) => p.id === dragId)
    const toIdx = participants.findIndex((p) => p.id === targetId)
    if (fromIdx === -1 || toIdx === -1) {
      setDragId(null)
      setDragOverId(null)
      return
    }
    const next = [...participants]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    persist(next)
    setDragId(null)
    setDragOverId(null)
  }

  return (
    <div className="ensemble-above-row" role="region" aria-label="Ensemble participants">
      <div className="ensemble-above-row-chips">
        {participants.map((participant) => {
          const state = activeRound?.participants.find(
            (item) => item.participantId === participant.id
          )
          const active = activeRound?.activeParticipantId === participant.id
          const statusLabel = active ? 'speaking' : state?.status || 'idle'
          const isSelected = participant.id === selectedParticipantId
          return (
            <ParticipantChip
              key={participant.id}
              participant={participant}
              statusLabel={statusLabel}
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
              onDragStart={() => setDragId(participant.id)}
              onDragEnter={() => setDragOverId(participant.id)}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
              }}
              onDrop={() => handleDrop(participant.id)}
              onDragEnd={() => {
                setDragId(null)
                setDragOverId(null)
              }}
            />
          )
        })}
      </div>
      <div className="ensemble-above-row-actions">
        {activeRound?.status === 'running' && activeRound.queuedPrompt && (
          <span className="ensemble-above-row-queued" title={activeRound.queuedPrompt}>
            Queued next round
          </span>
        )}
        {activeRound?.status === 'running' && onStop && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onStop}>
            Stop Ensemble
          </button>
        )}
      </div>
    </div>
  )
}

interface ParticipantChipProps {
  participant: EnsembleParticipant
  statusLabel: string
  dimmed: boolean
  isSelected: boolean
  isDragOver: boolean
  isDragging: boolean
  overflowOpen: boolean
  onClick: () => void
  onToggleOverflow: () => void
  onCloseOverflow: () => void
  onPatch: (patch: Partial<EnsembleParticipant>) => void
  onDragStart: () => void
  onDragEnter: () => void
  onDragOver: (event: React.DragEvent) => void
  onDrop: () => void
  onDragEnd: () => void
}

function ParticipantChip({
  participant,
  statusLabel,
  dimmed,
  isSelected,
  isDragOver,
  isDragging,
  overflowOpen,
  onClick,
  onToggleOverflow,
  onCloseOverflow,
  onPatch,
  onDragStart,
  onDragEnter,
  onDragOver,
  onDrop,
  onDragEnd
}: ParticipantChipProps): React.JSX.Element {
  const chipRef = useRef<HTMLDivElement | null>(null)
  // Slug the status onto the class so CSS can colour-code the pill
  // (running=warm, yielded=amber, answered=green, cancelled=muted, etc.).
  const statusClass = `status-${statusLabel.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <div
      ref={chipRef}
      draggable
      data-participant-id={participant.id}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', participant.id)
        onDragStart()
      }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`ensemble-above-chip provider-${participant.provider} ${isSelected ? 'is-selected' : ''} ${dimmed ? 'is-dimmed' : ''} ${isDragOver ? 'is-drag-over' : ''} ${isDragging ? 'is-dragging' : ''}`}
      title={`${getProviderName(participant.provider)} — ${participant.role || 'Participant'}`}
    >
      <button
        type="button"
        className="ensemble-above-chip-body"
        onClick={onClick}
        aria-pressed={isSelected}
      >
        <ProviderBadgeIcon provider={participant.provider} />
        <span className="ensemble-above-chip-role">{participant.role || getProviderName(participant.provider)}</span>
        <span className={`ensemble-above-chip-status ${statusClass}`}>{statusLabel}</span>
      </button>
      {isSelected && (
        <button
          type="button"
          className="ensemble-above-chip-overflow"
          onClick={onToggleOverflow}
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
  onClose: () => void
}

function OverflowPopover({
  anchor,
  participant,
  onPatch,
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
          onChange={(event) => onPatch({ enabled: event.target.checked })}
        />
        <span>Enabled in ensemble rounds</span>
      </label>
      <label className="ensemble-above-overflow-role">
        <span className="ensemble-above-overflow-label">Role</span>
        <input
          type="text"
          value={participant.role}
          onChange={(event) => onPatch({ role: event.target.value })}
          placeholder={`${getProviderName(participant.provider)} role`}
        />
      </label>
      <p className="ensemble-above-overflow-hint">
        Model, reasoning, fast mode, and permissions live in the composer pickers below — they
        apply to the chip selected here.
      </p>
    </div>
  )

  return createPortal(content, document.body)
}

/**
 * Default-populate every ensemble chat with all four providers
 * enabled. Slice F (1.0.3) — previously only Claude + Codex were
 * default-on; Chris's ship-night locked rule is "all four on, user
 * disables via the chip overflow if they want a subset."
 */
export function defaultEnsembleParticipants(): EnsembleParticipant[] {
  const PROVIDERS = ['claude', 'codex', 'gemini', 'kimi'] as const
  return PROVIDERS.map((provider, index) => ({
    id: `ensemble-${provider}`,
    provider,
    enabled: true,
    role: defaultRole(provider),
    instructions: '',
    order: index + 1,
    model: 'cli-default',
    permissionPresetId: provider === 'codex' ? 'workspace_write' : 'read_only'
  }))
}

function defaultRole(provider: string): string {
  if (provider === 'codex') return 'Worker'
  if (provider === 'gemini') return 'Researcher'
  if (provider === 'kimi') return 'Reviewer'
  return 'Explorer'
}
