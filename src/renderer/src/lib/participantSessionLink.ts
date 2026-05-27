import type { ChatRecord, EnsembleParticipant, ProviderId } from '../../../main/store/types'

/**
 * 1.0.4-AT1 — pure routing helper for `/resume` and `/fork`
 * threadId linkage in Ensemble chats.
 *
 * Pre-AT1 every `/resume <threadId>` and `/fork <threadId>` from
 * the composer wrote `linkedProviderSessionId` to the CHAT record,
 * regardless of whether the chat was a solo Codex chat or an
 * Ensemble round with a selected participant. That meant:
 *
 *  - Resuming a Codex thread inside an Ensemble where the active
 *    speaker was Codex#2 (a second Codex participant with its
 *    own role) silently rebound the chat-level session, not the
 *    participant's own `linkedProviderSessionId`. Next dispatch
 *    of Codex#2 would still use its old participant linkage, but
 *    the chat-level record was poisoned with a stale thread id
 *    that other code paths (sub-thread recall, transcript export)
 *    could pick up.
 *  - The user got no signal on the chip strip about which
 *    participants had a linked session vs. which were fresh.
 *
 * Routing rule (pure function so we can unit-test exhaustively):
 *
 *   - If chat is NOT an ensemble chat: route to chat.
 *   - If chat IS an ensemble chat but no participant is selected:
 *     route to chat (back-compat — the user explicitly invoked
 *     `/resume` without selecting a participant, so the chat-
 *     level fallback is the only sensible target).
 *   - If chat IS an ensemble chat AND a participant is selected
 *     AND that participant's provider matches the resume/fork
 *     provider: route to participant.
 *   - If chat IS an ensemble chat AND a participant is selected
 *     but the providers DON'T match: route to chat with a warning
 *     in the result. (Resuming a Codex thread while the selected
 *     participant is a Claude makes no sense; we don't silently
 *     bind the wrong provider's session to the participant.)
 */

export interface SessionLinkRoutingDecision {
  /** Where to write `linkedProviderSessionId`. */
  target: 'chat' | 'participant'
  /** When `target: 'participant'`, the id of the participant the
   * writer should patch. Undefined for chat-target routings. */
  participantId?: string
  /** Optional warning the caller should surface (raw-logs / toast)
   * to explain why an Ensemble request fell back to chat-level
   * routing. Used for the provider-mismatch case. */
  warning?: string
}

export function resolveSessionLinkRouting(input: {
  chat: ChatRecord | null | undefined
  provider: ProviderId
  selectedParticipant: EnsembleParticipant | null | undefined
}): SessionLinkRoutingDecision {
  const { chat, provider, selectedParticipant } = input

  // Non-ensemble (or no chat) — chat-level linkage. Same as
  // pre-AT1 behavior.
  if (!chat || chat.chatKind !== 'ensemble') {
    return { target: 'chat' }
  }

  // Ensemble chat with no selected participant. The composer is
  // still useful for ensemble-wide actions, and the user may have
  // typed `/resume <id>` without selecting a chip; chat-level
  // fallback keeps the gesture working.
  if (!selectedParticipant) {
    return { target: 'chat' }
  }

  // Selected participant's provider must match the resume/fork's
  // provider — otherwise we'd bind e.g. a Codex thread id to a
  // Claude participant, which the next dispatch would silently
  // ignore (different provider's session-id format) and confuse
  // the user.
  if (selectedParticipant.provider !== provider) {
    return {
      target: 'chat',
      warning:
        `Selected participant is ${selectedParticipant.provider}; ` +
        `cannot bind a ${provider} thread to it. Falling back to chat-level linkage.`
    }
  }

  return { target: 'participant', participantId: selectedParticipant.id }
}
