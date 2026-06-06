import type { ChatRecord, ProviderId } from '../../../main/store/types'
import { isSubThreadChat } from '../lib/chatScope'

interface SubThreadStatusTickerProps {
  /** The currently-active chat. The ticker only renders when at least
   * one of its direct sub-threads is running. */
  currentChat: ChatRecord | null
  /** All chats — used to find sub-threads whose parentChatId points at
   * the active chat. */
  chats: ChatRecord[]
  /** Live running set so we can skip terminated sub-threads. */
  runningChatIds: string[]
  /** Click handler to navigate to a specific sub-thread. */
  onOpenSubThread?: (chatId: string) => void
}

function providerLabel(provider?: ProviderId): string {
  if (provider === 'codex') return 'Codex'
  if (provider === 'claude') return 'Claude'
  if (provider === 'kimi') return 'Kimi'
  if (provider === 'grok') return 'Grok'
  if (provider === 'cursor') return 'Cursor'
  if (provider === 'gemini') return 'Gemini'
  return 'Sub-thread'
}

/** Subtle status strip rendered above the transcript. Only present
 * while at least one sub-thread of the active chat is running; stays
 * out of the way the rest of the time. */
export function SubThreadStatusTicker({
  currentChat,
  chats,
  runningChatIds,
  onOpenSubThread
}: SubThreadStatusTickerProps) {
  if (!currentChat) return null
  const runningSet = new Set(runningChatIds)
  const activeSubThreads = chats.filter(
    (chat) =>
      isSubThreadChat(chat) &&
      chat.parentChatId === currentChat.appChatId &&
      runningSet.has(chat.appChatId)
  )
  if (activeSubThreads.length === 0) return null

  const parentProvider = currentChat.provider
  const parentColor = `var(--provider-${parentProvider || 'gemini'}-color)`
  const parentLabel = providerLabel(parentProvider)

  return (
    <div className="subthread-status-ticker" role="status" aria-live="polite">
      <div className="subthread-status-ticker-parent">
        <span
          className={`subthread-status-chip provider-${parentProvider || 'gemini'}`}
          style={{ background: parentColor }}
        >
          {parentLabel}
        </span>
        <span className="subthread-status-text">orchestrating</span>
      </div>
      <span className="subthread-status-ticker-divider" aria-hidden="true">
        ·
      </span>
      <div className="subthread-status-ticker-subs">
        {activeSubThreads.map((sub) => {
          const subColor = `var(--provider-${sub.provider || 'gemini'}-color)`
          const subLabel = providerLabel(sub.provider)
          const isClickable = Boolean(onOpenSubThread)
          return (
            <button
              key={sub.appChatId}
              type="button"
              className={`subthread-status-ticker-item provider-${sub.provider || 'gemini'}`}
              onClick={isClickable ? () => onOpenSubThread?.(sub.appChatId) : undefined}
              disabled={!isClickable}
              title={sub.title}
            >
              <span
                className="subthread-status-pulse-dot"
                style={{ background: subColor }}
                aria-hidden="true"
              />
              <span
                className={`subthread-status-chip provider-${sub.provider || 'gemini'}`}
                style={{ background: subColor }}
              >
                {subLabel}
              </span>
              <span className="subthread-status-text">sub-thread active</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
