import React, { useEffect, useRef } from 'react'
import type {
  AppSettings,
  ComposerStyle,
  GeminiAuthStatus,
  ProviderApiKeyStatus,
  ThemeAppearance,
  UserBubbleColor
} from '../../../main/store/types'
import {
  summariseCliProviderEnabled,
  summariseCodexStatus,
  summariseGeminiStatus,
  summariseProviderApiKeyStatus,
  type ProviderAuthVariant
} from '../lib/providerAuthSummary'
import agbenchGhostMark from '../assets/agbench-ghost-mark.svg'
import codexLogo from '../assets/provider-logos/codex.png'
import claudeLogo from '../assets/provider-logos/claude.png'
import cursorLogo from '../assets/provider-logos/cursor.png'
import geminiLogo from '../assets/provider-logos/gemini.png'
import grokLogo from '../assets/provider-logos/grok.png'
import kimiLogo from '../assets/provider-logos/kimi.png'

/** Onboarding provider-card ids. Cursor + Grok are CLI-login providers
 *  added in 1.0.6 and now use the same raster-logo path as the
 *  original four providers. */
type OnboardingProviderId = 'codex' | 'claude' | 'gemini' | 'kimi' | 'cursor' | 'grok'

const PROVIDER_LOGOS: Partial<Record<OnboardingProviderId, string>> = {
  codex: codexLogo,
  claude: claudeLogo,
  cursor: cursorLogo,
  gemini: geminiLogo,
  grok: grokLogo,
  kimi: kimiLogo
}

/**
 * FirstLaunchSheet — onboarding overlay for fresh AGBench testers.
 *
 * Auto-shows on first launch (gated by a localStorage flag in App.tsx)
 * and can be re-opened anytime via the `?` button in the chat-corner
 * controls. Replaces the lightweight T1b sidebar hint as the primary
 * onboarding surface; the sidebar hint remains as a passive inline
 * reminder once the sheet is dismissed.
 *
 * Trade-offs (per the work scope):
 *   1. **Sheet not wizard.** One scrollable sheet with five sections
 *      reads slightly more content-dense than a 4-step wizard, but
 *      it's half the JSX, easier to test, and lets the user skim
 *      sections out of order. A wizard is the right next iteration
 *      if testers report friction.
 *
 *   2. **Deep-link to Settings for auth.** Per-provider sign-in flows
 *      (Claude OAuth + API key, Gemini OAuth + profile management,
 *      Kimi API key) live in `SettingsPanel.tsx` and are tightly
 *      coupled to App-owned state + main-process IPC. Recreating
 *      them inline would mean lifting that wiring into yet another
 *      surface. Cards here show status only and deep-link via
 *      `onOpenSettings()` — the host opens Settings and the user
 *      finishes the flow there. Codex is a special case: it has
 *      no in-app auth UI today (the user signs in to the OS
 *      `codex` CLI via `codex login` in their shell), so the card
 *      surfaces the shell command directly with a copy affordance.
 *
 *   3. **Sidebar hint retained.** Per the "safer" path in the spec:
 *      the lightweight sidebar hint card (T1b) still renders for
 *      empty workspaces. Its dismissal X persists independently
 *      from the sheet's dismissal flag. This gives a tester two
 *      surfaces for the same prompt without coupling them.
 *
 * Pointer animation: handled by the host (App.tsx) — when the sheet
 * dismisses for the first time, the host flips a transient flag that
 * tells the sidebar's `+` workspace button to render a pulsing
 * highlight + a small "Start here" label for ~6 seconds.
 */

