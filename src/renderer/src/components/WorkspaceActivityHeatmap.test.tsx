import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkspaceActivityHeatmap } from './WorkspaceActivityHeatmap'

describe('WorkspaceActivityHeatmap', () => {
  it('renders an empty accent heatmap shell before the async snapshot arrives', () => {
    const html = renderToStaticMarkup(
      <WorkspaceActivityHeatmap workspacePath="/repo" dayCount={90} />
    )

    expect(html).toContain('Workspace Activity')
    expect(html).toContain('usage-heatmap--workspace-activity')
    expect(html).toContain('90D <strong>0</strong>')
    expect((html.match(/workspace-activity-heatmap-cell/g) || []).length).toBe(90 * 12)
  })
})
