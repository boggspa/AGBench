const DEFAULT_FILE_EDITOR_WIDTH = 390
const MIN_RIGHT_PANEL_WIDTH = 300
const MAX_RIGHT_PANEL_WIDTH = 720
const DEFAULT_WORKSPACE_SIDEBAR_WIDTH = 260
const MIN_WORKSPACE_SIDEBAR_WIDTH = 220
const MAX_WORKSPACE_SIDEBAR_WIDTH = 440

const clampPanelWidth = (value: number): number => {
  return Math.max(MIN_RIGHT_PANEL_WIDTH, Math.min(MAX_RIGHT_PANEL_WIDTH, Math.round(value)))
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

export {
  DEFAULT_FILE_EDITOR_WIDTH,
  MIN_RIGHT_PANEL_WIDTH,
  MAX_RIGHT_PANEL_WIDTH,
  DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
  MIN_WORKSPACE_SIDEBAR_WIDTH,
  MAX_WORKSPACE_SIDEBAR_WIDTH,
  clampPanelWidth,
  clampWorkspaceSidebarWidth,
  getStoredFileEditorWidth,
  getStoredWorkspaceSidebarWidth
}
