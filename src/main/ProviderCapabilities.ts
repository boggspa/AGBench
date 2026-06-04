import type {
  AgenticNetworkPolicy,
  AgenticServicePolicy,
  AgenticServicesSettings,
  AppSettings,
  GeminiMcpBridgeStatus,
  ProviderCapabilityContract,
  ProviderApprovalCapability,
  ProviderCapabilityState,
  ProviderCapabilityWarning,
  ProviderId,
  ProviderMcpCapability,
  ProviderToolingCapability,
  ProviderToolingCapabilityId
} from './store/types'
import { AGENTBENCH_MCP_TOOLS } from './AgentbenchMcpTools'
import { providerLabel } from './ProviderAdapters'

export const AGENTBENCH_GEMINI_MCP_TOOLS = AGENTBENCH_MCP_TOOLS

const TOOLING_LABELS: Record<ProviderToolingCapabilityId, string> = {
  shellCommands: 'Shell commands',
  fileChanges: 'File changes',
  mcpTools: 'MCP and tool calls',
  creativeApps: 'Creative app tools',
  networkAccess: 'Network access',
  elicit: 'Ask the user',
  delegate: 'Delegate to sub-thread'
}

/** The original five "functional control" rows whose AGBench-enforcement is
 * tallied across the renderer (ToolingContractCard `enforcedCount`,
 * SettingsPanel contract hint) and main (ProviderPreflightService delegated
 * chip, DelegationAudit policy label). The `elicit` / `delegate` rows are
 * DISPLAY-only additions and are intentionally excluded from these tallies so
 * promoting `subThreadDelegation` to a first-class row does not double-count
 * against its existing settings gate or inflate the enforced/delegated counts.
 * Consumers that tally enforcement MUST iterate this list rather than
 * `Object.values(contract.tools)`. */
export const TOOLING_CONTROL_IDS = [
  'shellCommands',
  'fileChanges',
  'mcpTools',
  'creativeApps',
  'networkAccess'
] as const satisfies readonly ProviderToolingCapabilityId[]

export type ToolingControlId = (typeof TOOLING_CONTROL_IDS)[number]

/** The five functional-control rows of a contract, in canonical order. Tally
 * sites (enforced/delegated counts) MUST use this rather than
 * `Object.values(contract.tools)` so the DISPLAY-only `elicit` / `delegate`
 * rows never shift the enforced/delegated numerator or denominator. */
export function toolingControlRows(
  tools: Record<ProviderToolingCapabilityId, ProviderToolingCapability>
): ProviderToolingCapability[] {
  return TOOLING_CONTROL_IDS.map((id) => tools[id])
}

interface BuildProviderCapabilityContractInput {
  provider: ProviderId
  settings: Pick<AppSettings, 'agenticServices' | 'geminiMcpBridgeEnabled' | 'codexSandboxFallback'>
  workspacePath?: string
  approvalMode?: string
  status?: unknown
  mcpStatus?: unknown
  geminiMcpBridgeStatus?: GeminiMcpBridgeStatus | null
  refreshedAt?: string
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {}
}

function serviceState(policy?: AgenticServicePolicy): ProviderCapabilityState {
  if (policy === 'deny') return 'blocked'
  if (policy === 'allow') return 'available'
  return 'gated'
}

function networkState(policy?: AgenticNetworkPolicy): ProviderCapabilityState {
  return policy === 'deny' ? 'blocked' : 'available'
}

function serviceRequiresApproval(policy?: AgenticServicePolicy): boolean {
  return policy === 'ask' || policy === 'workspace' || !policy
}

function serviceCapability(
  id: ProviderToolingCapabilityId,
  policy: AgenticServicePolicy | undefined,
  source: ProviderToolingCapability['source'],
  tools: string[],
  details?: string
): ProviderToolingCapability {
  return {
    id,
    label: TOOLING_LABELS[id],
    state: serviceState(policy),
    source,
    enforcedByAgentBench: source === 'agentbench' || source === 'bridge' || source === 'settings',
    enforcement: source,
    policy,
    requiresApproval: serviceRequiresApproval(policy),
    tools,
    details
  }
}

