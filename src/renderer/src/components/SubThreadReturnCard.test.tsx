import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../main/store/types';
import {
  isSubThreadReturnMessage,
  SubThreadReturnCard,
  subThreadReturnBody
} from './SubThreadReturnCard';

function subThreadMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'message-1',
    role: 'system',
    content: '↩ Result from Codex sub-thread (Build agent):\n\n**Done**\n\n- Tests passed',
    timestamp: '2026-05-16T12:00:00Z',
    metadata: {
      kind: 'subThreadReturn',
      subThreadId: 'chat-child-1',
      subThreadProvider: 'codex',
      subThreadTitle: 'Build agent'
    },
    ...overrides
  };
}

describe('SubThreadReturnCard', () => {
  it('detects only sub-thread return system messages', () => {
    expect(isSubThreadReturnMessage(subThreadMessage())).toBe(true);
    expect(isSubThreadReturnMessage(subThreadMessage({ role: 'assistant' }))).toBe(false);
    expect(isSubThreadReturnMessage(subThreadMessage({ metadata: { kind: 'other' } }))).toBe(false);
  });

  it('strips the synthetic transcript prefix from the markdown body', () => {
    expect(subThreadReturnBody(subThreadMessage().content)).toBe('**Done**\n\n- Tests passed');
    expect(subThreadReturnBody('plain body')).toBe('plain body');
  });

  it('renders provider, title, markdown body, and open control', () => {
    const html = renderToStaticMarkup(
      <SubThreadReturnCard message={subThreadMessage()} onOpenSubThread={() => {}} />
    );

    expect(html).toContain('subthread-return-card');
    expect(html).toContain('Result from');
    expect(html).toContain('Codex');
    expect(html).toContain('Build agent');
    expect(html).toContain('<strong>Done</strong>');
    expect(html).toContain('Open sub-thread');
  });
});
