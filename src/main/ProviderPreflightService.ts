import type {
  ProviderAdapterDescriptor,
  ProviderCapabilityContract,
  ProviderCapabilityWarning,
  ProviderId
} from './store/types'

export type ProviderPreflightState = 'ready' | 'repairable' | 'blocked'
export type ProviderPreflightRepairAction = 'install_gemini_bridge' | 'configure_provider' | 'login_provider' | 'none'

export interface ProviderPreflightInput {
  provider: ProviderId
  workspacePath?: string
  approvalMode?: string
  model?: string | null
}

export interface ProviderPreflightResult {
  provider: ProviderId
  state: ProviderPreflightState
  reason: string
  repairAction: ProviderPreflightRepairAction
  fallbackAvailable: boolean
  contract: ProviderCapabilityContract
  chips: ProviderCapabilityWarning[]
}

function warning(
  id: string,
  severity: ProviderCapabilityWarning['severity'],
  title: string,
  message: string
): ProviderCapabilityWarning {
  return { id, severity, title, message }
}

function providerSetupRepairAction(contract: ProviderCapabilityContract): ProviderPreflightRepairAction {
  const authState = contract.availability.authState || ''
  if (/missing|expired|login|required/i.test(authState)) return 'login_provider'
  return 'configure_provider'
}

export class ProviderPreflightService {
  evaluate(
    input: ProviderPreflightInput,
    contract: ProviderCapabilityContract,
    descriptor?: ProviderAdapterDescriptor
  ): ProviderPreflightResult {
    const chips: ProviderCapabilityWarning[] = [...contract.warnings]
    const label = contract.label || input.provider

    if (!contract.availability.available) {
      const reason =
        contract.availability.error ||
        `${label} is not ready. Check provider setup before starting a run.`
      return {
        provider: input.provider,
        state: 'blocked',
        reason,
        repairAction: providerSetupRepairAction(contract),
        fallbackAvailable: Boolean(descriptor?.features.hostCommandFallback),
        contract,
        chips: [
          warning(`${input.provider}-preflight-blocked`, 'error', `${label} blocked`, reason),
          ...chips
        ]
      }
    }

    if (
      input.provider === 'gemini' &&
      contract.mcp.enabled &&
      (!contract.mcp.installed || !contract.mcp.available)
    ) {
      const reason =
        contract.mcp.message ||
        (contract.mcp.installed
          ? 'Gemini MCP bridge is installed but unavailable.'
          : 'Gemini MCP bridge is not installed.')
      return {
        provider: input.provider,
        state: 'blocked',
        reason,
        repairAction: 'install_gemini_bridge',
        fallbackAvailable: false,
        contract,
        chips: [
          warning('gemini-mcp-bridge-blocked', 'error', 'Gemini bridge blocked', reason),
          ...chips
        ]
      }
    }

    const delegatedTools = Object.values(contract.tools).filter((tool) => !tool.enforcedByAgentBench)
    if (delegatedTools.length > 0) {
      chips.unshift(
        warning(
          `${input.provider}-delegated-enforcement`,
          'info',
          'Provider-managed controls',
          `${delegatedTools.length}/${Object.values(contract.tools).length} tooling controls are delegated or best-effort for ${label}.`
        )
      )
    }

    return {
      provider: input.provider,
      state: 'ready',
      reason: `${label} is ready.`,
      repairAction: 'none',
      fallbackAvailable: Boolean(descriptor?.features.hostCommandFallback),
      contract,
      chips
    }
  }
}