function unavailableCapability(
  id: ProviderToolingCapabilityId,
  source: ProviderToolingCapability['source'],
  details: string
): ProviderToolingCapability {
  return {
    id,
    label: TOOLING_LABELS[id],
    state: 'unavailable',
    source,
    enforcedByAgentBench: false,
    enforcement: 'none',
    requiresApproval: false,
    tools: [],
    details
  }
}

function delegatedCapability(
  id: ProviderToolingCapabilityId,
  policy: AgenticServicePolicy | undefined,
  tools: string[],
  details: string
): ProviderToolingCapability {
  return {
    id,
    label: TOOLING_LABELS[id],
    state: policy === 'deny' ? 'blocked' : 'delegated',
    source: policy === 'deny' ? 'settings' : 'provider',
    enforcedByAgentBench: false,
    enforcement: policy === 'deny' ? 'best_effort' : 'provider',
    policy,
    requiresApproval: policy !== 'allow' && policy !== 'deny',
    tools,
    details
  }
}

/** `ask_user_question` (the `ui_elicitation` tool class) lets a participant
 * ask the user a clarifying question mid-run. It is a universally
 * auto-allowed AGBench MCP tool (see AgentbenchMcpTools `ask_user_question`),
 * so it carries no service-policy gate — it is reachable whenever the AGBench
 * MCP bridge is advertised to the provider, and provider-managed otherwise.
 * DISPLAY-only row: excluded from the enforced/delegated tallies. */
function elicitCapability(
  source: ProviderToolingCapability['source'],
  mcpAvailable: boolean,
  details: string,
  unavailableDetails?: string
): ProviderToolingCapability {
  const bridgeBacked = source === 'bridge' || source === 'agentbench'
  if (bridgeBacked && !mcpAvailable) {
    return unavailableCapability('elicit', source, unavailableDetails || details)
  }
  return {
    id: 'elicit',
    label: TOOLING_LABELS.elicit,
    state: bridgeBacked ? 'available' : 'delegated',
    source,
    enforcedByAgentBench: bridgeBacked,
    enforcement: bridgeBacked ? source : 'provider',
    requiresApproval: false,
    tools: ['ask_user_question'],
    details
  }
}

/** `delegate_to_subthread` (`subThreadDelegation`) lets a participant spawn a
 * cross-provider sub-thread. It IS gated by the existing
 * `agenticServices.subThreadDelegation` settings policy (see the
 * SettingsPanel tool→service map). Promoting it to a first-class row must NOT
 * change that gate or the enforcement tallies, so this is a DISPLAY-only row
 * excluded from `TOOLING_CONTROL_IDS`; the gate semantics stay in
 * PermissionService / EffectiveRunPermissions exactly as before. Its state is
 * derived from the same `subThreadDelegation` policy the gate already reads. */
function delegateCapability(
  source: ProviderToolingCapability['source'],
  policy: AgenticServicePolicy | undefined,
  mcpAvailable: boolean,
  details: string,
  unavailableDetails?: string
): ProviderToolingCapability {
  const bridgeBacked = source === 'bridge' || source === 'agentbench'
  if (bridgeBacked && !mcpAvailable) {
    return unavailableCapability('delegate', source, unavailableDetails || details)
  }
  if (!bridgeBacked) {
    return {
      id: 'delegate',
      label: TOOLING_LABELS.delegate,
      state: policy === 'deny' ? 'blocked' : 'delegated',
      source,
      enforcedByAgentBench: false,
      enforcement: policy === 'deny' ? 'best_effort' : 'provider',
      policy,
      requiresApproval: policy !== 'allow' && policy !== 'deny',
      tools: ['delegate_to_subthread'],
      details
    }
  }
  return {
    id: 'delegate',
    label: TOOLING_LABELS.delegate,
    state: serviceState(policy),
    source,
    enforcedByAgentBench: true,
    enforcement: source,
    policy,
    requiresApproval: serviceRequiresApproval(policy),
    tools: ['delegate_to_subthread'],
    details
  }
}

