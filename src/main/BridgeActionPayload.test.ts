import { describe, expect, it } from 'vitest'
import {
  BridgeActionPayloadDecodeError,
  decodeBridgeActionPayload,
  payloadIsMutating,
  payloadRequiresWorkspaceGating,
  workspaceIdFromPayload,
  type BridgeActionPayload
} from './BridgeActionPayload'

function encode(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), 'utf-8').toString('base64')
}

describe('decodeBridgeActionPayload', () => {
  describe('happy paths', () => {
    it('decodes an approvalReply with all fields', () => {
      const wire = encode({
        kind: 'approvalReply',
        workspaceId: 'ws-1',
        threadId: 't-1',
        toolCallId: 'tool-call-99',
        decision: 'accept',
        message: 'approved from iPhone'
      })
      const { payload } = decodeBridgeActionPayload(wire)
      expect(payload.kind).toBe('approvalReply')
      if (payload.kind !== 'approvalReply') throw new Error('discriminant')
      expect(payload.workspaceId).toBe('ws-1')
      expect(payload.threadId).toBe('t-1')
      expect(payload.toolCallId).toBe('tool-call-99')
      expect(payload.decision).toBe('accept')
      expect(payload.message).toBe('approved from iPhone')
    })

    it('decodes the three approval decisions', () => {
      for (const decision of ['accept', 'acceptForSession', 'decline'] as const) {
        const wire = encode({
          kind: 'approvalReply',
          workspaceId: 'ws-1',
          threadId: 't-1',
          toolCallId: 'tc-1',
          decision
        })
        const { payload } = decodeBridgeActionPayload(wire)
        expect(payload.kind).toBe('approvalReply')
        if (payload.kind === 'approvalReply') {
          expect(payload.decision).toBe(decision)
        }
      }
    })

    it('decodes a questionReply', () => {
      const wire = encode({
        kind: 'questionReply',
        workspaceId: 'ws-1',
        threadId: 't-1',
        promptId: 'q-99',
        answer: 'yes, proceed with src/main'
      })
      const { payload } = decodeBridgeActionPayload(wire)
      expect(payload.kind).toBe('questionReply')
      if (payload.kind === 'questionReply') {
        expect(payload.answer).toBe('yes, proceed with src/main')
      }
    })

    it('decodes a questionReject', () => {
      const wire = encode({
        kind: 'questionReject',
        workspaceId: 'ws-1',
        threadId: 't-1',
        promptId: 'q-1',
        message: 'cancel this'
      })
      const { payload } = decodeBridgeActionPayload(wire)
      expect(payload.kind).toBe('questionReject')
    })

    it('decodes a composerPrompt with optional fields', () => {
      const wire = encode({
        kind: 'composerPrompt',
        workspaceId: 'ws-1',
        threadId: 't-1',
        text: 'find the auth bug',
        provider: 'gemini',
        approvalMode: 'plan',
        model: 'gemini-2.5-pro',
        contextTurns: 5
      })
      const { payload } = decodeBridgeActionPayload(wire)
      expect(payload.kind).toBe('composerPrompt')
      if (payload.kind === 'composerPrompt') {
        expect(payload.text).toBe('find the auth bug')
        expect(payload.provider).toBe('gemini')
        expect(payload.contextTurns).toBe(5)
      }
    })

    it('decodes a composerPrompt with only required fields', () => {
      const wire = encode({
        kind: 'composerPrompt',
        workspaceId: 'ws-1',
        threadId: 't-1',
        text: 'hi',
        provider: 'gemini'
      })
      const { payload } = decodeBridgeActionPayload(wire)
      expect(payload.kind).toBe('composerPrompt')
    })

    it('treats composerPrompt without provider as unknown', () => {
      const wire = encode({
        kind: 'composerPrompt',
        workspaceId: 'ws-1',
        threadId: 't-1',
        text: 'hi'
        // provider missing — now required
      })
      const { payload } = decodeBridgeActionPayload(wire)
      expect(payload.kind).toBe('unknown')
    })

    it('decodes a cancelRun', () => {
      const wire = encode({
        kind: 'cancelRun',
        workspaceId: 'ws-1',
        threadId: 't-1',
        provider: 'gemini',
        runId: 'run-1'
      })
      const { payload } = decodeBridgeActionPayload(wire)
      expect(payload.kind).toBe('cancelRun')
      if (payload.kind === 'cancelRun') {
        expect(payload.provider).toBe('gemini')
        expect(payload.runId).toBe('run-1')
      }
    })

    it('decodes a registerApnsToken with production env', () => {
      const wire = encode({
        kind: 'registerApnsToken',
        pairID: 'pair-1',
        deviceToken: 'abc123def456',
        env: 'production'
      })
      const { payload } = decodeBridgeActionPayload(wire)
      expect(payload.kind).toBe('registerApnsToken')
      if (payload.kind === 'registerApnsToken') {
        expect(payload.pairID).toBe('pair-1')
        expect(payload.deviceToken).toBe('abc123def456')
        expect(payload.env).toBe('production')
      }
    })

    it('decodes a registerApnsToken with sandbox env', () => {
      const wire = encode({
        kind: 'registerApnsToken',
        pairID: 'pair-1',
        deviceToken: 'tok',
        env: 'sandbox'
      })
      const { payload } = decodeBridgeActionPayload(wire)
      expect(payload.kind).toBe('registerApnsToken')
    })

    it('decodes subscribe-run-events with a resume cursor', () => {
      const wire = encode({
        kind: 'subscribe-run-events',
        runId: 'run-1',
        resumeFrom: 42
      })
      const { payload } = decodeBridgeActionPayload(wire)
      expect(payload.kind).toBe('subscribe-run-events')
      if (payload.kind === 'subscribe-run-events') {
        expect(payload.runId).toBe('run-1')
        expect(payload.resumeFrom).toBe(42)
      }
    })

    it('decodes subscribe-run-events with a null resume cursor', () => {
      const wire = encode({
        kind: 'subscribe-run-events',
        runId: 'run-1',
        resumeFrom: null
      })
      const { payload } = decodeBridgeActionPayload(wire)
      expect(payload.kind).toBe('subscribe-run-events')
      if (payload.kind === 'subscribe-run-events') {
        expect(payload.resumeFrom).toBeNull()
      }
    })

    it('treats registerApnsToken missing pairID as unknown', () => {
      const wire = encode({
        kind: 'registerApnsToken',
        deviceToken: 'tok',
        env: 'production'
      })
      const { payload } = decodeBridgeActionPayload(wire)
      expect(payload.kind).toBe('unknown')
    })

    it('treats registerApnsToken missing deviceToken as unknown', () => {
      const wire = encode({
        kind: 'registerApnsToken',
        pairID: 'pair-1',
        env: 'production'
      })
      const { payload } = decodeBridgeActionPayload(wire)
      expect(payload.kind).toBe('unknown')
    })

    it('treats registerApnsToken with invalid env as unknown', () => {
      const wire = encode({
        kind: 'registerApnsToken',
        pairID: 'pair-1',
        deviceToken: 'tok',
        env: 'staging' // not in enum
      })
      const { payload } = decodeBridgeActionPayload(wire)
      expect(payload.kind).toBe('unknown')
    })

    it('treats registerApnsToken with empty deviceToken as unknown', () => {
      const wire = encode({
        kind: 'registerApnsToken',
        pairID: 'pair-1',
        deviceToken: '',
        env: 'production'
      })
      const { payload } = decodeBridgeActionPayload(wire)
      expect(payload.kind).toBe('unknown')
    })

    it('treats cancelRun missing provider as unknown', () => {
      const wire = encode({
        kind: 'cancelRun',
        workspaceId: 'ws-1',
        threadId: 't-1',
        runId: 'run-1' // no provider
      })
      const { payload } = decodeBridgeActionPayload(wire)
      expect(payload.kind).toBe('unknown')
    })
  })

  describe('unknown / forward-compat', () => {
    it('decodes an unrecognized kind as BridgeUnknownAction', () => {
      const wire = encode({
        kind: 'futureFeatureFromV2iOS',
        workspaceId: 'ws-1',
        thingy: true
      })
      const { payload } = decodeBridgeActionPayload(wire)
      expect(payload.kind).toBe('unknown')
      if (payload.kind === 'unknown') {
        expect(payload.rawKind).toBe('futureFeatureFromV2iOS')
        expect(payload.raw).toEqual({
          kind: 'futureFeatureFromV2iOS',
          workspaceId: 'ws-1',
          thingy: true
        })
      }
    })

    it('treats malformed approvalReply (bad decision enum) as unknown', () => {
      const wire = encode({
        kind: 'approvalReply',
        workspaceId: 'ws-1',
        threadId: 't-1',
        toolCallId: 'tc-1',
        decision: 'maybe' // not in enum
      })
      const { payload } = decodeBridgeActionPayload(wire)
      expect(payload.kind).toBe('unknown')
      if (payload.kind === 'unknown') {
        expect(payload.rawKind).toBe('approvalReply')
      }
    })

    it('treats approvalReply missing toolCallId as unknown', () => {
      const wire = encode({
        kind: 'approvalReply',
        workspaceId: 'ws-1',
        threadId: 't-1',
        decision: 'accept'
      })
      const { payload } = decodeBridgeActionPayload(wire)
      expect(payload.kind).toBe('unknown')
    })

    it('treats composerPrompt with negative contextTurns as unknown', () => {
      const wire = encode({
        kind: 'composerPrompt',
        workspaceId: 'ws-1',
        threadId: 't-1',
        text: 'hi',
        contextTurns: -5
      })
      const { payload } = decodeBridgeActionPayload(wire)
      expect(payload.kind).toBe('unknown')
    })

    it('treats composerPrompt with float contextTurns as unknown', () => {
      const wire = encode({
        kind: 'composerPrompt',
        workspaceId: 'ws-1',
        threadId: 't-1',
        text: 'hi',
        contextTurns: 3.7
      })
      const { payload } = decodeBridgeActionPayload(wire)
      expect(payload.kind).toBe('unknown')
    })

    it('treats a top-level non-object payload as unknown', () => {
      const wire = encode(['this', 'is', 'an', 'array'])
      const { payload } = decodeBridgeActionPayload(wire)
      expect(payload.kind).toBe('unknown')
    })

    it('treats a payload with no kind as unknown', () => {
      const wire = encode({ workspaceId: 'ws-1', someField: true })
      const { payload } = decodeBridgeActionPayload(wire)
      expect(payload.kind).toBe('unknown')
    })
  })

  describe('decode errors (BridgeActionPayloadDecodeError)', () => {
    it('throws on empty base64', () => {
      expect(() => decodeBridgeActionPayload('')).toThrow(BridgeActionPayloadDecodeError)
    })

    it('throws on garbage base64', () => {
      try {
        decodeBridgeActionPayload('not===valid===base64!!')
        throw new Error('expected throw')
      } catch (err) {
        expect(err).toBeInstanceOf(BridgeActionPayloadDecodeError)
        if (err instanceof BridgeActionPayloadDecodeError) {
          expect(err.stage).toBe('base64')
        }
      }
    })

    it('throws on malformed JSON inside otherwise-valid base64', () => {
      const wire = Buffer.from('not json {', 'utf-8').toString('base64')
      try {
        decodeBridgeActionPayload(wire)
        throw new Error('expected throw')
      } catch (err) {
        expect(err).toBeInstanceOf(BridgeActionPayloadDecodeError)
        if (err instanceof BridgeActionPayloadDecodeError) {
          expect(err.stage).toBe('json')
        }
      }
    })
  })
})

