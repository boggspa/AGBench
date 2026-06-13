import type { ChatMessage } from '../../../main/store/types'

/*
 * assistantDeltaTarget — interleaving-preserving routing for streamed
 * assistant text.
 *
 * A provider run interleaves assistant prose with tool bursts in stream
 * order (text → tool burst → more text → another burst). The transcript
 * must render those at their true positions: each contiguous text stretch
 * is its own bubble and each tool burst its own ActivityStack row, in
 * order. This mirrors the iOS streaming path (commit af91f0be, which
 * "seals a text segment at every tool_use/tool_call boundary") and the
 * MAIN bridge transcript assembly (`appendBridgeRunText`, which opens a
 * NEW text part whenever the last part is a tool burst).
 *
 * The earlier desktop handler scanned backward past tool messages and
 * merged every later text delta into the FIRST assistant bubble of the
 * turn. That clumped every tool burst above the response: text was pulled
 * up out of its position, so the array tail stayed a tool message and all
 * tools coalesced into one group. This helper restores the seal while
 * still letting a CUMULATIVE full-turn restatement (Claude's divergent
 * envelope, Cursor's snapshot frames) update its existing bubble in place
 * across an interleaved tool burst instead of appending a duplicate.
 *
 * The decision is purely a function of the current message list, so it is
 * unit-tested in isolation from the 20k-line App.tsx handler that calls it.
 */

export type AssistantDeltaTarget =
  /** Fold the incoming text into the existing assistant message at `index`
   *  (the caller still decides append vs replace vs skip for that bubble). */
  | { action: 'merge'; index: number }
  /** Start a NEW assistant message appended after the current tail. */
  | { action: 'append' }

interface ResolveAssistantDeltaTargetInput {
  /** The incoming delta/snapshot text. */
  incoming: string
  /** True when main tagged this as a full-turn cumulative restatement. */
  cumulative?: boolean
}

/**
 * Decide where an incoming `assistant_message_delta` should land.
 *
 * 1. Trailing assistant → that bubble (no tool burst since the last text;
 *    a genuine continuation or an in-place restatement).
 * 2. Trailing tool burst:
 *    - A CUMULATIVE full-turn restatement targets the nearest prior
 *      assistant (reached past the burst) so the snapshot replaces that
 *      bubble in place — appending would duplicate the whole turn. A
 *      restatement is the tagged `cumulative` envelope, OR an untagged
 *      snapshot that supersets (equals or extends) that bubble's content.
 *    - Otherwise the text is a genuine increment: the segment is sealed at
 *      the tool boundary, so append a NEW bubble AFTER the burst.
 *
 * Tool messages are NOT transparent to increments (unlike the prior
 * backward-scan): a tool between two text stretches is a real boundary,
 * exactly as the iOS stream and the bridge transcript treat it.
 */
export function resolveAssistantDeltaTarget(
  messages: ChatMessage[],
  input: ResolveAssistantDeltaTargetInput
): AssistantDeltaTarget {
  const lastIndex = messages.length - 1
  const last = lastIndex >= 0 ? messages[lastIndex] : null
  if (last && last.role === 'assistant') {
    return { action: 'merge', index: lastIndex }
  }

  // Trailing message is a tool burst (or there is no message). Only a
  // cumulative restatement may reach back across the burst to its bubble;
  // genuine increments seal here and start a fresh segment.
  let priorAssistantIdx = -1
  for (let i = lastIndex; i >= 0; i--) {
    const candidate = messages[i]
    if (candidate.role === 'assistant') {
      priorAssistantIdx = i
      break
    }
    if (candidate.role === 'tool') continue
    break
  }
  if (priorAssistantIdx >= 0) {
    const prior = messages[priorAssistantIdx]
    const isRestatement =
      input.cumulative === true ||
      (input.incoming.length >= prior.content.length && input.incoming.startsWith(prior.content))
    if (isRestatement) {
      return { action: 'merge', index: priorAssistantIdx }
    }
  }
  return { action: 'append' }
}
