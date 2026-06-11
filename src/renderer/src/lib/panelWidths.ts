const DEFAULT_FILE_EDITOR_WIDTH = 390
const MIN_RIGHT_PANEL_WIDTH = 300
// Wide-window ceiling. The effective width is additionally clamped to 58%
// of the viewport (rightPanelWindowMax), so narrow windows are protected by
// proportion, not by this constant — it only needs to stop the dock from
// swallowing ultrawide layouts entirely.
const MAX_RIGHT_PANEL_WIDTH = 1120
const DEFAULT_SIDE_CHAT_WIDTH = 460
const MIN_SIDE_CHAT_WIDTH = 340
const MAX_SIDE_CHAT_WIDTH = 1120
// 340 is the comfortable floor (the workspace/model-usage rows read cleanly at
// this width). It's also the default, so a fresh launch — or one where the
// stored width was lost (e.g. the rebrand moved userData/localStorage) — never
// comes up cramped. getStoredWorkspaceSidebarWidth clamps any smaller stored
// value UP to MIN on launch, so the sidebar can be made larger but never smaller.
const DEFAULT_WORKSPACE_SIDEBAR_WIDTH = 340
const MIN_WORKSPACE_SIDEBAR_WIDTH = 340
const MAX_WORKSPACE_SIDEBAR_WIDTH = 560

const clampPanelWidth = (value: number): number => {
  return Math.max(MIN_RIGHT_PANEL_WIDTH, Math.min(MAX_RIGHT_PANEL_WIDTH, Math.round(value)))
}

const clampSideChatWidth = (value: number): number => {
  return Math.max(MIN_SIDE_CHAT_WIDTH, Math.min(MAX_SIDE_CHAT_WIDTH, Math.round(value)))
}

const clampWorkspaceSidebarWidth = (value: number): number => {
  return Math.max(
    MIN_WORKSPACE_SIDEBAR_WIDTH,
    Math.min(MAX_WORKSPACE_SIDEBAR_WIDTH, Math.round(value))
  )
}

const getStoredFileEditorWidth = (): number => {
  try {
    const stored = window.localStorage.getItem('taskwraith.fileEditorWidth')
    const parsed = stored ? Number(stored) : DEFAULT_FILE_EDITOR_WIDTH
    return Number.isFinite(parsed) ? clampPanelWidth(parsed) : DEFAULT_FILE_EDITOR_WIDTH
  } catch {
    return DEFAULT_FILE_EDITOR_WIDTH
  }
}

const getStoredWorkspaceSidebarWidth = (): number => {
  try {
    const stored = window.localStorage.getItem('taskwraith.workspaceSidebarWidth')
    const parsed = stored ? Number(stored) : DEFAULT_WORKSPACE_SIDEBAR_WIDTH
    return Number.isFinite(parsed)
      ? clampWorkspaceSidebarWidth(parsed)
      : DEFAULT_WORKSPACE_SIDEBAR_WIDTH
  } catch {
    return DEFAULT_WORKSPACE_SIDEBAR_WIDTH
  }
}

const sideChatWidthStorageKey = (parentChatId: string): string =>
  `taskwraith.sideChatWidth.${parentChatId}`

const getStoredSideChatWidth = (parentChatId?: string | null): number => {
  if (!parentChatId) return DEFAULT_SIDE_CHAT_WIDTH
  try {
    const stored = window.localStorage.getItem(sideChatWidthStorageKey(parentChatId))
    const parsed = stored ? Number(stored) : DEFAULT_SIDE_CHAT_WIDTH
    return Number.isFinite(parsed) ? clampSideChatWidth(parsed) : DEFAULT_SIDE_CHAT_WIDTH
  } catch {
    return DEFAULT_SIDE_CHAT_WIDTH
  }
}

const setStoredSideChatWidth = (parentChatId: string, width: number): void => {
  try {
    window.localStorage.setItem(
      sideChatWidthStorageKey(parentChatId),
      String(clampSideChatWidth(width))
    )
  } catch {
    // Local persistence is best-effort only.
  }
}

export {
  DEFAULT_FILE_EDITOR_WIDTH,
  MIN_RIGHT_PANEL_WIDTH,
  MAX_RIGHT_PANEL_WIDTH,
  DEFAULT_SIDE_CHAT_WIDTH,
  MIN_SIDE_CHAT_WIDTH,
  MAX_SIDE_CHAT_WIDTH,
  DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
  MIN_WORKSPACE_SIDEBAR_WIDTH,
  MAX_WORKSPACE_SIDEBAR_WIDTH,
  clampPanelWidth,
  clampSideChatWidth,
  clampWorkspaceSidebarWidth,
  getStoredFileEditorWidth,
  getStoredSideChatWidth,
  setStoredSideChatWidth,
  getStoredWorkspaceSidebarWidth
}
