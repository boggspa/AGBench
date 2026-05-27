import type { ChatRecord, EnsembleParticipant, ProviderId } from '../../../main/store/types'

/**
 * 1.0.4-AT2 — runtime-profile-picker scope resolver for Ensemble
 * chats.
 *
 * Pre-AT2 the composer's runtime-profile picker was wired
 * exclusively to chat-level state (`selectedRuntimeProfileByChatId`)
 * and the chat's `currentProvider`. In an Ensemble chat the
 * picker effectively asked "what runtime profile should the
 * CHAT use?", which:
 *
 *   - showed runtime profiles for the chat-level provider only,
 *     not for the currently-selected participant's provider;
 *   - wrote selections back to chat-level state, so the per-
 *     participant `runtimeProfileId` (which IS what the
 *     dispatch payload uses, per
 *     `EnsembleOrchestrator.seedParticipantRun`) was never
 *     touched from the picker.
 *
 * The dispatch payload was already correct (each participant's
 * `runtimeProfileId` rides through to `runRound`); what was
 * missing was the UI surface to set it.
 *
 * This helper centralizes the scope decision so App.tsx can:
 *   - filter `runtimeProfiles` by `provider`
 *   - render `selectedRuntimeProfileId` as the picker's value
 *   - dispatch the picker's change event to the correct target
 *     (chat-level vs. participant-level write-through)
 *
 * Routing rule (mirrors the AT1 session-link routing):
 *   - Non-ensemble chat → chat-scoped picker
 *   - Ensemble chat, no selected participant → chat-scoped picker
 *   - Ensemble chat, selected participant exists → participant-
 *     scoped picker (regardless of provider — the picker offers
 *     the selected participant's provider's profiles)
 */

export interface RuntimePickerScope {
  /** Whether the picker should write/read at chat scope or
   * patch the selected participant. */
  target: 'chat' | 'participant'
  /** Provider whose runtime profiles the picker should show. In
   * `target: 'chat'` this is the chat's current provider; in
   * `target: 'participant'` it's the selected participant's
   * provider — they can differ when the chat-level provider
   * was set at a different turn than the participant's. */
  provider: ProviderId
  /** When `target: 'participant'`, the id of the participant the
   * picker writes to. Undefined for chat-scope routings. */
  participantId?: string
  /** The runtime profile id the picker should show as selected.
   * Reads from the participant's `runtimeProfileId` in
   * `target: 'participant'`, or from the chat-level selection
   * in `target: 'chat'`. Null means "no explicit selection — use
   * the provider default in the consuming component". */
  selectedRuntimeProfileId: string | null
}

export function resolveRuntimePickerScope(input: {
  chat: ChatRecord | null | undefined
  /** The chat-scoped fallback selection (from
   * `selectedRuntimeProfileByChatId[currentChatId]`). */
  chatLevelSelection: string | null
  /** Chat-level provider — used when the picker stays at chat
   * scope (no selected participant in Ensemble). */
  chatLevelProvider: ProviderId
  selectedParticipant: EnsembleParticipant | null | undefined
}): RuntimePickerScope {
  const { chat, chatLevelSelection, chatLevelProvider, selectedParticipant } = input

  if (!chat || chat.chatKind !== 'ensemble' || !selectedParticipant) {
    return {
      target: 'chat',
      provider: chatLevelProvider,
      selectedRuntimeProfileId: chatLevelSelection
    }
  }

  return {
    target: 'participant',
    participantId: selectedParticipant.id,
    provider: selectedParticipant.provider,
    selectedRuntimeProfileId: selectedParticipant.runtimeProfileId || null
  }
}
