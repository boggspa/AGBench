import { describe, expect, it, vi } from 'vitest'
import { RunCoordinator, type RunCoordinatorDeps } from './RunCoordinator'
import type { ProviderId } from '../store/types'
import type { ProviderAdapter } from '../ProviderAdapters'
import type { AgentRunPayload, AgentRunRoute } from '../index'

/**
 * Phase B1 — unit tests for the RunCoordinator extraction.
 *
 * These tests verify the chokepoint's behaviour without needing the
 * full Electron + provider runtime bootstrap. The five external
 * dependencies are injected; the adapter is faked to a vi.fn that
 * records invocations.
 */

function makeFakeSender(): Electron.WebContents {
  return { id: 1, isDestroyed: () => false } as unknown as Electron.WebContents
}

function makeFakeEvent(): Electron.IpcMainInvokeEvent {
  return { sender: makeFakeSender() } as unknown as Electron.IpcMainInvokeEvent
}

function makeFakeAdapter(provider: ProviderId): ProviderAdapter {
  return {
    provider,
    label: provider,
    transport: 'gemini-cli',
    runChannel: 'run-agent',
    capabilitySource: 'mixed',
    features: {
      persistentSessions: false,
      appManagedApprovals: true,
      workspaceGrants: false,
      agentBenchMcpBridge: false,
      providerManagedMcp: false,
      nativeThreadTools: false,
      hostCommandFallback: false
    },
    capabilities: {
      approvalModes: ['default'],
      reasoningEffort: [],
      speedTiers: [],
      imageAttachments: false,
      contextInjection: 'agentbench',
      sessionResumption: 'none',
      perThreadMcp: false
    } as never,
    run: vi.fn(async () => undefined),
    cancel: vi.fn(async () => true),
    getStatus: vi.fn(async () => ({})),
    getMcpStatus: vi.fn(async () => ({})),
    getCapabilityContract: vi.fn(async () => ({ provider }) as never)
  }
}

function makeDeps(overrides: Partial<RunCoordinatorDeps> = {}): {
  deps: RunCoordinatorDeps
  adapter: ProviderAdapter
  spies: Record<string, ReturnType<typeof vi.fn>>
} {
  const adapter = makeFakeAdapter('gemini')
  const spies = {
    normalizePayload: vi.fn((raw: unknown) => raw as AgentRunPayload),
    routeWithRunId: vi.fn(
      (_provider: ProviderId, route?: AgentRunRoute | null): AgentRunRoute => ({
        appRunId: route?.appRunId ?? 'run-fixed',
        appChatId: route?.appChatId
      })
    ),
    applyRuntimeProfileToPayload: vi.fn((p: AgentRunPayload) => p),
    ensureProviderRunPreflight: vi.fn(async () => true),
    getAdapter: vi.fn(() => adapter),
    sendError: vi.fn(),
    sendExit: vi.fn()
  }
  return {
    adapter,
    spies,
    deps: {
      normalizePayload: spies.normalizePayload as RunCoordinatorDeps['normalizePayload'],
      routeWithRunId: spies.routeWithRunId as RunCoordinatorDeps['routeWithRunId'],
      applyRuntimeProfileToPayload:
        spies.applyRuntimeProfileToPayload as RunCoordinatorDeps['applyRuntimeProfileToPayload'],
      ensureProviderRunPreflight:
        spies.ensureProviderRunPreflight as RunCoordinatorDeps['ensureProviderRunPreflight'],
      getAdapter: spies.getAdapter as RunCoordinatorDeps['getAdapter'],
      sendError: spies.sendError as RunCoordinatorDeps['sendError'],
      sendExit: spies.sendExit as RunCoordinatorDeps['sendExit'],
      ...overrides
    }
  }
}

const samplePayload: AgentRunPayload = {
  provider: 'gemini',
  prompt: 'Hello world',
  scope: 'workspace',
  workspace: '/tmp/ws',
  appChatId: 'chat-1',
  model: 'gemini-2.5'
} as AgentRunPayload