export interface FirstLaunchSheetProps {
  /** Sheet visibility. Host owns the flag; sheet has no internal show
   * state so we don't double-source it. */
  open: boolean
  /** Called when the user dismisses via "Got it", Skip, Esc, or
   * click-outside. The host persists the dismissal flag AND triggers
   * the first-time pointer animation. */
  onDismiss: () => void
  /** Deep-link callback. Closes the sheet and opens the Settings
   * panel — the user finishes provider sign-in there. */
  onOpenSettings: () => void
  /** 1.0.6-CRUX42 — open a Terminal running the Cursor/Grok CLI login. */
  onProviderLogin?: (provider: OnboardingProviderId) => void
  /** Codex CLI status. Pulled from `agentStatusByProvider.codex` or
   * the top-level `codexStatus` in App.tsx. Used to decide whether
   * to show "signed in" / "binary not found" / "not authenticated".
   * Loose any-shape since the underlying store type isn't strict. */
  codexStatus: any
  /** Claude / Kimi auth status objects from App.tsx. */
  claudeAuthStatus: ProviderApiKeyStatus | null
  kimiAuthStatus: ProviderApiKeyStatus | null
  /** Gemini auth status. Carries profile info; we only need the
   * top-level "is there an active profile" check. */
  geminiAuthStatus: GeminiAuthStatus | null
  /** Cursor / Grok are CLI-login providers (1.0.6). AGBench only knows
   * whether each adapter is registered (enabled) — auth lives in their own
   * CLI — so the cards surface availability + deep-link to Settings.
   * Optional so older hosts / static tests can omit them. */
  cursorProviderAvailable?: boolean
  grokProviderAvailable?: boolean
  /** Appearance controls are optional so static tests and older hosts
   * can render the sheet without wiring the preference preview. */
  themeAppearance?: ThemeAppearance
  composerStyle?: ComposerStyle
  userBubbleColor?: UserBubbleColor
  onAppearancePreviewChange?: (
    next: Partial<Pick<AppSettings, 'themeAppearance' | 'composerStyle' | 'userBubbleColor'>>
  ) => void
}

type ProviderRowVariant = ProviderAuthVariant

interface ProviderRowSpec {
  id: OnboardingProviderId
  label: string
  description: string
  variant: ProviderRowVariant
  statusText: string
  /** Optional "what to do" hint. Renders below the status pill. */
  hint: string
  /** When true, the card is visually de-emphasised — used for Kimi
   * (a tester doesn't have a Kimi account and isn't expected to sign up). */
  deemphasised?: boolean
  /** When true, the card is marked optional but still actionable. */
  optional?: boolean
}

const SHEET_TITLE_ID = 'first-launch-sheet-title'

const ONBOARDING_THEME_OPTIONS: Array<{ value: ThemeAppearance; label: string }> = [
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
  { value: 'sage', label: 'Sage' },
  // 1.0.5-EW65 — Surface the EW54/EW61 premium-stone themes
  // in the first-launch picker so new users see them at the
  // onboarding moment (the original window when most theme
  // exploration happens).
  { value: 'obsidian', label: 'Obsidian' },
  { value: 'alabaster', label: 'Alabaster' }
]

const ONBOARDING_COMPOSER_OPTIONS: Array<{ value: ComposerStyle; label: string }> = [
  { value: 'default', label: 'AGBench native' },
  { value: 'codex', label: 'Codex shell' },
  { value: 'claude', label: 'Claude shell' },
  { value: 'cursor', label: 'Cursor shell' },
  { value: 'grok', label: 'Grok shell' },
  { value: 'gemini', label: 'Gemini shell' },
  { value: 'kimi', label: 'Kimi shell' },
  { value: 'modular', label: 'Modular' },
  { value: 'terminal', label: 'Terminal' },
  { value: 'stub', label: 'Ticket stub' },
  { value: 'satellite', label: 'Satellite' },
  // 1.0.5-EW65 — Pair the EW55/EW61 premium composer styles
  // with their themes in the picker. Both are theme-immune so
  // they work paired with any theme; presenting them adjacent
  // in the list keeps the picker honest about the family.
  { value: 'obsidian', label: 'Obsidian' },
  { value: 'alabaster', label: 'Alabaster' }
]

const ONBOARDING_BUBBLE_OPTIONS: Array<{ value: UserBubbleColor; label: string }> = [
  { value: 'system', label: 'Default' },
  { value: 'blue', label: 'Blue' },
  { value: 'purple', label: 'Purple' },
  { value: 'pink', label: 'Pink' },
  { value: 'orange', label: 'Orange' },
  { value: 'green', label: 'Green' },
  { value: 'red', label: 'Red' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'graphite', label: 'Graphite' }
]

