import type { DiffFileSummary } from '../../../main/store/types'

const MAX_REVIEW_DIFF_CHARS = 90000

const summarizeReviewDiffFile = (summary: DiffFileSummary): string => {
  const details: string[] = [summary.status]

  if (typeof summary.additions === 'number' || typeof summary.deletions === 'number') {
    details.push(`+${summary.additions || 0}/-${summary.deletions || 0}`)
  }
  if (summary.isSensitive) {
    details.push('sensitive content omitted')
  }
  if (summary.isBinary) {
    details.push('binary')
  }
  if (summary.isNoise) {
    details.push('noise')
  }
  if (summary.previewKind && summary.previewKind !== 'none') {
    details.push(`preview: ${summary.previewKind}`)
  }

  return `- ${summary.path} (${details.join(', ')})`
}

const collectReviewDiffText = (diffObj: any): string => {
  const chunks: string[] = []
  const seen = new Set<string>()

  const appendChunk = (value: unknown) => {
    if (typeof value !== 'string') return
    const text = value.trim()
    if (!text || seen.has(text)) return
    seen.add(text)
    chunks.push(text)
  }

  appendChunk(diffObj?.diffText)

  if (Array.isArray(diffObj?.summaries)) {
    diffObj.summaries.forEach((summary: DiffFileSummary) => appendChunk(summary.diffText))
  }

  return chunks.join('\n\n')
}

const buildReviewCurrentDiffPrompt = (diffObj: any): string => {
  const summaries = Array.isArray(diffObj?.summaries)
    ? diffObj.summaries.filter((summary: DiffFileSummary) => summary?.path)
    : []
  const summaryText =
    summaries.length > 0
      ? summaries.map(summarizeReviewDiffFile).join('\n')
      : diffObj?.statusText
        ? `Git status:\n${diffObj.statusText}`
        : diffObj?.text || 'No file-level summary was available.'

  const fullDiffText = collectReviewDiffText(diffObj)
  const diffText =
    fullDiffText.length > MAX_REVIEW_DIFF_CHARS
      ? `${fullDiffText.slice(0, MAX_REVIEW_DIFF_CHARS)}\n[Diff truncated by TaskWraith before sending to the reviewer. Inspect the workspace with read-only commands if needed.]`
      : fullDiffText

  const diffBlock = diffText
    ? `Current diff text:\n~~~diff\n${diffText}\n~~~`
    : 'No inline diff text was available. Inspect current changes with read-only commands if needed.'

  return [
    'You are performing a read-only code review of the current workspace diff, equivalent to Codex /review.',
    'Review only the current uncommitted workspace changes. Do not edit files, apply patches, stage files, commit files, run formatters, or make any workspace changes.',
    'If the included diff is incomplete, inspect the workspace using read-only commands such as git status --short, git diff --cached, git diff, and file reads.',
    'Return findings first, ordered by severity. For each finding include severity, file/location, issue, impact, and a concrete suggested fix. If there are no findings, say so explicitly and mention residual risks or testing gaps.',
    `Diff source status: ${diffObj?.type || 'unknown'}.`,
    `Current diff summary:\n${summaryText}`,
    diffBlock
  ].join('\n\n')
}

export {
  MAX_REVIEW_DIFF_CHARS,
  summarizeReviewDiffFile,
  collectReviewDiffText,
  buildReviewCurrentDiffPrompt
}
