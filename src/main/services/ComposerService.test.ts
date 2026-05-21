import { describe, expect, it, vi } from 'vitest'
import {
  ComposerService,
  type ComposerRunPayload,
  type ComposerServiceDeps,
  type ComposerServiceStore
} from './ComposerService'
import type { AppSettings, ChatRecord, ExternalPathGrant, ProviderId } from '../store/types'

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    storeLocalChatHistory: true,
    storeRawEvents: true,
    storePromptResponseInUsage: true,
    geminiCheckpointingEnabled: false,
    chatContextTurns: 6,
    appearanceMode: 'solid',
    visualEffectStyle: 'auto',
    themeAppearance: 'system',
    themeCornerStyle: 'rounded',
    themeAccentStyle: 'system',
    promptSurfaceStyle: 'theme',
    composerStyle: 'default',
    funFxEnabled: false,
    funFxMode: 'subtle',
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
    inspectorWidth: 360,
    sidebarWidth: 260,
    agenticServices: {
      shellCommands: 'workspace',
      fileChanges: 'ask',
      mcpTools: 'ask',
      subThreadDelegation: 'ask',
      networkAccess: 'allow'
    },
    agenticWorkspaceGrants: [],
    autoResumeParentOnSubThreadCompletion: true,
    geminiMcpBridgeEnabled: false,
    codexSandboxFallback: 'ask_rerun',
    updateChannel: 'stable',
    approvalTimeouts: {
      enabled: true,
      perProviderMs: {
        gemini: 30_000,
        codex: 30_000,
        claude: 120_000,
        kimi: 60_000
      },
      mainAuthorityMs: 30_000
    },
    ...overrides
  }
}

function makeChat(overrides: Partial<ChatRecord> = {}): ChatRecord {
  return {
    appChatId: 'chat-1',
    scope: 'workspace',
    provider: 'gemini',
    title: 'Chat',
    workspaceId: 'workspace-1',
    workspacePath: '/repo',
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    messages: [
      {
        id: 'u1',
        role: 'user',
        content: 'Previous question',
        timestamp: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Previous answer',
        timestamp: '2026-01-01T00:00:01.000Z'
      }
    ],
    runs: [],
    ...overrides
  }
}

function makeDeps(
  chat: ChatRecord,
  settings: Partial<AppSettings> = {}
): {
  deps: ComposerServiceDeps
  store: ComposerServiceStore
} {
  const store: ComposerServiceStore = {
    getChat: vi.fn(() => chat)
  }
  return {
    store,
    deps: {
      appStore: store,
      getSettings: vi.fn(() => makeSettings(settings))
    }
  }
}

function compose(
  chatOverrides: Partial<ChatRecord>,
  inputOverrides: Record<string, unknown>,
  settings: Partial<AppSettings> = {}
): ComposerRunPayload {
  const chat = makeChat(chatOverrides)
  const { deps } = makeDeps(chat, settings)
  const service = new ComposerService(deps)
  return service.composeRun({
    chatId: chat.appChatId,
    provider: chat.provider as ProviderId,
    workspace: chat.workspacePath,
    userInput: 'Do the thing',
    selectedModelType: 'flash-lite',
    approvalMode: 'default',
    ...inputOverrides
  })
}

