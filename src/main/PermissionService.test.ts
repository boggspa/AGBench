import { describe, expect, it, vi } from 'vitest'
import { PermissionService } from './PermissionService'
import { RunManager } from './RunManager'
import type { AppSettings } from './store/types'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/agentbench-test'
  }
}))

const settings: AppSettings = {
  activeProvider: 'gemini',
  claudeBinaryPath: '',
  kimiBinaryPath: '',
  storeLocalChatHistory: true,
  storeRawEvents: false,
  storePromptResponseInUsage: false,
  geminiCheckpointingEnabled: false,
  chatContextTurns: 6,
  appearanceMode: 'soft_glass',
  visualEffectStyle: 'auto',
  themeAppearance: 'system',
  themeCornerStyle: 'rounded',
  themeAccentStyle: 'system',
  promptSurfaceStyle: 'liquid_glass',
  composerStyle: 'default',
  funFxEnabled: true,
  funFxMode: 'cinematic',
  advancedFx: {
    agentAura: true,
    livingWorkspace: true,
    dataViz: true,
    intensity: 'cinematic'
  },
  reduceTransparency: false,
  reduceMotion: false,
  compactDensity: false,
  showInspector: true,
  inspectorWidth: 380,
  sidebarWidth: 260,
  agenticServices: {
    shellCommands: 'workspace',
    fileChanges: 'ask',
    mcpTools: 'deny',
    subThreadDelegation: 'ask',
    networkAccess: 'allow'
  },
  agenticWorkspaceGrants: [],
  geminiMcpBridgeEnabled: false,
  codexSandboxFallback: 'ask_rerun',
  updateChannel: 'debug',
  approvalTimeouts: {
    enabled: true,
    perProviderMs: { gemini: 120_000, codex: 30_000, claude: 120_000, kimi: 60_000 },
    mainAuthorityMs: 60_000
  }
}

describe('PermissionService', () => {
  it('resolves workspace and session grants through one authority', () => {
    const runManager = new RunManager()
    runManager.create({ runId: 'run-1', provider: 'gemini', workspacePath: '/repo' })
    const service = new PermissionService({ runManager, sessionGrants: new Set() })

    expect(service.resolvePermission('gemini', 'shellCommands', '/repo', 'run-1', settings).decision).toBe('ask')

    service.addSessionGrant('gemini', '/repo', 'shellCommands', 'run-1')
    expect(service.resolvePermission('gemini', 'shellCommands', '/repo', 'run-1', settings).decision).toBe('allow')

    expect(
      service.resolvePermission('gemini', 'shellCommands', '/repo', undefined, {
        ...settings,
        agenticWorkspaceGrants: [{
          id: 'grant-1',
          provider: 'gemini',
          service: 'shellCommands',
          workspacePath: '/repo',
          createdAt: '2026-05-08T00:00:00.000Z',
          updatedAt: '2026-05-08T00:00:00.000Z'
        }]
      }).decision
    ).toBe('allow')
  })

  it('applies approved actions while keeping declines non-approved', () => {
    const service = new PermissionService({ runManager: new RunManager(), sessionGrants: new Set() })

    expect(service.isApprovedAction('accept')).toBe(true)
    expect(service.isApprovedAction('acceptForSession')).toBe(true)
    expect(service.isApprovedAction('decline')).toBe(false)
    expect(service.isApprovedAction('cancel')).toBe(false)
  })

  it('uses session grants for global approvals without workspace grants', () => {
    const service = new PermissionService({ runManager: new RunManager(), sessionGrants: new Set() })

    expect(service.resolvePermission('codex', 'shellCommands', undefined, undefined, settings).decision).toBe('ask')
    service.applyApprovalDecision({
      provider: 'codex',
      service: 'shellCommands',
      action: 'acceptForSession'
    })

    expect(service.resolvePermission('codex', 'shellCommands', undefined, undefined, settings).decision).toBe('allow')
    expect(service.hasWorkspaceGrant(settings, 'codex', undefined, 'shellCommands')).toBe(false)
  })
})
