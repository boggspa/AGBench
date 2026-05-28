import type {
  ChatRecord,
  EnsembleConfig,
  EnsembleParticipant,
  ProviderId,
  SessionActivityLedgerEntry
} from '../../../main/store/types'

const SESSION_ACTIVITY_LEDGER_LIMIT = 40

const PROVIDER_LABELS: Record<ProviderId, string> = {
  codex: 'Codex',
  claude: 'Claude',
  gemini: 'Gemini',
  kimi: 'Kimi',
  grok: 'Grok'
}

export function withSessionActivityLedger(
  previous: ChatRecord,
  next: ChatRecord,
  changedBy: SessionActivityLedgerEntry['changedBy'] = 'user'
): ChatRecord {
  if (!previous.ensemble || !next.ensemble) return next
  const entries = collectSessionActivityEntries(previous, next, changedBy)
  if (entries.length === 0) return next
  return {
    ...next,
    ensemble: appendSessionActivityEntries(next.ensemble, entries)
  }
}

export function appendSessionActivityEntries(
  ensemble: EnsembleConfig,
  entries: SessionActivityLedgerEntry[]
): EnsembleConfig {
  if (entries.length === 0) return ensemble
  const prior = ensemble.sessionActivityLedger || []
  return {
    ...ensemble,
    sessionActivityLedger: [...prior, ...entries].slice(-SESSION_ACTIVITY_LEDGER_LIMIT)
  }
}

function collectSessionActivityEntries(
  previous: ChatRecord,
  next: ChatRecord,
  changedBy: SessionActivityLedgerEntry['changedBy']
): SessionActivityLedgerEntry[] {
  const entries: SessionActivityLedgerEntry[] = []
  const add = (entry: Omit<SessionActivityLedgerEntry, 'id' | 'timestamp' | 'changedBy'>) => {
    entries.push({
      id: nextSessionActivityId(),
      timestamp: new Date().toISOString(),
      changedBy,
      ...entry
    })
  }

  if (previous.scope !== next.scope || previous.workspacePath !== next.workspacePath) {
    add({
      scope: 'session',
      target: 'workspace',
      oldValue: previous.workspacePath || previous.scope || null,
      newValue: next.workspacePath || next.scope || null,
      reason:
        next.workspacePath === previous.workspacePath
          ? 'Workspace scope changed for this Ensemble chat.'
          : 'Workspace binding changed for this Ensemble chat.'
    })
  }

  const previousParticipants = new Map(
    previous.ensemble!.participants.map((participant) => [participant.id, participant])
  )
  const nextParticipants = new Map(
    next.ensemble!.participants.map((participant) => [participant.id, participant])
  )

  for (const [id, participant] of nextParticipants) {
    const before = previousParticipants.get(id)
    if (!before) {
      add({
        scope: 'participant',
        target: id,
        oldValue: null,
        newValue: participantLabel(participant),
        reason: 'Participant added to the Ensemble roster.'
      })
      continue
    }
    if (before.provider !== participant.provider || normalizedRole(before) !== normalizedRole(participant)) {
      add({
        scope: 'participant',
        target: id,
        oldValue: participantLabel(before),
        newValue: participantLabel(participant),
        reason:
          before.provider !== participant.provider
            ? 'Participant provider changed.'
            : 'Participant role/name changed.'
      })
    }
    if (before.enabled !== participant.enabled) {
      add({
        scope: 'participant',
        target: participantLabel(participant),
        oldValue: before.enabled ? 'enabled' : 'disabled',
        newValue: participant.enabled ? 'enabled' : 'disabled',
        reason: 'Participant availability changed.'
      })
    }
    if ((before.permissionPresetId || '') !== (participant.permissionPresetId || '')) {
      add({
        scope: 'participant',
        target: `${participantLabel(participant)} permission preset`,
        oldValue: before.permissionPresetId || null,
        newValue: participant.permissionPresetId || null,
        reason: 'Participant permission preset changed.'
      })
    }
    if ((before.instructions || '').trim() !== (participant.instructions || '').trim()) {
      add({
        scope: 'participant',
        target: `${participantLabel(participant)} instructions`,
        oldValue: before.instructions?.trim() ? 'custom instructions' : null,
        newValue: participant.instructions?.trim() ? 'custom instructions' : null,
        reason: 'Participant role instructions changed.'
      })
    }
  }

  for (const [id, participant] of previousParticipants) {
    if (nextParticipants.has(id)) continue
    add({
      scope: 'participant',
      target: id,
      oldValue: participantLabel(participant),
      newValue: null,
      reason: 'Participant removed from the Ensemble roster.'
    })
  }

  const oldMode = previous.ensemble!.orchestrationMode || 'turn_bound'
  const newMode = next.ensemble!.orchestrationMode || 'turn_bound'
  if (oldMode !== newMode) {
    add({
      scope: 'session',
      target: 'orchestration mode',
      oldValue: oldMode,
      newValue: newMode,
      reason: 'Ensemble turn policy changed.'
    })
  }

  const oldWorkSessionStatus = previous.ensemble!.workSession?.status || 'idle'
  const newWorkSessionStatus = next.ensemble!.workSession?.status || 'idle'
  if (oldWorkSessionStatus !== newWorkSessionStatus) {
    add({
      scope: 'session',
      target: 'work session',
      oldValue: oldWorkSessionStatus,
      newValue: newWorkSessionStatus,
      reason: 'Work Session status changed.'
    })
  }

  return entries
}

function participantLabel(participant: EnsembleParticipant): string {
  return `${PROVIDER_LABELS[participant.provider] || participant.provider} / ${
    normalizedRole(participant) || 'Participant'
  }`
}

function normalizedRole(participant: EnsembleParticipant): string {
  return String(participant.role || '').trim()
}

function nextSessionActivityId(): string {
  return `session-event-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
