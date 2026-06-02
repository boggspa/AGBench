import { useState } from 'react'
import { DiffFileSummary, DiffPreviewKind } from '../../../main/store/types'
import { FileTypeIcon } from './FileTypeIcon'
import { useCopyFeedback } from '../lib/useCopyFeedback'

interface DiffViewerProps {
  diff: {
    type: string
    text?: string
    statusText?: string
    diffText?: string
    summaries?: DiffFileSummary[]
  } | null
  workspacePath?: string
}

export function DiffViewer({ diff, workspacePath }: DiffViewerProps) {
  const [hideNoise, setHideNoise] = useState(true)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  if (!diff)
    return (
      <div
        style={{
          color: 'var(--text-muted)',
          padding: 'var(--space-md)',
          fontSize: 'var(--font-size-sm)'
        }}
      >
        Run a task to see changes.
      </div>
    )
  if (diff.type === 'not_repo' || diff.type === 'no_changes')
    return (
      <div
        style={{
          color: 'var(--text-muted)',
          padding: 'var(--space-md)',
          fontSize: 'var(--font-size-sm)'
        }}
      >
        {diff.text || diff.statusText || 'No changes.'}
      </div>
    )
  if (diff.type === 'error')
    return (
      <div
        style={{
          color: 'var(--danger)',
          padding: 'var(--space-md)',
          fontSize: 'var(--font-size-sm)'
        }}
      >
        {diff.text}
      </div>
    )

  const summaries = diff.summaries || []
  const filteredSummaries = hideNoise ? summaries.filter((s) => !s.isNoise) : summaries

  const selectedSummary =
    filteredSummaries.find((s) => s.path === selectedPath) || filteredSummaries[0] || null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="diff-studio-toolbar">
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
          {filteredSummaries.length} changed
        </span>
        <label
          style={{
            fontSize: 'var(--font-size-xs)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            color: 'var(--text-secondary)',
            cursor: 'pointer'
          }}
        >
          <input
            type="checkbox"
            checked={hideNoise}
            onChange={(e) => setHideNoise(e.target.checked)}
          />
          Hide noise
        </label>
      </div>

      {filteredSummaries.length === 0 ? (
        <div
          style={{
            padding: 'var(--space-md)',
            color: 'var(--text-muted)',
            fontSize: 'var(--font-size-sm)'
          }}
        >
          No changes to display.
        </div>
      ) : (
        <>
          <div className="diff-file-list">
            {filteredSummaries.map((s) => (
              <button
                type="button"
                key={s.path}
                className={`diff-file-row ${selectedSummary?.path === s.path ? 'selected' : ''}`}
                onClick={() => setSelectedPath(s.path)}
                aria-pressed={selectedSummary?.path === s.path}
                title={`Show diff for ${s.path}`}
              >
                <FileTypeIcon
                  path={s.path}
                  size={14}
                  className="diff-file-type-icon"
                  workspacePath={workspacePath}
                />
                <span className="diff-file-name">{s.path}</span>
                <span className={`diff-file-badge ${s.status}`}>
                  {s.additions !== undefined && s.deletions !== undefined ? (
                    <>
                      <span className="diff-file-stat diff-file-stat-add">+{s.additions}</span>
                      <span className="diff-file-stat-divider">|</span>
                      <span className="diff-file-stat diff-file-stat-delete">-{s.deletions}</span>
                    </>
                  ) : (
                    s.status
                  )}
                </span>
              </button>
            ))}
          </div>

          {selectedSummary && <DiffDetail summary={selectedSummary} />}
        </>
      )}
    </div>
  )
}

