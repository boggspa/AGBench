import { describe, expect, it } from 'vitest';
import type { ChatRecord } from '../../../main/store/types';
import { selectRecentChats } from './recentChatsList';

const chat = (overrides: Partial<ChatRecord> = {}): ChatRecord => ({
  appChatId: 'chat-1',
  title: 'Chat',
  workspaceId: 'workspace-1',
  workspacePath: '/repo',
  createdAt: 1000,
  updatedAt: 1000,
  archived: false,
  messages: [],
  runs: [],
  ...overrides,
});

describe('selectRecentChats', () => {
  it('orders by updatedAt descending', () => {
    const result = selectRecentChats(
      [
        chat({ appChatId: 'a', updatedAt: 100 }),
        chat({ appChatId: 'b', updatedAt: 300 }),
        chat({ appChatId: 'c', updatedAt: 200 }),
      ],
      { limit: 5 },
    );
    expect(result.map((c) => c.appChatId)).toEqual(['b', 'c', 'a']);
  });

  it('caps results at limit', () => {
    const result = selectRecentChats(
      [
        chat({ appChatId: 'a', updatedAt: 100 }),
        chat({ appChatId: 'b', updatedAt: 200 }),
        chat({ appChatId: 'c', updatedAt: 300 }),
        chat({ appChatId: 'd', updatedAt: 400 }),
        chat({ appChatId: 'e', updatedAt: 500 }),
        chat({ appChatId: 'f', updatedAt: 600 }),
      ],
      { limit: 3 },
    );
    expect(result.map((c) => c.appChatId)).toEqual(['f', 'e', 'd']);
  });

  it('excludes archived chats by default', () => {
    const result = selectRecentChats(
      [
        chat({ appChatId: 'a', updatedAt: 100 }),
        chat({ appChatId: 'b', updatedAt: 200, archived: true }),
        chat({ appChatId: 'c', updatedAt: 300 }),
      ],
      { limit: 5 },
    );
    expect(result.map((c) => c.appChatId)).toEqual(['c', 'a']);
  });

  it('excludes pinned chats by default', () => {
    const result = selectRecentChats(
      [
        chat({ appChatId: 'a', updatedAt: 100 }),
        chat({ appChatId: 'b', updatedAt: 200, pinned: true }),
        chat({ appChatId: 'c', updatedAt: 300 }),
      ],
      { limit: 5 },
    );
    expect(result.map((c) => c.appChatId)).toEqual(['c', 'a']);
  });

  it('returns empty array for empty input', () => {
    expect(selectRecentChats([], { limit: 5 })).toEqual([]);
  });

  it('breaks ties by appChatId for determinism', () => {
    const result = selectRecentChats(
      [
        chat({ appChatId: 'zebra', updatedAt: 500 }),
        chat({ appChatId: 'alpha', updatedAt: 500 }),
        chat({ appChatId: 'mango', updatedAt: 500 }),
      ],
      { limit: 5 },
    );
    expect(result.map((c) => c.appChatId)).toEqual(['alpha', 'mango', 'zebra']);
  });
});