describe('workspaceIdFromPayload', () => {
  it('returns workspaceId for each known variant', () => {
    const variants: Array<{ payload: BridgeActionPayload; expected: string }> = [
      {
        payload: { kind: 'approvalReply', workspaceId: 'ws-a', threadId: 't', toolCallId: 'tc', decision: 'accept' },
        expected: 'ws-a'
      },
      {
        payload: { kind: 'questionReply', workspaceId: 'ws-b', threadId: 't', promptId: 'p', answer: 'y' },
        expected: 'ws-b'
      },
      {
        payload: { kind: 'questionReject', workspaceId: 'ws-c', threadId: 't', promptId: 'p' },
        expected: 'ws-c'
      },
      {
        payload: { kind: 'composerPrompt', workspaceId: 'ws-d', threadId: 't', provider: 'gemini', text: 'hi' },
        expected: 'ws-d'
      },
      {
        payload: { kind: 'cancelRun', workspaceId: 'ws-e', threadId: 't', provider: 'gemini', runId: 'r' },
        expected: 'ws-e'
      }
    ]
    for (const { payload, expected } of variants) {
      expect(workspaceIdFromPayload(payload)).toBe(expected)
    }
  })

  it('returns null for unknown variant', () => {
    expect(
      workspaceIdFromPayload({ kind: 'unknown', rawKind: 'something', raw: {} })
    ).toBeNull()
  })

  it('returns null for registerApnsToken (paired-device-level, not workspace-bound)', () => {
    expect(
      workspaceIdFromPayload({
        kind: 'registerApnsToken',
        pairID: 'p',
        deviceToken: 't',
        env: 'production'
      })
    ).toBeNull()
  })
})

