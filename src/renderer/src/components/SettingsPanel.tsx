import React, { useEffect, useState } from 'react'
import type {
  AgenticNetworkPolicy,
  AgenticServiceId,
  AgenticServicePolicy,
  AgenticServicesSettings,
  AgenticWorkspaceGrant,
  AppearanceMode,
  CodexSandboxFallbackMode,
  AppSettings,
  GeminiApiRuntimeMode,
  GeminiMcpBridgeStatus,
  GeminiAuthStatus,
  GeminiAuthProfileSummary,
  ProviderApiKeyStatus,
  ProviderCapabilityContract,
  ProviderId,
  ProductOperationsStatus,
  ProductUpdateChannel,
  PromptSurfaceStyle,
  ComposerStyle,
  ThemeAccentStyle,
  ThemeAppearance,
  ThemeCornerStyle,
  ToolIconAccent,
  VisualEffectStyle,
  WorkspaceRecord
} from '../../../main/store/types'
import { resolveGeminiRuntimeStatus } from '../lib/GeminiRuntimeStatus'
import {
  summariseCodexStatus,
  summariseGeminiStatus,
  summariseProviderApiKeyStatus,
  type ProviderAuthSummary
} from '../lib/providerAuthSummary'
import {
  COMPOSER_FONT_MATCH_TRANSCRIPT,
  COMPOSER_FONT_OPTIONS,
  CUSTOM_FONT_FALLBACK,
  CUSTOM_FONT_SELECT_VALUE,
  FONT_STACKS,
  TRANSCRIPT_FONT_OPTIONS,
  getFontSelectValue,
  quoteInstalledFontFamily,
  resolveComposerFontFamily,
  type TypefaceOption
} from '../lib/typefaceOptions'
// RemoteWorkspacesPanel was previously rendered here under the
// `remote-workspaces` tab. It now lives inside `PairingPage` (the
// "Devices" tab) so paired-device QR + workspace allowlist sit
// together as a single device-management page.
import { ApprovalLedgerPanel } from './ApprovalLedgerPanel'
// BridgeNetworkingPanel + ApnsConfigPanel were previously rendered
// under the "Bridge Networking" tab. They now live inside `PairingPage`
// (the "Devices" tab) so the iOS pair flow + workspace allowlist +
// daemon/APNs configuration sit together as a single device-management
// page. The original tab branch below is kept defensively so a stale
// `bridge-networking` tab id falls through to no render.
import { PairingPage } from './PairingPage'
import { UpdateStatusPane } from './UpdateStatusPane'
import { ModelUsageCard } from './ModelUsageCard'
import { ProviderLogoTile } from './ProviderLogoTile'
import type { ModelUsageAggregate } from '../App'

interface SettingsPanelProps {
  mode: AppearanceMode
  visualEffectStyle: VisualEffectStyle
  themeAppearance: ThemeAppearance
  themeCornerStyle: ThemeCornerStyle
  themeAccentStyle: ThemeAccentStyle
  toolIconAccent: ToolIconAccent
  promptSurfaceStyle: PromptSurfaceStyle
  composerStyle: ComposerStyle
  transcriptFontFamily: string
  composerFontFamily: string
  reduceTransparency: boolean
  reduceMotion: boolean
  compactDensity: boolean
  geminiCheckpointingEnabled: boolean
  /** Phase M1 — Gemini API vs CLI runtime selection. `'auto'` is the
   * default (use API when an API key is configured, else CLI). See
   * {@link GeminiApiRuntimeMode} in store/types.ts. */
  geminiApiRuntime: GeminiApiRuntimeMode
  chatContextTurns: number
  claudeBinaryPath: string
  kimiBinaryPath: string
  agenticServices: AgenticServicesSettings
  /** When true (default), AGBench auto-dispatches a continuation run
   * on the parent chat once a sub-thread the parent delegated to (with
   * `returnResultToParent: true`) finishes. See AutoResumeParent.ts. */
  autoResumeParentOnSubThreadCompletion: boolean
  agenticWorkspaceGrantCount: number
  agenticWorkspaceGrants: AgenticWorkspaceGrant[]
  activeProvider: ProviderId
  providerCapabilities?: ProviderCapabilityContract | null
  geminiMcpBridgeEnabled: boolean
  geminiMcpBridgeStatus: GeminiMcpBridgeStatus | null
  codexSandboxFallback: CodexSandboxFallbackMode
  funFxEnabled: boolean
  funFxMode: AppSettings['funFxMode']
  advancedFx: AppSettings['advancedFx']
  updateChannel: ProductUpdateChannel
  approvalTimeouts: AppSettings['approvalTimeouts']
  productOperationsStatus: ProductOperationsStatus | null
  geminiAuthStatus?: GeminiAuthStatus | null
  geminiAuthProfiles?: GeminiAuthProfileSummary[]
  codexStatus?: any
  claudeAuthStatus?: ProviderApiKeyStatus | null
  kimiAuthStatus?: ProviderApiKeyStatus | null
  claudeLoginState?: 'idle' | 'loading' | 'success' | 'error'
  onImportCodexUsageCredential?: () => void
  onClearCodexUsageCredential?: () => void
  onTriggerClaudeLogin?: () => void
  onStoreClaudeApiKey?: (key: string) => void
  onClearClaudeApiKey?: () => void
  onStoreKimiApiKey?: (key: string) => void
  onClearKimiApiKey?: () => void
  onSaveGeminiAuthProfile?: (profile: {
    id?: string
    label?: string
    kind: 'api-key' | 'vertex-ai' | 'google-oauth'
    apiKey?: string
    vertexProject?: string
    vertexLocation?: string
    makeDefault?: boolean
  }) => void
  onStartGeminiOAuthLogin?: (input: {
    profileId?: string
    label?: string
    makeDefault?: boolean
  }) => void
  onCancelGeminiOAuthLogin?: (profileId?: string | null) => void
  onSetDefaultGeminiAuthProfile?: (profileId: string | null) => void
  onDeleteGeminiAuthProfile?: (profileId: string) => void
  onRemoveAgenticWorkspaceGrant?: (
    provider: ProviderId,
    workspacePath: string,
    service: AgenticServiceId
  ) => Promise<void> | void
  onInstallGeminiMcpBridge: () => void
  onRefreshGeminiMcpBridgeStatus: () => void
  onRefreshProductOperationsStatus: () => void
  onExportProductDiagnostics: () => void
  onRepairProductInstall: () => void
  onChange: (partial: {
    mode?: AppearanceMode
    visualEffectStyle?: VisualEffectStyle
    themeAppearance?: ThemeAppearance
    themeCornerStyle?: ThemeCornerStyle
    themeAccentStyle?: ThemeAccentStyle
    toolIconAccent?: ToolIconAccent
    promptSurfaceStyle?: PromptSurfaceStyle
    composerStyle?: ComposerStyle
    transcriptFontFamily?: string
    composerFontFamily?: string
    reduceTransparency?: boolean
    reduceMotion?: boolean
    compactDensity?: boolean
    geminiCheckpointingEnabled?: boolean
    geminiApiRuntime?: GeminiApiRuntimeMode
    chatContextTurns?: number
    claudeBinaryPath?: string
    kimiBinaryPath?: string
    agenticServices?: AgenticServicesSettings
    autoResumeParentOnSubThreadCompletion?: boolean
    geminiMcpBridgeEnabled?: boolean
    codexSandboxFallback?: CodexSandboxFallbackMode
    funFxEnabled?: boolean
    funFxMode?: AppSettings['funFxMode']
    advancedFx?: AppSettings['advancedFx']
    updateChannel?: ProductUpdateChannel
    approvalTimeouts?: AppSettings['approvalTimeouts']
  }) => void
  onClose: () => void
  /**
   * Optional controlled tab state. When `activeTab` + `onTabChange`
   * are both provided, the panel renders the content for the
   * caller's chosen tab and routes user clicks through `onTabChange`.
   * Without them the panel keeps its own internal state (back-compat
   * for the legacy sheet form-factor and unit-test mounts).
   */
  activeTab?: SettingsTab
  onTabChange?: (tab: SettingsTab) => void
  /**
   * Workspace-management hooks. Used by the new "Workspaces" tab
   * (Codex-Environments-style list of loaded workspaces with open /
   * pin / remove actions). Optional so any host that doesn't yet
   * surface the tab can leave them unset — the tab content just
   * renders an empty-state in that case.
   */
  workspaces?: WorkspaceRecord[]
  currentWorkspace?: WorkspaceRecord | null
  onSelectWorkspace?: (workspace: WorkspaceRecord) => void
  onSelectWorkspaceDialog?: () => void
  onRemoveWorkspace?: (workspaceId: string) => void
  onTogglePinWorkspace?: (workspaceId: string) => void
  /**
   * Cross-provider usage aggregate. Populated by App's
   * `refreshUsageSummary` from the `getUsage` IPC. Renders the new
   * "Model usage" tab via the existing `ModelUsageCard` plus a
   * headline-tiles strip above it. Optional so test mounts can omit.
   */
  usageSummary?: ModelUsageAggregate[]
  /**
   * Layout shape. `'sheet'` (default) renders the inline tab bar +
   * "Done" button at the top — the historic modal-sheet treatment.
   * `'takeover'` suppresses that header entirely because the host
   * (App.tsx) renders a `SettingsSidebar` next to the panel that
   * carries the tab list and the back-to-app affordance instead.
   */
  layout?: 'sheet' | 'takeover'
}

const CONTEXT_TURN_OPTIONS = [0, 2, 4, 6, 8, 10, 12, 16, 20]
const VISUAL_EFFECT_OPTIONS: Array<{ value: VisualEffectStyle; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'liquid_glass', label: 'LiquidGlass' },
  { value: 'thin_material', label: 'ultraThinMaterial' },
  { value: 'classic', label: 'PoorMansGlassBackground' }
]
const THEME_OPTIONS: Array<{ value: ThemeAppearance; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'midnight', label: 'Midnight' },
  { value: 'blue', label: 'Blue' },
  { value: 'purple', label: 'Purple' },
  { value: 'pink', label: 'Pink' },
  { value: 'red', label: 'Red' },
  { value: 'orange', label: 'Orange' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'green', label: 'Green' },
  { value: 'graphite', label: 'Graphite' },
  { value: 'rainbow', label: 'Rainbow' },
  { value: 'nebula', label: 'Nebula' },
  { value: 'citrus', label: 'Citrus' },
  { value: 'twilight', label: 'Twilight' },
  { value: 'ocean', label: 'Ocean' },
  { value: 'sunset', label: 'Sunset' },
  { value: 'forest', label: 'Forest' },
  { value: 'cyber', label: 'Cyber' },
  { value: 'candy', label: 'Candy' },
  { value: 'mist', label: 'Mist' },
  { value: 'sage', label: 'Sage' }
]
const ACCENT_OPTIONS: Array<{ value: ThemeAccentStyle; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'blue', label: 'Blue' },
  { value: 'purple', label: 'Purple' },
  { value: 'pink', label: 'Pink' },
  { value: 'orange', label: 'Orange' },
  { value: 'green', label: 'Green' },
  { value: 'red', label: 'Red' },
  { value: 'yellow', label: 'Yellow' }
]
/**
 * Tool-icon accent. `system` (default) keeps the icons on the
 * theme accent. The four named overrides pin the icons to a
 * dedicated colour while leaving the rest of the UI on the
 * user's accent choice — useful for tester debug or for users
 * who want the tool-call ledger to read as a distinct surface.
 */
