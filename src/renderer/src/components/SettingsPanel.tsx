import type {
  AgenticNetworkPolicy,
  AgenticServicePolicy,
  AgenticServicesSettings,
  AppearanceMode,
  CodexSandboxFallbackMode,
  GeminiMcpBridgeStatus,
  ProviderCapabilityContract,
  ProviderId,
  ProductOperationsStatus,
  ProductUpdateChannel,
  PromptSurfaceStyle,
  ThemeAccentStyle,
  ThemeAppearance,
  ThemeCornerStyle,
  VisualEffectStyle
} from '../../../main/store/types';

interface SettingsPanelProps {
  mode: AppearanceMode;
  visualEffectStyle: VisualEffectStyle;
  themeAppearance: ThemeAppearance;
  themeCornerStyle: ThemeCornerStyle;
  themeAccentStyle: ThemeAccentStyle;
  promptSurfaceStyle: PromptSurfaceStyle;
  reduceTransparency: boolean;
  reduceMotion: boolean;
  compactDensity: boolean;
  geminiCheckpointingEnabled: boolean;
  chatContextTurns: number;
  claudeBinaryPath: string;
  kimiBinaryPath: string;
  agenticServices: AgenticServicesSettings;
  agenticWorkspaceGrantCount: number;
  activeProvider: ProviderId;
  providerCapabilities?: ProviderCapabilityContract | null;
  geminiMcpBridgeEnabled: boolean;
  geminiMcpBridgeStatus: GeminiMcpBridgeStatus | null;
  codexSandboxFallback: CodexSandboxFallbackMode;
  updateChannel: ProductUpdateChannel;
  productOperationsStatus: ProductOperationsStatus | null;
  onInstallGeminiMcpBridge: () => void;
  onRefreshGeminiMcpBridgeStatus: () => void;
  onRefreshProductOperationsStatus: () => void;
  onExportProductDiagnostics: () => void;
  onRepairProductInstall: () => void;
  onChange: (partial: {
    mode?: AppearanceMode;
    visualEffectStyle?: VisualEffectStyle;
    themeAppearance?: ThemeAppearance;
    themeCornerStyle?: ThemeCornerStyle;
    themeAccentStyle?: ThemeAccentStyle;
    promptSurfaceStyle?: PromptSurfaceStyle;
    reduceTransparency?: boolean;
    reduceMotion?: boolean;
    compactDensity?: boolean;
    geminiCheckpointingEnabled?: boolean;
    chatContextTurns?: number;
    claudeBinaryPath?: string;
    kimiBinaryPath?: string;
    agenticServices?: AgenticServicesSettings;
    geminiMcpBridgeEnabled?: boolean;
    codexSandboxFallback?: CodexSandboxFallbackMode;
    updateChannel?: ProductUpdateChannel;
  }) => void;
  onClose: () => void;
}

const CONTEXT_TURN_OPTIONS = [0, 2, 4, 6, 8, 10, 12, 16, 20];
const VISUAL_EFFECT_OPTIONS: Array<{ value: VisualEffectStyle; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'liquid_glass', label: 'LiquidGlass' },
  { value: 'thin_material', label: 'ultraThinMaterial' },
  { value: 'classic', label: 'PoorMansGlassBackground' }
];
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
  { value: 'candy', label: 'Candy' }
];
const ACCENT_OPTIONS: Array<{ value: ThemeAccentStyle; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'blue', label: 'Blue' },
  { value: 'purple', label: 'Purple' },
  { value: 'pink', label: 'Pink' },
  { value: 'orange', label: 'Orange' },
  { value: 'green', label: 'Green' },
  { value: 'red', label: 'Red' },
  { value: 'yellow', label: 'Yellow' }
];
const PROMPT_SURFACE_OPTIONS: Array<{ value: PromptSurfaceStyle; label: string }> = [
  { value: 'theme', label: 'Follow theme' },
  { value: 'liquid_glass', label: 'Liquid glass' },
  { value: 'classic', label: 'Poor man glass' },
  { value: 'solid', label: 'Solid' }
];
const AGENTIC_SERVICE_POLICY_OPTIONS: Array<{ value: AgenticServicePolicy; label: string }> = [
  { value: 'workspace', label: 'Ask, then allow workspace' },
  { value: 'ask', label: 'Ask every time' },
  { value: 'allow', label: 'Always allow' },
  { value: 'deny', label: 'Block' }
];
const NETWORK_POLICY_OPTIONS: Array<{ value: AgenticNetworkPolicy; label: string }> = [
  { value: 'allow', label: 'Allow' },
  { value: 'deny', label: 'Block' }
];
const CODEX_SANDBOX_FALLBACK_OPTIONS: Array<{ value: CodexSandboxFallbackMode; label: string }> = [
  { value: 'ask_rerun', label: 'Ask to rerun outside sandbox' },
  { value: 'off', label: 'Off' }
];
const PRODUCT_UPDATE_CHANNEL_OPTIONS: Array<{ value: ProductUpdateChannel; label: string }> = [
  { value: 'debug', label: 'Debug' },
  { value: 'stable', label: 'Stable' },
  { value: 'nightly', label: 'Nightly' }
];