describe('payloadRequiresWorkspaceGating', () => {
  it('returns true for workspace-bound variants', () => {
    const variants: BridgeActionPayload[] = [
      { kind: 'approvalReply', workspaceId: 'w', threadId: 't', toolCallId: 'c', decision: 'accept' },
      { kind: 'questionReply', workspaceId: 'w', threadId: 't', promptId: 'p', answer: 'a' },
      { kind: 'questionReject', workspaceId: 'w', threadId: 't', promptId: 'p' },
      { kind: 'composerPrompt', workspaceId: 'w', threadId: 't', provider: 'gemini', text: 'x' },
      { kind: 'cancelRun', workspaceId: 'w', threadId: 't', provider: 'gemini', runId: 'r' }
    ]
    for (const v of variants) {
      expect(payloadRequiresWorkspaceGating(v)).toBe(true)
    }
  })

  it('returns false for registerApnsToken (system action)', () => {
    expect(
      payloadRequiresWorkspaceGating({
        kind: 'registerApnsToken',
        pairID: 'p',
        deviceToken: 't',
        env: 'production'
      })
    ).toBe(false)
  })

  it('returns true defensively for unknown variants', () => {
    expect(
      payloadRequiresWorkspaceGating({ kind: 'unknown', rawKind: 'x', raw: {} })
    ).toBe(true)
  })
})

