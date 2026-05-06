import { useEffect, useState, type ReactNode } from 'react';
import { ToolActivity } from '../../../main/store/types';
import { estimateLineChanges } from '../lib/ToolParser';
import { FileTypeIcon } from './FileTypeIcon';

interface ActivityStackProps {
  activities: ToolActivity[];
  workspacePath?: string
}

const WRITER_TOOLS = ['replace', 'write_file', 'create_file', 'edit_file'];
const SEARCH_PARAM_KEYS = ['query', 'search_query', 'pattern', 'regex', 'term'];
const COMMAND_PARAM_KEYS = ['command', 'cmd', 'script'];
const CONTENT_PARAM_KEYS = ['content', 'new_string', 'old_string'];
const PATH_PARAM_KEYS = ['file_path', 'filePath', 'path', 'target', 'target_file', 'target_file_path'];

interface SanitizedDetail {
  rows: Array<{ label: string; value: string }>;
  previews: Array<{ label: string; content: string; terminal?: boolean; tone?: 'addition' | 'deletion' | 'diff' | 'neutral' }>;
}

function getStringParam(parameters: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = parameters[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function truncateText(value: string, maxLength = 420): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function countLines(value: string): number {
  if (!value) {
    return 0;
  }
  return value.split('\n').length;
}

function getActivityKind(activity: ToolActivity): string {
  return (activity.toolName || activity.category || '').toLowerCase();
}

function isSearchActivity(activity: ToolActivity): boolean {
  const kind = getActivityKind(activity);
  return activity.category === 'search' || kind.includes('search') || kind === 'grep' || kind === 'rg';
}

function isShellActivity(activity: ToolActivity): boolean {
  const kind = getActivityKind(activity);
  return activity.category === 'shell' || kind === 'run_shell_command' || kind === 'shell';
}

function buildSanitizedDetail(activity: ToolActivity, activityFilePath?: string, addedLines?: number, deletedLines?: number): SanitizedDetail {
  const parameters = activity.parameters || {};
  const rows: SanitizedDetail['rows'] = [];
  const previews: SanitizedDetail['previews'] = [];
  const resultText = activity.resultSummary || activity.outputPreview || '';
  const toolName = (activity.toolName || '').toLowerCase();
  const content = getStringParam(parameters, CONTENT_PARAM_KEYS);
  const command = getStringParam(parameters, COMMAND_PARAM_KEYS);
  const query = getStringParam(parameters, SEARCH_PARAM_KEYS);

  if (activityFilePath) {
    rows.push({ label: 'File', value: activityFilePath });
  }

  if (isShellActivity(activity)) {
    const cwd = getStringParam(parameters, ['cwd', 'working_directory', 'workingDirectory']);
    if (cwd) {
      rows.push({ label: 'Working directory', value: cwd });
    }
    if (command) {
      previews.push({ label: 'Command', content: command, terminal: true });
    }
    if (resultText) {
      previews.push({ label: activity.status === 'error' ? 'Error output' : 'Output', content: truncateText(resultText, 1000), terminal: true });
    }
    return { rows, previews };
  }

  if (isSearchActivity(activity)) {
    const scope = getStringParam(parameters, ['path', 'dir', 'directory', 'include', 'glob']);
    if (query) {
      rows.push({ label: toolName.includes('web_search') ? 'Search' : 'Pattern', value: query });
    }
    if (scope) {
      rows.push({ label: 'Scope', value: scope });
    }
    if (resultText) {
      previews.push({ label: 'Result', content: truncateText(resultText), tone: 'neutral' });
    }
    return { rows, previews };
  }

  if (activity.category === 'task') {
    if (resultText) {
      previews.push({
        label: toolName === 'codex_reasoning' ? 'Thoughts' : 'Update',
        content: truncateText(resultText, 1000),
        tone: 'neutral'
      });
    }
    return { rows, previews };
  }

  if (activity.category === 'write' || WRITER_TOOLS.includes(toolName)) {
    const operation =
      toolName === 'replace'
        ? 'Edited file'
        : toolName === 'create_file'
          ? 'Created file'
          : 'Wrote file';
    rows.push({ label: 'Action', value: operation });

    if (addedLines !== undefined || deletedLines !== undefined) {
      rows.push({ label: 'Diff', value: `+${addedLines || 0} / -${deletedLines || 0}` });
    } else if (content) {
      rows.push({ label: 'Content', value: `${countLines(content)} line${countLines(content) === 1 ? '' : 's'}` });
    }

    if (toolName === 'replace') {
      const oldString = typeof parameters.old_string === 'string' ? parameters.old_string : '';
      const newString = typeof parameters.new_string === 'string' ? parameters.new_string : '';
      if (oldString) previews.push({ label: 'Removed', content: truncateText(oldString), tone: 'deletion' });
      if (newString) previews.push({ label: 'Added', content: truncateText(newString), tone: 'addition' });
    } else if (content) {
      previews.push({ label: 'Added content', content: truncateText(content), tone: 'addition' });
    }

    if (resultText) {
      previews.push({ label: 'Result', content: truncateText(resultText), tone: 'neutral' });
    }
    return { rows, previews };
  }

  const pathValue = getStringParam(parameters, PATH_PARAM_KEYS);
  if (!activityFilePath && pathValue) {
    rows.push({ label: 'Path', value: pathValue });
  }
  if (query) {
    rows.push({ label: 'Query', value: query });
  }
  if (content) {
    rows.push({ label: 'Content', value: `${countLines(content)} line${countLines(content) === 1 ? '' : 's'}` });
    previews.push({ label: 'Content preview', content: truncateText(content), tone: 'diff' });
  }
  if (resultText) {
    previews.push({ label: 'Result', content: truncateText(resultText), tone: 'neutral' });
  }

  return { rows, previews };
}

function getFilePathFromActivity(activity: ToolActivity): string | undefined {
  const candidateFields: string[] = [
    'file_path',
    'filePath',
    'path',
    'target',
    'target_file',
    'target_file_path',
    'source',
    'source_file',
    'source_file_path',
    'destination',
    'destination_file',
    'destination_file_path',
  ];

  for (const field of candidateFields) {
    const value = activity.parameters?.[field];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  if (activity.filePath && typeof activity.filePath === 'string' && activity.filePath.trim()) {
    return activity.filePath.trim();
  }

  if (activity.affectedFilePath && typeof activity.affectedFilePath === 'string' && activity.affectedFilePath.trim()) {
    return activity.affectedFilePath.trim();
  }

  return undefined;
}

function getBaseName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() || path;
}

function getFileActionLabel(activity: ToolActivity): string {
  const toolName = (activity.toolName || '').toLowerCase();
  if (toolName === 'replace' || toolName === 'edit_file') return 'Edited';
  if (toolName === 'create_file') return 'Created';
  if (toolName === 'write_file') return 'Wrote';
  if (toolName === 'read_file') return 'Read';
  return activity.displayName || activity.toolName || 'Used tool';
}

function getInlineActivityTitle(activity: ToolActivity, filePath?: string): ReactNode {
  if (filePath) {
    return <ActivityTitle activity={activity} filePath={filePath} />;
  }

  const parameters = activity.parameters || {};
  if (isShellActivity(activity)) {
    const command = getStringParam(parameters, COMMAND_PARAM_KEYS);
    return command
      ? <>Ran <code className="activity-inline-command">{truncateText(command, 150)}</code></>
      : <>{activity.displayName || 'Ran shell command'}</>;
  }

  if (isSearchActivity(activity)) {
    const query = getStringParam(parameters, SEARCH_PARAM_KEYS);
    return query ? <>Searched for <strong>{query}</strong></> : <>{activity.displayName || 'Searched project'}</>;
  }

  if (activity.category === 'task') {
    const summary = activity.resultSummary || activity.outputPreview || getStringParam(parameters, ['summary', 'message', 'text', 'intent']);
    return summary ? <>{truncateText(summary, 120)}</> : <>{activity.displayName || 'Task update'}</>;
  }

  return <ActivityTitle activity={activity} filePath={filePath} />;
}

function ActivityTitle({ activity, filePath }: { activity: ToolActivity; filePath?: string }) {
  if (!filePath) {
    return <>{activity.displayName || activity.toolName}</>;
  }

  return (
    <>
      {getFileActionLabel(activity)} <strong className="activity-file-name">{getBaseName(filePath)}</strong>
    </>
  );
}

function getDiffToneClass(line: string, tone: SanitizedDetail['previews'][number]['tone']): string {
  const prefix = line[0];

  if (tone === 'diff') {
    if (prefix === '+' && !line.startsWith('+++')) return 'activity-diff-line-add';
    if (prefix === '-' && !line.startsWith('---')) return 'activity-diff-line-delete';
    return 'activity-diff-line-context';
  }

  if (tone === 'addition') {
    if (!line) return 'activity-diff-line-context';
    if (prefix === '-' && !line.startsWith('---')) return 'activity-diff-line-context';
    if (prefix === '+' && !line.startsWith('+++')) return 'activity-diff-line-add';
    return 'activity-diff-line-add';
  }

  if (tone === 'deletion') {
    if (!line) return 'activity-diff-line-context';
    if (prefix === '+' && !line.startsWith('+++')) return 'activity-diff-line-context';
    if (prefix === '-' && !line.startsWith('---')) return 'activity-diff-line-delete';
    return 'activity-diff-line-delete';
  }

  return 'activity-diff-line-context';
}

function ActivityPreview({ preview }: { preview: SanitizedDetail['previews'][number] }) {
  if (preview.terminal) {
    return <pre className="activity-output-terminal">{preview.content}</pre>;
  }

  return (
    <pre className="activity-output-clean activity-output-diff">
      {preview.content.split('\n').map((line, index) => (
        <span key={`${index}-${line}`} className={`activity-diff-line ${getDiffToneClass(line, preview.tone || 'neutral')}`}>
          {line || ' '}
        </span>
      ))}
    </pre>
  );
}

export function ActivityStack({ activities, workspacePath }: ActivityStackProps) {
  if (!activities || activities.length === 0) return null;

  return (
    <div className="activity-timeline">
      {activities.map(activity => (
        <ActivityRow key={activity.id} activity={activity} workspacePath={workspacePath} />
      ))}
    </div>
  );
}

function ActivityRow({ activity, workspacePath }: { activity: ToolActivity; workspacePath?: string }) {
  const defaultCollapsed = activity.category === 'task' || activity.category === 'shell';
  const [expanded, setExpanded] = useState(!defaultCollapsed);

  useEffect(() => {
    if (activity.status === 'success' || activity.status === 'warning' || activity.status === 'error') {
      setExpanded(false)
    } else if (activity.status === 'running' || activity.status === 'pending') {
      setExpanded(true)
    }
  }, [activity.status])

  const StatusIcon = () => {
    switch (activity.status) {
      case 'running': return <span className="activity-status running">◐</span>;
      case 'success': return <span className="activity-status success">✓</span>;
      case 'warning': return <span className="activity-status warning">⚠</span>;
      case 'error': return <span className="activity-status error">✗</span>;
      default: return <span className="activity-status" style={{ color: 'var(--text-muted)' }}>○</span>;
    }
  };

  const isUnknown = activity.toolName === 'unknown' || !activity.toolName;
  const showDebugWarning = Boolean(isUnknown && (activity.rawUseEvent || activity.rawResultEvent));
  const isWriteAction = WRITER_TOOLS.includes((activity.toolName || '').toLowerCase());
  const activityFilePath = getFilePathFromActivity(activity);

  const chipText: string[] = [];
  if (isWriteAction && activityFilePath) chipText.push(activityFilePath);
  if (activity.durationMs !== undefined) chipText.push(`${activity.durationMs}ms`);
  const metaText = chipText.join(' · ');
  const parameters = activity.parameters || {};
  const lineChanges = estimateLineChanges(parameters);
  const hasFileContent = typeof parameters.content === 'string';
  const lineChangesFromContent = hasFileContent && ['write_file', 'create_file', 'edit_file'].includes((activity.toolName || '').toLowerCase())
    ? { additions: (parameters.content as string).split('\n').length, deletions: 0 }
    : { additions: undefined, deletions: undefined };
  const addedLines = lineChanges.additions ?? lineChangesFromContent.additions;
  const deletedLines = lineChanges.deletions ?? lineChangesFromContent.deletions;
  const hasLineChanges = addedLines !== undefined || deletedLines !== undefined;
  const sanitizedDetail = buildSanitizedDetail(activity, activityFilePath, addedLines, deletedLines);
  const hasSanitizedDetail = sanitizedDetail.rows.length > 0 || sanitizedDetail.previews.length > 0;
  const shouldShowRawEvent = showDebugWarning || (isUnknown && !hasSanitizedDetail);
  const isInlineActivity = !expanded && !shouldShowRawEvent;

  const toggleExpanded = () => setExpanded(current => !current);

  return (
      <div
        className={`activity-row ${isInlineActivity ? 'activity-row-inline' : 'activity-row-card'} ${expanded ? 'expanded' : 'collapsed'}`}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggleExpanded}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            toggleExpanded()
          }
        }}
      >
      <StatusIcon />
      <div className="activity-body">
        <div className="activity-header">
          <div className="activity-label">
            <span className="activity-label-main">
              {isWriteAction && activityFilePath && !isInlineActivity ? (
                <FileTypeIcon path={activityFilePath} size={14} className="activity-file-type-icon" workspacePath={workspacePath} />
              ) : null}
              {isInlineActivity ? getInlineActivityTitle(activity, activityFilePath) : <ActivityTitle activity={activity} filePath={activityFilePath} />}
            </span>
          </div>
          {hasLineChanges && (
            <div className="activity-line-stats">
              <span className="activity-line-stat activity-line-stat-add">+{addedLines || 0}</span>
              <span className="activity-line-stat-divider">|</span>
              <span className="activity-line-stat activity-line-stat-delete">-{deletedLines || 0}</span>
            </div>
          )}
        </div>
        {metaText && (
          <div className="activity-meta">{metaText}</div>
        )}

        {expanded && (
          <div className="activity-detail">
            {showDebugWarning && (
              <div style={{ color: 'var(--warning)' }}>Tool event missing name</div>
            )}
            {sanitizedDetail.rows.length > 0 && (
              <div className="activity-detail-grid">
                {sanitizedDetail.rows.map((row) => (
                  <div key={`${row.label}-${row.value}`} className="activity-detail-row">
                    <span className="activity-detail-label">{row.label}</span>
                    <span className="activity-detail-value">{row.value}</span>
                  </div>
                ))}
              </div>
            )}
            {sanitizedDetail.previews.map((preview) => (
              <div key={`${preview.label}-${preview.content.slice(0, 32)}`}>
                <div className="activity-detail-section-title">{preview.label}</div>
                <ActivityPreview preview={preview} />
              </div>
            ))}
            {shouldShowRawEvent && (!!activity.rawUseEvent || !!activity.rawResultEvent) && (
              <div>
                <div className="activity-detail-section-title">Raw event</div>
                <pre className="activity-output-terminal">{JSON.stringify(activity.rawUseEvent || activity.rawResultEvent, null, 2)}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
