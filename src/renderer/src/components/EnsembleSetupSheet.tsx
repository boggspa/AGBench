import { useMemo, useState } from 'react'
import type {
  ChatRecord,
  EnsembleParticipant,
  PermissionPresetId,
  ProviderId
} from '../../../main/store/types'
import { getProviderName, ProviderBadgeIcon } from './Sidebar'
import { CombinedModelPicker } from './CombinedModelPicker'
import { CombinedPermissionsPicker } from './CombinedPermissionsPicker'
import { getEnsembleModelDefaults } from '../lib/ensembleProviderDefaults'

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
          {participants.map((participant) => {
            const defaults = getEnsembleModelDefaults(participant.provider)
            const selectedModelId = participant.model || defaults.defaultModelId
            const selectedReasoning =
              participant.provider === 'kimi'
                ? participant.thinkingEnabled
                  ? 'on'
                  : 'off'
                : participant.reasoningEffort || defaults.defaultReasoning

            const handleModelSelect = (modelId: string) =>
              updateParticipant(participant.provider, {
                model: modelId,
                // Drop fast-mode if the new model doesn't support it,
                // so the persisted flag never outlives applicability.
                ...(defaults.fastModeCapableModelIds.has(modelId)
                  ? {}
                  : { fastModeEnabled: false, serviceTier: '' })
              })

            const handleReasoningSelect = (value: string) => {
              if (participant.provider === 'kimi') {
                updateParticipant(participant.provider, { thinkingEnabled: value !== 'off' })
              } else {
                updateParticipant(participant.provider, { reasoningEffort: value })
              }
            }

            const handleToggleFast =
              participant.provider === 'codex' || participant.provider === 'claude'
                ? () => {
                    const next = !participant.fastModeEnabled
                    updateParticipant(participant.provider, {
                      fastModeEnabled: next,
                      ...(participant.provider === 'codex'
                        ? { serviceTier: next ? 'fast' : '' }
                        : {})
                    })
                  }
                : undefined

            const permissionOptions = PRESETS.map((preset) => ({
              value: preset.id,
              label: preset.label
            }))

            return (
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
                  className="ensemble-setup-role-input"
                  value={participant.role}
                  onChange={(event) =>
                    updateParticipant(participant.provider, { role: event.target.value })
                  }
                  aria-label={`${getProviderName(participant.provider)} role`}
                  placeholder="Role"
                />
                <div className="ensemble-setup-picker-cell">
                  <CombinedModelPicker
                    provider={participant.provider}
                    composerStyle="modular"
                    modelOptions={defaults.modelOptions}
                    selectedModelId={selectedModelId}
                    onSelectModel={handleModelSelect}
                    reasoningOptions={defaults.reasoningOptions}
                    selectedReasoning={selectedReasoning}
                    onSelectReasoning={handleReasoningSelect}
                    codexReasoningEffort={
                      participant.provider === 'codex'
                        ? participant.reasoningEffort || defaults.defaultReasoning
                        : undefined
                    }
                    claudeReasoningEffort={
                      participant.provider === 'claude'
                        ? participant.reasoningEffort || defaults.defaultReasoning
                        : undefined
                    }
                    kimiThinkingEnabled={
                      participant.provider === 'kimi' ? Boolean(participant.thinkingEnabled) : undefined
                    }
                    fastModeCapableModelIds={defaults.fastModeCapableModelIds}
                    fastModeEnabled={Boolean(participant.fastModeEnabled)}
                    onToggleFastMode={handleToggleFast}
                    disabled={!participant.enabled}
                  />
                </div>
                <div className="ensemble-setup-picker-cell">
                  <CombinedPermissionsPicker
                    provider={participant.provider}
                    composerStyle="modular"
                    permissionOptions={permissionOptions}
                    selectedPermission={participant.permissionPresetId || 'default'}
                    onSelectPermission={(value) =>
                      updateParticipant(participant.provider, {
                        permissionPresetId: value as PermissionPresetId
                      })
                    }
                    grantServices={[]}
                    enabledGrantIds={new Set()}
                    agenticServices={{
                      shellCommands: 'ask',
                      fileChanges: 'ask',
                      mcpTools: 'ask',
                      subThreadDelegation: 'ask',
                      networkAccess: 'allow'
                    }}
                    onToggleGrant={() => {}}
                    disabled={!participant.enabled}
                  />
                </div>
                <input
                  className="ensemble-setup-order-input"
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
              </div>
            )
          })}
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
  return PROVIDERS.map((provider, index) => {
    const defaults = getEnsembleModelDefaults(provider)
    return {
      id: `ensemble-${provider}`,
      provider,
      enabled: provider === 'claude' || provider === 'codex',
      role: defaultRole(provider),
      instructions: '',
      order: index + 1,
      model: defaults.defaultModelId,
      permissionPresetId: provider === 'codex' ? 'workspace_write' : 'read_only',
      ...byProvider.get(provider)
    }
  })
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