const TOOL_ICON_ACCENT_OPTIONS: Array<{ value: ToolIconAccent; label: string }> = [
  { value: 'system', label: 'Match accent' },
  { value: 'red', label: 'Red' },
  { value: 'amber', label: 'Amber' },
  { value: 'cyan', label: 'Cyan' },
  { value: 'violet', label: 'Violet' }
]
const PROMPT_SURFACE_OPTIONS: Array<{ value: PromptSurfaceStyle; label: string }> = [
  { value: 'theme', label: 'Follow theme' },
  { value: 'liquid_glass', label: 'Liquid glass' },
  { value: 'classic', label: 'Poor man glass' },
  { value: 'solid', label: 'Solid' }
]
const COMPOSER_STYLE_OPTIONS: Array<{ value: ComposerStyle; label: string; helper: string }> = [
  {
    value: 'default',
    label: 'AGBench native',
    helper: 'Provider chrome off; keep the existing AGBench shell.'
  },
  {
    value: 'codex',
    label: 'Codex shell',
    helper: 'Codex-like sidebar, transcript, status bar, and composer hierarchy.'
  },
  {
    value: 'claude',
    label: 'Claude shell',
    helper: 'Claude-like sidebar, transcript, status bar, and composer hierarchy.'
  },
  {
    value: 'gemini',
    label: 'Gemini shell',
    helper: 'Gemini-like minimal pill composer, centered welcome, blue focus glow.'
  },
  {
    value: 'kimi',
    label: 'Kimi shell',
    helper: 'Kimi-like dark rounded composer, green-yellow accent, minimal sidebar.'
  },
  {
    value: 'modular',
    label: 'Modular',
    helper: 'Each composer element floats as its own pill — no grouped container.'
  },
  {
    value: 'terminal',
    label: 'Terminal',
    helper: 'Monospace command-line aesthetic with bracketed chips and a caret prompt.'
  },
  {
    value: 'stub',
    label: 'Ticket stub',
    helper: 'Paper-textured composer with a perforated separator above the textarea.'
  },
  {
    value: 'satellite',
    label: 'Satellite',
    helper: 'All containers invisible — every element floats freely on the page.'
  }
]

function getComposerPreviewMeta(style: ComposerStyle): {
  providerLabel: string
  modelLabel: string
  permissionLabel: string
  placeholder: string
} {
  switch (style) {
    case 'codex':
      return {
        providerLabel: 'Codex',
        modelLabel: 'GPT-5.5',
        permissionLabel: 'Full Workspace Access',
        placeholder: 'Ask Codex anything. @ to use plugins or mention files'
      }
    case 'claude':
      return {
        providerLabel: 'Claude',
        modelLabel: 'Opus 4.7',
        permissionLabel: 'Plan / Read-only',
        placeholder: 'Describe a task or ask a question'
      }
    case 'gemini':
      return {
        providerLabel: 'Gemini',
        modelLabel: 'Pro 3.1',
        permissionLabel: 'Default Approval',
        placeholder: 'Ask Gemini'
      }
    case 'kimi':
      return {
        providerLabel: 'Kimi',
        modelLabel: 'K2 Thinking',
        permissionLabel: 'Read workspace',
        placeholder: 'Type "/" to quickly access skills'
      }
    case 'terminal':
      return {
        providerLabel: 'Terminal',
        modelLabel: 'Shell',
        permissionLabel: 'Ask before tools',
        placeholder: 'run task --describe'
      }
    default:
      return {
        providerLabel: 'AGBench',
        modelLabel: 'Auto',
        permissionLabel: 'Default Approval',
        placeholder: 'Ask anything...'
      }
  }
}
const AGENTIC_SERVICE_POLICY_OPTIONS: Array<{ value: AgenticServicePolicy; label: string }> = [
  { value: 'workspace', label: 'Ask, then allow workspace' },
  { value: 'ask', label: 'Ask every time' },
  { value: 'allow', label: 'Always allow' },
  { value: 'deny', label: 'Block' }
]
const NETWORK_POLICY_OPTIONS: Array<{ value: AgenticNetworkPolicy; label: string }> = [
  { value: 'allow', label: 'Allow' },
  { value: 'deny', label: 'Block' }
]
const CODEX_SANDBOX_FALLBACK_OPTIONS: Array<{ value: CodexSandboxFallbackMode; label: string }> = [
  { value: 'ask_rerun', label: 'Ask to rerun outside sandbox' },
  { value: 'off', label: 'Off' }
]
const PRODUCT_UPDATE_CHANNEL_OPTIONS: Array<{ value: ProductUpdateChannel; label: string }> = [
  { value: 'debug', label: 'Debug' },
  { value: 'stable', label: 'Stable' },
  { value: 'nightly', label: 'Nightly' }
]
// Phase M1 Step 6 — three-way runtime picker. `helper` is shown inline
// in the radio label so the user can read the per-mode semantics without
// hovering or expanding any disclosure.
const GEMINI_API_RUNTIME_OPTIONS: Array<{
  value: GeminiApiRuntimeMode
  label: string
  helper: string
}> = [
  {
    value: 'auto',
    label: 'Auto',
    helper: 'Use the API when an API key is configured, else CLI.'
  },
  {
    value: 'always',
    label: 'Always API',
    helper: 'Require the in-process API path (fails if no API key).'
  },
  {
    value: 'never',
    label: 'Always CLI',
    helper: 'Force the legacy CLI path.'
  }
]
const FUN_FX_MODES: Array<{ value: AppSettings['funFxMode']; label: string; helper: string }> = [
  { value: 'off', label: 'Off', helper: 'No cinematic effects.' },
  { value: 'subtle', label: 'Subtle', helper: 'One effect layer with gentle motion.' },
  { value: 'cinematic', label: 'Cinematic', helper: 'Sky + ghost in synchronized balance.' },
  { value: 'epic', label: 'Epic', helper: 'Adds additional ambient scene accents.' }
]

export type SettingsTab =
  | 'appearance'
  | 'behavior'
  | 'providers'
  | 'system'
  | 'remote-workspaces'
  | 'approval-ledger'
  | 'bridge-networking'
  | 'pairing'
  | 'workspaces'
  | 'model-usage'

/**
 * Tab grouping discriminator. The settings sidebar renders a visual
 * divider between groups so user-facing categories stay distinct.
 * "settings" — the canonical app-configuration tabs (Appearance,
 * Behavior, ...).
 * "devices" — pairing / device-management pages, anchored at the
 * bottom of the sidebar.
 */
export type SettingsTabGroup = 'settings' | 'devices'

/**
 * Canonical settings-tab list. Exported so `SettingsSidebar` (used in
 * full-app takeover layout) can render the same list of tabs as the
 * inline tab bar inside this panel — keeping both render sites in
 * lockstep when tabs are added / renamed.
 *
 * Order matters: the sidebar renders tabs in this order and inserts
 * a divider whenever the `group` field changes from the previous
 * tab. The Pairing tab sits at the end under the "devices" group so
 * Chris's screenshot pattern reads correctly: settings tabs on top,
 * pairing pinned to the bottom with a visual gap.
 */
export const SETTINGS_TABS: Array<{
  id: SettingsTab
  label: string
  group: SettingsTabGroup
}> = [
  { id: 'appearance', label: 'Appearance', group: 'settings' },
  // "General" merges the legacy "Behavior" + "System" tabs. Both
  // covered operational defaults (chat behaviour, approval timeouts,
  // product update channel, diagnostics) — splitting them across two
  // tabs was always arbitrary. The `behavior` id is preserved so any
  // existing tab-restore path still lands here; `system` falls
  // through to no render (defensive guard until the type union sheds
  // the id).
  { id: 'behavior', label: 'General', group: 'settings' },
  // "Workspaces" — Codex Environments-style page that lists every
  // workspace the user has loaded into AGBench. Clicking a row opens
  // that workspace in a fresh chat surface (closes Settings on the
  // way out). The chat sidebar's workspace tree is still the primary
  // surface for active use; this tab is the project-wide manage-and-
  // re-open page.
  { id: 'workspaces', label: 'Workspaces', group: 'settings' },
  { id: 'providers', label: 'Providers', group: 'settings' },
  // "Model usage" — richer cross-provider usage page. Reuses the
  // sidebar's ModelUsageCard (quota meters per provider + 30-day
  // heatmap) with extra context tiles on top (cumulative tokens,
  // run counts, cost estimates). Sister to the welcome dashboard
  // but available without leaving Settings.
  { id: 'model-usage', label: 'Model usage', group: 'settings' },
  { id: 'approval-ledger', label: 'Approvals', group: 'settings' },
  // "Devices" merges the legacy "Pairing" + "Remote Workspaces" +
  // "Bridge Networking" tabs into one device-management page. Pair a
  // fresh iPhone / iPad at the top, manage its workspace allowlist
  // in the middle, configure the daemon + APNs at the bottom — all
  // the same conceptual workflow (LAN / off-LAN reach to paired iOS
  // devices). The `pairing` id is preserved for settings-tab restore.
  { id: 'pairing', label: 'Devices', group: 'devices' }
]

type LocalFontData = {
  family?: string
  fullName?: string
  postscriptName?: string
}

type LocalFontWindow = Window & {
  queryLocalFonts?: () => Promise<LocalFontData[]>
}

// Phase M1 Step 6 — exported so the renderer unit test can mount the
// runtime picker in isolation (the full SettingsPanel is too large to
// instantiate from a test fixture). Kept as a small presentational
// component: it does NOT touch IPC or settings persistence directly;
// the parent panel converts `onSelect` into a regular settings change
// dispatch.
export interface GeminiRuntimePickerProps {
  value: GeminiApiRuntimeMode
  profiles: GeminiAuthProfileSummary[] | undefined
  activeProfileId: string | null
  onSelect: (mode: GeminiApiRuntimeMode) => void
}

export function GeminiRuntimePicker({
  value,
  profiles,
  activeProfileId,
  onSelect
}: GeminiRuntimePickerProps): React.JSX.Element {
  const status = resolveGeminiRuntimeStatus({ mode: value, profiles, activeProfileId })
  const statusColor =
    status.kind === 'api'
      ? 'var(--color-success, #3fb950)'
      : status.kind === 'api-misconfigured'
        ? 'var(--color-warning, #d29922)'
        : 'var(--text-secondary)'
  const activeOption = GEMINI_API_RUNTIME_OPTIONS.find((option) => option.value === value)
  return (
    <div className="settings-service-row" style={{ alignItems: 'flex-start' }}>
      <span>
        Gemini runtime
        <small>
          The Gemini CLI is being deprecated in ~30 days. The API path runs in-process and supports
          the full MCP tool surface — recommended for new chats. The CLI path stays available for
          OAuth profiles until a follow-up.
        </small>
      </span>
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', minWidth: 0 }}
      >
        <div
          className="settings-option-list settings-option-list-inline"
          role="radiogroup"
          aria-label="Gemini runtime"
        >
          {GEMINI_API_RUNTIME_OPTIONS.map((option) => {
            const checked = value === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={checked}
                title={option.helper}
                data-testid={`gemini-runtime-option-${option.value}`}
                className={`settings-radio-option ${checked ? 'active' : ''}`}
                onClick={() => onSelect(option.value)}
              >
                <span className="settings-radio-dot" />
                <span>{option.label}</span>
              </button>
            )
          })}
        </div>
        <p className="settings-hint" style={{ margin: 0 }}>
          {activeOption?.helper}
        </p>
        <span
          data-testid="gemini-runtime-status"
          data-kind={status.kind}
          style={{ fontSize: '0.78rem', color: statusColor }}
        >
          ● {status.message}
        </span>
      </div>
    </div>
  )
}

