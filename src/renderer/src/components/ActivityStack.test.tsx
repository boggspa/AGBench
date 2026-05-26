import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ActivityStack } from './ActivityStack'
import type {
  ChatRecord,
  EnsembleParticipant,
  ToolActivity
} from '../../../main/store/types'

function makeEnsembleYieldActivity(overrides: Partial<ToolActivity> = {}): ToolActivity {
  return {
    id: 'tool-yield-1',
    toolName: 'mcp_AGBench_ensemble_yield',
    displayName: 'Captain K yielding to Gems',
    category: 'task',
    status: 'success',
    startedAt: '2026-05-26T17:00:00Z',
    endedAt: '2026-05-26T17:00:01Z',
    durationMs: 1000,
    parameters: { target: 'Gems' },
    ...overrides
  }
}

function makeEnsembleChat(participants: EnsembleParticipant[]): ChatRecord {
  return {
    appChatId: 'ensemble-chat',
    chatKind: 'ensemble',
    scope: 'workspace',
    provider: 'codex',
    title: 'Ensemble run',
    workspaceId: 'ws-1',
    workspacePath: '/repo',
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    messages: [],
    runs: [],
    ensemble: {
      enabled: true,
      maxParticipants: 6,
      participants
    }
  }
}

function makeParticipant(overrides: Partial<EnsembleParticipant>): EnsembleParticipant {
  return {
    id: 'ensemble-gemini',
    provider: 'gemini',
    enabled: true,
    role: 'Gems',
    instructions: '',
    order: 1,
    ...overrides
  }
}

describe('ActivityStack ensemble_yield rendering', () => {
  it('humanizes the Codex-style mcp_AGBench_ensemble_yield tool name', () => {
    const html = renderToStaticMarkup(
      <ActivityStack
        activities={[makeEnsembleYieldActivity()]}
        provider="codex"
      />
    )

    expect(html).toContain('yielding to')
    expect(html).toContain('@Gems')
    expect(html).not.toContain('mcp_AGBench_ensemble_yield')
  })

  it('humanizes the Claude-style mcp__AGBench__ensemble_yield tool name', () => {
    const html = renderToStaticMarkup(
      <ActivityStack
        activities={[
          makeEnsembleYieldActivity({
            id: 'tool-yield-2',
            toolName: 'mcp__AGBench__ensemble_yield'
          })
        ]}
        provider="claude"
      />
    )

    expect(html).toContain('yielding to')
    expect(html).toContain('@Gems')
    expect(html).not.toContain('mcp__AGBench__ensemble_yield')
  })

  it('humanizes the bare ensemble_yield tool name', () => {
    const html = renderToStaticMarkup(
      <ActivityStack
        activities={[
          makeEnsembleYieldActivity({
            id: 'tool-yield-3',
            toolName: 'ensemble_yield'
          })
        ]}
        provider="gemini"
      />
    )

    expect(html.toLowerCase()).toContain('yielding to')
    expect(html).toContain('@Gems')
  })

  it('tints the target chip with the resolved participant provider when chat carries the roster', () => {
    const chat = makeEnsembleChat([
      makeParticipant({ id: 'ensemble-gemini', provider: 'gemini', role: 'Gems', order: 1 }),
      makeParticipant({ id: 'ensemble-codex', provider: 'codex', role: 'Captain K', order: 2 })
    ])

    const html = renderToStaticMarkup(
      <ActivityStack
        activities={[makeEnsembleYieldActivity()]}
        provider="codex"
        chat={chat}
      />
    )

    expect(html).toContain('activity-yield-target')
    expect(html).toContain('provider-gemini')
    expect(html).toContain('@Gems')
  })

  it('falls back to humanized label even when displayName is the raw tool name (defensive bypass)', () => {
    // Simulates an upstream path that constructs the activity without
    // running it through the humanization helper — `displayName` is left
    // as the raw tool name. The renderer should still produce a friendly
    // label by reading `parameters.target` directly via
    // `renderEnsembleYieldTitle`, never surfacing the raw name.
    const html = renderToStaticMarkup(
      <ActivityStack
        activities={[
          makeEnsembleYieldActivity({
            id: 'tool-yield-raw',
            toolName: 'mcp_AGBench_ensemble_yield',
            displayName: 'mcp_AGBench_ensemble_yield'
          })
        ]}
        provider="codex"
      />
    )

    expect(html).toContain('Yielding to')
    expect(html).toContain('@Gems')
    expect(html).not.toContain('mcp_AGBench_ensemble_yield')
  })

  it('does not surface a raw tool name when filePath candidate fields (target) resolve to the yield target', () => {
    // `getFilePathFromActivity` lists `target` among its candidate
    // fields, so an ensemble_yield activity always presents a non-empty
    // `activityFilePath` equal to the target name. The legacy file-path
    // render branch in `ActivityTitle` would otherwise emit
    // `<displayName-or-toolName> <strong>{target}</strong>` — i.e. the
    // exact "raw tool name + bold target" shape the bug report calls
    // out. The ensemble_yield short-circuit must run first.
    const html = renderToStaticMarkup(
      <ActivityStack
        activities={[
          makeEnsembleYieldActivity({
            displayName: '',
            parameters: { target: 'Captain K' }
          })
        ]}
        provider="codex"
      />
    )

    expect(html).toContain('Yielding to')
    expect(html).toContain('@Captain K')
    expect(html).not.toMatch(/<strong[^>]*>Captain K<\/strong>/)
    expect(html).not.toContain('mcp_AGBench_ensemble_yield')
  })
})
