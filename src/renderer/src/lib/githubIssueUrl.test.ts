import { describe, expect, it } from 'vitest'
import { buildGitHubIssueBody, buildGitHubIssueUrl, type GitHubIssueDraft } from './githubIssueUrl'

const draft: GitHubIssueDraft = {
  title: 'Composer freezes after Cmd+K',
  description: 'Pressed Cmd+K then typed.',
  expected: 'Palette opens.',
  severity: 'major',
  context: [
    ['Version', '1.0.72'],
    ['Provider', 'codex'],
    ['Empty', ''],
    ['Missing', undefined],
    ['Surface', 'Composer']
  ]
}

describe('buildGitHubIssueBody', () => {
  it('includes the sections, severity, and non-empty context only', () => {
    const body = buildGitHubIssueBody(draft)
    expect(body).toContain('### What happened')
    expect(body).toContain('Pressed Cmd+K then typed.')
    expect(body).toContain('### Expected')
    expect(body).toContain('**Severity:** major')
    expect(body).toContain('- **Version:** 1.0.72')
    expect(body).toContain('- **Surface:** Composer')
    expect(body).not.toContain('Empty')
    expect(body).not.toContain('Missing')
  })

  it('omits empty optional sections', () => {
    const body = buildGitHubIssueBody({ ...draft, description: '', expected: '' })
    expect(body).not.toContain('### What happened')
    expect(body).not.toContain('### Expected')
    expect(body).toContain('**Severity:** major')
  })
})

describe('buildGitHubIssueUrl', () => {
  it('targets the repo new-issue form with encoded title + body', () => {
    const url = buildGitHubIssueUrl(draft)
    expect(url.startsWith('https://github.com/boggspa/AGBench/issues/new?')).toBe(true)
    const parsed = new URL(url)
    expect(parsed.searchParams.get('title')).toBe('Composer freezes after Cmd+K')
    expect(parsed.searchParams.get('body')).toContain('**Severity:** major')
  })
})