function networkCapability(policy?: AgenticNetworkPolicy): ProviderToolingCapability {
  return {
    id: 'networkAccess',
    label: TOOLING_LABELS.networkAccess,
    state: networkState(policy),
    source: 'settings',
    enforcedByAgentBench: false,
    enforcement: policy === 'deny' ? 'best_effort' : 'none',
    policy,
    requiresApproval: false,
    tools: [],
    details:
      policy === 'deny'
        ? 'AGBench settings request network blocking where provider transport supports it.'
        : 'Network access is allowed by AGBench settings.'
  }
}

function creativeAppsCapability(policy?: AgenticServicePolicy): ProviderToolingCapability {
  return {
    id: 'creativeApps',
    label: TOOLING_LABELS.creativeApps,
    state: serviceState(policy),
    source: 'bridge',
    enforcedByAgentBench: true,
    enforcement: 'bridge',
    policy,
    requiresApproval: serviceRequiresApproval(policy),
    tools: [
      'creative_app_status',
      'creative_app_capabilities',
      'creative_project_snapshot',
      'creative_timeline_validate',
      'creative_timeline_ir',
      'creative_timeline_diff'
    ],
    details:
      'AGBench exposes read-only creative app discovery, snapshots, and validation; future apply/control tools will route through the same approval model.'
  }
}

function warning(
  id: string,
  severity: ProviderCapabilityWarning['severity'],
  title: string,
  message: string
): ProviderCapabilityWarning {
  return { id, severity, title, message }
}

function mcpToolNamesFromStatus(value: unknown): string[] {
  const record = asRecord(value)
  const servers = Array.isArray(record.data) ? record.data : []
  const names = new Set<string>()
  for (const server of servers) {
    const serverRecord = asRecord(server)
    const tools = serverRecord.tools
    if (tools && typeof tools === 'object') {
      Object.keys(tools).forEach((name) => names.add(name))
    }
  }
  return [...names].sort()
}

function codexMcpCapability(mcpStatus: unknown): ProviderMcpCapability {
  const record = asRecord(mcpStatus)
  const tools = mcpToolNamesFromStatus(mcpStatus)
  const serverCount = Array.isArray(record.data) ? record.data.length : 0
  return {
    state: serverCount > 0 ? 'available' : 'gated',
    source: 'provider',
    available: serverCount > 0,
    tools,
    message:
      serverCount > 0
        ? `${serverCount} Codex MCP server${serverCount === 1 ? '' : 's'} reported by app-server.`
        : 'Codex app-server did not report configured MCP servers.'
  }
}

function geminiMcpCapability(
  status: GeminiMcpBridgeStatus | null | undefined
): ProviderMcpCapability {
  const enabled = Boolean(status?.enabled)
  const installed = Boolean(status?.installed)
  const available = Boolean(status?.available)
  return {
    state: available ? 'available' : 'unavailable',
    source: 'bridge',
    available,
    enabled,
    installed,
    serverName: status?.serverName || 'AGBench',
    tools: available ? [...AGENTBENCH_GEMINI_MCP_TOOLS] : [],
    message:
      status?.message ||
      (enabled
        ? 'AGBench Gemini MCP bridge is not available.'
        : 'AGBench Gemini MCP bridge is disabled.')
  }
}

function geminiMcpUnavailableTitle(status: GeminiMcpBridgeStatus | null | undefined): string {
  if (!status?.enabled) return 'Gemini MCP bridge disabled'
  if (!status.installed) return 'Gemini MCP bridge not installed'
  if (status.error) return 'Gemini MCP bridge status failed'
  return 'Gemini MCP bridge unavailable'
}

function unsupportedMcpCapability(provider: ProviderId): ProviderMcpCapability {
  return {
    state: 'delegated',
    source: 'unsupported',
    available: false,
    tools: [],
    message: `${providerLabel(provider)} MCP status is provider-managed or not exposed through a structured AGBench API yet.`
  }
}

