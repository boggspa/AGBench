import { useEffect, useState, type RefObject } from 'react'
import { DiffViewer } from './DiffViewer'
import { TerminalPanel } from './TerminalPanel'
import { BackgroundTasksPanel } from './BackgroundTasksPanel'
import type {
  ChatRecord,
  DiffFileSummary,
  ProviderId,
  ExternalPathGrant,
  GeminiMcpBridgeStatus,
  ProviderCapabilityContract,
  ProviderToolingCapability
} from '../../../main/store/types'
import {
  extractDelegationAuditItems,
  providerDelegationChips,
  summarizeDelegationActivity
} from '../lib/DelegationAudit'

type InspectorTab =
  | 'diff'
  | 'raw'
  | 'delegation'
  | 'timeline'
  | 'safety'
  | 'capabilities'
  | 'background-tasks'
type CapabilityKind = 'mcp' | 'extensions' | 'skills' | 'agents'
type CapabilityFormat = 'json' | 'raw' | 'error'

interface GeminiCapabilityItem {
  id: string
  name: string
  status?: string
  detail?: string
  raw: string
}

interface GeminiCapabilitySection {
  kind: CapabilityKind
  command: string[]
  format: CapabilityFormat
  items: GeminiCapabilityItem[]
  stdout: string
  stderr: string
  status: number | null
  timedOut: boolean
  error?: string
  parsingError?: string
  truncated?: boolean
}

interface GeminiCapabilitiesState {
  refreshedAt: string
  workspace?: string
  sections: Record<CapabilityKind, GeminiCapabilitySection>
}

const CAPABILITY_ORDER: CapabilityKind[] = ['mcp', 'extensions', 'skills', 'agents']
const CAPABILITY_LABELS: Record<CapabilityKind, string> = {
  mcp: 'MCP servers',
  extensions: 'Extensions',
  skills: 'Skills',
  agents: 'Agents'
}

function providerLabel(provider: ProviderId): string {
  if (provider === 'codex') return 'Codex'
  if (provider === 'claude') return 'Claude'
  if (provider === 'kimi') return 'Kimi'
  return 'Gemini'
}

interface InspectorProps {
  rightTab: InspectorTab
  setRightTab: (tab: InspectorTab) => void
  activeDiff: any
  refreshDiff: () => void
  currentWorkspace: any
  diffView: 'this_run' | 'workspace'
  setDiffView: (v: 'this_run' | 'workspace') => void
  runDiff: DiffFileSummary[] | null
  diffRefreshStatus: string
  rawLogs: Array<{
    type: 'stdout' | 'stderr' | 'tool' | 'info'
    content: string
    sequence?: number
    hash?: string
    spanId?: string
    toolCallId?: string
    artifactCount?: number
  }>
  rawFilter: 'all' | 'stdout' | 'stderr' | 'tool'
  setRawFilter: (f: 'all' | 'stdout' | 'stderr' | 'tool') => void
  setRawLogs: (logs: any[]) => void
  rawLogsEndRef: RefObject<HTMLDivElement | null>
  geminiVersion: string
  isOldVersion: boolean
  trustResult: any
  sessionTrust: boolean
  setSessionTrust: (v: boolean) => void
  showTerminal: boolean
  setShowTerminal: (v: boolean) => void
  workspacePath?: string
  provider: ProviderId
  approvalMode: string
  codexStatus?: any
  codexModels?: Array<{
    id: string
    label?: string
    defaultReasoningEffort?: string | null
    additionalSpeedTiers?: string[]
    supportedReasoningEfforts?: Array<{ reasoningEffort: string }>
  }>
  codexMcpStatus?: any
  providerCapabilities?: ProviderCapabilityContract | null
  codexThreads?: any[]
  codexExternalPathGrants?: ExternalPathGrant[]
  geminiMcpBridgeEnabled?: boolean
  geminiMcpBridgeStatus?: GeminiMcpBridgeStatus | null
  onRefreshCodexThreads?: () => void
  onResumeCodexThread?: (threadId: string) => void
  onForkCodexThread?: (threadId: string) => void
  onRollbackCodexThread?: (threadId: string) => void
  onImportCodexUsageCredential?: () => void
  onClearCodexUsageCredential?: () => void
  onInstallGeminiMcpBridge?: () => void
  onRefreshGeminiMcpBridgeStatus?: () => void
  /** Current chat — used by the Background tasks tab to list live subagents. */
  currentChat?: ChatRecord | null
  /** Phase I3.3 — full chat list, used by the Delegation Timeline tab to
   * reconstruct the parent → sub-thread tree for the active chat. */
  chats?: ChatRecord[]
  /** Phase I3.3 — chat ids that currently have an active run, so the
   * timeline can label nodes as "running" vs "completed". */
  runningChatIds?: string[]
  /** Phase I3.3 — navigate to a specific chat when the user clicks a
   * timeline node. */
  onOpenSubThread?: (chatId: string) => void
}

export function Inspector(props: InspectorProps) {
  return (
    <div className="app-inspector">
      <div className="inspector-tabs">
        {(
          [
            'diff',
            'raw',
            'delegation',
            'timeline',
            'safety',
            'capabilities',
            'background-tasks'
          ] as const
        ).map((tab) => (
          <button
            key={tab}
            className={`inspector-tab ${props.rightTab === tab ? 'active' : ''}`}
            onClick={() => props.setRightTab(tab)}
          >
            {tab === 'diff'
              ? 'Diff Studio'
              : tab === 'raw'
                ? 'Raw Events'
                : tab === 'delegation'
                  ? 'Delegation'
                  : tab === 'timeline'
                    ? 'Delegation Timeline'
                    : tab === 'safety'
                      ? 'Safety'
                      : tab === 'capabilities'
                        ? 'Capabilities'
                        : 'Background tasks'}
          </button>
        ))}
      </div>
      <div className="inspector-body">
        {props.rightTab === 'diff' && <DiffTab {...props} />}
        {props.rightTab === 'raw' && <RawTab {...props} />}
        {props.rightTab === 'delegation' && <DelegationTab {...props} />}
        {props.rightTab === 'timeline' && <DelegationTimelineTab {...props} />}
        {props.rightTab === 'safety' && <SafetyTab {...props} />}
        {props.rightTab === 'capabilities' && <CapabilitiesTab {...props} />}
        {props.rightTab === 'background-tasks' && (
          <BackgroundTasksPanel chat={props.currentChat || undefined} provider={props.provider} />
        )}
      </div>
    </div>
  )
}

