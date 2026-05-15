import { useState, useEffect, type MouseEvent, type ReactNode } from 'react';
import type { WorkspaceRecord, ChatRecord, ProviderId } from '../../../main/store/types';

const ageTickListeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.setInterval(() => {
    ageTickListeners.forEach((listener) => listener());
  }, 60000);
}
function subscribeAgeTick(listener: () => void): () => void {
  ageTickListeners.add(listener);
  return () => { ageTickListeners.delete(listener); };
}

interface SidebarProps {
  workspaces: WorkspaceRecord[];
  currentWorkspace: WorkspaceRecord | null;
  chats: ChatRecord[];
  currentChat: ChatRecord | null;
  currentRun: any;
  usageSummary: Array<{
    provider: ProviderId;
    model: string;
    runs: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    durationMs: number;
    inputTokenLimit?: number;
    outputTokenLimit?: number;
    totalTokenLimit?: number;
    resetAt?: string;
    resetText?: string;
    windows?: Array<{
      id: string;
      label: string;
      runs: number;
      totalTokens: number;
      runLimitMax?: number;
      limitLabel: string;
      resetAt?: string;
      trackingOnly?: boolean;
      usedPercent?: number;
      remainingPercent?: number;
    }>;
  }>;
  runningChatIds?: string[];
  onSelectWorkspace: (ws: WorkspaceRecord) => void;
  onRemoveWorkspace: (id: string, e: MouseEvent<HTMLButtonElement>) => void;
  onSelectWorkspaceDialog: () => void;
  onNewChat: (wsId: string, wsPath: string) => void;
  onNewGlobalChat: () => void;
  onSelectChat: (chat: ChatRecord) => void;
  onOpenSettings: () => void;
}

const EXPANDED_WORKSPACES_STORAGE_KEY = 'guigemini-sidebar-expanded-workspace-ids';

function FolderSymbolIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.8 4.4h4.1L7.3 5.6h6.5c.6 0 1.1.4 1.1 1v6.2c0 .6-.5 1-1.1 1H2.8C2.2 13.8 1.7 13.4 1.7 12.8V5.5c0-.6.5-1.1 1.1-1.1z" />
      </svg>
    </span>
  );
}

function GearSymbolIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="2.2" />
        <path d="M8 2.5v1M8 12.5v1M2.5 8h1M12.5 8h1M4.2 4.2l.7.7M11.1 11.1l.7.7M11.1 4.9l-.7.7M4.9 11.1l-.7.7" />
      </svg>
    </span>
  );
}

function ChevronSymbolIcon({ isExpanded }: { isExpanded: boolean }) {
  return (
    <span className={`sf-symbol-icon sidebar-tree-chevron ${isExpanded ? 'is-expanded' : ''}`} aria-hidden>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6.2 4.7 10 8.1 6.2 11.5" />
      </svg>
    </span>
  );
}

function PlusSymbolIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 3.5v9M3.5 8h9" />
      </svg>
    </span>
  );
}

function SearchSymbolIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7.1" cy="7.1" r="4.1" />
        <path d="m10.1 10.1 3.1 3.1" />
      </svg>
    </span>
  );
}

function XSymbolIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.7 4.7 11.3 11.3M11.3 4.7 4.7 11.3" />
      </svg>
    </span>
  );
}

function getProviderName(provider?: ProviderId) {
  if (provider === 'codex') return 'Codex';
  if (provider === 'claude') return 'Claude';
  if (provider === 'kimi') return 'Kimi';
  return 'Gemini';
}