function cliAgentbenchMcpCapability(
  provider: ProviderId,
  mcpStatus: unknown
): ProviderMcpCapability {
  const record = asRecord(mcpStatus)
  const enabled = Boolean(record.enabled)
  const available = Boolean(record.available)
  const tools = Array.isArray(record.tools)
    ? record.tools.map((tool) => String(tool || '')).filter(Boolean)
    : []
  return {
    state: available ? 'available' : enabled ? 'gated' : 'unavailable',
    source: 'bridge',
    available,
    enabled,
    installed: available,
    serverName: typeof record.serverName === 'string' ? record.serverName : 'AGBench',
    tools: available ? tools : [],
    message:
      typeof record.message === 'string'
        ? record.message
        : available
          ? `AGBench registers the AGBench MCP bridge for ${providerLabel(provider)} runs.`
          : `AGBench MCP bridge is not available for ${providerLabel(provider)}.`
  }
}

function approvalContract(
  provider: ProviderId,
  requestedMode: string,
  effectiveMode: string
): ProviderApprovalCapability {
  if (provider === 'codex') {
    return {
      requestedMode,
      effectiveMode,
      providerMode:
        requestedMode === 'plan'
          ? 'read-only / never'
          : requestedMode === 'auto_edit'
            ? 'workspace-write / gated by settings'
            : 'workspace-write / on-request',
      inAppApprovals: true,
      supportsWorkspaceGrants: true,
      notes: ['Codex app-server permission requests are routed through AGBench approval cards.']
    }
  }
  if (provider === 'gemini') {
    return {
      requestedMode,
      effectiveMode,
      providerMode: effectiveMode,
      inAppApprovals: true,
      supportsWorkspaceGrants: true,
      notes: [
        'AGBench-managed Gemini MCP tools use AGBench approval cards when the bridge is available.'
      ]
    }
  }
  if (provider === 'kimi') {
    return {
      requestedMode,
      effectiveMode,
      providerMode: requestedMode === 'plan' ? 'wire plan mode' : 'wire provider approvals',
      inAppApprovals: true,
      supportsWorkspaceGrants: false,
      notes: [
        'Kimi Wire approval requests are routed through AGBench, but provider-native tool coverage depends on Kimi CLI events.'
      ]
    }
  }
  return {
    requestedMode,
    effectiveMode,
    providerMode:
      requestedMode === 'plan' ? 'plan' : requestedMode === 'auto_edit' ? 'acceptEdits' : 'default',
    inAppApprovals: false,
    supportsWorkspaceGrants: false,
    notes: ['Claude Code permission handling is provider-managed in this build.']
  }
}

function effectiveGeminiMode(requestedMode: string, services: AgenticServicesSettings): string {
  if (requestedMode === 'plan') return requestedMode
  if (services.shellCommands === 'deny' || services.fileChanges === 'deny') return 'plan'
  return requestedMode
}

