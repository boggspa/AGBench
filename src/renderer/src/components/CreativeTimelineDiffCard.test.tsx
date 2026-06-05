import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ToolActivity } from '../../../main/store/types'
import { CreativeTimelineDiffCard } from './CreativeTimelineDiffCard'

function activity(): ToolActivity {
  return {
    id: 'tool-1',
    toolName: 'creative_timeline_diff',
    displayName: 'Timeline diff original.fcpxml -> draft.fcpxml',
    category: 'unknown',
    status: 'success',
    rawResultEvent: {
      type: 'tool_result',
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
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
            })
          }
        ]
      }
    }
  }
}

describe('CreativeTimelineDiffCard', () => {
  it('renders approval-oriented timeline diff details', () => {
    const html = renderToStaticMarkup(<CreativeTimelineDiffCard activity={activity()} />)

    expect(html).toContain('creative-timeline-diff-card')
    expect(html).toContain('Final Cut Pro')
    expect(html).toContain('Timeline diff')
    expect(html).toContain('original.fcpxml')
    expect(html).toContain('draft.fcpxml')
    expect(html).toContain('B-roll cutaway')
    expect(html).toContain('Interview clip')
    expect(html).toContain('Basic Title')
    expect(html).toContain('Source unchanged')
    expect(html).toContain('Apply to copy')
    expect(html).toContain('draft.fcpxml.taskwraith-timeline-diff.json')
  })
})
