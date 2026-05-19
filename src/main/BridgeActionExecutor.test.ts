import { describe, expect, it, vi } from 'vitest'
import { MainProcessActionExecutor, NoopActionExecutor } from './BridgeActionExecutor'
import type {
  BridgeApprovalReplyAction,
  BridgeCancelRunAction,
  BridgeComposerPromptAction,
  BridgeQuestionRejectAction,
  BridgeQuestionReplyAction,
  BridgeRegisterApnsTokenAction,
  BridgeSetYoloModeAction,
  BridgeTogglePinChatAction,
  BridgeTogglePinWorkspaceAction
} from './BridgeActionPayload'

const sample = {
  approvalReply: {
    kind: 'approvalReply',
    workspaceId: 'ws-1',
    threadId: 't-1',
    toolCallId: 'tc-99',
    decision: 'accept'
  } satisfies BridgeApprovalReplyAction,
  questionReply: {
    kind: 'questionReply',
    workspaceId: 'ws-1',
    threadId: 't-1',
    promptId: 'q-1',
    answer: 'yes'
  } satisfies BridgeQuestionReplyAction,
  questionReject: {
    kind: 'questionReject',
    workspaceId: 'ws-1',
    threadId: 't-1',
    promptId: 'q-1'
  } satisfies BridgeQuestionRejectAction,
  composerPrompt: {
    kind: 'composerPrompt',
    workspaceId: 'ws-1',
    threadId: 't-1',
    provider: 'gemini',
    text: 'hello'
  } satisfies BridgeComposerPromptAction,
  cancelRun: {
    kind: 'cancelRun',
    workspaceId: 'ws-1',
    threadId: 't-1',
    provider: 'gemini',
    runId: 'run-42'
  } satisfies BridgeCancelRunAction,
  registerApnsToken: {
    kind: 'registerApnsToken',
    pairID: 'pair-1',
    deviceToken: 'abc123def456',
    env: 'production'
  } satisfies BridgeRegisterApnsTokenAction,
  setYoloMode: {
    kind: 'setYoloMode',
    enabled: true
  } satisfies BridgeSetYoloModeAction,
  togglePinChat: {
    kind: 'togglePinChat',
    workspaceId: 'ws-1',
    appChatId: 'chat-1',
    pinned: true
  } satisfies BridgeTogglePinChatAction,
  togglePinWorkspace: {
    kind: 'togglePinWorkspace',
    workspaceId: 'ws-1',
    pinned: true
  } satisfies BridgeTogglePinWorkspaceAction
}

describe('NoopActionExecutor', () => {
  it('returns executed=false with id in message for every variant', async () => {
    const executor = new NoopActionExecutor()
    const results = await Promise.all([
      executor.executeApprovalReply(sample.approvalReply),
      executor.executeQuestionReply(sample.questionReply),
      executor.executeQuestionReject(sample.questionReject),
      executor.executeComposerPrompt(sample.composerPrompt),
      executor.executeCancelRun(sample.cancelRun),
      executor.executeRegisterApnsToken(sample.registerApnsToken),
      executor.executeSetYoloMode(sample.setYoloMode),
      executor.executeTogglePinChat(sample.togglePinChat),
      executor.executeTogglePinWorkspace(sample.togglePinWorkspace)
    ])
    for (const r of results) {
      expect(r.executed).toBe(false)
      expect(r.message).toMatch(/not yet wired/i)
    }
    // Each message should include the unique id for the variant
    expect(results[0].message).toContain('tc-99')
    expect(results[1].message).toContain('q-1')
    expect(results[2].message).toContain('q-1')
    expect(results[3].message).toContain('t-1')
    expect(results[4].message).toContain('run-42')
    expect(results[5].message).toContain('pair-1')
    expect(results[6].message).toContain('true')
    expect(results[7].message).toContain('chat-1')
    expect(results[8].message).toContain('ws-1')
  })
})

