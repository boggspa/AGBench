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
