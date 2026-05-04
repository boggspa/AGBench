import { useState, useEffect, useRef } from 'react'

interface LogEntry {
  type: 'out' | 'err' | 'event'
  text: string
}

function App(): React.JSX.Element {
  const [workspace, setWorkspace] = useState<string | null>(() => localStorage.getItem('recent-workspace'))
  const [prompt, setPrompt] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [diff, setDiff] = useState<string>('')
  
  const logsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (workspace) {
      localStorage.setItem('recent-workspace', workspace)
    }
  }, [workspace])

  useEffect(() => {
    // Auto-scroll logs
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  useEffect(() => {
    // IPC Listeners
    window.api.onGeminiOutput((data) => {
      // Basic heuristic: check if it's a line-delimited JSON stream
      const lines = data.split('\n').filter(l => l.trim() !== '')
      
      lines.forEach(line => {
        try {
          const parsed = JSON.parse(line)
          // Attempt to parse standard event structures if available, or just stringify it
          // For MVP, we'll format text content if it exists
          if (parsed.type === 'token') {
             setLogs(prev => {
                const last = prev[prev.length - 1];
                if (last && last.type === 'out') {
                   // Append token to the last text block to avoid spamming DOM elements
                   return [...prev.slice(0, -1), { type: 'out', text: last.text + parsed.content }]
                }
                return [...prev, { type: 'out', text: parsed.content }]
             })
          } else {
             setLogs(prev => [...prev, { type: 'event', text: JSON.stringify(parsed, null, 2) }])
          }
        } catch {
          // Fallback if not valid JSON
          setLogs(prev => [...prev, { type: 'out', text: line }])
        }
      })
    })

    window.api.onGeminiError((error) => {
      setLogs(prev => [...prev, { type: 'err', text: error }])
    })

    window.api.onGeminiExit((code) => {
      setIsRunning(false)
      setLogs(prev => [...prev, { type: 'event', text: `[Process exited with code ${code}]` }])
      refreshDiff()
    })

    return () => {
      window.api.removeListeners()
    }
  }, [workspace])

  const handleSelectWorkspace = async () => {
    const path = await window.api.selectWorkspace()
    if (path) {
      setWorkspace(path)
      setLogs([])
      setDiff('')
    }
  }

  const refreshDiff = async () => {
    if (workspace) {
      const diffText = await window.api.getDiff(workspace)
      setDiff(diffText)
    }
  }

  const handleRun = async () => {
    if (!workspace || !prompt.trim()) return
    
    setLogs([{ type: 'event', text: `[Starting task...]` }])
    setIsRunning(true)
    await window.api.runGemini(workspace, prompt)
    setPrompt('')
  }

  const handleCancel = async () => {
    await window.api.cancelGemini()
    setIsRunning(false)
  }

  const formatDiff = (text: string) => {
    return text.split('\n').map((line, i) => {
      let className = ''
      if (line.startsWith('+')) className = 'diff-add'
      if (line.startsWith('-')) className = 'diff-sub'
      if (line.startsWith('@@')) className = 'diff-info'
      return <div key={i} className={className}>{line}</div>
    })
  }

  return (
    <div className="app-container">
      {/* LEFT: Settings & Workspace */}
      <div className="panel">
        <h2>Workspace</h2>
        <button onClick={handleSelectWorkspace}>Select Folder</button>
        {workspace ? (
          <div className="workspace-path">{workspace}</div>
        ) : (
          <div className="workspace-path" style={{color: '#888'}}>No workspace selected</div>
        )}
        
        <div style={{marginTop: 'auto', fontSize: '0.8rem', color: '#666'}}>
          <h3>Safety Checks</h3>
          <p>• Isolated to workspace folder</p>
          <p>• Diffs shown after run</p>
          <p>• Denylist: .env, ~/.ssh</p>
        </div>
      </div>

      {/* CENTER: Chat / Process */}
      <div className="panel">
        <h2>
          <span className={`status-indicator ${isRunning ? 'running' : 'stopped'}`}></span>
          Terminal / Task
        </h2>
        
        <div className="chat-history">
          {logs.map((log, i) => (
            <div key={i} className={`log-line ${log.type === 'err' ? 'log-error' : ''}`} style={log.type === 'event' ? {color: '#888', fontStyle: 'italic'} : {}}>
              {log.text}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>

        <textarea 
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="Enter prompt for Gemini CLI..."
          rows={4}
          disabled={isRunning || !workspace}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleRun()
            }
          }}
        />
        <div style={{display: 'flex', gap: '10px'}}>
          <button 
            style={{flexGrow: 1}} 
            onClick={handleRun} 
            disabled={isRunning || !workspace || !prompt.trim()}
          >
            Run
          </button>
          {isRunning && (
            <button className="btn-danger" onClick={handleCancel}>
              Stop
            </button>
          )}
        </div>
      </div>

      {/* RIGHT: Diff Viewer */}
      <div className="panel">
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
          <h2 style={{border: 'none', margin: 0}}>Diff Review</h2>
          <button style={{margin: 0, padding: '4px 8px'}} onClick={refreshDiff} disabled={!workspace}>Refresh</button>
        </div>
        <div style={{borderBottom: '1px solid #333', marginBottom: '1rem', paddingBottom: '0.5rem'}}></div>
        <div className="diff-viewer">
          {diff ? formatDiff(diff) : <span style={{color: '#666'}}>No changes detected or not a git repository.</span>}
        </div>
      </div>
    </div>
  )
}

export default App
