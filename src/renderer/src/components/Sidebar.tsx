import {
  useMemo,
  useRef,
  useState,
  useEffect,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode
} from 'react'
import type { WorkspaceRecord, ChatRecord, ProviderId } from '../../../main/store/types'
import { selectRecentChats } from '../lib/recentChatsList'
import { ActiveRunsSection } from './ActiveRunsSection'
import { ModelUsageCard } from './ModelUsageCard'
import { SidebarOverflowMenu, type SidebarOverflowMenuItem } from './SidebarOverflowMenu'

const ageTickListeners = new Set<() => void>()
if (typeof window !== 'undefined') {
  window.setInterval(() => {
    ageTickListeners.forEach((listener) => listener())
  }, 60000)
}
function subscribeAgeTick(listener: () => void): () => void {
  ageTickListeners.add(listener)
  return () => {
    ageTickListeners.delete(listener)
  }
}

interface SidebarProps {
  workspaces: WorkspaceRecord[]
  currentWorkspace: WorkspaceRecord | null
  chats: ChatRecord[]
  currentChat: ChatRecord | null
  usageSummary: Array<{
    provider: ProviderId
    model: string
    runs: number
    inputTokens: number
    outputTokens: number
    totalTokens: number
    durationMs: number
    inputTokenLimit?: number
    outputTokenLimit?: number
    totalTokenLimit?: number
    resetAt?: string
    resetText?: string
    windows?: Array<{
      id: string
      label: string
      runs: number
      totalTokens: number
      runLimitMax?: number
      limitLabel: string
      resetAt?: string
      trackingOnly?: boolean
      usedPercent?: number
      remainingPercent?: number
    }>
  }>
  runningChatIds?: string[]
  /**
   * First-launch onboarding hint visibility. When true AND the
   * workspace list is empty, the sidebar renders a faint card
   * under the `+` button pointing the user at "Click + above to
   * add your first workspace". The visibility itself is owned by
   * App.tsx (so the `?` button in the chat-corner pill can flip
   * it on/off); the dismissal flag persists in localStorage via
   * `onDismissOnboardingHint`.
   */
  showOnboardingHint?: boolean
  onDismissOnboardingHint?: () => void
  /**
   * When true, the `+` workspace button renders an extra "Start here"
   * pointer + pulsing ring on top of its normal appearance. Flipped on
   * by the host (App.tsx) for ~6s after the FirstLaunchSheet dismisses
   * for the first time, so the user immediately sees which control
   * adds their first workspace. Visual-only; the click handler stays
   * the same. */
  workspaceAddPointerActive?: boolean
  onSelectWorkspace: (ws: WorkspaceRecord) => void
  onRemoveWorkspace: (id: string, e: MouseEvent<HTMLButtonElement>) => void
  onSelectWorkspaceDialog: () => void
  onNewChat: (wsId: string, wsPath: string) => void
  onNewGlobalChat: () => void
  onNewEnsemble: () => void
  ensembleModeEnabled?: boolean
  onSelectChat: (chat: ChatRecord) => void
  onOpenSettings: () => void
  /** Phase F1: open the SubThreadCreator with `parent` as the parent
   * chat. When undefined the delegate affordance is hidden — keeps
   * the prop optional for any caller that doesn't yet wire it. */
  onCreateSubThread?: (parent: ChatRecord) => void
  /** Toggle the `pinned` flag on a chat. Optional so any caller that
   * hasn't wired persistence yet can omit it — the pin affordance is
   * hidden in that case. */
  onTogglePinChat?: (chatId: string) => void
  /** Toggle the `pinned` flag on a workspace. Optional for the same
   * reason as `onTogglePinChat`. */
  onTogglePinWorkspace?: (workspaceId: string) => void
  /** Toggle the `archived` flag on a chat. Hides the chat from the main
   * sidebar lists; existing filters already drop archived chats so the
   * caller just needs to persist the flag. */
  onToggleArchiveChat?: (chatId: string, nextArchived: boolean) => void
  /** Permanently delete a chat (and its sub-threads, depending on caller
   * semantics). Surfaced from the overflow menu under a separate
   * destructive group so the user has to choose it deliberately. */
  onDeleteChat?: (chatId: string) => void
  /** Phase K1 follow-up: when provided, clicking a row in the pinned
   * "Active runs" sidebar section navigates to the chat AND opens
   * the Run Inspector for that runId. */
  onInspectRun?: (runId: string, chatId: string | undefined) => void
  /** Opens the iPhone/iPad pairing sheet (QR + JSON). When undefined
   * the remote-connection icon falls back to opening Settings →
   * Bridge Networking as a discoverability hint. */
  onShowPairingSheet?: () => void
}

const EXPANDED_WORKSPACES_STORAGE_KEY = 'guigemini-sidebar-expanded-workspace-ids'
const COLLAPSED_SUB_THREAD_PARENTS_STORAGE_KEY = 'guigemini-sidebar-collapsed-sub-thread-parent-ids'

function FolderSymbolIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2.8 4.4h4.1L7.3 5.6h6.5c.6 0 1.1.4 1.1 1v6.2c0 .6-.5 1-1.1 1H2.8C2.2 13.8 1.7 13.4 1.7 12.8V5.5c0-.6.5-1.1 1.1-1.1z" />
      </svg>
    </span>
  )
}

function GearSymbolIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="8" cy="8" r="2.2" />
        <path d="M8 2.5v1M8 12.5v1M2.5 8h1M12.5 8h1M4.2 4.2l.7.7M11.1 11.1l.7.7M11.1 4.9l-.7.7M4.9 11.1l-.7.7" />
      </svg>
    </span>
  )
}

function RemoteConnectionSymbolIcon() {
  return (
    <span className="sf-symbol-icon sidebar-remote-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="5.3" y="5.1" width="5.4" height="8.4" rx="1.2" />
        <path d="M7.1 11.7h1.8" />
        <path d="M4.2 4.2a5.3 5.3 0 0 1 7.6 0" />
        <path d="M5.6 5.7a3.4 3.4 0 0 1 4.8 0" />
        <path d="M6.8 7.1a1.7 1.7 0 0 1 2.4 0" />
      </svg>
    </span>
  )
}

function ChevronSymbolIcon({ isExpanded }: { isExpanded: boolean }) {
  return (
    <span
      className={`sf-symbol-icon sidebar-tree-chevron ${isExpanded ? 'is-expanded' : ''}`}
      aria-hidden
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6.2 4.7 10 8.1 6.2 11.5" />
      </svg>
    </span>
  )
}

function PlusSymbolIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 3.5v9M3.5 8h9" />
      </svg>
    </span>
  )
}

function SearchSymbolIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="7.1" cy="7.1" r="4.1" />
        <path d="m10.1 10.1 3.1 3.1" />
      </svg>
    </span>
  )
}

function XSymbolIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4.7 4.7 11.3 11.3M11.3 4.7 4.7 11.3" />
      </svg>
    </span>
  )
}

function PinSymbolIcon({ filled = false }: { filled?: boolean }) {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9.5 2.2 13.8 6.5l-2.4.7-1.6 3.5-3.4-3.4L9.9 5.7l-.4-3.5Z" />
        <path d="m6.6 9.4-3.4 3.4" />
      </svg>
    </span>
  )
}

// Phase L6 slice 1 — exported for `ModelUsageCard` provider headers.
export function getProviderName(provider?: ProviderId) {
  if (provider === 'codex') return 'Codex'
  if (provider === 'claude') return 'Claude'
  if (provider === 'kimi') return 'Kimi'
  return 'Gemini'
}

// Phase L6 slice 1 — exported so `ModelUsageCard` can reuse the
// same inlined-SVG provider iconography as the sidebar. The full
// logo-asset upgrade lives in slice 4; this stays as the fallback
// when bundled raster assets are unavailable.
export function ProviderBadgeIcon({ provider }: { provider?: ProviderId }) {
  const providerKey = provider || 'gemini'

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
            <path
              d="M4.8 5.1h1.8L8 10.2M4.8 7h2.2"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M8.5 5.15c0-.53.43-.96.96-.96h.72a.93.93 0 0 1 .86 1.32l-.33.79"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : providerKey === 'gemini' ? (
          <>
            <path
              d="M8 4.3c2.3 0 4.2 1.9 4.2 4.2 0 2.3-1.9 4.2-4.2 4.2S3.8 10.8 3.8 8.5A4.2 4.2 0 0 1 8 4.3Z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
            <path
              d="M8 6.5c1 0 1.8.8 1.8 1.8 0 1-1 1.8-1.8 1.8"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
            <path
              d="M8 10.6c-1 0-1.8-.8-1.8-1.8 0-1 1-1.8 1.8-1.8"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </>
        ) : providerKey === 'codex' ? (
          <>
            <path
              d="M5.3 4.7 9.2 8 5.3 11.3M6.5 8h4.7"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M8 4.7v-.9M9.85 8h.9M6.05 11.3h.9"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
            />
          </>
        ) : (
          <>
            <path
              d="M4.2 11.3 7.7 5 11.2 11.3"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M4.9 6.3h5.7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
            <path d="M4.9 8.7h5.7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          </>
        )}
      </svg>
    </span>
  )
}

function SidebarProviderLabel({
  provider,
  showModel
}: {
  provider: ProviderId | undefined
  showModel?: string
}) {
  const providerName = provider || 'gemini'
  return (
    <span className={`sidebar-provider-label provider-${providerName}`}>
      <ProviderBadgeIcon provider={provider} />
      <span>
        {getProviderName(provider)}
        {showModel ? ` / ${showModel}` : ''}
      </span>
    </span>
  )
}

function getChatsByWorkspace(chats: ChatRecord[]): Map<string, ChatRecord[]> {
  const grouped = new Map<string, ChatRecord[]>()
  for (const chat of chats) {
    if (chat.archived) continue
    if (chat.scope === 'global') continue
    if (!chat.workspaceId) continue
    const bucket = grouped.get(chat.workspaceId)
    if (bucket) {
      bucket.push(chat)
    } else {
      grouped.set(chat.workspaceId, [chat])
    }
  }
  return grouped
}

function normalizeSearchText(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function chatMatchesSearch(chat: ChatRecord, query: string): boolean {
  if (!query) return true
  const provider = getProviderName(chat.provider)
  const searchableText = [
    chat.title,
    provider,
    chat.appChatId,
    chat.linkedGeminiSessionId,
    chat.linkedProviderSessionId,
    ...(chat.messages || []).map((message) => `${message.role} ${message.content}`)
  ].join(' ')
  return searchableText.toLowerCase().includes(query)
}

function workspaceMatchesSearch(workspace: WorkspaceRecord, query: string): boolean {
  if (!query) return true
  return [workspace.displayName, workspace.path, workspace.branch]
    .join(' ')
    .toLowerCase()
    .includes(query)
}

function ChatAgeLabel({ timestamp }: { timestamp: number }): ReactNode {
  const [label, setLabel] = useState(() =>
    Number.isFinite(timestamp) ? formatChatAge(timestamp, Date.now()) : ''
  )

  useEffect(() => {
    if (!Number.isFinite(timestamp)) {
      let cancelled = false
      queueMicrotask(() => {
        if (!cancelled) setLabel((prev) => (prev === '' ? prev : ''))
      })
      return () => {
        cancelled = true
      }
    }
    const compute = () => formatChatAge(timestamp, Date.now())
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setLabel((prev) => {
        const next = compute()
        return prev === next ? prev : next
      })
    })
    const unsubscribe = subscribeAgeTick(() => {
      setLabel((prev) => {
        const next = compute()
        return prev === next ? prev : next
      })
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [timestamp])

  if (!label) return null
  return (
    <span className="sidebar-chat-age" title={formatChatAgeTitle(timestamp)}>
      {label}
    </span>
  )
}

function formatChatAge(timestamp: number, now: number): string {
  if (!Number.isFinite(timestamp)) return ''
  const elapsedMs = Math.max(0, now - timestamp)
  const elapsedMinutes = Math.floor(elapsedMs / 60000)
  if (elapsedMinutes < 1) return 'now'
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return `${elapsedHours}h`
  const elapsedDays = Math.floor(elapsedHours / 24)
  if (elapsedDays < 7) return `${elapsedDays}d`

  const date = new Date(timestamp)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString(
    'en-GB',
    sameYear
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: '2-digit' }
  )
}

function formatChatAgeTitle(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return ''
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function getWorkspaceMeta(workspace: WorkspaceRecord): string {
  const pathParts = workspace.path.split(/[\\/]/).filter(Boolean)
  const compactPath = pathParts.length > 2 ? `.../${pathParts.slice(-2).join('/')}` : workspace.path
  return [compactPath, workspace.branch ? `branch ${workspace.branch}` : '']
    .filter(Boolean)
    .join(' · ')
}

function HighlightMatch({ text, query }: { text: string; query: string }): ReactNode {
  if (!query) return text
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const parts: ReactNode[] = []
  let cursor = 0
  let matchIndex = lowerText.indexOf(lowerQuery, cursor)

  while (matchIndex >= 0) {
    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex))
    }
    const matchEnd = matchIndex + lowerQuery.length
    parts.push(
      <mark key={`${matchIndex}-${matchEnd}`} className="sidebar-search-highlight">
        {text.slice(matchIndex, matchEnd)}
      </mark>
    )
    cursor = matchEnd
    matchIndex = lowerText.indexOf(lowerQuery, cursor)
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }

  return parts.length > 0 ? parts : text
}

