import type { ChatMessage } from '../../../main/store/types'

export function isGuestParticipantReplyMessage(message: ChatMessage): boolean {
  return (
    (message.role === 'system' || message.role === 'tool') &&
    message.metadata?.kind === 'guestParticipantReply'
  )
}
