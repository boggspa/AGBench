import type { PinnedMessageGroup } from '../../../main/store/types'
import { MarkdownMessage } from './MarkdownMessage'
import { ProviderBadgeIcon } from './Sidebar'

interface PinnedMessagesSettingsPageProps {
  groups: PinnedMessageGroup[]
  onOpenPinnedMessage?: (chatId: string, messageId: string) => void
}

function formatPinnedTimestamp(value: number): string {
  if (!Number.isFinite(value)) return ''
  try {
    return new Date(value).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return ''
  }
}

function copyPinnedText(text: string): void {
  if (!text) return
  void navigator.clipboard?.writeText(text).catch(() => {})
}

export function PinnedMessagesSettingsPage({
  groups,
  onOpenPinnedMessage
}: PinnedMessagesSettingsPageProps): React.JSX.Element {
  const totalPins = groups.reduce(
    (total, group) =>
      total +
      group.chats.reduce((chatTotal, chat) => chatTotal + chat.messages.length, 0),
    0
  )

  if (groups.length === 0) {
    return (
      <div className="settings-pinned-messages">
        <div className="settings-model-usage-empty" role="note">
          <strong>No pinned messages yet.</strong>
          <span>Pin a message from any transcript to keep it here.</span>
        </div>
      </div>
    )
  }

  return (
    <div className="settings-pinned-messages">
      <p className="settings-model-usage-description">
        {totalPins} pinned {totalPins === 1 ? 'message' : 'messages'} across {groups.length}{' '}
        {groups.length === 1 ? 'workspace' : 'workspaces'}.
      </p>
      <div className="settings-pinned-workspace-list">
        {groups.map((group) => (
          <section
            key={group.workspaceId || group.workspacePath || group.workspaceDisplayName}
            className="settings-pinned-workspace"
          >
            <header className="settings-pinned-workspace-header">
              <span>{group.workspaceDisplayName}</span>
              <small>{group.chats.length} threads</small>
            </header>
            <div className="settings-pinned-chat-list">
              {group.chats.map((chat) => (
                <article key={chat.chatId} className="settings-pinned-chat">
                  <header className="settings-pinned-chat-header">
                    <span className={`settings-pinned-chat-provider provider-${chat.provider || 'gemini'}`}>
                      {chat.provider && <ProviderBadgeIcon provider={chat.provider} />}
                      <strong>{chat.chatTitle || 'Untitled chat'}</strong>
                    </span>
                    <small>{chat.messages.length} pins</small>
                  </header>
                  {chat.pinnedNotes?.trim() && (
                    <div className="settings-pinned-notes-preview">
                      <MarkdownMessage content={chat.pinnedNotes} />
                    </div>
                  )}
                  <div className="settings-pinned-message-list">
                    {chat.messages.map((message) => (
                      <div key={message.id} className={`settings-pinned-message role-${message.role}`}>
                        <div className="settings-pinned-message-meta">
                          <span>{message.role}</span>
                          <span>{formatPinnedTimestamp(message.pinnedAt)}</span>
                        </div>
                        <div className="settings-pinned-message-body">
                          <MarkdownMessage content={message.content} />
                        </div>
                        <div className="settings-pinned-message-actions">
                          <button
                            type="button"
                            onClick={() => copyPinnedText(message.content)}
                            title="Copy pinned message"
                          >
                            Copy
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenPinnedMessage?.(chat.chatId, message.id)}
                            title="Open source message"
                          >
                            Open
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
