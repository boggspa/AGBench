import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { renderAgentApprovalPreview } from './agentApprovalPreview'

describe('agent approval preview', () => {
  it('renders shell risk labels and env deltas', () => {
    const markup = renderToStaticMarkup(
      renderAgentApprovalPreview({
        kind: 'command',
        command: 'npm install left-pad',
        cwd: '/workspace',
        riskLabels: ['workspace shell execution', 'dependency change'],
        envDeltas: { FORCE_COLOR: '0', NO_COLOR: '1' }
      })!
    )

    expect(markup).toContain('Risk')
    expect(markup).toContain('workspace shell execution, dependency change')
    expect(markup).toContain('Env deltas')
    expect(markup).toContain('FORCE_COLOR=0')
    expect(markup).toContain('NO_COLOR=1')
  })
})
