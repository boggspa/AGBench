import { useMemo, useState } from 'react'
import type {
  ChatRecord,
  EnsembleParticipant,
  PermissionPresetId,
  ProviderId
} from '../../../main/store/types'
import { getProviderName, ProviderBadgeIcon } from './Sidebar'

const PROVIDERS: ProviderId[] = ['claude', 'codex', 'gemini', 'kimi']
const PRESETS: Array<{ id: PermissionPresetId; label: string }> = [
  { id: 'read_only', label: 'Read only' },
  { id: 'default', label: 'Default' },
  { id: 'workspace_write', label: 'Workspace write' },
  { id: 'full_access', label: 'Full access' }
]

interface EnsembleSetupSheetProps {
  chat: ChatRecord
  onClose: () => void
  onSave: (chat: ChatRecord) => void
}

export function EnsembleSetupSheet({ chat, onClose, onSave }: EnsembleSetupSheetProps) {
  const initialParticipants = useMemo(
    () => normalizeParticipants(chat.ensemble?.participants || []),
    [chat.ensemble?.participants]
  )
  const [participants, setParticipants] = useState(initialParticipants)

  if (chat.chatKind !== 'ensemble' || !chat.ensemble) return null

  const updateParticipant = (provider: ProviderId, patch: Partial<EnsembleParticipant>) => {
    setParticipants((current) =>
      current.map((participant) =>
        participant.provider === provider ? { ...participant, ...patch } : participant
      )
    )
  }

  const save = () => {
    onSave({
      ...chat,
      ensemble: {
        ...chat.ensemble!,
        participants: participants
          .map((participant, index) => ({ ...participant, order: normalizeOrder(participant.order, index) }))
          .sort((a, b) => a.order - b.order),
        updatedAt: new Date().toISOString()
      }
    })
    onClose()
  }

  return (
    <div className="modal-overlay ensemble-setup-overlay" role="presentation">
      <div className="modal-card ensemble-setup-sheet" role="dialog" aria-modal="true">
        <div className="modal-header">
          <div>
            <h2>New Ensemble</h2>
            <p>Configure the participants for this transcript.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose}>
            x
          </button>
        </div>
        <div className="ensemble-setup-table">
          {participants.map((participant) => (
            <div key={participant.provider} className="ensemble-setup-row">
              <label className="ensemble-provider-toggle">
                <input
                  type="checkbox"
                  checked={participant.enabled}
                  onChange={(event) =>
                    updateParticipant(participant.provider, { enabled: event.target.checked })
                  }
                />
                <ProviderBadgeIcon provider={participant.provider} />
                <span>{getProviderName(participant.provider)}</span>
              </label>
              <input
                value={participant.role}
                onChange={(event) =>
                  updateParticipant(participant.provider, { role: event.target.value })
                }
                aria-label={`${getProviderName(participant.provider)} role`}
              />
              <input
                value={participant.model || 'cli-default'}
                onChange={(event) =>
                  updateParticipant(participant.provider, { model: event.target.value })
                }
                aria-label={`${getProviderName(participant.provider)} model`}
              />
              <input
                type="number"
                min={1}
                max={4}
                value={participant.order}
                onChange={(event) =>
                  updateParticipant(participant.provider, {
                    order: Number.parseInt(event.target.value, 10) || participant.order
                  })
                }
                aria-label={`${getProviderName(participant.provider)} order`}
              />
              <select
                value={participant.permissionPresetId || 'default'}
                onChange={(event) =>
                  updateParticipant(participant.provider, {
                    permissionPresetId: event.target.value as PermissionPresetId
                  })
                }
                aria-label={`${getProviderName(participant.provider)} permissions`}
              >
                {PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

function normalizeParticipants(participants: EnsembleParticipant[]): EnsembleParticipant[] {
  const byProvider = new Map(participants.map((participant) => [participant.provider, participant]))
  return PROVIDERS.map((provider, index) => ({
    id: `ensemble-${provider}`,
    provider,
    enabled: provider === 'claude' || provider === 'codex',
    role: defaultRole(provider),
    instructions: '',
    order: index + 1,
    model: 'cli-default',
    permissionPresetId: provider === 'codex' ? 'workspace_write' : 'read_only',
    ...byProvider.get(provider)
  }))
}

function normalizeOrder(order: number, fallbackIndex: number): number {
  return Number.isFinite(order) ? Math.min(4, Math.max(1, order)) : fallbackIndex + 1
}

function defaultRole(provider: ProviderId): string {
  if (provider === 'codex') return 'Worker'
  if (provider === 'gemini') return 'Researcher'
  if (provider === 'kimi') return 'Reviewer'
  return 'Explorer'
}

