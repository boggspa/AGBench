import type {
  ChatRecord,
  EnsembleRoundMode,
  WorkSessionConfig
} from '../../../main/store/types'
import { withSessionActivityLedger } from './sessionActivityLedger'

export interface ApplyWorkSessionConfirmationInput {
  config: WorkSessionConfig
  roundMode: Exclude<EnsembleRoundMode, 'targeted'>
  synthesizerParticipantId?: string
}

export function applyWorkSessionConfirmation(
  source: ChatRecord,
  input: ApplyWorkSessionConfirmationInput,
  nowIso: string = new Date().toISOString()
): ChatRecord {
  if (!source.ensemble) return source
  const patched: ChatRecord = {
    ...source,
    ensemble: {
      ...source.ensemble,
      workSession: input.config,
      roundMode: input.roundMode,
      synthesizerParticipantId: input.synthesizerParticipantId,
      updatedAt: nowIso
    }
  }
  return withSessionActivityLedger(source, patched)
}

export function cancelWorkSessionOnChat(
  source: ChatRecord,
  nowIso: string = new Date().toISOString(),
  endedReason = 'Stopped by user.'
): ChatRecord {
  const session = source.ensemble?.workSession
  if (!source.ensemble || !session) return source
  const patched: ChatRecord = {
    ...source,
    ensemble: {
      ...source.ensemble,
      workSession: {
        ...session,
        status: 'cancelled',
        endedAt: nowIso,
        endedReason
      },
      updatedAt: nowIso
    }
  }
  return withSessionActivityLedger(source, patched)
}
