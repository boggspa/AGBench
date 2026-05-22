import type { ChatMessage, ChatRecord, ProviderId } from '../../../main/store/types';

interface SubThreadDelegationCardProps {
  message: ChatMessage;
  /** All chats — used to look up the live sub-thread record by id so the
   * card can render Created / Running / Completed / Returned / Failed status. */
  chats: ChatRecord[];
  /** Which chat ids currently have an active run on the run-queue. The
   * status display ticks "Running ▶" while the sub-thread's id is in
   * this set. */
  runningChatIds?: string[];
  onOpenSubThread?: (chatId: string) => void;
}

type DelegationCardStatus =
  | { kind: 'created' }
  | { kind: 'running' }
  | { kind: 'completed' }
  | { kind: 'failed'; reason?: string }
  | { kind: 'cancelled'; reason?: string }
  | { kind: 'returned' }
  | { kind: 'unknown' };

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

export function isSubThreadDelegationMessage(message: ChatMessage): boolean {
  return message.role === 'system' && message.metadata?.kind === 'subThreadDelegation';
}

/** Determine the visible status of a sub-thread based on its persisted
 * runs + the live run-queue. Pure helper so it's trivially testable + so
 * the parent transcript can re-render without per-card subscriptions. */
export function resolveDelegationStatus(
  subThread: ChatRecord | undefined,
  runningChatIds: Set<string>
): DelegationCardStatus {
  if (!subThread) return { kind: 'unknown' };
  if (runningChatIds.has(subThread.appChatId)) return { kind: 'running' };

  if (subThread.delegationContext?.dispatchError) {
    return {
      kind: 'failed',
      reason: 'Failed to start'
    };
  }

  const lastRun = subThread.runs?.[subThread.runs.length - 1];
  if (!lastRun) {
    // Sub-thread exists but no run has been recorded yet.
    return { kind: 'created' };
  }
  if (
    lastRun.status === 'running' ||
    lastRun.status === 'queued' ||
    lastRun.status === 'starting' ||
    lastRun.status === 'active' ||
    lastRun.status === 'paused'
  ) {
    return { kind: 'running' };
  }
  const resultReturnedAt = subThread.delegationContext?.resultReturnedAt;
  const lastRunEndedAt = lastRun.endedAt ? Date.parse(lastRun.endedAt) : NaN;
  if (
    resultReturnedAt &&
    (!Number.isFinite(lastRunEndedAt) || lastRunEndedAt <= resultReturnedAt)
  ) {
    return { kind: 'returned' };
  }
  if (lastRun.status === 'success' || lastRun.status === 'success_with_warnings') {
    return { kind: 'completed' };
  }
  if (lastRun.status === 'failed') return { kind: 'failed', reason: 'Run failed' };
  if (lastRun.status === 'cancelled') return { kind: 'cancelled', reason: 'Run cancelled' };
  if (!lastRun.endedAt) return { kind: 'running' };
  return { kind: 'unknown' };
}

function statusGlyph(status: DelegationCardStatus): string {
  switch (status.kind) {
    case 'created':
      return '·';
    case 'running':
      return '▶';
    case 'completed':
      return '✓';
    case 'failed':
      return '✗';
    case 'cancelled':
      return '⊘';
    case 'returned':
      return '↩';
    default:
      return '·';
  }
}

function statusLabel(status: DelegationCardStatus): string {
  switch (status.kind) {
    case 'created':
      return 'Created';
    case 'running':
      return 'Running';
    case 'completed':
      return 'Completed';
    case 'failed':
      return status.reason || 'Failed';
    case 'cancelled':
      return status.reason || 'Cancelled';
    case 'returned':
      return 'Returned';
    default:
      return 'Pending';
  }
}

export function SubThreadDelegationCard({
  message,
  chats,
  runningChatIds = [],
  onOpenSubThread
}: SubThreadDelegationCardProps) {
  const metadata = message.metadata || {};
  const subThreadId = textValue(metadata.subThreadId);
  const parentProvider = typeof metadata.parentProvider === 'string'
    ? metadata.parentProvider as ProviderId
    : undefined;
  const targetProvider = typeof metadata.subThreadProvider === 'string'
    ? metadata.subThreadProvider as ProviderId
    : undefined;
  const subThreadTitle = textValue(metadata.subThreadTitle) || 'Untitled sub-thread';
  const promptPreview = textValue(metadata.delegationPromptPreview) || textValue(metadata.delegationPrompt) || '';
  const returnResultToParent = metadata.returnResultToParent === true;

  const subThread = subThreadId ? chats.find((chat) => chat.appChatId === subThreadId) : undefined;
  const runningSet = new Set(runningChatIds);
  const status = resolveDelegationStatus(subThread, runningSet);
  const dispatchErrorMessage = textValue(subThread?.delegationContext?.dispatchError?.message);

  const parentColorVar = `var(--provider-${parentProvider || 'gemini'}-color)`;
  const targetColorVar = `var(--provider-${targetProvider || 'gemini'}-color)`;

  const handleOpen = () => {
    if (subThreadId && onOpenSubThread) onOpenSubThread(subThreadId);
  };

  const isClickable = Boolean(subThreadId && onOpenSubThread);
  const resultReturned = returnResultToParent && status.kind === 'returned';

  return (
    <article
      className={`subthread-delegation-card status-${status.kind} provider-${targetProvider || 'unknown'} ${isClickable ? 'clickable' : ''}`}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={isClickable ? handleOpen : undefined}
      onKeyDown={(event) => {
        if (!isClickable) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleOpen();
        }
      }}
      title={isClickable ? 'Open sub-thread' : undefined}
    >
      <header className="subthread-delegation-header">
        <div className="subthread-delegation-arc" aria-hidden="true">
          <span
            className={`subthread-delegation-chip provider-${parentProvider || 'unknown'}`}
            style={{ background: parentColorVar }}
          >
            {providerLabel(parentProvider)}
          </span>
          <span className="subthread-delegation-arc-arrow">→</span>
          <span
            className={`subthread-delegation-chip provider-${targetProvider || 'unknown'}`}
            style={{ background: targetColorVar }}
          >
            {providerLabel(targetProvider)}
          </span>
        </div>
        <span className={`subthread-delegation-status status-${status.kind}`}>
          <span className="subthread-delegation-status-glyph">{statusGlyph(status)}</span>
          <span>{statusLabel(status)}</span>
        </span>
      </header>
      <div className="subthread-delegation-body">
        <div className="subthread-delegation-title" title={subThreadTitle}>
          {subThreadTitle}
        </div>
        {promptPreview && (
          <div className="subthread-delegation-prompt" title={promptPreview}>
            {promptPreview}
          </div>
        )}
      </div>
      {resultReturned && (
        <div className="subthread-delegation-footer">
          <span aria-hidden="true">↩</span>
          <span>Result returned to this thread</span>
        </div>
      )}
      {dispatchErrorMessage && (
        <div className="subthread-delegation-footer">
          <span aria-hidden="true">!</span>
          <span>{dispatchErrorMessage}</span>
        </div>
      )}
    </article>
  );
}