describe('MainProcessActionExecutor.executeCancelRun', () => {
  it('dispatches to cancelRunFn with provider + runId', async () => {
    const cancelRunFn = vi.fn().mockResolvedValue({ canceled: true })
    const executor = new MainProcessActionExecutor({ cancelRunFn })
    const result = await executor.executeCancelRun(sample.cancelRun)
    expect(cancelRunFn).toHaveBeenCalledTimes(1)
    expect(cancelRunFn).toHaveBeenCalledWith('gemini', 'run-42')
    expect(result.executed).toBe(true)
    expect(result.message).toMatch(/run-42/)
    expect(result.message).toMatch(/gemini/)
    expect(result.data).toMatchObject({
      cancelResult: { canceled: true },
      runId: 'run-42',
      provider: 'gemini'
    })
  })

  it('handles non-serializable cancelRunFn results gracefully', async () => {
    const cancelRunFn = vi.fn().mockResolvedValue(() => 'I am a function')
    const executor = new MainProcessActionExecutor({ cancelRunFn })
    const result = await executor.executeCancelRun(sample.cancelRun)
    expect(result.executed).toBe(true)
    expect(result.data?.cancelResult).toBeNull()
  })

  it('returns executed=false when cancelRunFn throws', async () => {
    const cancelRunFn = vi.fn().mockRejectedValue(new Error('provider gone'))
    const log = vi.fn()
    const executor = new MainProcessActionExecutor({ cancelRunFn, log })
    const result = await executor.executeCancelRun(sample.cancelRun)
    expect(result.executed).toBe(false)
    expect(result.message).toMatch(/cancel dispatch failed/i)
    expect(result.message).toMatch(/provider gone/)
    expect(log).toHaveBeenCalled()
  })

  it('passes through provider variants — codex / claude / kimi', async () => {
    const cancelRunFn = vi.fn().mockResolvedValue(true)
    const executor = new MainProcessActionExecutor({ cancelRunFn })
    for (const provider of ['codex', 'claude', 'kimi'] as const) {
      await executor.executeCancelRun({ ...sample.cancelRun, provider })
    }
    expect(cancelRunFn.mock.calls.map((c) => c[0])).toEqual(['codex', 'claude', 'kimi'])
  })
})

describe('MainProcessActionExecutor session and pin controls', () => {
  const cancelRunFn = vi.fn().mockResolvedValue(true)

  it('updates YOLO mode through setYoloModeFn', async () => {
    const setYoloModeFn = vi.fn().mockResolvedValue({ enabled: true })
    const executor = new MainProcessActionExecutor({ cancelRunFn, setYoloModeFn })
    const result = await executor.executeSetYoloMode(sample.setYoloMode)
    expect(setYoloModeFn).toHaveBeenCalledWith(true)
    expect(result).toMatchObject({
      executed: true,
      data: { enabled: true }
    })
  })

  it('reports setYoloModeFn failures without throwing', async () => {
    const setYoloModeFn = vi.fn().mockRejectedValue(new Error('session store unavailable'))
    const executor = new MainProcessActionExecutor({ cancelRunFn, setYoloModeFn })
    const result = await executor.executeSetYoloMode(sample.setYoloMode)
    expect(result.executed).toBe(false)
    expect(result.message).toMatch(/session store unavailable/)
  })

  it('updates a chat pin through togglePinChatFn', async () => {
    const togglePinChatFn = vi.fn().mockResolvedValue({ pinned: true })
    const executor = new MainProcessActionExecutor({ cancelRunFn, togglePinChatFn })
    const result = await executor.executeTogglePinChat(sample.togglePinChat)
    expect(togglePinChatFn).toHaveBeenCalledWith(sample.togglePinChat)
    expect(result).toMatchObject({
      executed: true,
      data: { appChatId: 'chat-1', pinned: true }
    })
  })

  it('surfaces togglePinChatFn decline reasons', async () => {
    const togglePinChatFn = vi.fn().mockResolvedValue({ pinned: false, reason: 'chat missing' })
    const executor = new MainProcessActionExecutor({ cancelRunFn, togglePinChatFn })
    const result = await executor.executeTogglePinChat(sample.togglePinChat)
    expect(result.executed).toBe(false)
    expect(result.message).toBe('chat missing')
  })

  it('updates a workspace pin through togglePinWorkspaceFn', async () => {
    const togglePinWorkspaceFn = vi.fn().mockResolvedValue({ pinned: true })
    const executor = new MainProcessActionExecutor({ cancelRunFn, togglePinWorkspaceFn })
    const result = await executor.executeTogglePinWorkspace(sample.togglePinWorkspace)
    expect(togglePinWorkspaceFn).toHaveBeenCalledWith(sample.togglePinWorkspace)
    expect(result).toMatchObject({
      executed: true,
      data: { workspaceId: 'ws-1', pinned: true }
    })
  })

  it('surfaces togglePinWorkspaceFn decline reasons', async () => {
    const togglePinWorkspaceFn = vi.fn().mockResolvedValue({
      pinned: false,
      reason: 'workspace missing'
    })
    const executor = new MainProcessActionExecutor({ cancelRunFn, togglePinWorkspaceFn })
    const result = await executor.executeTogglePinWorkspace(sample.togglePinWorkspace)
    expect(result.executed).toBe(false)
    expect(result.message).toBe('workspace missing')
  })
})