describe('RunCoordinator', () => {
  it('dispatches successfully when all dependencies cooperate', async () => {
    const { deps, adapter, spies } = makeDeps()
    const coord = new RunCoordinator(deps)
    const result = await coord.dispatch(samplePayload, makeFakeEvent())
    expect(result.dispatched).toBe(true)
    expect(result.appRunId).toBe('run-fixed')
    expect(spies.normalizePayload).toHaveBeenCalledTimes(1)
    expect(spies.applyRuntimeProfileToPayload).toHaveBeenCalledTimes(1)
    expect(spies.ensureProviderRunPreflight).toHaveBeenCalledTimes(1)
    expect(adapter.run).toHaveBeenCalledTimes(1)
    expect(spies.sendError).not.toHaveBeenCalled()
  })

  it('returns dispatched=false when preflight rejects', async () => {
    const { deps, adapter, spies } = makeDeps()
    spies.ensureProviderRunPreflight.mockResolvedValueOnce(false)
    const coord = new RunCoordinator(deps)
    const result = await coord.dispatch(samplePayload, makeFakeEvent())
    expect(result.dispatched).toBe(false)
    expect(result.appRunId).toBe('run-fixed')
    expect(adapter.run).not.toHaveBeenCalled()
  })

  it('reports a runtime-profile error to the sender and aborts dispatch', async () => {
    const { deps, adapter, spies } = makeDeps()
    spies.applyRuntimeProfileToPayload.mockImplementationOnce(() => {
      throw new Error('bad profile id')
    })
    const coord = new RunCoordinator(deps)
    const result = await coord.dispatch(samplePayload, makeFakeEvent())
    expect(result.dispatched).toBe(false)
    expect(adapter.run).not.toHaveBeenCalled()
    expect(spies.sendError).toHaveBeenCalledTimes(1)
    expect(spies.sendError.mock.calls[0][2]).toContain('bad profile id')
    expect(spies.sendExit).toHaveBeenCalledTimes(1)
    expect(spies.sendExit.mock.calls[0][2]).toBe(-1)
  })

  it('threads the assigned appRunId back into the payload before preflight', async () => {
    const { deps, spies } = makeDeps()
    spies.routeWithRunId.mockImplementation(() => ({
      appRunId: 'run-custom-42',
      appChatId: 'chat-1'
    }))
    const coord = new RunCoordinator(deps)
    await coord.dispatch(samplePayload, makeFakeEvent())
    // preflight should have seen the assigned id
    const preflightCall = spies.ensureProviderRunPreflight.mock.calls[0]
    const passedPayload = preflightCall[1] as AgentRunPayload
    expect(passedPayload.appRunId).toBe('run-custom-42')
  })

  it('rethrows adapter errors (matches original behavior — caller decides)', async () => {
    const { deps, adapter } = makeDeps()
    const adapterError = new Error('adapter blew up')
    ;(adapter.run as ReturnType<typeof vi.fn>).mockRejectedValueOnce(adapterError)
    const coord = new RunCoordinator(deps)
    // The original dispatchAgentRun didn't catch adapter.run errors;
    // they propagate. This test pins that behaviour so a future
    // refactor that wraps adapter.run in try/catch is conscious.
    await expect(coord.dispatch(samplePayload, makeFakeEvent())).rejects.toThrow('adapter blew up')
  })

  it('does not call applyRuntimeProfileToPayload twice on a fresh dispatch', async () => {
    const { deps, spies } = makeDeps()
    const coord = new RunCoordinator(deps)
    await coord.dispatch(samplePayload, makeFakeEvent())
    expect(spies.applyRuntimeProfileToPayload).toHaveBeenCalledTimes(1)
  })

  it('uses the routed appRunId when the payload doesn\'t carry one', async () => {
    const { deps, spies } = makeDeps()
    spies.routeWithRunId.mockReturnValue({ appRunId: 'fresh-id', appChatId: 'chat-1' })
    const coord = new RunCoordinator(deps)
    const result = await coord.dispatch(
      { ...samplePayload, appRunId: undefined } as AgentRunPayload,
      makeFakeEvent()
    )
    expect(result.appRunId).toBe('fresh-id')
  })

  it('forwards the normalized payload to the adapter (not the raw input)', async () => {
    const { deps, adapter, spies } = makeDeps()
    spies.normalizePayload.mockImplementation((raw: unknown) => ({
      ...(raw as AgentRunPayload),
      normalized: true as unknown as never
    }))
    const coord = new RunCoordinator(deps)
    await coord.dispatch(samplePayload, makeFakeEvent())
    const adapterCall = (adapter.run as ReturnType<typeof vi.fn>).mock.calls[0]
    const ctx = adapterCall[0] as { payload: AgentRunPayload & { normalized?: boolean } }
    expect(ctx.payload.normalized).toBe(true)
  })

  it('looks up the adapter using the normalized provider', async () => {
    const { deps, spies } = makeDeps()
    spies.normalizePayload.mockImplementation(
      (raw: unknown) => ({ ...(raw as AgentRunPayload), provider: 'codex' as ProviderId })
    )
    const coord = new RunCoordinator(deps)
    await coord.dispatch(samplePayload, makeFakeEvent())
    expect(spies.getAdapter).toHaveBeenCalledWith('codex')
  })
})