function getOnboardingComposerPreview(style: ComposerStyle): {
  provider: 'codex' | 'claude' | 'gemini' | 'kimi'
  providerLabel: string
  modelLabel: string
  permissionLabel: string
  placeholder: string
} {
  switch (style) {
    case 'codex':
      return {
        provider: 'codex',
        providerLabel: 'Codex',
        modelLabel: 'GPT-5.5',
        permissionLabel: 'Full Workspace Access',
        placeholder: 'Ask Codex anything. @ to mention files'
      }
    case 'claude':
      return {
        provider: 'claude',
        providerLabel: 'Claude',
        // 1.0.6 — Opus 4.8 is the current default (4.7 now "Legacy").
        modelLabel: 'Opus 4.8',
        permissionLabel: 'Plan / Read-only',
        placeholder: 'Describe a task or ask a question'
      }
    case 'cursor':
      // Preview-only. Cursor here is the VISUAL shell, not the
      // ProviderId 'cursor' — keep `provider: 'gemini'` (its layout
      // heritage) for the preview's provider class; the flat-gray
      // Cursor CSS strips all chroma anyway.
      return {
        provider: 'gemini',
        providerLabel: 'Cursor',
        modelLabel: 'Composer 2.5',
        permissionLabel: 'Default Approval',
        placeholder: 'Enter prompt for Cursor…'
      }
    case 'grok':
      // Preview-only. Grok is a visual shell, not a provider — keep
      // `provider: 'gemini'` (its layout heritage) for the preview's
      // provider class; the Grok CSS strips all chroma anyway.
      return {
        provider: 'gemini',
        providerLabel: 'Grok',
        // 1.0.6 — live Grok composer shows "Grok Build 0.1" (Fast is a mode).
        modelLabel: 'Grok Build 0.1',
        permissionLabel: 'Default Approval',
        placeholder: 'What do you want to know?'
      }
    case 'gemini':
      return {
        provider: 'gemini',
        providerLabel: 'Gemini',
        modelLabel: 'Pro 3.1',
        permissionLabel: 'Default Approval',
        placeholder: 'Ask Gemini'
      }
    case 'kimi':
      return {
        provider: 'kimi',
        providerLabel: 'Kimi',
        modelLabel: 'K2.6',
        permissionLabel: 'Read workspace',
        placeholder: 'Type "/" to use quick actions'
      }
    case 'obsidian':
      // 1.0.5-EW65 — Premium dark composer. Placeholder reads
      // restrained on purpose; the rim-shine chase animation +
      // solid charcoal fill carry the identity in the preview.
      return {
        provider: 'codex',
        providerLabel: 'AGBench',
        modelLabel: 'Auto',
        permissionLabel: 'Premium',
        placeholder: 'Compose…'
      }
    case 'alabaster':
      // 1.0.5-EW65 — Polar twin of Obsidian. Same restrained
      // preview copy; the cream fill + charcoal rim chase
      // carry the identity.
      return {
        provider: 'codex',
        providerLabel: 'AGBench',
        modelLabel: 'Auto',
        permissionLabel: 'Premium',
        placeholder: 'Compose…'
      }
    default:
      return {
        provider: 'codex',
        providerLabel: 'AGBench',
        modelLabel: 'Auto',
        permissionLabel: 'Default Approval',
        placeholder: 'Ask anything...'
      }
  }
}