function useGeminiCapabilities(workspacePath?: string) {
  const [capabilities, setCapabilities] = useState<GeminiCapabilitiesState | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshCapabilities = () => {
    if (!workspacePath) {
      setCapabilities(null)
      setError(null)
      return
    }

    setIsLoading(true)
    setError(null)
    window.api
      .getGeminiCapabilities(workspacePath)
      .then((nextCapabilities) => {
        setCapabilities(nextCapabilities)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        setIsLoading(false)
      })
  }

  useEffect(() => {
    if (!workspacePath) {
      setCapabilities(null)
      setError(null)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)
    window.api
      .getGeminiCapabilities(workspacePath)
      .then((nextCapabilities) => {
        if (!cancelled) setCapabilities(nextCapabilities)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [workspacePath])

  return { capabilities, isLoading, error, refreshCapabilities }
}

function DiffTab(props: InspectorProps) {
  return (
    <div className="diff-studio">
      <div className="diff-studio-toolbar">
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <button
            className={`btn btn-sm ${props.diffView === 'this_run' ? '' : 'btn-ghost'}`}
            onClick={() => props.setDiffView('this_run')}
            disabled={!props.runDiff}
          >
            This run
          </button>
          <button
            className={`btn btn-sm ${props.diffView === 'workspace' ? '' : 'btn-ghost'}`}
            onClick={() => props.setDiffView('workspace')}
          >
            Workspace
          </button>
          {props.diffRefreshStatus && (
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--success)' }}>
              {props.diffRefreshStatus}
            </span>
          )}
        </div>
        <button
          className="btn btn-sm btn-ghost"
          onClick={props.refreshDiff}
          disabled={!props.currentWorkspace}
        >
          Refresh
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <DiffViewer diff={props.activeDiff} workspacePath={props.workspacePath} />
      </div>
    </div>
  )
}

function RawTab({ rawLogs, rawFilter, setRawFilter, setRawLogs, rawLogsEndRef }: InspectorProps) {
  return (
    <div className="diff-studio raw-events-panel">
      <div className="diff-studio-toolbar">
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['all', 'stdout', 'stderr', 'tool'] as const).map((f) => (
            <button
              key={f}
              className={`btn btn-sm ${rawFilter === f ? '' : 'btn-ghost'}`}
              onClick={() => setRawFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              const text = rawLogs.map((l) => `[${l.type.toUpperCase()}] ${l.content}`).join('\n')
              navigator.clipboard.writeText(text)
            }}
          >
            Copy
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setRawLogs([])}>
            Clear
          </button>
        </div>
      </div>
      <div className="raw-events-body">
        {rawLogs
          .filter((l) => rawFilter === 'all' || l.type === rawFilter)
          .map((log, i) => (
            <div
              key={i}
              className="raw-log-line"
              style={{
                color:
                  log.type === 'stderr'
                    ? 'var(--danger)'
                    : log.type === 'tool'
                      ? 'var(--success)'
                      : log.type === 'info'
                        ? 'var(--accent)'
                        : 'var(--text-secondary)'
              }}
            >
              {(log.sequence || log.hash || log.spanId || log.toolCallId || log.artifactCount) && (
                <span className="raw-log-meta">
                  {log.sequence ? `#${log.sequence}` : ''}
                  {log.hash ? ` ${log.hash.slice(0, 10)}` : ''}
                  {log.toolCallId
                    ? ` tool:${log.toolCallId}`
                    : log.spanId
                      ? ` span:${log.spanId}`
                      : ''}
                  {log.artifactCount ? ` artifacts:${log.artifactCount}` : ''}
                </span>
              )}
              {log.content}
            </div>
          ))}
        <div ref={rawLogsEndRef} />
      </div>
    </div>
  )
}

function DelegationTab(props: InspectorProps) {
  const activities = extractDelegationAuditItems(
    props.rawLogs,
    props.provider,
    props.providerCapabilities
  )
  const chips = providerDelegationChips(props.provider, props.providerCapabilities)
  const openFloatingAudit = () => {
    const auditWindow = window.open('', 'agbench-agent-audit', 'width=560,height=760')
    if (!auditWindow) return
    const rows = activities.length
      ? activities
          .map(
            (activity) =>
              `<li><strong>${escapeHtml(activity.name)}</strong><br/><span>${escapeHtml(summarizeDelegationActivity(activity))}</span></li>`
          )
          .join('')
      : '<li>No delegated agent activity detected yet.</li>'
    auditWindow.document.write(`<!doctype html><html><head><title>AGBench Agent Audit</title><style>
      body{margin:0;padding:20px;background:#111;color:#eee;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      h1{font-size:18px;margin:0 0 12px}
      .chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}
      .chip{border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:4px 8px;color:#b8d7ff;background:rgba(255,255,255,.06)}
      li{margin:0 0 14px;padding:12px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:rgba(255,255,255,.05)}
      span{color:#bbb;line-height:1.45}
    </style></head><body><h1>AGBench Agent Audit</h1><div class="chips">${chips.map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`).join('')}</div><ol>${rows}</ol></body></html>`)
    auditWindow.document.close()
  }

  return (
    <div className="safety-panel">
      <div className="diff-studio-toolbar">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
            Provider delegation audit
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
            {activities.length} delegated {activities.length === 1 ? 'activity' : 'activities'}{' '}
            detected from raw/tool events
          </div>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={openFloatingAudit}>
          Floating audit
        </button>
      </div>

      <div className="safety-card">
        <h4>{providerLabel(props.provider)} delegation model</h4>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-xs)',
            marginTop: 'var(--space-sm)'
          }}
        >
          {chips.map((chip) => (
            <span
              key={chip}
              style={{
                fontSize: 'var(--font-size-xs)',
                color: chip.includes('AGBench') ? 'var(--success)' : 'var(--text-secondary)',
                border: '1px solid var(--panel-border)',
                borderRadius: 999,
                padding: '3px 8px',
                background: 'rgba(255,255,255,0.04)'
              }}
            >
              {chip}
            </span>
          ))}
        </div>
      </div>

      {activities.length === 0 ? (
        <div className="safety-card">
          <h4>No child agents yet</h4>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: 0 }}>
            Ask {providerLabel(props.provider)} to spawn or delegate to subagents. AGBench will
            render native provider events here when they appear in the stream.
          </p>
        </div>
      ) : (
        activities.map((activity) => (
          <div key={activity.activityId} className="safety-card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 'var(--space-sm)',
                alignItems: 'flex-start'
              }}
            >
              <h4 style={{ marginBottom: 0 }}>{activity.name}</h4>
              <span
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color:
                    activity.status === 'failed'
                      ? 'var(--danger)'
                      : activity.status === 'success'
                        ? 'var(--success)'
                        : 'var(--warning)',
                  whiteSpace: 'nowrap'
                }}
              >
                {activity.status}
              </span>
            </div>
            <div className="safety-row">
              <span>Kind</span>
              <span>{activity.kind}</span>
            </div>
            <div className="safety-row">
              <span>Provider</span>
              <span>{providerLabel(activity.provider || props.provider)}</span>
            </div>
            {activity.model && (
              <div className="safety-row">
                <span>Model</span>
                <span>{activity.model}</span>
              </div>
            )}
            {activity.providerAgentId && (
              <div className="safety-row">
                <span>Agent id</span>
                <span>{activity.providerAgentId}</span>
              </div>
            )}
            {activity.parentToolCallId && (
              <div className="safety-row">
                <span>Parent tool</span>
                <span>{activity.parentToolCallId}</span>
              </div>
            )}
            {activity.toolPolicy && (
              <div className="safety-row">
                <span>Tool policy</span>
                <span>{activity.toolPolicy}</span>
              </div>
            )}
            {activity.mcpPolicy && (
              <div className="safety-row">
                <span>MCP policy</span>
                <span>{activity.mcpPolicy}</span>
              </div>
            )}
            {(activity.promptPreview || activity.summary) && (
              <p
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--text-secondary)',
                  margin: 'var(--space-sm) 0 0 0',
                  lineHeight: 1.45
                }}
              >
                {activity.summary || activity.promptPreview}
              </p>
            )}
            {(activity.rawEventRefs || []).length > 0 && (
              <div
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--text-tertiary)',
                  marginTop: 'var(--space-sm)'
                }}
              >
                Raw refs{' '}
                {(activity.rawEventRefs || [])
                  .slice(0, 3)
                  .map((ref) =>
                    ref.sequence ? `#${ref.sequence}` : ref.toolCallId || ref.spanId || 'event'
                  )
                  .join(', ')}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}

