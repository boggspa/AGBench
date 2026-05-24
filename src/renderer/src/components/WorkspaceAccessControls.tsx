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

import type {
  AgenticServiceId,
  AgenticServicesSettings,
  AgenticWorkspaceGrant,
  ProviderId,
  WorkspaceRecord,
  ExternalPathGrant,
  GeminiWorktreeConfig
} from '../../../main/store/types'

// `WORKSPACE_POLICY_SERVICES` lifted to `../lib/workspacePolicyServices`
// — both this component and the new CombinedPermissionsPicker import
// it from there now.

interface WorkspaceAccessControlsProps {
  variant: 'satellite' | 'inline'
  provider: ProviderId
  currentWorkspace: WorkspaceRecord | null
  isCurrentGlobalChat: boolean
  isCurrentComposerLocked: boolean
  hasWorkspaceContext: boolean
  externalPathGrants: ExternalPathGrant[]
  onPickExternalPathGrant: (access: 'read' | 'write') => void
  agenticServices: AgenticServicesSettings
  agenticWorkspaceGrants: AgenticWorkspaceGrant[]
  onSetWorkspaceGrant: (service: AgenticServiceId, enabled: boolean) => void
  currentGeminiWorktree?: GeminiWorktreeConfig | undefined
  onGeminiWorktreeToggle: () => void
  worktreeToggleLabel: string
  worktreeDiffUnavailable: boolean
}

function PermissionGlyph(): React.JSX.Element {
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
      <path d="M4 7v-1a4 4 0 1 1 8 0v1" />
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
    </svg>
  )
}

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

export function WorkspaceAccessControls(
  props: WorkspaceAccessControlsProps
): React.JSX.Element | null {
  const {
    variant,
    provider,
    currentWorkspace,
    isCurrentGlobalChat,
    isCurrentComposerLocked,
    hasWorkspaceContext,
    externalPathGrants,
    onPickExternalPathGrant,
    // agenticServices / agenticWorkspaceGrants / onSetWorkspaceGrant
    // were used by the in-component Tool Grants pill (now removed).
    // They remain on the props interface for backwards compatibility
    // — App.tsx still passes them, and they flow through to the new
    // CombinedPermissionsPicker instead. Destructured-but-unused
    // bindings would TS6133-fail, so we deliberately don't pull them
    // out of props here.
    currentGeminiWorktree,
    onGeminiWorktreeToggle,
    worktreeToggleLabel,
    worktreeDiffUnavailable
  } = props

  const grantsCount = externalPathGrants.length

  // Hide entirely for global-scope chats: External Path and Worktree
  // are workspace-scoped concepts, no sense surfacing them when the
  // user is operating outside a workspace.
  if (isCurrentGlobalChat || !currentWorkspace) {
    return null
  }

  const externalPathTitle =
    grantsCount > 0
      ? `External path access (${grantsCount} granted). Add another below.`
      : 'Grant access to a file or folder outside this workspace.'

  const worktreeInteractive = provider === 'gemini'

  return (
    <div
      className={`composer-workspace-access composer-workspace-access-${variant} provider-${provider}`}
      aria-label="Workspace access controls"
    >
      <label
        className="composer-workspace-access-pill composer-workspace-access-external-path"
        title={externalPathTitle}
      >
        <PermissionGlyph />
        <select
          className="composer-workspace-access-select"
          aria-label="Grant external path access"
          value=""
          disabled={isCurrentComposerLocked || !currentWorkspace}
          onChange={(event) => {
            const access = event.target.value as 'read' | 'write'
            if (access === 'read' || access === 'write') {
              onPickExternalPathGrant(access)
            }
          }}
        >
          <option value="">
            {grantsCount > 0 ? `External path (${grantsCount})` : 'External path'}
          </option>
          <option value="read">Grant read…</option>
          <option value="write">Grant edit…</option>
        </select>
      </label>
      {/*
        Tool Grants pill removed — Phase J7-followup. The grant
        toggles now live inside the CombinedPermissionsPicker
        (composer footer), as the right column of its two-column
        popover. Keeps the above-bar tidy and matches the
        Permissions | Reasoning pattern of the new model picker.

        Props `agenticServices`, `agenticWorkspaceGrants`,
        `onSetWorkspaceGrant` are retained on this component for
        backwards compatibility but no longer rendered here. They
        flow through App.tsx to CombinedPermissionsPicker instead.
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
