import { describe, expect, it } from 'vitest'
import {
  buildDiagnosticsSnapshot,
  buildProductOperationsStatus,
  buildReleaseAutomationStatus,
  createBridgeHealthRecord,
  createProductCrashRecord,
  filterProductCrashRecords,
  serializeDiagnosticsSnapshot
} from './ProductOperations'
import type { AppSettings, ProductCrashRecord } from './store/types'

const baseSettings: AppSettings = {
  activeProvider: 'gemini',
  claudeBinaryPath: '',
  kimiBinaryPath: '',
  storeLocalChatHistory: true,
  storeRawEvents: false,
  storePromptResponseInUsage: false,
  ensembleModeEnabled: true,
  geminiCheckpointingEnabled: false,
  chatContextTurns: 6,
  currency: 'USD',
  kimiSanitiserEnabled: false,
  kimiSanitiserCustomKeywords: '',
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
  reduceTransparency: false,
  reduceMotion: false,
  compactDensity: false,
  showInspector: true,
  inspectorWidth: 380,
  sidebarWidth: 260,
  sidebarOpacity: 100,
  mainPaneOpacity: 100,
  agenticServices: {
    shellCommands: 'workspace',
    fileChanges: 'ask',
    mcpTools: 'ask',
    subThreadDelegation: 'ask',
    networkAccess: 'allow'
  },
  agenticWorkspaceGrants: [],
  autoResumeParentOnSubThreadCompletion: true,
  geminiMcpBridgeEnabled: true,
  codexSandboxFallback: 'ask_rerun',
  updateChannel: 'debug',
  approvalTimeouts: {
    enabled: true,
    perProviderMs: { gemini: 120_000, codex: 30_000, claude: 120_000, kimi: 60_000 },
    mainAuthorityMs: 60_000
  }
}