describe('MainProcessActionExecutor.executeApprovalReply', () => {
  const cancelRunFn = vi.fn().mockResolvedValue(true)

  it('returns executed=false when no respondApprovalFn is configured', async () => {
    const executor = new MainProcessActionExecutor({ cancelRunFn })
    const result = await executor.executeApprovalReply(sample.approvalReply)
    expect(result.executed).toBe(false)
    expect(result.message).toMatch(/not yet wired/i)
  })

  it('dispatches the toolCallId + decision to respondApprovalFn', async () => {
    const respondApprovalFn = vi.fn().mockResolvedValue(true)
    const executor = new MainProcessActionExecutor({ cancelRunFn, respondApprovalFn })
    const result = await executor.executeApprovalReply(sample.approvalReply)
    expect(respondApprovalFn).toHaveBeenCalledTimes(1)
    expect(respondApprovalFn).toHaveBeenCalledWith('tc-99', 'accept')
    expect(result.executed).toBe(true)
    expect(result.message).toMatch(/tc-99/)
    expect(result.message).toMatch(/accept/)
    expect(result.data).toMatchObject({ toolCallId: 'tc-99', decision: 'accept' })
  })

  it('passes through all five decisions', async () => {
    const respondApprovalFn = vi.fn().mockResolvedValue(true)
    const executor = new MainProcessActionExecutor({ cancelRunFn, respondApprovalFn })
    for (const decision of [
      'accept',
      'acceptForSession',
      'acceptForWorkspace',
      'decline',
      'cancel'
    ] as const) {
      await executor.executeApprovalReply({ ...sample.approvalReply, decision })
    }
    expect(respondApprovalFn.mock.calls.map((c) => c[1])).toEqual([
      'accept',
      'acceptForSession',
      'acceptForWorkspace',
      'decline',
      'cancel'
    ])
  })

  it('reports executed=false when respondApprovalFn returns false', async () => {
    const respondApprovalFn = vi.fn().mockResolvedValue(false)
    const executor = new MainProcessActionExecutor({ cancelRunFn, respondApprovalFn })
    const result = await executor.executeApprovalReply(sample.approvalReply)
    expect(result.executed).toBe(false)
    expect(result.message).toMatch(/no pending approval/i)
    expect(result.message).toMatch(/tc-99/)
  })

  it('reports executed=false when respondApprovalFn throws', async () => {
    const respondApprovalFn = vi.fn().mockRejectedValue(new Error('runtime gone'))
    const log = vi.fn()
    const executor = new MainProcessActionExecutor({ cancelRunFn, respondApprovalFn, log })
    const result = await executor.executeApprovalReply(sample.approvalReply)
    expect(result.executed).toBe(false)
    expect(result.message).toMatch(/approval dispatch failed/i)
    expect(result.message).toMatch(/runtime gone/)
    expect(log).toHaveBeenCalled()
  })
})

