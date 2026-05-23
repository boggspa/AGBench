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
  it('does not advertise AgentBench Gemini tools when the MCP bridge is disabled', () => {
    const contract = buildProviderCapabilityContract({
      provider: 'gemini',
      settings: settings(),
      status: { provider: 'gemini', available: true, version: '1.0.0' },
      geminiMcpBridgeStatus: {
        checkedAt: '2026-05-06T00:00:00.000Z',
        enabled: false,
        installed: false,
        available: false,
        serverName: 'AGBench',
        message: 'Bridge disabled'
      }
    })

    expect(contract.tools.shellCommands.state).toBe('unavailable')
    expect(contract.tools.fileChanges.tools).toEqual([])
    expect(contract.mcp.tools).toEqual([])
    expect(contract.warnings.map((warning) => warning.id)).toContain('gemini-bridge-disabled')
  })

  it('advertises Gemini bridge tools with AgentBench approval gates when available', () => {
    const contract = buildProviderCapabilityContract({
      provider: 'gemini',
      settings: settings(),
      status: { provider: 'gemini', available: true, version: '1.0.0' },
      geminiMcpBridgeStatus: {
        checkedAt: '2026-05-06T00:00:00.000Z',
        enabled: true,
        installed: true,
        available: true,
        serverName: 'AGBench'
      }
    })

    expect(contract.tools.shellCommands.state).toBe('gated')
    expect(contract.tools.shellCommands.tools).toEqual(['run_shell_command'])
    expect(contract.tools.fileChanges.tools).toEqual(['write_file', 'replace'])
    expect(contract.tools.creativeApps.tools).toEqual([
      'creative_app_status',
      'creative_app_capabilities',
      'creative_project_snapshot'
    ])
    expect(contract.mcp.tools).toContain('list_directory')
    expect(contract.approvals.inAppApprovals).toBe(true)
  })

  it('honors blocked settings in the Codex tooling contract', () => {
    const contract = buildProviderCapabilityContract({
      provider: 'codex',
      settings: settings({
        ...defaultServices,
        shellCommands: 'deny',
        networkAccess: 'deny'
      }),
      status: { provider: 'codex', available: true, version: '1.0.0', appServer: 'started' },
      mcpStatus: { data: [{ name: 'local', tools: { search: {}, read: {} } }] }
    })

    expect(contract.tools.shellCommands.state).toBe('blocked')
    expect(contract.tools.networkAccess.state).toBe('blocked')
    expect(contract.mcp.tools).toEqual(['read', 'search'])
    expect(contract.warnings.map((warning) => warning.id)).toContain('codex-shellCommands-blocked')
  })

  it('keeps a provider runnable when optional metadata has an error', () => {
    const contract = buildProviderCapabilityContract({
      provider: 'codex',
      settings: settings(),
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
  })
})
