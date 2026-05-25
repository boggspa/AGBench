/*
 * EnsembleParticipantsAboveRow — 1.0.3 ship-night rework.
 *
 * Replaces the bottom-pinned `EnsembleSetupSheet` modal AND the
 * top-of-chat `EnsembleParticipantStrip`, consolidating both into a
 * single composer above-row that sits below the existing file-changes
 * + Create PR row and above the composer textarea.
 *
 * Each participant renders as a chip: provider icon + role + status.
 *   - Click → opens a per-participant flyout with all settings:
 *     enabled, role, model, reasoning, fast-mode (when capable),
 *     permission preset. Visual language matches the composer's
 *     CombinedModelPicker / CombinedPermissionsPicker popovers so
 *     the surface reads as one consistent picker family.
 *   - Drag-and-drop the chips to reorder. The new order is the
 *     order participants speak in. Persists via the same onSave
 *     callback the old modal used.
 *   - "Disabled" participants render dimmed but still visible; the
 *     user toggles them back on inside their own flyout.
 *
 * Persistence is inline: every edit calls `onChatChange` with an
 * updated chat record. No explicit Save button.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  ChatRecord,
  EnsembleParticipant,
  PermissionPresetId,
  ProviderId
} from '../../../main/store/types'
import { getProviderName, ProviderBadgeIcon } from './Sidebar'
import { getEnsembleModelDefaults } from '../lib/ensembleProviderDefaults'

const PRESETS: Array<{ id: PermissionPresetId; label: string }> = [
  { id: 'read_only', label: 'Read only' },
  { id: 'default', label: 'Default' },
  { id: 'workspace_write', label: 'Workspace write' },
  { id: 'full_access', label: 'Full access' }
]

interface EnsembleParticipantsAboveRowProps {
  chat: ChatRecord
  onChatChange: (next: ChatRecord) => void
  onStop?: () => void
}

export function EnsembleParticipantsAboveRow({
  chat,
  onChatChange,
  onStop
}: EnsembleParticipantsAboveRowProps): React.JSX.Element | null {
  if (chat.chatKind !== 'ensemble' || !chat.ensemble) return null

  const participants = useMemo(
    () => [...(chat.ensemble?.participants || [])].sort((a, b) => a.order - b.order),
    [chat.ensemble?.participants]
  )
  const activeRound = chat.ensemble.activeRound

  const [openParticipantId, setOpenParticipantId] = useState<string | null>(null)
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
          return (
            <ParticipantChip
              key={participant.id}
              participant={participant}
              statusLabel={statusLabel}
              dimmed={!participant.enabled}
              isDragOver={dragOverId === participant.id && dragId !== participant.id}
              isDragging={dragId === participant.id}
              onClick={() =>
                setOpenParticipantId((curr) => (curr === participant.id ? null : participant.id))
              }
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
      {openParticipantId && (
        <ParticipantFlyout
          participant={participants.find((p) => p.id === openParticipantId)!}
          onChange={(patch) => updateParticipant(openParticipantId, patch)}
          onClose={() => setOpenParticipantId(null)}
        />
      )}
    </div>
  )
}

interface ParticipantChipProps {
  participant: EnsembleParticipant
  statusLabel: string
  dimmed: boolean
  isDragOver: boolean
  isDragging: boolean
  onClick: () => void
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
  isDragOver,
  isDragging,
  onClick,
  onDragStart,
  onDragEnter,
  onDragOver,
  onDrop,
  onDragEnd
}: ParticipantChipProps): React.JSX.Element {
  // Slug the status onto the class so CSS can colour-code the pill
  // (running=warm, yielded=amber, answered=green, cancelled=muted, etc.).
  const statusClass = `status-${statusLabel.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <button
      type="button"
      draggable
      data-participant-id={participant.id}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        // Firefox needs setData to actually start a drag.
        event.dataTransfer.setData('text/plain', participant.id)
        onDragStart()
      }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`ensemble-above-chip provider-${participant.provider} ${dimmed ? 'is-dimmed' : ''} ${isDragOver ? 'is-drag-over' : ''} ${isDragging ? 'is-dragging' : ''}`}
      title={`${getProviderName(participant.provider)} — ${participant.role || 'Participant'}`}
    >
      <ProviderBadgeIcon provider={participant.provider} />
      <span className="ensemble-above-chip-role">{participant.role || getProviderName(participant.provider)}</span>
      <span className={`ensemble-above-chip-status ${statusClass}`}>{statusLabel}</span>
    </button>
  )
}

interface ParticipantFlyoutProps {
  participant: EnsembleParticipant
  onChange: (patch: Partial<EnsembleParticipant>) => void
  onClose: () => void
}

function ParticipantFlyout({
  participant,
  onChange,
  onClose
}: ParticipantFlyoutProps): React.JSX.Element {
  const flyoutRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  const defaults = getEnsembleModelDefaults(participant.provider)
  const modelId = participant.model || defaults.defaultModelId
  const reasoning =
    participant.provider === 'kimi'
      ? participant.thinkingEnabled
        ? 'on'
        : 'off'
      : participant.reasoningEffort || defaults.defaultReasoning
  const fastCapable = defaults.fastModeCapableModelIds.has(modelId)
  const fastSupported = defaults.fastModeCapableModelIds.size > 0

  // Anchor the flyout above the chip the user clicked. We target by
  // `data-participant-id` so the lookup stays exact even if multiple
  // ensemble chats ever render simultaneously (today there's only one
  // visible, but the participant.id is unique across the app and
  // future-proofs us against the provider-class approach grabbing
  // the wrong chip). CSS.escape() guards against any participant ids
  // that happen to contain selector-meaningful characters.
  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      const trigger = document.querySelector<HTMLButtonElement>(
        `.ensemble-above-chip[data-participant-id="${CSS.escape(participant.id)}"]`
      )
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const flyoutWidth = 340
      const left = Math.max(8, Math.min(window.innerWidth - flyoutWidth - 8, rect.left))
      const top = rect.top - 8
      setPosition({ left, top })
    })
    return () => {
      cancelled = true
    }
  }, [participant.id])

  // Close on Escape + click outside.
  useEffect(() => {
    const handleClick = (event: MouseEvent): void => {
      if (flyoutRef.current?.contains(event.target as Node)) return
      // Skip the chip itself — the chip's own onClick toggles the
      // flyout, so we don't want the outside-click to immediately
      // close what the click was meant to toggle.
      const target = event.target as HTMLElement
      if (target.closest('.ensemble-above-chip')) return
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

  if (!position) return <></>

  const handleModelChange = (nextModel: string): void => {
    const patch: Partial<EnsembleParticipant> = { model: nextModel }
    // Drop fast-mode if the new model can't support it so the
    // persisted flag never outlives its applicability.
    if (!defaults.fastModeCapableModelIds.has(nextModel)) {
      patch.fastModeEnabled = false
      patch.serviceTier = ''
    }
    onChange(patch)
  }

  const handleReasoningChange = (value: string): void => {
    if (participant.provider === 'kimi') {
      onChange({ thinkingEnabled: value !== 'off' })
    } else {
      onChange({ reasoningEffort: value })
    }
  }

  const toggleFastMode = (): void => {
    const next = !participant.fastModeEnabled
    onChange({
      fastModeEnabled: next,
      ...(participant.provider === 'codex' ? { serviceTier: next ? 'fast' : '' } : {})
    })
  }

  const content = (
    <div
      ref={flyoutRef}
      className={`ensemble-above-flyout provider-${participant.provider}`}
      style={{
        position: 'fixed',
        left: `${position.left}px`,
        top: `${position.top}px`,
        transform: 'translateY(-100%)'
      }}
      role="dialog"
      aria-label={`Configure ${getProviderName(participant.provider)} participant`}
    >
      <div className="ensemble-above-flyout-header">
        <span className="ensemble-above-flyout-title">
          <ProviderBadgeIcon provider={participant.provider} />
          {getProviderName(participant.provider)}
        </span>
        <label className="ensemble-above-flyout-enable">
          <input
            type="checkbox"
            checked={participant.enabled}
            onChange={(event) => onChange({ enabled: event.target.checked })}
          />
          Enabled
        </label>
      </div>

      <label className="ensemble-above-flyout-field">
        <span className="ensemble-above-flyout-label">Role</span>
        <input
          type="text"
          value={participant.role}
          onChange={(event) => onChange({ role: event.target.value })}
          placeholder="Role"
        />
      </label>

      <div className="ensemble-above-flyout-pair">
        <label className="ensemble-above-flyout-field">
          <span className="ensemble-above-flyout-label">Model</span>
          <select value={modelId} onChange={(event) => handleModelChange(event.target.value)}>
            {defaults.modelOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {defaults.reasoningOptions.length > 0 && (
          <label className="ensemble-above-flyout-field">
            <span className="ensemble-above-flyout-label">
              {participant.provider === 'kimi' ? 'Thinking' : 'Reasoning'}
            </span>
            <select
              value={reasoning}
              onChange={(event) => handleReasoningChange(event.target.value)}
            >
              {defaults.reasoningOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {fastSupported && (
        <label
          className={`ensemble-above-flyout-fast ${fastCapable ? '' : 'is-disabled'}`}
          title={
            fastCapable
              ? 'Fast tier — uses the paid Fast provider tier when on'
              : 'Selected model does not support Fast mode'
          }
        >
          <input
            type="checkbox"
            checked={Boolean(participant.fastModeEnabled)}
            disabled={!fastCapable}
            onChange={toggleFastMode}
          />
          <span>Fast mode</span>
        </label>
      )}

      <label className="ensemble-above-flyout-field">
        <span className="ensemble-above-flyout-label">Workspace permissions</span>
        <select
          value={participant.permissionPresetId || 'default'}
          onChange={(event) =>
            onChange({ permissionPresetId: event.target.value as PermissionPresetId })
          }
        >
          {PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>

      <p className="ensemble-above-flyout-hint">
        Drag chips left/right to change the order participants speak in. Tool grants for this
        provider live in Settings → Approvals.
      </p>
    </div>
  )

  return createPortal(content, document.body)
}

/**
 * Default-populate every ensemble chat with all four providers
 * enabled. Slice F (1.0.3) — previously only Claude + Codex were
 * default-on; Chris's ship-night locked rule is "all four on, user
 * disables via the chip flyout if they want a subset."
 */
export function defaultEnsembleParticipants(): EnsembleParticipant[] {
  const PROVIDERS: ProviderId[] = ['claude', 'codex', 'gemini', 'kimi']
  return PROVIDERS.map((provider, index) => {
    const defaults = getEnsembleModelDefaults(provider)
    return {
      id: `ensemble-${provider}`,
      provider,
      enabled: true,
      role: defaultRole(provider),
      instructions: '',
      order: index + 1,
      model: defaults.defaultModelId,
      permissionPresetId: provider === 'codex' ? 'workspace_write' : 'read_only'
    }
  })
}

function defaultRole(provider: ProviderId): string {
  if (provider === 'codex') return 'Worker'
  if (provider === 'gemini') return 'Researcher'
  if (provider === 'kimi') return 'Reviewer'
  return 'Explorer'
}
