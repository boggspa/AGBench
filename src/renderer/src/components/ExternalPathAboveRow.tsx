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

interface ExternalPathAboveRowProps {
  grant: ExternalPathGrant
  repoMetadata: ExternalPathGitMetadata | null
  onRevoke: (grant: ExternalPathGrant) => void
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
  onRevoke
}: ExternalPathAboveRowProps): React.JSX.Element {
  const descriptor = describeExternalPath(grant.path, { gitMetadata: repoMetadata })
  const isWrite = grant.access === 'write'
  const accessLabel = isWrite ? 'edit' : 'read'

  return (
    <div
      className="composer-above-bar composer-above-bar-secondary style-unified"
      data-external-path-grant-id={grant.id}
      data-external-path-is-repo={descriptor.isRepo ? 'true' : 'false'}
      title={`${grant.path} (${accessLabel} access)`}
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
      <span className="composer-above-bar-secondary-access">
        {isWrite ? 'edit access' : 'read access'}
      </span>
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
