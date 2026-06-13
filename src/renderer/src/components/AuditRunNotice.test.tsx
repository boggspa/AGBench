import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AuditRunNotice } from './AuditRunNotice'

describe('AuditRunNotice', () => {
  it('renders an alert with the audit action error and dismiss affordance', () => {
    const html = renderToStaticMarkup(
      <AuditRunNotice
        title="Could not start audit"
        message="An audit is already running."
        onDismiss={() => {}}
      />
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('Could not start audit')
    expect(html).toContain('An audit is already running.')
    expect(html).toContain('Dismiss')
  })
})
