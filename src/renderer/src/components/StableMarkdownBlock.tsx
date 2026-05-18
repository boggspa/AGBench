import { memo, useState, type MouseEvent } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { HighlightedCodeBlock } from './HighlightedCodeBlock'
import { AgentMention } from './AgentMention'
import { classifyMarkdownLink } from '../lib/classifyMarkdownLink'
import type { ChatRecord } from '../../../main/store/types'

/*
 * StableMarkdownBlock — a `React.memo`'d wrapper that renders ONE
 * markdown block through `ReactMarkdown`. The point of this component
 * is shallow-equality short-circuit on `raw`. The streaming hot path
 * (assistant_message_delta) appends chars to the tail block, which
 * remounts (new key), while every block above it sees the same `raw`
 * prop and skips its render entirely.
 *
 * The `chat` prop is supplied via context by the parent
 * (`AgentIdentityContext.Provider` in `MarkdownMessage`), so we do NOT
 * include it in the memo equality. Including it would defeat the
 * short-circuit when the parent chat reference changes for unrelated
 * reasons (e.g. settings toggle).
 */

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Copy is best-effort; avoid adding noisy UI state inside streamed messages.
  }
}

function MarkdownCodeBlock({ content, language }: { content: string; language?: string }) {
  const [wrap, setWrap] = useState(false)
  const displayLanguage = language?.trim() || 'text'

  return (
    <div className={`message-code-shell ${wrap ? 'wrap' : ''}`}>
      <div className="message-code-header">
        <span className="message-code-language">{displayLanguage}</span>
        <div className="message-code-actions">
          <button type="button" className="message-code-action" onClick={() => setWrap((current) => !current)}>
            {wrap ? 'No wrap' : 'Wrap'}
          </button>
          <button type="button" className="message-code-action" onClick={() => void copyText(content)}>
            Copy
          </button>
        </div>
      </div>
      <div className="message-code-block">
        <HighlightedCodeBlock content={content} language={language} />
      </div>
    </div>
  )
}

/**
 * The shared ReactMarkdown components map. Lifted out of the per-block
 * component so we don't re-allocate a fresh object on every render —
 * a stable reference helps ReactMarkdown's internal memoisation too.
 *
 * Behaviour intentionally identical to the pre-L1a `MarkdownMessage`:
 *   - `a` routes through `classifyMarkdownLink` + the preload bridge
 *     instead of letting the BrowserWindow navigate (Phase K1 fix);
 *     `agent://` hrefs render as `<AgentMention>` chips.
 *   - `pre` is collapsed — the `code` override owns the shell.
 *   - block `code` (any fenced or multi-line code) renders inside a
 *     `MarkdownCodeBlock` shell (header + copy + wrap toggle).
 *   - `input` is forced read-only so transcript checkboxes can't be
 *     ticked by the user.
 */
const MARKDOWN_COMPONENTS: Components = {
  a({ href, children }) {
    if (typeof href === 'string' && href.startsWith('agent://')) {
      const agentId = href.slice('agent://'.length).trim()
      return <AgentMention agentId={agentId}>{children}</AgentMention>
    }
    const classification = classifyMarkdownLink(href)
    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (classification.kind === 'unknown') return
      const api = (window as unknown as { api?: { openExternalOrPath?: (h: string) => Promise<unknown> } }).api
      try {
        void api?.openExternalOrPath?.(classification.resolved)
      } catch {
        // Best-effort: missing bridge in tests / SSR — no-op.
      }
    }
    const isExternal = classification.kind === 'external'
    return (
      <a
        href={typeof href === 'string' ? href : '#'}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noreferrer' : undefined}
        onClick={handleClick}
        data-link-kind={classification.kind}
      >
        {children}
      </a>
    )
  },
  pre({ children }) {
    return <>{children}</>
  },
  code({ className, children }) {
    const rawContent = String(children ?? '').replace(/\n$/, '')
    const languageMatch = /language-([\w-]+)/.exec(className || '')
    const isBlock = Boolean(languageMatch) || rawContent.includes('\n')
    if (!isBlock) {
      return <code className={className}>{children}</code>
    }
    return <MarkdownCodeBlock content={rawContent} language={languageMatch?.[1]} />
  },
  input({ checked, disabled, type }) {
    return <input type={type} checked={checked} disabled={disabled ?? true} readOnly />
  }
}

const REMARK_PLUGINS = [remarkGfm]

interface StableMarkdownBlockProps {
  /** The raw markdown for a single block. Memo equality is `prev.raw === next.raw`. */
  raw: string
  /** Forwarded only for callsites that don't already wrap a provider.
   * MarkdownMessage installs the provider itself so this is unused in
   * the streaming path — kept for type compatibility / future direct
   * callers. */
  chat?: ChatRecord
}

function StableMarkdownBlockImpl({ raw }: StableMarkdownBlockProps) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
      {raw}
    </ReactMarkdown>
  )
}

/**
 * `React.memo` short-circuits on a single string comparison. That's
 * the entire point — for stable blocks above the streaming tail, the
 * parent's re-render passes the same `raw` and this component returns
 * its memoised vDOM without re-running ReactMarkdown / remark / mdast.
 */
export const StableMarkdownBlock = memo(
  StableMarkdownBlockImpl,
  (prev, next) => prev.raw === next.raw
)
