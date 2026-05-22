import { describe, expect, it, vi } from 'vitest'
import { BridgeActionRouter } from './BridgeActionRouter'
import { RemoteWorkspaceAllowlist } from './RemoteWorkspaceAllowlist'
import type { BridgeActionExecutionResult, BridgeActionExecutor } from './BridgeActionExecutor'

/** Stub executor for router tests — captures method invocations + returns
 * configurable results. */
function makeStubExecutor(
  overrides: Partial<
    Record<keyof BridgeActionExecutor, () => Promise<BridgeActionExecutionResult>>
  > = {}
): { executor: BridgeActionExecutor; calls: Array<{ method: string; payload: unknown }> } {
  const calls: Array<{ method: string; payload: unknown }> = []
  const make = (method: keyof BridgeActionExecutor, defaultResult: BridgeActionExecutionResult) =>
    vi.fn(async (payload: unknown) => {
      calls.push({ method, payload })
      return (await overrides[method]?.()) ?? defaultResult
    })
  const executor: BridgeActionExecutor = {
    executeApprovalReply: make('executeApprovalReply', {
      executed: true,
      message: 'approvalReply done'
    }),
    executeQuestionReply: make('executeQuestionReply', {
      executed: true,
      message: 'questionReply done'
    }),
    executeQuestionReject: make('executeQuestionReject', {
      executed: true,
      message: 'questionReject done'
    }),
    executeComposerPrompt: make('executeComposerPrompt', {
      executed: true,
      message: 'composerPrompt done'
    }),
    executeCancelRun: make('executeCancelRun', { executed: true, message: 'cancelRun done' }),
    executeRegisterApnsToken: make('executeRegisterApnsToken', {
      executed: true,
      message: 'registerApnsToken done'
    }),
    executeSetYoloMode: make('executeSetYoloMode', { executed: true, message: 'setYoloMode done' }),
    executeTogglePinChat: make('executeTogglePinChat', {
      executed: true,
      message: 'togglePinChat done'
    }),
    executeTogglePinWorkspace: make('executeTogglePinWorkspace', {
      executed: true,
      message: 'togglePinWorkspace done'
    })
  }
  return { executor, calls }
}