function SettingsProviderAuthCard({
  provider,
  label,
  summary,
  description,
  optional,
  children
}: {
  provider: ProviderId
  label: string
  summary: ProviderAuthSummary
  description: string
  optional?: boolean
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <article
      className={`settings-provider-auth-card settings-provider-auth-card-${summary.variant} provider-${provider}`}
      data-provider={provider}
    >
      <div className="settings-provider-auth-card-header">
        <ProviderLogoTile provider={provider} />
        <strong>{label}</strong>
        {optional && <span className="settings-provider-auth-optional">Optional</span>}
      </div>
      <div className="settings-provider-auth-status">
        <span
          className={`settings-provider-auth-status-dot settings-provider-auth-status-dot-${summary.variant}`}
          aria-hidden
        />
        <span>{summary.statusText}</span>
      </div>
      <p>{description}</p>
      <p className="settings-provider-auth-hint">{summary.hint}</p>
      {children && <div className="settings-provider-auth-actions">{children}</div>}
    </article>
  )
}

export function SettingsPanel({
  mode,
  visualEffectStyle,
  themeAppearance,
  themeCornerStyle,
  themeAccentStyle,
  toolIconAccent,
  promptSurfaceStyle,
  composerStyle,
  transcriptFontFamily,
  composerFontFamily,
  reduceTransparency,
  reduceMotion,
  compactDensity,
  geminiCheckpointingEnabled,
  geminiApiRuntime,
  chatContextTurns,
  claudeBinaryPath,
  kimiBinaryPath,
  agenticServices,
  autoResumeParentOnSubThreadCompletion,
  agenticWorkspaceGrantCount,
  agenticWorkspaceGrants,
  activeProvider,
  providerCapabilities,
  geminiMcpBridgeEnabled,
  geminiMcpBridgeStatus,
  codexSandboxFallback,
  funFxEnabled,
  funFxMode,
  advancedFx,
  updateChannel,
  approvalTimeouts,
  productOperationsStatus,
  geminiAuthStatus,
  geminiAuthProfiles = [],
  codexStatus,
  claudeAuthStatus,
  kimiAuthStatus,
  claudeLoginState = 'idle',
  onImportCodexUsageCredential,
  onClearCodexUsageCredential,
  onTriggerClaudeLogin,
  onStoreClaudeApiKey,
  onClearClaudeApiKey,
  onStoreKimiApiKey,
  onClearKimiApiKey,
  onSaveGeminiAuthProfile,
  onStartGeminiOAuthLogin,
  onCancelGeminiOAuthLogin,
  onSetDefaultGeminiAuthProfile,
  onDeleteGeminiAuthProfile,
  onRemoveAgenticWorkspaceGrant,
  onInstallGeminiMcpBridge,
  onRefreshGeminiMcpBridgeStatus,
  onRefreshProductOperationsStatus,
  onExportProductDiagnostics,
  onRepairProductInstall,
  onChange,
  onClose,
  activeTab: activeTabProp,
  onTabChange,
  layout = 'sheet',
  workspaces = [],
  currentWorkspace,
  onSelectWorkspace,
  onSelectWorkspaceDialog,
  onRemoveWorkspace,
  onTogglePinWorkspace,
  usageSummary = []
}: SettingsPanelProps): React.JSX.Element {
  const [claudeKeyInput, setClaudeKeyInput] = useState('')
  const [kimiKeyInput, setKimiKeyInput] = useState('')
  const [geminiProfileLabel, setGeminiProfileLabel] = useState('')
  const [geminiApiKeyInput, setGeminiApiKeyInput] = useState('')
  const [geminiVertexProject, setGeminiVertexProject] = useState('')
  const [geminiVertexLocation, setGeminiVertexLocation] = useState('us-central1')
  // Uncontrolled fallback state. Used only when the caller doesn't
  // pass `activeTab`/`onTabChange` — i.e. when SettingsPanel is mounted
  // without the surrounding sidebar takeover (legacy / future tests).
  const [internalActiveTab, setInternalActiveTab] = useState<SettingsTab>('appearance')
  const activeTab = activeTabProp ?? internalActiveTab
  const setActiveTab = (next: SettingsTab): void => {
    if (onTabChange) onTabChange(next)
    else setInternalActiveTab(next)
  }
  const [installedFontOptions, setInstalledFontOptions] = useState<TypefaceOption[]>([])
  const [installedFontStatus, setInstalledFontStatus] = useState('')
  const [composerPreviewText, setComposerPreviewText] = useState('')
  const safeTurns = Number.isFinite(chatContextTurns)
    ? Math.max(0, Math.trunc(chatContextTurns))
    : 6
  const boundedTurns = Math.min(20, safeTurns)
  const transcriptFontOptions = [...TRANSCRIPT_FONT_OPTIONS, ...installedFontOptions]
  const composerFontOptions = [...COMPOSER_FONT_OPTIONS, ...installedFontOptions]
  const transcriptFontSelectValue = getFontSelectValue(
    transcriptFontOptions,
    transcriptFontFamily || FONT_STACKS.agbench
  )
  const composerFontSelectValue = getFontSelectValue(
    composerFontOptions,
    composerFontFamily || COMPOSER_FONT_MATCH_TRANSCRIPT
  )
  const previewComposerFontFamily = resolveComposerFontFamily(
    composerFontFamily,
    transcriptFontFamily
  )
  const composerPreviewMeta = getComposerPreviewMeta(composerStyle)
  const selectedGeminiAuthProfile = geminiAuthProfiles.find(
    (profile) => profile.id === geminiAuthStatus?.activeProfileId
  )
  const selectedGeminiOAuthLogin =
    selectedGeminiAuthProfile?.oauthLogin || geminiAuthStatus?.oauthLogin
  const isGeminiOAuthLoginRunning = selectedGeminiOAuthLogin?.status === 'running'
  const canLoadInstalledFonts =
    typeof window !== 'undefined' &&
    typeof (window as LocalFontWindow).queryLocalFonts === 'function'
  const updateAgenticService = <K extends keyof AgenticServicesSettings>(
    key: K,
    value: AgenticServicesSettings[K]
  ): void => {
    onChange({ agenticServices: { ...agenticServices, [key]: value } })
  }
  const codexAuthSummary = summariseCodexStatus(codexStatus)
  const claudeAuthSummary = summariseProviderApiKeyStatus(claudeAuthStatus ?? null, 'Claude')
  const geminiSetupSummary = summariseGeminiStatus(geminiAuthStatus ?? null)
  const kimiSetupSummary = summariseProviderApiKeyStatus(kimiAuthStatus ?? null, 'Kimi')
  const codexUsage = codexStatus?.codexUsage
  const codexUsageConfigured = Boolean(
    codexUsage?.configured ||
      codexUsage?.planType ||
      codexUsage?.userId ||
      (Array.isArray(codexUsage?.windows) && codexUsage.windows.length > 0) ||
      (Array.isArray(codexUsage?.balances) && codexUsage.balances.length > 0)
  )
  const handleLoadInstalledFonts = async (): Promise<void> => {
    const queryLocalFonts = (window as LocalFontWindow).queryLocalFonts
    if (!queryLocalFonts) {
      setInstalledFontStatus('Installed font discovery is not available in this runtime.')
      return
    }

    setInstalledFontStatus('Requesting local font access...')
    try {
      const fonts = await queryLocalFonts()
      const families = Array.from(
        new Set(
          fonts
            .map((font) => font.family || font.fullName || font.postscriptName || '')
            .map((name) => name.trim())
            .filter(Boolean)
        )
      )
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 160)

      setInstalledFontOptions(
        families.map((family) => ({
          label: family,
          value: quoteInstalledFontFamily(family)
        }))
      )
      setInstalledFontStatus(
        families.length > 0
          ? `${families.length} installed font families loaded.`
          : 'No installed font families were returned.'
      )
    } catch {
      setInstalledFontStatus('Local font access was denied or unavailable.')
    }
  }
  const updateAdvancedFx = (partial: Partial<AppSettings['advancedFx']>): void => {
    onChange({ advancedFx: { ...advancedFx, ...partial } })
  }

  return (
    <div className={`settings-panel settings-panel-${layout}`}>
      {/*
        Sticky header with inline tab bar + "Done" button. Suppressed
        in `takeover` layout because the host renders a SettingsSidebar
        next to this panel that carries the tab list AND the back-to-app
        affordance — duplicating it here would just clutter the chrome.
      */}
      {layout === 'sheet' && (
        <div className="settings-panel-header">
          <div className="settings-tab-bar">
            {SETTINGS_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            Done
          </button>
        </div>
      )}

      <div className="settings-panel-content">
        {/*
          Page title — only rendered in the full-app takeover layout
          (the legacy modal-sheet kept its tab bar with the active
          label highlighted, which served the same purpose). Big
          left-aligned heading at the top of the content area so the
          takeover reads as a real settings page rather than a sheet
          stretched into a sidebar. The label is sourced from
          `SETTINGS_TABS` so renaming a tab updates both the sidebar
          and the page title in lockstep.
        */}
        {layout === 'takeover' && (
          <h1 className="settings-takeover-title">
            {SETTINGS_TABS.find((tab) => tab.id === activeTab)?.label ?? 'Settings'}
          </h1>
        )}
        {/* ── Appearance ─────────────────────────────────── */}
        {
          activeTab === 'appearance' && (
            <>
              <div className="settings-group">
                <label className="settings-label">System theme</label>
                <div className="settings-option-grid">
                  {THEME_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      className={`settings-radio-option settings-theme-option ${themeAppearance === option.value ? 'active' : ''}`}
                      onClick={() => onChange({ themeAppearance: option.value })}
                    >
                      <span className={`settings-radio-dot theme-dot theme-${option.value}`} />
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-group">
                <label className="settings-label">Corners</label>
                <div className="settings-option-list settings-option-list-inline">
                  {(['rounded', 'hard'] as ThemeCornerStyle[]).map((option) => (
                    <button
                      key={option}
                      className={`settings-radio-option ${themeCornerStyle === option ? 'active' : ''}`}
                      onClick={() => onChange({ themeCornerStyle: option })}
                    >
                      <span className="settings-radio-dot" />
                      <span>{option === 'rounded' ? 'Rounded' : 'Hard'}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-group">
                <label className="settings-label">Accent color</label>
                <div className="settings-option-grid">
                  {ACCENT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      className={`settings-radio-option ${themeAccentStyle === option.value ? 'active' : ''}`}
                      onClick={() => onChange({ themeAccentStyle: option.value })}
                    >
                      <span className={`settings-radio-dot accent-dot accent-${option.value}`} />
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-group">
                <label className="settings-label">Tool-icon color</label>
                <div className="settings-option-grid">
                  {TOOL_ICON_ACCENT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      className={`settings-radio-option ${toolIconAccent === option.value ? 'active' : ''}`}
                      onClick={() => onChange({ toolIconAccent: option.value })}
                    >
                      <span
                        className={`settings-radio-dot tool-icon-accent-dot tool-icon-accent-${option.value}`}
                      />
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-group">
                <label className="settings-label">Prompt bubble</label>
                <select
                  className="settings-select"
                  value={promptSurfaceStyle}
                  onChange={(e) =>
                    onChange({ promptSurfaceStyle: e.target.value as PromptSurfaceStyle })
                  }
                >
                  {PROMPT_SURFACE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="settings-group settings-composer-preview-group">
                <label className="settings-label">Composer Preview</label>
                <div className="settings-composer-preview-controls">
                  <div className="settings-field">
                    <span className="settings-field-label">Interface shell</span>
                    <select
                      className="settings-select"
                      value={composerStyle}
                      onChange={(e) => onChange({ composerStyle: e.target.value as ComposerStyle })}
                    >
                      {COMPOSER_STYLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className="settings-hint">
                      {
                        COMPOSER_STYLE_OPTIONS.find((option) => option.value === composerStyle)
                          ?.helper
                      }
                    </p>
                  </div>

                  <div className="settings-field">
                    <span className="settings-field-label">Transcript font</span>
                    <select
                      className="settings-select"
                      value={transcriptFontSelectValue}
                      onChange={(e) => {
                        const value = e.target.value
                        onChange({
                          transcriptFontFamily:
                            value === CUSTOM_FONT_SELECT_VALUE
                              ? transcriptFontSelectValue === CUSTOM_FONT_SELECT_VALUE
                                ? transcriptFontFamily
                                : CUSTOM_FONT_FALLBACK
                              : value
                        })
                      }}
                    >
                      {TRANSCRIPT_FONT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                      <option value={CUSTOM_FONT_SELECT_VALUE}>Custom...</option>
                      {installedFontOptions.length > 0 && (
                        <optgroup label="Installed fonts">
                          {installedFontOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    {transcriptFontSelectValue === CUSTOM_FONT_SELECT_VALUE && (
                      <input
                        className="settings-input settings-font-custom-input"
                        value={transcriptFontFamily}
                        onChange={(e) => onChange({ transcriptFontFamily: e.target.value })}
                        placeholder='"Avenir Next", system-ui, sans-serif'
                      />
                    )}
                  </div>

                  <div className="settings-field">
                    <span className="settings-field-label">Composer font</span>
                    <select
                      className="settings-select"
                      value={composerFontSelectValue}
                      onChange={(e) => {
                        const value = e.target.value
                        onChange({
                          composerFontFamily:
                            value === CUSTOM_FONT_SELECT_VALUE
                              ? composerFontSelectValue === CUSTOM_FONT_SELECT_VALUE
                                ? composerFontFamily
                                : CUSTOM_FONT_FALLBACK
                              : value
                        })
                      }}
                    >
                      {COMPOSER_FONT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                      <option value={CUSTOM_FONT_SELECT_VALUE}>Custom...</option>
                      {installedFontOptions.length > 0 && (
                        <optgroup label="Installed fonts">
                          {installedFontOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    {composerFontSelectValue === CUSTOM_FONT_SELECT_VALUE && (
                      <input
                        className="settings-input settings-font-custom-input"
                        value={composerFontFamily}
                        onChange={(e) => onChange({ composerFontFamily: e.target.value })}
                        placeholder='"Avenir Next", system-ui, sans-serif'
                      />
                    )}
                  </div>
                </div>
                <div className="settings-font-actions">
                  <button
                    className="btn btn-sm btn-ghost"
                    type="button"
                    disabled={!canLoadInstalledFonts}
                    onClick={() => void handleLoadInstalledFonts()}
                  >
                    Load installed fonts
                  </button>
                  <span className="settings-font-status">
                    {installedFontStatus ||
                      (canLoadInstalledFonts
                        ? 'Optional local font permission.'
                        : 'Installed font discovery unavailable; custom CSS font-family still works.')}
                  </span>
                </div>

                <div
                  className="settings-composer-preview-card"
                  data-composer-style={composerStyle}
                  data-interface-style={composerStyle}
                >
                  <div
                    className="settings-composer-preview-transcript"
                    style={{ fontFamily: transcriptFontFamily || FONT_STACKS.agbench }}
                  >
                    <span className="settings-composer-preview-speaker">
                      {composerPreviewMeta.providerLabel}
                    </span>
                    <p>
                      Assistant transcript text uses this typeface, including inline code, file
                      names, and longer status lines.
                    </p>
                    <div className="settings-composer-preview-tool-row" aria-hidden="true">
                      <span>Edited</span>
                      <code>src/renderer/src/App.tsx</code>
                      <strong>+42</strong>
                      <em>-8</em>
                    </div>
                  </div>
                  <div
                    className={`composer-area settings-composer-preview-area interface-${composerStyle}`}
                    aria-label={`${composerPreviewMeta.providerLabel} composer preview`}
                  >
                    <div className="composer-above-bar-stack">
                      <div className="composer-above-bar style-unified">
                        <span className="composer-above-bar-branch">
                          <svg
                            width="13"
                            height="13"
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden
                          >
                            <circle cx="4" cy="3.5" r="1.6" />
                            <circle cx="4" cy="12.5" r="1.6" />
                            <circle cx="12" cy="7" r="1.6" />
                            <path d="M4 5.1v5.8M5.6 7c2 0 4.8 0 4.8-1.5" />
                          </svg>
                          <span>
                            Preview workspace ·{' '}
                            <em className="composer-above-bar-secondary-branch">main</em>
                          </span>
                        </span>
                        <span className="composer-above-bar-files-cluster">
                          <span className="composer-above-bar-files">
                            <strong>2</strong> files changed
                          </span>
                          <span className="composer-above-bar-stats">
                            <span className="composer-diff-add">+42</span>
                            <span className="composer-diff-del">-8</span>
                          </span>
                        </span>
                        <button
                          type="button"
                          className="composer-above-bar-action"
                          tabIndex={-1}
                          aria-hidden="true"
                        >
                          Review changes
                        </button>
                      </div>
                    </div>
                    <div className="composer-surface settings-composer-preview-surface">
                      <div className="composer-chips" aria-hidden="true">
                        <span className="composer-chip">Branch: main</span>
                        <span className="composer-chip accent">Preview only</span>
                      </div>
                      <textarea
                        className="composer-textarea settings-composer-preview-textarea"
                        value={composerPreviewText}
                        onChange={(e) => setComposerPreviewText(e.target.value)}
                        placeholder={composerPreviewMeta.placeholder}
                        rows={3}
                        aria-label="Composer font preview text"
                        style={{ fontFamily: previewComposerFontFamily }}
                      />
                      <div className="composer-control-footer settings-composer-preview-footer">
                        <div className="composer-inline-pickers">
                          <div className="composer-inline-pickers-left" aria-hidden="true">
                            <button
                              type="button"
                              className="composer-picker-label settings-composer-preview-control"
                              data-composer-control="attach"
                              tabIndex={-1}
                            >
                              +
                            </button>
                            <span
                              className="composer-picker-label settings-composer-preview-control"
                              data-composer-control="provider"
                            >
                              {composerPreviewMeta.providerLabel}
                            </span>
                            <span
                              className="composer-picker-label settings-composer-preview-control"
                              data-composer-control="permission"
                            >
                              {composerPreviewMeta.permissionLabel}
                            </span>
                            <span
                              className="composer-picker-label settings-composer-preview-control"
                              data-composer-control="model"
                            >
                              {composerPreviewMeta.modelLabel}
                            </span>
                          </div>
                          <div className="composer-inline-actions" aria-hidden="true">
                            <span className="context-wheel settings-composer-preview-context">
                              <svg viewBox="0 0 18 18" width="18" height="18">
                                <circle
                                  cx="9"
                                  cy="9"
                                  r="6.6"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  opacity="0.22"
                                />
                                <path
                                  d="M9 2.4a6.6 6.6 0 0 1 5.4 10.4"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                />
                              </svg>
                            </span>
                            <span className="composer-thread-token-tally">44%</span>
                            <button
                              type="button"
                              className="composer-action-btn run-btn"
                              tabIndex={-1}
                              aria-label="Preview send button"
                            >
                              ↑
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="settings-group settings-effects-material span-all">
                <label className="settings-label">Effects &amp; Material</label>
                <div className="settings-effects-grid">
                  <section className="settings-effects-card">
                    <span className="settings-field-label">Window material</span>
                    <div className="settings-option-list settings-option-list-inline">
                      {(['solid', 'soft_glass', 'native_glass'] as AppearanceMode[]).map((m) => (
                        <button
                          key={m}
                          className={`btn btn-sm ${mode === m ? '' : 'btn-ghost'}`}
                          onClick={() => onChange({ mode: m })}
                        >
                          {m === 'soft_glass'
                            ? 'Soft Glass'
                            : m === 'native_glass'
                              ? 'Native Glass'
                              : 'Solid'}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="settings-effects-card">
                    <span className="settings-field-label">Glass style</span>
                    <div className="settings-option-list settings-effects-radio-list">
                      {VISUAL_EFFECT_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          className={`settings-radio-option ${visualEffectStyle === option.value ? 'active' : ''}`}
                          onClick={() => onChange({ visualEffectStyle: option.value })}
                        >
                          <span className="settings-radio-dot" />
                          <span>{option.label}</span>
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="settings-effects-card">
                    <span className="settings-field-label">Accessibility</span>
                    <div className="settings-effects-toggle-list">
                      <label className="settings-effects-check-row">
                        <input
                          type="checkbox"
                          checked={reduceTransparency}
                          onChange={(e) => onChange({ reduceTransparency: e.target.checked })}
                        />
                        <span>
                          Reduce transparency
                          <small>Disables glass effects for better readability and battery life.</small>
                        </span>
                      </label>
                      <label className="settings-effects-check-row">
                        <input
                          type="checkbox"
                          checked={reduceMotion}
                          onChange={(e) => onChange({ reduceMotion: e.target.checked })}
                        />
                        <span>
                          Reduce motion
                          <small>Minimizes animations for accessibility.</small>
                        </span>
                      </label>
                    </div>
                  </section>

                  <section className="settings-effects-card">
                    <span className="settings-field-label">Density</span>
                    <label className="settings-effects-check-row">
                      <input
                        type="checkbox"
                        checked={compactDensity}
                        onChange={(e) => onChange({ compactDensity: e.target.checked })}
                      />
                      <span>
                        Compact density
                        <small>Tighter spacing throughout the interface.</small>
                      </span>
                    </label>
                  </section>

                  <section className="settings-effects-card">
                    <label className="settings-effects-check-row settings-effects-primary-toggle">
                      <input
                        type="checkbox"
                        checked={funFxEnabled}
                        onChange={(e) => onChange({ funFxEnabled: e.target.checked })}
                      />
                      <span>
                        Epic FX
                        <small>
                          {funFxMode === 'off'
                            ? 'Epic FX disabled.'
                            : FUN_FX_MODES.find((option) => option.value === funFxMode)?.helper ||
                              FUN_FX_MODES[2].helper}
                        </small>
                      </span>
                    </label>
                    <div className="settings-option-list settings-option-list-inline">
                      {FUN_FX_MODES.map((option) => (
                        <button
                          key={option.value}
                          className={`btn btn-sm ${funFxMode === option.value ? '' : 'btn-ghost'}`}
                          onClick={() => onChange({ funFxMode: option.value })}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="settings-effects-card settings-fx-labs settings-effects-labs">
                    <div className="settings-effects-section-header">
                      <span className="settings-field-label">FX Labs</span>
                      <p className="settings-hint">
                        Opt-in visual layers for agent ambience, workspace atmosphere, and live run
                        telemetry. Disabled automatically when Reduce motion is enabled.
                      </p>
                    </div>
                    <div className="settings-effects-labs-grid">
                      <label className="settings-service-row settings-fx-toggle">
                        <span>
                          Agent Aura
                          <small>
                            Provider-colored backgrounds, composer rims, inspector edges, and
                            run-state bursts.
                          </small>
                        </span>
                        <input
                          type="checkbox"
                          checked={!reduceMotion && funFxEnabled && advancedFx.agentAura}
                          disabled={reduceMotion || !funFxEnabled}
                          onChange={(e) => updateAdvancedFx({ agentAura: e.target.checked })}
                        />
                      </label>
                      <label className="settings-service-row settings-fx-toggle">
                        <span>
                          Living Workspace
                          <small>
                            Extends Sky/Weather with parallax depth, motes, weather particles, and
                            room-light glow.
                          </small>
                        </span>
                        <input
                          type="checkbox"
                          checked={!reduceMotion && funFxEnabled && advancedFx.livingWorkspace}
                          disabled={reduceMotion || !funFxEnabled}
                          onChange={(e) => updateAdvancedFx({ livingWorkspace: e.target.checked })}
                        />
                      </label>
                      <label className="settings-service-row settings-fx-toggle">
                        <span>
                          Data Viz FX
                          <small>
                            Lightweight SVG overlays for token flow, queue lanes, tool pulses,
                            approvals, and progress.
                          </small>
                        </span>
                        <input
                          type="checkbox"
                          checked={!reduceMotion && funFxEnabled && advancedFx.dataViz}
                          disabled={reduceMotion || !funFxEnabled}
                          onChange={(e) => updateAdvancedFx({ dataViz: e.target.checked })}
                        />
                      </label>
                    </div>
                    <div className="settings-option-list settings-option-list-inline">
                      {FUN_FX_MODES.filter((option) => option.value !== 'off').map((option) => (
                        <button
                          key={option.value}
                          className={`btn btn-sm ${advancedFx.intensity === option.value ? '' : 'btn-ghost'}`}
                          disabled={reduceMotion || !funFxEnabled}
                          onClick={() =>
                            updateAdvancedFx({
                              intensity: option.value as AppSettings['advancedFx']['intensity']
                            })
                          }
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <p className="settings-hint">
                      {reduceMotion
                        ? 'Reduce motion is active, so FX Labs animations stay off.'
                        : funFxEnabled
                          ? `${advancedFx.intensity} intensity; subtle favors CSS-only ambience, epic adds denser particles and telemetry.`
                          : 'Turn on Epic FX to enable FX Labs layers.'}
                    </p>
                  </section>
                </div>
              </div>
            </>
          ) /* end appearance */
        }

        {/* ── Behavior ─────────────────────────────────── */}
        {
          activeTab === 'behavior' && (
            <>
              <div className="settings-group">
                <label
                  className="settings-label"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-sm)',
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={geminiCheckpointingEnabled}
                    onChange={(e) => onChange({ geminiCheckpointingEnabled: e.target.checked })}
                  />
                  Gemini checkpointing
                </label>
                <p className="settings-hint">
                  Starts new Gemini CLI runs and persistent sessions with --checkpointing. Restart
                  an active persistent session to apply changes.
                </p>
              </div>

              <div className="settings-group">
                <label className="settings-label">Conversation context turns</label>
                <select
                  className="settings-select"
                  value={boundedTurns}
                  onChange={(e) => onChange({ chatContextTurns: Number(e.target.value) })}
                >
                  {CONTEXT_TURN_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <p className="settings-hint">
                  Max recent user/assistant turns to include with each prompt for continuity. 0
                  sends only the current message.
                </p>
              </div>

              {/* ── Approval timeouts (Phase E1.1) ────────────────────────── */}
              <div className="settings-group">
                <label
                  className="settings-label"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-sm)',
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={approvalTimeouts.enabled}
                    onChange={(e) =>
                      onChange({
                        approvalTimeouts: { ...approvalTimeouts, enabled: e.target.checked }
                      })
                    }
                  />
                  Auto-deny approvals after a timeout
                </label>
                <p className="settings-hint">
                  When enabled, approvals sitting unanswered (in the desktop modal or on a paired
                  iPhone) are automatically declined after the per-provider window below. Disable
                  for hands-off testing, where the run should block indefinitely.
                </p>
              </div>

              <div className="settings-group">
                <label className="settings-label">Timeout windows (seconds)</label>
                <div className="approval-timeout-grid">
                  <ApprovalTimeoutField
                    label="Gemini"
                    valueMs={approvalTimeouts.perProviderMs.gemini}
                    disabled={!approvalTimeouts.enabled}
                    onChange={(ms) =>
                      onChange({
                        approvalTimeouts: {
                          ...approvalTimeouts,
                          perProviderMs: { ...approvalTimeouts.perProviderMs, gemini: ms }
                        }
                      })
                    }
                  />
                  <ApprovalTimeoutField
                    label="Codex"
                    valueMs={approvalTimeouts.perProviderMs.codex}
                    disabled={!approvalTimeouts.enabled}
                    onChange={(ms) =>
                      onChange({
                        approvalTimeouts: {
                          ...approvalTimeouts,
                          perProviderMs: { ...approvalTimeouts.perProviderMs, codex: ms }
                        }
                      })
                    }
                  />
                  <ApprovalTimeoutField
                    label="Claude"
                    valueMs={approvalTimeouts.perProviderMs.claude}
                    disabled={!approvalTimeouts.enabled}
                    onChange={(ms) =>
                      onChange({
                        approvalTimeouts: {
                          ...approvalTimeouts,
                          perProviderMs: { ...approvalTimeouts.perProviderMs, claude: ms }
                        }
                      })
                    }
                  />
                  <ApprovalTimeoutField
                    label="Kimi"
                    valueMs={approvalTimeouts.perProviderMs.kimi}
                    disabled={!approvalTimeouts.enabled}
                    onChange={(ms) =>
                      onChange({
                        approvalTimeouts: {
                          ...approvalTimeouts,
                          perProviderMs: { ...approvalTimeouts.perProviderMs, kimi: ms }
                        }
                      })
                    }
                  />
                  <ApprovalTimeoutField
                    label="Main authority"
                    valueMs={approvalTimeouts.mainAuthorityMs}
                    disabled={!approvalTimeouts.enabled}
                    onChange={(ms) =>
                      onChange({ approvalTimeouts: { ...approvalTimeouts, mainAuthorityMs: ms } })
                    }
                  />
                </div>
                <p className="settings-hint">
                  Per-provider deadline before an unanswered approval is auto-denied. Defaults
                  (Codex 30s, Claude/Gemini 120s, Kimi 60s, Main 60s) reflect how tolerant each
                  runtime is of paused tool calls — Codex sandbox commands hang faster than
                  long-think Claude prompts.
                </p>
              </div>
            </>
          ) /* end behavior */
        }

        {/* ── Providers ─────────────────────────────────── */}
        {
          activeTab === 'providers' && (
            <>
              <div className="settings-group settings-provider-auth-overview span-all">
                <div className="settings-provider-auth-overview-header">
                  <div>
                    <h4 className="sidebar-section-title" style={{ margin: 0 }}>
                      Provider sign-in
                    </h4>
                    <p className="settings-hint">
                      Same provider checklist as first launch. Runtime auth stays with each
                      provider; AGBench stores only explicit API keys or usage sessions you add
                      here.
                    </p>
                  </div>
                </div>
                <div className="settings-provider-auth-grid">
                  <SettingsProviderAuthCard
                    provider="codex"
                    label="Codex"
                    summary={codexAuthSummary}
                    description="OpenAI Codex CLI for fast shell and agentic work."
                  >
                    <div className="settings-provider-auth-command">
                      <code>codex login</code>
                      <span>Run once in Terminal for official Codex CLI runtime auth.</span>
                    </div>
                    <div className="settings-provider-auth-action-row">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={onImportCodexUsageCredential}
                      >
                        Import usage session
                      </button>
                      {codexUsageConfigured && (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={onClearCodexUsageCredential}
                        >
                          Clear usage session
                        </button>
                      )}
                    </div>
                    <p className="settings-provider-auth-footnote">
                      Usage import powers quota and credit meters only; Codex runs still use the
                      official CLI login.
                    </p>
                  </SettingsProviderAuthCard>

                  <SettingsProviderAuthCard
                    provider="claude"
                    label="Claude"
                    summary={claudeAuthSummary}
                    description="Claude Code / Anthropic API for careful edits and long reasoning."
                  >
                    <div className="settings-provider-auth-action-row">
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={claudeLoginState === 'loading'}
                        onClick={onTriggerClaudeLogin}
                      >
                        {claudeLoginState === 'loading' ? 'Opening browser...' : 'Login with Claude'}
                      </button>
                    </div>
                    <p className="settings-provider-auth-footnote">
                      API key and CLI path controls are below.
                    </p>
                  </SettingsProviderAuthCard>

                  <SettingsProviderAuthCard
                    provider="gemini"
                    label="Gemini"
                    summary={geminiSetupSummary}
                    description="Google Gemini profiles for OAuth, API-key, or Vertex-backed runs."
                    optional
                  >
                    <div className="settings-provider-auth-action-row">
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={isGeminiOAuthLoginRunning}
                        onClick={() => {
                          onStartGeminiOAuthLogin?.({
                            profileId:
                              selectedGeminiAuthProfile?.kind === 'google-oauth'
                                ? selectedGeminiAuthProfile.id
                                : undefined,
                            label: geminiProfileLabel.trim() || 'Google login',
                            makeDefault: true
                          })
                          setGeminiProfileLabel('')
                        }}
                      >
                        {selectedGeminiAuthProfile?.kind === 'google-oauth'
                          ? 'Refresh Google login'
                          : 'Add Google login'}
                      </button>
                      {isGeminiOAuthLoginRunning && (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() =>
                            onCancelGeminiOAuthLogin?.(
                              selectedGeminiAuthProfile?.id ||
                                geminiAuthStatus?.activeProfileId ||
                                null
                            )
                          }
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                    <p className="settings-provider-auth-footnote">
                      API key, Vertex, and runtime controls are below.
                    </p>
                  </SettingsProviderAuthCard>

                  <SettingsProviderAuthCard
                    provider="kimi"
                    label="Kimi"
                    summary={kimiSetupSummary}
                    description="Moonshot Kimi for wire-protocol runs and structured tool calls."
                    optional
                  >
                    <p className="settings-provider-auth-footnote">
                      Paste a Moonshot API key in the Kimi section below.
                    </p>
                  </SettingsProviderAuthCard>
                </div>
              </div>

              <div className="settings-group span-all">
                <h4 className="sidebar-section-title" style={{ margin: 0 }}>
                  Agentic services
                </h4>
                <div className="settings-service-list">
                  <label className="settings-service-row">
                    <span>Shell commands</span>
                    <select
                      className="settings-select"
                      value={agenticServices.shellCommands}
                      onChange={(e) =>
                        updateAgenticService(
                          'shellCommands',
                          e.target.value as AgenticServicePolicy
                        )
                      }
                    >
                      {AGENTIC_SERVICE_POLICY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="settings-service-row">
                    <span>File changes</span>
                    <select
                      className="settings-select"
                      value={agenticServices.fileChanges}
                      onChange={(e) =>
                        updateAgenticService('fileChanges', e.target.value as AgenticServicePolicy)
                      }
                    >
                      {AGENTIC_SERVICE_POLICY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="settings-service-row">
                    <span>MCP and tools</span>
                    <select
                      className="settings-select"
                      value={agenticServices.mcpTools}
                      onChange={(e) =>
                        updateAgenticService('mcpTools', e.target.value as AgenticServicePolicy)
                      }
                    >
                      {AGENTIC_SERVICE_POLICY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="settings-service-row">
                    <span>
                      Sub-thread delegation
                      <small>
                        Whether agents on this workspace can delegate to sub-threads on other
                        providers. Default &apos;ask&apos; prompts you before each delegation;
                        &apos;Always allow&apos; lets agents spawn without prompting (use only for
                        trusted workflows).
                      </small>
                    </span>
                    <select
                      className="settings-select"
                      value={agenticServices.subThreadDelegation}
                      onChange={(e) =>
                        updateAgenticService(
                          'subThreadDelegation',
                          e.target.value as AgenticServicePolicy
                        )
                      }
                    >
                      {AGENTIC_SERVICE_POLICY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="settings-service-row">
                    <span>
                      Auto-resume parent when sub-thread completes
                      <small>
                        When a sub-thread you delegated to finishes, automatically continue the
                        parent agent so it can read the result without a manual nudge.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={autoResumeParentOnSubThreadCompletion}
                      onChange={(e) =>
                        onChange({ autoResumeParentOnSubThreadCompletion: e.target.checked })
                      }
                    />
                  </label>

                  <label className="settings-service-row">
                    <span>Network access</span>
                    <select
                      className="settings-select"
                      value={agenticServices.networkAccess}
                      onChange={(e) =>
                        updateAgenticService(
                          'networkAccess',
                          e.target.value as AgenticNetworkPolicy
                        )
                      }
                    >
                      {NETWORK_POLICY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="settings-hint">
                  {agenticWorkspaceGrantCount} workspace permission{' '}
                  {agenticWorkspaceGrantCount === 1 ? 'grant' : 'grants'} saved.
                </p>

                {providerCapabilities && (
                  <div className="settings-hint">
                    Active provider contract: {providerCapabilities.label} shell is{' '}
                    {providerCapabilities.tools.shellCommands.state}, files are{' '}
                    {providerCapabilities.tools.fileChanges.state}, MCP is{' '}
                    {providerCapabilities.mcp.state}, creative apps are{' '}
                    {providerCapabilities.tools.creativeApps.state};{' '}
                    {
                      Object.values(providerCapabilities.tools).filter(
                        (tool) => tool.enforcedByAgentBench
                      ).length
                    }
                    /{Object.values(providerCapabilities.tools).length} controls are
                    AGBench-enforced.
                  </div>
                )}
                {!providerCapabilities && (
                  <div className="settings-hint">
                    Active provider contract for {activeProvider} will appear after the next
                    capability refresh.
                  </div>
                )}

                <label className="settings-service-row">
                  <span>Codex sandbox fallback</span>
                  <select
                    className="settings-select"
                    value={codexSandboxFallback}
                    onChange={(e) =>
                      onChange({ codexSandboxFallback: e.target.value as CodexSandboxFallbackMode })
                    }
                  >
                    {CODEX_SANDBOX_FALLBACK_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="settings-hint">
                  When Codex hits a Swift/Xcode sandbox/tooling collision, AGBench can ask to rerun
                  that exact command once from the host process.
                </p>

                <div className="settings-service-row" style={{ alignItems: 'flex-start' }}>
                  <span>
                    Gemini auth profile
                    <small>
                      Selected profiles are injected into Gemini runs and override inherited
                      Gemini/Google auth env for that run.
                    </small>
                  </span>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--space-xs)',
                      minWidth: 0
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-sm)',
                        flexWrap: 'wrap'
                      }}
                    >
                      <span
                        style={{
                          fontSize: '0.78rem',
                          color: geminiAuthStatus?.activeProfileId
                            ? 'var(--color-success, #3fb950)'
                            : 'var(--text-secondary)'
                        }}
                      >
                        ●{' '}
                        {geminiAuthStatus?.activeProfileLabel ||
                          (geminiAuthStatus?.authState === 'google-oauth'
                            ? 'Local Gemini login'
                            : 'Default CLI auth')}
                      </span>
                      {geminiAuthStatus?.version && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                          {geminiAuthStatus.version}
                        </span>
                      )}
                    </div>
                    <select
                      className="settings-select"
                      value={geminiAuthStatus?.activeProfileId || ''}
                      onChange={(event) =>
                        onSetDefaultGeminiAuthProfile?.(event.target.value || null)
                      }
                    >
                      <option value="">Use local Gemini CLI login/env</option>
                      {geminiAuthProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.label} ({profile.kind}
                          {profile.configured ? '' : ', incomplete'})
                        </option>
                      ))}
                    </select>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr) auto',
                        gap: 'var(--space-xs)',
                        alignItems: 'center'
                      }}
                    >
                      <input
                        className="settings-select"
                        value={geminiProfileLabel}
                        onChange={(event) => setGeminiProfileLabel(event.target.value)}
                        placeholder="Profile name"
                      />
                      <input
                        className="settings-select"
                        type="password"
                        value={geminiApiKeyInput}
                        onChange={(event) => setGeminiApiKeyInput(event.target.value)}
                        placeholder="GEMINI_API_KEY"
                      />
                      <button
                        className="btn btn-sm"
                        type="button"
                        disabled={!geminiApiKeyInput.trim()}
                        onClick={() => {
                          onSaveGeminiAuthProfile?.({
                            label: geminiProfileLabel.trim() || 'Gemini API key',
                            kind: 'api-key',
                            apiKey: geminiApiKeyInput,
                            makeDefault: true
                          })
                          setGeminiProfileLabel('')
                          setGeminiApiKeyInput('')
                        }}
                      >
                        Save key
                      </button>
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) auto',
                        gap: 'var(--space-xs)',
                        alignItems: 'center'
                      }}
                    >
                      <input
                        className="settings-select"
                        value={geminiVertexProject}
                        onChange={(event) => setGeminiVertexProject(event.target.value)}
                        placeholder="Vertex project id"
                      />
                      <input
                        className="settings-select"
                        value={geminiVertexLocation}
                        onChange={(event) => setGeminiVertexLocation(event.target.value)}
                        placeholder="Location"
                      />
                      <button
                        className="btn btn-sm btn-ghost"
                        type="button"
                        disabled={!geminiVertexProject.trim()}
                        onClick={() => {
                          onSaveGeminiAuthProfile?.({
                            label:
                              geminiProfileLabel.trim() || `Vertex ${geminiVertexProject.trim()}`,
                            kind: 'vertex-ai',
                            vertexProject: geminiVertexProject.trim(),
                            vertexLocation: geminiVertexLocation.trim() || 'us-central1',
                            makeDefault: true
                          })
                          setGeminiProfileLabel('')
                          setGeminiVertexProject('')
                        }}
                      >
                        Save Vertex
                      </button>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-xs)',
                        flexWrap: 'wrap'
                      }}
                    >
                      <button
                        className="btn btn-sm"
                        type="button"
                        disabled={isGeminiOAuthLoginRunning}
                        onClick={() => {
                          onStartGeminiOAuthLogin?.({
                            profileId:
                              selectedGeminiAuthProfile?.kind === 'google-oauth'
                                ? selectedGeminiAuthProfile.id
                                : undefined,
                            label: geminiProfileLabel.trim() || 'Google login',
                            makeDefault: true
                          })
                          setGeminiProfileLabel('')
                        }}
                      >
                        {selectedGeminiAuthProfile?.kind === 'google-oauth'
                          ? 'Log in selected Google profile'
                          : 'Add Google login'}
                      </button>
                      {isGeminiOAuthLoginRunning && (
                        <button
                          className="btn btn-sm btn-ghost"
                          type="button"
                          onClick={() =>
                            onCancelGeminiOAuthLogin?.(
                              selectedGeminiAuthProfile?.id ||
                                geminiAuthStatus?.activeProfileId ||
                                null
                            )
                          }
                        >
                          Cancel login
                        </button>
                      )}
                      {selectedGeminiOAuthLogin?.message && (
                        <span
                          style={{
                            fontSize: '0.75rem',
                            color:
                              selectedGeminiOAuthLogin.status === 'error'
                                ? 'var(--color-danger, #f85149)'
                                : 'var(--text-tertiary)'
                          }}
                        >
                          {selectedGeminiOAuthLogin.message}
                        </span>
                      )}
                      {selectedGeminiAuthProfile?.oauthEmail && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                          {selectedGeminiAuthProfile.oauthEmail}
                        </span>
                      )}
                    </div>
                    {geminiAuthStatus?.activeProfileId && (
                      <button
                        className="btn btn-sm btn-ghost"
                        type="button"
                        onClick={() =>
                          onDeleteGeminiAuthProfile?.(geminiAuthStatus.activeProfileId!)
                        }
                        style={{ alignSelf: 'flex-start' }}
                      >
                        Delete selected profile
                      </button>
                    )}
                    <p className="settings-hint" style={{ margin: 0 }}>
                      Google login profiles use isolated Gemini CLI homes under AGBench, so browser
                      OAuth persists across app restarts without using your host ~/.gemini account.
                    </p>
                  </div>
                </div>

                {/* Phase M1 Step 6 — Gemini API vs CLI runtime picker. The
	            'auto' default matches the persisted store default and is a
	            no-op for existing CLI users. 'always' forces the new
	            in-process API path; 'never' pins to the legacy CLI. The
	            status row below reflects which path a fresh run will
	            actually take given the currently-selected auth profile.
	            Extracted into GeminiRuntimePicker so we can render and
	            assert it in isolation without spinning up the full panel. */}
                <GeminiRuntimePicker
                  value={geminiApiRuntime}
                  profiles={geminiAuthProfiles}
                  activeProfileId={geminiAuthStatus?.activeProfileId ?? null}
                  onSelect={(value) => onChange({ geminiApiRuntime: value })}
                />

                <div className="settings-service-row" style={{ alignItems: 'flex-start' }}>
                  <span>Gemini MCP bridge</span>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--space-xs)',
                      minWidth: 0
                    }}
                  >
                    <label
                      className="settings-label"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-sm)',
                        cursor: 'pointer',
                        margin: 0
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={geminiMcpBridgeEnabled}
                        onChange={(e) => onChange({ geminiMcpBridgeEnabled: e.target.checked })}
                      />
                      Enabled
                    </label>
                    <div className="settings-option-list settings-option-list-inline">
                      <button
                        className="btn btn-sm"
                        type="button"
                        onClick={onInstallGeminiMcpBridge}
                      >
                        Install / repair
                      </button>
                      <button
                        className="btn btn-sm btn-ghost"
                        type="button"
                        onClick={onRefreshGeminiMcpBridgeStatus}
                      >
                        Test
                      </button>
                    </div>
                  </div>
                </div>
                <p className="settings-hint">
                  {geminiMcpBridgeStatus?.message || 'Bridge status has not been checked yet.'}
                </p>
              </div>

              <div className="settings-group">
                <h4 className="sidebar-section-title" style={{ margin: 0 }}>
                  Claude
                </h4>

                {claudeAuthStatus && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-sm)',
                      marginBottom: 'var(--space-xs)'
                    }}
                  >
                    {!claudeAuthStatus.available ? (
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        ● Binary not found
                      </span>
                    ) : claudeAuthStatus.apiKeyConfigured ? (
                      <span style={{ fontSize: '0.78rem', color: 'var(--accent)' }}>
                        ● API key configured
                      </span>
                    ) : claudeAuthStatus.authState &&
                      !['not logged in', 'not authenticated', 'unauthenticated', 'error'].some(
                        (p) => claudeAuthStatus.authState.toLowerCase().includes(p)
                      ) ? (
                      <span style={{ fontSize: '0.78rem', color: 'var(--color-success, #3fb950)' }}>
                        ● Authenticated
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.78rem', color: 'var(--color-warning, #d29922)' }}>
                        ● Not authenticated
                      </span>
                    )}
                    {claudeAuthStatus.version && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                        {claudeAuthStatus.version}
                      </span>
                    )}
                  </div>
                )}

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-sm)',
                    flexWrap: 'wrap',
                    marginBottom: 'var(--space-xs)'
                  }}
                >
                  <button
                    className="btn btn-sm"
                    disabled={claudeLoginState === 'loading'}
                    onClick={onTriggerClaudeLogin}
                  >
                    {claudeLoginState === 'loading'
                      ? 'Opening browser...'
                      : 'Login with Claude Code →'}
                  </button>
                  {claudeLoginState === 'success' && (
                    <span
                      className="settings-hint"
                      style={{ margin: 0, color: 'var(--color-success, #3fb950)' }}
                    >
                      Browser opened
                    </span>
                  )}
                  {claudeLoginState === 'error' && (
                    <span
                      className="settings-hint"
                      style={{ margin: 0, color: 'var(--color-danger, #f85149)' }}
                    >
                      Login failed — check CLI is installed
                    </span>
                  )}
                </div>
                <p className="settings-hint">
                  Claude runs inside AGBench use Agent SDK / <code>claude -p</code> programmatic
                  paths. From 2026-06-15 Anthropic says these use separate Agent SDK credit, not
                  normal interactive Claude Code subscription limits. Use Claude in an interactive
                  terminal when you specifically need native Claude Code subscription-limit
                  behavior.
                </p>

                <label className="settings-label">Anthropic API key</label>
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--space-sm)',
                    marginBottom: 'var(--space-xs)'
                  }}
                >
                  <input
                    className="settings-select"
                    type="password"
                    value={claudeKeyInput}
                    onChange={(e) => setClaudeKeyInput(e.target.value)}
                    placeholder={
                      claudeAuthStatus?.apiKeyConfigured ? '••••••••••• (saved)' : 'sk-ant-...'
                    }
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn btn-sm"
                    disabled={!claudeKeyInput.trim()}
                    onClick={() => {
                      onStoreClaudeApiKey?.(claudeKeyInput)
                      setClaudeKeyInput('')
                    }}
                  >
                    Save
                  </button>
                  {claudeAuthStatus?.apiKeyConfigured && (
                    <button className="btn btn-sm btn-ghost" onClick={onClearClaudeApiKey}>
                      Clear
                    </button>
                  )}
                </div>
                <p className="settings-hint">
                  API key takes priority over the Claude Code login session and uses API/PAYG
                  billing. Stored encrypted on-device.
                </p>

                <label className="settings-label">Claude CLI binary</label>
                <input
                  className="settings-select"
                  value={claudeBinaryPath}
                  onChange={(e) => onChange({ claudeBinaryPath: e.target.value })}
                  placeholder="Auto-detect, or /Users/you/.local/bin/claude"
                />
                <p className="settings-hint">Optional path override.</p>
              </div>

              <div className="settings-group">
                <h4 className="sidebar-section-title" style={{ margin: 0 }}>
                  Kimi
                </h4>

                {kimiAuthStatus && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-sm)',
                      marginBottom: 'var(--space-xs)'
                    }}
                  >
                    {!kimiAuthStatus.available ? (
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        ● Binary not found
                      </span>
                    ) : kimiAuthStatus.apiKeyConfigured ? (
                      <span style={{ fontSize: '0.78rem', color: 'var(--accent)' }}>
                        ● API key configured
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.78rem', color: 'var(--color-warning, #d29922)' }}>
                        ● No API key
                      </span>
                    )}
                  </div>
                )}

                <label className="settings-label">Moonshot API key</label>
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--space-sm)',
                    marginBottom: 'var(--space-xs)'
                  }}
                >
                  <input
                    className="settings-select"
                    type="password"
                    value={kimiKeyInput}
                    onChange={(e) => setKimiKeyInput(e.target.value)}
                    placeholder={
                      kimiAuthStatus?.apiKeyConfigured ? '••••••••••• (saved)' : 'moonshot-...'
                    }
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn btn-sm"
                    disabled={!kimiKeyInput.trim()}
                    onClick={() => {
                      onStoreKimiApiKey?.(kimiKeyInput)
                      setKimiKeyInput('')
                    }}
                  >
                    Save
                  </button>
                  {kimiAuthStatus?.apiKeyConfigured && (
                    <button className="btn btn-sm btn-ghost" onClick={onClearKimiApiKey}>
                      Clear
                    </button>
                  )}
                </div>
                <p className="settings-hint">
                  Your Moonshot API key (MOONSHOT_API_KEY). Stored encrypted on-device.
                </p>

                <label className="settings-label">Kimi CLI binary</label>
                <input
                  className="settings-select"
                  value={kimiBinaryPath}
                  onChange={(e) => onChange({ kimiBinaryPath: e.target.value })}
                  placeholder="Auto-detect, or /path/to/kimi"
                />
                <p className="settings-hint">Optional path override for Kimi Code CLI.</p>
              </div>
            </>
          ) /* end providers */
        }

        {/* ── System (merged into the General tab — same `behavior` id) ── */}
        {/*
          Renders alongside the Behavior content above. The original
          standalone "System" tab carried just one settings group
          ("Product operations" — update channel, diagnostics, repair)
          which never warranted a tab of its own; folding it under
          General keeps the operational defaults in one place.
        */}
        {
          activeTab === 'behavior' && (
            <>
              <div className="settings-group span-all">
                <h4 className="sidebar-section-title" style={{ margin: 0 }}>
                  Product operations
                </h4>
                <label className="settings-service-row">
                  <span>Update channel</span>
                  <select
                    className="settings-select"
                    value={updateChannel}
                    onChange={(e) =>
                      onChange({ updateChannel: e.target.value as ProductUpdateChannel })
                    }
                  >
                    {PRODUCT_UPDATE_CHANNEL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="settings-option-list settings-option-list-inline">
                  <button
                    className="btn btn-sm"
                    type="button"
                    onClick={onRefreshProductOperationsStatus}
                  >
                    Refresh health
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    type="button"
                    onClick={onExportProductDiagnostics}
                  >
                    Export diagnostics
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    type="button"
                    onClick={onRepairProductInstall}
                  >
                    Repair install
                  </button>
                </div>
                {/* Phase G2: auto-update status pane. Self-contained so the
            SettingsPanel doesn't need to plumb the snapshot through —
            it reads it via the api binding on mount + listens for live
            updates. */}
                <UpdateStatusPane />

                <p className="settings-hint">
                  {productOperationsStatus
                    ? `Health is ${productOperationsStatus.overallStatus}; ${productOperationsStatus.counts.queuedRuns} queued, ${productOperationsStatus.counts.activeRuns} active, ${productOperationsStatus.recentCrashes.length} recent crash ${productOperationsStatus.recentCrashes.length === 1 ? 'record' : 'records'}.`
                    : 'Product operations health has not been checked yet.'}
                </p>
                {productOperationsStatus && (
                  <p className="settings-hint">
                    Release automation: {productOperationsStatus.releaseAutomation.status};{' '}
                    {productOperationsStatus.releaseAutomation.notarization.message}
                  </p>
                )}
              </div>
            </>
          ) /* end system */
        }

        {/* ── Remote Workspaces (Phase C4) ─────────────────────────────── */}
        {/*
          Remote Workspaces moved into the Devices tab below — it was
          a paired-device allowlist all along, so it lives next to the
          QR pair flow now. Activating the `remote-workspaces` tab id
          (legacy bookmark / restore path) falls through to no render
          here; the sidebar no longer surfaces the tab so this branch
          is effectively dead, but kept defensively until the type
          union sheds the id.
        */}

        {/* ── Workspaces (Codex Environments-style list) ───────────────── */}
        {activeTab === 'workspaces' && (
          <div className="settings-workspaces">
            <div className="settings-workspaces-header">
              <div className="settings-workspaces-header-copy">
                <h3 className="settings-workspaces-subtitle">Loaded workspaces</h3>
                <p className="settings-workspaces-description">
                  Every project folder you&apos;ve pointed AGBench at. Click a row to
                  switch the chat surface to that workspace; pin to keep it at the
                  top of the sidebar; remove to drop it from the list (chats
                  inside the workspace stay on disk).
                </p>
              </div>
              {onSelectWorkspaceDialog && (
                <button
                  type="button"
                  className="btn btn-sm settings-workspaces-add"
                  onClick={onSelectWorkspaceDialog}
                  title="Add a new workspace folder"
                >
                  Add workspace
                </button>
              )}
            </div>
            {workspaces.length === 0 ? (
              <div className="settings-workspaces-empty" role="note">
                <strong>No workspaces yet.</strong>
                <span>
                  Use <em>Add workspace</em> above to point AGBench at your first
                  project folder.
                </span>
              </div>
            ) : (
              <ul className="settings-workspaces-list">
                {workspaces.map((workspace) => {
                  const isActive = currentWorkspace?.id === workspace.id
                  const pathParts = workspace.path.split(/[\\/]/).filter(Boolean)
                  const compactPath =
                    pathParts.length > 3
                      ? `…/${pathParts.slice(-3).join('/')}`
                      : workspace.path
                  return (
                    <li
                      key={workspace.id}
                      className={`settings-workspace-row ${isActive ? 'is-active' : ''} ${workspace.pinned ? 'is-pinned' : ''}`}
                    >
                      <button
                        type="button"
                        className="settings-workspace-tile"
                        onClick={() => {
                          if (!onSelectWorkspace) return
                          onSelectWorkspace(workspace)
                          onClose()
                        }}
                        title={`Open ${workspace.displayName} in the chat surface`}
                      >
                        <span className="settings-workspace-folder" aria-hidden>
                          <svg
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M2.8 4.4h4.1L7.3 5.6h6.5c.6 0 1.1.4 1.1 1v6.2c0 .6-.5 1-1.1 1H2.8C2.2 13.8 1.7 13.4 1.7 12.8V5.5c0-.6.5-1.1 1.1-1.1z" />
                          </svg>
                        </span>
                        <span className="settings-workspace-copy">
                          <span className="settings-workspace-name">{workspace.displayName}</span>
                          <span className="settings-workspace-path">{compactPath}</span>
                          {workspace.branch && (
                            <span className="settings-workspace-branch">
                              branch · {workspace.branch}
                            </span>
                          )}
                        </span>
                      </button>
                      <div className="settings-workspace-actions">
                        {onTogglePinWorkspace && (
                          <button
                            type="button"
                            className={`btn btn-sm btn-ghost ${workspace.pinned ? 'is-pinned' : ''}`}
                            onClick={() => onTogglePinWorkspace(workspace.id)}
                            title={workspace.pinned ? 'Unpin workspace' : 'Pin workspace'}
                          >
                            {workspace.pinned ? 'Unpin' : 'Pin'}
                          </button>
                        )}
                        {onRemoveWorkspace && (
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={() => onRemoveWorkspace(workspace.id)}
                            title="Remove this workspace from the list"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}

        {/* ── Model usage (cross-provider) ──────────────────────────────── */}
        {activeTab === 'model-usage' && (() => {
          // Roll up cross-provider headline stats. We compute these inline
          // (vs. memoising) because the Settings takeover renders are
          // infrequent and the aggregate set is small (<20 entries).
          const allRunEntries = usageSummary.filter(
            (entry) => entry.model && entry.model !== 'usage limits'
          )
          const totalTokens = allRunEntries.reduce(
            (sum, entry) => sum + (entry.totalTokens || 0),
            0
          )
          const totalInputTokens = allRunEntries.reduce(
            (sum, entry) => sum + (entry.inputTokens || 0),
            0
          )
          const totalOutputTokens = allRunEntries.reduce(
            (sum, entry) => sum + (entry.outputTokens || 0),
            0
          )
          const totalRuns = allRunEntries.reduce(
            (sum, entry) => sum + (entry.runs || 0),
            0
          )
          const providerCount = new Set(allRunEntries.map((entry) => entry.provider)).size
          const modelCount = allRunEntries.length
          const comparisonEntries = [...allRunEntries].sort(
            (a, b) => b.totalTokens - a.totalTokens || b.runs - a.runs
          )
          const comparisonTokenTotal = comparisonEntries.reduce(
            (sum, entry) => sum + (entry.totalTokens || 0),
            0
          )
          const quotaEntries = usageSummary.filter((entry) => entry.model === 'usage limits')
          const telemetryEntries = quotaEntries.filter(
            (entry) => (entry.windows?.length || 0) > 0 || (entry.balances?.length || 0) > 0
          )
          const providerLabel = (provider: ProviderId): string => {
            if (provider === 'codex') return 'Codex'
            if (provider === 'claude') return 'Claude'
            if (provider === 'kimi') return 'Kimi'
            return 'Gemini'
          }
          // Rough cost estimate gated on whether the per-row stats
          // carried explicit cost data. Skipped for v1 — keep the
          // tile set focused on counts the user can verify against
          // their provider dashboards.
          const formatLargeNumber = (value: number): string => {
            if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
            if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
            if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
            return String(Math.round(value))
          }
          const formatBalanceValue = (
            amount: number,
            unit: string | undefined
          ): string => {
            const cleanUnit = String(unit || '').trim()
            if (cleanUnit === '$' || cleanUnit.toLowerCase() === 'usd') {
              return `$${amount.toLocaleString(undefined, {
                minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
                maximumFractionDigits: 2
              })}`
            }
            const value =
              Math.abs(amount) >= 1000
                ? formatLargeNumber(amount)
                : amount.toLocaleString(undefined, {
                    maximumFractionDigits: amount % 1 === 0 ? 0 : 2
                  })
            return cleanUnit ? `${value} ${cleanUnit}` : value
          }
          const formatQuotaSource = (source: string | undefined): string =>
            source ? source.replace(/[-_]/g, ' ') : 'live snapshot'
          const formatFetchedAt = (timestamp: string | undefined): string => {
            if (!timestamp) return ''
            const date = new Date(timestamp)
            if (!Number.isFinite(date.getTime())) return ''
            return date.toLocaleString([], {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })
          }
          return (
            <div className="settings-model-usage">
              <p className="settings-model-usage-description">
                Cross-provider token + quota dashboard. Pulled from the same
                aggregate the welcome screen + sidebar consume. To view
                invoices or change payment methods, visit each provider&apos;s
                billing surface directly — AGBench never proxies credentials.
              </p>

              {/* Headline tiles — at-a-glance numbers above the meters. */}
              <div className="settings-model-usage-tiles">
                <div className="settings-model-usage-tile">
                  <span className="settings-model-usage-tile-label">Total tokens</span>
                  <span className="settings-model-usage-tile-value">
                    {formatLargeNumber(totalTokens)}
                  </span>
                  <span className="settings-model-usage-tile-meta">
                    {formatLargeNumber(totalInputTokens)} in ·{' '}
                    {formatLargeNumber(totalOutputTokens)} out
                  </span>
                </div>
                <div className="settings-model-usage-tile">
                  <span className="settings-model-usage-tile-label">Runs</span>
                  <span className="settings-model-usage-tile-value">
                    {formatLargeNumber(totalRuns)}
                  </span>
                  <span className="settings-model-usage-tile-meta">across all chats</span>
                </div>
                <div className="settings-model-usage-tile">
                  <span className="settings-model-usage-tile-label">Providers</span>
                  <span className="settings-model-usage-tile-value">{providerCount}</span>
                  <span className="settings-model-usage-tile-meta">
                    {modelCount} model{modelCount === 1 ? '' : 's'} tracked
                  </span>
                </div>
              </div>

              {/* Existing sidebar card — quota meters per provider + the
                  30-day usage heatmap baked in. Wrapped in a max-width
                  container so it inherits the same legibility budget as
                  the rest of the takeover content. */}
              <div className="settings-model-usage-card">
                <ModelUsageCard usageSummary={usageSummary} />
              </div>

              {comparisonEntries.length > 0 && (
                <section className="settings-model-comparisons" aria-label="Model comparisons">
                  <div className="settings-model-comparisons-header">
                    <span>Model Comparisons</span>
                    <span>Last 30 days</span>
                  </div>
                  <div className="settings-model-comparison-list">
                    {comparisonEntries.map((entry) => {
                      const percent =
                        comparisonTokenTotal > 0
                          ? Math.max(0, Math.min(100, (entry.totalTokens / comparisonTokenTotal) * 100))
                          : 0
                      const fillWidth = `${Math.max(2, percent)}%`
                      return (
                        <div
                          key={`${entry.provider}-${entry.model}`}
                          className={`settings-model-comparison-row provider-${entry.provider}`}
                        >
                          <div className="settings-model-comparison-header">
                            <span
                              className={`settings-model-comparison-dot provider-${entry.provider}`}
                              aria-hidden
                            />
                            <span className="settings-model-comparison-name" title={entry.model}>
                              {entry.model}
                            </span>
                            <span className="settings-model-comparison-tokens">
                              {formatLargeNumber(entry.inputTokens)} in ·{' '}
                              {formatLargeNumber(entry.outputTokens)} out
                            </span>
                            <strong className="settings-model-comparison-percent">
                              {percent.toFixed(1)}%
                            </strong>
                          </div>
                          <div
                            className="settings-model-comparison-track"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={percent}
                            aria-label={`${entry.model} accounts for ${percent.toFixed(1)}% of model usage in the last 30 days`}
                          >
                            <span
                              className={`settings-model-comparison-fill provider-${entry.provider}`}
                              style={{ width: fillWidth }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}

              {telemetryEntries.length > 0 && (
                <section
                  className="settings-provider-telemetry"
                  aria-label="Provider quota and balance telemetry"
                >
                  <div className="settings-provider-telemetry-header">
                    <span>Provider Telemetry</span>
                    <span>Quota windows · balances</span>
                  </div>
                  <div className="settings-provider-telemetry-grid">
                    {telemetryEntries.map((entry) => {
                      const fetchedAt = formatFetchedAt(entry.quotaFetchedAt)
                      return (
                        <article
                          key={`${entry.provider}-telemetry`}
                          className={`settings-provider-telemetry-card provider-${entry.provider}`}
                        >
                          <div className="settings-provider-telemetry-title">
                            <span
                              className={`settings-model-comparison-dot provider-${entry.provider}`}
                              aria-hidden
                            />
                            <strong>{providerLabel(entry.provider)}</strong>
                            {entry.quotaStale && <span>Stale</span>}
                          </div>
                          <div className="settings-provider-telemetry-meta">
                            <span>{entry.windows?.length || 0} quota windows</span>
                            <span>{formatQuotaSource(entry.quotaSource)}</span>
                            {fetchedAt && <span>{fetchedAt}</span>}
                          </div>
                          {(entry.balances?.length || 0) > 0 ? (
                            <div className="settings-provider-balance-list">
                              {entry.balances?.map((balance) => (
                                <div key={balance.id} className="settings-provider-balance">
                                  <span>{balance.label}</span>
                                  <strong>{formatBalanceValue(balance.amount, balance.unit)}</strong>
                                  {balance.subtitle && <small>{balance.subtitle}</small>}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="settings-provider-balance settings-provider-balance-empty">
                              <span>Balance</span>
                              <strong>Unavailable</strong>
                            </div>
                          )}
                        </article>
                      )
                    })}
                  </div>
                </section>
              )}

              {usageSummary.length === 0 && (
                <div className="settings-model-usage-empty" role="note">
                  <strong>No usage data yet.</strong>
                  <span>
                    Start a chat with any provider to populate the meters —
                    AGBench begins tracking on the first completed run.
                  </span>
                </div>
              )}
            </div>
          )
        })()}

        {/* ── Approvals (Phase E2 + admin grants) ──────────────────────── */}
        {activeTab === 'approval-ledger' && (
          <ApprovalLedgerPanel
            workspaceGrants={agenticWorkspaceGrants}
            onRevokeWorkspaceGrant={(grant) =>
              onRemoveAgenticWorkspaceGrant?.(grant.provider, grant.workspacePath, grant.service)
            }
          />
        )}

        {/*
          Bridge Networking + APNs moved into the Devices tab below —
          both are paired-device infrastructure (Bonjour for LAN,
          APNs for off-LAN wake). The legacy `bridge-networking` tab
          id no longer surfaces in the sidebar; this guard is dead
          but kept until the type union sheds the id.
        */}

        {/* ── Pairing (post-1.0.2: folded in from the legacy modal sheet) ── */}
        {activeTab === 'pairing' && <PairingPage />}
      </div>
      {/* end settings-panel-content */}
    </div>
  )
}

interface ApprovalTimeoutFieldProps {
  label: string
  valueMs: number
  disabled?: boolean
  onChange: (ms: number) => void
}

/**
 * ApprovalTimeoutField — labeled seconds input for the per-provider
 * timeout settings. Displays seconds (more readable than ms) but
 * persists ms in the underlying setting.
 */
function ApprovalTimeoutField({
  label,
  valueMs,
  disabled,
  onChange
}: ApprovalTimeoutFieldProps): React.JSX.Element {
  const [draftSec, setDraftSec] = useState<string>(String(Math.round(valueMs / 1000)))

  // Sync local draft when the upstream value changes (e.g. parent
  // re-renders with a fresh settings snapshot). Defer to microtask so
  // React's cascading-render lint guard treats the setState as a
  // detached update rather than a synchronous one.
  useEffect(() => {
    void Promise.resolve().then(() => setDraftSec(String(Math.round(valueMs / 1000))))
  }, [valueMs])

  const commit = (raw: string): void => {
    const parsed = Math.round(Number(raw))
    if (!Number.isFinite(parsed) || parsed <= 0) {
      // Reset to last valid value rather than persisting a bad number.
      setDraftSec(String(Math.round(valueMs / 1000)))
      return
    }
    // Floor + ceil bounds — keep timeouts in a sensible range.
    const clamped = Math.max(5, Math.min(parsed, 3600))
    setDraftSec(String(clamped))
    onChange(clamped * 1000)
  }

  return (
    <label className="approval-timeout-field">
      <span className="approval-timeout-field-label">{label}</span>
      <span className="approval-timeout-field-input-wrap">
        <input
          type="number"
          min={5}
          max={3600}
          step={5}
          className="approval-timeout-field-input"
          value={draftSec}
          disabled={disabled}
          onChange={(e) => setDraftSec(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit((e.target as HTMLInputElement).value)
            }
          }}
        />
        <span className="approval-timeout-field-unit">s</span>
      </span>
    </label>
  )
}