export function buildProviderCapabilityContract({
  provider,
  settings,
  workspacePath,
  approvalMode = 'default',
  status,
  mcpStatus,
  geminiMcpBridgeStatus,
  refreshedAt = new Date().toISOString()
}: BuildProviderCapabilityContractInput): ProviderCapabilityContract {
  const services = settings.agenticServices
  const warnings: ProviderCapabilityWarning[] = []
  const label = providerLabel(provider)
  const requestedMode = approvalMode || 'default'
  const effectiveMode =
    provider === 'gemini' ? effectiveGeminiMode(requestedMode, services) : requestedMode
  const statusRecord = asRecord(status)
  const setupRequired = Boolean(statusRecord.setupRequired)
  const explicitlyUnavailable = statusRecord.available === false || setupRequired

  const availability = {
    available: !explicitlyUnavailable,
    setupRequired,
    binaryPath: typeof statusRecord.binaryPath === 'string' ? statusRecord.binaryPath : null,
    binarySource:
      typeof statusRecord.binarySource === 'string' ? statusRecord.binarySource : undefined,
    version: typeof statusRecord.version === 'string' ? statusRecord.version : undefined,
    authState: typeof statusRecord.authState === 'string' ? statusRecord.authState : undefined,
    appServer: typeof statusRecord.appServer === 'string' ? statusRecord.appServer : undefined,
    error: typeof statusRecord.error === 'string' ? statusRecord.error : undefined
  }

  if (explicitlyUnavailable) {
    warnings.push(
      warning(
        `${provider}-unavailable`,
        'error',
        `${label} unavailable`,
        availability.error ||
          `${label} is not ready. Check the binary path and provider login state.`
      )
    )
  }

  let shellCommands: ProviderToolingCapability
  let fileChanges: ProviderToolingCapability
  let mcpTools: ProviderToolingCapability
  let elicit: ProviderToolingCapability
  let delegate: ProviderToolingCapability
  let mcp: ProviderMcpCapability

  if (provider === 'gemini') {
    mcp = geminiMcpCapability(geminiMcpBridgeStatus)
    if (mcp.available) {
      shellCommands = serviceCapability(
        'shellCommands',
        services.shellCommands,
        'bridge',
        ['run_shell_command'],
        'Gemini uses the AGBench MCP bridge for host shell commands.'
      )
      fileChanges = serviceCapability(
        'fileChanges',
        services.fileChanges,
        'bridge',
        ['write_file', 'replace'],
        'Gemini uses the AGBench MCP bridge for workspace file writes and replacements.'
      )
      mcpTools = serviceCapability(
        'mcpTools',
        services.mcpTools,
        'bridge',
        ['read_file', 'list_directory'],
        'Gemini uses the AGBench MCP bridge for workspace read/list tools.'
      )
      elicit = elicitCapability(
        'bridge',
        true,
        'Gemini can ask the user a clarifying question through the AGBench MCP bridge (auto-allowed).'
      )
      delegate = delegateCapability(
        'bridge',
        services.subThreadDelegation,
        true,
        'Gemini can spawn cross-provider sub-threads through the AGBench MCP bridge, gated by the sub-thread delegation setting.'
      )
    } else {
      shellCommands = unavailableCapability(
        'shellCommands',
        'bridge',
        'AGBench shell tools are not advertised to Gemini until the MCP bridge is enabled, installed, and available.'
      )
      fileChanges = unavailableCapability(
        'fileChanges',
        'bridge',
        'AGBench file editing tools are not advertised to Gemini until the MCP bridge is enabled, installed, and available.'
      )
      mcpTools = unavailableCapability(
        'mcpTools',
        'bridge',
        'AGBench MCP tools are not advertised to Gemini until the bridge is enabled, installed, and available.'
      )
      elicit = elicitCapability(
        'bridge',
        false,
        'Gemini cannot ask the user through AGBench until the MCP bridge is enabled, installed, and available.'
      )
      delegate = delegateCapability(
        'bridge',
        services.subThreadDelegation,
        false,
        'Gemini cannot delegate to sub-threads through AGBench until the MCP bridge is enabled, installed, and available.'
      )
      warnings.push(
        warning(
          mcp.enabled ? 'gemini-bridge-unavailable' : 'gemini-bridge-disabled',
          'warning',
          geminiMcpUnavailableTitle(geminiMcpBridgeStatus),
          mcp.message || 'Gemini will only have provider-native tools for this run.'
        )
      )
    }
    if (requestedMode !== effectiveMode) {
      warnings.push(
        warning(
          'gemini-approval-mode-downgraded',
          'warning',
          'Gemini approval mode adjusted',
          `Requested ${requestedMode}, but AGBench service settings block write-capable Gemini modes, so this run will use ${effectiveMode}.`
        )
      )
    }
  } else if (provider === 'codex') {
    mcp = codexMcpCapability(mcpStatus)
    shellCommands = serviceCapability(
      'shellCommands',
      services.shellCommands,
      'agentbench',
      ['run_shell_command'],
      'Codex command approvals are routed through AGBench.'
    )
    fileChanges = serviceCapability(
      'fileChanges',
      services.fileChanges,
      'agentbench',
      ['edit_file', 'create_file', 'delete_file'],
      'Codex file approvals and diffs are routed through AGBench.'
    )
    mcpTools = serviceCapability('mcpTools', services.mcpTools, 'provider', mcp.tools, mcp.message)
    elicit = elicitCapability(
      'agentbench',
      true,
      'Codex can ask the user a clarifying question through the AGBench MCP tool surface (auto-allowed).'
    )
    delegate = delegateCapability(
      'agentbench',
      services.subThreadDelegation,
      true,
      'Codex can spawn cross-provider sub-threads through AGBench, gated by the sub-thread delegation setting.'
    )
    if (settings.codexSandboxFallback === 'ask_rerun') {
      warnings.push(
        warning(
          'codex-sandbox-fallback',
          'info',
          'Codex sandbox fallback enabled',
          'Swift/Xcode-style sandbox collisions can be rerun once from the host process after explicit approval.'
        )
      )
    }
  } else {
    mcp =
      provider === 'claude' || provider === 'kimi'
        ? cliAgentbenchMcpCapability(provider, mcpStatus)
        : unsupportedMcpCapability(provider)
    shellCommands = delegatedCapability(
      'shellCommands',
      services.shellCommands,
      provider === 'claude' ? ['provider_shell'] : ['provider_shell_or_wire_tool'],
      `${label} shell command handling is delegated to the provider CLI.`
    )
    fileChanges = delegatedCapability(
      'fileChanges',
      services.fileChanges,
      provider === 'claude' ? ['provider_file_edit'] : ['provider_file_edit_or_wire_tool'],
      `${label} file edit handling is delegated to the provider CLI.`
    )
    mcpTools =
      provider === 'claude' || provider === 'kimi'
        ? serviceCapability('mcpTools', services.mcpTools, 'bridge', mcp.tools, mcp.message)
        : delegatedCapability(
            'mcpTools',
            services.mcpTools,
            mcp.tools,
            mcp.message || `${label} MCP status is unavailable.`
          )
    if (provider === 'claude' || provider === 'kimi') {
      elicit = elicitCapability(
        'bridge',
        mcp.available,
        `${label} can ask the user a clarifying question through the AGBench MCP bridge (auto-allowed).`,
        `AGBench cannot route ${label} user questions until the AGBench MCP bridge is available.`
      )
      delegate = delegateCapability(
        'bridge',
        services.subThreadDelegation,
        mcp.available,
        `${label} can spawn cross-provider sub-threads through the AGBench MCP bridge, gated by the sub-thread delegation setting.`,
        `AGBench cannot route ${label} sub-thread delegation until the AGBench MCP bridge is available.`
      )
    } else {
      elicit = elicitCapability(
        'provider',
        false,
        `${label} user-question handling is delegated to the provider CLI; AGBench does not advertise its elicitation tool here yet.`
      )
      delegate = delegateCapability(
        'provider',
        services.subThreadDelegation,
        false,
        `${label} sub-thread delegation is delegated to the provider CLI; AGBench does not advertise its delegation tool here yet.`
      )
    }
    warnings.push(
      warning(
        `${provider}-provider-managed-tools`,
        'info',
        `${label} tools are provider-managed`,
        `${label} can run with AGBench routing, but full shell/file/MCP tool introspection depends on provider CLI events.`
      )
    )
  }

  const networkAccess = networkCapability(services.networkAccess)
  const creativeApps = creativeAppsCapability(services.mcpTools)
  if (networkAccess.state === 'blocked') {
    warnings.push(
      warning(
        `${provider}-network-blocked`,
        'warning',
        'Network access blocked',
        `${label} will be launched with AGBench network policy set to block where that provider transport supports it.`
      )
    )
  }

  for (const tool of [shellCommands, fileChanges, mcpTools]) {
    if (tool.state === 'blocked') {
      warnings.push(
        warning(
          `${provider}-${tool.id}-blocked`,
          'warning',
          `${tool.label} blocked`,
          `${tool.label} are blocked by AGBench settings for ${label}.`
        )
      )
    }
  }

  return {
    provider,
    label,
    refreshedAt,
    workspacePath,
    availability,
    tools: {
      shellCommands,
      fileChanges,
      mcpTools,
      creativeApps,
      networkAccess,
      elicit,
      delegate
    },
    approvals: approvalContract(provider, requestedMode, effectiveMode),
    mcp,
    warnings
  }
}
