import type {
  ProviderAdapterDescriptor,
  ProviderCapabilityContract,
  ProviderId
} from './store/types'

export interface ProviderRunContext<TPayload = unknown, TEvent = unknown> {
  event: TEvent
  payload: TPayload
}

export interface ProviderCapabilityRequest {
  workspacePath?: string
  approvalMode?: string
}

export interface ProviderAdapter<
  TPayload = unknown,
  TEvent = unknown
> extends ProviderAdapterDescriptor {
  run(context: ProviderRunContext<TPayload, TEvent>): Promise<void>
  cancel(runId?: string): Promise<boolean>
  getStatus(): Promise<unknown>
  getMcpStatus(): Promise<unknown>
  getCapabilityContract(request?: ProviderCapabilityRequest): Promise<ProviderCapabilityContract>
}

export class ProviderAdapterRegistry<TPayload = unknown, TEvent = unknown> {
  private adapters = new Map<ProviderId, ProviderAdapter<TPayload, TEvent>>()

  constructor(adapters: ProviderAdapter<TPayload, TEvent>[]) {
    for (const adapter of adapters) {
      this.register(adapter)
    }
  }

  register(adapter: ProviderAdapter<TPayload, TEvent>): void {
    if (this.adapters.has(adapter.provider)) {
      throw new Error(`Provider adapter already registered: ${adapter.provider}`)
    }
    this.adapters.set(adapter.provider, adapter)
  }

  get(provider: ProviderId): ProviderAdapter<TPayload, TEvent> | undefined {
    return this.adapters.get(provider)
  }

  require(provider: ProviderId): ProviderAdapter<TPayload, TEvent> {
    const adapter = this.get(provider)
    if (!adapter) {
      throw new Error(`Provider adapter is not registered: ${provider}`)
    }
    return adapter
  }

  list(): ProviderAdapter<TPayload, TEvent>[] {
    return [...this.adapters.values()]
  }

  descriptors(): ProviderAdapterDescriptor[] {
    return this.list().map((adapter) => providerAdapterDescriptor(adapter))
  }
}

export function providerAdapterDescriptor(
  adapter: ProviderAdapterDescriptor
): ProviderAdapterDescriptor {
  return {
    provider: adapter.provider,
    label: adapter.label,
    transport: adapter.transport,
    runChannel: adapter.runChannel,
    capabilitySource: adapter.capabilitySource,
    features: { ...adapter.features }
  }
}

export function createProviderAdapterRegistry<TPayload = unknown, TEvent = unknown>(
  adapters: ProviderAdapter<TPayload, TEvent>[]
): ProviderAdapterRegistry<TPayload, TEvent> {
  return new ProviderAdapterRegistry(adapters)
}

export function providerLabel(provider: ProviderId): string {
  if (provider === 'codex') return 'Codex'
  if (provider === 'claude') return 'Claude'
  if (provider === 'kimi') return 'Kimi'
  return 'Gemini'
}

export function defaultProviderDescriptor(provider: ProviderId): ProviderAdapterDescriptor {
  if (provider === 'codex') {
    return {
      provider,
      label: providerLabel(provider),
      transport: 'codex-app-server',
      runChannel: 'run-agent',
      capabilitySource: 'mixed',
      features: {
        persistentSessions: true,
        appManagedApprovals: true,
        workspaceGrants: true,
        agentBenchMcpBridge: false,
        providerManagedMcp: true,
        nativeThreadTools: true,
        hostCommandFallback: true
      }
    }
  }
  if (provider === 'gemini') {
    return {
      provider,
      label: providerLabel(provider),
      transport: 'gemini-cli',
      runChannel: 'run-gemini',
      capabilitySource: 'bridge',
      features: {
        persistentSessions: true,
        appManagedApprovals: true,
        workspaceGrants: true,
        agentBenchMcpBridge: true,
        providerManagedMcp: false,
        nativeThreadTools: false,
        hostCommandFallback: false
      }
    }
  }
  if (provider === 'kimi') {
    return {
      provider,
      label: providerLabel(provider),
      transport: 'kimi-wire-or-cli',
      runChannel: 'run-agent',
      capabilitySource: 'mixed',
      features: {
        persistentSessions: true,
        appManagedApprovals: true,
        workspaceGrants: false,
        agentBenchMcpBridge: false,
        providerManagedMcp: true,
        nativeThreadTools: false,
        hostCommandFallback: false
      }
    }
  }
  return {
    provider,
    label: providerLabel(provider),
    transport: 'claude-sdk-or-cli',
    runChannel: 'run-agent',
    capabilitySource: 'provider',
    features: {
      persistentSessions: true,
      appManagedApprovals: false,
      workspaceGrants: false,
      agentBenchMcpBridge: false,
      providerManagedMcp: true,
      nativeThreadTools: false,
      hostCommandFallback: false
    }
  }
}
