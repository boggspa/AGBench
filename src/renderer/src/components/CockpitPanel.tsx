import { compactPromptPreview, type RunLane } from '../lib/RunLanes'
import { getProviderLabel } from '../lib/providerLabels'
import type { HandoffCard, ProviderId } from '../../../main/store/types'

function CockpitPanel({
  lanes,
  handoffCards,
  onClose,
  onOpenThread,
  onCancelRun,
  onRetryRun,
  onDuplicateRun,
  onCreateHandoff,
  onDispatchHandoff,
  onArchiveHandoff
}: {
  lanes: RunLane[]
  handoffCards: HandoffCard[]
  onClose: () => void
  onOpenThread: (chatId?: string) => void
  onCancelRun: (lane: RunLane) => void
  onRetryRun: (lane: RunLane) => void
  onDuplicateRun: (lane: RunLane) => void
  onCreateHandoff: (lane: RunLane) => void
  onDispatchHandoff: (card: HandoffCard) => void
  onArchiveHandoff: (card: HandoffCard) => void
}) {
  const providerIds: ProviderId[] = ['gemini', 'codex', 'claude', 'kimi']
  const activeCount = lanes.filter((lane) => lane.phase === 'active').length
  const waitingCount = lanes.filter(
    (lane) => lane.phase === 'queued' || lane.phase === 'scheduled' || lane.phase === 'paused'
  ).length
  const failedCount = lanes.filter((lane) => lane.phase === 'failed').length
  const openHandoffs = handoffCards.filter((card) => card.status === 'draft')

  return (
    <div className="cockpit-overlay" role="dialog" aria-modal="true" aria-label="Agent cockpit">
      <div className="cockpit-panel">
        <div className="cockpit-header">
          <div>
            <span className="cockpit-kicker">AGBench cockpit</span>
            <h2>Run lanes</h2>
            <p>Global queue, profile, handoff, and workspace collision supervision.</p>
          </div>
          <button className="cockpit-close-btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="cockpit-metrics">
          <span>
            <strong>{activeCount}</strong> active
          </span>
          <span>
            <strong>{waitingCount}</strong> waiting
          </span>
          <span>
            <strong>{failedCount}</strong> failed
          </span>
          <span>
            <strong>{openHandoffs.length}</strong> handoffs
          </span>
        </div>
        <div className="cockpit-body">
          <div className="cockpit-lanes">
            {providerIds.map((provider) => {
              const providerLanes = lanes.filter((lane) => lane.provider === provider)
              return (
                <section key={provider} className={`cockpit-provider provider-${provider}`}>
                  <div className="cockpit-provider-header">
                    <strong>{getProviderLabel(provider)}</strong>
                    <span>
                      {providerLanes.filter((lane) => lane.phase === 'active').length}/1 running
                    </span>
                  </div>
                  {providerLanes.length === 0 ? (
                    <div className="cockpit-empty">No lanes.</div>
                  ) : (
                    providerLanes.map((lane) => (
                      <article key={lane.id} className={`cockpit-lane phase-${lane.phase}`}>
                        <div className="cockpit-lane-main">
                          <span className="cockpit-lane-phase">{lane.phase}</span>
                          <strong>{lane.chatTitle || lane.chatId || 'Untitled chat'}</strong>
                          <p>{lane.promptPreview || 'No prompt preview available.'}</p>
                        </div>
                        <div className="cockpit-lane-meta">
                          <span>{lane.runtimeProfileName || 'Default runtime'}</span>
                          {lane.workspacePath && (
                            <span title={lane.workspacePath}>
                              {lane.workspacePath.split(/[\\/]/).pop() || lane.workspacePath}
                            </span>
                          )}
                          {lane.blockedReason && <span>{lane.blockedReason}</span>}
                          {lane.conflictSummary && (
                            <span className="cockpit-conflict">{lane.conflictSummary}</span>
                          )}
                        </div>
                        <div className="cockpit-lane-actions">
                          <button
                            type="button"
                            onClick={() => onOpenThread(lane.chatId)}
                            disabled={!lane.chatId}
                          >
                            Open
                          </button>
                          <button
                            type="button"
                            onClick={() => onCancelRun(lane)}
                            disabled={
                              !lane.runId ||
                              (lane.phase !== 'active' &&
                                lane.phase !== 'queued' &&
                                lane.phase !== 'paused')
                            }
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => onRetryRun(lane)}
                            disabled={!lane.runId}
                          >
                            Retry
                          </button>
                          <button
                            type="button"
                            onClick={() => onDuplicateRun(lane)}
                            disabled={!lane.chatId}
                          >
                            Duplicate
                          </button>
                          <button
                            type="button"
                            onClick={() => onCreateHandoff(lane)}
                            disabled={!lane.runId || !lane.chatId}
                          >
                            Handoff
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </section>
              )
            })}
          </div>
          <aside className="cockpit-handoffs">
            <div className="cockpit-provider-header">
              <strong>User-mediated handoffs</strong>
              <span>{openHandoffs.length} draft</span>
            </div>
            {openHandoffs.length === 0 ? (
              <div className="cockpit-empty">
                Create a handoff from any completed or active run.
              </div>
            ) : (
              openHandoffs.map((card) => (
                <article key={card.id} className="cockpit-handoff-card">
                  <strong>{getProviderLabel(card.sourceProvider)} handoff</strong>
                  <p>{compactPromptPreview(card.summary || card.finalPrompt)}</p>
                  {card.selectedFiles.length > 0 && (
                    <span>{card.selectedFiles.length} file refs</span>
                  )}
                  <div className="cockpit-lane-actions">
                    <button type="button" onClick={() => onOpenThread(card.sourceChatId)}>
                      Source
                    </button>
                    <button type="button" onClick={() => onDispatchHandoff(card)}>
                      Dispatch
                    </button>
                    <button type="button" onClick={() => onArchiveHandoff(card)}>
                      Archive
                    </button>
                  </div>
                </article>
              ))
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

export { CockpitPanel }
