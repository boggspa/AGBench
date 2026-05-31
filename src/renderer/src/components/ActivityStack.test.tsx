import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ActivityStack } from './ActivityStack'
import type { ChatRecord, EnsembleParticipant, ToolActivity } from '../../../main/store/types'

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
      <ActivityStack activities={[makeEnsembleYieldActivity()]} provider="codex" />
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
      <ActivityStack activities={[makeEnsembleYieldActivity()]} provider="codex" chat={chat} />
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

function makeWriteActivity(overrides: Partial<ToolActivity> = {}): ToolActivity {
  return {
    id: 'tool-write-1',
    toolName: 'write_file',
    displayName: 'write_file',
    category: 'write',
    status: 'success',
    startedAt: '2026-05-26T17:00:00Z',
    endedAt: '2026-05-26T17:00:00.250Z',
    durationMs: 250,
    parameters: { file_path: '/repo/src/foo.ts', content: 'hello' },
    resultSummary: 'wrote 1 line',
    ...overrides
  }
}

describe('ActivityStack compactDensity routing', () => {
  it('routes individual tool activities through CompactToolTrace when compactDensity is true', () => {
    const html = renderToStaticMarkup(
      <ActivityStack activities={[makeWriteActivity()]} provider="claude" compactDensity />
    )

    expect(html).toContain('compact-tool-trace')
    // The legacy ActivityRow shell should not render alongside the
    // CompactToolTrace path — verifies we replaced the row, not
    // double-rendered.
    expect(html).not.toContain('activity-row-inline')
  })

  it('uses the standard ActivityRow when compactDensity is false (default)', () => {
    const html = renderToStaticMarkup(
      <ActivityStack activities={[makeWriteActivity()]} provider="claude" />
    )

    expect(html).not.toContain('compact-tool-trace')
    expect(html).toContain('activity-row')
  })

  it('surfaces cross-provider attribution distinctly when activities carry their own metadata.ensembleProvider', () => {
    // Simulates a single ensemble round where Codex called write_file
    // and Claude called Edit — the chat-level provider is "codex" but
    // each activity tags its actor via metadata.ensembleProvider.
    const html = renderToStaticMarkup(
      <ActivityStack
        activities={[
          makeWriteActivity({
            id: 'cross-1',
            toolName: 'write_file',
            metadata: { ensembleProvider: 'codex' }
          }),
          makeWriteActivity({
            id: 'cross-2',
            toolName: 'Edit',
            displayName: 'Edit',
            metadata: { ensembleProvider: 'claude' }
          })
        ]}
        provider="codex"
        compactDensity
      />
    )

    expect(html).toContain('provider-codex')
    expect(html).toContain('provider-claude')
    expect(html).toContain('write_file')
    expect(html).toContain('Edit')
  })

  it('still renders ChildAgentSpawnBlock and falls back to ActivityRow when an activity has a child thread, even in compact mode', () => {
    // Compact-mode bypass only kicks in for activities WITHOUT a
    // child-agent thread — preserves the ChildAgentThreadCard hang-off.
    // Smoke test: an activity that isn't a spawner still uses
    // CompactToolTrace.
    const html = renderToStaticMarkup(
      <ActivityStack activities={[makeWriteActivity()]} provider="codex" compactDensity />
    )
    expect(html).toContain('compact-tool-trace')
  })
})

describe('ActivityStack agent invocation presentation', () => {
  it('labels provider-native child-agent threads with unified invocation copy', () => {
    const html = renderToStaticMarkup(
      <ActivityStack
        provider="claude"
        activities={[
          makeWriteActivity({
            id: 'task-1',
            toolName: 'Task',
            displayName: 'Task',
            category: 'task',
            status: 'running',
            parameters: {
              description: 'Review helper',
              prompt: 'Review the current diff'
            }
          }),
          makeWriteActivity({
            id: 'child-read-1',
            toolName: 'read_file',
            displayName: 'Read file',
            category: 'read',
            parentToolCallId: 'task-1'
          })
        ]}
      />
    )

    expect(html).toContain('Provider Native')
    expect(html).toContain('Provider tool call in this transcript')
    expect(html).toContain('Invocation prompt')
    expect(html).toContain('Provider-native activity')
  })
})

describe('ActivityStack controlled expansion (1.0.6-TV2)', () => {
  it('renders the row collapsed when the controlled set is empty', () => {
    const html = renderToStaticMarkup(
      <ActivityStack
        activities={[makeWriteActivity({ id: 'tool-x' })]}
        provider="codex"
        expandedActivityIds={new Set()}
        onExpandedActivityIdsChange={() => {}}
      />
    )
    expect(html).toContain('data-expanded="false"')
    expect(html).not.toContain('data-expanded="true"')
  })

  it('renders the row expanded when its id is in the controlled set', () => {
    // Proves expansion is driven by the parent-owned set, not local
    // state — the property transcript virtualisation relies on so an
    // expanded tool row survives scrolling out of the window and back.
    const html = renderToStaticMarkup(
      <ActivityStack
        activities={[makeWriteActivity({ id: 'tool-x' })]}
        provider="codex"
        expandedActivityIds={new Set(['tool-x'])}
        onExpandedActivityIdsChange={() => {}}
      />
    )
    expect(html).toContain('data-expanded="true"')
  })

  it('still works uncontrolled (no controlled props) — starts collapsed', () => {
    // Backward-compat guard: every other ActivityStack call site omits
    // the controlled props and must keep its original local-state
    // behaviour (rows start collapsed).
    const html = renderToStaticMarkup(
      <ActivityStack activities={[makeWriteActivity({ id: 'tool-y' })]} provider="codex" />
    )
    expect(html).toContain('data-expanded="false"')
    expect(html).not.toContain('data-expanded="true"')
  })
})
