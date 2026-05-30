/*
 * ExternalPathAboveRow — one stacked above-bar row per external-path
 * grant. Renders branch + repo name when the grant points to a git
 * repo (per the runtime probe from slice 1); falls back to the path's
 * basename when it's a single file or non-repo folder.
 *
 * Slice 3 of the external-path-redesign arc. Per-repo diff stats and
 * per-repo Create-PR are deferred to slice 6 — this slice ships the
 * scaffolding (row layout + branch label + revoke affordance) so the
 * stack shape is in place before the runtime detector (slice 5)
 * starts producing new grants.
 *
 * The wrapping `.composer-above-bar` class lets this row inherit ALL
 * the per-shell above-bar styling that the primary row already uses
 * (Codex tucked tab, Claude bare-text, Modular floating, Stub
 * parchment, etc.). The stack container in App.tsx renders both the
 * primary row and any number of these secondary rows back-to-back.
 */

import type { ExternalPathGrant } from '../../../main/store/types'
import type { ExternalPathGitMetadata } from '../lib/ExternalPathRepoDetect'
import { describeExternalPath } from '../lib/ExternalPathRepoDetect'
import { getProviderName } from './Sidebar'

/**
 * 1.0.5-EW42b — Derive a human-readable "where did this grant
 * come from?" label from the `grant.id` prefix, the `provider`,
 * and the `createdAt` ISO timestamp.
 *
 * Grant id prefixes:
 *   - `runtime-${ts}-${rand}`               → agent's tool call
 *                                             tripped the runtime
 *                                             external-path
 *                                             detector + the user
 *                                             approved.
 *   - `proactive-${ts}-${provider}-${rand}` → 1.0.5-EW42a: user
 *                                             clicked "Grant
 *                                             read access to
 *                                             another folder…" in
 *                                             the composer
 *                                             workspace switcher.
 *   - `${digits}-${rand}` (legacy)          → manual picker from
 *                                             pre-EW42a code
 *                                             paths (now gone, but
 *                                             persisted grants
 *                                             from older sessions
 *                                             may still match).
 *
 * The tooltip line answers the user's "what triggered this?"
 * question — historically the banner appeared mysteriously, and
 * EW42b makes the trigger visible via hover.
 */
export function buildExternalPathOriginTooltip(grant: ExternalPathGrant): string {
  const providerName = getProviderName(grant.provider)
  const accessLabel = grant.access === 'write' ? 'edit access' : 'read access'
  const origin = (() => {
    if (grant.id.startsWith('proactive-')) {
      return 'You granted this via the composer workspace switcher.'
    }
    if (grant.id.startsWith('runtime-')) {
      return `${providerName} requested access during a tool call; you approved it.`
    }
    return `Granted manually via an older picker.`
  })()
  const when = (() => {
    try {
      const ts = new Date(grant.createdAt)
      if (Number.isNaN(ts.getTime())) return grant.createdAt
      return ts.toLocaleString()
    } catch {
      return grant.createdAt
    }
  })()
  return `${providerName} · ${accessLabel} · ${when}\n${origin}`
}

interface ExternalPathDiffStats {
  additions: number
  deletions: number
  filesChanged: number
}

interface ExternalPathAboveRowProps {
  grant: ExternalPathGrant
  repoMetadata: ExternalPathGitMetadata | null
  /**
   * Per-repo diff stats from `externalPathDiffStatsByGrant` (slice 6).
   * Optional — omitted when nothing's been touched in this grant's
   * scope, in which case the row renders without the diff pill.
   */
  diffStats?: ExternalPathDiffStats
  onRevoke: (grant: ExternalPathGrant) => void
  /**
   * 1.0.6-EW66-1d — Per-path Create-PR state + handler. When the
   * grant is WRITE access and `onCreatePr` is supplied, the row
   * gains a "Create PR" action (matching the primary workspace
   * row) scoped to this grant's path. READ grants ignore both —
   * they render the existing reference-only banner. State is keyed
   * by path in the parent, so all of an ensemble's same-path write
   * rows reflect one repo's PR progress together.
   */
  createPrState?: { status: 'idle' | 'pending' | 'success' | 'error'; message?: string }
  onCreatePr?: (grant: ExternalPathGrant) => void
}

function BranchGlyph(): React.JSX.Element {
  return (
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
  )
}

function FileGlyph(): React.JSX.Element {
  return (
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
      <path d="M4 2h5l3 3v9H4z" />
      <path d="M9 2v3h3" />
    </svg>
  )
}