export function FirstLaunchSheet({
  open,
  onDismiss,
  onOpenSettings,
  onProviderLogin,
  codexStatus,
  claudeAuthStatus,
  kimiAuthStatus,
  geminiAuthStatus,
  cursorProviderAvailable = false,
  grokProviderAvailable = false,
  themeAppearance = 'system',
  composerStyle = 'default',
  userBubbleColor = 'system',
  onAppearancePreviewChange
}: FirstLaunchSheetProps): React.JSX.Element | null {
  const dismissRef = useRef(onDismiss)
  useEffect(() => {
    dismissRef.current = onDismiss
  }, [onDismiss])

  // Esc-to-dismiss. Capture-phase listener so we beat any nested
  // shortcut handlers (composer, etc.) that swallow Escape — when
  // the sheet is open, Escape should ALWAYS close it first.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        dismissRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  if (!open) return null

  const codexSummary = summariseCodexStatus(codexStatus)
  const claudeSummary = summariseProviderApiKeyStatus(claudeAuthStatus, 'Claude')
  const geminiSummary = summariseGeminiStatus(geminiAuthStatus)
  const kimiSummary = summariseProviderApiKeyStatus(kimiAuthStatus, 'Kimi')
  const cursorSummary = summariseCliProviderEnabled(
    cursorProviderAvailable,
    'Cursor',
    'Sign in once with `cursor-agent login` in your shell, then launch Cursor runs.'
  )
  const grokSummary = summariseCliProviderEnabled(
    grokProviderAvailable,
    'Grok',
    'Authenticate the Grok CLI (in `~/.grok/bin`) in your shell, then launch Grok runs.'
  )
  const composerPreview = getOnboardingComposerPreview(composerStyle)

  const providerRows: ProviderRowSpec[] = [
    {
      id: 'codex',
      label: 'Codex',
      description:
        'OpenAI Codex CLI. Fast-twitch shell / agentic work. Sign-in is at the OS level — run `codex login` in your terminal once.',
      ...codexSummary
    },
    {
      id: 'claude',
      label: 'Claude',
      description:
        'Anthropic Claude Code. Strong reasoning and careful edits. Sign-in opens a browser OAuth window, or paste an Anthropic API key in Settings.',
      ...claudeSummary
    },
    {
      id: 'gemini',
      label: 'Gemini',
      description:
        'Google Gemini CLI. Long-context work, image inputs, project-aware planning. Sign in with a Google account that has Gemini access.',
      ...geminiSummary,
      optional: true
    },
    {
      id: 'kimi',
      label: 'Kimi',
      description:
        'Moonshot Kimi. Wire-protocol-driven runs and structured tool calls. Skip unless you have a Moonshot API key.',
      ...kimiSummary,
      deemphasised: true,
      optional: true
    },
    {
      id: 'cursor',
      label: 'Cursor',
      description:
        'Cursor Composer 2.5. Write-capable agentic runs via the Cursor CLI. Sign-in is at the OS level — run `cursor-agent login` in your terminal once.',
      ...cursorSummary,
      optional: true
    },
    {
      id: 'grok',
      label: 'Grok',
      description:
        'xAI Grok over its agent CLI. Sign in through the Grok CLI; skip unless you have an xAI/Grok account.',
      ...grokSummary,
      deemphasised: true,
      optional: true
    }
  ]

  return (
    <div
      className="first-launch-sheet-backdrop"
      role="presentation"
      onClick={(e) => {
        // Click-outside to dismiss. Only fire when the click truly
        // started AND ended on the backdrop (not a stray release after
        // dragging out of the sheet's body).
        if (e.target === e.currentTarget) onDismiss()
      }}
    >
      <div
        className="first-launch-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={SHEET_TITLE_ID}
      >
        <header className="first-launch-sheet-header">
          <div className="first-launch-sheet-header-text">
            {/*
              AGBench's branded ghost mark. Lives at
              `src/renderer/src/assets/agbench-ghost-mark.svg`, copied
              from `design-assets/ghost/ghost-guy-mark.svg` so the
              renderer can `import` it (Vite asset import). The SVG
              ships its own gradients + rim, so the wrapper here is
              just sizing — no tinted-circle background like the
              earlier inline-glyph variant carried.
            */}
            <img src={agbenchGhostMark} alt="" className="first-launch-sheet-ghost" aria-hidden />
            <div>
              <h2 id={SHEET_TITLE_ID}>Welcome to AGBench</h2>
              <p className="first-launch-sheet-subtitle">
                First-launch checklist — providers, workspace, look, and Ensemble basics.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="first-launch-sheet-close"
            onClick={onDismiss}
            aria-label="Close onboarding sheet"
            title="Close"
          >
            ×
          </button>
        </header>

        <section className="first-launch-sheet-section">
          <p className="first-launch-sheet-prose">
            AGBench is a multi-provider AI CLI manager. It wraps <strong>Codex</strong>,{' '}
            <strong>Claude</strong>, <strong>Gemini</strong>, and <strong>Kimi</strong> inside one
            consistent chrome so you can compare runs side-by-side in the same UI. Each provider
            keeps its own auth — sign in to the ones you want to use, skip the rest.
          </p>
        </section>

        <section className="first-launch-sheet-section">
          <h3 className="first-launch-sheet-section-title">1. Sign in to your providers</h3>
          <p className="first-launch-sheet-section-helper">
            Status reflects what AGBench can see right now. Open Settings for inline sign-in flows
            (OAuth, API keys, CLI paths).
          </p>
          <div className="first-launch-sheet-provider-grid">
            {providerRows.map((row) => (
              <ProviderCard
                key={row.id}
                row={row}
                onOpenSettings={onOpenSettings}
                onProviderLogin={onProviderLogin}
              />
            ))}
          </div>
        </section>

        <section className="first-launch-sheet-section">
          <h3 className="first-launch-sheet-section-title">2. Add your first workspace</h3>
          <p className="first-launch-sheet-prose">
            A <strong>workspace</strong> is a project folder AGBench has read / edit permission
            inside. Every chat is rooted in a workspace, and the agent can only touch files within
            its trust boundary. Find the <span className="first-launch-sheet-plus">+</span> button
            in the sidebar header (next to &quot;Workspaces&quot;) and pick a folder. You can add
            more later.
          </p>
        </section>

        <section className="first-launch-sheet-section">
          <h3 className="first-launch-sheet-section-title">3. Choose your starting look</h3>
          <p className="first-launch-sheet-section-helper">
            These controls write to Appearance settings immediately. The preview is inert, so it
            will never touch your active chat prompt.
          </p>
          <div
            className="first-launch-sheet-preference-card"
            data-theme={themeAppearance}
            data-composer-style={composerStyle}
            data-user-bubble-color={userBubbleColor}
          >
            <div className="first-launch-sheet-preference-controls">
              <label className="first-launch-sheet-preference-field">
                <span>Theme</span>
                <select
                  value={themeAppearance}
                  onChange={(e) =>
                    onAppearancePreviewChange?.({
                      themeAppearance: e.target.value as ThemeAppearance
                    })
                  }
                >
                  {ONBOARDING_THEME_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="first-launch-sheet-preference-field">
                <span>Composer shell</span>
                <select
                  value={composerStyle}
                  onChange={(e) =>
                    onAppearancePreviewChange?.({
                      composerStyle: e.target.value as ComposerStyle
                    })
                  }
                >
                  {ONBOARDING_COMPOSER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="first-launch-sheet-preference-field">
                <span>Message bubble</span>
                <select
                  value={userBubbleColor}
                  onChange={(e) =>
                    onAppearancePreviewChange?.({
                      userBubbleColor: e.target.value as UserBubbleColor
                    })
                  }
                >
                  {ONBOARDING_BUBBLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/*
              1.0.5-EW32 — Use the same rich composer preview as
              Settings → Appearance. Pre-EW32 the onboarding sheet
              had its own minimal placeholder (`first-launch-sheet-
              preview-composer`) that looked nearly identical across
              the 9 composer styles — defeats the point of letting
              users pick a shell on first launch. Switched to the
              `settings-composer-preview-card` structure that
              SettingsPanel uses; the CSS for that card already
              renders the per-shell flourishes (above-bar layout,
              inline pickers, action button placement etc.). The
              `first-launch-sheet-composer-preview` wrapper class
              stays for the onboarding-specific outer spacing.
            */}
            <div className="first-launch-sheet-composer-preview" aria-label="Composer preview">
              <div
                className="settings-composer-preview-card"
                data-theme={themeAppearance}
                data-composer-style={composerStyle}
                data-interface-style={composerStyle}
              >
                <div className="settings-composer-preview-transcript">
                  <span className="settings-composer-preview-speaker">
                    {composerPreview.providerLabel}
                  </span>
                  <p>
                    Assistant transcript text uses this typeface, including inline code, file names,
                    and longer status lines.
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
                  aria-label={`${composerPreview.providerLabel} composer preview`}
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
                    {/*
                      1.0.6-EW68/EW70 — wrap the textarea + control rows
                      in .composer-textarea-wrap / .composer-bottom-controls
                      so the Obsidian/Alabaster two-rect split + reorder CSS
                      applies to the preview too. For the other shells these
                      wrappers are layout-neutral (textarea-wrap is a plain
                      relative box; bottom-controls is display:contents).
                    */}
                    <div className="composer-textarea-wrap">
                      <div
                        className="composer-textarea settings-composer-preview-textarea"
                        aria-hidden="true"
                        style={{ minHeight: '60px' }}
                      >
                        {composerPreview.placeholder}
                      </div>
                    </div>
                    <div className="composer-bottom-controls">
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
                              {composerPreview.providerLabel}
                            </span>
                            <span
                              className="composer-picker-label settings-composer-preview-control"
                              data-composer-control="permission"
                            >
                              {composerPreview.permissionLabel}
                            </span>
                            <span
                              className="composer-picker-label settings-composer-preview-control"
                              data-composer-control="model"
                            >
                              {composerPreview.modelLabel}
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
                            <span className="composer-send-cluster">
                              <button
                                type="button"
                                className="composer-action-btn run-btn"
                                tabIndex={-1}
                                aria-label="Preview send button"
                              >
                                ↑
                              </button>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="first-launch-sheet-section">
          <h3 className="first-launch-sheet-section-title">4. Try Ensemble chats</h3>
          <p className="first-launch-sheet-section-helper">
            New Ensemble puts multiple provider participants in one shared transcript. Turn mode
            keeps one active speaker at a time; Continuous mode lets the panel keep moving. Hit the
            <strong> Work Session</strong> button in the composer to run a supervised multi-round
            autonomy session with one of five presets (One-shot review · Architecture panel · Scout
            pass · Implementation review · Long-running work session).
          </p>
          <div className="first-launch-sheet-ensemble-preview" aria-label="Ensemble row preview">
            <div className="first-launch-sheet-ensemble-strip">
              <span className="first-launch-sheet-ensemble-chip" data-provider="codex">
                <strong>Worker</strong>
                <em>Codex</em>
              </span>
              <span className="first-launch-sheet-ensemble-arrow" aria-hidden>
                →
              </span>
              <span className="first-launch-sheet-ensemble-chip" data-provider="claude">
                <strong>Explorer</strong>
                <em>Claude</em>
              </span>
              <span className="first-launch-sheet-ensemble-arrow" aria-hidden>
                →
              </span>
              <span className="first-launch-sheet-ensemble-chip" data-provider="gemini">
                <strong>Researcher</strong>
                <em>Gemini</em>
              </span>
              <span className="first-launch-sheet-ensemble-arrow" aria-hidden>
                →
              </span>
              <span className="first-launch-sheet-ensemble-chip" data-provider="kimi">
                <strong>Reviewer</strong>
                <em>Kimi</em>
              </span>
            </div>
            <div className="first-launch-sheet-ensemble-footer">
              <span>+ New → New Ensemble</span>
              <span>Turn / Continuous in the composer</span>
            </div>
          </div>
        </section>

        <section className="first-launch-sheet-section">
          <h3 className="first-launch-sheet-section-title">5. Power-user shortcuts (optional)</h3>
          <ul className="first-launch-sheet-tips">
            <li>
              <strong>@ to reference files.</strong> Type <code>@</code> in the composer to mention
              a specific file by path. The agent will read it as part of the turn.
            </li>
            <li>
              <strong>/ for slash commands.</strong> Type <code>/</code> at the start of the
              composer for the slash menu — quick handles for compact, help, feedback, model swaps,
              etc.
            </li>
            <li>
              <strong>Cmd-K command palette.</strong> Anywhere in the app, press <kbd>Cmd</kbd>+
              <kbd>K</kbd> for the global command palette.
            </li>
            <li>
              <strong>Permission picker colour-codes the mode.</strong> Plan = blue, Default =
              neutral, Auto-edit = orange. Read it before you hit Enter so you know how much freedom
              the agent has.
            </li>
            <li>
              <strong>Fast Mode toggle.</strong> Inside the model picker, capable models (Codex
              GPT-5.5 / 5.4, Claude Opus 4.7 / 4.6) expose a Fast tier — useful when you want
              snappier turns at higher cost.
            </li>
            <li>
              <strong>Audit tools and shortcuts.</strong> Settings includes MCP and Keyboard
              Shortcuts tabs so you can check which tools the agents can see before a run.
            </li>
            <li>
              <strong>Send a focused report.</strong> The <code>!</code> button captures current
              surface, provider, workspace, theme, and Ensemble context into the local bug log.
            </li>
            <li>
              <strong>Screen Watch.</strong> The eye-on-screen icon in the composer&apos;s timecode
              row picks a macOS window for the AI to see. Click again to detach. A small pulse dot
              signals a live capture is running.
            </li>
            <li>
              <strong>Per-participant retry.</strong> If an Ensemble participant fails (rate limit,
              transient socket flake, etc.), open its chip&apos;s ⋯ menu for a Retry action that
              re-dispatches just that participant against the last user prompt.
            </li>
            <li>
              <strong>Cumulative session timecode.</strong> Composer&apos;s lower-left shows
              <em> two </em>
              counters: per-run elapsed time and total wall-time across every run in this chat.
            </li>
          </ul>
        </section>

        <footer className="first-launch-sheet-footer">
          <span className="first-launch-sheet-footer-helper">
            You can re-open this from the <span className="first-launch-sheet-helper-kbd">?</span>{' '}
            button next to the workspace sidebar toggle.
          </span>
          <div className="first-launch-sheet-footer-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onDismiss}
              aria-label="Skip onboarding sheet"
            >
              Skip for now
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onDismiss}
              aria-label="Close onboarding sheet"
            >
              Got it
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

interface ProviderCardProps {
  row: ProviderRowSpec
  onOpenSettings: () => void
  // 1.0.6-CRUX42 — Cursor / Grok sign in via an interactive CLI login; the host
  // opens a Terminal running it. Only those two cards surface this button.
  onProviderLogin?: (provider: OnboardingProviderId) => void
}

function ProviderCard({
  row,
  onOpenSettings,
  onProviderLogin
}: ProviderCardProps): React.JSX.Element {
  const classes = [
    'first-launch-sheet-provider-card',
    `first-launch-sheet-provider-card-${row.variant}`,
    row.deemphasised ? 'first-launch-sheet-provider-card-deemphasised' : '',
    row.optional ? 'first-launch-sheet-provider-card-optional' : ''
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classes} data-provider={row.id}>
      <div className="first-launch-sheet-provider-card-header">
        {PROVIDER_LOGOS[row.id] ? (
          <img
            src={PROVIDER_LOGOS[row.id]}
            alt=""
            aria-hidden
            className="first-launch-sheet-provider-card-logo"
          />
        ) : (
          // Future providers without logo PNGs fall back to an
          // accent-coloured monogram tile (provider-${id} carries
          // the accent token).
          <span
            className={`first-launch-sheet-provider-card-logo first-launch-sheet-provider-card-logo-monogram provider-${row.id}`}
            aria-hidden
          >
            {row.label.charAt(0)}
          </span>
        )}
        <span className="first-launch-sheet-provider-card-label">{row.label}</span>
        {row.optional && (
          <span className="first-launch-sheet-provider-card-optional-badge">Optional</span>
        )}
      </div>
      <div className="first-launch-sheet-provider-card-status">
        <span
          className={`first-launch-sheet-provider-status-dot first-launch-sheet-provider-status-dot-${row.variant}`}
          aria-hidden
        />
        <span>{row.statusText}</span>
      </div>
      <p className="first-launch-sheet-provider-card-description">{row.description}</p>
      <p className="first-launch-sheet-provider-card-hint">{row.hint}</p>
      <div className="first-launch-sheet-provider-card-actions">
        {(row.id === 'cursor' || row.id === 'grok') && onProviderLogin && (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => onProviderLogin(row.id)}
            aria-label={`Sign in to ${row.label}`}
          >
            Sign in
          </button>
        )}
        <button
          type="button"
          className="btn btn-sm"
          onClick={onOpenSettings}
          aria-label={`Open settings for ${row.label}`}
        >
          {row.variant === 'signed-in' ? 'Manage in Settings' : 'Open Settings'}
        </button>
      </div>
    </div>
  )
}
