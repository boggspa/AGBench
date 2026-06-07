import { describe, expect, it } from 'vitest'
import { buildProviderCapabilityContract } from './ProviderCapabilities'
import type { AgenticServicesSettings, AppSettings } from './store/types'

const defaultServices: AgenticServicesSettings = {
  shellCommands: 'workspace',
  fileChanges: 'ask',
  mcpTools: 'ask',
  subThreadDelegation: 'ask',
  networkAccess: 'allow'
}

function settings(
  agenticServices: AgenticServicesSettings = defaultServices
): Pick<AppSettings, 'agenticServices' | 'geminiMcpBridgeEnabled' | 'codexSandboxFallback'> {
  return {
    agenticServices,
    geminiMcpBridgeEnabled: false,
    codexSandboxFallback: 'ask_rerun' as const
  }
}

describe('ProviderCapabilities', () => {
  it('does not advertise TaskWraith Gemini tools when the MCP bridge is disabled', () => {
    const contract = buildProviderCapabilityContract({
      provider: 'gemini',
      settings: settings(),
      status: { provider: 'gemini', available: true, version: '1.0.0' },
      geminiMcpBridgeStatus: {
        checkedAt: '2026-05-06T00:00:00.000Z',
        enabled: false,
        installed: false,
        available: false,
        serverName: 'TaskWraith',
        message: 'Bridge disabled'
      }
    })

    expect(contract.tools.shellCommands.state).toBe('unavailable')
    expect(contract.tools.fileChanges.tools).toEqual([])
    expect(contract.mcp.tools).toEqual([])
    expect(contract.warnings.map((warning) => warning.id)).toContain('gemini-bridge-disabled')
    // elicit/delegate are unavailable until the bridge is up.
    expect(contract.tools.elicit.state).toBe('unavailable')
    expect(contract.tools.delegate.state).toBe('unavailable')
    expect(contract.tools.elicit.tools).toEqual([])
    expect(contract.tools.delegate.tools).toEqual([])
  })

  it('advertises Gemini bridge tools with TaskWraith approval gates when available', () => {
    const contract = buildProviderCapabilityContract({
      provider: 'gemini',
      settings: settings(),
      status: { provider: 'gemini', available: true, version: '1.0.0' },
      geminiMcpBridgeStatus: {
        checkedAt: '2026-05-06T00:00:00.000Z',
        enabled: true,
        installed: true,
        available: true,
        serverName: 'TaskWraith'
      }
    })

    expect(contract.tools.shellCommands.state).toBe('gated')
    expect(contract.tools.shellCommands.tools).toEqual(['run_shell_command'])
    expect(contract.tools.fileChanges.tools).toEqual(['write_file', 'replace'])
    expect(contract.tools.creativeApps.tools).toEqual([
      'creative_app_status',
      'creative_app_capabilities',
      'creative_project_snapshot',
      'creative_timeline_validate',
      'creative_timeline_ir',
      'creative_timeline_diff'
    ])
    expect(contract.mcp.tools).toContain('list_directory')
    expect(contract.approvals.inAppApprovals).toBe(true)
    // ask_user_question is auto-allowed once the bridge is up; delegate
    // inherits the subThreadDelegation policy ('ask' -> gated).
    expect(contract.tools.elicit.state).toBe('available')
    expect(contract.tools.elicit.requiresApproval).toBe(false)
    expect(contract.tools.elicit.tools).toEqual(['ask_user_question'])
    expect(contract.tools.delegate.state).toBe('gated')
    expect(contract.tools.delegate.tools).toEqual(['delegate_to_subthread'])
    expect(contract.tools.delegate.policy).toBe('ask')
  })

  it('honors blocked settings in the Codex tooling contract', () => {
    const contract = buildProviderCapabilityContract({
      provider: 'codex',
      settings: {
        ...settings({
          ...defaultServices,
          shellCommands: 'deny',
          networkAccess: 'deny'
        }),
        geminiMcpBridgeEnabled: true
      },
      status: { provider: 'codex', available: true, version: '1.0.0', appServer: 'started' },
      mcpStatus: { data: [{ name: 'local', tools: { search: {}, read: {} } }] }
    })

    expect(contract.tools.shellCommands.state).toBe('blocked')
    expect(contract.tools.networkAccess.state).toBe('blocked')
    expect(contract.mcp.tools).toEqual(['read', 'search'])
    expect(contract.warnings.map((warning) => warning.id)).toContain('codex-shellCommands-blocked')
    // Codex routes the TaskWraith elicitation/delegation tools regardless of the
    // codex-native MCP server count; delegate tracks subThreadDelegation ('ask').
    expect(contract.tools.elicit.state).toBe('available')
    expect(contract.tools.elicit.enforcedByTaskWraith).toBe(true)
    expect(contract.tools.delegate.state).toBe('gated')
    expect(contract.tools.delegate.enforcedByTaskWraith).toBe(true)
  })

  it('keeps a provider runnable when optional metadata has an error', () => {
    const contract = buildProviderCapabilityContract({
      provider: 'codex',
      settings: { ...settings(), geminiMcpBridgeEnabled: true },
      status: {
        provider: 'codex',
        version: '1.0.0',
        appServer: 'started',
        error: 'Rate-limit metadata failed'
      }
    })

    expect(contract.availability.available).toBe(true)
    expect(contract.availability.error).toBe('Rate-limit metadata failed')
    expect(contract.warnings.map((warning) => warning.id)).not.toContain('codex-unavailable')
  })

  it('treats Codex MCP as available when TaskWraith registration is enabled but live listing is absent', () => {
    const contract = buildProviderCapabilityContract({
      provider: 'codex',
      settings: { ...settings(), geminiMcpBridgeEnabled: true },
      status: { provider: 'codex', available: true, version: '1.0.0', appServer: 'started' },
      mcpStatus: { data: [] }
    })

    expect(contract.mcp.state).toBe('available')
    expect(contract.mcp.serverName).toBe('TaskWraith')
    expect(contract.mcp.tools).toContain('write_file')
    expect(contract.mcp.message).toContain('did not expose a live server listing')
  })

  it('marks Claude and Kimi provider-native tools as delegated', () => {
    const claude = buildProviderCapabilityContract({
      provider: 'claude',
      settings: settings(),
      status: { provider: 'claude', available: true, version: '1.0.0' }
    })
    const kimi = buildProviderCapabilityContract({
      provider: 'kimi',
      settings: settings(),
      status: { provider: 'kimi', available: true, version: '1.0.0' }
    })

    expect(claude.tools.shellCommands.state).toBe('delegated')
    expect(claude.approvals.inAppApprovals).toBe(false)
    expect(kimi.tools.fileChanges.state).toBe('delegated')
    expect(kimi.approvals.inAppApprovals).toBe(true)
    expect(kimi.warnings.map((warning) => warning.id)).toContain('kimi-provider-managed-tools')
    // Without an available TaskWraith MCP bridge (no mcpStatus), Claude/Kimi
    // elicit/delegate are unavailable rather than delegated, mirroring how
    // their bridge-backed tooling falls closed.
    expect(claude.tools.elicit.state).toBe('unavailable')
    expect(claude.tools.delegate.state).toBe('unavailable')
    expect(kimi.tools.elicit.state).toBe('unavailable')
    expect(kimi.tools.delegate.state).toBe('unavailable')
  })

  it('marks Claude/Kimi elicit/delegate available once the TaskWraith MCP bridge is up', () => {
    const claude = buildProviderCapabilityContract({
      provider: 'claude',
      settings: settings(),
      status: { provider: 'claude', available: true, version: '1.0.0' },
      mcpStatus: {
        enabled: true,
        available: true,
        serverName: 'TaskWraith',
        tools: ['ask_user_question']
      }
    })

    expect(claude.tools.elicit.state).toBe('available')
    expect(claude.tools.elicit.requiresApproval).toBe(false)
    expect(claude.tools.delegate.state).toBe('gated')
    expect(claude.tools.delegate.policy).toBe('ask')
  })

  it('treats grok/cursor elicit/delegate as provider-delegated', () => {
    const grok = buildProviderCapabilityContract({
      provider: 'grok',
      settings: settings(),
      status: { provider: 'grok', available: true, version: '1.0.0' }
    })

    expect(grok.tools.elicit.state).toBe('delegated')
    expect(grok.tools.elicit.enforcedByTaskWraith).toBe(false)
    expect(grok.tools.delegate.state).toBe('delegated')
    expect(grok.tools.delegate.enforcedByTaskWraith).toBe(false)
  })

  it('marks Cursor and Grok as TaskWraith MCP bridge-backed when the bridge is enabled', () => {
    for (const provider of ['cursor', 'grok'] as const) {
      const contract = buildProviderCapabilityContract({
        provider,
        settings: { ...settings(), geminiMcpBridgeEnabled: true },
        status: { provider, available: true, version: '1.0.0' }
      })

      expect(contract.mcp.state).toBe('available')
      expect(contract.mcp.source).toBe('bridge')
      expect(contract.mcp.tools).toContain('write_file')
      expect(contract.tools.shellCommands.source).toBe('bridge')
      expect(contract.tools.shellCommands.enforcedByTaskWraith).toBe(true)
      expect(contract.tools.fileChanges.source).toBe('bridge')
      expect(contract.tools.fileChanges.enforcedByTaskWraith).toBe(true)
      expect(contract.tools.elicit.state).toBe('available')
      expect(contract.tools.delegate.state).toBe('gated')
    }
  })

  it('reflects a denied subThreadDelegation policy as a blocked delegate row', () => {
    const codex = buildProviderCapabilityContract({
      provider: 'codex',
      settings: {
        ...settings({ ...defaultServices, subThreadDelegation: 'deny' }),
        geminiMcpBridgeEnabled: true
      },
      status: { provider: 'codex', available: true, version: '1.0.0', appServer: 'started' }
    })

    expect(codex.tools.delegate.state).toBe('blocked')
    expect(codex.tools.delegate.policy).toBe('deny')
    // elicit is unaffected by the delegation policy.
    expect(codex.tools.elicit.state).toBe('available')
  })

  it('does not double-count the elicit/delegate rows against the enforcement tally', () => {
    // Roster where delegation was already enforced (subThreadDelegation 'allow').
    // The five functional controls drive the enforced count; promoting
    // elicit/delegate to rows must NOT change that 5-row tally.
    const codex = buildProviderCapabilityContract({
      provider: 'codex',
      settings: {
        ...settings({ ...defaultServices, subThreadDelegation: 'allow' }),
        geminiMcpBridgeEnabled: true
      },
      status: { provider: 'codex', available: true, version: '1.0.0', appServer: 'started' }
    })

    const controlIds = [
      'shellCommands',
      'fileChanges',
      'mcpTools',
      'creativeApps',
      'networkAccess'
    ] as const
    const controlRows = controlIds.map((id) => codex.tools[id])
    const enforcedControls = controlRows.filter((tool) => tool.enforcedByTaskWraith).length

    // Codex: shell+file+creative are TaskWraith-enforced, mcpTools(provider) and
    // networkAccess(allow/none) are not -> 3/5, unchanged by the new rows.
    expect(controlRows.length).toBe(5)
    expect(enforcedControls).toBe(3)
    // delegate is allowed/enforced as a DISPLAY row but lives outside the tally.
    expect(codex.tools.delegate.state).toBe('available')
    expect(codex.tools.delegate.enforcedByTaskWraith).toBe(true)
    expect(controlIds).not.toContain('delegate')
    expect(controlIds).not.toContain('elicit')
  })
})
