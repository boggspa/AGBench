import { AgentIdentityContext } from './AgentMention'
import { StableMarkdownBlock } from './StableMarkdownBlock'
import { splitMarkdownIntoBlocks } from '../lib/MarkdownBlockSplit'
import type { ChatRecord } from '../../../main/store/types'

interface MarkdownMessageProps {
  content: string
  /** Chat used to look up subagent identities for `[@Name](agent://id)` chips. */
  chat?: ChatRecord
}

/**
 * MarkdownMessage — orchestrator for streaming-friendly markdown.
 *
 * Phase L1a refactor. The renderer is now block-aware:
 *
 *   1. We split `content` into stable blocks + an optional tail via
 *      `splitMarkdownIntoBlocks` (pure string scan, no mdast).
 *   2. Each stable block goes through `StableMarkdownBlock`, keyed by
 *      its content-hashed id. That subtree is `React.memo`'d on `raw`,
 *      so a parent re-render driven by `assistant_message_delta` only
 *      diffs the tail.
 *   3. The tail is rendered through the same memoised component, but
 *      its key (content hash) changes per keystroke — React unmounts
 *      the old tail and mounts a new one. The stable prefix survives
 *      unchanged.
 *
 * The output HTML is byte-for-byte identical to the pre-L1a renderer
 * for any complete (non-streaming) message — the existing snapshot
 * tests verify that. The win is paid for entirely by the streaming
 * path; for a 5K-token reply we go from N parses per delta (where N
 * is total token count) to roughly 1 parse per delta (just the tail).
 *
 * The `AgentIdentityContext.Provider` wraps the whole markdown subtree
 * so `<AgentMention>` chips in any block can look up the chat's
 * identity registry without prop drilling.
 */
export function MarkdownMessage({ content, chat }: MarkdownMessageProps) {
  const { stable, tail } = splitMarkdownIntoBlocks(content)
  return (
    <AgentIdentityContext.Provider value={chat}>
      <div className="message-markdown message-markdown-pro">
        {stable.map((block) => (
          <StableMarkdownBlock key={block.id} raw={block.raw} />
        ))}
        {tail ? <StableMarkdownBlock key={tail.id} raw={tail.raw} /> : null}
      </div>
    </AgentIdentityContext.Provider>
  )
}
