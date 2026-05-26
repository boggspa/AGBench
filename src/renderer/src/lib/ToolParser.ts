import {
  DiffFileStatus,
  ToolActivity,
  ToolActivityStatus,
  ToolDiffFileSummary,
  ToolDiffSummary
} from '../../../main/store/types'
import { lookupToolDisplayName, titleCaseToolName } from './ToolDisplayNames'

export function extractToolName(event: any): string {
  if (!event || typeof event !== 'object') return 'unknown'
  return (
    event.tool_name ||
    event.toolName ||
    event.name ||
    event.function?.name ||
    event.tool ||
    'unknown'
  )
}

export function extractToolId(event: any): string {
  if (!event || typeof event !== 'object') return `unknown-${Date.now()}`
  return (
    event.tool_id ||
    event.toolId ||
    event.id ||
    event.call_id ||
    event.tool_call_id ||
    `unknown-${Date.now()}`
  )
}

export function extractParentToolCallId(event: any): string | undefined {
  if (!event || typeof event !== 'object') return undefined
  const candidates = [
    event.parent_tool_use_id,
    event.parentToolUseId,
    event.parent_tool_call_id,
    event.parentToolCallId,
    event.parent_id,
    event.parentId,
    event.params?.parent_tool_use_id,
    event.params?.parentToolUseId,
    event.message?.parent_tool_use_id
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return undefined
}

export function extractParameters(event: any): Record<string, unknown> {
  if (!event || typeof event !== 'object') return {}
  return (
    event.parameters ||
    event.params ||
    event.payload ||
    event.args ||
    event.input ||
    event.arguments ||
    {}
  )
}

/**
 * MCP tool results come back wrapped in the standard
 * `{ content: [{ type: 'text', text: string }, ...] }` envelope.
 * The agent itself unwraps this before reasoning — but the AGBench
 * renderer was dumping the raw JSON straight into `<pre>` blocks,
 * showing `{"content":[{"type":"text","text":"Exit code: 0\n..."}]}`
 * where it should have shown plain command output.
 *
 * `isMcpEnvelopeObject` + `extractMcpEnvelopeText` work at the object
 * level (when the raw tool result is still a parsed JS object); the
 * exported `unwrapMcpEnvelope` works at the string level (when the
 * result has already been stringified — typically by an earlier
 * `JSON.stringify` fallback in this same function).
 *
 * Phase L5 slice 1.
 */
function isMcpEnvelopeObject(value: unknown): value is {
  content: Array<{ type: 'text'; text: string } | { type: string; [k: string]: unknown }>
} {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  if (!Array.isArray(obj.content)) return false
  // At least one text-shaped part. We tolerate other part types
  // (image, resource_link, etc.) mixed in — they're skipped during
  // text extraction below rather than rejecting the whole envelope.
  return obj.content.some(
    (item) =>
      item !== null &&
      typeof item === 'object' &&
      (item as Record<string, unknown>).type === 'text' &&
      typeof (item as Record<string, unknown>).text === 'string'
  )
}

function extractMcpEnvelopeText(value: { content: unknown[] }): string {
  return value.content
    .filter(
      (item): item is { type: 'text'; text: string } =>
        item !== null &&
        typeof item === 'object' &&
        (item as Record<string, unknown>).type === 'text' &&
        typeof (item as Record<string, unknown>).text === 'string'
    )
    .map((item) => item.text)
    .join('')
}

/**
 * Detect strings that JSON-parse to an MCP `{content:[{type:'text',
 * text}]}` envelope and return the concatenated `text` fields.
 * Pass-through for plain strings, non-JSON, malformed JSON, and JSON
 * that doesn't fit the envelope shape.
 *
 * Wired in two places (Phase L5 slice 1):
 *   - upstream in `extractResultOutput` so fresh tool calls produce a
 *     clean `resultSummary` from the start.
 *   - renderer-side in `ActivityPreview` so legacy transcripts already
 *     persisted with envelope-shaped strings render cleanly on next
 *     view.
 */
export function unwrapMcpEnvelope(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return ''
  if (!raw) return raw
  const trimmed = raw.trim()
  // Quick reject: not even JSON-shaped. The vast majority of
  // outputs (plain command stdout, file contents, etc.) hit this
  // path and pay near-zero cost.
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return raw
  try {
    const parsed = JSON.parse(trimmed)
    if (isMcpEnvelopeObject(parsed)) {
      return extractMcpEnvelopeText(parsed)
    }
    // Valid JSON but not an MCP envelope — leave the original
    // string intact. `prettyPrintJson` is a separate concern.
    return raw
  } catch {
    return raw
  }
}

/**
 * Re-indent JSON-shaped strings with 2-space indentation when they
 * come in as one-liner blobs. Skip already-formatted content (any
 * line that starts with whitespace followed by `"` / `[` / `{` is
 * a strong signal that the JSON is already pretty-printed).
 *
 * Phase L5 slice 1 — used by `ActivityPreview` to make structured
 * tool outputs (post-MCP-unwrap fallback, or genuinely-JSON-shaped
 * results like `git status --porcelain=v2 --json`) readable in
 * the expansion panel rather than rendering as a single 10kb line.
 */
export function prettyPrintJson(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return ''
  if (!raw) return raw
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return raw
  // Heuristic skip: any newline followed by indentation + a JSON
  // structural character means it's already pretty-printed.
  if (/\n[ \t]+["[{]/.test(trimmed)) return raw
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return raw
  }
}

export function extractResultOutput(resultEvent: any): string {
  if (!resultEvent || typeof resultEvent !== 'object') return ''
  const evt = resultEvent
  // Phase L5 slice 1 — check raw OBJECT shapes for the MCP envelope
  // BEFORE falling through to string extraction. If `evt.result`
  // or `evt.output` is the envelope object itself, we extract the
  // text directly instead of stringifying it and re-parsing later.
  if (isMcpEnvelopeObject(evt.result)) return extractMcpEnvelopeText(evt.result)
  if (isMcpEnvelopeObject(evt.output)) return extractMcpEnvelopeText(evt.output)
  if (isMcpEnvelopeObject(evt)) return extractMcpEnvelopeText(evt)
  // String fallback paths — each goes through `unwrapMcpEnvelope`
  // so a value already serialised as `{"content":[...]}` gets
  // unwrapped before we ship it back to the renderer.
  if (typeof evt.output === 'string') return unwrapMcpEnvelope(evt.output)
  if (typeof evt.result === 'string') return unwrapMcpEnvelope(evt.result)
  if (typeof evt.content === 'string') return unwrapMcpEnvelope(evt.content)
  if (typeof evt.summary === 'string') return evt.summary
  if (typeof evt.message === 'string') return evt.message
  if (typeof evt.text === 'string') return evt.text
  if (evt.result && typeof evt.result === 'object') {
    if (typeof evt.result.output === 'string') return unwrapMcpEnvelope(evt.result.output)
    if (typeof evt.result.summary === 'string') return evt.result.summary
    if (typeof evt.result.message === 'string') return evt.result.message
    return JSON.stringify(evt.result)
  }
  if (evt.output && typeof evt.output === 'object') {
    return JSON.stringify(evt.output)
  }
  return ''
}

export function extractStatus(resultEvent: any): ToolActivityStatus {
  if (!resultEvent || typeof resultEvent !== 'object') return 'success'
  if (resultEvent.error || resultEvent.status === 'error') return 'error'
  if (resultEvent.status === 'warning') return 'warning'
  return 'success'
}

export type ToolCategory = 'task' | 'read' | 'write' | 'search' | 'shell' | 'unknown'

const WRITE_LIKE_TOOL_NAMES = new Set([
  'replace',
  'write_file',
  'create_file',
  'edit_file',
  'delete_file',
  'edit',
  'write',
  'multiedit',
  'notebookedit',
  'apply_patch',
  'str_replace',
  'str_replace_editor',
  'strreplaceeditor'
])

export function isWriteLikeToolName(toolName: string): boolean {
  const name = (toolName || '').toLowerCase()
  if (!name) return false
  if (WRITE_LIKE_TOOL_NAMES.has(name)) return true
  if (name.endsWith('__write_file')) return true
  if (name.endsWith('__replace')) return true
  if (name.endsWith('__create_file')) return true
  if (name.endsWith('__edit_file')) return true
  if (name.endsWith('__delete_file')) return true
  if (name.endsWith('__edit')) return true
  if (name.endsWith('__write')) return true
  if (name.endsWith('__apply_patch')) return true
  return false
}

export function getToolCategory(toolName: string): ToolCategory {
  const name = (toolName || '').toLowerCase()
  const unqualifiedName = stripToolNamespace(name)
  if (
    [
      'update_topic',
      'ensemble_yield',
      'invoke_agent',
      'summary',
      'intent',
      'progress',
      'tool_progress',
      'codex_reasoning',
      'codex_plan',
      'kimi_thinking'
    ].includes(unqualifiedName)
  )
    return 'task'
  if (unqualifiedName === 'read_file' || unqualifiedName === 'list_directory') return 'read'
  if (isWriteLikeToolName(name)) return 'write'
  if (
    ['grep_search', 'glob', 'search', 'grep', 'rg', 'google_web_search', 'web_search'].includes(
      name
    )
  )
    return 'search'
  if (unqualifiedName === 'run_shell_command' || unqualifiedName === 'shell') return 'shell'
  return 'unknown'
}

function stripToolNamespace(toolName: string): string {
  if (toolName.startsWith('mcp__')) {
    const index = toolName.indexOf('__', 5)
    return index > 5 ? toolName.slice(index + 2) : toolName
  }
  if (toolName.startsWith('mcp_') && !toolName.startsWith('mcp__')) {
    const knownServerPrefixes = ['mcp_agbench_', 'mcp_agentbench_']
    for (const prefix of knownServerPrefixes) {
      if (toolName.startsWith(prefix)) return toolName.slice(prefix.length)
    }
  }
  if (toolName.startsWith('agbench__')) return toolName.slice('agbench__'.length)
  if (toolName.startsWith('agentbench__')) return toolName.slice('agentbench__'.length)
  if (toolName.startsWith('agbench_')) return toolName.slice('agbench_'.length)
  if (toolName.startsWith('agentbench_')) return toolName.slice('agentbench_'.length)
  return toolName
}

function getFirstStringParam(params: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = params[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export function getToolDisplayName(toolName: string, parameters?: Record<string, unknown>): string {
  const category = getToolCategory(toolName)
  const unqualifiedName = stripToolNamespace((toolName || '').toLowerCase())
  const params = parameters || {}
  const filePath = (params.file_path as string) || (params.path as string) || ''
  const beforePath =
    (params.before_path as string) ||
    (params.beforePath as string) ||
    (params.basePath as string) ||
    ''
  const afterPath =
    (params.after_path as string) ||
    (params.afterPath as string) ||
    (params.draftPath as string) ||
    ''
  const target = getFirstStringParam(params, ['target', 'participant', 'to', 'next'])

  if (unqualifiedName === 'creative_app_status') return 'Creative app status'
  if (unqualifiedName === 'creative_app_capabilities') return 'Creative app capabilities'
  if (unqualifiedName === 'creative_project_snapshot') {
    return filePath ? `Creative project snapshot ${filePath}` : 'Creative project snapshot'
  }
  if (unqualifiedName === 'creative_timeline_validate') {
    return filePath ? `Validate timeline ${filePath}` : 'Validate timeline'
  }
  if (unqualifiedName === 'creative_timeline_ir') {
    return filePath ? `Timeline IR ${filePath}` : 'Timeline IR'
  }
  if (unqualifiedName === 'creative_timeline_diff') {
    return beforePath && afterPath ? `Timeline diff ${beforePath} -> ${afterPath}` : 'Timeline diff'
  }

  switch (category) {
    case 'task':
      if (unqualifiedName === 'ensemble_yield') {
        return target ? `Yielding to ${target}` : 'Yielding'
      }
      if (unqualifiedName === 'update_topic') {
        const topic =
          (params.title as string) ||
          (params.topic as string) ||
          (params.name as string) ||
          ''
        return topic ? `Topic update: ${topic}` : 'Topic update'
      }
      if (unqualifiedName === 'codex_reasoning')
        return (params.title as string) || 'Thinking note'
      if (unqualifiedName === 'kimi_thinking')
        return (params.title as string) || 'Kimi thinking'
      if (unqualifiedName === 'codex_plan') return 'Plan update'
      if (unqualifiedName === 'invoke_agent')
        return (params.title as string) || 'Delegated task'
      if (unqualifiedName === 'summary') return (params.title as string) || 'Summary'
      if (unqualifiedName === 'intent') return (params.title as string) || 'Intent'
      return (params.title as string) || 'Task update'
    case 'read':
      if (toolName.toLowerCase() === 'list_directory')
        return filePath ? `Listed ${filePath}` : 'Listed directory'
      return filePath ? `Read ${filePath}` : 'Read file'
    case 'write': {
      const name = toolName.toLowerCase()
      if (
        name === 'replace' ||
        name.endsWith('__replace') ||
        name === 'edit' ||
        name === 'edit_file' ||
        name.endsWith('__edit_file') ||
        name === 'multiedit' ||
        name === 'notebookedit' ||
        name === 'apply_patch' ||
        name.endsWith('__apply_patch') ||
        name.includes('str_replace')
      ) {
        return filePath ? `Edited ${filePath}` : 'Edited file'
      }
      if (name === 'create_file' || name.endsWith('__create_file')) {
        return filePath ? `Created ${filePath}` : 'Created file'
      }
      if (name === 'delete_file' || name.endsWith('__delete_file')) {
        return filePath ? `Deleted ${filePath}` : 'Deleted file'
      }
      return filePath ? `Wrote ${filePath}` : 'Wrote file'
    }
    case 'search': {
      const query =
        (params.query as string) ||
        (params.search_query as string) ||
        (params.pattern as string) ||
        ''
      if (toolName.toLowerCase().includes('web_search')) {
        return query ? `Searched web for ${query}` : 'Searched web'
      }
      const searchPath = (params.path as string) || (params.dir as string) || ''
      return query
        ? `Searched for ${query}`
        : searchPath
          ? `Searched ${searchPath}`
          : 'Searched project'
    }
    case 'shell':
      return 'Shell command'
    default: {
      // Catch-all branch. Order:
      //   1. Tool dictionary — friendly past-tense or noun-phrase
      //      label (e.g. delegate_to_subthread → "Delegated to
      //      sub-thread"). Renders standalone, no "Used " prefix.
      //   2. Snake-case title-case fallback (e.g. magic_tool →
      //      "Used Magic Tool"), keeping the "Used " prefix as a
      //      hint that this came through the generic path.
      //   3. The literal toolName (e.g. camelCase identifiers we
      //      can't safely re-split), still with the "Used " prefix.
      //   4. "Used unknown" when toolName is empty / "unknown".
      if (!toolName || toolName === 'unknown') return 'Used unknown'
      const friendly = lookupToolDisplayName(unqualifiedName)
      if (friendly) return friendly
      const titleCased = titleCaseToolName(unqualifiedName)
      return `Used ${titleCased || toolName}`
    }
  }
}

export function estimateLineChanges(parameters?: Record<string, unknown>): {
  additions?: number
  deletions?: number
} {
  if (!parameters) return {}
  const oldString = parameters.old_string as string | undefined
  const newString = parameters.new_string as string | undefined
  if (typeof oldString === 'string' && typeof newString === 'string') {
    const oldLines = oldString.split('\n').length
    const newLines = newString.split('\n').length
    return { additions: newLines, deletions: oldLines }
  }
  const content = parameters.content as string | undefined
  if (typeof content === 'string') {
    return { additions: content.split('\n').length, deletions: 0 }
  }
  return {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number | undefined {
  const numeric =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : undefined
}

function normalizeStatus(value: unknown): ToolDiffFileSummary['status'] {
  const status = String(value || '').toLowerCase()
  if (status === 'add' || status === 'create' || status === 'created' || status === 'new')
    return 'created'
  if (status === 'delete' || status === 'deleted' || status === 'remove' || status === 'removed')
    return 'deleted'
  if (status === 'rename' || status === 'renamed') return 'renamed'
  if (status === 'modify' || status === 'modified' || status === 'edit' || status === 'update')
    return 'modified'
  return status ? (status as DiffFileStatus | 'updated' | 'unknown') : 'unknown'
}

function getPathFromRecord(record: Record<string, unknown>): string | undefined {
  const path =
    stringValue(record.path) ||
    stringValue(record.filePath) ||
    stringValue(record.file_path) ||
    stringValue(record.target) ||
    stringValue(record.target_file) ||
    stringValue(record.target_file_path)
  return path.trim() || undefined
}

function summarizeFiles(
  files: ToolDiffFileSummary[],
  source: ToolDiffSummary['source'],
  confidence: ToolDiffSummary['confidence']
): ToolDiffSummary | undefined {
  if (files.length === 0) return undefined
  let hasStats = false
  const totals = files.reduce<{ additions: number; deletions: number }>(
    (acc, file) => {
      if (file.additions !== undefined || file.deletions !== undefined) hasStats = true
      acc.additions += file.additions || 0
      acc.deletions += file.deletions || 0
      return acc
    },
    { additions: 0, deletions: 0 }
  )

  return {
    additions: hasStats ? totals.additions : undefined,
    deletions: hasStats ? totals.deletions : undefined,
    files,
    source,
    confidence: hasStats ? confidence : 'unknown'
  }
}

function parseChanges(value: unknown): ToolDiffSummary | undefined {
  if (!Array.isArray(value)) return undefined
  const files = value
    .filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === 'object' && !Array.isArray(item))
    )
    .map((item) => ({
      path: getPathFromRecord(item),
      status: normalizeStatus(item.kind || item.type || item.operation || item.status),
      additions: numberValue(item.additions ?? item.added ?? item.linesAdded ?? item.insertions),
      deletions: numberValue(item.deletions ?? item.deleted ?? item.linesDeleted ?? item.removals)
    }))

  return summarizeFiles(files, 'codex_changes', 'exact')
}

export function parseUnifiedDiffSummary(diffText: string): ToolDiffSummary | undefined {
  if (!diffText.trim()) return undefined

  const files: ToolDiffFileSummary[] = []
  let current: ToolDiffFileSummary | null = null

  const commitCurrent = () => {
    if (current) {
      files.push(current)
      current = null
    }
  }

  for (const line of diffText.split('\n')) {
    const diffHeader = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
    if (diffHeader) {
      commitCurrent()
      current = {
        path: diffHeader[2] || diffHeader[1],
        status: 'modified',
        additions: 0,
        deletions: 0
      }
      continue
    }

    if (!current) {
      current = { additions: 0, deletions: 0, status: 'unknown' }
    }

    if (line.startsWith('+++ b/')) current.path = line.slice(6)
    if (line.startsWith('new file mode')) current.status = 'created'
    if (line.startsWith('deleted file mode')) current.status = 'deleted'
    if (line.startsWith('+') && !line.startsWith('+++'))
      current.additions = (current.additions || 0) + 1
    if (line.startsWith('-') && !line.startsWith('---'))
      current.deletions = (current.deletions || 0) + 1
  }

  commitCurrent()
  const usefulFiles = files.filter((file) => file.path || file.additions || file.deletions)
  return summarizeFiles(usefulFiles, 'patch_preview', 'exact')
}

function getPatchPreview(parameters?: Record<string, unknown>, resultText?: string): string {
  if (!parameters) return resultText || ''
  return (
    stringValue(parameters.patchPreview) ||
    stringValue(parameters.patch_preview) ||
    stringValue(parameters.patch) ||
    stringValue(parameters.diff) ||
    stringValue(parameters.unifiedDiff) ||
    stringValue(parameters.unified_diff) ||
    resultText ||
    ''
  )
}

export function deriveToolDiffSummary(
  toolName: string,
  parameters?: Record<string, unknown>,
  resultText?: string
): ToolDiffSummary | undefined {
  const category = getToolCategory(toolName)
  const changesSummary = parseChanges(parameters?.changes)
  if (
    changesSummary?.confidence === 'exact' &&
    ((changesSummary.additions || 0) > 0 || (changesSummary.deletions || 0) > 0)
  ) {
    return changesSummary
  }

  const patchPreview = getPatchPreview(parameters, resultText)
  const patchSummary = parseUnifiedDiffSummary(patchPreview)
  if (patchSummary) {
    const path = parameters ? getPathFromRecord(parameters) : undefined
    if (path) {
      return {
        ...patchSummary,
        files: (patchSummary.files || []).map((file) => ({
          ...file,
          path: file.path || path
        }))
      }
    }
    return patchSummary
  }

  if (changesSummary) return changesSummary

  const replacement = estimateLineChanges(parameters)
  if (replacement.additions !== undefined || replacement.deletions !== undefined) {
    const path = parameters ? getPathFromRecord(parameters) : undefined
    const source =
      typeof parameters?.old_string === 'string' && typeof parameters?.new_string === 'string'
        ? 'string_replace'
        : 'content'
    return {
      additions: replacement.additions || 0,
      deletions: replacement.deletions || 0,
      files: [
        {
          path,
          status:
            category === 'write' && toolName.toLowerCase() === 'create_file'
              ? 'created'
              : 'modified',
          additions: replacement.additions || 0,
          deletions: replacement.deletions || 0
        }
      ],
      source,
      confidence:
        source === 'content' && toolName.toLowerCase() !== 'edit_file' ? 'exact' : 'estimated'
    }
  }

  return undefined
}

export function createToolActivity(toolUseEvent: any): ToolActivity {
  const toolName = extractToolName(toolUseEvent)
  const parameters = extractParameters(toolUseEvent)
  const category = getToolCategory(toolName)
  const displayName = getToolDisplayName(toolName, parameters)
  const filePath = (parameters.file_path as string) || (parameters.path as string) || undefined
  const parentToolCallId = extractParentToolCallId(toolUseEvent)

  return {
    id: extractToolId(toolUseEvent),
    toolName,
    displayName,
    category,
    status: 'running',
    startedAt: new Date().toISOString(),
    parameters,
    filePath,
    diffSummary: deriveToolDiffSummary(toolName, parameters),
    rawUseEvent: toolUseEvent,
    parentToolCallId,
    // Legacy fields
    operationCategory: category as any,
    affectedFilePath: filePath
  }
}

export function pairToolResult(activity: ToolActivity, toolResultEvent: any): ToolActivity {
  const resultOutput = extractResultOutput(toolResultEvent)
  const status = extractStatus(toolResultEvent)
  const endedAt = new Date().toISOString()
  const durationMs = activity.startedAt
    ? new Date(endedAt).getTime() - new Date(activity.startedAt).getTime()
    : undefined

  return {
    ...activity,
    status,
    endedAt,
    durationMs,
    diffSummary:
      deriveToolDiffSummary(activity.toolName, activity.parameters, resultOutput) ||
      activity.diffSummary,
    resultSummary: resultOutput.substring(0, 500) + (resultOutput.length > 500 ? '...' : ''),
    outputPreview: resultOutput.substring(0, 500) + (resultOutput.length > 500 ? '...' : ''),
    rawResultEvent: toolResultEvent,
    // Legacy
    outputSummary: resultOutput.substring(0, 500) + (resultOutput.length > 500 ? '...' : '')
  }
}

export function isToolUseEvent(event: any): boolean {
  if (!event || typeof event !== 'object') return false
  return event.type === 'tool_use' || event.type === 'tool_call'
}

export function isToolResultEvent(event: any): boolean {
  if (!event || typeof event !== 'object') return false
  return (
    event.type === 'tool_result' || event.type === 'tool_output' || event.type === 'tool_response'
  )
}
