import { describe, expect, it } from 'vitest'
import { ProviderPreflightService } from './ProviderPreflightService'
import { defaultProviderDescriptor } from './ProviderAdapters'
import type { ProviderCapabilityContract } from './store/types'

function contract(partial: Partial<ProviderCapabilityContract> = {}): ProviderCapabilityContract {
  return {
    provider: 'codex',
    label: 'Codex',
    refreshedAt: '2026-05-08T00:00:00.000Z',
    availability: { available: true },
    tools: {
      shellCommands: {
        id: 'shellCommands',
        label: 'Shell commands',
        state: 'available',
        source: 'agentbench',
        enforcedByAgentBench: true,
        enforcement: 'agentbench',
        requiresApproval: true,
        tools: ['run_shell_command']
      },
      fileChanges: {
        id: 'fileChanges',
        label: 'File changes',
        state: 'available',
        source: 'agentbench',
        enforcedByAgentBench: true,
        enforcement: 'agentbench',
        requiresApproval: true,
        tools: ['edit_file']
      },
      mcpTools: {
        id: 'mcpTools',
        label: 'MCP and tool calls',
        state: 'available',
        source: 'provider',
        enforcedByAgentBench: false,
        enforcement: 'provider',
        requiresApproval: true,
        tools: []
      },
      creativeApps: {
        id: 'creativeApps',
        label: 'Creative app tools',
        state: 'available',
        source: 'bridge',
        enforcedByAgentBench: true,
        enforcement: 'bridge',
        requiresApproval: true,
        tools: [
          'creative_app_status',
          'creative_app_capabilities',
          'creative_project_snapshot',
          'creative_timeline_validate',
          'creative_timeline_ir',
          'creative_timeline_diff'
        ]
      },
      networkAccess: {
        id: 'networkAccess',
        label: 'Network access',
        state: 'available',
        source: 'settings',
        enforcedByAgentBench: false,
        enforcement: 'none',
        requiresApproval: false,
        tools: []
      }
    },
    approvals: {
      requestedMode: 'default',
      effectiveMode: 'default',
      providerMode: 'default',
      inAppApprovals: true,
      supportsWorkspaceGrants: true,
      notes: []
    },
    mcp: { state: 'available', source: 'provider', available: true, tools: [] },
    warnings: [],
    ...partial
  }
}

describe('ProviderPreflightService', () => {
  const service = new ProviderPreflightService()

  it('marks available providers ready and reports delegated enforcement chips', () => {
    const result = service.evaluate(
      { provider: 'codex', workspacePath: '/repo' },
      contract(),
      defaultProviderDescriptor('codex')
    )

    expect(result.state).toBe('ready')
    expect(result.repairAction).toBe('none')
    expect(result.chips[0].id).toBe('codex-delegated-enforcement')
  })

  it('blocks unavailable providers with a setup repair action', () => {
    const result = service.evaluate(
      { provider: 'claude', workspacePath: '/repo' },
      contract({
        provider: 'claude',
        label: 'Claude',
        availability: { available: false, authState: 'missing', error: 'Claude login required.' }
      }),
      defaultProviderDescriptor('claude')
    )

    expect(result.state).toBe('blocked')
    expect(result.repairAction).toBe('login_provider')
    expect(result.reason).toContain('Claude login required')
  })

  it('blocks enabled unavailable Gemini bridge state fail closed', () => {
    const result = service.evaluate(
      { provider: 'gemini', workspacePath: '/repo' },
      contract({
        provider: 'gemini',
        label: 'Gemini',
        mcp: {
          state: 'unavailable',
          source: 'bridge',
          available: false,
          enabled: true,
          installed: false,
          tools: [],
          message: 'Gemini MCP bridge not installed.'
        }
      }),
      defaultProviderDescriptor('gemini')
    )

    expect(result.state).toBe('blocked')
    expect(result.repairAction).toBe('install_gemini_bridge')
    expect(result.fallbackAvailable).toBe(false)
  })
})
