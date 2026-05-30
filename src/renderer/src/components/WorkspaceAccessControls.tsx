/*
 * WorkspaceAccessControls — Phase J1 composer-unification.
 *
 * Renders the cross-provider "External Path" + "Worktree" pills that
 * used to be Codex-only (External Path floated above the composer) and
 * Gemini-only (Worktree was one of three persistent-session toggles in
 * the composer's top row). Both controls now ship as a uniform pair
 * across every provider, in one of two render variants:
 *
 *  - `variant="satellite"` — small floating pills above the composer
 *    surface, used in the welcome state (no chat activity yet). Lets
 *    the user pre-configure access scope before sending the first
 *    prompt.
 *
 *  - `variant="inline"` — pills that sit alongside the branch / diff
 *    stats / Create-PR action inside the existing above-bar, once the
 *    chat has activity. Same controls, just hugging the workspace
 *    summary band the user is already looking at.
 *
 * Provider behaviour:
 *  - External Path is interactive for every provider. Codex's existing
 *    sandbox-grant plumbing already honours the grant. Gemini /
 *    Claude / Kimi will start honouring it via `--add-dir <path>` in a
 *    follow-up pass; in the meantime the picker writes to the same
 *    persisted state slot so the grants survive a provider switch.
 *  - Worktree is interactive for Gemini (existing toggle handler is
 *    re-used) and reserved as a status-only display for the others
 *    (Codex / Claude auto-manage worktrees from inside their own
 *    runtimes; Kimi support is pending and would need its own toggle).
 */

import { memo } from 'react'
import type { ProviderId, WorkspaceRecord, GeminiWorktreeConfig } from '../../../main/store/types'

// `WORKSPACE_POLICY_SERVICES` lifted to `../lib/workspacePolicyServices`
// — both this component and the new CombinedPermissionsPicker import
// it from there now.
//
// Post-slice-8 cleanup: `externalPathGrants`, `onPickExternalPathGrant`,
// `agenticServices`, `agenticWorkspaceGrants`, `onSetWorkspaceGrant`
// dropped from the props interface. External Path now lives as
// secondary above-rows + runtime-grant modal (slices 3+4+5); Tool
// Grants moved into CombinedPermissionsPicker. The remaining shape
// of this component is purely the Gemini Worktree toggle pill.

interface WorkspaceAccessControlsProps {
  variant: 'satellite' | 'inline'
  provider: ProviderId
  currentWorkspace: WorkspaceRecord | null
  isCurrentGlobalChat: boolean
  isCurrentComposerLocked: boolean
  hasWorkspaceContext: boolean
  currentGeminiWorktree?: GeminiWorktreeConfig | undefined
  onGeminiWorktreeToggle: () => void
  worktreeToggleLabel: string
  worktreeDiffUnavailable: boolean
}

// `PermissionGlyph` was the lock icon on the now-removed External
// Path picker pill (Slice 8 of external-path-redesign). The only
// remaining glyph in this file is the Gemini Worktree pill below.

function WorktreeGlyph(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4.2 3.2v6.1a2.5 2.5 0 0 0 2.5 2.5h5.1" />
      <path d="M4.2 5.6h3.6a2.5 2.5 0 0 0 2.5-2.5" />
      <circle cx="4.2" cy="3.2" r="1.2" />
      <circle cx="11.8" cy="11.8" r="1.2" />
      <circle cx="10.3" cy="3.1" r="1.2" />
    </svg>
  )
}

// Phase K-followup — WorktreeStatusLabel + WorktreeStatusTooltip
// removed alongside the non-interactive status pill they fed. The
// strings ("Worktree: managed by Codex/Claude" / "Worktree: per-run")
// only described which provider was active, presented as a button
// but never reacted to clicks. If a future surface wants the same
// labels back, restore them from git history (the labels were
// stable across providers, just rarely useful to the user).

// `normalizedWorkspacePath` was used by the Tool Grants pill's
// workspace-grant filter (now gone). The same logic lives inside
// the new CombinedPermissionsPicker call site in App.tsx — no
// shared utility needed here anymore.

/*
 * 1.0.5-EW53 — Wrapped in React.memo at the export. With the
 * onGeminiWorktreeToggle prop now wrapped in useCallback at the
 * call site, all incoming props are referentially stable across
 * App re-renders. Skipping this subtree on every composer keystroke
 * cuts the most expensive non-transcript reconciliation work in
 * long threads, where the workspace pill also pulls in the worktree
 * label + diff-unavailable warning each render.
 */
function WorkspaceAccessControlsImpl(
  props: WorkspaceAccessControlsProps
): React.JSX.Element | null {
  const {
    variant,
    provider,
    currentWorkspace,
    isCurrentGlobalChat,
    isCurrentComposerLocked,
    hasWorkspaceContext,
    currentGeminiWorktree,
    onGeminiWorktreeToggle,
    worktreeToggleLabel,
    worktreeDiffUnavailable
  } = props

  // Hide entirely for global-scope chats: External Path and Worktree
  // are workspace-scoped concepts, no sense surfacing them when the
  // user is operating outside a workspace.
  if (isCurrentGlobalChat || !currentWorkspace) {
    return null
  }

  const worktreeInteractive = provider === 'gemini'

  return (
    <div
      className={`composer-workspace-access composer-workspace-access-${variant} provider-${provider}`}
      aria-label="Workspace access controls"
    >
      {/*
        Slice 8 of the external-path-redesign arc — the External
        Path picker pill is gone from the above-bar. Each granted
        path now renders as its own dedicated row beside the
        primary workspace row (via slice 3's <ExternalPathAboveRow />),
        and slice 5's runtime detector handles new grants on-demand
        when the agent first tries to access a path outside the
        workspace. Tool Grants pill removed earlier (Phase
        J7-followup) — those toggles now live inside the
        CombinedPermissionsPicker. After post-slice-8 cleanup the
        remaining shape of this component is just the Gemini
        Worktree pill below.
      */}
      {worktreeInteractive && (
        <button
          type="button"
          className={`composer-workspace-access-pill composer-workspace-access-worktree ${currentGeminiWorktree?.enabled ? 'is-active' : ''} ${worktreeDiffUnavailable ? 'is-warning' : ''}`}
          onClick={onGeminiWorktreeToggle}
          disabled={!hasWorkspaceContext || isCurrentComposerLocked}
          title={
            currentGeminiWorktree?.enabled
              ? 'Disable Gemini CLI worktree mode for this workspace'
              : 'Run Gemini in an auto-created CLI worktree for this workspace'
          }
        >
          <WorktreeGlyph />
          <span>{worktreeToggleLabel}</span>
        </button>
      )}
      {/*
        Phase K-followup — Removed the non-interactive
        "Worktree: managed by Codex/Claude" / "Worktree: per-run (Kimi)"
        status pill. The label only told the user something they
        already knew from picking the provider, presented as a
        button but didn't react to clicks. Real estate freed for
        the new files-changed pill on the diff stats row. The
        interactive Gemini branch (worktreeInteractive=true) stays.
      */}
    </div>
  )
}

// 1.0.5-EW53 — Public memo'd export. Default shallow compare suffices
// once the App.tsx call site wraps `onGeminiWorktreeToggle` in
// useCallback. The remaining props (provider, currentWorkspace,
// flags, labels) are all primitives or stable refs.
export const WorkspaceAccessControls = memo(WorkspaceAccessControlsImpl)
