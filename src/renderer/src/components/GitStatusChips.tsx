import type { GitPrSummary, GitRepositorySnapshot } from '../../../main/services/GitService'

/*
 * Shared Git-status chips for the composer workspace lines (the primary
 * workspace row AND each external-path row). Centralising them guarantees one
 * consistent shape + styling everywhere, so branch / merge / sync / CI never
 * drift between row instances — the unification the above-rows needed.
 *
 * Every chip here is READ-ONLY (informative). The single interactive control
 * (Review / Commit / Push / Create-PR) lives in the row's action button, so the
 * line keeps a clean visual split between "status you read" and "the one thing
 * you click". (CI is the one exception — it opens the run — and carries the
 * `git-chip-clickable` affordance to signal that.)
 */

/** Branch-name → tone bucket for Claude-app-style colour coding. */
export function branchTone(branch: string | undefined, detached: boolean): string {
  if (detached) return 'detached'
  const b = (branch || '').toLowerCase()
  if (!b) return 'detached'
  if (/^(main|master|trunk|develop)$/.test(b)) return 'main'
  if (/^(feat|feature)\//.test(b)) return 'feature'
  if (/^(fix|hotfix|bug|bugfix)\//.test(b)) return 'fix'
  if (/^(release|rc)\//.test(b)) return 'release'
  return 'other'
}

export interface CiSummary {
  pass: number
  fail: number
  pending: number
  total: number
}

export function summarizeChecks(checks: GitPrSummary['checks']): CiSummary {
  const out: CiSummary = { pass: 0, fail: 0, pending: 0, total: 0 }
  if (!checks) return out
  for (const check of checks) {
    out.total += 1
    const status = (check.status || '').toLowerCase()
    const conclusion = (check.conclusion || '').toLowerCase()
    if (status && status !== 'completed') out.pending += 1
    else if (['success', 'neutral', 'skipped'].includes(conclusion)) out.pass += 1
    else if (conclusion) out.fail += 1
    else out.pending += 1
  }
  return out
}

/** In-progress merge / rebase / cherry-pick + unmerged-file count. */
export function GitMergeBadge({
  snapshot
}: {
  snapshot: GitRepositorySnapshot
}): React.JSX.Element | null {
  const conflicts = snapshot.conflicts ?? 0
  if (!snapshot.mergeState && conflicts === 0) return null
  const hasConflicts = conflicts > 0
  const stateLabel =
    snapshot.mergeState === 'merge'
      ? 'merging'
      : snapshot.mergeState === 'rebase'
        ? 'rebasing'
        : snapshot.mergeState === 'cherry-pick'
          ? 'cherry-pick'
          : null
  const title = [
    stateLabel ? `${stateLabel} in progress` : null,
    hasConflicts ? `${conflicts} conflicted file${conflicts === 1 ? '' : 's'}` : null
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <span
      className={`git-chip git-chip-merge ${
        hasConflicts ? 'git-merge-conflict' : 'git-merge-progress'
      }`}
      title={title}
    >
      <span className="git-chip-glyph" aria-hidden>
        {hasConflicts ? '⚠' : '⟳'}
      </span>
      {hasConflicts ? `${conflicts} conflict${conflicts === 1 ? '' : 's'}` : stateLabel}
    </span>
  )
}

/**
 * Ahead/behind vs upstream — consolidates the old state-pill "push" flag and
 * the separate git-status ↑↓ into one sync chip. Renders nothing when in sync
 * (clean), so a tidy repo stays quiet.
 */
export function GitSyncChip({
  snapshot
}: {
  snapshot: GitRepositorySnapshot
}): React.JSX.Element | null {
  if (snapshot.detached || !snapshot.branch) return null
  if (!snapshot.upstream) {
    return (
      <span
        className="git-chip git-chip-sync is-unpublished"
        title="No upstream — push to publish this branch"
      >
        no upstream
      </span>
    )
  }
  const ahead = snapshot.ahead ?? 0
  const behind = snapshot.behind ?? 0
  if (ahead === 0 && behind === 0) return null
  return (
    <span className="git-chip git-chip-sync" title={`${ahead} ahead · ${behind} behind`}>
      {ahead > 0 && <span className="git-sync-ahead">↑{ahead}</span>}
      {behind > 0 && <span className="git-sync-behind">↓{behind}</span>}
    </span>
  )
}

/** CI check rollup — clickable: opens the PR page, else the first failing run. */
export function GitCiChip({ pr }: { pr: GitPrSummary | null }): React.JSX.Element | null {
  const ci = summarizeChecks(pr?.checks)
  if (ci.total === 0) return null
  const tone = ci.fail > 0 ? 'fail' : ci.pending > 0 ? 'pending' : 'pass'
  const glyph = ci.fail > 0 ? '✗' : ci.pending > 0 ? '●' : '✓'
  const count = ci.fail > 0 ? ci.fail : ci.pending > 0 ? ci.pending : ci.pass
  const url =
    pr?.url ||
    pr?.checks?.find((check) => {
      const conclusion = (check.conclusion || '').toLowerCase()
      return conclusion && !['success', 'neutral', 'skipped'].includes(conclusion)
    })?.url
  const clickable = Boolean(url)
  const open = (): void => {
    if (url && typeof window.api.openExternalOrPath === 'function') {
      void window.api.openExternalOrPath(url)
    }
  }
  return (
    <span
      className={`git-chip git-chip-ci git-ci-${tone}${clickable ? ' git-chip-clickable' : ''}`}
      title={`CI: ${ci.pass} passed · ${ci.fail} failed · ${ci.pending} pending${
        clickable ? ' — open' : ''
      }`}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? open : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                open()
              }
            }
          : undefined
      }
    >
      <span className="git-chip-glyph">{glyph}</span>
      {count}
      <span className="git-chip-ci-label">CI</span>
    </span>
  )
}