describe('MainProcessActionExecutor.executeComposerPrompt', () => {
  const cancelRunFn = vi.fn().mockResolvedValue(true)

  it('returns executed=false when no composerPromptFn is configured', async () => {
    const executor = new MainProcessActionExecutor({ cancelRunFn })
    const result = await executor.executeComposerPrompt(sample.composerPrompt)
    expect(result.executed).toBe(false)
    expect(result.message).toMatch(/not yet wired/i)
  })

  it('dispatches the full action payload to composerPromptFn', async () => {
    const composerPromptFn = vi.fn().mockResolvedValue({ dispatched: true, appRunId: 'run-xyz' })
    const executor = new MainProcessActionExecutor({ cancelRunFn, composerPromptFn })
    const result = await executor.executeComposerPrompt(sample.composerPrompt)
    expect(composerPromptFn).toHaveBeenCalledTimes(1)
    expect(composerPromptFn).toHaveBeenCalledWith(sample.composerPrompt)
    expect(result.executed).toBe(true)
    expect(result.message).toMatch(/run dispatched/i)
    expect(result.message).toMatch(/run-xyz/)
    expect(result.data).toMatchObject({
      appRunId: 'run-xyz',
      workspaceId: 'ws-1',
      threadId: 't-1',
      provider: 'gemini'
    })
  })

  it('reports executed=false when composerPromptFn signals no dispatch', async () => {
    const composerPromptFn = vi.fn().mockResolvedValue({
      dispatched: false,
      appRunId: null,
      reason: 'Workspace id "ws-1" is not registered'
    })
    const executor = new MainProcessActionExecutor({ cancelRunFn, composerPromptFn })
    const result = await executor.executeComposerPrompt(sample.composerPrompt)
    expect(result.executed).toBe(false)
    expect(result.message).toMatch(/could not be dispatched/i)
    expect(result.message).toMatch(/not registered/)
  })

  it('reports executed=false when composerPromptFn throws', async () => {
    const composerPromptFn = vi.fn().mockRejectedValue(new Error('preflight blew up'))
    const log = vi.fn()
    const executor = new MainProcessActionExecutor({ cancelRunFn, composerPromptFn, log })
    const result = await executor.executeComposerPrompt(sample.composerPrompt)
    expect(result.executed).toBe(false)
    expect(result.message).toMatch(/composer prompt dispatch failed/i)
    expect(result.message).toMatch(/preflight blew up/)
    expect(log).toHaveBeenCalled()
  })

  it('reports executed=false when composerPromptFn returns dispatched=true but no appRunId', async () => {
    // Defensive: shouldn't happen in practice but the contract requires
    // an appRunId for a successful dispatch.
    const composerPromptFn = vi.fn().mockResolvedValue({ dispatched: true, appRunId: null })
    const executor = new MainProcessActionExecutor({ cancelRunFn, composerPromptFn })
    const result = await executor.executeComposerPrompt(sample.composerPrompt)
    expect(result.executed).toBe(false)
  })
})

describe('MainProcessActionExecutor.executeRegisterApnsToken', () => {
  const cancelRunFn = vi.fn().mockResolvedValue(true)

  it('returns executed=false when no registerApnsTokenFn is configured', async () => {
    const executor = new MainProcessActionExecutor({ cancelRunFn })
    const result = await executor.executeRegisterApnsToken(sample.registerApnsToken)
    expect(result.executed).toBe(false)
    expect(result.message).toMatch(/not yet wired/i)
  })

  it('dispatches the action to registerApnsTokenFn', async () => {
    const registerApnsTokenFn = vi.fn().mockResolvedValue({ registered: true })
    const executor = new MainProcessActionExecutor({ cancelRunFn, registerApnsTokenFn })
    const result = await executor.executeRegisterApnsToken(sample.registerApnsToken)
    expect(registerApnsTokenFn).toHaveBeenCalledTimes(1)
    expect(registerApnsTokenFn).toHaveBeenCalledWith(sample.registerApnsToken)
    expect(result.executed).toBe(true)
    expect(result.message).toMatch(/pair-1/)
    expect(result.message).toMatch(/production/)
    expect(result.data).toMatchObject({ pairID: 'pair-1', env: 'production' })
  })

  it('reports executed=false when registerApnsTokenFn declines', async () => {
    const registerApnsTokenFn = vi.fn().mockResolvedValue({
      registered: false,
      reason: 'invalid token shape'
    })
    const executor = new MainProcessActionExecutor({ cancelRunFn, registerApnsTokenFn })
    const result = await executor.executeRegisterApnsToken(sample.registerApnsToken)
    expect(result.executed).toBe(false)
    expect(result.message).toMatch(/registration declined/i)
    expect(result.message).toMatch(/invalid token shape/)
  })

  it('reports executed=false when registerApnsTokenFn throws', async () => {
    const registerApnsTokenFn = vi.fn().mockRejectedValue(new Error('store offline'))
    const log = vi.fn()
    const executor = new MainProcessActionExecutor({ cancelRunFn, registerApnsTokenFn, log })
    const result = await executor.executeRegisterApnsToken(sample.registerApnsToken)
    expect(result.executed).toBe(false)
    expect(result.message).toMatch(/registration failed/i)
    expect(result.message).toMatch(/store offline/)
    expect(log).toHaveBeenCalled()
  })

  it('respects sandbox vs production env', async () => {
    const registerApnsTokenFn = vi.fn().mockResolvedValue({ registered: true })
    const executor = new MainProcessActionExecutor({ cancelRunFn, registerApnsTokenFn })
    await executor.executeRegisterApnsToken({ ...sample.registerApnsToken, env: 'sandbox' })
    expect(registerApnsTokenFn.mock.calls[0][0].env).toBe('sandbox')
  })
})

