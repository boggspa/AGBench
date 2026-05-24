import type { ChatRecord, EnsembleParticipant } from '../../../main/store/types'
import { getProviderName, ProviderBadgeIcon } from './Sidebar'

interface EnsembleParticipantStripProps {
  chat: ChatRecord
  onConfigure: () => void
  onStop?: () => void
}

export function EnsembleParticipantStrip({
  chat,
  onConfigure,
  onStop
}: EnsembleParticipantStripProps) {
  if (chat.chatKind !== 'ensemble' || !chat.ensemble) return null
  const activeRound = chat.ensemble.activeRound
  const participants = (chat.ensemble.participants || [])
    .filter((participant) => participant.enabled)
    .sort((a, b) => a.order - b.order)
  return (
    <div className="ensemble-strip" role="region" aria-label="Ensemble participants">
      <div className="ensemble-strip-list">
        {participants.map((participant) => {
          const state = activeRound?.participants.find(
            (item) => item.participantId === participant.id
          )
          const active = activeRound?.activeParticipantId === participant.id
          return (
            <div
              key={participant.id}
              className={`ensemble-participant-chip provider-${participant.provider} ${active ? 'is-active' : ''}`}
              title={`${getProviderName(participant.provider)} / ${participant.role}`}
            >
              <ProviderBadgeIcon provider={participant.provider} />
              <span className="ensemble-participant-main">
                <span>{participant.role || getProviderName(participant.provider)}</span>
                <small>{formatParticipantUsage(participant)}</small>
              </span>
              <span className={`ensemble-participant-status status-${state?.status || 'idle'}`}>
                {active ? 'Speaking' : state?.status || 'Idle'}
              </span>
            </div>
          )
        })}
      </div>
      <div className="ensemble-strip-actions">
        {activeRound?.status === 'running' && activeRound.queuedPrompt && (
          <span className="ensemble-strip-queued" title={activeRound.queuedPrompt}>
            Queued next round
          </span>
        )}
        {activeRound?.status === 'running' && onStop && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onStop}>
            Stop Ensemble
          </button>
        )}
        <button type="button" className="btn btn-sm btn-ghost" onClick={onConfigure}>
          Configure
        </button>
      </div>
    </div>
  )
}

function formatParticipantUsage(participant: EnsembleParticipant): string {
  const total = participant.tokenTotals?.total_tokens
  if (!total || total <= 0) return getProviderName(participant.provider)
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M tokens`
  if (total >= 1_000) return `${Math.round(total / 100) / 10}k tokens`
  return `${total} tokens`
}