function RevokeGlyph(): React.JSX.Element {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}

export function ExternalPathAboveRow({
  grant,
  repoMetadata,
  diffStats,
  onRevoke,
  createPrState,
  onCreatePr
}: ExternalPathAboveRowProps): React.JSX.Element {
  const descriptor = describeExternalPath(grant.path, { gitMetadata: repoMetadata })
  const isWrite = grant.access === 'write'
  // 1.0.6-EW66-1d — WRITE grants pointing at a git repo get a
  // Create-PR action matching the primary workspace row, scoped to
  // this grant's path. Mirror the primary's label/state machine.
  const prStatus = createPrState?.status ?? 'idle'
  const showCreatePr = isWrite && descriptor.isRepo && typeof onCreatePr === 'function'
  const createPrLabel =
    prStatus === 'pending'
      ? 'Creating…'
      : prStatus === 'success'
        ? 'PR opened'
        : prStatus === 'error'
          ? 'Retry PR'
          : 'Create PR'
  // 1.0.5-EW42b — `accessLabel` was used here pre-EW42b to build
  // a minimal `<path> (<accessLabel> access)` title. EW42b
  // replaces that with the richer multi-line tooltip below
  // (provider + access verb + timestamp + origin source), so the
  // separate variable is no longer needed.
  const hasDiff =
    diffStats && (diffStats.filesChanged > 0 || diffStats.additions > 0 || diffStats.deletions > 0)
  // 1.0.5-EW42b — Build a rich tooltip that explains what created
  // this grant (composer-proactive vs. agent-approval vs. legacy
  // manual picker), which provider it's scoped to, and when it
  // was issued. Hover on the whole row shows the path + this
  // origin block; hover on the access pill shows the same block
  // narrowed to the access label so the most relevant signal sits
  // where the user's eye lands.
  const originTooltip = buildExternalPathOriginTooltip(grant)

  return (
    <div
      className="composer-above-bar composer-above-bar-secondary style-unified"
      data-external-path-grant-id={grant.id}
      data-external-path-is-repo={descriptor.isRepo ? 'true' : 'false'}
      title={`${grant.path}\n\n${originTooltip}`}
    >
      <span className="composer-above-bar-branch">
        {descriptor.isRepo ? <BranchGlyph /> : <FileGlyph />}
        <span>
          {descriptor.basename}
          {descriptor.isRepo && descriptor.branch ? (
            <>
              {' · '}
              <em className="composer-above-bar-secondary-branch">{descriptor.branch}</em>
            </>
          ) : null}
        </span>
      </span>
      {hasDiff && (
        <>
          <span
            className="composer-above-bar-files"
            title={`${diffStats!.filesChanged} ${
              diffStats!.filesChanged === 1 ? 'file' : 'files'
            } changed in this path`}
          >
            <strong>{diffStats!.filesChanged}</strong>{' '}
            {diffStats!.filesChanged === 1 ? 'file changed' : 'files changed'}
          </span>
          {(diffStats!.additions > 0 || diffStats!.deletions > 0) && (
            <span className="composer-above-bar-stats">
              <span className="composer-diff-add">+{diffStats!.additions}</span>
              <span className="composer-diff-del">-{diffStats!.deletions}</span>
            </span>
          )}
        </>
      )}
      <span className="composer-above-bar-secondary-access" title={originTooltip}>
        {isWrite ? 'edit access' : 'read access'}
      </span>
      {showCreatePr && (
        <button
          type="button"
          className={`composer-above-bar-action ${prStatus === 'pending' ? 'is-pending' : ''} ${
            prStatus === 'error' ? 'is-error' : ''
          } ${prStatus === 'success' ? 'is-success' : ''}`}
          onClick={() => onCreatePr?.(grant)}
          disabled={prStatus === 'pending'}
          title={
            createPrState?.message ||
            `Run \`gh pr create --fill\` against ${descriptor.basename}${
              descriptor.branch ? ` (${descriptor.branch})` : ''
            }`
          }
        >
          {createPrLabel}
        </button>
      )}
      <button
        type="button"
        className="composer-above-bar-secondary-revoke"
        onClick={() => onRevoke(grant)}
        title={`Revoke external path: ${grant.path}`}
        aria-label={`Revoke external path access to ${grant.path}`}
      >
        <RevokeGlyph />
      </button>
    </div>
  )
}
