import React, { useEffect, useRef } from 'react'
import type { ProviderApiKeyStatus, GeminiAuthStatus } from '../../../main/store/types'
import {
  summariseCodexStatus,
  summariseGeminiStatus,
  summariseProviderApiKeyStatus,
  type ProviderAuthVariant
} from '../lib/providerAuthSummary'
import agbenchGhostMark from '../assets/agbench-ghost-mark.svg'
import codexLogo from '../assets/provider-logos/codex.png'
import claudeLogo from '../assets/provider-logos/claude.png'
import geminiLogo from '../assets/provider-logos/gemini.png'
import kimiLogo from '../assets/provider-logos/kimi.png'

const PROVIDER_LOGOS: Record<'codex' | 'claude' | 'gemini' | 'kimi', string> = {
  codex: codexLogo,
  claude: claudeLogo,
  gemini: geminiLogo,
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
 *   1. **Sheet not wizard.** One scrollable sheet with four sections
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
}

type ProviderRowVariant = ProviderAuthVariant

interface ProviderRowSpec {
  id: 'codex' | 'claude' | 'gemini' | 'kimi'
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

export function FirstLaunchSheet({
  open,
  onDismiss,
  onOpenSettings,
  codexStatus,
  claudeAuthStatus,
  kimiAuthStatus,
  geminiAuthStatus
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
            <img
              src={agbenchGhostMark}
              alt=""
              className="first-launch-sheet-ghost"
              aria-hidden
            />
            <div>
              <h2 id={SHEET_TITLE_ID}>Welcome to AGBench</h2>
              <p className="first-launch-sheet-subtitle">
                First-launch checklist — three minutes to a working setup.
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
            AGBench is a multi-provider AI CLI manager. It wraps{' '}
            <strong>Codex</strong>, <strong>Claude</strong>, <strong>Gemini</strong>, and{' '}
            <strong>Kimi</strong> inside one consistent chrome so you can compare runs side-by-side
            in the same UI. Each provider keeps its own auth — sign in to the ones you want to use,
            skip the rest.
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
              <ProviderCard key={row.id} row={row} onOpenSettings={onOpenSettings} />
            ))}
          </div>
        </section>

        <section className="first-launch-sheet-section">
          <h3 className="first-launch-sheet-section-title">2. Add your first workspace</h3>
          <p className="first-launch-sheet-prose">
            A <strong>workspace</strong> is a project folder AGBench has read / edit permission
            inside. Every chat is rooted in a workspace, and the agent can only touch files within
            its trust boundary. Find the <span className="first-launch-sheet-plus">+</span> button
            in the sidebar header (next to "Workspaces") and pick a folder. You can add more later.
          </p>
        </section>

        <section className="first-launch-sheet-section">
          <h3 className="first-launch-sheet-section-title">3. Power-user shortcuts (optional)</h3>
          <ul className="first-launch-sheet-tips">
            <li>
              <strong>@ to reference files.</strong> Type <code>@</code> in the composer to mention
              a specific file by path. The agent will read it as part of the turn.
            </li>
            <li>
              <strong>/ for slash commands.</strong> Type <code>/</code> at the start of the
              composer for the slash menu — quick handles for compact, help, feedback, model
              swaps, etc.
            </li>
            <li>
              <strong>Cmd-K command palette.</strong> Anywhere in the app, press{' '}
              <kbd>Cmd</kbd>+<kbd>K</kbd> for the global command palette.
            </li>
            <li>
              <strong>Permission picker colour-codes the mode.</strong> Plan = blue, Default =
              neutral, Auto-edit = orange. Read it before you hit Enter so you know how much
              freedom the agent has.
            </li>
            <li>
              <strong>Fast Mode toggle.</strong> Inside the model picker, capable models (Codex
              GPT-5.5 / 5.4, Claude Opus 4.7 / 4.6) expose a Fast tier — useful when you want
              snappier turns at higher cost.
            </li>
            <li>
              <strong>Composer shell style.</strong> Settings → Composer interface lets you swap
              the composer between AGBench native, Codex, Claude, Gemini, and Kimi shells — the
              chrome morphs to match each provider's idiom.
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
}

function ProviderCard({ row, onOpenSettings }: ProviderCardProps): React.JSX.Element {
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
        <img
          src={PROVIDER_LOGOS[row.id]}
          alt=""
          aria-hidden
          className="first-launch-sheet-provider-card-logo"
        />
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
