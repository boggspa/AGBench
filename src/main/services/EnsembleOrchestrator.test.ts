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
    ensemble
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
})
