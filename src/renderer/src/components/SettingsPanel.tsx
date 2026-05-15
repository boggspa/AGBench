import { useState } from 'react';
import type {
  AgenticNetworkPolicy,
  AgenticServicePolicy,
  AgenticServicesSettings,
  AppearanceMode,
  CodexSandboxFallbackMode,
  AppSettings,
  GeminiMcpBridgeStatus,
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
  VisualEffectStyle
} from '../../../main/store/types';
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
} from '../lib/typefaceOptions';

interface SettingsPanelProps {
  mode: AppearanceMode;
  visualEffectStyle: VisualEffectStyle;
  themeAppearance: ThemeAppearance;
  themeCornerStyle: ThemeCornerStyle;
  themeAccentStyle: ThemeAccentStyle;
  promptSurfaceStyle: PromptSurfaceStyle;
  composerStyle: ComposerStyle;
  transcriptFontFamily: string;
  composerFontFamily: string;
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
  funFxEnabled: boolean;
  funFxMode: AppSettings['funFxMode'];
  advancedFx: AppSettings['advancedFx'];
  updateChannel: ProductUpdateChannel;
  productOperationsStatus: ProductOperationsStatus | null;
  claudeAuthStatus?: ProviderApiKeyStatus | null;
  kimiAuthStatus?: ProviderApiKeyStatus | null;
  claudeLoginState?: 'idle' | 'loading' | 'success' | 'error';
  onTriggerClaudeLogin?: () => void;
  onStoreClaudeApiKey?: (key: string) => void;
  onClearClaudeApiKey?: () => void;
  onStoreKimiApiKey?: (key: string) => void;
  onClearKimiApiKey?: () => void;
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
    composerStyle?: ComposerStyle;
    transcriptFontFamily?: string;
    composerFontFamily?: string;
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
    funFxEnabled?: boolean;
    funFxMode?: AppSettings['funFxMode'];
    advancedFx?: AppSettings['advancedFx'];
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
const COMPOSER_STYLE_OPTIONS: Array<{ value: ComposerStyle; label: string; helper: string }> = [
  { value: 'default', label: 'AGBench native', helper: 'Provider chrome off; keep the existing AGBench shell.' },
  { value: 'codex', label: 'Codex shell', helper: 'Codex-like sidebar, transcript, status bar, and composer hierarchy.' },
  { value: 'claude', label: 'Claude shell', helper: 'Claude-like sidebar, transcript, status bar, and composer hierarchy.' },
  { value: 'gemini', label: 'Gemini shell', helper: 'Gemini-like minimal pill composer, centered welcome, blue focus glow.' },
  { value: 'kimi', label: 'Kimi shell', helper: 'Kimi-like dark rounded composer, green-yellow accent, minimal sidebar.' }
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
const FUN_FX_MODES: Array<{ value: AppSettings['funFxMode']; label: string; helper: string }> = [
  { value: 'off', label: 'Off', helper: 'No cinematic effects.' },
  { value: 'subtle', label: 'Subtle', helper: 'One effect layer with gentle motion.' },
  { value: 'cinematic', label: 'Cinematic', helper: 'Sky + ghost in synchronized balance.' },
  { value: 'epic', label: 'Epic', helper: 'Adds additional ambient scene accents.' }
];

type SettingsTab = 'appearance' | 'behavior' | 'providers' | 'system';

type LocalFontData = {
  family?: string;
  fullName?: string;
  postscriptName?: string;
};

type LocalFontWindow = Window & {
  queryLocalFonts?: () => Promise<LocalFontData[]>;
};

export function SettingsPanel({
  mode,
  visualEffectStyle,
  themeAppearance,
  themeCornerStyle,
  themeAccentStyle,
  promptSurfaceStyle,
  composerStyle,
  transcriptFontFamily,
  composerFontFamily,
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
  funFxEnabled,
  funFxMode,
  advancedFx,
  updateChannel,
  productOperationsStatus,
  claudeAuthStatus,
  kimiAuthStatus,
  claudeLoginState = 'idle',
  onTriggerClaudeLogin,
  onStoreClaudeApiKey,
  onClearClaudeApiKey,
  onStoreKimiApiKey,
  onClearKimiApiKey,
  onInstallGeminiMcpBridge,
  onRefreshGeminiMcpBridgeStatus,
  onRefreshProductOperationsStatus,
  onExportProductDiagnostics,
  onRepairProductInstall,
  onChange,
  onClose
}: SettingsPanelProps) {
  const [claudeKeyInput, setClaudeKeyInput] = useState('');
  const [kimiKeyInput, setKimiKeyInput] = useState('');
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const [installedFontOptions, setInstalledFontOptions] = useState<TypefaceOption[]>([]);
  const [installedFontStatus, setInstalledFontStatus] = useState('');
  const safeTurns = Number.isFinite(chatContextTurns) ? Math.max(0, Math.trunc(chatContextTurns)) : 6;
  const boundedTurns = Math.min(20, safeTurns);
  const transcriptFontOptions = [...TRANSCRIPT_FONT_OPTIONS, ...installedFontOptions];
  const composerFontOptions = [...COMPOSER_FONT_OPTIONS, ...installedFontOptions];
  const transcriptFontSelectValue = getFontSelectValue(transcriptFontOptions, transcriptFontFamily || FONT_STACKS.agbench);
  const composerFontSelectValue = getFontSelectValue(
    composerFontOptions,
    composerFontFamily || COMPOSER_FONT_MATCH_TRANSCRIPT
  );
  const previewComposerFontFamily = resolveComposerFontFamily(composerFontFamily, transcriptFontFamily);
  const canLoadInstalledFonts =
    typeof window !== 'undefined' &&
    typeof (window as LocalFontWindow).queryLocalFonts === 'function';
  const updateAgenticService = <K extends keyof AgenticServicesSettings>(key: K, value: AgenticServicesSettings[K]) => {
    onChange({ agenticServices: { ...agenticServices, [key]: value } });
  };
  const handleLoadInstalledFonts = async () => {
    const queryLocalFonts = (window as LocalFontWindow).queryLocalFonts;
    if (!queryLocalFonts) {
      setInstalledFontStatus('Installed font discovery is not available in this runtime.');
      return;
    }

    setInstalledFontStatus('Requesting local font access...');
    try {
      const fonts = await queryLocalFonts();
      const families = Array.from(new Set(
        fonts
          .map(font => font.family || font.fullName || font.postscriptName || '')
          .map(name => name.trim())
          .filter(Boolean)
      ))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 160);

      setInstalledFontOptions(
        families.map(family => ({
          label: family,
          value: quoteInstalledFontFamily(family)
        }))
      );
      setInstalledFontStatus(
        families.length > 0
          ? `${families.length} installed font families loaded.`
          : 'No installed font families were returned.'
      );
    } catch {
      setInstalledFontStatus('Local font access was denied or unavailable.');
    }
  };
  const updateAdvancedFx = (partial: Partial<AppSettings['advancedFx']>) => {
    onChange({ advancedFx: { ...advancedFx, ...partial } });
  };

  const TABS: Array<{ id: SettingsTab; label: string }> = [
    { id: 'appearance', label: 'Appearance' },
    { id: 'behavior', label: 'Behavior' },
    { id: 'providers', label: 'Providers' },
    { id: 'system', label: 'System' },
  ];

  return (
    <div className="settings-panel">
      {/* Sticky header with tabs */}
      <div className="settings-panel-header">
        <div className="settings-tab-bar">
          {TABS.map(tab => (
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
        <button className="btn btn-sm btn-ghost" onClick={onClose}>Done</button>
      </div>

      <div className="settings-panel-content">

      {/* ── Appearance ─────────────────────────────────── */}
      {activeTab === 'appearance' && <>

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
        <label className="settings-label">Interface shell</label>
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
          {COMPOSER_STYLE_OPTIONS.find((option) => option.value === composerStyle)?.helper}
        </p>
      </div>

      <div className="settings-group settings-typography-group">
        <label className="settings-label">Typography</label>
        <div className="settings-typography-grid">
          <div className="settings-field">
            <span className="settings-field-label">Transcript font</span>
            <select
              className="settings-select"
              value={transcriptFontSelectValue}
              onChange={(e) => {
                const value = e.target.value;
                onChange({
                  transcriptFontFamily:
                    value === CUSTOM_FONT_SELECT_VALUE
                      ? (transcriptFontSelectValue === CUSTOM_FONT_SELECT_VALUE ? transcriptFontFamily : CUSTOM_FONT_FALLBACK)
                      : value
                });
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
                const value = e.target.value;
                onChange({
                  composerFontFamily:
                    value === CUSTOM_FONT_SELECT_VALUE
                      ? (composerFontSelectValue === CUSTOM_FONT_SELECT_VALUE ? composerFontFamily : CUSTOM_FONT_FALLBACK)
                      : value
                });
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
            {installedFontStatus || (canLoadInstalledFonts ? 'Optional local font permission.' : 'Installed font discovery unavailable; custom CSS font-family still works.')}
          </span>
        </div>
        <div className="settings-typography-preview">
          <div className="settings-typography-preview-text" style={{ fontFamily: transcriptFontFamily || FONT_STACKS.agbench }}>
            Assistant transcript text uses this typeface.
          </div>
          <div className="settings-typography-preview-composer" style={{ fontFamily: previewComposerFontFamily }}>
            Composer prompt placeholder preview
          </div>
        </div>
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
          <input type="checkbox" checked={funFxEnabled} onChange={e => onChange({ funFxEnabled: e.target.checked })} />
          Epic FX
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
        <p className="settings-hint">
          {funFxMode === 'off' ? 'Epic FX disabled.' : (FUN_FX_MODES.find((option) => option.value === funFxMode)?.helper || FUN_FX_MODES[2].helper)}
        </p>
      </div>

      <div className="settings-group settings-fx-labs span-all">
        <label className="settings-label">FX Labs</label>
        <p className="settings-hint">
          Opt-in visual layers for agent ambience, workspace atmosphere, and live run telemetry. Disabled automatically when Reduce motion is enabled.
        </p>
        <label className="settings-service-row settings-fx-toggle">
          <span>
            Agent Aura
            <small>Provider-colored backgrounds, composer rims, inspector edges, and run-state bursts.</small>
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
            <small>Extends Sky/Weather with parallax depth, motes, weather particles, and room-light glow.</small>
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
            <small>Lightweight SVG overlays for token flow, queue lanes, tool pulses, approvals, and progress.</small>
          </span>
          <input
            type="checkbox"
            checked={!reduceMotion && funFxEnabled && advancedFx.dataViz}
            disabled={reduceMotion || !funFxEnabled}
            onChange={(e) => updateAdvancedFx({ dataViz: e.target.checked })}
          />
        </label>
        <div className="settings-option-list settings-option-list-inline">
          {FUN_FX_MODES.filter((option) => option.value !== 'off').map((option) => (
            <button
              key={option.value}
              className={`btn btn-sm ${advancedFx.intensity === option.value ? '' : 'btn-ghost'}`}
              disabled={reduceMotion || !funFxEnabled}
              onClick={() => updateAdvancedFx({ intensity: option.value as AppSettings['advancedFx']['intensity'] })}
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
      </div>

      <div className="settings-group">
        <label className="settings-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
          <input type="checkbox" checked={compactDensity} onChange={e => onChange({ compactDensity: e.target.checked })} />
          Compact density
        </label>
        <p className="settings-hint">Tighter spacing throughout the interface.</p>
      </div>

      </> /* end appearance */}

      {/* ── Behavior ─────────────────────────────────── */}
      {activeTab === 'behavior' && <>

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

      </> /* end behavior */}

      {/* ── Providers ─────────────────────────────────── */}
      {activeTab === 'providers' && <>

      <div className="settings-group span-all">
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
            Active provider contract: {providerCapabilities.label} shell is {providerCapabilities.tools.shellCommands.state}, files are {providerCapabilities.tools.fileChanges.state}, MCP is {providerCapabilities.mcp.state}; {Object.values(providerCapabilities.tools).filter((tool) => tool.enforcedByAgentBench).length}/{Object.values(providerCapabilities.tools).length} controls are AGBench-enforced.
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
        <p className="settings-hint">When Codex hits a Swift/Xcode sandbox/tooling collision, AGBench can ask to rerun that exact command once from the host process.</p>

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
        <h4 className="sidebar-section-title" style={{ margin: 0 }}>Claude</h4>

        {claudeAuthStatus && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
            {!claudeAuthStatus.available ? (
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>● Binary not found</span>
            ) : claudeAuthStatus.apiKeyConfigured ? (
              <span style={{ fontSize: '0.78rem', color: 'var(--accent)' }}>● API key configured</span>
            ) : claudeAuthStatus.authState && !['not logged in', 'not authenticated', 'unauthenticated', 'error'].some(p => claudeAuthStatus.authState.toLowerCase().includes(p)) ? (
              <span style={{ fontSize: '0.78rem', color: 'var(--color-success, #3fb950)' }}>● Authenticated</span>
            ) : (
              <span style={{ fontSize: '0.78rem', color: 'var(--color-warning, #d29922)' }}>● Not authenticated</span>
            )}
            {claudeAuthStatus.version && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{claudeAuthStatus.version}</span>
            )}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: 'var(--space-xs)' }}>
          <button
            className="btn btn-sm"
            disabled={claudeLoginState === 'loading'}
            onClick={onTriggerClaudeLogin}
          >
            {claudeLoginState === 'loading' ? 'Opening browser...' : 'Login with Claude Code →'}
          </button>
          {claudeLoginState === 'success' && (
            <span className="settings-hint" style={{ margin: 0, color: 'var(--color-success, #3fb950)' }}>Browser opened</span>
          )}
          {claudeLoginState === 'error' && (
            <span className="settings-hint" style={{ margin: 0, color: 'var(--color-danger, #f85149)' }}>Login failed — check CLI is installed</span>
          )}
        </div>
        <p className="settings-hint">
          Claude runs inside AGBench use Agent SDK / <code>claude -p</code> programmatic paths. From 2026-06-15 Anthropic says these use separate Agent SDK credit, not normal interactive Claude Code subscription limits. Use Claude in an interactive terminal when you specifically need native Claude Code subscription-limit behavior.
        </p>

        <label className="settings-label">Anthropic API key</label>
        <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
          <input
            className="settings-select"
            type="password"
            value={claudeKeyInput}
            onChange={(e) => setClaudeKeyInput(e.target.value)}
            placeholder={claudeAuthStatus?.apiKeyConfigured ? '••••••••••• (saved)' : 'sk-ant-...'}
            style={{ flex: 1 }}
          />
          <button
            className="btn btn-sm"
            disabled={!claudeKeyInput.trim()}
            onClick={() => { onStoreClaudeApiKey?.(claudeKeyInput); setClaudeKeyInput(''); }}
          >
            Save
          </button>
          {claudeAuthStatus?.apiKeyConfigured && (
            <button className="btn btn-sm btn-ghost" onClick={onClearClaudeApiKey}>
              Clear
            </button>
          )}
        </div>
        <p className="settings-hint">API key takes priority over the Claude Code login session and uses API/PAYG billing. Stored encrypted on-device.</p>

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
        <h4 className="sidebar-section-title" style={{ margin: 0 }}>Kimi</h4>

        {kimiAuthStatus && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
            {!kimiAuthStatus.available ? (
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>● Binary not found</span>
            ) : kimiAuthStatus.apiKeyConfigured ? (
              <span style={{ fontSize: '0.78rem', color: 'var(--accent)' }}>● API key configured</span>
            ) : (
              <span style={{ fontSize: '0.78rem', color: 'var(--color-warning, #d29922)' }}>● No API key</span>
            )}
          </div>
        )}

        <label className="settings-label">Moonshot API key</label>
        <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
          <input
            className="settings-select"
            type="password"
            value={kimiKeyInput}
            onChange={(e) => setKimiKeyInput(e.target.value)}
            placeholder={kimiAuthStatus?.apiKeyConfigured ? '••••••••••• (saved)' : 'moonshot-...'}
            style={{ flex: 1 }}
          />
          <button
            className="btn btn-sm"
            disabled={!kimiKeyInput.trim()}
            onClick={() => { onStoreKimiApiKey?.(kimiKeyInput); setKimiKeyInput(''); }}
          >
            Save
          </button>
          {kimiAuthStatus?.apiKeyConfigured && (
            <button className="btn btn-sm btn-ghost" onClick={onClearKimiApiKey}>
              Clear
            </button>
          )}
        </div>
        <p className="settings-hint">Your Moonshot API key (MOONSHOT_API_KEY). Stored encrypted on-device.</p>

        <label className="settings-label">Kimi CLI binary</label>
        <input
          className="settings-select"
          value={kimiBinaryPath}
          onChange={(e) => onChange({ kimiBinaryPath: e.target.value })}
          placeholder="Auto-detect, or /path/to/kimi"
        />
        <p className="settings-hint">Optional path override for Kimi Code CLI.</p>
      </div>

      </> /* end providers */}

      {/* ── System ─────────────────────────────────── */}
      {activeTab === 'system' && <>

      <div className="settings-group span-all">
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

      </> /* end system */}

      </div>{/* end settings-panel-content */}
    </div>
  );
}