/** Phase I3.3 — node in the rendered delegation tree. */
interface DelegationTimelineNode {
  chat: ChatRecord
  children: DelegationTimelineNode[]
  isCurrent: boolean
}

/** Pure helper: given a chat list + a focus chat id, return the root of
 * its delegation tree (walks up parentChatId, then collects descendants). */
export function buildDelegationTree(
  chats: ChatRecord[],
  focusChatId?: string
): DelegationTimelineNode | null {
  if (!chats.length) return null
  const byId = new Map(chats.map((chat) => [chat.appChatId, chat]))
  const childrenByParent = new Map<string, ChatRecord[]>()
  for (const chat of chats) {
    if (!chat.parentChatId) continue
    const bucket = childrenByParent.get(chat.parentChatId)
    if (bucket) bucket.push(chat)
    else childrenByParent.set(chat.parentChatId, [chat])
  }
  for (const bucket of childrenByParent.values()) {
    bucket.sort((a, b) => a.createdAt - b.createdAt)
  }

  let rootChat: ChatRecord | undefined = focusChatId ? byId.get(focusChatId) : undefined
  if (!rootChat) return null
  while (rootChat.parentChatId) {
    const parent: ChatRecord | undefined = byId.get(rootChat.parentChatId)
    if (!parent) break
    rootChat = parent
  }

  const build = (chat: ChatRecord): DelegationTimelineNode => {
    const kids = (childrenByParent.get(chat.appChatId) ?? []).map(build)
    return {
      chat,
      children: kids,
      isCurrent: chat.appChatId === focusChatId
    }
  }
  return build(rootChat)
}

function timelineNodeStatus(
  node: DelegationTimelineNode,
  runningChatIds: Set<string>
): { label: string; tone: 'running' | 'completed' | 'failed' | 'cancelled' | 'idle' } {
  if (runningChatIds.has(node.chat.appChatId)) return { label: 'running', tone: 'running' }
  const lastRun = node.chat.runs?.[node.chat.runs.length - 1]
  if (!lastRun) return { label: 'idle', tone: 'idle' }
  if (lastRun.status === 'success' || lastRun.status === 'success_with_warnings') {
    return { label: 'completed', tone: 'completed' }
  }
  if (lastRun.status === 'failed') return { label: 'failed', tone: 'failed' }
  if (lastRun.status === 'cancelled') return { label: 'cancelled', tone: 'cancelled' }
  if (!lastRun.endedAt) return { label: 'running', tone: 'running' }
  return { label: lastRun.status || 'idle', tone: 'idle' }
}

function formatTimelineElapsed(epochMs?: number): string {
  if (!epochMs || !Number.isFinite(epochMs)) return ''
  const elapsed = Math.max(0, Date.now() - epochMs)
  if (elapsed < 60_000) return `started ${Math.floor(elapsed / 1000)}s ago`
  if (elapsed < 3_600_000) return `started ${Math.floor(elapsed / 60_000)}m ago`
  if (elapsed < 86_400_000) return `started ${Math.floor(elapsed / 3_600_000)}h ago`
  return new Date(epochMs).toLocaleString()
}