describe('ProductOperations', () => {
  it('redacts sensitive crash text and diagnostic settings', () => {
    const crash = createProductCrashRecord(
      {
        source: 'main',
        severity: 'error',
        message: `token=${'sk-' + 'exampleSecretValue1234567890'}`,
        stack: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz'
      },
      {
        appVersion: '1.2.3',
        platform: 'darwin',
        arch: 'arm64',
        now: '2026-05-07T10:00:00.000Z'
      }
    )

    expect(crash.message).toContain('[redacted]')
    expect(crash.stack).toContain('[redacted]')
    expect(crash.appVersion).toBe('1.2.3')
  })

  it('filters crashes newest first with source and limit', () => {
    const records: ProductCrashRecord[] = [
      createProductCrashRecord(
        {
          source: 'renderer',
          severity: 'warning',
          message: 'old',
          occurredAt: '2026-05-07T09:00:00.000Z'
        },
        { appVersion: '1', platform: 'darwin', arch: 'arm64' }
      ),
      createProductCrashRecord(
        {
          source: 'main',
          severity: 'error',
          message: 'new',
          occurredAt: '2026-05-07T11:00:00.000Z'
        },
        { appVersion: '1', platform: 'darwin', arch: 'arm64' }
      ),
      createProductCrashRecord(
        {
          source: 'main',
          severity: 'warning',
          message: 'middle',
          occurredAt: '2026-05-07T10:00:00.000Z'
        },
        { appVersion: '1', platform: 'darwin', arch: 'arm64' }
      )
    ]

    const filtered = filterProductCrashRecords(records, { source: 'main', limit: 1 })

    expect(filtered).toHaveLength(1)
    expect(filtered[0].message).toBe('new')
  })

  it('summarizes bridge health for enabled but unavailable TaskWraith MCP bridge', () => {
    const health = createBridgeHealthRecord({
      checkedAt: '2026-05-07T10:00:00.000Z',
      enabled: true,
      installed: true,
      available: false,
      serverName: 'TaskWraith',
      message: 'Installed but disabled.'
    })

    expect(health.status).toBe('warning')
    expect(health.provider).toBe('gemini')
  })

  it('detects hardened release automation from scripts and builder config', () => {
    const status = buildReleaseAutomationStatus({
      updateChannel: 'debug',
      now: '2026-05-07T10:00:00.000Z',
      packageJson: {
        scripts: {
          build: 'npm run typecheck && electron-vite build',
          test: 'vitest run',
          ci: 'npm run typecheck && npm run test && npm run smoke:node-pty',
          'smoke:node-pty': 'node scripts/smoke-node-pty.cjs',
          'smoke:package': 'node scripts/smoke-packaged-electron.cjs',
          'build:unpack':
            'npm run build && electron-builder --dir && node scripts/smoke-packaged-electron.cjs dist',
          'build:mac': 'npm run build && electron-builder --mac',
          'build:mac:notarized':
            'npm run build && electron-builder --mac -c.mac.notarize=true',
          'build:debug:mac':
            'npm run build && electron-builder --dir --config electron-builder.debug.yml',
          'build:debug:mac:notarized':
            'npm run build && electron-builder --dir --config electron-builder.debug.yml -c.mac.notarize=true',
          'build:debug:win':
            'npm run build && electron-builder --win --x64 --dir --config electron-builder.debug.yml',
          'build:win:unpack': 'npm run build && electron-builder --win --x64 --arm64 --dir',
          'build:win': 'npm run build && electron-builder --win --x64 --arm64',
          'build:win:signed': 'node scripts/require-windows-signing-env.cjs && npm run build:win',
          'validate:mac-update-feed': 'node scripts/validate-mac-update-feed.cjs dist',
          'validate:win-update-feed': 'node scripts/validate-win-update-feed.cjs dist'
        }
      },
      builderConfigText:
        'appId: com.chrisizatt.taskwraith\nproductName: TaskWraith Debug\ndirectories:\n  output: dist-debug\nasarUnpack:\n  - resources/**\n  - node_modules/node-pty/**\nafterPack: build/validate-native-modules.cjs\nnpmRebuild: true\npublish:\n  provider: github\n  owner: boggspa\n  repo: TaskWraith\n',
      env: {
        APPLE_KEYCHAIN_PROFILE: 'ExampleNotary',
        CSC_NAME: 'Developer ID Application: Example'
      }
    })

    expect(status.status).toBe('ok')
    expect(status.notarization.configured).toBe(true)
    expect(status.notarization.keychainProfile).toBe('ExampleNotary')
    expect(status.notarization.scriptName).toBe('build:mac:notarized')
    expect(status.nativeModules.configured).toBe(true)
    expect(status.updateDistribution.configured).toBe(true)
    expect(status.updateDistribution.provider).toBe('github')
    expect(status.appId).toBe('com.chrisizatt.taskwraith')
    expect(status.scripts.buildWinSigned).toContain('require-windows-signing-env')
    expect(status.scripts.validateWinUpdateFeed).toContain('validate-win-update-feed')
  })

  it('surfaces incompatible mac update artifacts in release automation diagnostics', () => {
    const status = buildReleaseAutomationStatus({
      updateChannel: 'stable',
      now: '2026-05-07T10:00:00.000Z',
      packageJson: {
        scripts: {
          build: 'npm run typecheck && electron-vite build',
          test: 'vitest run',
          ci: 'npm run typecheck && npm run test',
          'build:unpack': 'electron-builder --dir',
          'smoke:node-pty': 'node scripts/smoke-node-pty.cjs',
          'smoke:package': 'node scripts/smoke-packaged-electron.cjs'
        }
      },
      builderConfigText: '',
      updateArchitecture: {
        platform: 'darwin',
        arch: 'x64',
        artifactName: 'TaskWraith-1.0.73-arm64-mac.zip',
        artifactArch: 'arm64',
        compatible: false,
        reason: 'Incompatible update artifact: host=darwin-x64 artifact=arm64'
      }
    })

    expect(status.status).toBe('error')
    expect(status.architectureCompatibility).toMatchObject({
      status: 'error',
      hostPlatform: 'darwin',
      hostArch: 'x64',
      updateArtifactName: 'TaskWraith-1.0.73-arm64-mac.zip',
      updateArtifactArch: 'arm64',
      updateCompatible: false,
      reason: 'Incompatible update artifact: host=darwin-x64 artifact=arm64'
    })
  })

  it('builds a redacted diagnostics snapshot with product counts', () => {
    const status = buildProductOperationsStatus({
      updateChannel: 'debug',
      appName: 'TaskWraith Debug',
      appVersion: '1.0.0',
      isPackaged: false,
      appPath: '/app',
      userDataPath: '/tmp/taskwraith',
      platform: 'darwin',
      arch: 'arm64',
      osRelease: '25.0.0',
      workspaces: [],
      chats: [],
      runQueue: [
        {
          id: 'job-1',
          runId: 'run-1',
          provider: 'gemini',
          workspacePath: '/workspace',
          status: 'queued',
          source: 'manual',
          priority: 0,
          attempt: 0,
          createdAt: '2026-05-07T10:00:00.000Z',
          updatedAt: '2026-05-07T10:00:00.000Z',
          request: {
            prompt: 'hi',
            selectedModelType: 'flash',
            customModel: '',
            approvalMode: 'default',
            sessionTrust: false,
            imageAttachments: []
          }
        }
      ],
      runRecovery: [],
      approvalLedger: [],
      workspaceChanges: [],
      scheduledTasks: [],
      recentCrashes: [],
      userDataExists: true,
      geminiBridgeStatus: {
        checkedAt: '2026-05-07T10:00:00.000Z',
        enabled: false,
        installed: false,
        available: false,
        serverName: 'TaskWraith'
      },
      packageJson: { scripts: {} },
      builderConfigText: '',
      env: {}
    })
    const snapshot = buildDiagnosticsSnapshot({
      status,
      settings: {
        ...baseSettings,
        codexUsageCredential: {
          encryptedAccessToken: 'secret-token',
          accountId: 'acct'
        }
      },
      workspaces: [],
      runQueue: [],
      runRecovery: [],
      scheduledTasks: [],
      approvalLedger: [],
      workspaceChanges: [],
      recentCrashes: []
    })
    const serialized = serializeDiagnosticsSnapshot(snapshot)

    expect(status.counts.queuedRuns).toBe(1)
    expect(serialized).not.toContain('secret-token')
    expect(serialized).not.toContain('encryptedAccessToken')
  })
})
