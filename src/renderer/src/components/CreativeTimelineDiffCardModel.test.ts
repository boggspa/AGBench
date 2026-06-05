import { describe, expect, it } from 'vitest'
import type { ToolActivity } from '../../../main/store/types'
import {
  creativeTimelineDiffModelFromActivity,
  creativeTimelineItemLabel,
  isCreativeTimelineDiffActivity
} from './CreativeTimelineDiffCardModel'

function samplePayload(): Record<string, unknown> {
  return {
    ok: true,
    diff: 'fcpxml-timeline-diff-v1',
    beforePath: 'original.fcpxml',
    afterPath: 'draft.fcpxml',
    summary: {
      addedItemCount: 1,
      removedItemCount: 0,
      changedItemCount: 2,
      affectedAssetCount: 2,
      affectedEffectCount: 1,
      beforeTruncated: false,
      afterTruncated: false
    },
    affectedResources: {
      assets: [
        { id: 'r2', name: 'B-roll' },
        { id: 'r1', name: 'Interview' }
      ],
      effects: [{ id: 'title1', name: 'Basic Title' }]
    },
    projects: [
      {
        index: 0,
        fields: ['sequence.duration'],
        beforeName: 'Assembly',
        afterName: 'Assembly',
        eventName: 'Day 1',
        addedItems: [
          {
            index: 2,
            type: 'asset-clip',
            name: 'B-roll cutaway',
            refName: 'B-roll',
            duration: '4s'
          }
        ],
        removedItems: [],
        changedItems: [
          {
            index: 0,
            fields: ['duration'],
            before: {
              index: 0,
              type: 'asset-clip',
              name: 'Interview clip',
              refName: 'Interview',
              duration: '10s'
            },
            after: {
              index: 0,
              type: 'asset-clip',
              name: 'Interview clip',
              refName: 'Interview',
              duration: '8s'
            }
          }
        ]
      }
    ],
    sidecar: {
      schema: 'taskwraith-fcpxml-diff-plan-v1',
      recommendedPath: 'draft.fcpxml.taskwraith-timeline-diff.json'
    },
    warnings: []
  }
}

function activity(overrides: Partial<ToolActivity> = {}): ToolActivity {
  return {
    id: 'tool-1',
    toolName: 'mcp__TaskWraith__creative_timeline_diff',
    displayName: 'Timeline diff original.fcpxml -> draft.fcpxml',
    category: 'unknown',
    status: 'success',
    rawResultEvent: {
      type: 'tool_result',
      result: {
        content: [{ type: 'text', text: JSON.stringify(samplePayload()) }]
      }
    },
    ...overrides
  }
}

describe('CreativeTimelineDiffCardModel', () => {
  it('detects namespaced creative timeline diff tool calls', () => {
    expect(isCreativeTimelineDiffActivity(activity())).toBe(true)
    expect(isCreativeTimelineDiffActivity(activity({ toolName: 'creative_timeline_diff' }))).toBe(
      true
    )
    expect(isCreativeTimelineDiffActivity(activity({ toolName: 'creative_timeline_ir' }))).toBe(
      false
    )
  })

  it('parses MCP result JSON into card-ready approval summary data', () => {
    const model = creativeTimelineDiffModelFromActivity(activity())

    expect(model?.beforePath).toBe('original.fcpxml')
    expect(model?.afterPath).toBe('draft.fcpxml')
    expect(model?.sidecarPath).toBe('draft.fcpxml.taskwraith-timeline-diff.json')
    expect(model?.summary.addedItemCount).toBe(1)
    expect(model?.summary.changedItemCount).toBe(2)
    expect(model?.affectedAssets.map((asset) => asset.name)).toEqual(['B-roll', 'Interview'])
    expect(model?.affectedEffects[0].name).toBe('Basic Title')
    expect(model?.projects[0].fields).toEqual(['sequence.duration'])
    expect(model?.projects[0].addedItems[0].name).toBe('B-roll cutaway')
    expect(model?.projects[0].changedItems[0].fields).toEqual(['duration'])
  })

  it('returns null for non-diff payloads and labels items conservatively', () => {
    expect(
      creativeTimelineDiffModelFromActivity(
        activity({
          rawResultEvent: { type: 'tool_result', result: JSON.stringify({ ok: true }) }
        })
      )
    ).toBeNull()
    expect(creativeTimelineItemLabel({ index: 1, type: 'gap' })).toBe('gap 2')
  })
})