function ProviderBadgeIcon({ provider }: { provider?: ProviderId }) {
  const providerKey = provider || 'gemini';

  return (
    <span className={`sidebar-provider-icon provider-${providerKey}`} aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M2.7 2.9h10.6c.35 0 .63.29.63.65v9.01c0 .36-.28.65-.63.65H2.7a.65.65 0 0 1-.63-.65V3.55c0-.36.28-.65.63-.65Z"
          fill="currentColor"
          opacity="0.16"
        />
        {providerKey === 'claude' ? (
          <>
            <path d="M4.8 5.1h1.8L8 10.2M4.8 7h2.2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8.5 5.15c0-.53.43-.96.96-.96h.72a.93.93 0 0 1 .86 1.32l-.33.79" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
          </>
        ) : providerKey === 'gemini' ? (
          <>
            <path d="M8 4.3c2.3 0 4.2 1.9 4.2 4.2 0 2.3-1.9 4.2-4.2 4.2S3.8 10.8 3.8 8.5A4.2 4.2 0 0 1 8 4.3Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M8 6.5c1 0 1.8.8 1.8 1.8 0 1-1 1.8-1.8 1.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M8 10.6c-1 0-1.8-.8-1.8-1.8 0-1 1-1.8 1.8-1.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </>
        ) : providerKey === 'codex' ? (
          <>
            <path d="M5.3 4.7 9.2 8 5.3 11.3M6.5 8h4.7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8 4.7v-.9M9.85 8h.9M6.05 11.3h.9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          </>
        ) : (
          <>
            <path d="M4.2 11.3 7.7 5 11.2 11.3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4.9 6.3h5.7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
            <path d="M4.9 8.7h5.7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          </>
        )}
      </svg>
    </span>
  );
}

function SidebarProviderLabel({ provider, showModel }: { provider: ProviderId | undefined; showModel?: string }) {
  const providerName = provider || 'gemini';
  return (
    <span className={`sidebar-provider-label provider-${providerName}`}>
      <ProviderBadgeIcon provider={provider} />
      <span>{getProviderName(provider)}{showModel ? ` / ${showModel}` : ''}</span>
    </span>
  );
}

function getChatsByWorkspace(chats: ChatRecord[]): Map<string, ChatRecord[]> {
  const grouped = new Map<string, ChatRecord[]>();
  for (const chat of chats) {
    if (chat.archived) continue;
    if (chat.scope === 'global') continue;
    if (!chat.workspaceId) continue;
    const bucket = grouped.get(chat.workspaceId);
    if (bucket) {
      bucket.push(chat);
    } else {
      grouped.set(chat.workspaceId, [chat]);
    }
  }
  return grouped;
}

