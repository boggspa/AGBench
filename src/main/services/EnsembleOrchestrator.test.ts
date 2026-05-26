import { describe, expect, it, vi } from 'vitest'
import { EnsembleOrchestrator } from './EnsembleOrchestrator'
import type { AgentRunPayload } from '../index'
import type { AppSettings, ChatRecord, EnsembleConfig } from '../store/types'

const ensemble: EnsembleConfig = {
  enabled: true,
  maxParticipants: 4,
  participants: [
    {
      id: 'claude',
      provider: 'claude',
      enabled: true,
      role: 'Reviewer',
      instructions: 'Review.',
      order: 1,
      model: 'claude-model',
      permissionPresetId: 'read_only'
    },
    {
      id: 'codex',
      provider: 'codex',
      enabled: true,
      role: 'Worker',
      instructions: 'Work.',
      order: 2,
      model: 'codex-model',
      permissionPresetId: 'workspace_write'
    }
  ]
}

function makeChat(): ChatRecord {
  // Deep-clone the ensemble fixture per call. The previous shape
  // returned the module-level `ensemble` reference, so tests that
  // mutated `harness.chat.ensemble!.participants` leaked state into
  // subsequent tests' default fixture. Slice C's 3-participant
  // yield-target test surfaces this; the clone keeps every test
  // independent.
  return {
    appChatId: 'ensemble-chat',
    chatKind: 'ensemble',
    scope: 'workspace',
    provider: 'claude',
    title: 'New Ensemble',
    workspaceId: 'ws-1',
    workspacePath: '/repo',
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    messages: [],
    runs: [],
    ensemble: { ...ensemble, participants: ensemble.participants.map((p) => ({ ...p })) }
  }
}

function makeSettings(): AppSettings {
  return {
    storeLocalChatHistory: true,
    storeRawEvents: true,
    storePromptResponseInUsage: false,
    ensembleModeEnabled: true,
    geminiCheckpointingEnabled: false,
    chatContextTurns: 8,
    appearanceMode: 'solid',
    visualEffectStyle: 'classic',
    themeAppearance: 'system',
    themeCornerStyle: 'rounded',
    themeAccentStyle: 'system',
    toolIconAccent: 'system',
    userBubbleColor: 'system',
    promptSurfaceStyle: 'theme',
    composerStyle: 'default',
    funFxEnabled: false,
    funFxMode: 'off',
    advancedFx: {
      agentAura: false,
      livingWorkspace: false,
      dataViz: false,
      intensity: 'subtle'
    },
    reduceTransparency: false,
    reduceMotion: false,
    compactDensity: false,
    showInspector: true,
    inspectorWidth: 320,
    sidebarWidth: 300,
    agenticServices: {
      shellCommands: 'ask',
      fileChanges: 'ask',
      mcpTools: 'ask',
      subThreadDelegation: 'ask',
      networkAccess: 'allow'
    },
    agenticWorkspaceGrants: [],
    autoResumeParentOnSubThreadCompletion: true,
    geminiMcpBridgeEnabled: true,
    bridgeDaemonEnabled: false,
    codexSandboxFallback: 'ask_rerun',
    updateChannel: 'stable',
    approvalTimeouts: {
      enabled: true,
      perProviderMs: { gemini: 120000, codex: 30000, claude: 120000, kimi: 60000 },
      mainAuthorityMs: 120000
    }
  }
}

function makeHarness(options: {
  dispatch?: (payload: AgentRunPayload) => Promise<{ dispatched: boolean; appRunId: string }>
} = {}) {
  let chat = makeChat()
  let counter = 0
  const dispatched: AgentRunPayload[] = []
  const dispatch = vi.fn(async (payload: AgentRunPayload) => {
    dispatched.push(payload)
    return options.dispatch
      ? options.dispatch(payload)
      : { dispatched: true, appRunId: payload.appRunId || '' }
  })
  const cancelRun = vi.fn(async () => true)
  const orchestrator = new EnsembleOrchestrator({
    getChat: () => chat,
    saveChat: (next) => {
      chat = next
    },
    getSettings: makeSettings,
    dispatch,
    cancelRun,
    createRunId: (provider) => `${provider}-run-${++counter}`,
    now: () => counter,
    nowIso: () => `2026-05-24T00:00:0${counter}.000Z`
  })
  return {
    get chat() {
      return chat
    },
    cancelRun,
    dispatched,
    dispatch,
    orchestrator
  }
}

