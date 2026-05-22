import type { ChatMessage, ChatRecord, ProviderId } from '../../../main/store/types';
import { MarkdownMessage } from './MarkdownMessage';

interface SubThreadReturnCardProps {
  message: ChatMessage;
  chat?: ChatRecord;
  onOpenSubThread?: (chatId: string) => void;
}

function providerLabel(provider?: ProviderId | string): string {
  if (provider === 'codex') return 'Codex';
  if (provider === 'claude') return 'Claude';
  if (provider === 'kimi') return 'Kimi';
  if (provider === 'gemini') return 'Gemini';
  return 'Sub-thread';
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function isSubThreadReturnMessage(message: ChatMessage): boolean {
  return (message.role === 'tool' || message.role === 'system') && message.metadata?.kind === 'subThreadReturn';
}

export function subThreadReturnBody(content: string): string {
  const tagged = content.match(/<subthread_result(?:\s[^>]*)?>\n?([\s\S]*)\n?<\/subthread_result>/);
  if (tagged) return tagged[1].trim();
  const lines = content.split(/\r?\n/);
  if (!lines[0]?.startsWith('↩ Result from ')) return content;
  const bodyStart = lines[1]?.trim() === '' ? 2 : 1;
  return lines.slice(bodyStart).join('\n').trimStart();
}

export function SubThreadReturnCard({ message, chat, onOpenSubThread }: SubThreadReturnCardProps) {
  const metadata = message.metadata || {};
  const provider = metadata.subThreadProvider;
  const providerName = providerLabel(typeof provider === 'string' ? provider : undefined);
  const title = textValue(metadata.subThreadTitle) || 'Untitled sub-thread';
  const subThreadId = textValue(metadata.subThreadId);
  const body = subThreadReturnBody(message.content);

  return (
    <article className="subthread-return-card">
      <header className="subthread-return-header">
        <div className="subthread-return-heading">
          <span aria-hidden="true" className="subthread-return-glyph">↩</span>
          <span className="subthread-return-label">Result from</span>
          <span className={`subthread-return-provider provider-${provider || 'unknown'}`}>
            {providerName}
          </span>
          <strong className="subthread-return-title">{title}</strong>
        </div>
        {subThreadId && onOpenSubThread && (
          <button
            type="button"
            className="subthread-return-open"
            onClick={() => onOpenSubThread(subThreadId)}
          >
            Open sub-thread
          </button>
        )}
      </header>
      <div className="subthread-return-body">
        <MarkdownMessage content={body} chat={chat} />
      </div>
    </article>
  );
}
