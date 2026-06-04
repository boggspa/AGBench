export const createAppRunId = (): string => `${Date.now()}-${Math.random().toString(36).slice(2)}`

// Collision-proof chat-message id. `Date.now().toString()` collides when two
// messages are minted in the same millisecond (e.g. a streamed assistant
// bubble and its tool row, or back-to-back error/system messages). Duplicate
// ids break the React list key `message-block-${msg.id}` (reconciliation
// glitches / visual duplication) and the `chat-updated` dedup-by-id merge
// (which can append a duplicate assistant bubble). The monotonic counter
// guarantees uniqueness within a session; the Date.now() prefix keeps ids
// roughly time-ordered and unique across reloads.
let messageIdCounter = 0
export const createMessageId = (): string => `m${Date.now()}-${(messageIdCounter += 1)}`
