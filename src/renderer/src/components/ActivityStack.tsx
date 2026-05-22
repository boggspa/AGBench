import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ChatRecord,
  ChildAgentThread,
  ProviderId,
  ToolActivity,
  ToolDiffSummary
} from '../../../main/store/types'
import { deriveToolDiffSummary, isWriteLikeToolName } from '../lib/ToolParser'
import { deriveChildAgentThreadsFromActivities } from '../lib/ChildAgentThreads'
import { hasExpandableDetail, shouldRenderAsCard } from '../lib/ActivityRenderMode'
import { inlineStatsForActivity } from '../lib/ActivityInlineStats'
import { displayPathRelativeToWorkspace } from '../lib/ActivityPathDisplay'
import { FileTypeIcon } from './FileTypeIcon'
import { DigitOdometer } from './DigitOdometer'
import { ToolFamilyIcon, toolNameToFamily } from './icons/ToolFamilyIcon'
import { TurnReceiptCard } from './TurnReceiptCard'

interface ActivityStackProps {
  activities: ToolActivity[]
  workspacePath?: string
  provider?: ProviderId
  chatId?: string
  runId?: string
  /** Chat record — when present, subagent threads pick up a stable visual
   * identity (name + color) via `assignAgentIdentity`. */
  chat?: ChatRecord
  /** Phase L3 slice 6 — when true (from `settings.compactDensity`),
   * tool cards collapse to their inline form and the turn-receipt
   * tape switches to its one-line summary variant. */
  compactDensity?: boolean
}

const SEARCH_PARAM_KEYS = ['query', 'search_query', 'pattern', 'regex', 'term']
const COMMAND_PARAM_KEYS = ['command', 'cmd', 'script']
const CONTENT_PARAM_KEYS = ['content', 'new_string', 'old_string']
const PATH_PARAM_KEYS = [
  'file_path',
  'filePath',
  'path',
  'target',
  'target_file',
  'target_file_path'
]
type ActivityTimelineItem =
  | { type: 'activity'; activity: ToolActivity }
  | { type: 'compact-group'; id: string; activities: ToolActivity[] }

interface SanitizedDetail {
  rows: Array<{ label: string; value: string }>
  previews: Array<{
    label: string
    content: string
    terminal?: boolean
    tone?: 'addition' | 'deletion' | 'diff' | 'neutral'
  }>
}

