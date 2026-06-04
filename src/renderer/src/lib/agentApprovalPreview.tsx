const formatApprovalChangePreview = (changes: any): string => {
  if (!Array.isArray(changes) || changes.length === 0) return ''
  return changes
    .map((change) => {
      const kind = String(change?.kind || change?.type || change?.operation || 'update')
      const filePath = String(
        change?.path || change?.filePath || change?.file_path || change?.target || ''
      )
      const additions = Number(change?.additions || change?.added || 0)
      const deletions = Number(change?.deletions || change?.deleted || 0)
      const stats = additions || deletions ? ' (+' + additions + ' -' + deletions + ')' : ''
      return (kind + (filePath ? ' ' + filePath : '') + stats).trim()
    })
    .filter(Boolean)
    .join('\\n')
}

const renderAgentApprovalPreview = (preview: any): React.JSX.Element | null => {
  if (!preview || typeof preview !== 'object') return null
  const command = typeof preview.command === 'string' ? preview.command : ''
  const cwd = typeof preview.cwd === 'string' ? preview.cwd : ''
  const toolName = typeof preview.toolName === 'string' ? preview.toolName : ''
  const taskPreview = typeof preview.task === 'string' ? preview.task : ''
  const patchPreview =
    typeof preview.patchPreview === 'string'
      ? preview.patchPreview
      : typeof preview.diff === 'string'
        ? preview.diff
        : typeof preview.patch === 'string'
          ? preview.patch
          : ''
  const changesPreview = formatApprovalChangePreview(preview.changes)
  const kind = typeof preview.kind === 'string' ? preview.kind : 'approval'
  const hasDetails = command || cwd || toolName || taskPreview || patchPreview || changesPreview
  if (!hasDetails) return null

  return (
    <div className="agent-approval-preview">
      <div className="agent-approval-preview-header">{kind}</div>
      {toolName && (
        <div className="agent-approval-preview-row">
          <span>Tool</span>
          <code>{toolName}</code>
        </div>
      )}
      {cwd && (
        <div className="agent-approval-preview-row">
          <span>Cwd</span>
          <code>{cwd}</code>
        </div>
      )}
      {command && (
        <div className="agent-approval-preview-block">
          <span>Command</span>
          <pre>{command}</pre>
        </div>
      )}
      {taskPreview && (
        <div className="agent-approval-preview-block">
          <span>Task</span>
          <pre>{taskPreview}</pre>
        </div>
      )}
      {changesPreview && (
        <div className="agent-approval-preview-block">
          <span>Files</span>
          <pre>{changesPreview}</pre>
        </div>
      )}
      {patchPreview && (
        <div className="agent-approval-preview-block">
          <span>Diff preview</span>
          <pre>{patchPreview}</pre>
        </div>
      )}
    </div>
  )
}

export { formatApprovalChangePreview, renderAgentApprovalPreview }
