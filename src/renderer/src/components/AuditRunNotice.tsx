interface AuditRunNoticeProps {
  title: string
  message: string
  onDismiss?: () => void
}

export function AuditRunNotice({ title, message, onDismiss }: AuditRunNoticeProps) {
  return (
    <section
      className="audit-run-card audit-run-notice status-failed"
      role="alert"
      aria-label="Audit run notice"
    >
      <div className="audit-run-card-main">
        <header className="audit-run-card-header">
          <div>
            <span className="audit-run-kicker">TaskWraith Audit</span>
            <h2>{title}</h2>
          </div>
          <span className="audit-run-status status-failed">Action failed</span>
        </header>
        <div className="audit-run-error">{message}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          className="audit-run-dismiss"
          onClick={onDismiss}
          title="Dismiss this audit notice"
          aria-label="Dismiss audit notice"
        >
          Dismiss
        </button>
      )}
    </section>
  )
}
