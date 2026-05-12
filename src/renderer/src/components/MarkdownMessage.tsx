import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { HighlightedCodeBlock } from './HighlightedCodeBlock';

interface MarkdownMessageProps {
  content: string;
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

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <div className="message-markdown message-markdown-pro">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            const external = typeof href === 'string' && /^https?:\/\//i.test(href);
            return (
              <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>
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
  );
}
