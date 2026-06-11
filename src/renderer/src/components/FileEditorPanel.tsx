import { useCallback, useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { keymap, EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { defaultKeymap, historyKeymap } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { markdown } from '@codemirror/lang-markdown'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { cpp } from '@codemirror/lang-cpp'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { tags } from '@lezer/highlight'
import type { WorkspaceFileEntry, WorkspaceFileReadResult } from '../../../main/store/types'
import { FileTypeIcon } from './FileTypeIcon'

interface FileEditorPanelProps {
  workspacePath?: string
  width?: number
}

const formatBytes = (value?: number): string => {
  if (!value) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

const codeEditorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      background: 'transparent',
      color: 'var(--text-primary)',
      fontSize: '12px'
    },
    '&.cm-focused': {
      outline: 'none'
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      lineHeight: '20px',
      background: 'transparent',
      overflow: 'auto'
    },
    '.cm-content': {
      padding: 'var(--space-sm) 0',
      caretColor: 'var(--accent)',
      background: 'transparent',
      minWidth: 'max-content'
    },
    '.cm-line': {
      padding: '0 var(--space-sm)',
      background: 'transparent',
      whiteSpace: 'pre'
    },
    '.cm-gutters': {
      background: 'var(--cm-gutter-bg)',
      color: 'var(--text-muted)',
      borderRight: '1px solid var(--cm-gutter-border)'
    },
    '.cm-activeLine': {
      background: 'var(--cm-active-line)'
    },
    '.cm-activeLineGutter': {
      background: 'var(--cm-active-line)',
      color: 'var(--text-secondary)'
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      background: 'color-mix(in srgb, var(--accent) 34%, transparent)'
    },
    '.cm-matchingBracket, .cm-nonmatchingBracket': {
      background: 'var(--cm-bracket-match)',
      outline: '1px solid var(--accent)'
    },
    '.cm-line ::selection, .cm-content ::selection': {
      background: 'color-mix(in srgb, var(--accent) 34%, transparent)'
    }
  },
  { dark: true }
)

const codeHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--cm-keyword)', fontWeight: '600' },
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: 'var(--cm-name)' },
  { tag: [tags.propertyName, tags.variableName, tags.labelName], color: 'var(--cm-property)' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: 'var(--cm-function)'
  },
  { tag: [tags.className, tags.definition(tags.typeName), tags.typeName], color: 'var(--cm-type)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--cm-number)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--cm-string)' },
  { tag: [tags.regexp, tags.escape], color: 'var(--cm-regexp)' },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: 'var(--cm-comment)',
    fontStyle: 'italic'
  },
  { tag: tags.meta, color: 'var(--cm-meta)' },
  { tag: tags.heading, color: 'var(--cm-heading)', fontWeight: '700' },
  { tag: tags.link, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: tags.invalid, color: 'var(--cm-invalid)' }
])

const shellLanguage = StreamLanguage.define(shell)

const extensionForPath = (filePath: string): Extension[] => {
  const lower = filePath.toLowerCase()
  if (/\.(js|jsx|mjs|cjs)$/.test(lower)) return [javascript({ jsx: true })]
  if (/\.(ts|tsx)$/.test(lower)) return [javascript({ jsx: lower.endsWith('x'), typescript: true })]
  if (/\.py$/.test(lower)) return [python()]
  if (/\.(md|markdown)$/.test(lower)) return [markdown()]
  if (/\.json(c)?$/.test(lower)) return [json()]
  if (/\.(html|htm|xml|svg)$/.test(lower)) return [html()]
  if (/\.(css|scss|sass|less)$/.test(lower)) return [css()]
  if (/\.(c|h|cc|cpp|cxx|hpp|hh|m|mm|metal|swift)$/.test(lower)) return [cpp()]
  if (
    /\.(sh|bash|zsh|fish|command|env)$/.test(lower) ||
    /(^|\/)(bashrc|zshrc|profile|env)$/.test(lower)
  )
    return [shellLanguage]
  return []
}

const editorApi = {
  listFiles: (workspacePath: string): Promise<WorkspaceFileEntry[]> => {
    return window.api.listWorkspaceFiles(workspacePath)
  },
  readFile: (workspacePath: string, filePath: string): Promise<WorkspaceFileReadResult> => {
    return window.api.readWorkspaceFile(workspacePath, filePath)
  },
  writeFile: (
    workspacePath: string,
    filePath: string,
    content: string,
    baseEtag?: string | null
  ): Promise<WorkspaceFileReadResult> => {
    return window.api.writeWorkspaceFile(workspacePath, filePath, content, baseEtag)
  }
}

