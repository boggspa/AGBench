import type { RunEventRecord } from '../../../main/store/types'

export type ClassifiedRunEvent =
  | { kind: 'approval' }
  | { kind: 'file_edit'; files: string[] }
  | { kind: 'tool' }
  | { kind: 'other' }

const FILE_EDIT_TOOL_NAMES = new Set([
  'edit_file',
  'create_file',
  'delete_file',
  'replace',
  'write_file',
  'apply_patch',
  'patch',
])

export function classifyRunEvent(event: RunEventRecord): ClassifiedRunEvent {
  if (event.kind.startsWith('approval_')) {
    return { kind: 'approval' }
  }
  if (event.kind !== 'tool') {
    return { kind: 'other' }
  }

  const payload = isRecord(event.payload) ? event.payload : {}
  const toolName = readToolName(payload)
  if (!toolName || !FILE_EDIT_TOOL_NAMES.has(toolName)) {
    return { kind: 'tool' }
  }

  return {
    kind: 'file_edit',
    files: extractFilePaths(payload),
  }
}

function readToolName(payload: Record<string, unknown>): string {
  const raw =
    payload.tool_name ??
    payload.toolName ??
    payload.name ??
    (isRecord(payload.data) ? payload.data.tool_name ?? payload.data.toolName ?? payload.data.name : undefined)
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

function extractFilePaths(payload: Record<string, unknown>): string[] {
  const paths = new Set<string>()
  collectPath(payload.path, paths)
  collectPath(payload.filePath, paths)
  collectPath(payload.file_path, paths)
  collectPath(payload.targetPath, paths)
  collectPath(payload.target_path, paths)

  const parameters = isRecord(payload.parameters) ? payload.parameters : undefined
  if (parameters) {
    collectPath(parameters.path, paths)
    collectPath(parameters.filePath, paths)
    collectPath(parameters.file_path, paths)
    collectPath(parameters.targetPath, paths)
    collectPath(parameters.target_path, paths)
    collectChanges(parameters.changes, paths)
  }

  const result = isRecord(payload.result) ? payload.result : undefined
  if (result) {
    collectPath(result.path, paths)
    collectPath(result.filePath, paths)
    collectPath(result.file_path, paths)
    collectChanges(result.changes, paths)
  }

  collectChanges(payload.changes, paths)
  return [...paths]
}

function collectChanges(value: unknown, paths: Set<string>): void {
  if (!Array.isArray(value)) return
  for (const change of value) {
    if (!isRecord(change)) continue
    collectPath(change.path, paths)
    collectPath(change.filePath, paths)
    collectPath(change.file_path, paths)
  }
}

function collectPath(value: unknown, paths: Set<string>): void {
  if (typeof value !== 'string') return
  const path = value.trim()
  if (path) paths.add(path)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