describe('EnsembleOrchestrator', () => {
  it('dispatches participants serially in configured order', async () => {
    const harness = makeHarness()
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Please review and implement.',
      event: { sender: {} as Electron.WebContents }
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))
    expect(harness.dispatched[0].provider).toBe('claude')
    expect(harness.dispatched[0].ensembleRun).toMatchObject({
      roundId: harness.chat.ensemble?.activeRound?.roundId,
      participantId: 'claude',
      provider: 'claude',
      role: 'Reviewer',
      order: 1
    })
    harness.orchestrator.handleProviderOutput('claude', {
      appRunId: harness.dispatched[0].appRunId,
      appChatId: 'ensemble-chat'
    }, {
      type: 'result',
      status: 'success',
      stats: { total_tokens: 10 }
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(2))
    expect(harness.dispatched[1].provider).toBe('codex')
  })

  it('dispatches duplicate-provider participants by participant id', async () => {
    const harness = makeHarness()
    harness.chat.ensemble!.maxParticipants = 6
    harness.chat.ensemble!.participants = [
      {
        id: 'codex-primary',
        provider: 'codex',
        enabled: true,
        role: 'Worker',
        instructions: 'Work with the primary model.',
        order: 1,
        model: 'gpt-5.5',
        permissionPresetId: 'workspace_write'
      },
      {
        id: 'codex-review',
        provider: 'codex',
        enabled: true,
        role: 'Reviewer',
        instructions: 'Review with the alternate model.',
        order: 2,
        model: 'gpt-5.4',
        permissionPresetId: 'read_only'
      }
    ]

    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Run both Codex participants.',
      event: { sender: {} as Electron.WebContents }
    })

    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))
    expect(harness.dispatched[0]).toMatchObject({
      provider: 'codex',
      model: 'gpt-5.5',
      ensembleRun: { participantId: 'codex-primary', role: 'Worker' }
    })

    harness.orchestrator.handleProviderOutput(
      'codex',
      { appRunId: harness.dispatched[0].appRunId, appChatId: 'ensemble-chat' },
      { type: 'result', status: 'success', stats: { total_tokens: 5 } }
    )

    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(2))
    expect(harness.dispatched[1]).toMatchObject({
      provider: 'codex',
      model: 'gpt-5.4',
      ensembleRun: { participantId: 'codex-review', role: 'Reviewer' }
    })
  })

  it('queues a fresh round after the current speaker finishes', async () => {
    const harness = makeHarness()
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'First prompt',
      event: { sender: {} as Electron.WebContents }
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))
    const queued = harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Second prompt',
      event: { sender: {} as Electron.WebContents },
      mode: 'queue'
    })
    expect(queued.status).toBe('queued')
    harness.orchestrator.handleProviderOutput('claude', {
      appRunId: harness.dispatched[0].appRunId,
      appChatId: 'ensemble-chat'
    }, {
      type: 'result',
      status: 'success'
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(2))
    expect(harness.chat.messages.map((message) => message.content)).toContain('Second prompt')
  })

  it('steers by cancelling the active run without deleting the replacement round', async () => {
    const harness = makeHarness()
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Original prompt',
      event: { sender: {} as Electron.WebContents }
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))
    const oldRun = harness.dispatched[0]

    const steered = harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Steered prompt',
      event: { sender: {} as Electron.WebContents },
      mode: 'steer'
    })

    expect(steered.status).toBe('steered')
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(2))
    expect(harness.cancelRun).toHaveBeenCalledWith('claude', oldRun.appRunId)
    expect(harness.chat.ensemble?.activeRound?.roundId).toBe(steered.roundId)
    expect(harness.chat.ensemble?.activeRound?.prompt).toBe('Steered prompt')
    expect(harness.chat.messages.map((message) => message.content)).toContain(
      'Ensemble steered: interrupted the active speaker and started a fresh round.'
    )

    const handled = harness.orchestrator.handleProviderOutput('claude', {
      appRunId: oldRun.appRunId,
      appChatId: 'ensemble-chat'
    }, {
      type: 'content',
      text: 'late old content'
    })
    expect(handled).toBe(false)
    expect(harness.chat.messages.map((message) => message.content)).not.toContain(
      'late old content'
    )
  })

  it('continues to the next participant when the current participant yields', async () => {
    const harness = makeHarness()
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Split this work.',
      event: { sender: {} as Electron.WebContents }
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))

    expect(
      harness.orchestrator.markYielded(harness.dispatched[0].appRunId!, 'Passing to worker.')
    ).toBe(true)

    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(2))
    expect(harness.dispatched[1].provider).toBe('codex')
    expect(harness.chat.messages.map((message) => message.content)).toContain(
      'Reviewer yielded. Passing to worker.'
    )
  })

  it('separates Codex ensemble assistant items instead of collapsing them into one wall', async () => {
    const harness = makeHarness()
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Codex should execute this.',
      event: { sender: {} as Electron.WebContents }
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))

    harness.orchestrator.markYielded(harness.dispatched[0].appRunId!, 'Passing to worker.')
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(2))

    harness.orchestrator.handleProviderOutput(
      'codex',
      {
        appRunId: harness.dispatched[1].appRunId,
        appChatId: 'ensemble-chat'
      },
      {
        type: 'content',
        text: 'Baselines are captured.',
        itemId: 'codex-agent-message-1'
      }
    )
    harness.orchestrator.handleProviderOutput(
      'codex',
      {
        appRunId: harness.dispatched[1].appRunId,
        appChatId: 'ensemble-chat'
      },
      {
        type: 'content',
        text: 'The bulk replacement path changed all markers.',
        itemId: 'codex-agent-message-2'
      }
    )
    harness.orchestrator.handleProviderOutput(
      'codex',
      {
        appRunId: harness.dispatched[1].appRunId,
        appChatId: 'ensemble-chat'
      },
      {
        type: 'result',
        status: 'success'
      }
    )

    const codexMessage = harness.chat.messages.find(
      (message) => message.role === 'assistant' && message.metadata?.ensembleProvider === 'codex'
    )
    expect(codexMessage?.content).toContain(
      'Baselines are captured.\n\n---\n\nThe bulk replacement path changed all markers.'
    )
    expect(codexMessage?.content).not.toContain(
      'Baselines are captured.The bulk replacement path changed all markers.'
    )
  })

  it('accumulates Gemini CLI message-shape deltas into the ensemble assistant message', async () => {
    // Regression: pre-fix, `handleProviderOutput` only matched
    // `{ type: 'content', text }` — Codex / Claude / Kimi shape. Gemini's
    // CLI fallback path emits `{ type: 'message', role: 'assistant',
    // delta: true, content }` so its deltas were silently dropped and
    // `run.content` stayed empty, leaving the participant's bubble
    // missing in the transcript. The shape branch in
    // `EnsembleOrchestrator.handleProviderOutput()` now accepts both.
    const harness = makeHarness()
    harness.chat.ensemble!.participants = [
      {
        id: 'ensemble-gemini',
        provider: 'gemini',
        enabled: true,
        role: 'Researcher',
        instructions: 'Research.',
        order: 1,
        permissionPresetId: 'read_only'
      }
    ]
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Gemini, what is the weather?',
      event: { sender: {} as Electron.WebContents }
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))
    expect(harness.dispatched[0].provider).toBe('gemini')

    const route = {
      appRunId: harness.dispatched[0].appRunId,
      appChatId: 'ensemble-chat'
    }
    harness.orchestrator.handleProviderOutput('gemini', route, {
      type: 'message',
      role: 'assistant',
      delta: true,
      content: 'Yo!'
    })
    harness.orchestrator.handleProviderOutput('gemini', route, {
      type: 'message',
      role: 'assistant',
      delta: true,
      content: ' Doing great, honestly.'
    })
    harness.orchestrator.handleProviderOutput('gemini', route, {
      type: 'message',
      role: 'assistant',
      delta: true,
      content: ' Sunset is beautiful.'
    })
    harness.orchestrator.handleProviderOutput('gemini', route, {
      type: 'result',
      status: 'success',
      stats: { total_tokens: 47070 }
    })

    const geminiMessage = harness.chat.messages.find(
      (message) => message.role === 'assistant' && message.metadata?.ensembleProvider === 'gemini'
    )
    expect(geminiMessage?.content).toBe('Yo! Doing great, honestly. Sunset is beautiful.')
  })

  it('skipActiveParticipant cancels the active run and advances to the next participant', async () => {
    // Post-ship UX: replaces the redundant "Stop Ensemble" button with
    // a per-participant Skip affordance. Skip must:
    //   1. Call `cancelRun` so the provider stream stops
    //   2. Finalise the active run as `'skipped'` (not `'yielded'`,
    //      which implies the model voluntarily passed)
    //   3. Let `runRound`'s while-loop advance naturally to the next
    //      participant without restarting the round (unlike Steer,
    //      which cancels + re-dispatches the same participant)
    //   4. Drop a system message announcing the skip
    const harness = makeHarness()
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Plan and execute.',
      event: { sender: {} as Electron.WebContents }
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))
    expect(harness.dispatched[0].provider).toBe('claude')

    const skipped = await harness.orchestrator.skipActiveParticipant('ensemble-chat')
    expect(skipped).toBe(true)
    expect(harness.cancelRun).toHaveBeenCalledWith('claude', harness.dispatched[0].appRunId)

    // Round continues — next participant dispatched without restart.
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(2))
    expect(harness.dispatched[1].provider).toBe('codex')

    // System message announcing the skip.
    const skipMessage = harness.chat.messages.find(
      (message) =>
        message.role === 'system' && message.metadata?.ensembleStatus === 'skipped'
    )
    expect(skipMessage?.content).toContain('Reviewer skipped.')
    expect(skipMessage?.metadata?.ensembleProvider).toBe('claude')
  })

  it('persists tool calls used by ensemble participants into a role:tool message', async () => {
    // Regression: tool calls used by ensemble participants weren't
    // showing in the transcript. Root cause: the renderer-side tool
    // accumulator (App.tsx:10292+) requires an active run context in
    // `activeRunsRef`, which only gets registered by `executeRun` on
    // the solo-chat path. Ensemble runs are dispatched from main, so
    // the renderer is a passive observer of the orchestrator's chat
    // saves — meaning the orchestrator has to persist tool messages
    // directly. This test exercises the tool_use → tool_result pairing
    // and asserts the resulting message lands in `chat.messages` with
    // ensemble metadata + ordering before the assistant message.
    const harness = makeHarness()
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Use a tool and tell me what you found.',
      event: { sender: {} as Electron.WebContents }
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))
    expect(harness.dispatched[0].provider).toBe('claude')

    const route = {
      appRunId: harness.dispatched[0].appRunId,
      appChatId: 'ensemble-chat'
    }
    // Realistic chronology: agent narrates intent, calls a tool,
    // receives the result, then summarises. The timeline-driven
    // flush should produce three messages interleaved in this
    // order: assistant("Let me read…"), tool(read_file),
    // assistant("Found it.").
    harness.orchestrator.handleProviderOutput('claude', route, {
      type: 'content',
      text: "Let me read the file first."
    })
    harness.orchestrator.handleProviderOutput('claude', route, {
      type: 'tool_use',
      tool_id: 'call-1',
      tool_name: 'read_file',
      parameters: { file_path: '/tmp/notes.md' }
    })
    harness.orchestrator.handleProviderOutput('claude', route, {
      type: 'tool_result',
      tool_id: 'call-1',
      content: 'File contents...'
    })
    harness.orchestrator.handleProviderOutput('claude', route, {
      type: 'content',
      text: 'Found it — those are the notes.'
    })
    harness.orchestrator.handleProviderOutput('claude', route, {
      type: 'result',
      status: 'success',
      stats: { total_tokens: 10 }
    })

    const toolMessages = harness.chat.messages.filter(
      (message) => message.role === 'tool' && message.metadata?.ensembleProvider === 'claude'
    )
    expect(toolMessages).toHaveLength(1)
    expect(toolMessages[0].toolActivities).toHaveLength(1)
    expect(toolMessages[0].toolActivities?.[0].toolName).toBe('read_file')
    expect(toolMessages[0].toolActivities?.[0].displayName).toBe('Read /tmp/notes.md')
    expect(toolMessages[0].toolActivities?.[0].status).toBe('success')
    expect(toolMessages[0].toolActivities?.[0].parameters?.file_path).toBe('/tmp/notes.md')

    // Interleaved ordering: the participant's transcript slice
    // should read assistant → tool → assistant. The flushRun
    // pass walks the timeline and emits one message per entry, so
    // a two-content + one-tool timeline produces three messages.
    const participantMessages = harness.chat.messages.filter(
      (message) =>
        message.runId === harness.dispatched[0].appRunId &&
        (message.role === 'assistant' || message.role === 'tool')
    )
    expect(participantMessages.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant'])
    expect(participantMessages[0].content).toContain('Let me read the file first.')
    expect(participantMessages[2].content).toContain('Found it')
  })

  it('skipActiveParticipant returns false when no round is active', async () => {
    const harness = makeHarness()
    const skipped = await harness.orchestrator.skipActiveParticipant('ensemble-chat')
    expect(skipped).toBe(false)
    expect(harness.cancelRun).not.toHaveBeenCalled()
  })

  it('skips a failed dispatch and advances the round', async () => {
    let calls = 0
    const harness = makeHarness({
      dispatch: async (payload) => ({
        dispatched: ++calls !== 1,
        appRunId: payload.appRunId || ''
      })
    })

    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Try both participants.',
      event: { sender: {} as Electron.WebContents }
    })

    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(2))
    expect(harness.dispatched[0].provider).toBe('claude')
    expect(harness.dispatched[1].provider).toBe('codex')
    expect(harness.chat.messages.map((message) => message.content)).toContain(
      'Reviewer failed. Dispatch failed.'
    )
  })

  it('stores human-readable ensemble yield tool activity labels', async () => {
    const harness = makeHarness()
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Review then yield.',
      event: { sender: {} as Electron.WebContents }
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))

    const route = {
      appRunId: harness.dispatched[0].appRunId,
      appChatId: 'ensemble-chat'
    }
    harness.orchestrator.handleProviderOutput('claude', route, {
      type: 'tool_use',
      tool_id: 'yield-1',
      tool_name: 'mcp_AGBench_ensemble_yield',
      parameters: { target: 'Worker' }
    })
    harness.orchestrator.handleProviderOutput('claude', route, {
      type: 'tool_result',
      tool_id: 'yield-1',
      content: 'Yielded.'
    })
    harness.orchestrator.handleProviderOutput('claude', route, {
      type: 'result',
      status: 'success',
      stats: { total_tokens: 10 }
    })

    await vi.waitFor(() =>
      expect(
        harness.chat.messages.filter(
          (message) => message.role === 'tool' && message.metadata?.ensembleProvider === 'claude'
        )
      ).toHaveLength(1)
    )
    const toolMessages = harness.chat.messages.filter(
      (message) => message.role === 'tool' && message.metadata?.ensembleProvider === 'claude'
    )
    expect(toolMessages[0].toolActivities?.[0]).toMatchObject({
      toolName: 'mcp_AGBench_ensemble_yield',
      displayName: 'Reviewer yielded to Worker',
      category: 'task',
      status: 'success'
    })
  })

  it('clears queued work when a round is stopped', async () => {
    const harness = makeHarness()
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Original prompt',
      event: { sender: {} as Electron.WebContents }
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Queued prompt',
      event: { sender: {} as Electron.WebContents },
      mode: 'queue'
    })
    expect(harness.chat.ensemble?.activeRound?.queuedPrompt).toBe('Queued prompt')

    await harness.orchestrator.cancelRound('ensemble-chat')

    expect(harness.chat.ensemble?.activeRound?.status).toBe('cancelled')
    expect(harness.chat.ensemble?.activeRound?.queuedPrompt).toBeUndefined()
    expect(harness.cancelRun).toHaveBeenCalledWith('claude', harness.dispatched[0].appRunId)
  })

  // Slice D (1.0.3) — per-participant reasoning + fast-mode + thinking
  // flow through the dispatch payload so each provider adapter sees
  // its own settings. Verifies the orchestrator-side wiring.
  it('threads per-participant model + reasoning + fast-mode through dispatch', async () => {
    const harness = makeHarness()
    harness.chat.ensemble!.participants = [
      {
        id: 'claude',
        provider: 'claude',
        enabled: true,
        role: 'Reviewer',
        instructions: 'Review.',
        order: 1,
        model: 'claude-opus-4-7',
        permissionPresetId: 'read_only',
        reasoningEffort: 'high',
        fastModeEnabled: true
      },
      {
        id: 'codex',
        provider: 'codex',
        enabled: true,
        role: 'Worker',
        instructions: 'Work.',
        order: 2,
        model: 'gpt-5.5',
        permissionPresetId: 'workspace_write',
        reasoningEffort: 'xhigh',
        fastModeEnabled: true
      }
    ]
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Tune per-participant settings.',
      event: { sender: {} as Electron.WebContents }
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))
    const claudePayload = harness.dispatched[0]
    expect(claudePayload.provider).toBe('claude')
    expect(claudePayload.model).toBe('claude-opus-4-7')
    expect(claudePayload.claudeReasoningEffort).toBe('high')
    expect(claudePayload.claudeFastMode).toBe(true)
    // Claude run should NOT carry Codex-only fields.
    expect(claudePayload.reasoningEffort).toBeUndefined()
    expect(claudePayload.serviceTier).toBeUndefined()

    harness.orchestrator.handleProviderOutput(
      'claude',
      { appRunId: claudePayload.appRunId, appChatId: 'ensemble-chat' },
      { type: 'result', status: 'success', stats: { total_tokens: 10 } }
    )
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(2))
    const codexPayload = harness.dispatched[1]
    expect(codexPayload.provider).toBe('codex')
    expect(codexPayload.model).toBe('gpt-5.5')
    expect(codexPayload.reasoningEffort).toBe('xhigh')
    expect(codexPayload.serviceTier).toBe('fast')
    expect(codexPayload.claudeReasoningEffort).toBeUndefined()
    expect(codexPayload.claudeFastMode).toBeUndefined()
  })

  it('threads participant-scoped tool grants through effective permissions', async () => {
    const harness = makeHarness()
    harness.chat.ensemble!.participants = [
      {
        id: 'claude',
        provider: 'claude',
        enabled: true,
        role: 'Reviewer',
        instructions: 'Review.',
        order: 1,
        model: 'claude-model',
        permissionPresetId: 'read_only'
      },
      {
        id: 'codex',
        provider: 'codex',
        enabled: true,
        role: 'Worker',
        instructions: 'Work.',
        order: 2,
        model: 'codex-model',
        permissionPresetId: 'default',
        permissionOverrides: {
          agenticServices: {
            shellCommands: 'allow',
            fileChanges: 'allow'
          }
        }
      }
    ]
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Check participant grants.',
      event: { sender: {} as Electron.WebContents }
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))
    expect(harness.dispatched[0].effectivePermissions?.agenticServices.shellCommands).toBe('deny')
    expect(harness.dispatched[0].effectivePermissions?.agenticServices.fileChanges).toBe('deny')

    harness.orchestrator.markYielded(harness.dispatched[0].appRunId!, 'Passing to worker.')
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(2))

    const codexPayload = harness.dispatched[1]
    expect(codexPayload.effectivePermissions?.agenticServices.shellCommands).toBe('allow')
    expect(codexPayload.effectivePermissions?.agenticServices.fileChanges).toBe('allow')
    expect(codexPayload.effectivePermissions?.workspaceGrantServiceIds).toEqual([])
  })

  // Slice C extension (1.0.3) — ensemble_yield(target:) reorders the
  // remaining participants so the named target speaks next.
  it('promotes a participant tagged via @mention to speak next', async () => {
    // Collaborative back-and-forth: Claude finishes its turn, mentions
    // @Researcher in its content, and the orchestrator promotes
    // Gemini (role 'Researcher') ahead of Codex even though Codex is
    // next in default order. Resolution mirrors `resolveYieldTargetIndex`
    // (id → provider → role).
    const harness = makeHarness()
    harness.chat.ensemble!.participants = [
      {
        id: 'ensemble-claude',
        provider: 'claude',
        enabled: true,
        role: 'Planner',
        instructions: 'Plan.',
        order: 1,
        permissionPresetId: 'read_only'
      },
      {
        id: 'ensemble-codex',
        provider: 'codex',
        enabled: true,
        role: 'Worker',
        instructions: 'Work.',
        order: 2,
        permissionPresetId: 'workspace_write'
      },
      {
        id: 'ensemble-gemini',
        provider: 'gemini',
        enabled: true,
        role: 'Researcher',
        instructions: 'Research.',
        order: 3,
        permissionPresetId: 'read_only'
      }
    ]
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Plan and hand off.',
      event: { sender: {} as Electron.WebContents }
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))
    expect(harness.dispatched[0].provider).toBe('claude')

    // Claude emits content containing an @Researcher mention then
    // finishes naturally (result event drives finalize).
    const claudeRoute = {
      appRunId: harness.dispatched[0].appRunId,
      appChatId: 'ensemble-chat'
    }
    harness.orchestrator.handleProviderOutput('claude', claudeRoute, {
      type: 'content',
      text: 'Plan ready. Yielding to @Researcher for a fact-check.'
    })
    harness.orchestrator.handleProviderOutput('claude', claudeRoute, {
      type: 'result',
      status: 'success',
      stats: { total_tokens: 10 }
    })

    // Default order would be Codex next; @Researcher should override.
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(2))
    expect(harness.dispatched[1].provider).toBe('gemini')
  })

  it('promotes a participant tagged via @mention even when the speaker yields with the same target', async () => {
    // Production path Chris hit: Claude streams content with @codex,
    // then calls `ensemble_yield(target='codex')` via the MCP tool.
    // The yieldTarget branch fires FIRST after completion resolves,
    // but resolveYieldTargetIndex returns -1 because Codex isn't in
    // `remaining` (Codex already spoke). The yield branch silently
    // no-ops. My @-mention code should then fire and re-promote
    // Codex via the `remaining.unshift(tagged)` path.
    const harness = makeHarness()
    harness.chat.ensemble!.orchestrationMode = 'continuous'
    harness.chat.ensemble!.participants = [
      {
        id: 'ensemble-codex',
        provider: 'codex',
        enabled: true,
        role: 'Worker',
        instructions: 'Work.',
        order: 1,
        permissionPresetId: 'workspace_write'
      },
      {
        id: 'ensemble-claude',
        provider: 'claude',
        enabled: true,
        role: 'Planner',
        instructions: 'Plan.',
        order: 2,
        permissionPresetId: 'read_only'
      }
    ]
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Call and response.',
      event: { sender: {} as Electron.WebContents }
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))
    expect(harness.dispatched[0].provider).toBe('codex')

    // Codex speaks (with @claude in content) then yields via tool.
    harness.orchestrator.handleProviderOutput(
      'codex',
      { appRunId: harness.dispatched[0].appRunId, appChatId: 'ensemble-chat' },
      { type: 'content', text: '@claude, what is 2+3?' }
    )
    harness.orchestrator.markYielded(
      harness.dispatched[0].appRunId!,
      'Passing to Claude',
      'claude'
    )
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(2))
    expect(harness.dispatched[1].provider).toBe('claude')

    // Claude speaks (with @codex in content) then yields via tool to
    // codex. By the time the yieldTarget branch runs, `remaining` is
    // empty (Claude was the last in the round) — so the yield branch
    // no-ops. The @-mention branch should fire next and re-promote
    // Codex for a follow-up turn.
    harness.orchestrator.handleProviderOutput(
      'claude',
      { appRunId: harness.dispatched[1].appRunId, appChatId: 'ensemble-chat' },
      {
        type: 'content',
        text: '@codex 2+3=5. Your turn — what is 7-4?'
      }
    )
    harness.orchestrator.markYielded(
      harness.dispatched[1].appRunId!,
      'Passing to Codex',
      'codex'
    )
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(3))
    expect(harness.dispatched[2].provider).toBe('codex')
  })

  it('appends an extra turn when @-tagging a participant who already spoke', async () => {
    // After-round agent-loop: Claude speaks first, then Codex speaks
    // and mentions @Planner — Claude (role 'Planner') gets an extra
    // turn appended so the back-and-forth can continue.
    const harness = makeHarness()
    harness.chat.ensemble!.orchestrationMode = 'continuous'
    harness.chat.ensemble!.participants = [
      {
        id: 'ensemble-claude',
        provider: 'claude',
        enabled: true,
        role: 'Planner',
        instructions: 'Plan.',
        order: 1,
        permissionPresetId: 'read_only'
      },
      {
        id: 'ensemble-codex',
        provider: 'codex',
        enabled: true,
        role: 'Worker',
        instructions: 'Work.',
        order: 2,
        permissionPresetId: 'workspace_write'
      }
    ]
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Quick back and forth.',
      event: { sender: {} as Electron.WebContents }
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))
    expect(harness.dispatched[0].provider).toBe('claude')

    // Claude finishes without an @-mention.
    harness.orchestrator.handleProviderOutput(
      'claude',
      { appRunId: harness.dispatched[0].appRunId, appChatId: 'ensemble-chat' },
      { type: 'result', status: 'success', stats: { total_tokens: 10 } }
    )
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(2))
    expect(harness.dispatched[1].provider).toBe('codex')

    // Codex finishes and mentions @Planner — Claude should re-enter.
    const codexRoute = {
      appRunId: harness.dispatched[1].appRunId,
      appChatId: 'ensemble-chat'
    }
    harness.orchestrator.handleProviderOutput('codex', codexRoute, {
      type: 'content',
      text: 'Need clarification, calling on @Planner.'
    })
    harness.orchestrator.handleProviderOutput('codex', codexRoute, {
      type: 'result',
      status: 'success',
      stats: { total_tokens: 10 }
    })

    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(3))
    expect(harness.dispatched[2].provider).toBe('claude')
    expect(harness.chat.ensemble?.activeRound?.continuationHops).toBe(1)
  })

  it('keeps default turn-bound rounds from looping back to already-spoken participants', async () => {
    const harness = makeHarness()
    harness.chat.ensemble!.participants = [
      {
        id: 'ensemble-claude',
        provider: 'claude',
        enabled: true,
        role: 'Planner',
        instructions: 'Plan.',
        order: 1,
        permissionPresetId: 'read_only'
      },
      {
        id: 'ensemble-codex',
        provider: 'codex',
        enabled: true,
        role: 'Worker',
        instructions: 'Work.',
        order: 2,
        permissionPresetId: 'workspace_write'
      }
    ]
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'One pass only.',
      event: { sender: {} as Electron.WebContents }
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))

    harness.orchestrator.handleProviderOutput(
      'claude',
      { appRunId: harness.dispatched[0].appRunId, appChatId: 'ensemble-chat' },
      { type: 'result', status: 'success', stats: { total_tokens: 10 } }
    )
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(2))

    harness.orchestrator.handleProviderOutput(
      'codex',
      { appRunId: harness.dispatched[1].appRunId, appChatId: 'ensemble-chat' },
      { type: 'content', text: 'Need clarification, calling on @Planner.' }
    )
    harness.orchestrator.handleProviderOutput(
      'codex',
      { appRunId: harness.dispatched[1].appRunId, appChatId: 'ensemble-chat' },
      { type: 'result', status: 'success', stats: { total_tokens: 10 } }
    )

    await vi.waitFor(() =>
      expect(harness.chat.ensemble?.activeRound?.status).toBe('completed')
    )
    expect(harness.dispatched).toHaveLength(2)
    expect(harness.chat.ensemble?.activeRound?.continuationHops || 0).toBe(0)
  })

  it('caps continuous back-and-forth at the configured handoff limit', async () => {
    const harness = makeHarness()
    harness.chat.ensemble!.orchestrationMode = 'continuous'
    harness.chat.ensemble!.maxContinuationHops = 1
    harness.chat.ensemble!.participants = [
      {
        id: 'ensemble-claude',
        provider: 'claude',
        enabled: true,
        role: 'Planner',
        instructions: 'Plan.',
        order: 1,
        permissionPresetId: 'read_only'
      },
      {
        id: 'ensemble-codex',
        provider: 'codex',
        enabled: true,
        role: 'Worker',
        instructions: 'Work.',
        order: 2,
        permissionPresetId: 'workspace_write'
      }
    ]
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Back and forth, but bounded.',
      event: { sender: {} as Electron.WebContents }
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))

    harness.orchestrator.handleProviderOutput(
      'claude',
      { appRunId: harness.dispatched[0].appRunId, appChatId: 'ensemble-chat' },
      { type: 'result', status: 'success', stats: { total_tokens: 10 } }
    )
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(2))

    harness.orchestrator.handleProviderOutput(
      'codex',
      { appRunId: harness.dispatched[1].appRunId, appChatId: 'ensemble-chat' },
      { type: 'content', text: '@Planner please review my implementation.' }
    )
    harness.orchestrator.handleProviderOutput(
      'codex',
      { appRunId: harness.dispatched[1].appRunId, appChatId: 'ensemble-chat' },
      { type: 'result', status: 'success', stats: { total_tokens: 10 } }
    )
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(3))

    harness.orchestrator.handleProviderOutput(
      'claude',
      { appRunId: harness.dispatched[2].appRunId, appChatId: 'ensemble-chat' },
      { type: 'content', text: '@Worker one more pass would help.' }
    )
    harness.orchestrator.handleProviderOutput(
      'claude',
      { appRunId: harness.dispatched[2].appRunId, appChatId: 'ensemble-chat' },
      { type: 'result', status: 'success', stats: { total_tokens: 10 } }
    )

    await vi.waitFor(() =>
      expect(harness.chat.ensemble?.activeRound?.status).toBe('completed')
    )
    expect(harness.dispatched).toHaveLength(3)
    expect(harness.chat.ensemble?.activeRound?.continuationHops).toBe(1)
    expect(harness.chat.messages.map((message) => message.content)).toContain(
      'Continuous handoff limit reached (1/1); returning control to the user.'
    )
  })

  it('does not promote on self-mention (speaker referencing their own role)', async () => {
    const harness = makeHarness()
    harness.chat.ensemble!.participants = [
      {
        id: 'ensemble-claude',
        provider: 'claude',
        enabled: true,
        role: 'Planner',
        instructions: 'Plan.',
        order: 1,
        permissionPresetId: 'read_only'
      },
      {
        id: 'ensemble-codex',
        provider: 'codex',
        enabled: true,
        role: 'Worker',
        instructions: 'Work.',
        order: 2,
        permissionPresetId: 'workspace_write'
      }
    ]
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Plan and execute.',
      event: { sender: {} as Electron.WebContents }
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))
    // Claude narrates its own role in its reply — should NOT loop
    // back to Claude.
    const claudeRoute = {
      appRunId: harness.dispatched[0].appRunId,
      appChatId: 'ensemble-chat'
    }
    harness.orchestrator.handleProviderOutput('claude', claudeRoute, {
      type: 'content',
      text: "As @Planner I'd suggest the following…"
    })
    harness.orchestrator.handleProviderOutput('claude', claudeRoute, {
      type: 'result',
      status: 'success',
      stats: { total_tokens: 10 }
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(2))
    // Default order resumes with Codex; no infinite Claude→Claude loop.
    expect(harness.dispatched[1].provider).toBe('codex')
  })

  it('yields to a named target, skipping intervening participants', async () => {
    const harness = makeHarness()
    harness.chat.ensemble!.participants = [
      {
        id: 'ensemble-claude',
        provider: 'claude',
        enabled: true,
        role: 'Planner',
        instructions: 'Plan.',
        order: 1,
        permissionPresetId: 'read_only'
      },
      {
        id: 'ensemble-gemini',
        provider: 'gemini',
        enabled: true,
        role: 'Researcher',
        instructions: 'Research.',
        order: 2,
        permissionPresetId: 'read_only'
      },
      {
        id: 'ensemble-codex',
        provider: 'codex',
        enabled: true,
        role: 'Worker',
        instructions: 'Work.',
        order: 3,
        permissionPresetId: 'workspace_write'
      }
    ]
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Plan then hand straight to Codex.',
      event: { sender: {} as Electron.WebContents }
    })
    // Claude (planner) goes first.
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))
    expect(harness.dispatched[0].provider).toBe('claude')
    // Claude yields explicitly to Codex (skipping Gemini).
    const claudeRunId = harness.dispatched[0].appRunId!
    harness.orchestrator.markYielded(claudeRunId, 'Plan complete', 'codex')
    // Next dispatch must be Codex, not Gemini.
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(2))
    expect(harness.dispatched[1].provider).toBe('codex')
    // Codex finishes (no yield-target this time) → default ordering
    // resumes with Gemini, who's still in the remaining queue.
    harness.orchestrator.handleProviderOutput(
      'codex',
      { appRunId: harness.dispatched[1].appRunId, appChatId: 'ensemble-chat' },
      { type: 'result', status: 'success', stats: { total_tokens: 10 } }
    )
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(3))
    expect(harness.dispatched[2].provider).toBe('gemini')
  })

  it('falls through to default order when yield target is unresolved', async () => {
    const harness = makeHarness()
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Yield to a phantom participant.',
      event: { sender: {} as Electron.WebContents }
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))
    expect(harness.dispatched[0].provider).toBe('claude')
    // Yield with a target string that matches nothing in the
    // remaining queue — Codex is the only one left, so it should
    // still come up next.
    harness.orchestrator.markYielded(
      harness.dispatched[0].appRunId!,
      'Pass it on',
      'NonExistentProvider'
    )
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(2))
    expect(harness.dispatched[1].provider).toBe('codex')
  })

  it('threads kimi thinking flag through dispatch', async () => {
    const harness = makeHarness()
    harness.chat.ensemble!.participants = [
      {
        id: 'kimi',
        provider: 'kimi',
        enabled: true,
        role: 'Reviewer',
        instructions: 'Review.',
        order: 1,
        model: 'kimi-k2.6',
        permissionPresetId: 'read_only',
        thinkingEnabled: true
      }
    ]
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'Think hard.',
      event: { sender: {} as Electron.WebContents }
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))
    const kimiPayload = harness.dispatched[0]
    expect(kimiPayload.provider).toBe('kimi')
    expect(kimiPayload.kimiThinking).toBe(true)
    // Kimi runs should NOT carry reasoning or fast-mode fields.
    expect(kimiPayload.reasoningEffort).toBeUndefined()
    expect(kimiPayload.serviceTier).toBeUndefined()
    expect(kimiPayload.claudeFastMode).toBeUndefined()
  })

  // A2 (1.0.3) — `dmTargetParticipantId` scopes the round to a
  // single chip. The orchestrator's machinery still drives the run
  // (so per-participant status pills + activeRound state stay
  // coherent), it just iterates a one-element participant list.
  it('scopes the round to a single participant when dmTargetParticipantId is set', async () => {
    const harness = makeHarness()
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'DM Codex only.',
      event: { sender: {} as Electron.WebContents },
      dmTargetParticipantId: 'codex'
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))
    // Codex runs, not Claude (which would normally be first per
    // the default fixture order).
    expect(harness.dispatched[0].provider).toBe('codex')
    // Round's activeRound participant list reflects the filter — the
    // single targeted chip, not the full enabled set.
    expect(harness.chat.ensemble?.activeRound?.participants.map((p) => p.participantId)).toEqual([
      'codex'
    ])

    // Codex finishes → no further dispatch (no Claude/Gemini/Kimi
    // follow-up), because DM is single-participant.
    harness.orchestrator.handleProviderOutput(
      'codex',
      { appRunId: harness.dispatched[0].appRunId, appChatId: 'ensemble-chat' },
      { type: 'result', status: 'success', stats: { total_tokens: 5 } }
    )
    // Give the orchestrator a microtask to settle and confirm no new
    // dispatch lands.
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(harness.dispatched).toHaveLength(1)
  })

  it('falls through to the full round when dmTargetParticipantId points at a non-existent id', async () => {
    const harness = makeHarness()
    harness.orchestrator.startRound({
      chatId: 'ensemble-chat',
      prompt: 'DM phantom.',
      event: { sender: {} as Electron.WebContents },
      dmTargetParticipantId: 'phantom-participant'
    })
    await vi.waitFor(() => expect(harness.dispatched).toHaveLength(1))
    // First in default fixture order = Claude. The unknown DM target
    // is silently ignored; the orchestrator runs the full ordered
    // participant list (safety net for typo / racy IPC).
    expect(harness.dispatched[0].provider).toBe('claude')
  })
})