export function FileEditorPanel({ workspacePath, width }: FileEditorPanelProps) {
  const [files, setFiles] = useState<WorkspaceFileEntry[]>([])
  const [filter, setFilter] = useState('')
  const [selectedPath, setSelectedPath] = useState('')
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [savedEtag, setSavedEtag] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [pendingOpenEntry, setPendingOpenEntry] = useState<WorkspaceFileEntry | null>(null)
  const isDirty = content !== savedContent
  const selectedName = selectedPath.split('/').filter(Boolean).pop() || selectedPath

  const filteredFiles = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return files
    return files.filter((item) => item.path.toLowerCase().includes(needle))
  }, [files, filter])

  const editorExtensions = useMemo<Extension[]>(
    () => [
      codeEditorTheme,
      syntaxHighlighting(codeHighlightStyle),
      highlightSelectionMatches(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      ...extensionForPath(selectedPath)
    ],
    [selectedPath]
  )

  const refreshFiles = useCallback(async () => {
    if (!workspacePath) {
      setFiles([])
      return
    }

    setIsLoading(true)
    setStatus('Loading files...')
    try {
      const nextFiles = await editorApi.listFiles(workspacePath)
      setFiles(nextFiles)
      setStatus(`${nextFiles.length} ${nextFiles.length === 1 ? 'item' : 'items'}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not load files')
    } finally {
      setIsLoading(false)
    }
  }, [workspacePath])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setSelectedPath('')
      setContent('')
      setSavedContent('')
      setSavedEtag(null)
      setPendingOpenEntry(null)
      void refreshFiles()
    })
    return () => {
      cancelled = true
    }
  }, [refreshFiles])

  const openFile = async (entry: WorkspaceFileEntry) => {
    if (!workspacePath || entry.isDirectory) return
    if (isDirty) {
      setPendingOpenEntry(entry)
      setStatus(`Unsaved changes in ${selectedPath}`)
      return
    }

    setIsLoading(true)
    setStatus(`Opening ${entry.path}`)
    try {
      const result = await editorApi.readFile(workspacePath, entry.path)
      setSelectedPath(result.path)
      setContent(result.content)
      setSavedContent(result.content)
      setSavedEtag(result.etag ?? null)
      setStatus(`${result.path} · ${formatBytes(result.sizeBytes)}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not open file')
    } finally {
      setIsLoading(false)
    }
  }

  const saveFile = async () => {
    if (!workspacePath || !selectedPath || !isDirty) return

    setIsLoading(true)
    setStatus(`Saving ${selectedPath}`)
    try {
      const nextPendingEntry = pendingOpenEntry
      const result = await editorApi.writeFile(workspacePath, selectedPath, content, savedEtag)
      setContent(result.content)
      setSavedContent(result.content)
      setSavedEtag(result.etag ?? savedEtag)
      setPendingOpenEntry(null)
      if (nextPendingEntry) {
        setStatus(`Opening ${nextPendingEntry.path}`)
        const nextResult = await editorApi.readFile(workspacePath, nextPendingEntry.path)
        setSelectedPath(nextResult.path)
        setContent(nextResult.content)
        setSavedContent(nextResult.content)
        setSavedEtag(nextResult.etag ?? null)
        setStatus(`${nextResult.path} · ${formatBytes(nextResult.sizeBytes)}`)
      } else {
        setStatus(`Saved ${result.path} · ${formatBytes(result.sizeBytes)}`)
      }
      void refreshFiles()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save or open file')
    } finally {
      setIsLoading(false)
    }
  }

  const discardChangesAndOpenPending = async () => {
    const nextEntry = pendingOpenEntry
    setPendingOpenEntry(null)
    setContent(savedContent)
    if (!workspacePath || !nextEntry) {
      return
    }

    setIsLoading(true)
    setStatus(`Opening ${nextEntry.path}`)
    try {
      const result = await editorApi.readFile(workspacePath, nextEntry.path)
      setSelectedPath(result.path)
      setContent(result.content)
      setSavedContent(result.content)
      setSavedEtag(result.etag ?? null)
      setStatus(`${result.path} · ${formatBytes(result.sizeBytes)}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not open file')
    } finally {
      setIsLoading(false)
    }
  }

  const cancelPendingOpen = () => {
    setPendingOpenEntry(null)
    setStatus(selectedPath ? `${selectedPath} · unsaved changes` : status)
  }

  return (
    <aside className="app-file-editor" style={width ? { width } : undefined}>
      <section className="file-editor-files">
        <div className="file-editor-header">
          <strong>Files</strong>
          <button
            className="btn btn-sm btn-ghost"
            type="button"
            onClick={refreshFiles}
            disabled={!workspacePath || isLoading}
          >
            Refresh
          </button>
        </div>
        <input
          className="file-editor-filter"
          aria-label="Filter workspace files"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter files"
          disabled={!workspacePath}
        />
        <div className="file-editor-list">
          {filteredFiles.length > 0 ? (
            filteredFiles.map((entry) => (
              <button
                key={`${entry.isDirectory ? 'dir' : 'file'}-${entry.path}`}
                className={`file-editor-row ${entry.isDirectory ? 'directory' : 'file'} ${selectedPath === entry.path ? 'active' : ''}`}
                style={{ paddingLeft: `calc(var(--space-sm) + ${entry.depth * 12}px)` }}
                type="button"
                onClick={() => openFile(entry)}
                disabled={entry.isDirectory || isLoading}
                title={entry.path}
              >
                <FileTypeIcon
                  path={entry.path}
                  size={14}
                  className="file-editor-file-icon"
                  workspacePath={workspacePath}
                />
                <span className="file-editor-file-name">{entry.name}</span>
                {!entry.isDirectory && (
                  <span className="file-editor-file-size">{formatBytes(entry.sizeBytes)}</span>
                )}
              </button>
            ))
          ) : (
            <div className="file-editor-empty">
              {isLoading ? 'Loading files...' : status || 'No workspace files found'}
            </div>
          )}
        </div>
      </section>

      <section
        className="file-editor-code"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault()
            void saveFile()
          }
        }}
      >
        <div className="file-editor-header">
          <strong className="file-editor-title">
            {selectedPath ? (
              <>
                <FileTypeIcon
                  path={selectedPath}
                  size={14}
                  className="file-editor-file-icon"
                  workspacePath={workspacePath}
                />
                <span>{selectedName}</span>
                {isDirty && <span className="file-editor-dirty-dot" title="Unsaved changes" />}
              </>
            ) : (
              'Editor'
            )}
          </strong>
          <button
            className="btn btn-sm"
            type="button"
            onClick={saveFile}
            disabled={!workspacePath || !selectedPath || !isDirty || isLoading}
            aria-label="Save editor file"
            title="Save editor file"
          >
            Save
          </button>
        </div>
        {pendingOpenEntry && (
          <div
            className="file-editor-unsaved-card"
            role="alertdialog"
            aria-label="Unsaved editor changes"
          >
            <strong>Unsaved changes</strong>
            <span>Save or discard changes before opening {pendingOpenEntry.path}.</span>
            <div className="file-editor-unsaved-actions">
              <button className="btn btn-sm" type="button" onClick={() => void saveFile()}>
                Save
              </button>
              <button
                className="btn btn-sm btn-ghost"
                type="button"
                onClick={() => void discardChangesAndOpenPending()}
              >
                Discard
              </button>
              <button className="btn btn-sm btn-ghost" type="button" onClick={cancelPendingOpen}>
                Cancel
              </button>
            </div>
          </div>
        )}
        <div className="file-editor-code-surface">
          {selectedPath ? (
            <CodeMirror
              value={content}
              height="100%"
              basicSetup={{
                lineNumbers: true,
                foldGutter: false,
                highlightActiveLine: true,
                highlightActiveLineGutter: true,
                bracketMatching: true,
                closeBrackets: true,
                autocompletion: true,
                rectangularSelection: false,
                crosshairCursor: false
              }}
              editable={!isLoading}
              readOnly={isLoading}
              extensions={editorExtensions}
              onChange={(value) => setContent(value)}
            />
          ) : (
            <div className="file-editor-placeholder">Select a text file</div>
          )}
        </div>
        <div className="file-editor-status">
          <span role="status" aria-live="polite">
            {isDirty ? 'Unsaved changes' : status}
          </span>
        </div>
      </section>
    </aside>
  )
}
