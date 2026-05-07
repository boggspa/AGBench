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
  geminiCheckpointingEnabled: false,
  chatContextTurns: 6,
  appearanceMode: 'soft_glass',
  visualEffectStyle: 'auto',
  themeAppearance: 'system',
  themeCornerStyle: 'rounded',
  themeAccentStyle: 'system',
  promptSurfaceStyle: 'liquid_glass',
  reduceTransparency: false,
  reduceMotion: false,
  compactDensity: false,
  showInspector: true,
  inspectorWidth: 380,
  sidebarWidth: 260,
  agenticServices: {
    shellCommands: 'workspace',
    fileChanges: 'ask',
    mcpTools: 'ask',
    networkAccess: 'allow'
  },
  agenticWorkspaceGrants: [],
  geminiMcpBridgeEnabled: true,
  codexSandboxFallback: 'ask_rerun',
  updateChannel: 'debug'
}

describe('ProductOperations', () => {
  it('redacts sensitive crash text and diagnostic settings', () => {
    const crash = createProductCrashRecord(
      {
        source: 'main',
        severity: 'error',
        message: 'token=sk-exampleSecretValue1234567890',
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

  it('summarizes bridge health for enabled but unavailable Gemini MCP bridge', () => {
    const health = createBridgeHealthRecord({
      checkedAt: '2026-05-07T10:00:00.000Z',
      enabled: true,
      installed: true,
      available: false,
      serverName: 'agentbench',
      message: 'Installed but disabled.'
    })

    expect(health.status).toBe('warning')
    expect(health.provider).toBe('gemini')
  })

  it('detects notarized debug release automation from scripts and builder config', () => {
    const status = buildReleaseAutomationStatus({
      updateChannel: 'debug',
      now: '2026-05-07T10:00:00.000Z',
      packageJson: {
        scripts: {
          build: 'npm run typecheck && electron-vite build',
          'build:debug:mac':
            'npm run build && CSC_NAME=${CSC_NAME:-ABC} electron-builder --dir --config electron-builder.debug.yml',
          'build:debug:mac:notarized':
            'npm run build && CSC_NAME=${CSC_NAME:-ABC} APPLE_KEYCHAIN_PROFILE=${APPLE_KEYCHAIN_PROFILE:-<your-notary-profile>} electron-builder --dir --config electron-builder.debug.yml -c.mac.notarize=true'
        }
      },
      builderConfigText:
        'appId: com.chrisizatt.agentbench\nproductName: AgentBench Debug\ndirectories:\n  output: dist-debug\n',
      env: {}
    })

    expect(status.status).toBe('ok')
    expect(status.notarization.configured).toBe(true)
    expect(status.notarization.keychainProfile).toBe('<your-notary-profile>')
    expect(status.appId).toBe('com.chrisizatt.agentbench')
  })

  it('builds a redacted diagnostics snapshot with product counts', () => {
    const status = buildProductOperationsStatus({
      updateChannel: 'debug',
      appName: 'AgentBench Debug',
      appVersion: '1.0.0',
      isPackaged: false,
      appPath: '/app',
      userDataPath: '/tmp/agentbench',
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
        serverName: 'agentbench'
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
