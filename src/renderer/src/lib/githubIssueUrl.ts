/**
 * Build a pre-filled GitHub "new issue" URL from a bug report. Lets a public
 * user file the report (with TaskWraith's auto-captured context) straight to the
 * repo's issue tracker — no gh CLI or auth dance, just opens the browser to the
 * new-issue form with title + body populated. Pure + unit-tested so the body
 * format and encoding stay pinned.
 */
const GITHUB_NEW_ISSUE_BASE = 'https://github.com/boggspa/TaskWraith/issues/new'

export interface GitHubIssueDraft {
  title: string
  description: string
  expected: string
  severity: string
  /** Ordered [label, value] context pairs; empty/undefined values are skipped. */
  context: Array<[string, string | undefined]>
}

export function buildGitHubIssueBody(draft: GitHubIssueDraft): string {
  const lines: string[] = []
  if (draft.description.trim()) {
    lines.push('### What happened', draft.description.trim(), '')
  }
  if (draft.expected.trim()) {
    lines.push('### Expected', draft.expected.trim(), '')
  }
  lines.push(`**Severity:** ${draft.severity}`, '', '### Context')
  for (const [label, value] of draft.context) {
    if (value && value.trim()) lines.push(`- **${label}:** ${value.trim()}`)
  }
  lines.push('', '_Filed from TaskWraith → Report a bug._')
  return lines.join('\n')
}

export function buildGitHubIssueUrl(draft: GitHubIssueDraft): string {
  const params = new URLSearchParams({
    title: draft.title.trim(),
    body: buildGitHubIssueBody(draft)
  })
  return `${GITHUB_NEW_ISSUE_BASE}?${params.toString()}`
}
