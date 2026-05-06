import type { WorkspaceRecord, ChatRecord } from '../../../main/store/types'

interface HeaderProps {
  currentWorkspace: WorkspaceRecord | null
  currentChat: ChatRecord | null
  isRunning: boolean
  geminiVersion: string
}

export function Header({
  currentWorkspace,
  currentChat,
  isRunning,
  geminiVersion,
}: HeaderProps): React.JSX.Element {
  const isOld = geminiVersion !== 'unknown' && geminiVersion < '0.39.1'

  return (
    <div className="app-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <span className="header-title">Local Gemini Workbench</span>
        {currentWorkspace && (
          <>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>/</span>
            <span className="header-title" style={{ opacity: 0.7, fontWeight: 500 }}>{currentWorkspace.displayName}</span>
          </>
        )}
        {currentChat && (
          <>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>/</span>
            <span className="header-subtitle">{currentChat.title}</span>
          </>
        )}
      </div>
      <div className="header-spacer" />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {isOld && (
          <span className="header-subtitle" style={{ color: 'var(--danger)' }}>Update CLI</span>
        )}
        <span
          className="header-subtitle"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              backgroundColor: isRunning ? 'var(--success)' : 'var(--text-muted)',
              boxShadow: isRunning ? '0 0 6px var(--success)' : 'none',
              transition: 'all 0.3s ease',
            }}
          />
          {isRunning ? 'Running' : 'Idle'}
        </span>
      </div>
    </div>
  )
}