describe('MainProcessActionExecutor.executeQuestionReply', () => {
  const cancelRunFn = vi.fn().mockResolvedValue(true)

  it('returns executed=false when no respondApprovalFn is configured', async () => {
    const executor = new MainProcessActionExecutor({ cancelRunFn })
    const result = await executor.executeQuestionReply(sample.questionReply)
    expect(result.executed).toBe(false)
    expect(result.message).toMatch(/not yet wired/i)
  })

  it('dispatches the answer as userInput to respondApprovalFn', async () => {
    const respondApprovalFn = vi.fn().mockResolvedValue(true)
    const executor = new MainProcessActionExecutor({ cancelRunFn, respondApprovalFn })
    const result = await executor.executeQuestionReply(sample.questionReply)
    expect(respondApprovalFn).toHaveBeenCalledTimes(1)
    expect(respondApprovalFn).toHaveBeenCalledWith('q-1', 'accept', { userInput: 'yes' })
    expect(result.executed).toBe(true)
    expect(result.message).toMatch(/q-1/)
    expect(result.message).toMatch(/answered/i)
    expect(result.data).toMatchObject({ promptId: 'q-1', answerLength: 3 })
  })

  it('reports executed=false when respondApprovalFn returns false', async () => {
    const respondApprovalFn = vi.fn().mockResolvedValue(false)
    const executor = new MainProcessActionExecutor({ cancelRunFn, respondApprovalFn })
    const result = await executor.executeQuestionReply(sample.questionReply)
    expect(result.executed).toBe(false)
    expect(result.message).toMatch(/no pending question/i)
  })

  it('reports executed=false when respondApprovalFn throws', async () => {
    const respondApprovalFn = vi.fn().mockRejectedValue(new Error('codex disconnected'))
    const log = vi.fn()
    const executor = new MainProcessActionExecutor({ cancelRunFn, respondApprovalFn, log })
    const result = await executor.executeQuestionReply(sample.questionReply)
    expect(result.executed).toBe(false)
    expect(result.message).toMatch(/question reply dispatch failed/i)
    expect(result.message).toMatch(/codex disconnected/)
    expect(log).toHaveBeenCalled()
  })

  it('passes through multi-line answers as-is (no truncation or escaping)', async () => {
    const respondApprovalFn = vi.fn().mockResolvedValue(true)
    const executor = new MainProcessActionExecutor({ cancelRunFn, respondApprovalFn })
    const multiline = 'first line\nsecond line\nthird "quoted" line'
    await executor.executeQuestionReply({ ...sample.questionReply, answer: multiline })
    expect(respondApprovalFn).toHaveBeenCalledWith('q-1', 'accept', { userInput: multiline })
  })
})

describe('MainProcessActionExecutor.executeQuestionReject', () => {
  const cancelRunFn = vi.fn().mockResolvedValue(true)

  it('returns executed=false when no respondApprovalFn is configured', async () => {
    const executor = new MainProcessActionExecutor({ cancelRunFn })
    const result = await executor.executeQuestionReject(sample.questionReject)
    expect(result.executed).toBe(false)
    expect(result.message).toMatch(/not yet wired/i)
  })

  it('dispatches as decline (no userInput) to respondApprovalFn', async () => {
    const respondApprovalFn = vi.fn().mockResolvedValue(true)
    const executor = new MainProcessActionExecutor({ cancelRunFn, respondApprovalFn })
    const result = await executor.executeQuestionReject(sample.questionReject)
    expect(respondApprovalFn).toHaveBeenCalledTimes(1)
    expect(respondApprovalFn).toHaveBeenCalledWith('q-1', 'decline')
    expect(result.executed).toBe(true)
    expect(result.message).toMatch(/rejected/i)
    expect(result.data).toMatchObject({ promptId: 'q-1' })
  })

  it('reports executed=false when respondApprovalFn returns false', async () => {
    const respondApprovalFn = vi.fn().mockResolvedValue(false)
    const executor = new MainProcessActionExecutor({ cancelRunFn, respondApprovalFn })
    const result = await executor.executeQuestionReject(sample.questionReject)
    expect(result.executed).toBe(false)
    expect(result.message).toMatch(/no pending question/i)
  })

  it('reports executed=false when respondApprovalFn throws', async () => {
    const respondApprovalFn = vi.fn().mockRejectedValue(new Error('boom'))
    const log = vi.fn()
    const executor = new MainProcessActionExecutor({ cancelRunFn, respondApprovalFn, log })
    const result = await executor.executeQuestionReject(sample.questionReject)
    expect(result.executed).toBe(false)
    expect(result.message).toMatch(/question reject dispatch failed/i)
    expect(log).toHaveBeenCalled()
  })
})