export function SettingsPanel({
  mode,
  visualEffectStyle,
  themeAppearance,
  themeCornerStyle,
  themeAccentStyle,
  promptSurfaceStyle,
  reduceTransparency,
  reduceMotion,
  compactDensity,
  geminiCheckpointingEnabled,
  chatContextTurns,
  claudeBinaryPath,
  kimiBinaryPath,
  agenticServices,
  agenticWorkspaceGrantCount,
  activeProvider,
  providerCapabilities,
  geminiMcpBridgeEnabled,
  geminiMcpBridgeStatus,
  codexSandboxFallback,
  updateChannel,
  productOperationsStatus,
  onInstallGeminiMcpBridge,
  onRefreshGeminiMcpBridgeStatus,
  onRefreshProductOperationsStatus,
  onExportProductDiagnostics,
  onRepairProductInstall,
  onChange,
  onClose
}: SettingsPanelProps) {
  const safeTurns = Number.isFinite(chatContextTurns) ? Math.max(0, Math.trunc(chatContextTurns)) : 6;
  const boundedTurns = Math.min(20, safeTurns);
  const updateAgenticService = <K extends keyof AgenticServicesSettings>(key: K, value: AgenticServicesSettings[K]) => {
    onChange({ agenticServices: { ...agenticServices, [key]: value } });
  };

  return (
    <div className="settings-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h4 className="sidebar-section-title" style={{ margin: 0 }}>Appearance</h4>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>Done</button>
      </div>

      <div className="settings-group">
        <label className="settings-label">Glass</label>
        <div className="settings-option-list">
          {VISUAL_EFFECT_OPTIONS.map(option => (
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
      </div>

      <div className="settings-group">
        <label className="settings-label">System theme</label>
        <div className="settings-option-grid">
          {THEME_OPTIONS.map(option => (
            <button
              key={option.value}
              className={`settings-radio-option ${themeAppearance === option.value ? 'active' : ''}`}
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
          {(['rounded', 'hard'] as ThemeCornerStyle[]).map(option => (
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
          {ACCENT_OPTIONS.map(option => (
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
        <label className="settings-label">Prompt bubble</label>
        <select
          className="settings-select"
          value={promptSurfaceStyle}
          onChange={(e) => onChange({ promptSurfaceStyle: e.target.value as PromptSurfaceStyle })}
        >
          {PROMPT_SURFACE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="settings-group">
        <label className="settings-label">Window material</label>
        <div className="settings-option-list settings-option-list-inline">
          {(['solid', 'soft_glass', 'native_glass'] as AppearanceMode[]).map(m => (
            <button
              key={m}
              className={`btn btn-sm ${mode === m ? '' : 'btn-ghost'}`}
              onClick={() => onChange({ mode: m })}
            >
              {m === 'soft_glass' ? 'Soft Glass' : m === 'native_glass' ? 'Native Glass' : 'Solid'}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-group">
        <label className="settings-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
          <input type="checkbox" checked={reduceTransparency} onChange={e => onChange({ reduceTransparency: e.target.checked })} />
          Reduce transparency
        </label>
        <p className="settings-hint">Disables glass effects for better readability and battery life.</p>
      </div>

      <div className="settings-group">
        <label className="settings-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
          <input type="checkbox" checked={reduceMotion} onChange={e => onChange({ reduceMotion: e.target.checked })} />
          Reduce motion
        </label>
        <p className="settings-hint">Minimizes animations for accessibility.</p>
      </div>

      <div className="settings-group">
        <label className="settings-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
          <input type="checkbox" checked={compactDensity} onChange={e => onChange({ compactDensity: e.target.checked })} />
          Compact density
        </label>
        <p className="settings-hint">Tighter spacing throughout the interface.</p>
      </div>

      <div className="settings-group">
        <label className="settings-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
          <input type="checkbox" checked={geminiCheckpointingEnabled} onChange={e => onChange({ geminiCheckpointingEnabled: e.target.checked })} />
          Gemini checkpointing
        </label>
        <p className="settings-hint">Starts new Gemini CLI runs and persistent sessions with --checkpointing. Restart an active persistent session to apply changes.</p>
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
          Max recent user/assistant turns to include with each prompt for continuity. 0 sends only the current message.
        </p>
      </div>

      <div className="settings-group">
        <h4 className="sidebar-section-title" style={{ margin: 0 }}>Agentic services</h4>
        <div className="settings-service-list">
          <label className="settings-service-row">
            <span>Shell commands</span>
            <select
              className="settings-select"
              value={agenticServices.shellCommands}
              onChange={(e) => updateAgenticService('shellCommands', e.target.value as AgenticServicePolicy)}
            >
              {AGENTIC_SERVICE_POLICY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="settings-service-row">
            <span>File changes</span>
            <select
              className="settings-select"
              value={agenticServices.fileChanges}
              onChange={(e) => updateAgenticService('fileChanges', e.target.value as AgenticServicePolicy)}
            >
              {AGENTIC_SERVICE_POLICY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="settings-service-row">
            <span>MCP and tools</span>
            <select
              className="settings-select"
              value={agenticServices.mcpTools}
              onChange={(e) => updateAgenticService('mcpTools', e.target.value as AgenticServicePolicy)}
            >
              {AGENTIC_SERVICE_POLICY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="settings-service-row">
            <span>Network access</span>
            <select
              className="settings-select"
              value={agenticServices.networkAccess}
              onChange={(e) => updateAgenticService('networkAccess', e.target.value as AgenticNetworkPolicy)}
            >
              {NETWORK_POLICY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="settings-hint">{agenticWorkspaceGrantCount} workspace permission {agenticWorkspaceGrantCount === 1 ? 'grant' : 'grants'} saved.</p>

        {providerCapabilities && (
          <div className="settings-hint">
            Active provider contract: {providerCapabilities.label} shell is {providerCapabilities.tools.shellCommands.state}, files are {providerCapabilities.tools.fileChanges.state}, MCP is {providerCapabilities.mcp.state}.
          </div>
        )}
        {!providerCapabilities && (
          <div className="settings-hint">
            Active provider contract for {activeProvider} will appear after the next capability refresh.
          </div>
        )}

        <label className="settings-service-row">
          <span>Codex sandbox fallback</span>
          <select
            className="settings-select"
            value={codexSandboxFallback}
            onChange={(e) => onChange({ codexSandboxFallback: e.target.value as CodexSandboxFallbackMode })}
          >
            {CODEX_SANDBOX_FALLBACK_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <p className="settings-hint">When Codex hits a Swift/Xcode sandbox/tooling collision, AgentBench can ask to rerun that exact command once from the host process.</p>

        <div className="settings-service-row" style={{ alignItems: 'flex-start' }}>
          <span>Gemini MCP bridge</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', minWidth: 0 }}>
            <label className="settings-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer', margin: 0 }}>
              <input
                type="checkbox"
                checked={geminiMcpBridgeEnabled}
                onChange={(e) => onChange({ geminiMcpBridgeEnabled: e.target.checked })}
              />
              Enabled
            </label>
            <div className="settings-option-list settings-option-list-inline">
              <button className="btn btn-sm" type="button" onClick={onInstallGeminiMcpBridge}>
                Install / repair
              </button>
              <button className="btn btn-sm btn-ghost" type="button" onClick={onRefreshGeminiMcpBridgeStatus}>
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
        <h4 className="sidebar-section-title" style={{ margin: 0 }}>Product operations</h4>
        <label className="settings-service-row">
          <span>Update channel</span>
          <select
            className="settings-select"
            value={updateChannel}
            onChange={(e) => onChange({ updateChannel: e.target.value as ProductUpdateChannel })}
          >
            {PRODUCT_UPDATE_CHANNEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <div className="settings-option-list settings-option-list-inline">
          <button className="btn btn-sm" type="button" onClick={onRefreshProductOperationsStatus}>
            Refresh health
          </button>
          <button className="btn btn-sm btn-ghost" type="button" onClick={onExportProductDiagnostics}>
            Export diagnostics
          </button>
          <button className="btn btn-sm btn-ghost" type="button" onClick={onRepairProductInstall}>
            Repair install
          </button>
        </div>
        <p className="settings-hint">
          {productOperationsStatus
            ? `Health is ${productOperationsStatus.overallStatus}; ${productOperationsStatus.counts.queuedRuns} queued, ${productOperationsStatus.counts.activeRuns} active, ${productOperationsStatus.recentCrashes.length} recent crash ${productOperationsStatus.recentCrashes.length === 1 ? 'record' : 'records'}.`
            : 'Product operations health has not been checked yet.'}
        </p>
        {productOperationsStatus && (
          <p className="settings-hint">
            Release automation: {productOperationsStatus.releaseAutomation.status}; {productOperationsStatus.releaseAutomation.notarization.message}
          </p>
        )}
      </div>

      <div className="settings-group">
        <label className="settings-label">Claude CLI binary</label>
        <input
          className="settings-select"
          value={claudeBinaryPath}
          onChange={(e) => onChange({ claudeBinaryPath: e.target.value })}
          placeholder="Auto-detect, or /Users/you/.local/bin/claude"
        />
        <p className="settings-hint">Optional override. Credentials stay in Claude Code; this app only launches the binary.</p>
      </div>

      <div className="settings-group">
        <label className="settings-label">Kimi CLI binary</label>
        <input
          className="settings-select"
          value={kimiBinaryPath}
          onChange={(e) => onChange({ kimiBinaryPath: e.target.value })}
          placeholder="Auto-detect, or /path/to/kimi"
        />
        <p className="settings-hint">Optional override for Kimi Code CLI. Credential files are not parsed by the app.</p>
      </div>

    </div>
  );
}