function DelegationTimelineTreeNode({
  node,
  depth,
  runningChatIds,
  onOpenSubThread
}: {
  node: DelegationTimelineNode
  depth: number
  runningChatIds: Set<string>
  onOpenSubThread?: (chatId: string) => void
}) {
  const status = timelineNodeStatus(node, runningChatIds)
  const provider = node.chat.provider || 'gemini'
  const providerColor = `var(--provider-${provider}-color)`
  const isClickable = Boolean(onOpenSubThread)
  const lastRun = node.chat.runs?.[node.chat.runs.length - 1]
  const elapsed = formatTimelineElapsed(
    lastRun?.startedAt ? Date.parse(lastRun.startedAt) : node.chat.createdAt
  )
  const resultReturned = Boolean(node.chat.delegationContext?.resultReturnedAt)
  const lastAssistant = resultReturned
    ? [...node.chat.messages].reverse().find((m) => m.role === 'assistant')
    : undefined
  const resultPreview = lastAssistant?.content ? lastAssistant.content.slice(0, 120) : undefined

  return (
    <div
      className="delegation-timeline-node"
      style={{ paddingLeft: depth === 0 ? 0 : `${depth * 18}px` }}
    >
      <button
        type="button"
        className={`delegation-timeline-row provider-${provider} status-${status.tone} ${node.isCurrent ? 'is-current' : ''}`}
        onClick={isClickable ? () => onOpenSubThread?.(node.chat.appChatId) : undefined}
        disabled={!isClickable}
        title={node.chat.title}
      >
        <span
          className="delegation-timeline-dot"
          aria-hidden="true"
          style={{ background: providerColor }}
        />
        <span className="delegation-timeline-label">
          <strong>{providerLabel(provider)}</strong>
          <span className="delegation-timeline-title">{node.chat.title}</span>
        </span>
        <span className="delegation-timeline-meta">
          <span>{elapsed}</span>
          <span className={`delegation-timeline-status status-${status.tone}`}>{status.label}</span>
        </span>
      </button>
      {resultReturned && resultPreview && (
        <div
          className="delegation-timeline-result"
          style={{ paddingLeft: `${(depth + 1) * 18}px` }}
        >
          <span aria-hidden="true">↩</span>
          <span>Result back-propagated · {resultPreview.length} chars preview</span>
        </div>
      )}
      {status.tone === 'running' && node.children.length === 0 && (
        <div className="delegation-timeline-empty" style={{ paddingLeft: `${(depth + 1) * 18}px` }}>
          [waiting for completion]
        </div>
      )}
      {node.children.map((child) => (
        <DelegationTimelineTreeNode
          key={child.chat.appChatId}
          node={child}
          depth={depth + 1}
          runningChatIds={runningChatIds}
          onOpenSubThread={onOpenSubThread}
        />
      ))}
    </div>
  )
}

function DelegationTimelineTab(props: InspectorProps) {
  const chats = props.chats ?? []
  const runningChatIds = new Set(props.runningChatIds ?? [])
  const tree = buildDelegationTree(chats, props.currentChat?.appChatId)

  if (!tree) {
    return (
      <div className="safety-panel">
        <div className="safety-card">
          <h4>No active chat selected</h4>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: 0 }}>
            Open a chat to see its delegation tree.
          </p>
        </div>
      </div>
    )
  }

  const totalNodes = countTreeNodes(tree)
  const liveNodes = countLiveTreeNodes(tree, runningChatIds)

  return (
    <div className="safety-panel">
      <div className="diff-studio-toolbar">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
            Delegation timeline
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
            {totalNodes} chat{totalNodes === 1 ? '' : 's'} in this tree · {liveNodes} running
          </div>
        </div>
      </div>
      <div className="delegation-timeline-tree">
        <DelegationTimelineTreeNode
          node={tree}
          depth={0}
          runningChatIds={runningChatIds}
          onOpenSubThread={props.onOpenSubThread}
        />
      </div>
    </div>
  )
}

function countTreeNodes(node: DelegationTimelineNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countTreeNodes(child), 0)
}