describe('BridgeActionRouter', () => {
  describe('default deny-by-default policy', () => {
    it('denies bridge.requestActionAck with stable shape (unknown payload)', async () => {
      // Payload `{"hi": "world"}` decodes to BridgeUnknownAction (no `kind`),
      // which the router denies with a "unrecognized kind" message.
      const router = new BridgeActionRouter()
      const result = (await router.route('bridge.requestActionAck', {
        pairID: 'pair-1',
        payloadBytes: 42,
        payloadBase64: 'eyJoaSI6ICJ3b3JsZCJ9'
      })) as { accepted: boolean; scope?: string; message?: string }
      expect(result.accepted).toBe(false)
      expect(result.scope).toBe('once')
      expect(result.message).toMatch(/unrecognized action kind/i)
    })

    it('denies bridge.requestActionAck for a known payload with no allowlist', async () => {
      // With a real payload but no allowlist configured, the deny message
      // explicitly cites the missing allowlist.
      const router = new BridgeActionRouter()
      const wire = Buffer.from(
        JSON.stringify({
          kind: 'composerPrompt',
          workspaceId: 'ws-1',
          threadId: 't-1',
          provider: 'gemini',
          text: 'hi'
        }),
        'utf-8'
      ).toString('base64')
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: wire
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(false)
      expect(result.message).toMatch(/no workspace allowlist/i)
    })

    it('denies bridge.requestPrepareStartTurnAck with stable shape', async () => {
      const router = new BridgeActionRouter()
      const result = (await router.route('bridge.requestPrepareStartTurnAck', {
        pairID: 'pair-1',
        prepareID: 'p1',
        workspaceID: 'ws-1',
        threadID: 't-1'
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(false)
      expect(result.message).toMatch(/not yet enabled|allowlist/i)
    })

    it('handles missing params dictionary without throwing', async () => {
      const router = new BridgeActionRouter()
      const r1 = await router.route('bridge.requestActionAck', null)
      const r2 = await router.route('bridge.requestActionAck', 'not-an-object')
      const r3 = await router.route('bridge.requestPrepareStartTurnAck', undefined)
      expect((r1 as { accepted: boolean }).accepted).toBe(false)
      expect((r2 as { accepted: boolean }).accepted).toBe(false)
      expect((r3 as { accepted: boolean }).accepted).toBe(false)
    })
  })

  describe('permissive-dev override', () => {
    it('accepts actionAck under permissive flag', async () => {
      const router = new BridgeActionRouter({ permissiveDev: true })
      const result = (await router.route('bridge.requestActionAck', {
        pairID: 'pair-1',
        payloadBytes: 0
      })) as { accepted: boolean; scope?: string; message?: string }
      expect(result.accepted).toBe(true)
      expect(result.scope).toBe('once')
      expect(result.message).toMatch(/permissive-dev/i)
    })

    it('accepts prepareStartTurn under permissive flag', async () => {
      const router = new BridgeActionRouter({ permissiveDev: true })
      const result = (await router.route('bridge.requestPrepareStartTurnAck', {
        workspaceID: 'ws-1'
      })) as { accepted: boolean }
      expect(result.accepted).toBe(true)
    })

    it('emits a single warning log when constructed in permissive mode', () => {
      const log = vi.fn()

      new BridgeActionRouter({ permissiveDev: true, log })
      expect(log).toHaveBeenCalledTimes(1)
      expect(log.mock.calls[0][0]).toMatch(/permissive-dev mode is ON/i)
    })

    it('does not warn when permissive mode is off', () => {
      const log = vi.fn()

      new BridgeActionRouter({ permissiveDev: false, log })
      expect(log).not.toHaveBeenCalled()
    })
  })

  describe('allowlist integration (Phase C4)', () => {
    const seedAllowlist = (clock = 1000) => {
      const allowlist = new RemoteWorkspaceAllowlist({ now: () => clock })
      allowlist.upsert({
        workspaceId: 'ws-allowed',
        path: '/Users/test/projects/a',
        mode: 'read-write',
        allowedProviders: ['gemini', 'codex'],
        allowedApprovalModes: ['default', 'plan']
      })
      return allowlist
    }

    it('accepts prepareStartTurn when workspace is allowlisted', async () => {
      const allowlist = seedAllowlist()
      const router = new BridgeActionRouter({ allowlist })
      const result = (await router.route('bridge.requestPrepareStartTurnAck', {
        pairID: 'pair-1',
        workspaceID: 'ws-allowed'
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(true)
      expect(result.message).toMatch(/read-write/i)
    })

    it('denies prepareStartTurn when workspace is not on allowlist', async () => {
      const allowlist = seedAllowlist()
      const router = new BridgeActionRouter({ allowlist })
      const result = (await router.route('bridge.requestPrepareStartTurnAck', {
        pairID: 'pair-1',
        workspaceID: 'ws-not-listed'
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(false)
      expect(result.message).toMatch(/not on the remote allowlist/i)
    })

    it('denies prepareStartTurn when provider is not allowed for the workspace', async () => {
      const allowlist = seedAllowlist()
      const router = new BridgeActionRouter({ allowlist })
      const result = (await router.route('bridge.requestPrepareStartTurnAck', {
        pairID: 'pair-1',
        workspaceID: 'ws-allowed',
        provider: 'claude'
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(false)
      expect(result.message).toMatch(/provider "claude"/i)
    })

    it('denies prepareStartTurn when approval mode is not allowed', async () => {
      const allowlist = seedAllowlist()
      const router = new BridgeActionRouter({ allowlist })
      const result = (await router.route('bridge.requestPrepareStartTurnAck', {
        pairID: 'pair-1',
        workspaceID: 'ws-allowed',
        approvalMode: 'allow-all'
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(false)
      expect(result.message).toMatch(/approval mode "allow-all"/i)
    })

    it('denies prepareStartTurn when allowlist entry has expired', async () => {
      let clock = 1000
      const allowlist = new RemoteWorkspaceAllowlist({ now: () => clock })
      allowlist.upsert({
        workspaceId: 'ws-expiring',
        path: '/Users/test/a',
        mode: 'read-write',
        allowedProviders: ['gemini'],
        allowedApprovalModes: ['default'],
        expiresAt: 5000
      })
      const router = new BridgeActionRouter({ allowlist })
      // Within window: accepted.
      clock = 4000
      let result = (await router.route('bridge.requestPrepareStartTurnAck', {
        workspaceID: 'ws-expiring'
      })) as { accepted: boolean }
      expect(result.accepted).toBe(true)
      // After expiry: denied.
      clock = 6000
      result = (await router.route('bridge.requestPrepareStartTurnAck', {
        workspaceID: 'ws-expiring'
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(false)
      if ('message' in result) {
        expect(result.message).toMatch(/expired/i)
      }
    })

    it('permissive-dev overrides the allowlist (accepts even when workspace is absent)', async () => {
      const allowlist = seedAllowlist()
      const router = new BridgeActionRouter({ allowlist, permissiveDev: true })
      const result = (await router.route('bridge.requestPrepareStartTurnAck', {
        workspaceID: 'ws-not-listed-anywhere'
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(true)
      expect(result.message).toMatch(/permissive-dev/i)
    })

    it('reacts to allowlist mutation between calls (per-action revalidation)', async () => {
      const allowlist = new RemoteWorkspaceAllowlist()
      const router = new BridgeActionRouter({ allowlist })

      // Initial deny — not on list.
      let result = (await router.route('bridge.requestPrepareStartTurnAck', {
        workspaceID: 'ws-late-add'
      })) as { accepted: boolean }
      expect(result.accepted).toBe(false)

      // Add it.
      allowlist.upsert({
        workspaceId: 'ws-late-add',
        path: '/Users/test/a',
        mode: 'read-only',
        allowedProviders: ['gemini'],
        allowedApprovalModes: ['default']
      })

      // Next call sees the new entry — no router restart needed.
      result = (await router.route('bridge.requestPrepareStartTurnAck', {
        workspaceID: 'ws-late-add'
      })) as { accepted: boolean }
      expect(result.accepted).toBe(true)

      // Remove it.
      allowlist.remove('ws-late-add')

      // Back to deny.
      result = (await router.route('bridge.requestPrepareStartTurnAck', {
        workspaceID: 'ws-late-add'
      })) as { accepted: boolean }
      expect(result.accepted).toBe(false)
    })

    it('actionAck with no allowlist denies even a well-formed payload', async () => {
      const router = new BridgeActionRouter()
      const wire = Buffer.from(
        JSON.stringify({
          kind: 'composerPrompt',
          workspaceId: 'ws-anything',
          threadId: 't-1',
          provider: 'gemini',
          text: 'hi'
        }),
        'utf-8'
      ).toString('base64')
      const result = (await router.route('bridge.requestActionAck', {
        pairID: 'pair-1',
        payloadBytes: 10,
        payloadBase64: wire
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(false)
      expect(result.message).toMatch(/no workspace allowlist/i)
    })

    it('actionAck accepts when payload targets an allowlisted workspace', async () => {
      const allowlist = seedAllowlist()
      const router = new BridgeActionRouter({ allowlist })
      const wire = Buffer.from(
        JSON.stringify({
          kind: 'composerPrompt',
          workspaceId: 'ws-allowed',
          threadId: 't-1',
          text: 'hello',
          provider: 'gemini',
          approvalMode: 'default'
        }),
        'utf-8'
      ).toString('base64')
      const result = (await router.route('bridge.requestActionAck', {
        pairID: 'pair-1',
        payloadBytes: 10,
        payloadBase64: wire
      })) as { accepted: boolean; scope?: string; message?: string }
      expect(result.accepted).toBe(true)
      expect(result.scope).toBe('once')
      expect(result.message).toMatch(/composerPrompt|execution wiring pending/i)
    })

    it('actionAck denies a composerPrompt for an unlisted workspace', async () => {
      const allowlist = seedAllowlist()
      const router = new BridgeActionRouter({ allowlist })
      const wire = Buffer.from(
        JSON.stringify({
          kind: 'composerPrompt',
          workspaceId: 'ws-not-listed',
          threadId: 't-1',
          provider: 'gemini',
          text: 'hello'
        }),
        'utf-8'
      ).toString('base64')
      const result = (await router.route('bridge.requestActionAck', {
        pairID: 'pair-1',
        payloadBase64: wire
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(false)
      expect(result.message).toMatch(/not on the remote allowlist/i)
    })

    it('actionAck denies when provider is disallowed for the workspace', async () => {
      const allowlist = seedAllowlist()
      const router = new BridgeActionRouter({ allowlist })
      const wire = Buffer.from(
        JSON.stringify({
          kind: 'composerPrompt',
          workspaceId: 'ws-allowed',
          threadId: 't-1',
          text: 'hi',
          provider: 'claude' // not in allowed list (gemini, codex)
        }),
        'utf-8'
      ).toString('base64')
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: wire
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(false)
      expect(result.message).toMatch(/provider "claude"/i)
    })

    it('actionAck denies malformed base64', async () => {
      const router = new BridgeActionRouter({ allowlist: seedAllowlist() })
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: '!!!not-base64!!!'
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(false)
      expect(result.message).toMatch(/malformed action payload/i)
    })

    it('actionAck denies malformed JSON inside valid base64', async () => {
      const router = new BridgeActionRouter({ allowlist: seedAllowlist() })
      const wire = Buffer.from('not json {', 'utf-8').toString('base64')
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: wire
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(false)
      expect(result.message).toMatch(/malformed action payload \(json\)/i)
    })

    it('actionAck denies an unknown action kind with a clear message', async () => {
      const router = new BridgeActionRouter({ allowlist: seedAllowlist() })
      const wire = Buffer.from(
        JSON.stringify({
          kind: 'futureKind',
          workspaceId: 'ws-allowed',
          stuff: true
        }),
        'utf-8'
      ).toString('base64')
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: wire
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(false)
      expect(result.message).toMatch(/unrecognized action kind "futureKind"/i)
    })

    it('actionAck accepts approvalReply variant for an allowlisted workspace', async () => {
      const allowlist = seedAllowlist()
      const router = new BridgeActionRouter({ allowlist })
      const wire = Buffer.from(
        JSON.stringify({
          kind: 'approvalReply',
          workspaceId: 'ws-allowed',
          threadId: 't-1',
          toolCallId: 'tc-1',
          decision: 'acceptForSession'
        }),
        'utf-8'
      ).toString('base64')
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: wire
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(true)
    })

    it('permissive-dev still bypasses payload decoding entirely', async () => {
      const allowlist = seedAllowlist()
      const router = new BridgeActionRouter({ allowlist, permissiveDev: true })
      const result = (await router.route('bridge.requestActionAck', {
        // Intentionally garbage; permissive-dev should still accept.
        payloadBase64: '!!!garbage!!!'
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(true)
      expect(result.message).toMatch(/permissive-dev/i)
    })
  })

  describe('executor dispatch on accept (Phase C-late)', () => {
    const seedAllowlist = () => {
      const allowlist = new RemoteWorkspaceAllowlist()
      allowlist.upsert({
        workspaceId: 'ws-allowed',
        path: '/a',
        mode: 'read-write',
        allowedProviders: ['gemini', 'codex'],
        allowedApprovalModes: ['default', 'plan']
      })
      return allowlist
    }

    const composerPromptWire = (overrides: Record<string, unknown> = {}) =>
      Buffer.from(
        JSON.stringify({
          kind: 'composerPrompt',
          workspaceId: 'ws-allowed',
          threadId: 't-1',
          provider: 'gemini',
          text: 'hi',
          ...overrides
        }),
        'utf-8'
      ).toString('base64')

    it('dispatches accepted composerPrompt to executor.executeComposerPrompt', async () => {
      const { executor, calls } = makeStubExecutor()
      const router = new BridgeActionRouter({ allowlist: seedAllowlist(), executor })
      const result = (await router.route('bridge.requestActionAck', {
        pairID: 'p',
        payloadBase64: composerPromptWire()
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(true)
      expect(result.message).toBe('composerPrompt done')
      expect(calls).toHaveLength(1)
      expect(calls[0].method).toBe('executeComposerPrompt')
    })

    it('dispatches cancelRun to executor.executeCancelRun', async () => {
      const { executor, calls } = makeStubExecutor()
      const router = new BridgeActionRouter({ allowlist: seedAllowlist(), executor })
      const wire = Buffer.from(
        JSON.stringify({
          kind: 'cancelRun',
          workspaceId: 'ws-allowed',
          threadId: 't-1',
          provider: 'gemini',
          runId: 'run-1'
        }),
        'utf-8'
      ).toString('base64')
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: wire
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(true)
      expect(result.message).toBe('cancelRun done')
      expect(calls).toHaveLength(1)
      expect(calls[0].method).toBe('executeCancelRun')
    })

    it('dispatches approvalReply to executor.executeApprovalReply', async () => {
      const { executor, calls } = makeStubExecutor()
      const router = new BridgeActionRouter({ allowlist: seedAllowlist(), executor })
      const wire = Buffer.from(
        JSON.stringify({
          kind: 'approvalReply',
          workspaceId: 'ws-allowed',
          threadId: 't-1',
          toolCallId: 'tc-1',
          decision: 'acceptForSession'
        }),
        'utf-8'
      ).toString('base64')
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: wire
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(true)
      expect(calls[0].method).toBe('executeApprovalReply')
    })

    it('surfaces executor message when execution declines (not-yet-wired path)', async () => {
      const { executor } = makeStubExecutor({
        executeComposerPrompt: async () => ({
          executed: false,
          message: 'composerPrompt scaffolded'
        })
      })
      const router = new BridgeActionRouter({ allowlist: seedAllowlist(), executor })
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: composerPromptWire()
      })) as { accepted: boolean; message?: string }
      // Policy says yes; executor says "not yet wired". Router reports
      // accepted=true (policy decision) with the executor's message.
      expect(result.accepted).toBe(true)
      expect(result.message).toBe('composerPrompt scaffolded')
    })

    it('does not invoke the executor when allowlist denies', async () => {
      const { executor, calls } = makeStubExecutor()
      const router = new BridgeActionRouter({ allowlist: seedAllowlist(), executor })
      const wire = composerPromptWire({ workspaceId: 'ws-not-listed' })
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: wire
      })) as { accepted: boolean }
      expect(result.accepted).toBe(false)
      expect(calls).toHaveLength(0)
    })

    it('does not invoke the executor when payload is unknown', async () => {
      const { executor, calls } = makeStubExecutor()
      const router = new BridgeActionRouter({ allowlist: seedAllowlist(), executor })
      const wire = Buffer.from(
        JSON.stringify({ kind: 'futureKind', workspaceId: 'ws-allowed' }),
        'utf-8'
      ).toString('base64')
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: wire
      })) as { accepted: boolean }
      expect(result.accepted).toBe(false)
      expect(calls).toHaveLength(0)
    })

    it('defaults to NoopActionExecutor when none injected', async () => {
      const router = new BridgeActionRouter({ allowlist: seedAllowlist() })
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: composerPromptWire()
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(true)
      // NoopActionExecutor message ends with "execution not yet wired"
      expect(result.message).toMatch(/not yet wired/i)
    })

    it('registerApnsToken bypasses workspace allowlist (system action)', async () => {
      const { executor, calls } = makeStubExecutor()
      // No allowlist provided at all — workspace-gated actions would deny,
      // but registerApnsToken is a system action and accepts.
      const router = new BridgeActionRouter({ executor })
      const wire = Buffer.from(
        JSON.stringify({
          kind: 'registerApnsToken',
          pairID: 'pair-1',
          deviceToken: 'tok-abc',
          env: 'production'
        }),
        'utf-8'
      ).toString('base64')
      const result = (await router.route('bridge.requestActionAck', {
        pairID: 'pair-1',
        payloadBase64: wire
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(true)
      expect(result.message).toBe('registerApnsToken done')
      expect(calls).toHaveLength(1)
      expect(calls[0].method).toBe('executeRegisterApnsToken')
    })

    it('registerApnsToken still bypasses gating even with an allowlist present', async () => {
      const { executor } = makeStubExecutor()
      const router = new BridgeActionRouter({ allowlist: seedAllowlist(), executor })
      const wire = Buffer.from(
        JSON.stringify({
          kind: 'registerApnsToken',
          pairID: 'unaffiliated-pair',
          deviceToken: 'tok',
          env: 'sandbox'
        }),
        'utf-8'
      ).toString('base64')
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: wire
      })) as { accepted: boolean }
      expect(result.accepted).toBe(true)
    })

    it('setYoloMode requires a workspace allowlist entry before dispatch', async () => {
      const { executor, calls } = makeStubExecutor()
      const router = new BridgeActionRouter({ allowlist: seedAllowlist(), executor })
      const wire = Buffer.from(
        JSON.stringify({
          kind: 'setYoloMode',
          workspaceId: 'ws-allowed',
          enabled: true
        }),
        'utf-8'
      ).toString('base64')
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: wire
      })) as { accepted: boolean; message?: string; executed?: boolean }
      expect(result.accepted).toBe(true)
      expect(result.executed).toBe(true)
      expect(result.message).toBe('setYoloMode done')
      expect(calls).toHaveLength(1)
      expect(calls[0].method).toBe('executeSetYoloMode')
    })

    it('setYoloMode is denied without a workspace allowlist entry', async () => {
      const { executor, calls } = makeStubExecutor()
      const router = new BridgeActionRouter({ allowlist: seedAllowlist(), executor })
      const wire = Buffer.from(
        JSON.stringify({
          kind: 'setYoloMode',
          workspaceId: 'ws-not-listed',
          enabled: true
        }),
        'utf-8'
      ).toString('base64')
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: wire
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(false)
      expect(result.message).toMatch(/not on the remote allowlist/i)
      expect(calls).toHaveLength(0)
    })

    it('dispatches togglePinChat to executor.executeTogglePinChat', async () => {
      const { executor, calls } = makeStubExecutor()
      const router = new BridgeActionRouter({ allowlist: seedAllowlist(), executor })
      const wire = Buffer.from(
        JSON.stringify({
          kind: 'togglePinChat',
          workspaceId: 'ws-allowed',
          appChatId: 'chat-1',
          pinned: true
        }),
        'utf-8'
      ).toString('base64')
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: wire
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(true)
      expect(result.message).toBe('togglePinChat done')
      expect(calls[0].method).toBe('executeTogglePinChat')
    })

    it('dispatches togglePinWorkspace to executor.executeTogglePinWorkspace', async () => {
      const { executor, calls } = makeStubExecutor()
      const router = new BridgeActionRouter({ allowlist: seedAllowlist(), executor })
      const wire = Buffer.from(
        JSON.stringify({
          kind: 'togglePinWorkspace',
          workspaceId: 'ws-allowed',
          pinned: false
        }),
        'utf-8'
      ).toString('base64')
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: wire
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(true)
      expect(result.message).toBe('togglePinWorkspace done')
      expect(calls[0].method).toBe('executeTogglePinWorkspace')
    })
  })

  describe('read-only mode enforcement (Phase C-late slice)', () => {
    /** Allowlist with one read-only entry for ws-readonly. */
    const seedReadOnly = () => {
      const allowlist = new RemoteWorkspaceAllowlist()
      allowlist.upsert({
        workspaceId: 'ws-readonly',
        path: '/a',
        mode: 'read-only',
        allowedProviders: ['gemini', 'codex'],
        allowedApprovalModes: ['default', 'plan']
      })
      allowlist.upsert({
        workspaceId: 'ws-readwrite',
        path: '/b',
        mode: 'read-write',
        allowedProviders: ['gemini', 'codex'],
        allowedApprovalModes: ['default', 'plan']
      })
      return allowlist
    }

    const encodeAction = (action: Record<string, unknown>) =>
      Buffer.from(JSON.stringify(action), 'utf-8').toString('base64')

    it('denies composerPrompt against read-only workspace', async () => {
      const { executor, calls } = makeStubExecutor()
      const router = new BridgeActionRouter({ allowlist: seedReadOnly(), executor })
      const wire = encodeAction({
        kind: 'composerPrompt',
        workspaceId: 'ws-readonly',
        threadId: 't-1',
        provider: 'gemini',
        text: 'hi'
      })
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: wire
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(false)
      expect(result.message).toMatch(/read-only/i)
      expect(result.message).toMatch(/composerPrompt/)
      // Executor must NOT be invoked when policy denies.
      expect(calls).toHaveLength(0)
    })

    it('denies cancelRun against read-only workspace', async () => {
      const router = new BridgeActionRouter({ allowlist: seedReadOnly() })
      const wire = encodeAction({
        kind: 'cancelRun',
        workspaceId: 'ws-readonly',
        threadId: 't-1',
        provider: 'gemini',
        runId: 'r-1'
      })
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: wire
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(false)
      expect(result.message).toMatch(/read-only/i)
    })

    it('denies questionReply against read-only workspace', async () => {
      const router = new BridgeActionRouter({ allowlist: seedReadOnly() })
      const wire = encodeAction({
        kind: 'questionReply',
        workspaceId: 'ws-readonly',
        threadId: 't-1',
        promptId: 'q-1',
        answer: 'yes'
      })
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: wire
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(false)
      expect(result.message).toMatch(/read-only/i)
    })

    it('denies pin changes against read-only workspace', async () => {
      const router = new BridgeActionRouter({ allowlist: seedReadOnly() })
      const wire = encodeAction({
        kind: 'togglePinChat',
        workspaceId: 'ws-readonly',
        appChatId: 'chat-1',
        pinned: true
      })
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: wire
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(false)
      expect(result.message).toMatch(/read-only/i)
    })

    it('accepts approvalReply against read-only workspace (responding to desktop-initiated prompt)', async () => {
      const { executor, calls } = makeStubExecutor()
      const router = new BridgeActionRouter({ allowlist: seedReadOnly(), executor })
      const wire = encodeAction({
        kind: 'approvalReply',
        workspaceId: 'ws-readonly',
        threadId: 't-1',
        toolCallId: 'tc-1',
        decision: 'accept'
      })
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: wire
      })) as { accepted: boolean }
      expect(result.accepted).toBe(true)
      expect(calls).toHaveLength(1)
      expect(calls[0].method).toBe('executeApprovalReply')
    })

    it('accepts questionReject against read-only workspace (declining is not mutating)', async () => {
      const router = new BridgeActionRouter({ allowlist: seedReadOnly() })
      const wire = encodeAction({
        kind: 'questionReject',
        workspaceId: 'ws-readonly',
        threadId: 't-1',
        promptId: 'q-1'
      })
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: wire
      })) as { accepted: boolean }
      expect(result.accepted).toBe(true)
    })

    it('still accepts composerPrompt against read-write workspace (regression guard)', async () => {
      const router = new BridgeActionRouter({ allowlist: seedReadOnly() })
      const wire = encodeAction({
        kind: 'composerPrompt',
        workspaceId: 'ws-readwrite',
        threadId: 't-1',
        provider: 'gemini',
        text: 'hi'
      })
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: wire
      })) as { accepted: boolean }
      expect(result.accepted).toBe(true)
    })

    it('permissive-dev mode bypasses read-only enforcement', async () => {
      const router = new BridgeActionRouter({
        allowlist: seedReadOnly(),
        permissiveDev: true
      })
      const wire = encodeAction({
        kind: 'composerPrompt',
        workspaceId: 'ws-readonly',
        threadId: 't-1',
        provider: 'gemini',
        text: 'hi'
      })
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: wire
      })) as { accepted: boolean; message?: string }
      expect(result.accepted).toBe(true)
      expect(result.message).toMatch(/permissive-dev/i)
    })

    it('read-only does not affect registerApnsToken (system action bypasses workspace gating entirely)', async () => {
      const router = new BridgeActionRouter({ allowlist: seedReadOnly() })
      const wire = encodeAction({
        kind: 'registerApnsToken',
        pairID: 'pair-1',
        deviceToken: 'tok',
        env: 'production'
      })
      const result = (await router.route('bridge.requestActionAck', {
        payloadBase64: wire
      })) as { accepted: boolean }
      expect(result.accepted).toBe(true)
    })
  })

  describe('unknown methods', () => {
    it('throws for an unrecognized method', async () => {
      const router = new BridgeActionRouter()
      await expect(router.route('bridge.somethingElse', {})).rejects.toThrow(/no handler/i)
    })
  })

  describe('fromEnvironment factory', () => {
    it('honors AGBENCH_BRIDGE_PERMISSIVE=1', async () => {
      const original = process.env.AGBENCH_BRIDGE_PERMISSIVE
      process.env.AGBENCH_BRIDGE_PERMISSIVE = '1'
      try {
        const router = BridgeActionRouter.fromEnvironment()
        const result = (await router.route('bridge.requestActionAck', {})) as { accepted: boolean }
        expect(result.accepted).toBe(true)
      } finally {
        if (original === undefined) {
          delete process.env.AGBENCH_BRIDGE_PERMISSIVE
        } else {
          process.env.AGBENCH_BRIDGE_PERMISSIVE = original
        }
      }
    })

    it('honors AGBENCH_BRIDGE_PERMISSIVE=true (string form)', async () => {
      const original = process.env.AGBENCH_BRIDGE_PERMISSIVE
      process.env.AGBENCH_BRIDGE_PERMISSIVE = 'true'
      try {
        const router = BridgeActionRouter.fromEnvironment()
        const result = (await router.route('bridge.requestActionAck', {})) as { accepted: boolean }
        expect(result.accepted).toBe(true)
      } finally {
        if (original === undefined) {
          delete process.env.AGBENCH_BRIDGE_PERMISSIVE
        } else {
          process.env.AGBENCH_BRIDGE_PERMISSIVE = original
        }
      }
    })

    it('defaults to deny when env var is absent', async () => {
      const original = process.env.AGBENCH_BRIDGE_PERMISSIVE
      delete process.env.AGBENCH_BRIDGE_PERMISSIVE
      try {
        const router = BridgeActionRouter.fromEnvironment()
        const result = (await router.route('bridge.requestActionAck', {})) as { accepted: boolean }
        expect(result.accepted).toBe(false)
      } finally {
        if (original !== undefined) {
          process.env.AGBENCH_BRIDGE_PERMISSIVE = original
        }
      }
    })
  })
})