function getLastRunStatus(
  chat: ChatRecord
): { label: string; tone: 'success' | 'warning' | 'danger' | 'muted' } | null {
  const run = chat.runs?.[chat.runs.length - 1]
  if (!run) return null
  if (!run.endedAt && run.status !== 'failed' && run.status !== 'cancelled') {
    return { label: 'Running', tone: 'warning' }
  }
  if (run.status === 'success') return { label: 'Done', tone: 'success' }
  if (run.status === 'success_with_warnings') return { label: 'Warnings', tone: 'warning' }
  if (run.status === 'failed') return { label: 'Failed', tone: 'danger' }
  if (run.status === 'cancelled') return { label: 'Cancelled', tone: 'muted' }
  return { label: run.status || 'Completed', tone: 'muted' }
}

export function Sidebar({
  workspaces,
  currentWorkspace,
  chats,
  currentChat,
  usageSummary,
  runningChatIds = [],
  showOnboardingHint = false,
  onDismissOnboardingHint,
  workspaceAddPointerActive = false,
  onSelectWorkspace,
  onRemoveWorkspace,
  onSelectWorkspaceDialog,
  onNewChat,
  onNewGlobalChat,
  onNewEnsemble,
  ensembleModeEnabled = true,
  onSelectChat,
  onOpenSettings,
  onCreateSubThread,
  onTogglePinChat,
  onTogglePinWorkspace,
  onToggleArchiveChat,
  onDeleteChat,
  onInspectRun,
  onShowPairingSheet
}: SidebarProps) {
  const [hoveredWorkspace, setHoveredWorkspace] = useState<string | null>(null)
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(EXPANDED_WORKSPACES_STORAGE_KEY)
      if (!raw) return new Set<string>()
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        return new Set<string>()
      }
      return new Set(parsed.filter((value): value is string => typeof value === 'string'))
    } catch {
      return new Set<string>()
    }
  })
  const [collapsedSubThreadParentIds, setCollapsedSubThreadParentIds] = useState<Set<string>>(
    () => {
      try {
        const raw = localStorage.getItem(COLLAPSED_SUB_THREAD_PARENTS_STORAGE_KEY)
        if (!raw) return new Set<string>()
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) {
          return new Set<string>()
        }
        return new Set(parsed.filter((value): value is string => typeof value === 'string'))
      } catch {
        return new Set<string>()
      }
    }
  )
  const regularChats = chats.filter((chat) => chat.chatKind !== 'ensemble')
  const ensembleChats = ensembleModeEnabled
    ? chats.filter((chat) => chat.chatKind === 'ensemble' && !chat.archived)
    : []
  const chatsByWorkspace = getChatsByWorkspace(regularChats)
  const globalChats = regularChats.filter((chat) => !chat.archived && chat.scope === 'global')
  const runningChatIdSet = new Set(runningChatIds)
  const sidebarSearchQuery = normalizeSearchText(sidebarSearch)
  const isSidebarSearchActive = sidebarSearchQuery.length > 0
  const visibleWorkspaceEntries = workspaces
    .map((workspace) => {
      const workspaceChats = chatsByWorkspace.get(workspace.id) || []
      const workspaceMatched = workspaceMatchesSearch(workspace, sidebarSearchQuery)
      const visibleChats = isSidebarSearchActive
        ? workspaceChats.filter((chat) => chatMatchesSearch(chat, sidebarSearchQuery))
        : workspaceChats
      return {
        workspace,
        workspaceMatched,
        visibleChats,
        totalChats: workspaceChats.length
      }
    })
    .filter(
      (entry) => !isSidebarSearchActive || entry.workspaceMatched || entry.visibleChats.length > 0
    )
  const visibleGlobalChats = isSidebarSearchActive
    ? globalChats.filter((chat) => chatMatchesSearch(chat, sidebarSearchQuery))
    : globalChats
  const sidebarSearchResultCount =
    visibleWorkspaceEntries.length +
    visibleWorkspaceEntries.reduce((total, entry) => total + entry.visibleChats.length, 0) +
    visibleGlobalChats.length
  const totalChatCount = chats.filter((chat) => !chat.archived).length

  // Pinned + Recents derivations. Both honor the search query so the
  // sections collapse alongside the rest of the sidebar when the user
  // is filtering. Computed via `useMemo` to keep React's render output
  // stable across renders that don't actually touch chats/workspaces.
  const pinnedWorkspaces = useMemo(
    () => workspaces.filter((workspace) => workspace.pinned === true),
    [workspaces]
  )
  const pinnedChats = useMemo(
    () => regularChats.filter((chat) => chat.pinned === true && !chat.archived),
    [regularChats]
  )
  const recentChats = useMemo(() => selectRecentChats(regularChats, { limit: 5 }), [regularChats])
  const visibleEnsembleChats = isSidebarSearchActive
    ? ensembleChats.filter((chat) => chatMatchesSearch(chat, sidebarSearchQuery))
    : ensembleChats

  const visiblePinnedWorkspaces = isSidebarSearchActive
    ? pinnedWorkspaces.filter((workspace) => workspaceMatchesSearch(workspace, sidebarSearchQuery))
    : pinnedWorkspaces
  const visiblePinnedChats = isSidebarSearchActive
    ? pinnedChats.filter((chat) => chatMatchesSearch(chat, sidebarSearchQuery))
    : pinnedChats
  const visibleRecentChats = isSidebarSearchActive
    ? recentChats.filter((chat) => chatMatchesSearch(chat, sidebarSearchQuery))
    : recentChats

  const handleTogglePinChatClick = (event: MouseEvent<HTMLSpanElement>, chatId: string) => {
    event.preventDefault()
    event.stopPropagation()
    onTogglePinChat?.(chatId)
  }
  const handleTogglePinWorkspaceClick = (
    event: MouseEvent<HTMLButtonElement | HTMLSpanElement>,
    workspaceId: string
  ) => {
    event.preventDefault()
    event.stopPropagation()
    onTogglePinWorkspace?.(workspaceId)
  }

  const renderProviderDot = (provider: ProviderId | undefined): ReactNode => {
    const providerKey = provider || 'gemini'
    return (
      <span
        className="sidebar-provider-dot"
        aria-hidden="true"
        style={{ background: `var(--provider-${providerKey}-color)` }}
      />
    )
  }
  // Phase F1: index child chats by parentChatId so we can render
  // each parent immediately followed by its children, indented. We
  // build it once per render — sidebar size is bounded so cost is
  // negligible.
  const subThreadsByParentId = useMemo(() => {
    const grouped = new Map<string, ChatRecord[]>()
    for (const chat of chats) {
      if (!chat.parentChatId) continue
      const bucket = grouped.get(chat.parentChatId)
      if (bucket) bucket.push(chat)
      else grouped.set(chat.parentChatId, [chat])
    }
    // Sort each bucket oldest-first for stable presentation.
    for (const bucket of grouped.values()) {
      bucket.sort((a, b) => a.createdAt - b.createdAt)
    }
    return grouped
  }, [chats])
  const currentScopeTitle =
    currentWorkspace?.displayName || (currentChat?.scope === 'global' ? 'Global chats' : 'AGBench')
  const currentScopeMeta = currentWorkspace
    ? getWorkspaceMeta(currentWorkspace)
    : 'System-wide agent threads'
  const runningCount = runningChatIdSet.size
  const primaryNewTitle = currentWorkspace
    ? `New chat in ${currentWorkspace.displayName}`
    : 'New system chat'
  const handlePrimaryNewChat = () => {
    setNewMenuOpen(false)
    if (currentWorkspace) {
      onNewChat(currentWorkspace.id, currentWorkspace.path)
      return
    }
    onNewGlobalChat()
  }
  const handleNewEnsemble = () => {
    setNewMenuOpen(false)
    onNewEnsemble()
  }

  useEffect(() => {
    const workspaceIds = new Set(workspaces.map((workspace) => workspace.id))
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setExpandedWorkspaceIds((prev) => {
        const next = new Set<string>()
        for (const workspaceId of prev) {
          if (workspaceIds.has(workspaceId)) {
            next.add(workspaceId)
          }
        }
        if (next.size === prev.size) {
          return prev
        }
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [workspaces])

  useEffect(() => {
    try {
      localStorage.setItem(
        EXPANDED_WORKSPACES_STORAGE_KEY,
        JSON.stringify([...expandedWorkspaceIds])
      )
    } catch {
      // Ignore persistence errors in constrained environments.
    }
  }, [expandedWorkspaceIds])

  useEffect(() => {
    if (chats.length === 0) return
    const parentIds = new Set(subThreadsByParentId.keys())
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setCollapsedSubThreadParentIds((prev) => {
        const next = new Set<string>()
        for (const parentId of prev) {
          if (parentIds.has(parentId)) {
            next.add(parentId)
          }
        }
        if (next.size === prev.size) {
          return prev
        }
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [chats.length, subThreadsByParentId])

  useEffect(() => {
    try {
      localStorage.setItem(
        COLLAPSED_SUB_THREAD_PARENTS_STORAGE_KEY,
        JSON.stringify([...collapsedSubThreadParentIds])
      )
    } catch {
      // Ignore persistence errors in constrained environments.
    }
  }, [collapsedSubThreadParentIds])

  // Phase J2: auto-expand a workspace when a fresh sub-thread arrives
  // inside it. Pairs with the App.tsx onChatUpdated insert-when-not-
  // found fix so a brand-new sub-thread shows up in the sidebar
  // within one render frame of being approved — even if the user had
  // the parent's workspace group collapsed. We diff against a ref of
  // previously-seen appChatIds so we only react to genuine arrivals
  // (won't re-expand a workspace the user just deliberately collapsed
  // while existing sub-threads sit underneath).
  const seenChatIdsRef = useRef<Set<string>>(new Set())
  const seenChatIdsSeededRef = useRef(false)
  useEffect(() => {
    if (!seenChatIdsSeededRef.current) {
      seenChatIdsSeededRef.current = true
      for (const chat of chats) {
        seenChatIdsRef.current.add(chat.appChatId)
      }
      return
    }
    const workspaceIdsToExpand = new Set<string>()
    const parentChatIdsToExpand = new Set<string>()
    for (const chat of chats) {
      if (seenChatIdsRef.current.has(chat.appChatId)) continue
      seenChatIdsRef.current.add(chat.appChatId)
      if (!chat.parentChatId) continue
      if (chat.archived) continue
      parentChatIdsToExpand.add(chat.parentChatId)
      if (!chat.workspaceId) continue
      workspaceIdsToExpand.add(chat.workspaceId)
    }
    if (workspaceIdsToExpand.size > 0) {
      queueMicrotask(() => {
        setExpandedWorkspaceIds((prev) => {
          let changed = false
          const next = new Set(prev)
          for (const id of workspaceIdsToExpand) {
            if (!next.has(id)) {
              next.add(id)
              changed = true
            }
          }
          return changed ? next : prev
        })
      })
    }
    if (parentChatIdsToExpand.size > 0) {
      queueMicrotask(() => {
        setCollapsedSubThreadParentIds((prev) => {
          let changed = false
          const next = new Set(prev)
          for (const id of parentChatIdsToExpand) {
            if (next.delete(id)) {
              changed = true
            }
          }
          return changed ? next : prev
        })
      })
    }
  }, [chats])

  /**
   * Build the items rendered inside a chat tile's overflow menu.
   * Keeps the action set consistent across the four sites that render
   * chat tiles (global chats, pinned, recents, workspace-expanded chats,
   * sub-thread children). Items collapse to an empty array when the
   * caller hasn't wired the corresponding handler — the trigger still
   * renders so layout stays stable.
   */
  const buildChatMenuItems = (chat: ChatRecord): SidebarOverflowMenuItem[] => {
    const items: SidebarOverflowMenuItem[] = []
    if (onTogglePinChat) {
      items.push({
        id: 'pin',
        label: chat.pinned ? 'Unpin' : 'Pin',
        group: 'primary',
        onSelect: () => onTogglePinChat(chat.appChatId)
      })
    }
    if (onToggleArchiveChat) {
      items.push({
        id: 'archive',
        label: chat.archived ? 'Unarchive' : 'Archive',
        group: 'primary',
        onSelect: () => onToggleArchiveChat(chat.appChatId, !chat.archived)
      })
    }
    if (onDeleteChat) {
      items.push({
        id: 'delete',
        label: 'Delete',
        group: 'destructive',
        danger: true,
        onSelect: () => onDeleteChat(chat.appChatId)
      })
    }
    return items
  }

  /**
   * Workspace tile overflow items. Wraps the existing pin / new-chat /
   * remove handlers so the tile's primary affordance set lives in one
   * menu. Existing inline icon buttons stay for now — the menu is
   * additive in this slice.
   */
  const buildWorkspaceMenuItems = (ws: WorkspaceRecord): SidebarOverflowMenuItem[] => {
    const items: SidebarOverflowMenuItem[] = []
    if (onTogglePinWorkspace) {
      items.push({
        id: 'pin',
        label: ws.pinned ? 'Unpin' : 'Pin',
        group: 'primary',
        onSelect: () => onTogglePinWorkspace(ws.id)
      })
    }
    items.push({
      id: 'new-chat',
      label: 'New chat',
      group: 'primary',
      onSelect: () => onNewChat(ws.id, ws.path)
    })
    items.push({
      id: 'remove',
      label: 'Remove workspace',
      group: 'destructive',
      danger: true,
      onSelect: () => {
        // Synthesize a stub event for the existing onRemoveWorkspace signature
        // (it expects a MouseEvent to support stopPropagation). The menu has
        // already swallowed the click, so the stub is a no-op for the caller.
        const stubEvent = {
          preventDefault: () => {},
          stopPropagation: () => {}
        } as unknown as MouseEvent<HTMLButtonElement>
        onRemoveWorkspace(ws.id, stubEvent)
      }
    })
    return items
  }

  const toggleWorkspaceExpanded = (event: MouseEvent<HTMLButtonElement>, workspaceId: string) => {
    event.preventDefault()
    event.stopPropagation()
    setExpandedWorkspaceIds((prev) => {
      const next = new Set(prev)
      if (next.has(workspaceId)) {
        next.delete(workspaceId)
      } else {
        next.add(workspaceId)
      }
      return next
    })
  }

  const toggleSubThreadsExpanded = (
    event: MouseEvent<HTMLSpanElement> | KeyboardEvent<HTMLSpanElement>,
    parentChatId: string
  ) => {
    event.preventDefault()
    event.stopPropagation()
    setCollapsedSubThreadParentIds((prev) => {
      const next = new Set(prev)
      if (next.has(parentChatId)) {
        next.delete(parentChatId)
      } else {
        next.add(parentChatId)
      }
      return next
    })
  }

  const handleAddChat = (event: MouseEvent<HTMLButtonElement>, ws: WorkspaceRecord) => {
    event.preventDefault()
    event.stopPropagation()
    onNewChat(ws.id, ws.path)
  }

  // Phase L6 slice 1 — `formatResetShort` extracted to
  // `lib/UsageFormat.ts`; the Model Usage card now lives in its
  // own `ModelUsageCard` component. Sidebar no longer needs to
  // reference either directly.

  return (
    <div className="app-sidebar">
      <div className="sidebar-content">
        <div className="sidebar-masthead">
          <div className="sidebar-masthead-copy">
            <span className="sidebar-product-label">AGBench</span>
            <strong title={currentWorkspace?.path || currentScopeTitle}>{currentScopeTitle}</strong>
            <span title={currentWorkspace?.path || currentScopeMeta}>{currentScopeMeta}</span>
          </div>
          <div className="sidebar-new-menu-wrap">
            <button
              type="button"
              className="sidebar-primary-action"
              onClick={() => setNewMenuOpen((current) => !current)}
              title="Create"
              aria-label="Create"
              aria-expanded={newMenuOpen}
            >
              <PlusSymbolIcon />
              <span>New</span>
            </button>
            {newMenuOpen && (
              <div className="sidebar-new-menu" role="menu">
                <button type="button" role="menuitem" onClick={handlePrimaryNewChat} title={primaryNewTitle}>
                  New Chat
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setNewMenuOpen(false)
                    onSelectWorkspaceDialog()
                  }}
                >
                  New Workspace
                </button>
                {ensembleModeEnabled && (
                  <button type="button" role="menuitem" onClick={handleNewEnsemble}>
                    New Ensemble
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="sidebar-masthead-stats" aria-label="Sidebar summary">
          <span>
            {workspaces.length} workspace{workspaces.length === 1 ? '' : 's'}
          </span>
          <span>
            {totalChatCount} thread{totalChatCount === 1 ? '' : 's'}
          </span>
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
            {!isSidebarSearchActive && <span className="sidebar-search-hint">⌘F</span>}
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

        {(visiblePinnedWorkspaces.length > 0 || visiblePinnedChats.length > 0) && (
          <div className="sidebar-pinned-section">
            <div className="sidebar-section-header">
              <h4 className="sidebar-section-title">Pinned</h4>
            </div>
            <div className="sidebar-pinned-list">
              {visiblePinnedWorkspaces.map((workspace) => (
                <div
                  key={`pinned-workspace-${workspace.id}`}
                  role="button"
                  tabIndex={0}
                  className={`sidebar-pinned-item ${currentWorkspace?.id === workspace.id ? 'active' : ''}`}
                  onClick={() => onSelectWorkspace(workspace)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelectWorkspace(workspace)
                    }
                  }}
                  title={workspace.path}
                >
                  <FolderSymbolIcon />
                  <span className="sidebar-pinned-label">
                    <HighlightMatch text={workspace.displayName} query={sidebarSearchQuery} />
                  </span>
                  {onTogglePinWorkspace && (
                    <span
                      role="button"
                      tabIndex={0}
                      className="sidebar-pin-toggle is-pinned"
                      onClick={(event) => handleTogglePinWorkspaceClick(event, workspace.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          event.stopPropagation()
                          onTogglePinWorkspace(workspace.id)
                        }
                      }}
                      title="Unpin workspace"
                      aria-label="Unpin workspace"
                    >
                      <PinSymbolIcon filled />
                    </span>
                  )}
                </div>
              ))}
              {visiblePinnedChats.map((chat) => (
                <div
                  key={`pinned-chat-${chat.appChatId}`}
                  role="button"
                  tabIndex={0}
                  className={`sidebar-pinned-item provider-${chat.provider || 'gemini'} ${currentChat?.appChatId === chat.appChatId ? 'active' : ''}`}
                  onClick={() => onSelectChat(chat)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelectChat(chat)
                    }
                  }}
                  title={chat.title}
                >
                  {renderProviderDot(chat.provider)}
                  <span className="sidebar-pinned-label">
                    <HighlightMatch text={chat.title} query={sidebarSearchQuery} />
                  </span>
                  {onTogglePinChat && (
                    <span
                      role="button"
                      tabIndex={0}
                      className="sidebar-pin-toggle is-pinned"
                      onClick={(event) => handleTogglePinChatClick(event, chat.appChatId)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          event.stopPropagation()
                          onTogglePinChat(chat.appChatId)
                        }
                      }}
                      title="Unpin chat"
                      aria-label="Unpin chat"
                    >
                      <PinSymbolIcon filled />
                    </span>
                  )}
                  <SidebarOverflowMenu
                    triggerLabel="Chat actions"
                    items={buildChatMenuItems(chat)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {visibleRecentChats.length > 0 && (
          <div className="sidebar-recents-section">
            <div className="sidebar-section-header">
              <h4 className="sidebar-section-title">Recents</h4>
            </div>
            <div className="sidebar-recents-list">
              {visibleRecentChats.map((chat) => {
                const chatAgeTimestamp = chat.updatedAt || chat.createdAt
                return (
                  <div
                    key={`recent-${chat.appChatId}`}
                    role="button"
                    tabIndex={0}
                    className={`sidebar-recents-item provider-${chat.provider || 'gemini'} ${currentChat?.appChatId === chat.appChatId ? 'active' : ''}`}
                    onClick={() => onSelectChat(chat)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onSelectChat(chat)
                      }
                    }}
                    title={chat.title}
                  >
                    {renderProviderDot(chat.provider)}
                    <span className="sidebar-recents-label">
                      <HighlightMatch text={chat.title} query={sidebarSearchQuery} />
                    </span>
                    <ChatAgeLabel timestamp={chatAgeTimestamp} />
                    {onTogglePinChat && (
                      <span
                        role="button"
                        tabIndex={0}
                        className="sidebar-pin-toggle"
                        onClick={(event) => handleTogglePinChatClick(event, chat.appChatId)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            event.stopPropagation()
                            onTogglePinChat(chat.appChatId)
                          }
                        }}
                        title="Pin chat"
                        aria-label="Pin chat"
                      >
                        <PinSymbolIcon />
                      </span>
                    )}
                    <SidebarOverflowMenu
                      triggerLabel="Chat actions"
                      items={buildChatMenuItems(chat)}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {visibleEnsembleChats.length > 0 && (
          <div className="sidebar-ensembles-section">
            <div className="sidebar-section-header">
              <h4 className="sidebar-section-title">Ensembles</h4>
            </div>
            <div className="sidebar-chat-list sidebar-ensemble-list">
              {visibleEnsembleChats.map((chat) => {
                const activeRound = chat.ensemble?.activeRound
                const activeParticipant = chat.ensemble?.participants.find(
                  (participant) => participant.id === activeRound?.activeParticipantId
                )
                const isRunning = activeRound?.status === 'running'
                const subtitle = activeParticipant
                  ? `${getProviderName(activeParticipant.provider)} / ${activeParticipant.role}`
                  : chat.scope === 'global'
                    ? 'Global ensemble'
                    : 'Workspace ensemble'
                return (
                  <button
                    type="button"
                    key={`ensemble-${chat.appChatId}`}
                    className={`sidebar-item sidebar-chat-item sidebar-ensemble-item ${currentChat?.appChatId === chat.appChatId ? 'active' : ''} ${isRunning ? 'running' : ''}`}
                    onClick={() => onSelectChat(chat)}
                  >
                    <span className="sidebar-chat-copy" title={chat.title}>
                      <span className="sidebar-chat-title-line">
                        <span className="sidebar-provider-label provider-ensemble">
                          <span>Ensemble</span>
                        </span>
                        <span className="sidebar-chat-title">
                          <HighlightMatch text={chat.title} query={sidebarSearchQuery} />
                        </span>
                      </span>
                      <span className="sidebar-chat-subline">
                        <span className={`sidebar-run-status tone-${isRunning ? 'warning' : 'muted'}`}>
                          {isRunning ? `Speaking: ${subtitle}` : subtitle}
                        </span>
                      </span>
                    </span>
                    {isRunning && (
                      <span
                        className="sidebar-chat-busy"
                        title="Ensemble round running"
                        aria-label="Ensemble round running"
                      />
                    )}
                    {!isRunning && <ChatAgeLabel timestamp={chat.updatedAt || chat.createdAt} />}
                    <SidebarOverflowMenu
                      triggerLabel="Ensemble actions"
                      items={buildChatMenuItems(chat)}
                    />
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <ActiveRunsSection
          chats={chats}
          currentChat={currentChat}
          runningChatIds={runningChatIds}
          onSelectChat={onSelectChat}
          onInspectRun={onInspectRun}
        />

        <div className="sidebar-workspace-scroll">
          <div className="sidebar-section-header">
            <h4 className="sidebar-section-title">Workspaces</h4>
            {/*
              `+` workspace button. The wrapping span carries the
              `workspace-add-pointer` class when the host has flipped
              the post-onboarding pointer flag — CSS handles the pulse
              + label. Span-not-button-class because we want the
              animated ring to sit OUTSIDE the button's hover/focus
              rectangle so it doesn't clash with the normal hover ring.
            */}
            <span
              className={
                workspaceAddPointerActive ? 'workspace-add-pointer' : undefined
              }
            >
              <button
                className="btn btn-sm btn-ghost"
                onClick={onSelectWorkspaceDialog}
                title="Add workspace"
                id="sidebar-add-workspace-btn"
              >
                +
              </button>
              {workspaceAddPointerActive && (
                <span className="workspace-add-pointer-label" aria-hidden="true">
                  Start here
                </span>
              )}
            </span>
          </div>
          {/*
            First-launch onboarding hint. Renders only when the
            workspace list is empty AND the App-owned
            `showOnboardingHint` flag is on (which auto-starts true
            for fresh users and stays off after explicit dismissal,
            unless the user re-opens it from the `?` button in
            chat-corner-controls-left). Inline ✕ persists the
            dismissal so the next launch starts hidden too.
          */}
          {showOnboardingHint && workspaces.length === 0 && (
            <div className="sidebar-onboarding-hint" role="note">
              <div className="sidebar-onboarding-hint-body">
                <strong>Add your first workspace</strong>
                <span>
                  Click the <span className="sidebar-onboarding-plus">+</span> above to
                  point AGBench at a project folder. Workspaces hold your chats and let
                  the agent read / edit files inside their trust boundary.
                </span>
              </div>
              {onDismissOnboardingHint && (
                <button
                  className="sidebar-onboarding-hint-dismiss"
                  type="button"
                  onClick={onDismissOnboardingHint}
                  aria-label="Dismiss onboarding hint"
                  title="Dismiss"
                >
                  ✕
                </button>
              )}
            </div>
          )}
          <div className="sidebar-workspace-list">
            {visibleWorkspaceEntries.map(({ workspace: ws, visibleChats, totalChats }) => {
              const expanded = isSidebarSearchActive ? true : expandedWorkspaceIds.has(ws.id)
              const workspaceChats = chatsByWorkspace.get(ws.id) || []
              const workspaceHasRunning = workspaceChats.some((chat) =>
                runningChatIdSet.has(chat.appChatId)
              )
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
                      style={{
                        opacity: hoveredWorkspace === ws.id ? 1 : 0,
                        transition: 'opacity 0.1s'
                      }}
                      onClick={(event) => handleAddChat(event, ws)}
                      title="New chat"
                    >
                      <PlusSymbolIcon />
                    </button>
                    {onTogglePinWorkspace && (
                      <button
                        className={`btn btn-sm btn-ghost btn-icon sidebar-item-action sidebar-pin-toggle ${ws.pinned ? 'is-pinned' : ''}`}
                        style={{
                          opacity: hoveredWorkspace === ws.id || ws.pinned ? 1 : 0,
                          transition: 'opacity 0.1s'
                        }}
                        onClick={(event) => handleTogglePinWorkspaceClick(event, ws.id)}
                        title={ws.pinned ? 'Unpin workspace' : 'Pin workspace'}
                        aria-label={ws.pinned ? 'Unpin workspace' : 'Pin workspace'}
                      >
                        <PinSymbolIcon filled={!!ws.pinned} />
                      </button>
                    )}
                    {(hoveredWorkspace === ws.id || currentWorkspace?.id !== ws.id) && (
                      <button
                        className="btn btn-sm btn-ghost btn-icon sidebar-item-action"
                        style={{
                          opacity: hoveredWorkspace === ws.id ? 1 : 0,
                          transition: 'opacity 0.1s'
                        }}
                        onClick={(event) => onRemoveWorkspace(ws.id, event)}
                        title="Remove"
                      >
                        ×
                      </button>
                    )}
                    <SidebarOverflowMenu
                      triggerLabel="Workspace actions"
                      items={buildWorkspaceMenuItems(ws)}
                    />
                  </div>
                  {visibleChats.length > 0 && expanded ? (
                    <div className="sidebar-chat-list">
                      {visibleChats
                        // Phase F1: hide sub-threads here — they render
                        // nested under their parent below.
                        .filter((chat) => !chat.parentChatId)
                        .map((chat) => {
                          const chatAgeTimestamp = chat.updatedAt || chat.createdAt
                          const isChatRunning = runningChatIdSet.has(chat.appChatId)
                          const lastRunStatus = getLastRunStatus(chat)
                          const subThreads = subThreadsByParentId.get(chat.appChatId) ?? []
                          // Phase I3.2 — "branched · N" badge. The badge
                          // is bright while any sub-thread is running and
                          // dims (still visible) once they've all
                          // terminated, so the user can spot orchestrating
                          // chats at a glance without losing the history.
                          const subThreadCount = subThreads.length
                          const subThreadsExpanded = isSidebarSearchActive
                            ? true
                            : !collapsedSubThreadParentIds.has(chat.appChatId)
                          const liveSubThreadCount = subThreads.reduce(
                            (count, sub) => count + (runningChatIdSet.has(sub.appChatId) ? 1 : 0),
                            0
                          )
                          const branchedBadgeTone = liveSubThreadCount > 0 ? 'active' : 'dim'
                          return (
                            <div key={chat.appChatId} className="sidebar-chat-family">
                              <button
                                type="button"
                                className={`sidebar-item sidebar-chat-item provider-${chat.provider || 'gemini'} ${currentChat?.appChatId === chat.appChatId ? 'active' : ''} ${isChatRunning ? 'running' : ''}`}
                                onClick={() => onSelectChat(chat)}
                              >
                                {subThreadCount > 0 && (
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    className="sidebar-tree-toggle sidebar-chat-tree-toggle"
                                    onClick={(event) =>
                                      toggleSubThreadsExpanded(event, chat.appChatId)
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter' || event.key === ' ') {
                                        toggleSubThreadsExpanded(event, chat.appChatId)
                                      }
                                    }}
                                    title={
                                      subThreadsExpanded
                                        ? 'Collapse sub-threads'
                                        : 'Expand sub-threads'
                                    }
                                    aria-label={
                                      subThreadsExpanded
                                        ? 'Collapse sub-threads'
                                        : 'Expand sub-threads'
                                    }
                                    aria-expanded={subThreadsExpanded}
                                  >
                                    <ChevronSymbolIcon isExpanded={subThreadsExpanded} />
                                  </span>
                                )}
                                <span className="sidebar-chat-copy" title={chat.title}>
                                  <span className="sidebar-chat-title-line">
                                    <SidebarProviderLabel provider={chat.provider} />
                                    <span className="sidebar-chat-title">
                                      <HighlightMatch
                                        text={chat.title}
                                        query={sidebarSearchQuery}
                                      />
                                    </span>
                                  </span>
                                  {(isChatRunning ||
                                    (lastRunStatus &&
                                      lastRunStatus.tone !== 'success' &&
                                      lastRunStatus.tone !== 'muted') ||
                                    subThreadCount > 0) && (
                                    <span className="sidebar-chat-subline">
                                      {isChatRunning ? (
                                        <span className="sidebar-run-status tone-warning">
                                          Running
                                        </span>
                                      ) : lastRunStatus ? (
                                        <span
                                          className={`sidebar-run-status tone-${lastRunStatus.tone}`}
                                        >
                                          {lastRunStatus.label}
                                        </span>
                                      ) : null}
                                      {subThreadCount > 0 && (
                                        <span
                                          className={`sidebar-branched-badge sidebar-branched-${branchedBadgeTone}`}
                                          title={`${liveSubThreadCount} of ${subThreadCount} sub-thread${subThreadCount === 1 ? '' : 's'} running`}
                                          aria-label={`branched ${subThreadCount} sub-thread${subThreadCount === 1 ? '' : 's'}`}
                                        >
                                          branched · {subThreadCount}
                                        </span>
                                      )}
                                    </span>
                                  )}
                                </span>
                                {isChatRunning && (
                                  <span
                                    className="sidebar-chat-busy"
                                    title="Task running"
                                    aria-label="Task running"
                                  />
                                )}
                                {!isChatRunning && <ChatAgeLabel timestamp={chatAgeTimestamp} />}
                                {onTogglePinChat && (
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    className={`sidebar-pin-toggle sidebar-chat-pin ${chat.pinned ? 'is-pinned' : ''}`}
                                    onClick={(event) =>
                                      handleTogglePinChatClick(event, chat.appChatId)
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        onTogglePinChat(chat.appChatId)
                                      }
                                    }}
                                    title={chat.pinned ? 'Unpin chat' : 'Pin chat'}
                                    aria-label={chat.pinned ? 'Unpin chat' : 'Pin chat'}
                                  >
                                    <PinSymbolIcon filled={!!chat.pinned} />
                                  </span>
                                )}
                                {onCreateSubThread && (
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    className="sidebar-chat-delegate"
                                    title="Delegate to a sub-thread"
                                    aria-label="Delegate to a sub-thread"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      onCreateSubThread(chat)
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.stopPropagation()
                                        onCreateSubThread(chat)
                                      }
                                    }}
                                  >
                                    ↪
                                  </span>
                                )}
                                <SidebarOverflowMenu
                                  triggerLabel="Chat actions"
                                  items={buildChatMenuItems(chat)}
                                />
                              </button>
                              {subThreads.length > 0 && subThreadsExpanded && (
                                <div className="sidebar-chat-children">
                                  {subThreads.map((subChat) => {
                                    const subRunning = runningChatIdSet.has(subChat.appChatId)
                                    const subLastStatus = getLastRunStatus(subChat)
                                    const subProviderColor = `var(--provider-${subChat.provider || 'gemini'}-color)`
                                    return (
                                      <button
                                        type="button"
                                        key={subChat.appChatId}
                                        className={`sidebar-item sidebar-chat-item sidebar-sub-thread provider-${subChat.provider || 'gemini'} ${currentChat?.appChatId === subChat.appChatId ? 'active' : ''} ${subRunning ? 'running' : ''}`}
                                        onClick={() => onSelectChat(subChat)}
                                      >
                                        <span className="sidebar-sub-thread-prefix" aria-hidden>
                                          ↳
                                        </span>
                                        <span
                                          className="sidebar-sub-thread-dot"
                                          aria-hidden="true"
                                          style={{ background: subProviderColor }}
                                        />
                                        <span className="sidebar-chat-copy" title={subChat.title}>
                                          <span className="sidebar-chat-title-line">
                                            <SidebarProviderLabel provider={subChat.provider} />
                                            <span className="sidebar-chat-title">
                                              <HighlightMatch
                                                text={subChat.title}
                                                query={sidebarSearchQuery}
                                              />
                                            </span>
                                          </span>
                                          {(subRunning ||
                                            (subLastStatus &&
                                              subLastStatus.tone !== 'success' &&
                                              subLastStatus.tone !== 'muted')) && (
                                            <span className="sidebar-chat-subline">
                                              {subRunning ? (
                                                <span className="sidebar-run-status tone-warning">
                                                  Running
                                                </span>
                                              ) : subLastStatus ? (
                                                <span
                                                  className={`sidebar-run-status tone-${subLastStatus.tone}`}
                                                >
                                                  {subLastStatus.label}
                                                </span>
                                              ) : null}
                                            </span>
                                          )}
                                        </span>
                                        <SidebarOverflowMenu
                                          triggerLabel="Sub-thread actions"
                                          items={buildChatMenuItems(subChat)}
                                        />
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })}
                    </div>
                  ) : null}
                </div>
              )
            })}
            {isSidebarSearchActive &&
              visibleWorkspaceEntries.length === 0 &&
              visibleGlobalChats.length === 0 && (
                <div className="sidebar-empty-state">
                  <strong>No matches</strong>
                  <span>Try a workspace name, provider, branch, or thread title.</span>
                </div>
              )}
            <div className="sidebar-section-header sidebar-chats-header">
              <h4 className="sidebar-section-title">Chats</h4>
              <button
                className="btn btn-sm btn-ghost"
                onClick={onNewGlobalChat}
                title="New system chat"
                aria-label="New system chat"
              >
                <PlusSymbolIcon />
              </button>
            </div>
            <div className="sidebar-chat-list sidebar-global-chat-list">
              {visibleGlobalChats.map((chat) => {
                const chatAgeTimestamp = chat.updatedAt || chat.createdAt
                const isChatRunning = runningChatIdSet.has(chat.appChatId)
                const lastRunStatus = getLastRunStatus(chat)
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
                      {(isChatRunning ||
                        (lastRunStatus &&
                          lastRunStatus.tone !== 'success' &&
                          lastRunStatus.tone !== 'muted')) && (
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
                      <span
                        className="sidebar-chat-busy"
                        title="Task running"
                        aria-label="Task running"
                      />
                    )}
                    {!isChatRunning && <ChatAgeLabel timestamp={chatAgeTimestamp} />}
                    {onTogglePinChat && (
                      <span
                        role="button"
                        tabIndex={0}
                        className={`sidebar-pin-toggle sidebar-chat-pin ${chat.pinned ? 'is-pinned' : ''}`}
                        onClick={(event) => handleTogglePinChatClick(event, chat.appChatId)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            event.stopPropagation()
                            onTogglePinChat(chat.appChatId)
                          }
                        }}
                        title={chat.pinned ? 'Unpin chat' : 'Pin chat'}
                        aria-label={chat.pinned ? 'Unpin chat' : 'Pin chat'}
                      >
                        <PinSymbolIcon filled={!!chat.pinned} />
                      </span>
                    )}
                    <SidebarOverflowMenu
                      triggerLabel="Chat actions"
                      items={buildChatMenuItems(chat)}
                    />
                  </button>
                )
              })}
              {visibleGlobalChats.length === 0 && !isSidebarSearchActive && (
                <div className="sidebar-empty-state">No chats yet.</div>
              )}
            </div>
          </div>
        </div>

        {/* Phase L6 slice 1 — Model Usage card extracted to its own
         * component. Phase L6 slices 2-6 will rebuild this card's
         * visual identity to match the another-project compact card
         * (provider logos + warning gradient + pace tick + heatmap)
         * inside the new component, leaving Sidebar untouched. */}
        <ModelUsageCard usageSummary={usageSummary} />
      </div>

      {/* Footer */}
      <div className="sidebar-footer">
        <button
          className="sidebar-footer-settings"
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Open settings"
        >
          <GearSymbolIcon />
          <span>Settings</span>
        </button>
        <button
          type="button"
          className="sidebar-footer-remote"
          onClick={onShowPairingSheet ?? onOpenSettings}
          title={onShowPairingSheet ? 'Pair iPhone / iPad' : 'Remote connection (Settings)'}
          aria-label={
            onShowPairingSheet ? 'Pair iPhone or iPad' : 'Open remote connection settings'
          }
        >
          <RemoteConnectionSymbolIcon />
        </button>
      </div>
    </div>
  )
}