function countLiveTreeNodes(node: DelegationTimelineNode, running: Set<string>): number {
  const self = running.has(node.chat.appChatId) ? 1 : 0
  return self + node.children.reduce((sum, child) => sum + countLiveTreeNodes(child, running), 0)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatCapabilityTime(value?: string): string {
  if (!value) return 'Never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function commandStatusLabel(section: GeminiCapabilitySection): string {
  if (section.timedOut) return 'Timed out'
  if (section.error) return 'Error'
  if (section.status === 0) return 'OK'
  if (section.status === null) return 'Unknown'
  return `Exit ${section.status}`
}

function commandStatusColor(section: GeminiCapabilitySection): string {
  if (section.status === 0 && !section.error && !section.timedOut) return 'var(--success)'
  if (section.timedOut || section.error || (section.status !== null && section.status !== 0))
    return 'var(--danger)'
  return 'var(--text-secondary)'
}

function capabilityStatusColor(status?: string): string {
  const normalized = status?.toLowerCase() || ''
  if (/(enabled|active|running|connected|ok|installed|trusted|loaded)/.test(normalized))
    return 'var(--success)'
  if (/(disabled|inactive|disconnected|unavailable)/.test(normalized)) return 'var(--warning)'
  if (/(error|failed|untrusted)/.test(normalized)) return 'var(--danger)'
  return 'var(--text-secondary)'
}

function truncateRawOutput(value: string, maxLength: number = 1800): string {
  if (!value.trim()) return ''
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}\n[preview truncated]`
}

function toolingStateColor(state: ProviderToolingCapability['state']): string {
  if (state === 'available') return 'var(--success)'
  if (state === 'gated' || state === 'delegated') return 'var(--warning)'
  if (state === 'blocked' || state === 'unavailable') return 'var(--danger)'
  return 'var(--text-secondary)'
}

function toolingEnforcementLabel(tool: ProviderToolingCapability): string {
  if (tool.enforcedByAgentBench) return 'AGBench-enforced'
  if (tool.enforcement === 'provider') return 'provider-managed'
  if (tool.enforcement === 'best_effort') return 'best-effort'
  if (tool.enforcement === 'none') return 'not enforced'
  return tool.source === 'provider' ? 'provider-managed' : 'not enforced'
}

function toolingEnforcementColor(tool: ProviderToolingCapability): string {
  if (tool.enforcedByAgentBench) return 'var(--success)'
  if (tool.enforcement === 'best_effort') return 'var(--warning)'
  return 'var(--text-secondary)'
}

function ToolingContractCard({ contract }: { contract?: ProviderCapabilityContract | null }) {
  if (!contract) {
    return (
      <div className="safety-card">
        <h4>Tooling contract</h4>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: 0 }}>
          Provider capability state has not been loaded yet.
        </p>
      </div>
    )
  }

  const tools = [
    contract.tools.shellCommands,
    contract.tools.fileChanges,
    contract.tools.mcpTools,
    contract.tools.networkAccess
  ]
  const enforcedCount = tools.filter((tool) => tool.enforcedByAgentBench).length
  return (
    <div className="safety-card">
      <h4>{contract.label} tooling contract</h4>
      <p
        style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--text-secondary)',
          margin: '0 0 var(--space-md) 0'
        }}
      >
        Shared AGBench view of shell, file, MCP, approval, and unavailable-tool behavior for this
        provider.
      </p>
      <div className="safety-row">
        <span>Availability</span>
        <span
          style={{ color: contract.availability.available ? 'var(--success)' : 'var(--danger)' }}
        >
          {contract.availability.available ? 'available' : 'unavailable'}
        </span>
      </div>
      <div className="safety-row">
        <span>Version</span>
        <span>{contract.availability.version || 'unknown'}</span>
      </div>
      <div className="safety-row">
        <span>Approval mode</span>
        <span>{contract.approvals.providerMode}</span>
      </div>
      <div className="safety-row">
        <span>In-app approvals</span>
        <span>{contract.approvals.inAppApprovals ? 'yes' : 'provider-managed'}</span>
      </div>
      <div className="safety-row">
        <span>AGBench enforcement</span>
        <span style={{ color: enforcedCount > 0 ? 'var(--success)' : 'var(--warning)' }}>
          {enforcedCount}/{tools.length} controls
        </span>
      </div>
      <div className="safety-row">
        <span>MCP</span>
        <span style={{ color: toolingStateColor(contract.mcp.state) }}>{contract.mcp.state}</span>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-sm)',
          marginTop: 'var(--space-md)'
        }}
      >
        {tools.map((tool) => (
          <div
            key={tool.id}
            style={{ borderTop: '1px solid var(--panel-border)', paddingTop: 'var(--space-sm)' }}
          >
            <div
              style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-sm)' }}
            >
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
                {tool.label}
              </span>
              <span
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: toolingStateColor(tool.state),
                  whiteSpace: 'nowrap'
                }}
              >
                {tool.state}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 'var(--space-sm)',
                marginTop: 2
              }}
            >
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
                Enforcement
              </span>
              <span
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: toolingEnforcementColor(tool),
                  whiteSpace: 'nowrap'
                }}
              >
                {toolingEnforcementLabel(tool)}
              </span>
            </div>
            <div
              style={{
                fontSize: 'var(--font-size-xs)',
                color: 'var(--text-tertiary)',
                marginTop: 2
              }}
            >
              {tool.details || `${tool.source}${tool.policy ? ` · ${tool.policy}` : ''}`}
            </div>
            {tool.tools.length > 0 && (
              <div
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--text-secondary)',
                  marginTop: 2,
                  fontFamily: 'var(--font-mono)'
                }}
              >
                {tool.tools.join(', ')}
              </div>
            )}
          </div>
        ))}
      </div>
      {contract.warnings.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-xs)',
            marginTop: 'var(--space-md)'
          }}
        >
          {contract.warnings.slice(0, 4).map((item) => (
            <div
              key={item.id}
              style={{
                fontSize: 'var(--font-size-xs)',
                color:
                  item.severity === 'error'
                    ? 'var(--danger)'
                    : item.severity === 'warning'
                      ? 'var(--warning)'
                      : 'var(--text-secondary)'
              }}
            >
              <strong>{item.title}</strong>: {item.message}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CapabilitiesTab(props: InspectorProps) {
  if (props.provider === 'codex') {
    return (
      <div className="safety-panel">
        <ToolingContractCard contract={props.providerCapabilities} />
        <div className="safety-card">
          <h4>Codex capabilities</h4>
          <p
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-secondary)',
              margin: '0 0 var(--space-md) 0'
            }}
          >
            Codex capability discovery is provider-owned through app-server. Model list is
            available; richer MCP/plugin/app status can be layered onto this panel as the app-server
            status APIs are expanded.
          </p>
          <div className="safety-row">
            <span>CLI</span>
            <span>{props.codexStatus?.version || 'unknown'}</span>
          </div>
          <div className="safety-row">
            <span>App-server</span>
            <span>{props.codexStatus?.appServer || 'lazy'}</span>
          </div>
          <div className="safety-row">
            <span>Models</span>
            <span>{props.codexModels?.length || 0}</span>
          </div>
          <div className="safety-row">
            <span>MCP servers</span>
            <span>{props.codexMcpStatus?.data?.length || 0}</span>
          </div>
        </div>
        {(props.codexModels || []).slice(0, 10).map((model) => (
          <div key={model.id} className="safety-card">
            <h4>{model.label || model.id}</h4>
            <div className="safety-row">
              <span>Model id</span>
              <span>{model.id}</span>
            </div>
            <div className="safety-row">
              <span>Default effort</span>
              <span>{model.defaultReasoningEffort || 'default'}</span>
            </div>
            <div className="safety-row">
              <span>Speed tiers</span>
              <span>{model.additionalSpeedTiers?.join(', ') || 'standard'}</span>
            </div>
          </div>
        ))}
        {(props.codexMcpStatus?.data || []).slice(0, 8).map((server: any) => (
          <div key={server.name} className="safety-card">
            <h4>{server.name}</h4>
            <div className="safety-row">
              <span>Auth</span>
              <span>{server.authStatus || 'unknown'}</span>
            </div>
            <div className="safety-row">
              <span>Tools</span>
              <span>{server.tools ? Object.keys(server.tools).length : 0}</span>
            </div>
          </div>
        ))}
        <div className="safety-card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 'var(--space-sm)'
            }}
          >
            <h4>Codex threads</h4>
            <button
              className="btn btn-sm btn-ghost"
              onClick={props.onRefreshCodexThreads}
              disabled={!props.onRefreshCodexThreads}
            >
              Refresh
            </button>
          </div>
          {(props.codexThreads || []).length === 0 ? (
            <p
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: 0 }}
            >
              No persisted Codex threads found for this workspace yet.
            </p>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-sm)',
                marginTop: 'var(--space-sm)'
              }}
            >
              {(props.codexThreads || []).slice(0, 8).map((thread: any) => (
                <div
                  key={thread.id}
                  style={{
                    borderTop: '1px solid var(--panel-border)',
                    paddingTop: 'var(--space-sm)'
                  }}
                >
                  <div
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {thread.name || thread.preview || thread.id}
                  </div>
                  <div
                    style={{
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--text-tertiary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {thread.status || 'unknown'} · {thread.modelProvider || 'openai'} · {thread.id}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: 'var(--space-sm)',
                      marginTop: 'var(--space-sm)'
                    }}
                  >
                    <button
                      className="btn btn-sm"
                      onClick={() => props.onResumeCodexThread?.(thread.id)}
                    >
                      Resume
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => props.onForkCodexThread?.(thread.id)}
                    >
                      Fork
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => props.onRollbackCodexThread?.(thread.id)}
                      title="Rollback Codex thread history only. This does not revert workspace files."
                    >
                      Rollback thread
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (props.provider === 'claude' || props.provider === 'kimi') {
    const label = providerLabel(props.provider)
    return (
      <div className="safety-panel">
        <ToolingContractCard contract={props.providerCapabilities} />
        <div className="safety-card">
          <h4>{label} capabilities</h4>
          <p
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-secondary)',
              margin: '0 0 var(--space-md) 0'
            }}
          >
            {label} is registered as a first-class provider. Structured quota, thread browser, and
            MCP status are shown only when the provider exposes safe machine-readable APIs.
          </p>
          <div className="safety-row">
            <span>Binary</span>
            <span>{props.codexStatus?.binaryPath || 'not found'}</span>
          </div>
          <div className="safety-row">
            <span>Version</span>
            <span>{props.codexStatus?.version || 'unknown'}</span>
          </div>
          <div className="safety-row">
            <span>Models</span>
            <span>{props.codexModels?.length || 0}</span>
          </div>
          <div className="safety-row">
            <span>Quota</span>
            <span>unavailable</span>
          </div>
          <div className="safety-row">
            <span>MCP status</span>
            <span>{props.codexMcpStatus?.available ? 'available' : 'unavailable'}</span>
          </div>
        </div>
        {(props.codexModels || []).map((model) => (
          <div key={model.id} className="safety-card">
            <h4>{model.label || model.id}</h4>
            <div className="safety-row">
              <span>Model id</span>
              <span>{model.id}</span>
            </div>
          </div>
        ))}
        <div className="safety-card">
          <h4>Sessions and review</h4>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: 0 }}>
            Resume/fork/rollback controls stay disabled until {label} exposes stable structured
            session IDs and rollback semantics. Diff Studio remains shared for file changes.
          </p>
        </div>
      </div>
    )
  }

  const { currentWorkspace } = props
  const workspacePath = currentWorkspace?.path
  const { capabilities, isLoading, error, refreshCapabilities } =
    useGeminiCapabilities(workspacePath)

  return (
    <div className="safety-panel">
      <div className="diff-studio-toolbar">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
            Gemini capability state
          </div>
          <div
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--text-tertiary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {workspacePath || 'No workspace selected'}
          </div>
        </div>
        <button
          className="btn btn-sm btn-ghost"
          onClick={refreshCapabilities}
          disabled={!workspacePath || isLoading}
        >
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <ToolingContractCard contract={props.providerCapabilities} />

      <div className="safety-card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 'var(--space-sm)',
            alignItems: 'center'
          }}
        >
          <h4>AGBench MCP bridge</h4>
          <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
            <button
              className="btn btn-sm btn-ghost"
              onClick={props.onRefreshGeminiMcpBridgeStatus}
              disabled={!props.onRefreshGeminiMcpBridgeStatus}
            >
              Test
            </button>
            <button
              className="btn btn-sm"
              onClick={props.onInstallGeminiMcpBridge}
              disabled={!props.onInstallGeminiMcpBridge}
            >
              Install / repair
            </button>
          </div>
        </div>
        <div className="safety-row">
          <span>App setting</span>
          <span>{props.geminiMcpBridgeEnabled ? 'enabled' : 'disabled'}</span>
        </div>
        <div className="safety-row">
          <span>Gemini config</span>
          <span>{props.geminiMcpBridgeStatus?.installed ? 'installed' : 'not installed'}</span>
        </div>
        <div className="safety-row">
          <span>Status</span>
          <span
            style={{
              color: props.geminiMcpBridgeStatus?.available ? 'var(--success)' : 'var(--warning)'
            }}
          >
            {props.geminiMcpBridgeStatus?.available ? 'available' : 'unavailable'}
          </span>
        </div>
        <p
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--text-secondary)',
            margin: 'var(--space-sm) 0 0 0'
          }}
        >
          {props.geminiMcpBridgeStatus?.message ||
            'Use Install / repair only when you want AGBench to update your Gemini MCP configuration.'}
        </p>
      </div>

      {!workspacePath && (
        <div className="safety-card">
          <h4>Workspace required</h4>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: 0 }}>
            Select a workspace to inspect MCP servers, extensions, skills, and agents in that Gemini
            CLI context.
          </p>
        </div>
      )}

      {workspacePath && isLoading && !capabilities && (
        <div className="safety-card">
          <h4>Loading capabilities...</h4>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: 0 }}>
            Running read-only Gemini CLI list commands.
          </p>
        </div>
      )}

      {error && (
        <div className="safety-card">
          <h4>Capability scan failed</h4>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--danger)', margin: 0 }}>
            {error}
          </p>
        </div>
      )}

      {capabilities && (
        <>
          <div
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--text-tertiary)',
              padding: '0 var(--space-xs)'
            }}
          >
            Last refreshed {formatCapabilityTime(capabilities.refreshedAt)}
          </div>
          {CAPABILITY_ORDER.map((kind) => (
            <CapabilityCard key={kind} section={capabilities.sections[kind]} />
          ))}
        </>
      )}
    </div>
  )
}

function CapabilityCard({ section }: { section: GeminiCapabilitySection }) {
  const previewStdout = truncateRawOutput(section.stdout)
  const previewStderr = truncateRawOutput(section.stderr)

  return (
    <div className="safety-card">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--space-sm)'
        }}
      >
        <h4>{CAPABILITY_LABELS[section.kind]}</h4>
        <span
          style={{
            fontSize: 'var(--font-size-xs)',
            color: commandStatusColor(section),
            whiteSpace: 'nowrap'
          }}
        >
          {commandStatusLabel(section)}
        </span>
      </div>

      <div className="safety-row">
        <span>Command</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)' }}>
          {section.command.join(' ')}
        </span>
      </div>
      <div className="safety-row">
        <span>Format</span>
        <span>{section.format}</span>
      </div>
      <div className="safety-row">
        <span>Entries</span>
        <span>{section.items.length}</span>
      </div>

      {section.parsingError && (
        <div
          style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--warning)',
            marginTop: 'var(--space-sm)'
          }}
        >
          JSON parse failed, using raw list output.
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-sm)',
          marginTop: 'var(--space-md)'
        }}
      >
        {section.items.length === 0 ? (
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            {section.status === 0
              ? 'No entries parsed from command output.'
              : 'Command did not complete successfully.'}
          </div>
        ) : (
          section.items.slice(0, 8).map((item) => (
            <div
              key={`${section.kind}-${item.id}-${item.name}`}
              style={{ borderTop: '1px solid var(--panel-border)', paddingTop: 'var(--space-sm)' }}
            >
              <div
                style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-sm)' }}
              >
                <span
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {item.name}
                </span>
                {item.status && (
                  <span
                    style={{
                      fontSize: 'var(--font-size-xs)',
                      color: capabilityStatusColor(item.status),
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {item.status}
                  </span>
                )}
              </div>
              {item.detail && (
                <div
                  style={{
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--text-tertiary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {item.detail}
                </div>
              )}
            </div>
          ))
        )}
        {section.items.length > 8 && (
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
            +{section.items.length - 8} more entries in raw output
          </div>
        )}
      </div>

      <details style={{ marginTop: 'var(--space-md)' }}>
        <summary
          style={{
            cursor: 'pointer',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--text-secondary)'
          }}
        >
          Raw stdout/stderr
        </summary>
        <pre
          style={{
            margin: 'var(--space-sm) 0 0 0',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--text-secondary)'
          }}
        >
          {previewStdout || previewStderr
            ? `${previewStdout}${previewStdout && previewStderr ? '\n\n[stderr]\n' : ''}${previewStderr}`
            : 'No output'}
        </pre>
      </details>
    </div>
  )
}

function SafetyTab({
  provider,
  approvalMode,
  codexStatus,
  geminiVersion,
  isOldVersion,
  trustResult,
  showTerminal,
  setShowTerminal,
  currentWorkspace,
  onImportCodexUsageCredential,
  onClearCodexUsageCredential,
  codexExternalPathGrants = []
}: InspectorProps) {
  if (provider === 'codex') {
    const sandbox = approvalMode === 'plan' ? 'read-only' : 'workspace-write'
    const approvalPolicy =
      approvalMode === 'auto_edit' || approvalMode === 'plan' ? 'never' : 'on-request'
    return (
      <div className="safety-panel">
        <div className="safety-card">
          <h4>Codex safety</h4>
          <p
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-secondary)',
              margin: '0 0 var(--space-md) 0'
            }}
          >
            Codex runs through an app-owned app-server thread. Command and file approvals are routed
            back into this UI when the selected mode prompts.
          </p>
          <div className="safety-row">
            <span>Sandbox</span>
            <span>{sandbox}</span>
          </div>
          <div className="safety-row">
            <span>Approval policy</span>
            <span>{approvalPolicy}</span>
          </div>
          <div className="safety-row">
            <span>Auth state</span>
            <span>{codexStatus?.authState || 'unknown'}</span>
          </div>
          <div className="safety-row">
            <span>Plan</span>
            <span>{codexStatus?.planType || 'unknown'}</span>
          </div>
          <div className="safety-row">
            <span>Usage source</span>
            <span>
              {codexStatus?.codexUsage?.windows?.length
                ? 'ChatGPT usage endpoint'
                : 'local fallback'}
            </span>
          </div>
          <div className="safety-row">
            <span>Usage account</span>
            <span>{codexStatus?.codexUsage?.accountId || 'not imported'}</span>
          </div>
          <div className="safety-row">
            <span>External grants</span>
            <span>{codexExternalPathGrants.length}</span>
          </div>
          <div className="safety-row">
            <span>CLI</span>
            <span>{codexStatus?.version || 'unknown'}</span>
          </div>
          {codexStatus?.rateLimits && (
            <>
              <div className="safety-row">
                <span>Primary usage</span>
                <span>{Math.round(codexStatus.rateLimits.primary?.usedPercent || 0)}%</span>
              </div>
              <div className="safety-row">
                <span>Window</span>
                <span>
                  {codexStatus.rateLimits.primary?.windowDurationMins
                    ? `${codexStatus.rateLimits.primary.windowDurationMins}m`
                    : 'unknown'}
                </span>
              </div>
            </>
          )}
        </div>
        {codexExternalPathGrants.length > 0 && (
          <div className="safety-card">
            <h4>Codex external path grants</h4>
            <p
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--text-secondary)',
                margin: '0 0 var(--space-md) 0'
              }}
            >
              These selected files or folders are passed as scoped sandbox roots for Codex
              app-server runs in this chat. Revoke them from the composer chip before the next run.
            </p>
            {codexExternalPathGrants.map((grant) => (
              <div className="safety-row" key={grant.id}>
                <span>
                  {grant.access === 'write' ? 'Edit' : 'Read'} {grant.kind}
                </span>
                <span title={grant.path}>{grant.path}</span>
              </div>
            ))}
          </div>
        )}
        <div className="safety-card">
          <h4>Codex usage import</h4>
          <p
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-secondary)',
              margin: '0 0 var(--space-md) 0'
            }}
          >
            For accurate 5h, weekly, and Spark meters, explicitly import your Codex session from{' '}
            <span style={{ fontFamily: 'var(--font-mono)' }}>~/.codex/auth.json</span>. The token is
            encrypted with Electron safeStorage when available and is only used to call ChatGPT
            usage limits.
          </p>
          {codexStatus?.codexUsage?.error && (
            <p
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--warning)',
                margin: '0 0 var(--space-md) 0'
              }}
            >
              {codexStatus.codexUsage.error}
            </p>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
            <button
              className="btn"
              style={{ flex: 1 }}
              onClick={onImportCodexUsageCredential}
              disabled={!onImportCodexUsageCredential}
            >
              Import Codex usage session
            </button>
            <button
              className="btn btn-ghost"
              onClick={onClearCodexUsageCredential}
              disabled={!onClearCodexUsageCredential}
            >
              Clear
            </button>
          </div>
        </div>
        <div className="safety-card">
          <h4>Codex login</h4>
          <p
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-secondary)',
              margin: '0 0 var(--space-md) 0'
            }}
          >
            If Codex reports missing auth in Raw Events, use this scoped terminal and run{' '}
            <span style={{ fontFamily: 'var(--font-mono)' }}>codex login</span>. Credentials are
            handled by the Codex CLI.
          </p>
          {currentWorkspace && !showTerminal && (
            <button className="btn" style={{ width: '100%' }} onClick={() => setShowTerminal(true)}>
              Open Codex login terminal...
            </button>
          )}
          {currentWorkspace && showTerminal && (
            <div className="trust-assistant-panel">
              <div className="trust-assistant-copy">
                <strong>Codex login terminal</strong>
                <span>Run codex login here if the app-server reports missing authentication.</span>
              </div>
              <TerminalPanel
                workspacePath={currentWorkspace.path}
                onClose={() => setShowTerminal(false)}
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  if (provider === 'claude' || provider === 'kimi') {
    const label = providerLabel(provider)
    const setupCommand = provider === 'claude' ? 'claude auth login' : 'kimi login'
    const permissionText =
      provider === 'claude'
        ? approvalMode === 'plan'
          ? 'Claude plan mode'
          : approvalMode === 'auto_edit'
            ? 'Claude acceptEdits'
            : 'Claude default permissions'
        : approvalMode === 'plan'
          ? 'Kimi plan/read-only intent'
          : approvalMode === 'auto_edit'
            ? 'Kimi Wire approvals; YOLO not enabled'
            : 'Kimi Wire approvals'
    return (
      <div className="safety-panel">
        <div className="safety-card">
          <h4>{label} safety</h4>
          <p
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-secondary)',
              margin: '0 0 var(--space-md) 0'
            }}
          >
            {label} runs through the provider adapter. Credential files are not read by this app;
            setup stays delegated to the provider CLI.
          </p>
          <div className="safety-row">
            <span>Binary</span>
            <span>{codexStatus?.available ? 'available' : 'missing'}</span>
          </div>
          <div className="safety-row">
            <span>Path</span>
            <span>{codexStatus?.binaryPath || 'auto-detect failed'}</span>
          </div>
          <div className="safety-row">
            <span>Version</span>
            <span>{codexStatus?.version || 'unknown'}</span>
          </div>
          <div className="safety-row">
            <span>Auth state</span>
            <span>{codexStatus?.authState || 'unknown'}</span>
          </div>
          <div className="safety-row">
            <span>Permissions</span>
            <span>{permissionText}</span>
          </div>
          {codexStatus?.error && (
            <p
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--warning)',
                margin: 'var(--space-sm) 0 0 0'
              }}
            >
              {codexStatus.error}
            </p>
          )}
        </div>
        <div className="safety-card">
          <h4>{label} setup</h4>
          <p
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-secondary)',
              margin: '0 0 var(--space-md) 0'
            }}
          >
            Use a scoped terminal for provider login/setup. For binary overrides, open Settings.
          </p>
          {currentWorkspace && !showTerminal && (
            <button className="btn" style={{ width: '100%' }} onClick={() => setShowTerminal(true)}>
              Open {label} setup terminal...
            </button>
          )}
          {currentWorkspace && showTerminal && (
            <div className="trust-assistant-panel">
              <div className="trust-assistant-copy">
                <strong>{label} setup terminal</strong>
                <span>
                  Run {setupCommand} if this provider needs authentication or first-time setup.
                </span>
              </div>
              <TerminalPanel
                workspacePath={currentWorkspace.path}
                onClose={() => setShowTerminal(false)}
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="safety-panel">
      <div className="safety-card">
        <h4>Workspace Trust</h4>
        <p
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--text-secondary)',
            margin: '0 0 var(--space-md) 0'
          }}
        >
          Gemini CLI enforces interactive workspace trust checks to prevent accidental execution in
          untrusted folders.
        </p>
        {currentWorkspace &&
          trustResult?.status !== 'trusted' &&
          trustResult?.status !== 'inherited' && (
            <div style={{ marginBottom: 'var(--space-md)' }}>
              {!showTerminal ? (
                <button
                  className="btn"
                  style={{ width: '100%', marginBottom: 'var(--space-sm)' }}
                  onClick={() => setShowTerminal(true)}
                >
                  Open Trust Assistant...
                </button>
              ) : (
                <div className="trust-assistant-panel">
                  <div className="trust-assistant-copy">
                    <strong>Trust Assistant</strong>
                    <span>Use this scoped terminal only for Gemini workspace trust prompts.</span>
                  </div>
                  <TerminalPanel
                    workspacePath={currentWorkspace.path}
                    onClose={() => {
                      setShowTerminal(false)
                      window.api.checkTrust(currentWorkspace.path).then(() => {})
                    }}
                  />
                </div>
              )}
            </div>
          )}
        <button
          className="btn btn-sm btn-ghost"
          style={{ width: '100%' }}
          onClick={() => navigator.clipboard.writeText('/permissions trust')}
        >
          Copy '/permissions trust'
        </button>
      </div>

      <div className="safety-card">
        <h4>CLI Details</h4>
        <div className="safety-row">
          <span>Version</span>
          <span>{geminiVersion}</span>
        </div>
        <div className="safety-row">
          <span>Sandbox</span>
          <span style={{ color: 'var(--success)' }}>On</span>
        </div>
        <div className="safety-row">
          <span>Yolo mode</span>
          <span style={{ color: 'var(--danger)' }}>Blocked</span>
        </div>
        <div className="safety-row">
          <span>Trust status</span>
          <span
            style={{
              color:
                trustResult?.status === 'trusted' || trustResult?.status === 'inherited'
                  ? 'var(--success)'
                  : trustResult?.status === 'untrusted'
                    ? 'var(--danger)'
                    : 'var(--text-secondary)'
            }}
          >
            {trustResult?.status || 'Unknown'}
          </span>
        </div>
        {isOldVersion && (
          <div
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--warning)',
              marginTop: 'var(--space-sm)'
            }}
          >
            Upgrade to &gt;= 0.39.1 recommended for secure headless trust.
          </div>
        )}
      </div>
    </div>
  )
}