function normalizeSearchText(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function chatMatchesSearch(chat: ChatRecord, query: string): boolean {
  if (!query) return true;
  const provider = getProviderName(chat.provider);
  const searchableText = [
    chat.title,
    provider,
    chat.appChatId,
    chat.linkedGeminiSessionId,
    chat.linkedProviderSessionId,
    ...(chat.messages || []).map((message) => `${message.role} ${message.content}`),
  ].join(' ');
  return searchableText.toLowerCase().includes(query);
}

function workspaceMatchesSearch(workspace: WorkspaceRecord, query: string): boolean {
  if (!query) return true;
  return [
    workspace.displayName,
    workspace.path,
    workspace.branch,
  ].join(' ').toLowerCase().includes(query);
}

function ChatAgeLabel({ timestamp }: { timestamp: number }): ReactNode {
  const [label, setLabel] = useState(() =>
    Number.isFinite(timestamp) ? formatChatAge(timestamp, Date.now()) : ''
  );

  useEffect(() => {
    if (!Number.isFinite(timestamp)) {
      setLabel((prev) => (prev === '' ? prev : ''));
      return;
    }
    const compute = () => formatChatAge(timestamp, Date.now());
    setLabel((prev) => {
      const next = compute();
      return prev === next ? prev : next;
    });
    return subscribeAgeTick(() => {
      setLabel((prev) => {
        const next = compute();
        return prev === next ? prev : next;
      });
    });
  }, [timestamp]);

  if (!label) return null;
  return (
    <span className="sidebar-chat-age" title={formatChatAgeTitle(timestamp)}>
      {label}
    </span>
  );
}

function formatChatAge(timestamp: number, now: number): string {
  if (!Number.isFinite(timestamp)) return '';
  const elapsedMs = Math.max(0, now - timestamp);
  const elapsedMinutes = Math.floor(elapsedMs / 60000);
  if (elapsedMinutes < 1) return 'now';
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays}d`;

  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString('en-GB', sameYear
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: '2-digit' });
}

function formatChatAgeTitle(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getWorkspaceMeta(workspace: WorkspaceRecord): string {
  const pathParts = workspace.path.split(/[\\/]/).filter(Boolean);
  const compactPath = pathParts.length > 2
    ? `.../${pathParts.slice(-2).join('/')}`
    : workspace.path;
  return [compactPath, workspace.branch ? `branch ${workspace.branch}` : ''].filter(Boolean).join(' · ');
}

function HighlightMatch({ text, query }: { text: string; query: string }): ReactNode {
  if (!query) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(lowerQuery, cursor);

  while (matchIndex >= 0) {
    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex));
    }
    const matchEnd = matchIndex + lowerQuery.length;
    parts.push(
      <mark key={`${matchIndex}-${matchEnd}`} className="sidebar-search-highlight">
        {text.slice(matchIndex, matchEnd)}
      </mark>
    );
    cursor = matchEnd;
    matchIndex = lowerText.indexOf(lowerQuery, cursor);
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts.length > 0 ? parts : text;
}

function getLastRunStatus(chat: ChatRecord): { label: string; tone: 'success' | 'warning' | 'danger' | 'muted' } | null {
  const run = chat.runs?.[chat.runs.length - 1];
  if (!run) return null;
  if (!run.endedAt && run.status !== 'failed' && run.status !== 'cancelled') {
    return { label: 'Running', tone: 'warning' };
  }
  if (run.status === 'success') return { label: 'Done', tone: 'success' };
  if (run.status === 'success_with_warnings') return { label: 'Warnings', tone: 'warning' };
  if (run.status === 'failed') return { label: 'Failed', tone: 'danger' };
  if (run.status === 'cancelled') return { label: 'Cancelled', tone: 'muted' };
  return { label: run.status || 'Completed', tone: 'muted' };
}

export function Sidebar({
  workspaces,
  currentWorkspace,
  chats,
  currentChat,
  currentRun,
  usageSummary,
  runningChatIds = [],
  onSelectWorkspace,
  onRemoveWorkspace,
  onSelectWorkspaceDialog,
  onNewChat,
  onNewGlobalChat,
  onSelectChat,
  onOpenSettings,
}: SidebarProps) {
  const [hoveredWorkspace, setHoveredWorkspace] = useState<string | null>(null);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(EXPANDED_WORKSPACES_STORAGE_KEY);
      if (!raw) return new Set<string>();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return new Set<string>();
      }
      return new Set(parsed.filter((value): value is string => typeof value === 'string'));
    } catch {
      return new Set<string>();
    }
  });
  const chatsByWorkspace = getChatsByWorkspace(chats);
  const globalChats = chats.filter((chat) => !chat.archived && chat.scope === 'global');
  const runningChatIdSet = new Set(runningChatIds);
  const sidebarSearchQuery = normalizeSearchText(sidebarSearch);
  const isSidebarSearchActive = sidebarSearchQuery.length > 0;
  const visibleWorkspaceEntries = workspaces
    .map((workspace) => {
      const workspaceChats = chatsByWorkspace.get(workspace.id) || [];
      const workspaceMatched = workspaceMatchesSearch(workspace, sidebarSearchQuery);
      const visibleChats = isSidebarSearchActive
        ? workspaceChats.filter((chat) => chatMatchesSearch(chat, sidebarSearchQuery))
        : workspaceChats;
      return {
        workspace,
        workspaceMatched,
        visibleChats,
        totalChats: workspaceChats.length,
      };
    })
    .filter((entry) => !isSidebarSearchActive || entry.workspaceMatched || entry.visibleChats.length > 0);
  const visibleGlobalChats = isSidebarSearchActive
    ? globalChats.filter((chat) => chatMatchesSearch(chat, sidebarSearchQuery))
    : globalChats;
  const sidebarSearchResultCount = visibleWorkspaceEntries.length +
    visibleWorkspaceEntries.reduce((total, entry) => total + entry.visibleChats.length, 0) +
    visibleGlobalChats.length;
  const totalChatCount = chats.filter((chat) => !chat.archived).length;
  const currentScopeTitle = currentWorkspace?.displayName || (currentChat?.scope === 'global' ? 'Global chats' : 'AGBench');
  const currentScopeMeta = currentWorkspace
    ? getWorkspaceMeta(currentWorkspace)
    : 'System-wide agent threads';
  const runningCount = runningChatIdSet.size;
  const primaryNewTitle = currentWorkspace
    ? `New chat in ${currentWorkspace.displayName}`
    : 'New system chat';
  const handlePrimaryNewChat = () => {
    if (currentWorkspace) {
      onNewChat(currentWorkspace.id, currentWorkspace.path);
      return;
    }
    onNewGlobalChat();
  };

  useEffect(() => {
    const workspaceIds = new Set(workspaces.map((workspace) => workspace.id));
    setExpandedWorkspaceIds((prev) => {
      const next = new Set<string>();
      for (const workspaceId of prev) {
        if (workspaceIds.has(workspaceId)) {
          next.add(workspaceId);
        }
      }
      if (next.size === prev.size) {
        return prev;
      }
      return next;
    });
  }, [workspaces]);

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_WORKSPACES_STORAGE_KEY, JSON.stringify([...expandedWorkspaceIds]));
    } catch {
      // Ignore persistence errors in constrained environments.
    }
  }, [expandedWorkspaceIds]);

  const toggleWorkspaceExpanded = (event: MouseEvent<HTMLButtonElement>, workspaceId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setExpandedWorkspaceIds((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }
      return next;
    });
  };

  const handleAddChat = (event: MouseEvent<HTMLButtonElement>, ws: WorkspaceRecord) => {
    event.preventDefault();
    event.stopPropagation();
    onNewChat(ws.id, ws.path);
  };

  const formatResetShort = (entry: { resetAt?: string; resetText?: string }) => {
    if (entry.resetAt) {
      const parsed = new Date(entry.resetAt);
      if (!Number.isNaN(parsed.getTime())) {
        const now = new Date();
        const sameDay =
          parsed.getFullYear() === now.getFullYear() &&
          parsed.getMonth() === now.getMonth() &&
          parsed.getDate() === now.getDate();
        const sameYear = parsed.getFullYear() === now.getFullYear();

        if (sameDay) {
          return parsed.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          });
        }

        const dateOptions: Intl.DateTimeFormatOptions = sameYear
          ? { day: 'numeric', month: 'short' }
          : { day: 'numeric', month: 'short', year: 'numeric' };

        return parsed.toLocaleDateString('en-GB', dateOptions);
      }
    }
    return entry.resetText;
  };

    return (
      <div className="app-sidebar">
        <div className="sidebar-content">
          <div className="sidebar-masthead">
            <div className="sidebar-masthead-copy">
              <span className="sidebar-product-label">AGBench</span>
              <strong title={currentWorkspace?.path || currentScopeTitle}>{currentScopeTitle}</strong>
              <span title={currentWorkspace?.path || currentScopeMeta}>{currentScopeMeta}</span>
            </div>
            <button
              type="button"
              className="sidebar-primary-action"
              onClick={handlePrimaryNewChat}
              title={primaryNewTitle}
              aria-label={primaryNewTitle}
            >
              <PlusSymbolIcon />
              <span>New</span>
            </button>
          </div>
          <div className="sidebar-masthead-stats" aria-label="Sidebar summary">
            <span>{workspaces.length} workspace{workspaces.length === 1 ? '' : 's'}</span>
            <span>{totalChatCount} thread{totalChatCount === 1 ? '' : 's'}</span>
            {runningCount > 0 && <span className="sidebar-stat-live">{runningCount} running</span>}
          </div>

          <div className="sidebar-search-section">
            <label className="sidebar-search-field">
              <SearchSymbolIcon />
              <input
                type="search"
                value={sidebarSearch}
                onChange={(event) => setSidebarSearch(event.target.value)}
                placeholder="Search workspaces & threads"
                aria-label="Search workspaces and chats"
                spellCheck={false}
              />
              {!isSidebarSearchActive && (
                <span className="sidebar-search-hint">⌘F</span>
              )}
              {isSidebarSearchActive && (
                <>
                  <span className="sidebar-search-result-count">{sidebarSearchResultCount}</span>
                  <button
                    type="button"
                    className="sidebar-search-clear"
                    onClick={() => setSidebarSearch('')}
                    title="Clear search"
                    aria-label="Clear workspace and thread search"
                  >
                    <XSymbolIcon />
                  </button>
                </>
              )}
            </label>
          </div>

          <div className="sidebar-workspace-scroll">
            <div className="sidebar-section-header">
              <h4 className="sidebar-section-title">Workspaces</h4>
              <button className="btn btn-sm btn-ghost" onClick={onSelectWorkspaceDialog} title="Add workspace">
                +
              </button>
            </div>
            <div className="sidebar-workspace-list">
              {visibleWorkspaceEntries.map(({ workspace: ws, visibleChats, totalChats }) => {
                const expanded = isSidebarSearchActive ? true : expandedWorkspaceIds.has(ws.id);
                const workspaceChats = chatsByWorkspace.get(ws.id) || [];
                const workspaceHasRunning = workspaceChats.some((chat) => runningChatIdSet.has(chat.appChatId));
                return (
                  <div key={ws.id} className="sidebar-workspace-group">
                    <div
                      className={`sidebar-item sidebar-workspace-item ${currentWorkspace?.id === ws.id ? 'active' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectWorkspace(ws)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) {
                          return
                        }
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onSelectWorkspace(ws)
                        }
                      }}
                      onFocus={() => setHoveredWorkspace(ws.id)}
                      onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                          setHoveredWorkspace(null)
                        }
                      }}
                      onMouseEnter={() => setHoveredWorkspace(ws.id)}
                      onMouseLeave={() => setHoveredWorkspace(null)}
                    >
                      {totalChats > 0 ? (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost sidebar-tree-toggle"
                          onClick={(event) => toggleWorkspaceExpanded(event, ws.id)}
                          title={expanded ? 'Collapse chats' : 'Expand chats'}
                          aria-label={expanded ? 'Collapse chats' : 'Expand chats'}
                        >
                          <ChevronSymbolIcon isExpanded={expanded} />
                        </button>
                    ) : (
                      <span className="sidebar-tree-toggle spacer" />
                    )}
                    <FolderSymbolIcon />
                    <span className="sidebar-workspace-copy" title={ws.path}>
                      <span className="sidebar-workspace-name">
                        <HighlightMatch text={ws.displayName} query={sidebarSearchQuery} />
                      </span>
                      <span className="sidebar-workspace-meta">
                        <HighlightMatch text={getWorkspaceMeta(ws)} query={sidebarSearchQuery} />
                      </span>
                    </span>
                    {workspaceHasRunning && (
                      <span
                        className="sidebar-workspace-running-dot"
                        title="Task running in this workspace"
                        aria-label="Task running in this workspace"
                      />
                    )}
                    {totalChats > 0 && hoveredWorkspace !== ws.id && (
                      <span
                        className="sidebar-workspace-count-badge"
                        title={`${totalChats} chat${totalChats === 1 ? '' : 's'}`}
                        aria-label={`${totalChats} chat${totalChats === 1 ? '' : 's'} in this workspace`}
                      >
                        {totalChats}
                      </span>
                    )}
                    <button
                      className="btn btn-sm btn-ghost btn-icon sidebar-item-action"
                      style={{ opacity: hoveredWorkspace === ws.id ? 1 : 0, transition: 'opacity 0.1s' }}
                      onClick={(event) => handleAddChat(event, ws)}
                      title="New chat"
                    >
                      <PlusSymbolIcon />
                    </button>
                    {(hoveredWorkspace === ws.id || currentWorkspace?.id !== ws.id) && (
                      <button
                        className="btn btn-sm btn-ghost btn-icon sidebar-item-action"
                        style={{ opacity: hoveredWorkspace === ws.id ? 1 : 0, transition: 'opacity 0.1s' }}
                        onClick={(event) => onRemoveWorkspace(ws.id, event)}
                        title="Remove"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {visibleChats.length > 0 && expanded ? (
                    <div className="sidebar-chat-list">
                      {visibleChats.map((chat) => {
                        const chatAgeTimestamp = chat.updatedAt || chat.createdAt;
                        const isChatRunning = runningChatIdSet.has(chat.appChatId);
                        const lastRunStatus = getLastRunStatus(chat);
                        return (
                          <button
                            type="button"
                            key={chat.appChatId}
                            className={`sidebar-item sidebar-chat-item provider-${chat.provider || 'gemini'} ${currentChat?.appChatId === chat.appChatId ? 'active' : ''} ${isChatRunning ? 'running' : ''}`}
                            onClick={() => onSelectChat(chat)}
                          >
                            <span className="sidebar-chat-copy" title={chat.title}>
                              <span className="sidebar-chat-title-line">
                                <SidebarProviderLabel provider={chat.provider} />
                                <span className="sidebar-chat-title">
                                  <HighlightMatch text={chat.title} query={sidebarSearchQuery} />
                                </span>
                              </span>
                              {(isChatRunning || (lastRunStatus && lastRunStatus.tone !== 'success' && lastRunStatus.tone !== 'muted')) && (
                                <span className="sidebar-chat-subline">
                                  {isChatRunning ? (
                                    <span className="sidebar-run-status tone-warning">Running</span>
                                  ) : lastRunStatus ? (
                                    <span className={`sidebar-run-status tone-${lastRunStatus.tone}`}>
                                      {lastRunStatus.label}
                                    </span>
                                  ) : null}
                                </span>
                              )}
                            </span>
                            {isChatRunning && (
                              <span className="sidebar-chat-busy" title="Task running" aria-label="Task running" />
                            )}
                            {!isChatRunning && <ChatAgeLabel timestamp={chatAgeTimestamp} />}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
              {isSidebarSearchActive && visibleWorkspaceEntries.length === 0 && (
                visibleGlobalChats.length === 0 && (
                <div className="sidebar-empty-state">
                  <strong>No matches</strong>
                  <span>Try a workspace name, provider, branch, or thread title.</span>
                </div>
                )
              )}
              <div className="sidebar-section-header sidebar-chats-header">
                <h4 className="sidebar-section-title">Chats</h4>
                <button className="btn btn-sm btn-ghost" onClick={onNewGlobalChat} title="New system chat" aria-label="New system chat">
                  <PlusSymbolIcon />
                </button>
              </div>
              <div className="sidebar-chat-list sidebar-global-chat-list">
                {visibleGlobalChats.map((chat) => {
                  const chatAgeTimestamp = chat.updatedAt || chat.createdAt;
                  const isChatRunning = runningChatIdSet.has(chat.appChatId);
                  const lastRunStatus = getLastRunStatus(chat);
                    return (
                      <button
                        type="button"
                        key={chat.appChatId}
                        className={`sidebar-item sidebar-chat-item sidebar-global-chat-item provider-${chat.provider || 'gemini'} ${currentChat?.appChatId === chat.appChatId ? 'active' : ''} ${isChatRunning ? 'running' : ''}`}
                        onClick={() => onSelectChat(chat)}
                      >
                      <span className="sidebar-chat-copy" title={chat.title}>
                        <span className="sidebar-chat-title-line">
                          <SidebarProviderLabel provider={chat.provider} />
                          <span className="sidebar-chat-title">
                            <HighlightMatch text={chat.title} query={sidebarSearchQuery} />
                          </span>
                        </span>
                        {(isChatRunning || (lastRunStatus && lastRunStatus.tone !== 'success' && lastRunStatus.tone !== 'muted')) && (
                          <span className="sidebar-chat-subline">
                            {isChatRunning ? (
                              <span className="sidebar-run-status tone-warning">Running</span>
                            ) : lastRunStatus ? (
                              <span className={`sidebar-run-status tone-${lastRunStatus.tone}`}>
                                {lastRunStatus.label}
                              </span>
                            ) : null}
                          </span>
                        )}
                      </span>
                      {isChatRunning && (
                        <span className="sidebar-chat-busy" title="Task running" aria-label="Task running" />
                      )}
                      {!isChatRunning && <ChatAgeLabel timestamp={chatAgeTimestamp} />}
                    </button>
                  );
                })}
                {visibleGlobalChats.length === 0 && !isSidebarSearchActive && (
                  <div className="sidebar-empty-state">No chats yet.</div>
                )}
              </div>
          </div>
        </div>

        {/* Run Summary */}
        {currentRun && currentRun.stats && (
          <div className="run-summary">
            <div className="run-summary-title">Run Summary</div>
            <div className="run-summary-row"><span>Model</span><span>{currentRun.actualModel || currentRun.requestedModel}</span></div>
            <div className="run-summary-row"><span>Mode</span><span>{currentRun.approvalMode || 'unknown'}</span></div>
            <div className="run-summary-row"><span>Status</span><span>{currentRun.status}</span></div>
            <div className="run-summary-row"><span>Duration</span><span>{currentRun.stats.duration_ms}ms</span></div>
            <div className="run-summary-row"><span>Tokens</span><span>{currentRun.stats.input_tokens || 0} → {currentRun.stats.output_tokens || 0}</span></div>
          </div>
        )}

        {usageSummary.length > 0 && (
          <div className="run-summary model-usage-summary">
            <div className="run-summary-title">Model Usage</div>
            <div className="model-usage-list">
              {(() => {
                const providerOrder: ProviderId[] = ['gemini', 'codex', 'claude', 'kimi']
                const orderedEntries = [...usageSummary].sort((a, b) => {
                  const aIdx = providerOrder.indexOf(a.provider)
                  const bIdx = providerOrder.indexOf(b.provider)
                  return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx)
                })
                return orderedEntries
                  .filter((entry) => entry.model === 'usage limits' && (entry.windows?.length || 0) > 0)
                  .map((entry) => (
                    <div key={`${entry.provider}-${entry.model}`} className={`model-usage-item provider-${entry.provider} quota-only`}>
                      <div className="model-usage-provider-heading">
                        <SidebarProviderLabel provider={entry.provider} />
                      </div>
                      <div className="model-usage-window-list">
                        {entry.windows!.map((windowEntry) => {
                          const meterPercent = windowEntry.remainingPercent ?? windowEntry.usedPercent
                          const windowPercent = Number.isFinite(meterPercent)
                            ? Math.max(3, Math.min(100, meterPercent as number))
                            : 0
                          const windowReset = formatResetShort({ resetAt: windowEntry.resetAt })
                          const title = `${windowEntry.label}: ${windowEntry.limitLabel}${windowReset ? ` · resets ${windowReset}` : ''}`
                          return (
                            <div key={`${entry.provider}-${windowEntry.id}`} className="model-usage-window" title={title}>
                              <div className="model-usage-window-row">
                                <span>{windowEntry.label}</span>
                                <span>{windowEntry.limitLabel}</span>
                              </div>
                              <div className="model-usage-meter-track model-usage-window-track">
                                <div className="model-usage-meter-fill model-usage-window-fill" style={{ width: `${windowPercent}%` }} />
                              </div>
                              <div className="model-usage-window-meta">
                                <span>Usage limit</span>
                                {windowReset && <span>resets {windowReset}</span>}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="sidebar-footer">
        <button className="sidebar-footer-settings" onClick={onOpenSettings} title="Settings" aria-label="Open settings">
          <GearSymbolIcon />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
}
