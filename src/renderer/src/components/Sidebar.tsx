import { useState, useEffect, type MouseEvent } from 'react';
import type { WorkspaceRecord, ChatRecord, ProviderId } from '../../../main/store/types';

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
    }>;
  }>;
  runningChatIds?: string[];
  onSelectWorkspace: (ws: WorkspaceRecord) => void;
  onRemoveWorkspace: (id: string, e: MouseEvent<HTMLButtonElement>) => void;
  onSelectWorkspaceDialog: () => void;
  onNewChat: (wsId: string, wsPath: string) => void;
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

function ChatBubbleSymbolIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.3 3.9h9.4a2 2 0 0 1 2 2v3.4a2 2 0 0 1-2 2H9.3l-2.2 2.1v-2H3.3a2 2 0 0 1-2-2V5.9a2 2 0 0 1 2-2z" />
        <circle cx="5.8" cy="6.8" r=".6" />
        <circle cx="8" cy="6.8" r=".6" />
        <circle cx="10.2" cy="6.8" r=".6" />
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
    const bucket = grouped.get(chat.workspaceId);
    if (bucket) {
      bucket.push(chat);
    } else {
      grouped.set(chat.workspaceId, [chat]);
    }
  }
  return grouped;
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
  onSelectChat,
  onOpenSettings,
}: SidebarProps) {
  const [hoveredWorkspace, setHoveredWorkspace] = useState<string | null>(null);
  const [ageNow, setAgeNow] = useState(() => Date.now());
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
  const runningChatIdSet = new Set(runningChatIds);
  useEffect(() => {
    const interval = window.setInterval(() => setAgeNow(Date.now()), 60000);
    return () => window.clearInterval(interval);
  }, []);

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

  const formatResetTitle = (entry: { resetAt?: string; resetText?: string }) => {
    if (entry.resetAt) {
      const parsed = new Date(entry.resetAt);
      if (!Number.isNaN(parsed.getTime())) {
        return `Resets ${parsed.toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}`;
      }
    }
    return entry.resetText ? `Resets ${entry.resetText}` : undefined;
  };

    return (
      <div className="app-sidebar">
        <div className="sidebar-content">
          {/* Workspaces */}
          <div className="sidebar-workspace-scroll">
            <div className="sidebar-section-header">
              <h4 className="sidebar-section-title">Workspaces</h4>
              <button className="btn btn-sm btn-ghost" onClick={onSelectWorkspaceDialog} title="Add workspace">
                +
              </button>
            </div>
            <div className="sidebar-workspace-list">
              {workspaces.map((ws) => {
                const workspaceChats = chatsByWorkspace.get(ws.id) || [];
                const expanded = expandedWorkspaceIds.has(ws.id);
                return (
                  <div key={ws.id} className="sidebar-workspace-group">
                    <div
                      className={`sidebar-item ${currentWorkspace?.id === ws.id ? 'active' : ''}`}
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
                      {workspaceChats.length > 0 ? (
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
                    <span className="sidebar-item-text" title={ws.path}>
                      {ws.displayName}
                    </span>
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
                  {workspaceChats.length > 0 && expanded ? (
                    <div className="sidebar-chat-list">
                      {workspaceChats.map((chat) => {
                        const chatAgeTimestamp = chat.updatedAt || chat.createdAt;
                        const chatAgeLabel = formatChatAge(chatAgeTimestamp, ageNow);
                        const isChatRunning = runningChatIdSet.has(chat.appChatId);
                        return (
                          <button
                            type="button"
                            key={chat.appChatId}
                            className={`sidebar-item sidebar-chat-item ${currentChat?.appChatId === chat.appChatId ? 'active' : ''} ${isChatRunning ? 'running' : ''}`}
                            onClick={() => onSelectChat(chat)}
                          >
                            <ChatBubbleSymbolIcon />
                            <span className="sidebar-item-text" title={chat.title}>
                              <SidebarProviderLabel provider={chat.provider} />
                              <span className="sidebar-provider-separator"> · </span>
                              <span>{chat.title}</span>
                            </span>
                            {isChatRunning && (
                              <span className="sidebar-chat-busy" title="Task running" aria-label="Task running" />
                            )}
                            {chatAgeLabel && (
                              <span className="sidebar-chat-age" title={formatChatAgeTitle(chatAgeTimestamp)}>
                                {chatAgeLabel}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
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
                const maxTokens = Math.max(...usageSummary.map((u) => u.totalTokens), 1)
                return usageSummary.map((entry) => {
                  const isCodexQuotaOnly = entry.provider === 'codex' && entry.model === 'usage limits' && (entry.windows?.length || 0) > 0
                  const limitPercent = entry.totalTokenLimit ? Math.max(0, Math.min(100, (entry.totalTokens / entry.totalTokenLimit) * 100)) : undefined
                  const widthPercent = limitPercent ?? Math.max(0, Math.min(100, (entry.totalTokens / maxTokens) * 100))
                  const ceilingText = entry.totalTokenLimit
                    ? `${entry.totalTokens.toLocaleString()} / ${entry.totalTokenLimit.toLocaleString()}`
                    : `${entry.totalTokens.toLocaleString()} total`
                  const remaining = entry.totalTokenLimit
                    ? Math.max(0, entry.totalTokenLimit - entry.totalTokens)
                    : undefined
                  const percentText = limitPercent !== undefined ? `${Math.round(limitPercent)}%` : undefined
                  const resetText = formatResetShort(entry)
                  const resetTitle = formatResetTitle(entry)
                  const runText = `${entry.runs} run${entry.runs === 1 ? '' : 's'}`
                  const tokenDetailText = `${entry.inputTokens.toLocaleString()} / ${entry.outputTokens.toLocaleString()} in/out${remaining !== undefined ? ` · ${remaining.toLocaleString()} rem` : ''}`
                  return (
                    <div key={`${entry.provider}-${entry.model}`} className={`model-usage-item provider-${entry.provider} ${isCodexQuotaOnly ? 'quota-only' : ''}`}>
                      {!isCodexQuotaOnly && (
                        <div className="run-summary-row">
                          <span title={`${getProviderName(entry.provider)} / ${entry.model}`} className="model-usage-model">
                            <SidebarProviderLabel provider={entry.provider} showModel={entry.model} />
                          </span>
                          <span>{ceilingText}</span>
                        </div>
                      )}
                      {!isCodexQuotaOnly && (
                        <>
                          <div className="model-usage-meter-track">
                            <div className="model-usage-meter-fill" style={{ width: `${widthPercent}%` }} />
                          </div>
                          <div className="model-usage-meta">
                            <span title={tokenDetailText}>{percentText || runText}</span>
                            <span title={resetTitle || tokenDetailText}>{resetText || tokenDetailText}</span>
                          </div>
                        </>
                      )}
                      {entry.provider === 'codex' && entry.windows && entry.windows.length > 0 && (
                        <div className="model-usage-window-list">
                          {entry.windows.map((windowEntry) => {
                            const usedPercent = windowEntry.usedPercent
                            const isRateLimitWindow = usedPercent !== undefined;
                            const windowPercent = windowEntry.runLimitMax
                              ? Math.max(0, Math.min(100, (windowEntry.runs / windowEntry.runLimitMax) * 100))
                              : isRateLimitWindow
                                ? Math.max(3, Math.min(100, usedPercent))
                                : Math.max(6, Math.min(100, entry.runs > 0 ? (windowEntry.runs / entry.runs) * 100 : 6))
                            const windowReset = formatResetShort({ resetAt: windowEntry.resetAt })
                            const title = isRateLimitWindow
                              ? `${windowEntry.label}: ${windowEntry.limitLabel}${windowReset ? ` · resets ${windowReset}` : ''}`
                              : `${windowEntry.runs} local message${windowEntry.runs === 1 ? '' : 's'} · ${windowEntry.totalTokens.toLocaleString()} tokens · ${windowEntry.limitLabel}`
                            return (
                              <div key={`${entry.model}-${windowEntry.id}`} className="model-usage-window" title={title}>
                                <div className="model-usage-window-row">
                                  <span>{windowEntry.label}</span>
                                  <span>{isRateLimitWindow ? windowEntry.limitLabel : windowEntry.trackingOnly ? `${windowEntry.runs} msg${windowEntry.runs === 1 ? '' : 's'} · ${windowEntry.limitLabel}` : `${windowEntry.runs} / ${windowEntry.limitLabel}`}</span>
                                </div>
                                <div className="model-usage-meter-track model-usage-window-track">
                                  <div className="model-usage-meter-fill model-usage-window-fill" style={{ width: `${windowPercent}%` }} />
                                </div>
                                <div className="model-usage-window-meta">
                                  <span>{isRateLimitWindow ? 'Rate limits remaining' : `${windowEntry.totalTokens.toLocaleString()} tokens`}</span>
                                  {windowReset && <span>{isRateLimitWindow ? 'resets' : 'rolls'} {windowReset}</span>}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="sidebar-footer">
        <button className="btn btn-sm btn-ghost" style={{ flex: 1 }} onClick={onOpenSettings}>
          Settings
        </button>
      </div>
    </div>
  );
}