describe('payloadIsMutating', () => {
  it('classifies composerPrompt as mutating', () => {
    expect(
      payloadIsMutating({
        kind: 'composerPrompt',
        workspaceId: 'w',
        threadId: 't',
        provider: 'gemini',
        text: 'hi'
      })
    ).toBe(true)
  })

  it('classifies cancelRun as mutating', () => {
    expect(
      payloadIsMutating({
        kind: 'cancelRun',
        workspaceId: 'w',
        threadId: 't',
        provider: 'gemini',
        runId: 'r'
      })
    ).toBe(true)
  })

  it('classifies questionReply as mutating (provides typed input to agent)', () => {
    expect(
      payloadIsMutating({
        kind: 'questionReply',
        workspaceId: 'w',
        threadId: 't',
        promptId: 'p',
        answer: 'yes'
      })
    ).toBe(true)
  })

  it('classifies approvalReply as non-mutating (responds to desktop-initiated prompt)', () => {
    expect(
      payloadIsMutating({
        kind: 'approvalReply',
        workspaceId: 'w',
        threadId: 't',
        toolCallId: 'tc',
        decision: 'accept'
      })
    ).toBe(false)
  })

  it('classifies questionReject as non-mutating (declines to provide input)', () => {
    expect(
      payloadIsMutating({
        kind: 'questionReject',
        workspaceId: 'w',
        threadId: 't',
        promptId: 'p'
      })
    ).toBe(false)
  })

  it('classifies registerApnsToken as non-mutating (system action, bypasses gating)', () => {
    expect(
      payloadIsMutating({
        kind: 'registerApnsToken',
        pairID: 'p',
        deviceToken: 't',
        env: 'production'
      })
    ).toBe(false)
  })

  it('classifies unknown variants as mutating defensively', () => {
    expect(
      payloadIsMutating({ kind: 'unknown', rawKind: 'futureKind', raw: {} })
    ).toBe(true)
  })
})
