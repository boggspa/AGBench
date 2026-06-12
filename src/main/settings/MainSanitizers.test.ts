import { describe, expect, it } from 'vitest'
import { createMainSanitizers } from './MainSanitizers'
import type { AppSettings, ExternalPathGrant, WorkspaceRecord } from '../store/types'

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    activeProvider: 'gemini',
    storeLocalChatHistory: true,
    storeRawEvents: false,
    storePromptResponseInUsage: false,
    ensembleModeEnabled: true,
    geminiCheckpointingEnabled: false,
    chatContextTurns: 6,
    appearanceMode: 'soft_glass',
    visualEffectStyle: 'auto',
    themeAppearance: 'system',
    themeCornerStyle: 'rounded',
    themeAccentStyle: 'system',
    toolIconAccent: 'system',
    userBubbleColor: 'system',
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
    currency: 'USD',
    currencyOverestimatePercent: 0,
    welcomeHeatmapPrefs: {
      workspaceActivityEnabled: true,
      taskwraithActivityEnabled: true,
      externalActivityEnabled: true
    },
    kimiSanitiserEnabled: false,
    kimiSanitiserCustomKeywords: '',
    reduceTransparency: false,
    reduceMotion: false,
    compactDensity: false,
    liveActivityViewport: true,
    showInspector: true,
    inspectorWidth: 380,
    sidebarWidth: 260,
    agenticServices: {
      shellCommands: 'workspace',
      fileChanges: 'ask',
      mcpTools: 'ask',
      subThreadDelegation: 'ask',
      networkAccess: 'allow'
    },
    agenticWorkspaceGrants: [],
    nativeSubAgentRequests: 'ask',
    autoResumeParentOnSubThreadCompletion: true,
    geminiMcpBridgeEnabled: false,
    bridgeDaemonEnabled: true,
    codexSandboxFallback: 'ask_rerun',
    updateChannel: 'debug',
    approvalTimeouts: {
      enabled: true,
      perProviderMs: {
        gemini: 120_000,
        codex: 30_000,
        claude: 120_000,
        kimi: 60_000
      },
      mainAuthorityMs: 60_000
    },
    ...overrides
  } as AppSettings
}

function makeSanitizers(settings: AppSettings) {
  return createMainSanitizers({
    getSettings: () => settings,
    getScheduledTasks: () => [],
    getWorkflowDefinitions: () => [],
    findRegisteredWorkspace: () => undefined as WorkspaceRecord | undefined,
    requireRegisteredWorkspace: (workspacePath: string) => workspacePath,
    canonicalPath: (value: string) => value,
    normalizeExternalPathGrants: (grants: ExternalPathGrant[]) => grants
  })
}

