import type { ToolActivity } from '../../../main/store/types'
import { extractResultOutput } from '../lib/ToolParser'

export interface CreativeTimelineDiffItemSummary {
  index: number
  type: string
  name?: string
  refName?: string
  offset?: string
  start?: string
  duration?: string
  fields?: string[]
}

export interface CreativeTimelineChangedItemSummary {
  index: number
  fields: string[]
  before: CreativeTimelineDiffItemSummary
  after: CreativeTimelineDiffItemSummary
}

export interface CreativeTimelineProjectSummary {
  index: number
  title: string
  eventName?: string
  fields: string[]
  addedItems: CreativeTimelineDiffItemSummary[]
  removedItems: CreativeTimelineDiffItemSummary[]
  changedItems: CreativeTimelineChangedItemSummary[]
}

export interface CreativeTimelineDiffCardModel {
  beforePath: string
  afterPath: string
  sidecarPath?: string
  summary: {
    addedItemCount: number
    removedItemCount: number
    changedItemCount: number
    affectedAssetCount: number
    affectedEffectCount: number
    beforeTruncated: boolean
    afterTruncated: boolean
  }
  affectedAssets: Array<{ id: string; name: string }>
  affectedEffects: Array<{ id: string; name: string }>
  projects: CreativeTimelineProjectSummary[]
  warnings: string[]
}

function stripToolNamespace(toolName: string): string {
  const normalized = (toolName || '').toLowerCase()
  if (normalized.startsWith('mcp__')) {
    const index = normalized.indexOf('__', 5)
    return index > 5 ? normalized.slice(index + 2) : normalized
  }
  if (normalized.startsWith('taskwraith__')) return normalized.slice('taskwraith__'.length)
  return normalized
}

export function isCreativeTimelineDiffActivity(activity: Pick<ToolActivity, 'toolName'>): boolean {
  return stripToolNamespace(activity.toolName) === 'creative_timeline_diff'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number {
  const numeric =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 'true'
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed = JSON.parse(trimmed)
    return asRecord(parsed)
  } catch {
    return null
  }
}

function timelineDiffPayloadFromActivity(activity: ToolActivity): Record<string, unknown> | null {
  const rawText = activity.rawResultEvent ? extractResultOutput(activity.rawResultEvent) : ''
  const text = rawText || activity.outputPreview || activity.resultSummary || ''
  const parsed = parseJsonObject(text)
  if (!parsed || parsed.diff !== 'fcpxml-timeline-diff-v1') return null
  return parsed
}

function itemSummary(value: unknown): CreativeTimelineDiffItemSummary {
  const item = asRecord(value)
  const refName = stringValue(item.refName) || stringValue(item.ref)
  return {
    index: numberValue(item.index),
    type: stringValue(item.type) || 'item',
    name: stringValue(item.name),
    refName,
    offset: stringValue(item.offset),
    start: stringValue(item.start),
    duration: stringValue(item.duration),
    fields: asArray(item.fields).map(String).filter(Boolean)
  }
}

function changedItemSummary(value: unknown): CreativeTimelineChangedItemSummary {
  const item = asRecord(value)
  return {
    index: numberValue(item.index),
    fields: asArray(item.fields).map(String).filter(Boolean),
    before: itemSummary(item.before),
    after: itemSummary(item.after)
  }
}

function resourceSummary(value: unknown): { id: string; name: string } {
  const resource = asRecord(value)
  const id = stringValue(resource.id) || 'unknown'
  return {
    id,
    name: stringValue(resource.name) || stringValue(resource.uid) || id
  }
}

function projectSummary(value: unknown): CreativeTimelineProjectSummary {
  const project = asRecord(value)
  const beforeName = stringValue(project.beforeName)
  const afterName = stringValue(project.afterName)
  const title =
    afterName && beforeName && afterName !== beforeName
      ? `${beforeName} -> ${afterName}`
      : afterName || beforeName || `Project ${numberValue(project.index) + 1}`
  return {
    index: numberValue(project.index),
    title,
    eventName: stringValue(project.eventName),
    fields: asArray(project.fields).map(String).filter(Boolean),
    addedItems: asArray(project.addedItems).map(itemSummary),
    removedItems: asArray(project.removedItems).map(itemSummary),
    changedItems: asArray(project.changedItems).map(changedItemSummary)
  }
}

export function creativeTimelineDiffModelFromActivity(
  activity: ToolActivity
): CreativeTimelineDiffCardModel | null {
  if (!isCreativeTimelineDiffActivity(activity)) return null
  const payload = timelineDiffPayloadFromActivity(activity)
  if (!payload) return null

  const summary = asRecord(payload.summary)
  const affectedResources = asRecord(payload.affectedResources)
  const sidecar = asRecord(payload.sidecar)
  return {
    beforePath: stringValue(payload.beforePath) || 'original FCPXML',
    afterPath: stringValue(payload.afterPath) || 'draft FCPXML',
    sidecarPath: stringValue(sidecar.recommendedPath),
    summary: {
      addedItemCount: numberValue(summary.addedItemCount),
      removedItemCount: numberValue(summary.removedItemCount),
      changedItemCount: numberValue(summary.changedItemCount),
      affectedAssetCount: numberValue(summary.affectedAssetCount),
      affectedEffectCount: numberValue(summary.affectedEffectCount),
      beforeTruncated: booleanValue(summary.beforeTruncated),
      afterTruncated: booleanValue(summary.afterTruncated)
    },
    affectedAssets: asArray(affectedResources.assets).map(resourceSummary),
    affectedEffects: asArray(affectedResources.effects).map(resourceSummary),
    projects: asArray(payload.projects).map(projectSummary),
    warnings: asArray(payload.warnings).map(String).filter(Boolean)
  }
}

export function creativeTimelineItemLabel(item: CreativeTimelineDiffItemSummary): string {
  return item.name || item.refName || `${item.type} ${item.index + 1}`
}
