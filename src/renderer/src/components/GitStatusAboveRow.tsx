import { useEffect, useState } from 'react'
import type { GitPrSummary, GitRepositorySnapshot } from '../../../main/services/GitService'
import { ToolFamilyIcon } from './icons/ToolFamilyIcon'

interface GitStatusAboveRowProps {
  /**
   * Repo/workspace path. When absent (e.g. a global chat with no workspace)
   * the row renders nothing AND issues no git/gh call — which is also the fix
   * for the "fatal: not a git repository" error that came from running git
   * with an empty cwd in workspace-less chats.
   */
  workspacePath?: string
  /** Bump to force a refetch (e.g. after a run finishes). */
  refreshKey?: string | number
}

/** Branch-name → tone bucket for Claude-app-style colour coding. */
function branchTone(branch: string | undefined, detached: boolean): string {
  if (detached) return 'detached'
  const b = (branch || '').toLowerCase()
  if (!b) return 'detached'
  if (/^(main|master|trunk|develop)$/.test(b)) return 'main'
  if (/^(feat|feature)\//.test(b)) return 'feature'
  if (/^(fix|hotfix|bug|bugfix)\//.test(b)) return 'fix'
  if (/^(release|rc)\//.test(b)) return 'release'
  return 'other'
}

interface CiSummary {
  pass: number
  fail: number
  pending: number
  total: number
}

function summarizeChecks(checks: GitPrSummary['checks']): CiSummary {
  const out: CiSummary = { pass: 0, fail: 0, pending: 0, total: 0 }
  if (!checks) return out
  for (const check of checks) {
    out.total += 1
    const status = (check.status || '').toLowerCase()
    const conclusion = (check.conclusion || '').toLowerCase()
    if (status && status !== 'completed') {
      out.pending += 1
    } else if (['success', 'neutral', 'skipped'].includes(conclusion)) {
      out.pass += 1
    } else if (conclusion) {
      out.fail += 1
    } else {
      out.pending += 1
    }
  }
  return out
}

/**
 * Composer above-row showing live git status — branch (colour-coded), ahead/
 * behind push state, and CI check rollup — in the AGBench-native console
 * stack, Claude-app style. Renders the CI checks that GitService already
 * parses into `GitPrSummary.checks` but nothing surfaced before.
 */
export function GitStatusAboveRow({ workspacePath, refreshKey }: GitStatusAboveRowProps) {
  const [snapshot, setSnapshot] = useState<GitRepositorySnapshot | null>(null)
  const [pr, setPr] = useState<GitPrSummary | null>(null)

  useEffect(() => {
    if (!workspacePath) {
      setSnapshot(null)
      setPr(null)
      return
    }
    let cancelled = false
    void (async () => {
      let snapData: GitRepositorySnapshot | null = null
      try {
        const snap = await window.api.gitSnapshot({ workspacePath })
        snapData = snap?.ok ? snap.data : null
      } catch {
        snapData = null
      }
      if (cancelled) return
      setSnapshot(snapData)
      // CI is best-effort + slower (gh CLI) — only worth a call when the repo
      // has a remote, and it never blocks the branch/push render above.
      if (!snapData?.remoteUrl) {
        setPr(null)
        return
      }
      try {
        const prRes = await window.api.githubPrStatus({ workspacePath })
        if (!cancelled) setPr(prRes?.ok ? prRes.data : null)
      } catch {
        if (!cancelled) setPr(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workspacePath, refreshKey])

  if (!workspacePath || !snapshot) return null

  const branchLabel = snapshot.detached ? 'detached' : snapshot.branch || 'detached'
  const tone = branchTone(snapshot.branch, snapshot.detached)
  const ci = summarizeChecks(pr?.checks)
  const ciTone = ci.fail > 0 ? 'fail' : ci.pending > 0 ? 'pending' : 'pass'
  const ciGlyph = ci.fail > 0 ? '✗' : ci.pending > 0 ? '●' : '✓'
  const ciCount = ci.fail > 0 ? ci.fail : ci.pending > 0 ? ci.pending : ci.pass

  return (
    <div className="composer-above-bar git-status-above-row" role="group" aria-label="Git status">
      <span className={`git-status-branch git-tone-${tone}`} title={`Branch: ${branchLabel}`}>
        <ToolFamilyIcon family="git" size={13} />
        <span className="git-status-branch-name">{branchLabel}</span>
      </span>
      {(snapshot.ahead > 0 || snapshot.behind > 0) && (
        <span
          className="git-status-push"
          title={`${snapshot.ahead} ahead · ${snapshot.behind} behind${
            snapshot.upstream ? '' : ' · no upstream'
          }`}
        >
          {snapshot.ahead > 0 && <span className="git-status-ahead">↑{snapshot.ahead}</span>}
          {snapshot.behind > 0 && <span className="git-status-behind">↓{snapshot.behind}</span>}
        </span>
      )}
      {ci.total > 0 &&
        (() => {
          // Prefer the PR page; fall back to the first failing check's own URL
          // (same failure set summarizeChecks counts). Stays non-clickable when
          // there's no PR and nothing has failed (all pass/pending).
          const ciUrl =
            pr?.url ||
            pr?.checks?.find((c) => {
              const conclusion = (c.conclusion || '').toLowerCase()
              return conclusion && !['success', 'neutral', 'skipped'].includes(conclusion)
            })?.url
          const ciClickable = Boolean(ciUrl)
          const openCi = () => {
            if (ciUrl && typeof window.api.openExternalOrPath === 'function') {
              void window.api.openExternalOrPath(ciUrl)
            }
          }
          return (
            <span
              className={`git-status-ci git-ci-${ciTone}${
                ciClickable ? ' git-status-ci-clickable' : ''
              }`}
              title={`CI: ${ci.pass} passed · ${ci.fail} failed · ${ci.pending} pending${
                ciClickable ? ' — open' : ''
              }`}
              role={ciClickable ? 'button' : undefined}
              tabIndex={ciClickable ? 0 : undefined}
              onClick={ciClickable ? openCi : undefined}
              onKeyDown={
                ciClickable
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openCi()
                      }
                    }
                  : undefined
              }
            >
              <span className="git-status-ci-glyph">{ciGlyph}</span>
              {ciCount}
              <span className="git-status-ci-label">CI</span>
            </span>
          )
        })()}
    </div>
  )
}