describe('MainSanitizers settings patches', () => {
  it('preserves General dashboard, heatmap, and approval timeout preferences', () => {
    const settings = makeSettings({
      dashboardStatPrefs: {
        visibility: {
          sessions: false
        },
        workspacesShown: 8
      },
      welcomeHeatmapPrefs: {
        layout: 'stacked',
        workspaceActivityEnabled: true,
        taskwraithActivityEnabled: true,
        externalActivityEnabled: true
      }
    })
    const { sanitizeSettingsPatch } = makeSanitizers(settings)

    const sanitized = sanitizeSettingsPatch({
      dashboardStatPrefs: {
        dashboardEnabled: false,
        dashboardSize: 'small'
      },
      welcomeHeatmapPrefs: {
        layout: 'single',
        workspaceActivityEnabled: false
      },
      approvalTimeouts: {
        enabled: false,
        perProviderMs: {
          gemini: 240_000
        },
        mainAuthorityMs: 0
      }
    })

    expect(sanitized.dashboardStatPrefs).toMatchObject({
      dashboardEnabled: false,
      dashboardSize: 'small',
      visibility: {
        sessions: false
      },
      workspacesShown: 8
    })
    expect(sanitized.welcomeHeatmapPrefs).toMatchObject({
      layout: 'single',
      workspaceActivityEnabled: false,
      taskwraithActivityEnabled: true,
      externalActivityEnabled: true
    })
    expect(sanitized.approvalTimeouts).toMatchObject({
      enabled: false,
      perProviderMs: {
        gemini: 240_000,
        codex: 30_000,
        claude: 120_000,
        kimi: 60_000
      },
      mainAuthorityMs: 60_000
    })
  })

  it('sanitizes the local-servers lifecycle toggles', () => {
    const settings = makeSettings()
    const { sanitizeSettingsPatch } = makeSanitizers(settings)
    const sanitized = sanitizeSettingsPatch({
      localServersDetachSpawns: true,
      localServersStopOnQuit: true
    })
    expect(sanitized.localServersDetachSpawns).toBe(true)
    expect(sanitized.localServersStopOnQuit).toBe(true)
    // Non-booleans coerce to real booleans.
    const coerced = sanitizeSettingsPatch({
      localServersDetachSpawns: 1 as unknown as boolean,
      localServersStopOnQuit: 0 as unknown as boolean
    })
    expect(coerced.localServersDetachSpawns).toBe(true)
    expect(coerced.localServersStopOnQuit).toBe(false)
  })

  it('sanitizes changelog persistence settings', () => {
    const settings = makeSettings()
    const { sanitizeSettingsPatch } = makeSanitizers(settings)

    const sanitized = sanitizeSettingsPatch({
      lastSeenChangelogVersion: ' 1.0.73 ',
      pendingUpdateChangelog: {
        version: ' 1.0.74 ',
        releaseName: ' TaskWraith 1.0.74 ',
        releaseDate: ' 2026-06-04T13:00:00.000Z ',
        releaseNotes: [
          { version: ' 1.0.74 ', note: 'Updater pill.' },
          { version: '', note: 'ignored' }
        ]
      }
    })

    expect(sanitized).toMatchObject({
      lastSeenChangelogVersion: '1.0.73',
      pendingUpdateChangelog: {
        version: '1.0.74',
        releaseName: 'TaskWraith 1.0.74',
        releaseDate: '2026-06-04T13:00:00.000Z',
        releaseNotes: [{ version: '1.0.74', note: 'Updater pill.' }]
      }
    })
  })

  it('requires explicit booleans for iMessage scheduled polling', () => {
    const settings = makeSettings({
      messageBridgeEnabled: false,
      messageBridgePollIntervalMs: 30_000
    })
    const { sanitizeSettingsPatch } = makeSanitizers(settings)

    expect(
      sanitizeSettingsPatch({
        messageBridgeEnabled: true,
        messageBridgePollIntervalMs: 250
      })
    ).toMatchObject({
      messageBridgeEnabled: true,
      messageBridgePollIntervalMs: 5_000
    })
    expect(
      sanitizeSettingsPatch({
        messageBridgeEnabled: 'false'
      })
    ).toMatchObject({
      messageBridgeEnabled: false
    })
  })

  it('sanitizes Ollama tool-control tiers and gates provider parity on acknowledgement', () => {
    const settings = makeSettings()
    const { sanitizeSettingsPatch } = makeSanitizers(settings)

    expect(
      sanitizeSettingsPatch({
        ollamaToolControlTier: 'approved_shell'
      })
    ).toMatchObject({
      ollamaToolControlTier: 'approved_shell'
    })

    expect(
      sanitizeSettingsPatch({
        ollamaToolControlTier: 'bad-tier'
      })
    ).not.toHaveProperty('ollamaToolControlTier')

    expect(
      sanitizeSettingsPatch({
        ollamaToolControlTier: 'provider_parity'
      })
    ).not.toHaveProperty('ollamaToolControlTier')

    expect(
      sanitizeSettingsPatch({
        ollamaToolControlTier: 'provider_parity',
        ollamaProviderParityAcknowledgedAt: ' 2026-06-08T12:00:00.000Z ',
        ollamaProviderParityWorkspaceGrants: {
          ' /tmp/project ': ' 2026-06-08T12:01:00.000Z ',
          ' ': 'ignored',
          '/tmp/empty': ''
        }
      })
    ).toMatchObject({
      ollamaToolControlTier: 'provider_parity',
      ollamaProviderParityAcknowledgedAt: '2026-06-08T12:00:00.000Z',
      ollamaProviderParityWorkspaceGrants: {
        '/tmp/project': '2026-06-08T12:01:00.000Z'
      }
    })
  })

  it('allows Ollama provider parity when a previous acknowledgement exists', () => {
    const settings = makeSettings({
      ollamaProviderParityAcknowledgedAt: '2026-06-08T12:00:00.000Z'
    })
    const { sanitizeSettingsPatch } = makeSanitizers(settings)

    expect(
      sanitizeSettingsPatch({
        ollamaToolControlTier: 'provider_parity'
      })
    ).toMatchObject({
      ollamaToolControlTier: 'provider_parity',
      ollamaProviderParityAcknowledgedAt: '2026-06-08T12:00:00.000Z'
    })
  })

  it('sanitizes Ollama run profile settings', () => {
    const settings = makeSettings()
    const { sanitizeSettingsPatch } = makeSanitizers(settings)

    expect(
      sanitizeSettingsPatch({
        ollamaDefaultRunProfile: 'verify_with_shell',
        ollamaRunProfiles: {
          default: { reasoningLevel: 'high' }
        }
      })
    ).toMatchObject({
      ollamaDefaultRunProfile: 'verify_with_shell',
      ollamaRunProfiles: {
        default: { reasoningLevel: 'high' }
      }
    })

    expect(
      sanitizeSettingsPatch({
        ollamaDefaultRunProfile: 'bad-profile',
        ollamaRunProfiles: 'bad'
      })
    ).toMatchObject({
      ollamaRunProfiles: {}
    })
  })

  it('preserves current iMessage polling state for malformed enablement patches', () => {
    const settings = makeSettings({
      messageBridgeEnabled: true,
      messageBridgePollIntervalMs: 30_000
    })
    const { sanitizeSettingsPatch } = makeSanitizers(settings)

    expect(
      sanitizeSettingsPatch({
        messageBridgeEnabled: ''
      })
    ).toMatchObject({
      messageBridgeEnabled: true
    })
  })
})