function DiffDetail({ summary }: { summary: DiffFileSummary }) {
  const { copiedId, copy } = useCopyFeedback()
  const renderPreview = () => {
    const kind: DiffPreviewKind = summary.previewKind || 'none'
    switch (kind) {
      case 'hidden':
        return (
          <div
            style={{
              padding: 'var(--space-md)',
              color: 'var(--warning)',
              fontSize: 'var(--font-size-sm)'
            }}
          >
            Sensitive file — preview hidden
          </div>
        )
      case 'binary':
        return (
          <div
            style={{
              padding: 'var(--space-md)',
              color: 'var(--text-muted)',
              fontSize: 'var(--font-size-sm)'
            }}
          >
            Binary file
          </div>
        )
      case 'synthetic_new_file':
      case 'git_diff':
        return summary.diffText ? (
          formatDiff(summary.diffText)
        ) : (
          <div
            style={{
              padding: 'var(--space-md)',
              color: 'var(--text-muted)',
              fontSize: 'var(--font-size-sm)'
            }}
          >
            No diff available.
          </div>
        )
      case 'text_preview':
        return (
          <div
            style={{
              padding: 'var(--space-md)',
              color: 'var(--text-secondary)',
              fontSize: 'var(--font-size-sm)',
              whiteSpace: 'pre-wrap'
            }}
          >
            {summary.diffText}
          </div>
        )
      default:
        return (
          <div
            style={{
              padding: 'var(--space-md)',
              color: 'var(--text-muted)',
              fontSize: 'var(--font-size-sm)'
            }}
          >
            No preview available.
          </div>
        )
    }
  }

  return (
    <div className="diff-detail">
      <div className="diff-detail-header">
        <span>{summary.path}</span>
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => summary.diffText && copy('diff', summary.diffText)}
            title="Copy diff"
          >
            {copiedId === 'diff' ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      {renderPreview()}
    </div>
  )
}

function formatDiff(text: string) {
  const lines = text.split('\n')
  const sections: Array<{ header?: string; lines: string[] }> = []
  let current: { header?: string; lines: string[] } = { lines: [] }

  lines.forEach((line) => {
    if (line.startsWith('@@')) {
      if (current.lines.length > 0 || current.header) {
        sections.push(current)
      }
      current = { header: line, lines: [] }
      return
    }
    current.lines.push(line)
  })

  if (current.lines.length > 0 || current.header) {
    sections.push(current)
  }

  if (sections.length === 0) {
    return <div className="diff-lines-section">No diff hunks to display.</div>
  }

  const getHunkStartLines = (header?: string): { oldLine: number; newLine: number } => {
    const match = header?.match(/@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/)
    return {
      oldLine: match ? Number(match[1]) : 0,
      newLine: match ? Number(match[2]) : 0
    }
  }

  const isDiffMetadata = (line: string): boolean => {
    return (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('+++ ') ||
      line.startsWith('--- ') ||
      line.startsWith('rename from ') ||
      line.startsWith('rename to ') ||
      line.startsWith('new file mode ') ||
      line.startsWith('deleted file mode ')
    )
  }

  return (
    <div className="diff-lines-stack">
      {sections.map((section, sectionIndex) => (
        <div key={sectionIndex} className="diff-lines-section">
          {section.header ? (
            <div className="diff-lines-section-header">{section.header}</div>
          ) : null}
          {section.lines.length === 0 ? (
            <div className="diff-line">No content in this section.</div>
          ) : (
            (() => {
              const counters = getHunkStartLines(section.header)
              return section.lines.map((line, index) => {
                let className = 'diff-line'
                let oldLabel = ''
                let newLabel = ''

                if (isDiffMetadata(line)) {
                  className += ' meta'
                } else if (line.startsWith('+')) {
                  className += ' add'
                  newLabel = counters.newLine > 0 ? String(counters.newLine) : ''
                  counters.newLine += 1
                } else if (line.startsWith('-')) {
                  className += ' del'
                  oldLabel = counters.oldLine > 0 ? String(counters.oldLine) : ''
                  counters.oldLine += 1
                } else {
                  oldLabel = counters.oldLine > 0 ? String(counters.oldLine) : ''
                  newLabel = counters.newLine > 0 ? String(counters.newLine) : ''
                  counters.oldLine += counters.oldLine > 0 ? 1 : 0
                  counters.newLine += counters.newLine > 0 ? 1 : 0
                }

                return (
                  <div key={index} className={className}>
                    <span className="diff-line-gutter old">{oldLabel}</span>
                    <span className="diff-line-gutter new">{newLabel}</span>
                    <span className="diff-line-code">{line || ' '}</span>
                  </div>
                )
              })
            })()
          )}
        </div>
      ))}
    </div>
  )
}
