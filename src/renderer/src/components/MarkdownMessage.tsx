import { useState, type MouseEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { HighlightedCodeBlock } from './HighlightedCodeBlock';
import { AgentIdentityContext, AgentMention } from './AgentMention';
import { classifyMarkdownLink } from '../lib/classifyMarkdownLink';
import type { ChatRecord } from '../../../main/store/types';

interface MarkdownMessageProps {
  content: string;
  /** Chat used to look up subagent identities for `[@Name](agent://id)` chips. */
  chat?: ChatRecord;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Copy is best-effort; avoid adding noisy UI state inside streamed messages.
  }
}

function MarkdownCodeBlock({ content, language }: { content: string; language?: string }) {
  const [wrap, setWrap] = useState(false);
  const displayLanguage = language?.trim() || 'text';

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
  );
}

export function MarkdownMessage({ content, chat }: MarkdownMessageProps) {
  return (
    <AgentIdentityContext.Provider value={chat}>
    <div className="message-markdown message-markdown-pro">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            // Subagent @-mention: [@Name](agent://<uuid>) renders as a colored
            // inline chip via AgentMention, looked up against the current
            // chat's identity registry through AgentIdentityContext.
            if (typeof href === 'string' && href.startsWith('agent://')) {
              const agentId = href.slice('agent://'.length).trim();
              return <AgentMention agentId={agentId}>{children}</AgentMention>;
            }
            // Phase K1: every other link routes through the preload
            // bridge instead of letting the BrowserWindow navigate.
            // A bare `<a href="file:///...">` left-click would unload
            // the bundled `index.html` (no `will-navigate` guard was
            // wired before this phase — that's now defense-in-depth
            // in main). Classify the href, preventDefault on click,
            // hand off to the OS via `openExternalOrPath`.
            const classification = classifyMarkdownLink(href);
            const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
              event.preventDefault();
              event.stopPropagation();
              if (classification.kind === 'unknown') return;
              const api = (window as unknown as { api?: { openExternalOrPath?: (h: string) => Promise<unknown> } }).api;
              try {
                void api?.openExternalOrPath?.(classification.resolved);
              } catch {
                // Best-effort: missing bridge in tests / SSR — no-op.
              }
            };
            const isExternal = classification.kind === 'external';
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
            );
          },
          pre({ children }) {
            return <>{children}</>;
          },
          code({ className, children }) {
            const rawContent = String(children ?? '').replace(/\n$/, '');
            const languageMatch = /language-([\w-]+)/.exec(className || '');
            const isBlock = Boolean(languageMatch) || rawContent.includes('\n');
            if (!isBlock) {
              return <code className={className}>{children}</code>;
            }
            return <MarkdownCodeBlock content={rawContent} language={languageMatch?.[1]} />;
          },
          input({ checked, disabled, type }) {
            return <input type={type} checked={checked} disabled={disabled ?? true} readOnly />;
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
    </AgentIdentityContext.Provider>
  );
}
