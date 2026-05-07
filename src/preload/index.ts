import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { GeminiWorktreeLaunchOption, ProviderId } from '../main/store/types'

// Custom APIs for renderer
const api = {
  selectWorkspace: () => ipcRenderer.invoke('select-workspace'),
  selectImageFiles: () => ipcRenderer.invoke('select-image-files'),
  selectExternalPathGrant: (access: 'read' | 'write' = 'read') => ipcRenderer.invoke('select-external-path-grant', access),
  runGemini: (workspace: string, prompt: string, model: string, approvalMode: string, sessionTrust: boolean = false, imagePaths: string[] = [], resumeSessionId: string | null = null, worktree: GeminiWorktreeLaunchOption = null, route: any = null) =>
    ipcRenderer.invoke('run-gemini', workspace, prompt, model, approvalMode, sessionTrust, imagePaths, resumeSessionId, worktree, route),
  cancelGemini: (runId?: string) => ipcRenderer.invoke('cancel-gemini', runId),
  runAgent: (payload: any) => ipcRenderer.invoke('run-agent', payload),
  cancelAgentRun: (provider: ProviderId = 'gemini', runId?: string) => ipcRenderer.invoke('cancel-agent-run', provider, runId),
  getAgentStatus: (provider: ProviderId) => ipcRenderer.invoke('get-agent-status', provider),
  getProviderCapabilities: (provider: ProviderId, workspace?: string, approvalMode?: string) =>
    ipcRenderer.invoke('get-provider-capabilities', provider, workspace, approvalMode),
  getProviderAdapters: () => ipcRenderer.invoke('get-provider-adapters'),
  getAgentModels: (provider: ProviderId) => ipcRenderer.invoke('get-agent-models', provider),
  getAgentRateLimits: (provider: ProviderId) => ipcRenderer.invoke('get-agent-rate-limits', provider),
  importCodexUsageCredential: (filePath?: string) => ipcRenderer.invoke('import-codex-usage-credential', filePath),
  clearCodexUsageCredential: () => ipcRenderer.invoke('clear-codex-usage-credential'),
  getCodexUsageSnapshot: () => ipcRenderer.invoke('get-codex-usage-snapshot'),
  getAgentMcpStatus: (provider: ProviderId) => ipcRenderer.invoke('get-agent-mcp-status', provider),
  listAgentThreads: (provider: ProviderId, params: any = {}) => ipcRenderer.invoke('list-agent-threads', provider, params),
  forkAgentThread: (provider: ProviderId, threadId: string, params: any = {}) => ipcRenderer.invoke('fork-agent-thread', provider, threadId, params),
  rollbackAgentThread: (provider: ProviderId, threadId: string, numTurns: number = 1) =>
    ipcRenderer.invoke('rollback-agent-thread', provider, threadId, numTurns),
  startAgentReview: (provider: ProviderId, threadId: string, params: any = {}) =>
    ipcRenderer.invoke('start-agent-review', provider, threadId, params),
  respondAgentApproval: (requestId: string, action: 'accept' | 'acceptForSession' | 'acceptForWorkspace' | 'decline' | 'cancel') =>
    ipcRenderer.invoke('respond-agent-approval', requestId, action),
  writeGeminiInput: (data: string) => ipcRenderer.invoke('write-gemini-input', data),
  getDiff: (workspace: string) => ipcRenderer.invoke('get-diff', workspace),
  listWorkspaceFiles: (workspace: string) => ipcRenderer.invoke('list-workspace-files', workspace),
  readWorkspaceFile: (workspace: string, path: string) => ipcRenderer.invoke('read-workspace-file', workspace, path),
  writeWorkspaceFile: (workspace: string, path: string, content: string) =>
    ipcRenderer.invoke('write-workspace-file', workspace, path, content),
  captureSnapshot: (workspace: string) => ipcRenderer.invoke('capture-snapshot', workspace),
  computeRunDiff: (runId: string, preSnapshot: any, postSnapshot: any) => ipcRenderer.invoke('compute-run-diff', runId, preSnapshot, postSnapshot),
  getWorkspaceChangeSets: (filter: any = {}) => ipcRenderer.invoke('get-workspace-change-sets', filter),
  recordWorkspaceRunChange: (input: any) => ipcRenderer.invoke('record-workspace-run-change', input),
  getGeminiVersion: () => ipcRenderer.invoke('get-gemini-version'),
  getGeminiCapabilities: (workspace?: string) => ipcRenderer.invoke('get-gemini-capabilities', workspace),
  getGeminiMcpBridgeStatus: () => ipcRenderer.invoke('get-gemini-mcp-bridge-status'),
  installGeminiMcpBridge: () => ipcRenderer.invoke('install-gemini-mcp-bridge'),
  setGeminiMcpBridgeEnabled: (enabled: boolean) => ipcRenderer.invoke('set-gemini-mcp-bridge-enabled', enabled),
  runApprovedHostCommand: (requestId: string) => ipcRenderer.invoke('run-approved-host-command', requestId),
  listGeminiSessions: () => ipcRenderer.invoke('list-gemini-sessions'),
  getHostWeather: () => ipcRenderer.invoke('get-host-weather'),
  setAppearanceMode: (payload: { mode?: string; reduceTransparency?: boolean } | string) =>
    ipcRenderer.invoke('set-appearance-mode', payload),
  
  // Trust and PTY
  checkTrust: (workspacePath: string) => ipcRenderer.invoke('check-trust', workspacePath),
  startPty: (workspacePath: string) => ipcRenderer.invoke('start-pty', workspacePath),
  ptyWrite: (data: string) => ipcRenderer.invoke('pty-write', data),
  ptyResize: (cols: number, rows: number) => ipcRenderer.invoke('pty-resize', cols, rows),
  startGeminiSession: (
    workspace: string,
    model: string = 'cli-default',
    approvalMode: string = 'default',
    sessionTrust: boolean = false,
    cols: number = 80,
    rows: number = 24,
    resumeSessionId: string | null = null,
    worktree: GeminiWorktreeLaunchOption = null
  ) => ipcRenderer.invoke('start-gemini-session', workspace, model, approvalMode, sessionTrust, cols, rows, resumeSessionId, worktree),
  stopGeminiSession: () => ipcRenderer.invoke('stop-gemini-session'),
  writeGeminiSession: (data: string) => ipcRenderer.invoke('write-gemini-session', data),
  resizeGeminiSession: (cols: number, rows: number) => ipcRenderer.invoke('resize-gemini-session', cols, rows),
  discoverGeminiCommands: (workspace: string) => ipcRenderer.invoke('discover-gemini-commands', workspace),
  discoverGeminiMemory: (workspace: string) => ipcRenderer.invoke('discover-gemini-memory', workspace),
  getFileIconDataUrl: (path: string) => ipcRenderer.invoke('get-file-icon', path),
  onPtyData: (callback: (data: string) => void) => {
    ipcRenderer.on('pty-data', (_event, data) => callback(data))
  },
  onPtyExit: (callback: (code: number | null) => void) => {
    ipcRenderer.on('pty-exit', (_event, code) => callback(code))
  },
  removePtyListeners: () => {
    ipcRenderer.removeAllListeners('pty-data')
    ipcRenderer.removeAllListeners('pty-exit')
  },
  onGeminiSessionData: (callback: (data: string) => void) => {
    ipcRenderer.on('gemini-session-data', (_event, data) => callback(data))
  },
  onGeminiSessionExit: (callback: (code: number | null) => void) => {
    ipcRenderer.on('gemini-session-exit', (_event, code) => callback(code))
  },
  removeGeminiSessionListeners: () => {
    ipcRenderer.removeAllListeners('gemini-session-data')
    ipcRenderer.removeAllListeners('gemini-session-exit')
  },

  // Store APIs
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (partial: any) => ipcRenderer.invoke('update-settings', partial),
  getWorkspaces: () => ipcRenderer.invoke('get-workspaces'),
  addOrUpdateWorkspace: (path: string, partial: any = {}) => ipcRenderer.invoke('add-or-update-workspace', path, partial),
  removeWorkspace: (id: string) => ipcRenderer.invoke('remove-workspace', id),
  clearWorkspaces: () => ipcRenderer.invoke('clear-workspaces'),
  getChats: (workspaceId?: string) => ipcRenderer.invoke('get-chats', workspaceId),
  getChat: (chatId: string) => ipcRenderer.invoke('get-chat', chatId),
  createChat: (workspaceId: string, workspacePath: string) => ipcRenderer.invoke('create-chat', workspaceId, workspacePath),
  saveChat: (chat: any) => ipcRenderer.invoke('save-chat', chat),
  deleteChat: (chatId: string) => ipcRenderer.invoke('delete-chat', chatId),
  clearChats: (workspaceId?: string) => ipcRenderer.invoke('clear-chats', workspaceId),
  recordUsage: (usage: any) => ipcRenderer.invoke('record-usage', usage),
  getUsage: (workspaceId?: string, chatId?: string) => ipcRenderer.invoke('get-usage', workspaceId, chatId),
  getScheduledTasks: (workspaceId?: string) => ipcRenderer.invoke('get-scheduled-tasks', workspaceId),
  saveScheduledTask: (task: any) => ipcRenderer.invoke('save-scheduled-task', task),
  updateScheduledTask: (id: string, partial: any) => ipcRenderer.invoke('update-scheduled-task', id, partial),
  deleteScheduledTask: (id: string) => ipcRenderer.invoke('delete-scheduled-task', id),
  getRunQueueJobs: (filter: any = {}) => ipcRenderer.invoke('get-run-queue-jobs', filter),
  saveRunQueueJob: (job: any) => ipcRenderer.invoke('save-run-queue-job', job),
  updateRunQueueJob: (runIdOrId: string, partial: any) => ipcRenderer.invoke('update-run-queue-job', runIdOrId, partial),
  deleteRunQueueJob: (runIdOrId: string) => ipcRenderer.invoke('delete-run-queue-job', runIdOrId),
  getRunRecoveryRecords: (filter: any = {}) => ipcRenderer.invoke('get-run-recovery-records', filter),
  appendRunEvent: (event: any) => ipcRenderer.invoke('append-run-event', event),
  appendRunEvents: (events: any[]) => ipcRenderer.invoke('append-run-events', events),
  getRunEvents: (filter: any = {}) => ipcRenderer.invoke('get-run-events', filter),
  getRunEventReplay: (runId: string) => ipcRenderer.invoke('get-run-event-replay', runId),
  getApprovalLedger: (filter: any = {}) => ipcRenderer.invoke('get-approval-ledger', filter),
  getProductOperationsStatus: () => ipcRenderer.invoke('get-product-operations-status'),
  getProductCrashes: (filter: any = {}) => ipcRenderer.invoke('get-product-crashes', filter),
  recordProductCrash: (input: any) => ipcRenderer.invoke('record-product-crash', input),
  exportProductDiagnostics: (path?: string) => ipcRenderer.invoke('export-product-diagnostics', path),
  repairProductInstall: () => ipcRenderer.invoke('repair-product-install'),

  onGeminiOutput: (callback: (data: any) => void) => {
    ipcRenderer.on('gemini-output', (_event, data) => callback(data))
  },
  onGeminiError: (callback: (error: any) => void) => {
    ipcRenderer.on('gemini-error', (_event, error) => callback(error))
  },
  onGeminiExit: (callback: (code: any) => void) => {
    ipcRenderer.on('gemini-exit', (_event, code) => callback(code))
  },
  onAgentOutput: (callback: (payload: any) => void) => {
    ipcRenderer.on('agent-output', (_event, payload) => callback(payload))
  },
  onAgentError: (callback: (payload: any) => void) => {
    ipcRenderer.on('agent-error', (_event, payload) => callback(payload))
  },
  onAgentExit: (callback: (payload: any) => void) => {
    ipcRenderer.on('agent-exit', (_event, payload) => callback(payload))
  },
  onRunQueueChanged: (callback: (jobs: any[]) => void) => {
    ipcRenderer.on('run-queue-changed', (_event, jobs) => callback(jobs))
  },
  onRunEventsChanged: (callback: (payload: any) => void) => {
    ipcRenderer.on('run-events-changed', (_event, payload) => callback(payload))
  },
  onAgentApprovalRequest: (callback: (payload: any) => void) => {
    ipcRenderer.on('agent-approval-request', (_event, payload) => callback(payload))
  },
  onScheduledTaskDue: (callback: (payload: any) => void) => {
    ipcRenderer.on('scheduled-task-due', (_event, payload) => callback(payload))
  },
  onScheduledTasksChanged: (callback: (payload: any) => void) => {
    ipcRenderer.on('scheduled-tasks-changed', (_event, payload) => callback(payload))
  },
  removeListeners: () => {
    ipcRenderer.removeAllListeners('gemini-output')
    ipcRenderer.removeAllListeners('gemini-error')
    ipcRenderer.removeAllListeners('gemini-exit')
    ipcRenderer.removeAllListeners('agent-output')
    ipcRenderer.removeAllListeners('agent-error')
    ipcRenderer.removeAllListeners('agent-exit')
    ipcRenderer.removeAllListeners('run-queue-changed')
    ipcRenderer.removeAllListeners('run-events-changed')
    ipcRenderer.removeAllListeners('agent-approval-request')
    ipcRenderer.removeAllListeners('scheduled-task-due')
    ipcRenderer.removeAllListeners('scheduled-tasks-changed')
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