function makeGrant(overrides: Partial<ExternalPathGrant> = {}): ExternalPathGrant {
  return {
    id: 'grant-1',
    provider: 'codex',
    path: '/outside/file.txt',
    kind: 'file',
    access: 'read',
    duration: 'thisThread',
    issuedBy: 'main',
    signature: 'signed',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('ComposerService', () => {
  it('builds Gemini workspace prompts with compact context and write-tool preamble', () => {
    const payload = compose({ provider: 'gemini' }, {})
    expect(payload.provider).toBe('gemini')
    expect(payload.prompt).toContain(
      'AGBench runtime note: this Gemini workspace run is write-capable.'
    )
    expect(payload.prompt).toContain('Conversation context (last 1 turn(s)):')
    expect(payload.prompt).toContain('User: Previous question')
    expect(payload.prompt).toContain('Current user request:\nDo the thing')
    expect(payload.composer.contextTurnsApplied).toBe(6)
  })

  it('teaches Gemini about cross-provider delegate_to_subthread (Phase I3.1)', () => {
    // The runtime note must mention delegate_to_subthread + the
    // cross-provider rule so Gemini doesn't quietly fall back to its
    // built-in invoke_agent when the user asks for "delegate to Kimi".
    const payload = compose({ provider: 'gemini' }, {})
    expect(payload.prompt).toContain('delegate_to_subthread')
    expect(payload.prompt).toContain('agentbench__delegate_to_subthread')
    expect(payload.prompt).toContain('CROSS-PROVIDER delegation')
    expect(payload.prompt).toContain("provider: 'kimi'")
    expect(payload.prompt).toContain('NEVER use your built-in invoke_agent')
    // Recall guidance must be present so follow-up turns continue the
    // same sub-thread instead of spawning a fresh one with zero memory
    // (observed bug: Codex/Gemini sending status-check delegations as
    // brand-new sub-threads, getting "first turn, no prior actions"
    // responses from sub-agents that legitimately had no history).
    expect(payload.prompt).toContain('RECALL')
    expect(payload.prompt).toContain('subThreadId')
  })

  it('keeps Gemini plan-mode resumes and skips duplicated context', () => {
    const payload = compose(
      {
        provider: 'gemini',
        linkedGeminiSessionId: 'gemini-session-1',
        runs: [
          {
            runId: 'run-1',
            provider: 'gemini',
            startedAt: 't',
            requestedModel: 'flash-lite',
            approvalMode: 'plan'
          }
        ]
      },
      { approvalMode: 'plan', geminiWorktree: { enabled: false } }
    )
    expect(payload.providerSessionId).toBe('gemini-session-1')
    expect(payload.prompt).not.toContain('Conversation context')
    expect(payload.prompt).not.toContain('AGBench runtime note')
    expect(payload.approvalMode).toBe('plan')
  })

  it('skips unsafe Gemini write-mode resumes with the original restart hint', () => {
    const payload = compose(
      {
        provider: 'gemini',
        linkedGeminiSessionId: 'gemini-session-1'
      },
      { approvalMode: 'default' }
    )
    expect(payload.providerSessionId).toBeNull()
    expect(payload.composer.clearLinkedGeminiSession).toBe(true)
    expect(payload.composer.geminiResumeSkippedReason).toContain(
      'write-capable Gemini runs cannot safely resume CLI sessions'
    )
  })

  it('maps non-plan global Gemini runs back to default approval mode', () => {
    const payload = compose(
      { provider: 'gemini', scope: 'global', workspacePath: undefined },
      { scope: 'global', workspace: undefined, approvalMode: 'auto_edit' }
    )
    expect(payload.scope).toBe('global')
    expect(payload.workspace).toBeUndefined()
    expect(payload.approvalMode).toBe('default')
  })

  it('builds Kimi prompts with conversation context even when resuming a provider session', () => {
    const payload = compose(
      { provider: 'kimi', linkedProviderSessionId: 'kimi-thread-1' },
      { selectedModelType: 'kimi-k2.6', kimiThinkingEnabled: false }
    )
    expect(payload.provider).toBe('kimi')
    expect(payload.providerSessionId).toBe('kimi-thread-1')
    expect(payload.prompt).toContain('Conversation context')
    expect(payload.kimiThinking).toBe(false)
    expect(payload.composer.applicationLog).toContain(
      'Kimi: appending compact conversation context'
    )
  })

  it('defaults Kimi thinking to true from provider metadata defaults', () => {
    const payload = compose({ provider: 'kimi' }, { selectedModelType: 'kimi-k2.6' })
    expect(payload.kimiThinking).toBe(true)
  })

  it('teaches Kimi about cross-provider delegate_to_subthread (Phase I4)', () => {
    // The runtime note must point Kimi at agentbench__delegate_to_subthread
    // so it doesn't reach for a built-in generalist agent when asked to
    // delegate to Gemini / Codex / Claude.
    const payload = compose({ provider: 'kimi' }, {})
    expect(payload.prompt).toContain('agentbench MCP server')
    expect(payload.prompt).toContain('agentbench__delegate_to_subthread')
    expect(payload.prompt).toContain('CROSS-PROVIDER delegation')
    expect(payload.prompt).toContain("provider: 'claude'")
    expect(payload.prompt).toContain('NEVER use any built-in generalist-agent path')
    expect(payload.prompt).toContain('RECALL')
    expect(payload.prompt).toContain('subThreadId')
  })

  it('omits the Kimi delegation preamble in plan mode (read-only sessions)', () => {
    const payload = compose({ provider: 'kimi' }, { approvalMode: 'plan' })
    expect(payload.prompt).not.toContain('agentbench MCP server')
    expect(payload.prompt).not.toContain('agentbench__delegate_to_subthread')
    expect(payload.prompt).toContain('Do the thing')
  })

  it('omits the Kimi delegation preamble for global-scope runs (no workspace)', () => {
    const payload = compose({ provider: 'kimi', scope: 'global', workspacePath: undefined, workspaceId: undefined }, {})
    expect(payload.prompt).not.toContain('agentbench MCP server')
    expect(payload.prompt).not.toContain('agentbench__delegate_to_subthread')
    expect(payload.prompt).toContain('Do the thing')
  })

  it('strips internal plan markdown blocks and forces plan approval mode', () => {
    const payload = compose(
      { provider: 'kimi' },
      {
        selectedModelType: 'kimi-k2.6',
        userInput: 'Yes, proceed.\n\n```plan\n1. inspect\n2. edit\n```'
      }
    )
    expect(payload.approvalMode).toBe('plan')
    expect(payload.composer.planModeParsed).toBe(true)
    expect(payload.prompt).toContain('Yes, proceed.')
    expect(payload.prompt).not.toContain('```plan')
  })

  it('teaches Codex about cross-provider delegate_to_subthread (Phase I2 prompt-level fix)', () => {
    // Empirical bug: Codex CLI registered the agentbench MCP server
    // correctly (~/Library/Logs/AGBench/bridge-subprocess.log shows
    // 100+ codex-parented bridge spawns) but the Codex agent itself
    // never invoked a single tool — zero tools/call entries from any
    // codex-parented bridge. Gemini/Claude/Kimi each got a delegation
    // runtime-note preamble in Phase I3/I4 and immediately started
    // calling delegate_to_subthread; Codex was the only provider
    // missing the preamble.
    const payload = compose({ provider: 'codex' }, {})
    expect(payload.prompt).toContain('agentbench MCP server')
    expect(payload.prompt).toContain('agentbench__delegate_to_subthread')
    expect(payload.prompt).toContain('CROSS-PROVIDER delegation')
    expect(payload.prompt).toContain("provider: 'gemini'")
    expect(payload.prompt).toContain("NEVER use Codex's built-in invoke")
    // Recall guidance — observed bug: Codex spawning a fresh sub-thread
    // on every status check, getting "first turn, no prior actions"
    // back from sub-agents with legitimately no history.
    expect(payload.prompt).toContain('RECALL')
    expect(payload.prompt).toContain('subThreadId')
  })

  it('omits the Codex delegation preamble in plan mode (read-only sessions)', () => {
    const payload = compose({ provider: 'codex' }, { approvalMode: 'plan' })
    expect(payload.prompt).not.toContain('agentbench MCP server')
    expect(payload.prompt).not.toContain('agentbench__delegate_to_subthread')
    expect(payload.prompt).toContain('Do the thing')
  })

  it('omits the Codex delegation preamble for global-scope runs (no workspace)', () => {
    const payload = compose(
      { provider: 'codex', scope: 'global', workspacePath: undefined, workspaceId: undefined },
      {}
    )
    expect(payload.prompt).not.toContain('agentbench MCP server')
    expect(payload.prompt).not.toContain('agentbench__delegate_to_subthread')
    expect(payload.prompt).toContain('Do the thing')
  })

  it('builds Codex payloads with image paths and external grant prompt references without packing app-server input', () => {
    const payload = compose(
      { provider: 'codex' },
      {
        selectedModelType: 'gpt-5.5',
        attachments: [{ id: 'img-1', path: '/tmp/screen.png', name: 'screen.png' }],
        externalPathGrants: [makeGrant({ access: 'write', kind: 'directory', path: '/outside' })],
        codexReasoningEffort: 'xhigh',
        codexServiceTier: 'fast'
      }
    )
    expect(payload.prompt).toContain('Attachment references for this request')
    expect(payload.prompt).toContain('User-approved external path grants for this Codex request')
    expect(payload.imagePaths).toEqual(['/tmp/screen.png'])
    expect(payload.reasoningEffort).toBe('xhigh')
    expect(payload.serviceTier).toBe('fast')
  })

  it('applies Codex model-handoff context once and returns providerMetadata patch data', () => {
    const payload = compose(
      {
        provider: 'codex',
        runs: [
          {
            runId: 'run-1',
            provider: 'codex',
            startedAt: 't',
            requestedModel: 'gpt-5.4',
            status: 'success'
          }
        ]
      },
      { selectedModelType: 'gpt-5.5' }
    )
    expect(payload.prompt).toContain('Conversation context')
    expect(payload.composer.codexHandoffApplied?.handoffKey).toBe('gpt-5.4->gpt-5.5')
    expect(payload.composer.providerMetadataPatch).toMatchObject({
      codexModelContextAppliedKeys: ['gpt-5.4->gpt-5.5']
    })
  })

  it('does not repeat Codex model-handoff context after the handoff key was applied', () => {
    const payload = compose(
      {
        provider: 'codex',
        providerMetadata: { codexModelContextAppliedKeys: ['gpt-5.4->gpt-5.5'] },
        runs: [
          {
            runId: 'run-1',
            provider: 'codex',
            startedAt: 't',
            requestedModel: 'gpt-5.4',
            status: 'success'
          }
        ]
      },
      { selectedModelType: 'gpt-5.5' }
    )
    expect(payload.prompt).not.toContain('Conversation context')
    expect(payload.composer.providerMetadataPatch).toBeUndefined()
  })

  it('builds Claude payloads without generic context and includes Claude reasoning effort', () => {
    const payload = compose(
      { provider: 'claude', linkedProviderSessionId: 'claude-thread-1' },
      { selectedModelType: 'claude-sonnet-4-6', claudeReasoningEffort: 'medium' }
    )
    // Phase I3 (Claude initiator): workspace Claude runs outside plan
    // mode get a delegation preamble pointing at the agentbench MCP
    // server. The user request is preserved verbatim after it.
    //
    // Tier 1 (turn-1 only): when a Claude session is being resumed via
    // `linkedProviderSessionId`, the prior turn's preamble is already in
    // the retained context. We skip re-injection to save ~1.9k tokens
    // per turn. The user prompt is still preserved; the preamble text
    // must NOT be present on resume turns.
    expect(payload.prompt).toContain('Do the thing')
    expect(payload.prompt).not.toContain('mcp__agentbench__delegate_to_subthread')
    expect(payload.prompt).not.toContain('agentbench MCP server')
    expect(payload.providerSessionId).toBe('claude-thread-1')
    expect(payload.claudeReasoningEffort).toBe('medium')
  })

  it('teaches Claude about cross-provider delegate_to_subthread (Phase I3)', () => {
    // The runtime note must point Claude at mcp__agentbench__delegate_to_subthread
    // so it doesn't reach for its built-in Task tool when asked to
    // delegate to Gemini / Codex / Kimi.
    const payload = compose({ provider: 'claude' }, {})
    expect(payload.prompt).toContain('agentbench MCP server')
    expect(payload.prompt).toContain('mcp__agentbench__delegate_to_subthread')
    expect(payload.prompt).toContain('CROSS-PROVIDER delegation')
    expect(payload.prompt).toContain("provider: 'gemini'")
    expect(payload.prompt).toContain("NEVER use Claude's built-in Task tool")
    expect(payload.prompt).toContain('RECALL')
    expect(payload.prompt).toContain('subThreadId')
  })

  it('omits the Claude delegation preamble in plan mode (read-only sessions)', () => {
    const payload = compose({ provider: 'claude' }, { approvalMode: 'plan' })
    expect(payload.prompt).not.toContain('agentbench MCP server')
    expect(payload.prompt).not.toContain('mcp__agentbench__delegate_to_subthread')
    expect(payload.prompt).toContain('Do the thing')
  })

  it('omits the Claude delegation preamble for global-scope runs (no workspace)', () => {
    const payload = compose({ provider: 'claude', scope: 'global', workspacePath: undefined, workspaceId: undefined }, {})
    expect(payload.prompt).not.toContain('agentbench MCP server')
    expect(payload.prompt).not.toContain('mcp__agentbench__delegate_to_subthread')
    expect(payload.prompt).toContain('Do the thing')
  })

  it('uses Claude provider metadata defaults when model input is omitted', () => {
    const payload = compose(
      {
        provider: 'claude',
        providerMetadata: { selectedModelType: 'claude-opus-4-7', approvalMode: 'plan' }
      },
      { selectedModelType: undefined, approvalMode: undefined }
    )
    expect(payload.model).toBe('claude-opus-4-7')
    expect(payload.approvalMode).toBe('plan')
  })

  it('honors context-turn setting 0 by disabling Gemini history injection', () => {
    const payload = compose({ provider: 'gemini' }, {}, { chatContextTurns: 0 })
    expect(payload.prompt).not.toContain('Conversation context')
    expect(payload.composer.contextTurnsApplied).toBe(0)
  })

  it('uses only the last configured number of turns for context', () => {
    const messages = Array.from({ length: 6 }, (_, index) => [
      { id: `u${index}`, role: 'user' as const, content: `user-${index}`, timestamp: 't' },
      { id: `a${index}`, role: 'assistant' as const, content: `assistant-${index}`, timestamp: 't' }
    ]).flat()
    const payload = compose({ provider: 'gemini', messages }, {}, { chatContextTurns: 2 })
    expect(payload.prompt).not.toContain('user-0')
    expect(payload.prompt).toContain('user-4')
    expect(payload.prompt).toContain('assistant-5')
    expect(payload.composer.contextTurnsApplied).toBe(2)
  })

  it('caps context turns at twenty from settings', () => {
    const messages = Array.from({ length: 25 }, (_, index) => [
      { id: `u${index}`, role: 'user' as const, content: `user-${index}`, timestamp: 't' },
      { id: `a${index}`, role: 'assistant' as const, content: `assistant-${index}`, timestamp: 't' }
    ]).flat()
    const payload = compose({ provider: 'gemini', messages }, {}, { chatContextTurns: 99 })
    expect(payload.prompt).toContain('Conversation context (last 20 turn(s)):')
    expect(payload.prompt).not.toContain('user-0')
    expect(payload.prompt).toContain('user-24')
  })

  it('rejects empty prompts clearly', () => {
    const chat = makeChat()
    const { deps } = makeDeps(chat)
    const service = new ComposerService(deps)
    expect(() =>
      service.composeRun({
        chatId: chat.appChatId,
        provider: 'gemini',
        workspace: '/repo',
        userInput: '   '
      })
    ).toThrow('Prompt is required.')
  })

  it('normalizes image attachment shape by filtering blank paths', () => {
    const payload = compose(
      { provider: 'claude' },
      {
        selectedModelType: 'claude-sonnet-4-6',
        imageAttachments: [
          { id: 'blank', path: '   ', name: 'blank' },
          { id: 'img', path: ' /tmp/mock.jpg ', name: 'mock.jpg' }
        ]
      }
    )
    expect(payload.imagePaths).toEqual(['/tmp/mock.jpg'])
  })

  it('preserves runtime profile and handoff identifiers on the payload', () => {
    const payload = compose(
      { provider: 'codex' },
      {
        selectedModelType: 'gpt-5.5',
        runtimeProfileId: 'profile-1',
        handoffSourceRunId: 'source-run-1'
      }
    )
    expect(payload.runtimeProfileId).toBe('profile-1')
    expect(payload.handoffSourceRunId).toBe('source-run-1')
  })
})