function getStringParam(parameters: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = parameters[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return undefined
}

function truncateText(value: string, maxLength = 420): string {
  const normalized = value.trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}...`
}

function cleanProgressText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value
    .replace(/^[\s#>*![\]A-Z:_-]*(Topic|Summary|Intent|Strategic intent)\s*:\s*/gim, '')
    .replace(/\*\*(Topic|Summary|Intent|Strategic intent)\s*:\*\*/gim, '')
    .replace(/\[!STRATEGY\]/gi, '')
    .replace(/[📂📁]/gu, '')
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!cleaned || cleaned === '...' || cleaned === '…') return undefined
  return truncateText(cleaned, 360)
}

function countLines(value: string): number {
  if (!value) {
    return 0
  }
  return value.split('\n').length
}

function getActivityKind(activity: ToolActivity): string {
  return (activity.toolName || activity.category || '').toLowerCase()
}

function isSearchActivity(activity: ToolActivity): boolean {
  const kind = getActivityKind(activity)
  return (
    activity.category === 'search' || kind.includes('search') || kind === 'grep' || kind === 'rg'
  )
}

function isShellActivity(activity: ToolActivity): boolean {
  const kind = getActivityKind(activity)
  return activity.category === 'shell' || kind === 'run_shell_command' || kind === 'shell'
}

function buildSanitizedDetail(
  activity: ToolActivity,
  activityFilePath?: string,
  addedLines?: number,
  deletedLines?: number
): SanitizedDetail {
  const parameters = activity.parameters || {}
  const rows: SanitizedDetail['rows'] = []
  const previews: SanitizedDetail['previews'] = []
  const resultText = activity.resultSummary || activity.outputPreview || ''
  const toolName = (activity.toolName || '').toLowerCase()
  const content = getStringParam(parameters, CONTENT_PARAM_KEYS)
  const command = getStringParam(parameters, COMMAND_PARAM_KEYS)
  const query = getStringParam(parameters, SEARCH_PARAM_KEYS)

  if (activityFilePath) {
    rows.push({ label: 'File', value: activityFilePath })
  }

  if (isShellActivity(activity)) {
    const cwd = getStringParam(parameters, ['cwd', 'working_directory', 'workingDirectory'])
    if (cwd) {
      rows.push({ label: 'Working directory', value: cwd })
    }
    if (command) {
      previews.push({ label: 'Command', content: command, terminal: true })
    }
    if (resultText) {
      previews.push({
        label: activity.status === 'error' ? 'Error output' : 'Output',
        content: truncateText(resultText, 1000),
        terminal: true
      })
    }
    return { rows, previews }
  }

  if (isSearchActivity(activity)) {
    const scope = getStringParam(parameters, ['path', 'dir', 'directory', 'include', 'glob'])
    if (query) {
      rows.push({ label: toolName.includes('web_search') ? 'Search' : 'Pattern', value: query })
    }
    if (scope) {
      rows.push({ label: 'Scope', value: scope })
    }
    if (resultText) {
      previews.push({ label: 'Result', content: truncateText(resultText), tone: 'neutral' })
    }
    return { rows, previews }
  }

  if (activity.category === 'task') {
    if (resultText) {
      previews.push({
        label: toolName === 'codex_reasoning' ? 'Thoughts' : 'Update',
        content: truncateText(resultText, 1000),
        tone: 'neutral'
      })
    }
    return { rows, previews }
  }

  if (activity.category === 'write' || isWriteLikeToolName(toolName)) {
    const operation =
      toolName === 'replace'
        ? 'Edited file'
        : toolName === 'create_file'
          ? 'Created file'
          : 'Wrote file'
    rows.push({ label: 'Action', value: operation })

    if (addedLines !== undefined || deletedLines !== undefined) {
      rows.push({ label: 'Diff', value: `+${addedLines || 0} / -${deletedLines || 0}` })
    } else if (content) {
      rows.push({
        label: 'Content',
        value: `${countLines(content)} line${countLines(content) === 1 ? '' : 's'}`
      })
    }

    const patchPreview = typeof parameters.patchPreview === 'string' ? parameters.patchPreview : ''
    if (patchPreview) {
      previews.push({
        label: 'Patch preview',
        content: truncateText(patchPreview, 1400),
        tone: 'diff'
      })
    }

    if (toolName === 'replace') {
      const oldString = typeof parameters.old_string === 'string' ? parameters.old_string : ''
      const newString = typeof parameters.new_string === 'string' ? parameters.new_string : ''
      if (oldString)
        previews.push({ label: 'Removed', content: truncateText(oldString), tone: 'deletion' })
      if (newString)
        previews.push({ label: 'Added', content: truncateText(newString), tone: 'addition' })
    } else if (content) {
      previews.push({ label: 'Added content', content: truncateText(content), tone: 'addition' })
    }

    if (resultText) {
      previews.push({ label: 'Result', content: truncateText(resultText), tone: 'neutral' })
    }
    return { rows, previews }
  }

  const pathValue = getStringParam(parameters, PATH_PARAM_KEYS)
  if (!activityFilePath && pathValue) {
    rows.push({ label: 'Path', value: pathValue })
  }
  if (query) {
    rows.push({ label: 'Query', value: query })
  }
  if (content) {
    rows.push({
      label: 'Content',
      value: `${countLines(content)} line${countLines(content) === 1 ? '' : 's'}`
    })
    previews.push({ label: 'Content preview', content: truncateText(content), tone: 'diff' })
  }
  if (resultText) {
    previews.push({ label: 'Result', content: truncateText(resultText), tone: 'neutral' })
  }

  return { rows, previews }
}

function getFilePathFromActivity(activity: ToolActivity): string | undefined {
  const candidateFields: string[] = [
    'file_path',
    'filePath',
    'path',
    'target',
    'target_file',
    'target_file_path',
    'source',
    'source_file',
    'source_file_path',
    'destination',
    'destination_file',
    'destination_file_path'
  ]

  for (const field of candidateFields) {
    const value = activity.parameters?.[field]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  if (activity.filePath && typeof activity.filePath === 'string' && activity.filePath.trim()) {
    return activity.filePath.trim()
  }

  if (
    activity.affectedFilePath &&
    typeof activity.affectedFilePath === 'string' &&
    activity.affectedFilePath.trim()
  ) {
    return activity.affectedFilePath.trim()
  }

  return undefined
}

function getBaseName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() || path
}

function getFileActionLabel(activity: ToolActivity): string {
  const toolName = (activity.toolName || '').toLowerCase()
  if (
    toolName === 'replace' ||
    toolName === 'edit_file' ||
    toolName === 'edit' ||
    toolName === 'multiedit' ||
    toolName === 'notebookedit' ||
    toolName === 'apply_patch' ||
    toolName.includes('str_replace') ||
    toolName.endsWith('__replace') ||
    toolName.endsWith('__edit_file') ||
    toolName.endsWith('__apply_patch')
  )
    return 'Edited'
  if (toolName === 'create_file' || toolName.endsWith('__create_file')) return 'Created'
  if (toolName === 'delete_file' || toolName.endsWith('__delete_file')) return 'Deleted'
  if (
    toolName === 'write_file' ||
    toolName === 'write' ||
    toolName.endsWith('__write_file') ||
    toolName.endsWith('__write')
  )
    return 'Wrote'
  if (toolName === 'read_file') return 'Read'
  return activity.displayName || activity.toolName || 'Used tool'
}

function getProgressNote(activity: ToolActivity): { title: string; body?: string } | null {
  if (activity.category !== 'task') return null
  const parameters = activity.parameters || {}
  const title =
    cleanProgressText(parameters.title) ||
    cleanProgressText(parameters.topic) ||
    cleanProgressText(activity.displayName) ||
    'Progress update'
  const body =
    cleanProgressText(parameters.strategic_intent) ||
    cleanProgressText(parameters.intent) ||
    cleanProgressText(parameters.summary) ||
    cleanProgressText(parameters.message) ||
    cleanProgressText(activity.resultSummary) ||
    cleanProgressText(activity.outputPreview)

  if (!title && !body) return null
  return {
    title: title || 'Progress update',
    ...(body && body !== title ? { body } : {})
  }
}

function ToolCategoryIcon({ category }: { category?: string }) {
  const cls = 'activity-category-icon'
  switch (category) {
    case 'read':
      return (
        <svg
          className={cls}
          width="13"
          height="13"
          viewBox="0 0 13 13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="1" width="9" height="11" rx="1.5" />
          <line x1="4" y1="4.5" x2="9" y2="4.5" />
          <line x1="4" y1="6.5" x2="9" y2="6.5" />
          <line x1="4" y1="8.5" x2="7.5" y2="8.5" />
        </svg>
      )
    case 'write':
      return (
        <svg
          className={cls}
          width="13"
          height="13"
          viewBox="0 0 13 13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8.5,2 L11,4.5 L4.5,11 L2,11.5 L2.5,9 Z" />
          <line x1="7" y1="3.5" x2="9.5" y2="6" />
        </svg>
      )
    case 'shell':
      return (
        <svg
          className={cls}
          width="13"
          height="13"
          viewBox="0 0 13 13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="1" y="2" width="11" height="9" rx="1.5" />
          <polyline points="3.5,5.5 6,7 3.5,8.5" />
          <line x1="7" y1="9" x2="10" y2="9" />
        </svg>
      )
    case 'search':
      return (
        <svg
          className={cls}
          width="13"
          height="13"
          viewBox="0 0 13 13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <circle cx="5.5" cy="5.5" r="3.5" />
          <line x1="8.1" y1="8.1" x2="11" y2="11" />
        </svg>
      )
    case 'task':
      return (
        <svg
          className={cls}
          width="13"
          height="13"
          viewBox="0 0 13 13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6.5,1.5 L7.8,5 L11.5,5 L8.5,7.3 L9.8,11 L6.5,8.8 L3.2,11 L4.5,7.3 L1.5,5 L5.2,5 Z" />
        </svg>
      )
    default:
      return (
        <svg
          className={cls}
          width="13"
          height="13"
          viewBox="0 0 13 13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <circle cx="6.5" cy="6.5" r="4.5" strokeDasharray="2.5 1.5" />
          <circle cx="6.5" cy="6.5" r="1.5" />
        </svg>
      )
  }
}

function ActivityStatusIcon({ status }: { status: ToolActivity['status'] }) {
  switch (status) {
    case 'running':
      return (
        <span className="activity-status running">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          >
            <circle cx="7" cy="7" r="5" strokeDasharray="20 11" className="activity-status-spin" />
          </svg>
        </span>
      )
    case 'success':
      return (
        <span className="activity-status success">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="7" cy="7" r="5.5" />
            <polyline points="4.5,7 6.2,8.8 9.5,5.2" />
          </svg>
        </span>
      )
    case 'warning':
      return (
        <span className="activity-status warning">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="7,1.5 13,12.5 1,12.5" />
            <line x1="7" y1="5.5" x2="7" y2="8.5" />
            <circle cx="7" cy="10.5" r="0.5" fill="currentColor" stroke="none" />
          </svg>
        </span>
      )
    case 'error':
      return (
        <span className="activity-status error">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          >
            <circle cx="7" cy="7" r="5.5" />
            <line x1="4.8" y1="4.8" x2="9.2" y2="9.2" />
            <line x1="9.2" y1="4.8" x2="4.8" y2="9.2" />
          </svg>
        </span>
      )
    default:
      return (
        <span className="activity-status" style={{ color: 'var(--text-muted)' }}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="7" cy="7" r="5.5" strokeDasharray="3 2" opacity="0.5" />
          </svg>
        </span>
      )
  }
}

function getActivityDurationTotal(activities: ToolActivity[]): number | undefined {
  const total = activities.reduce((sum, activity) => sum + (activity.durationMs || 0), 0)
  return total > 0 ? total : undefined
}

function isCompactGroupCandidate(activity: ToolActivity): boolean {
  if (activity.status === 'error' || activity.status === 'running' || activity.status === 'pending')
    return false
  return activity.category === 'read' || isSearchActivity(activity)
}

function buildTimelineItems(activities: ToolActivity[]): ActivityTimelineItem[] {
  const items: ActivityTimelineItem[] = []
  let index = 0

  while (index < activities.length) {
    const activity = activities[index]
    if (!isCompactGroupCandidate(activity)) {
      items.push({ type: 'activity', activity })
      index += 1
      continue
    }

    const group: ToolActivity[] = []
    while (index < activities.length && isCompactGroupCandidate(activities[index])) {
      group.push(activities[index])
      index += 1
    }

    if (group.length >= 3) {
      items.push({ type: 'compact-group', id: `${group[0].id}-${group.length}`, activities: group })
    } else {
      for (const groupedActivity of group) {
        items.push({ type: 'activity', activity: groupedActivity })
      }
    }
  }

  return items
}

function ActivityProgressNote({ activity }: { activity: ToolActivity }) {
  const note = getProgressNote(activity)
  if (!note) return null

  return (
    <div className={`activity-progress-note status-${activity.status}`}>
      <ActivityStatusIcon status={activity.status} />
      <div className="activity-progress-note-body">
        <div className="activity-progress-note-title">
          <span>{note.title}</span>
          {activity.durationMs !== undefined && (
            <span className="activity-progress-note-duration">{activity.durationMs}ms</span>
          )}
        </div>
        {note.body && <p>{note.body}</p>}
      </div>
    </div>
  )
}

function ActivityCompactGroup({
  activities,
  workspacePath,
  provider
}: {
  activities: ToolActivity[]
  workspacePath?: string
  /** Chat-context provider, forwarded to inner ActivityRow rows for
   * the provider-coloured border (Phase L3 slice 2). */
  provider?: ProviderId
}) {
  const [expanded, setExpanded] = useState(false)
  const searchCount = activities.filter(isSearchActivity).length
  const readCount = activities.length - searchCount
  const durationMs = getActivityDurationTotal(activities)
  const label =
    searchCount > 0 && readCount > 0
      ? `Read ${readCount} ${readCount === 1 ? 'file' : 'files'} and searched ${searchCount} ${searchCount === 1 ? 'time' : 'times'}`
      : searchCount > 0
        ? `Searched ${searchCount} ${searchCount === 1 ? 'time' : 'times'}`
        : `Read ${readCount} ${readCount === 1 ? 'file' : 'files'}`
  const primaryCategory = searchCount > readCount ? 'search' : 'read'
  const chips = activities
    .map(
      (activity) =>
        getFilePathFromActivity(activity) ||
        getStringParam(activity.parameters || {}, SEARCH_PARAM_KEYS)
    )
    .filter((value): value is string => Boolean(value))
    .slice(0, 6)

  // Phase L3 slice 7 — intelligent group iconography. Compute the
  // distinct tool families present in this group; show ONE icon if
  // they all map to the same family, otherwise show an array of up
  // to 4 family icons (with a "+N" indicator for overflow). When no
  // tool maps to a family at all, fall back to the legacy category
  // icon so heterogeneous unknown-tool groups still render something.
  const distinctFamilies = (() => {
    const seen = new Set<string>()
    const order: string[] = []
    for (const activity of activities) {
      const family = toolNameToFamily(activity.toolName)
      if (family && !seen.has(family)) {
        seen.add(family)
        order.push(family)
      }
    }
    return order
  })()
  const visibleFamilies = distinctFamilies.slice(0, 4)
  const overflowFamilyCount = distinctFamilies.length - visibleFamilies.length

  return (
    <div className={`activity-compact-group ${expanded ? 'expanded' : 'collapsed'}`}>
      <button
        className="activity-compact-group-header"
        type="button"
        onClick={() => setExpanded((current) => !current)}
      >
        {distinctFamilies.length === 0 ? (
          <ToolCategoryIcon category={primaryCategory} />
        ) : visibleFamilies.length === 1 ? (
          <ToolFamilyIcon
            family={visibleFamilies[0] as Parameters<typeof ToolFamilyIcon>[0]['family']}
            className="activity-category-icon"
          />
        ) : (
          <span className="activity-compact-group-icons" aria-hidden>
            {visibleFamilies.map((family) => (
              <ToolFamilyIcon
                key={family}
                family={family as Parameters<typeof ToolFamilyIcon>[0]['family']}
                size={12}
                className="activity-compact-group-icon"
              />
            ))}
            {overflowFamilyCount > 0 && (
              <span className="activity-compact-group-icon-overflow">+{overflowFamilyCount}</span>
            )}
          </span>
        )}
        <span className="activity-compact-group-title">{label}</span>
        <span className="activity-compact-group-meta">
          {durationMs !== undefined && (
            <span className="activity-compact-group-duration">{durationMs}ms</span>
          )}
          <span className="activity-count-badge">{activities.length}</span>
        </span>
        <span className="activity-compact-group-caret">
          <svg
            className={`activity-compact-chevron ${expanded ? 'expanded' : ''}`}
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="3,4.5 6,7.5 9,4.5" />
          </svg>
        </span>
      </button>
      {!expanded && chips.length > 0 && (
        <div className="activity-compact-group-chips">
          {chips.map((chip, index) => (
            <span key={`${chip}-${index}`} className="activity-compact-chip">
              {getBaseName(chip)}
            </span>
          ))}
          {activities.length > chips.length && (
            <span className="activity-compact-chip muted">+{activities.length - chips.length}</span>
          )}
        </div>
      )}
      {expanded && (
        <div className="activity-compact-group-list">
          {activities.map((activity) => (
            <ActivityRow
              key={activity.id}
              activity={activity}
              workspacePath={workspacePath}
              forceCompact
              provider={provider}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function getInlineActivityTitle(activity: ToolActivity, filePath?: string): ReactNode {
  if (filePath) {
    return <ActivityTitle activity={activity} filePath={filePath} />
  }

  const parameters = activity.parameters || {}
  if (isShellActivity(activity)) {
    const command = getStringParam(parameters, COMMAND_PARAM_KEYS)
    return command ? (
      <>
        Ran <code className="activity-inline-command">{truncateText(command, 150)}</code>
      </>
    ) : (
      <>{activity.displayName || 'Ran shell command'}</>
    )
  }

  if (isSearchActivity(activity)) {
    const query = getStringParam(parameters, SEARCH_PARAM_KEYS)
    return query ? (
      <>
        Searched for <strong>{query}</strong>
      </>
    ) : (
      <>{activity.displayName || 'Searched project'}</>
    )
  }

  if (activity.category === 'task') {
    const summary =
      activity.resultSummary ||
      activity.outputPreview ||
      getStringParam(parameters, ['summary', 'message', 'text', 'intent'])
    return summary ? (
      <>{truncateText(summary, 120)}</>
    ) : (
      <>{activity.displayName || 'Task update'}</>
    )
  }

  return <ActivityTitle activity={activity} filePath={filePath} />
}

function ActivityTitle({ activity, filePath }: { activity: ToolActivity; filePath?: string }) {
  if (!filePath) {
    return <>{activity.displayName || activity.toolName}</>
  }

  return (
    <>
      {getFileActionLabel(activity)}{' '}
      <strong className="activity-file-name">{getBaseName(filePath)}</strong>
    </>
  )
}

function getDiffToneClass(line: string, tone: SanitizedDetail['previews'][number]['tone']): string {
  const prefix = line[0]

  if (tone === 'diff') {
    if (prefix === '+' && !line.startsWith('+++')) return 'activity-diff-line-add'
    if (prefix === '-' && !line.startsWith('---')) return 'activity-diff-line-delete'
    return 'activity-diff-line-context'
  }

  if (tone === 'addition') {
    if (!line) return 'activity-diff-line-context'
    if (prefix === '-' && !line.startsWith('---')) return 'activity-diff-line-context'
    if (prefix === '+' && !line.startsWith('+++')) return 'activity-diff-line-add'
    return 'activity-diff-line-add'
  }

  if (tone === 'deletion') {
    if (!line) return 'activity-diff-line-context'
    if (prefix === '+' && !line.startsWith('+++')) return 'activity-diff-line-context'
    if (prefix === '-' && !line.startsWith('---')) return 'activity-diff-line-delete'
    return 'activity-diff-line-delete'
  }

  return 'activity-diff-line-context'
}

function ActivityPreview({ preview }: { preview: SanitizedDetail['previews'][number] }) {
  if (preview.terminal) {
    return <pre className="activity-output-terminal">{preview.content}</pre>
  }

  return (
    <pre className="activity-output-clean activity-output-diff">
      {preview.content.split('\n').map((line, index) => (
        <span
          key={`${index}-${line}`}
          className={`activity-diff-line ${getDiffToneClass(line, preview.tone || 'neutral')}`}
        >
          {line || ' '}
        </span>
      ))}
    </pre>
  )
}

/**
 * Spawn block — collapsed summary that precedes the individual
 * `ChildAgentThreadCard`s when 2+ subagents are spawned in the same message.
 * Mirrors Codex's "Spawned N agents" disclosure: one colored row per agent
 * with name + role + instructions preview, click to scroll to the card.
 */
function ChildAgentSpawnBlock({ threads }: { threads: ChildAgentThread[] }) {
  const [expanded, setExpanded] = useState(true)
  if (!threads || threads.length < 2) return null

  const scrollToAgent = (agentId: string) => {
    if (typeof document === 'undefined') return
    const target = document.querySelector(`[data-agent-id="${CSS.escape(agentId)}"]`)
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target.classList.add('child-agent-thread-flash')
      window.setTimeout(() => target.classList.remove('child-agent-thread-flash'), 1200)
    }
  }

  return (
    <div className={`child-agent-spawn-block ${expanded ? 'is-expanded' : 'is-collapsed'}`}>
      <button
        type="button"
        className="child-agent-spawn-block-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <svg
          className={`child-agent-spawn-block-chevron ${expanded ? 'expanded' : ''}`}
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <polyline points="3,4.5 6,7.5 9,4.5" />
        </svg>
        <span className="child-agent-spawn-block-title">
          Spawned <strong>{threads.length}</strong> agents
        </span>
        {!expanded && (
          <span className="child-agent-spawn-block-collapsed-pills" aria-hidden>
            {threads.map((thread) => (
              <span
                key={thread.id}
                className="child-agent-spawn-block-pill"
                style={
                  thread.identity
                    ? { color: thread.identity.color, borderColor: thread.identity.color }
                    : undefined
                }
              >
                {thread.identity?.name || thread.name}
              </span>
            ))}
          </span>
        )}
      </button>
      {expanded && (
        <div className="child-agent-spawn-block-body">
          {threads.map((thread) => {
            const identity = thread.identity
            const preview = thread.seedPrompt
              ? thread.seedPrompt.length > 140
                ? `${thread.seedPrompt.slice(0, 137)}…`
                : thread.seedPrompt
              : ''
            return (
              <button
                key={thread.id}
                type="button"
                className="child-agent-spawn-block-row"
                onClick={() => scrollToAgent(thread.id)}
                title="Scroll to this agent's card"
              >
                <span
                  className="child-agent-spawn-block-dot"
                  style={identity ? { background: identity.color } : undefined}
                  aria-hidden
                />
                <span
                  className="child-agent-spawn-block-name"
                  style={identity ? { color: identity.color } : undefined}
                >
                  {identity?.name || thread.name}
                </span>
                {(identity?.role || thread.role) && (
                  <span className="child-agent-spawn-block-role">
                    ({identity?.role || thread.role})
                  </span>
                )}
                {preview && <span className="child-agent-spawn-block-preview">{preview}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function ActivityStack({
  activities,
  workspacePath,
  provider,
  chatId,
  runId,
  chat,
  compactDensity = false
}: ActivityStackProps) {
  const childThreads = useMemo(() => {
    if (!provider || !activities || activities.length === 0) return [] as ChildAgentThread[]
    return deriveChildAgentThreadsFromActivities(provider, chatId, runId, activities, chat)
  }, [provider, chatId, runId, activities, chat])

  const { topLevelActivities, threadByParentId, threadActivityById } = useMemo(() => {
    const childIds = new Set<string>()
    const byParent = new Map<string, ChildAgentThread>()
    const byActivityId = new Map<string, ToolActivity>()
    for (const thread of childThreads) {
      if (thread.parentToolCallId) byParent.set(thread.parentToolCallId, thread)
      for (const id of thread.toolActivityIds) childIds.add(id)
    }
    for (const activity of activities || []) {
      if (childIds.has(activity.id)) byActivityId.set(activity.id, activity)
    }
    const topLevel = (activities || []).filter((activity) => !childIds.has(activity.id))
    return {
      topLevelActivities: topLevel,
      threadByParentId: byParent,
      threadActivityById: byActivityId
    }
  }, [activities, childThreads])

  if (!activities || activities.length === 0) return null
  const timelineItems = buildTimelineItems(topLevelActivities)

  const resolveThreadActivities = (thread: ChildAgentThread): ToolActivity[] => {
    return thread.toolActivityIds
      .map((id) => threadActivityById.get(id))
      .filter((activity): activity is ToolActivity => Boolean(activity))
  }

  return (
    <div className="activity-timeline">
      {childThreads.length >= 2 && <ChildAgentSpawnBlock threads={childThreads} />}
      {timelineItems.map((item) => {
        if (item.type === 'compact-group') {
          return (
            <ActivityCompactGroup
              key={item.id}
              activities={item.activities}
              workspacePath={workspacePath}
              provider={provider}
            />
          )
        }
        const thread = threadByParentId.get(item.activity.id)
        return (
          <ActivityRow
            key={item.activity.id}
            activity={item.activity}
            workspacePath={workspacePath}
            childThread={thread}
            childActivities={thread ? resolveThreadActivities(thread) : undefined}
            provider={provider}
            forceCompact={compactDensity}
          />
        )
      })}
      {/* Phase L3 slice 5 — turn-receipt tape. Renders only when this
       * tool group has ≥2 activities and nothing is still running.
       * Pure derived render — no message, no history-replay concern.
       * Slice 6 forwards `compactDensity` so the tape collapses to a
       * one-line summary in compact mode. */}
      <TurnReceiptCard activities={topLevelActivities} compact={compactDensity} />
    </div>
  )
}

function ActivityDiffFiles({
  diffSummary,
  workspacePath
}: {
  diffSummary?: ToolDiffSummary
  workspacePath?: string
}) {
  const files = diffSummary?.files || []
  if (files.length === 0) return null

  return (
    <div className="activity-file-change-cards">
      {files.slice(0, 8).map((file, index) => {
        const fullPath = file.path || ''
        const displayPath = displayPathRelativeToWorkspace(fullPath, workspacePath) || fullPath
        return (
          <div key={`${file.path || 'unknown'}-${index}`} className="activity-file-change-card">
            <FileTypeIcon
              path={fullPath}
              size={14}
              className="activity-file-type-icon"
              workspacePath={workspacePath}
            />
            <span className="activity-file-change-path" title={fullPath || 'Unknown file'}>
              {displayPath || 'Unknown file'}
            </span>
            <span className={`activity-file-change-status status-${file.status || 'unknown'}`}>
              {file.status || 'changed'}
            </span>
            {(file.additions !== undefined || file.deletions !== undefined) && (
              <span className="activity-file-change-stats">
                <span className="activity-line-stat activity-line-stat-add">
                  +{file.additions || 0}
                </span>
                <span className="activity-line-stat activity-line-stat-delete">
                  -{file.deletions || 0}
                </span>
              </span>
            )}
          </div>
        )
      })}
      {files.length > 8 && (
        <div className="activity-file-change-overflow">+{files.length - 8} more files</div>
      )}
    </div>
  )
}

function ChildAgentThreadCard({
  thread,
  activities,
  workspacePath
}: {
  thread: ChildAgentThread
  activities: ToolActivity[]
  workspacePath?: string
}) {
  const [expanded, setExpanded] = useState(thread.state === 'running')
  const interactivityLabel =
    thread.interactivity === 'interactive'
      ? 'Interactive'
      : thread.interactivity === 'observe-only'
        ? 'Observe-only'
        : 'One-shot'
  const stateLabel =
    thread.state === 'running'
      ? 'Running'
      : thread.state === 'completed'
        ? 'Completed'
        : thread.state === 'failed'
          ? 'Failed'
          : thread.state === 'cancelled'
            ? 'Cancelled'
            : 'Queued'

  // Resolve identity (assigned via assignAgentIdentity during thread derive).
  // When present, the colored name + dot replace the generic "Task #N" label.
  const identity = thread.identity
  const displayName = identity?.name || thread.name
  const identityRole = identity?.role || thread.role
  const identityColor = identity?.color

  return (
    <div
      className={`child-agent-thread state-${thread.state} interactivity-${thread.interactivity}`}
      data-agent-id={thread.id}
      style={
        identityColor
          ? ({ ['--agent-identity-color' as string]: identityColor } as Record<string, string>)
          : undefined
      }
    >
      <button
        type="button"
        className="child-agent-thread-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span
          className={`child-agent-thread-avatar status-${thread.state}`}
          aria-hidden
          style={identityColor ? { color: identityColor } : undefined}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="5" width="10" height="8" rx="2" />
            <circle cx="6.5" cy="9" r="0.9" fill="currentColor" stroke="none" />
            <circle cx="9.5" cy="9" r="0.9" fill="currentColor" stroke="none" />
            <path d="M8 5V3M6 3h4" />
          </svg>
        </span>
        <span
          className="child-agent-thread-name"
          style={identityColor ? { color: identityColor } : undefined}
        >
          {displayName}
        </span>
        {identityRole && <span className="child-agent-thread-role">{identityRole}</span>}
        <span className={`child-agent-thread-state state-${thread.state}`}>{stateLabel}</span>
        <span className="child-agent-thread-interactivity">{interactivityLabel}</span>
        {typeof thread.durationMs === 'number' && (
          <span className="child-agent-thread-duration">{thread.durationMs}ms</span>
        )}
        <svg
          className={`child-agent-thread-chevron ${expanded ? 'expanded' : ''}`}
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <polyline points="3,4.5 6,7.5 9,4.5" />
        </svg>
      </button>
      {expanded && (
        <div className="child-agent-thread-body">
          {thread.seedPrompt && (
            <div className="child-agent-section">
              <div className="child-agent-section-title">Seed prompt</div>
              <pre className="child-agent-seed-prompt">{thread.seedPrompt}</pre>
            </div>
          )}
          {activities.length > 0 && (
            <div className="child-agent-section">
              <div className="child-agent-section-title">Child activity · {activities.length}</div>
              <div className="child-agent-activities">
                {activities.map((childActivity) => (
                  <ActivityRow
                    key={childActivity.id}
                    activity={childActivity}
                    workspacePath={workspacePath}
                    forceCompact
                    /* Inside a ChildAgentThreadCard, the runtime-
                     * execution provider for the sub-thread is what
                     * matters — that's `thread.provider`. The chat-
                     * context provider would point at the OUTER chat,
                     * which is misleading for these inner rows. */
                    provider={thread.provider}
                  />
                ))}
              </div>
            </div>
          )}
          {thread.finalResult && (
            <div className="child-agent-section">
              <div className="child-agent-section-title">Final result</div>
              <div className="child-agent-result">{thread.finalResult}</div>
            </div>
          )}
          {!thread.seedPrompt && activities.length === 0 && !thread.finalResult && (
            <div className="child-agent-empty">No child agent output captured yet.</div>
          )}
        </div>
      )}
    </div>
  )
}

function ActivityRow({
  activity,
  workspacePath,
  forceCompact = false,
  childThread,
  childActivities,
  provider
}: {
  activity: ToolActivity
  workspacePath?: string
  forceCompact?: boolean
  childThread?: ChildAgentThread
  childActivities?: ToolActivity[]
  /** Chat-context provider — the CLI/runtime that owns the chat this
   * activity belongs to. Drives the left-border color via the
   * `[data-provider]` selector so a long transcript visually clusters
   * by which provider is doing the work. Sub-thread cards passed
   * through `ChildAgentThreadCard` can supply their own provider
   * here when the runtime-execution provider differs from the
   * outer chat. */
  provider?: ProviderId
}) {
  const [expanded, setExpanded] = useState(false)
  // Phase L3 slice 4 — stamp animation on status transition. When a
  // tool finishes (running → success/warning/error), we briefly mount
  // a `.activity-status-stamping` class on the status icon so the
  // CSS `activity-stamp-land` keyframe runs once. `prevStatusRef`
  // tracks the previous value so the very first render (and any
  // already-completed activity loaded from disk) doesn't fire the
  // stamp on mount — only genuine transitions in this session do.
  // Respects `[data-reduce-motion="true"]` via a CSS-side suppression.
  const prevStatusRef = useRef<ToolActivity['status'] | null>(null)
  const [justCompleted, setJustCompleted] = useState(false)
  useEffect(() => {
    const previous = prevStatusRef.current
    prevStatusRef.current = activity.status
    if (
      previous === 'running' &&
      (activity.status === 'success' ||
        activity.status === 'warning' ||
        activity.status === 'error')
    ) {
      setJustCompleted(true)
      const timer = window.setTimeout(() => setJustCompleted(false), 260)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [activity.status])
  const progressNote = getProgressNote(activity)
  if (progressNote && !forceCompact) {
    return (
      <>
        <ActivityProgressNote activity={activity} />
        {childThread && (
          <ChildAgentThreadCard
            thread={childThread}
            activities={childActivities || []}
            workspacePath={workspacePath}
          />
        )}
      </>
    )
  }

  const isUnknown = activity.toolName === 'unknown' || !activity.toolName
  const showDebugWarning = Boolean(isUnknown && (activity.rawUseEvent || activity.rawResultEvent))
  const isWriteAction = isWriteLikeToolName(activity.toolName || '')
  const activityFilePath = getFilePathFromActivity(activity)

  const chipText: string[] = []
  if (isWriteAction && activityFilePath) {
    // Workspace-relative form keeps the meta line readable; absolute path
    // still ships in the title attribute below for hover disambiguation.
    chipText.push(
      displayPathRelativeToWorkspace(activityFilePath, workspacePath) || activityFilePath
    )
  }
  if (activity.durationMs !== undefined) chipText.push(`${activity.durationMs}ms`)
  const metaText = chipText.join(' · ')
  const parameters = activity.parameters || {}
  const diffSummary =
    activity.diffSummary ||
    deriveToolDiffSummary(
      activity.toolName,
      parameters,
      activity.resultSummary || activity.outputPreview
    )
  // Pure helper that decides whether the per-row Codex-style `+X -Y` odometer
  // renders and what numbers it carries — handles MultiEdit `edits[]`,
  // Claude `Write` content, Gemini MCP write tools, and suppresses `+0 -0`
  // for pending edits that have not reported back yet.
  const inlineStats = inlineStatsForActivity(activity)
  const sanitizedDetail = buildSanitizedDetail(
    activity,
    activityFilePath,
    inlineStats.visible ? inlineStats.additions : diffSummary?.additions,
    inlineStats.visible ? inlineStats.deletions : diffSummary?.deletions
  )
  const hasSanitizedDetail = sanitizedDetail.rows.length > 0 || sanitizedDetail.previews.length > 0
  const shouldShowRawEvent = showDebugWarning || (isUnknown && !hasSanitizedDetail)
  const diffFileCount = diffSummary?.files?.length || 0
  const renderInputs = {
    expanded,
    detailRowCount: sanitizedDetail.rows.length,
    previews: sanitizedDetail.previews,
    diffFileCount,
    shouldShowRawEvent
  }
  // Content-light activities (no persistent body, no diff, no debug payload)
  // collapse to a slim inline chip even when the user toggles expansion —
  // otherwise we'd render an empty rectangular card around a one-line label.
  const renderAsCard = shouldRenderAsCard(renderInputs)
  const isInlineActivity = !renderAsCard
  const canExpand = hasExpandableDetail(activity, renderInputs)
  const showInlinePulse =
    isInlineActivity && (activity.status === 'running' || activity.status === 'pending')

  const toggleExpanded = () => {
    if (!canExpand) return
    setExpanded((current) => !current)
  }

  return (
    <>
      <div
        className={`activity-row ${isInlineActivity ? 'activity-row-inline' : 'activity-row-card'} ${expanded ? 'expanded' : 'collapsed'}${!canExpand ? ' no-expand' : ''}${showInlinePulse ? ' is-pulsing' : ''}`}
        data-category={activity.category || 'unknown'}
        data-status={activity.status}
        data-provider={provider || 'unknown'}
        role={canExpand ? 'button' : undefined}
        tabIndex={canExpand ? 0 : -1}
        aria-expanded={canExpand ? expanded : undefined}
        onClick={canExpand ? toggleExpanded : undefined}
        onKeyDown={
          canExpand
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  toggleExpanded()
                }
              }
            : undefined
        }
      >
        <span className={justCompleted ? 'activity-status-stamping' : undefined}>
          <ActivityStatusIcon status={activity.status} />
        </span>
        <div className="activity-body">
          <div className="activity-header">
            <div className="activity-label">
              <span className="activity-label-main">
                {isWriteAction && activityFilePath && !isInlineActivity ? (
                  <FileTypeIcon
                    path={activityFilePath}
                    size={14}
                    className="activity-file-type-icon"
                    workspacePath={workspacePath}
                  />
                ) : null}
                {!isInlineActivity &&
                  !(isWriteAction && activityFilePath) &&
                  (() => {
                    // Prefer the hand-drawn tool-family icon (Phase L3
                    // skeuomorphic redesign — see `ToolFamilyIcon.tsx`).
                    // Fall back to the legacy category icon when the
                    // tool name doesn't map to any known family — keeps
                    // unknown / custom MCP tools visible rather than
                    // disappearing into a placeholder.
                    const family = toolNameToFamily(activity.toolName)
                    return family ? (
                      <ToolFamilyIcon
                        family={family}
                        className="activity-category-icon"
                      />
                    ) : (
                      <ToolCategoryIcon category={activity.category} />
                    )
                  })()}
                {isInlineActivity &&
                  (() => {
                    // Phase L3 slice 7 — inline-row icon. Use the
                    // hand-drawn tool-family icon at a small size and
                    // tint it via the same `category-{X}` color the
                    // legacy pip carried (the class drives the
                    // currentColor inheritance). Fall back to the
                    // legacy pip when the tool name doesn't map to
                    // any family — keeps unknown tools visible.
                    const inlineFamily = toolNameToFamily(activity.toolName)
                    return inlineFamily ? (
                      <ToolFamilyIcon
                        family={inlineFamily}
                        size={11}
                        className={`activity-inline-icon category-${activity.category || 'unknown'}`}
                      />
                    ) : (
                      <span
                        className={`activity-category-pip category-${activity.category || 'unknown'}`}
                      />
                    )
                  })()}
                {isInlineActivity ? (
                  getInlineActivityTitle(activity, activityFilePath)
                ) : (
                  <ActivityTitle activity={activity} filePath={activityFilePath} />
                )}
                {inlineStats.visible && (
                  <span className="activity-line-stats">
                    <DigitOdometer
                      value={inlineStats.additions}
                      sign="+"
                      className="activity-line-stat activity-line-stat-add"
                    />
                    <DigitOdometer
                      value={inlineStats.deletions}
                      sign="-"
                      className="activity-line-stat activity-line-stat-delete"
                    />
                    {inlineStats.confidence && inlineStats.confidence !== 'exact' && (
                      <span className="activity-line-stat-estimated">~</span>
                    )}
                  </span>
                )}
              </span>
            </div>
          </div>
          {metaText && (
            <div
              className="activity-meta"
              title={isWriteAction && activityFilePath ? activityFilePath : undefined}
            >
              {metaText}
            </div>
          )}

          {renderAsCard && (
            <div className="activity-detail">
              {showDebugWarning && (
                <div style={{ color: 'var(--warning)' }}>Tool event missing name</div>
              )}
              {sanitizedDetail.rows.length > 0 && (
                <div className="activity-detail-grid">
                  {sanitizedDetail.rows.map((row) => (
                    <div key={`${row.label}-${row.value}`} className="activity-detail-row">
                      <span className="activity-detail-label">{row.label}</span>
                      <span className="activity-detail-value">{row.value}</span>
                    </div>
                  ))}
                </div>
              )}
              <ActivityDiffFiles diffSummary={diffSummary} workspacePath={workspacePath} />
              {sanitizedDetail.previews.map((preview) => (
                <div key={`${preview.label}-${preview.content.slice(0, 32)}`}>
                  <div className="activity-detail-section-title">{preview.label}</div>
                  <ActivityPreview preview={preview} />
                </div>
              ))}
              {shouldShowRawEvent && (!!activity.rawUseEvent || !!activity.rawResultEvent) && (
                <div>
                  <div className="activity-detail-section-title">Raw event</div>
                  <pre className="activity-output-terminal">
                    {JSON.stringify(activity.rawUseEvent || activity.rawResultEvent, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {childThread && (
        <ChildAgentThreadCard
          thread={childThread}
          activities={childActivities || []}
          workspacePath={workspacePath}
        />
      )}
    </>
  )
}
