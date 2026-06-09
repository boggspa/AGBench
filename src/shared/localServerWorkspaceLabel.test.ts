import { describe, expect, it } from 'vitest'
import {
  formatLocalServerWorkspaceLabel,
  localServerWorkspaceLabel
} from './localServerWorkspaceLabel'

describe('localServerWorkspaceLabel', () => {
  it('maps legacy AGBench workspace names to TaskWraith', () => {
    expect(formatLocalServerWorkspaceLabel('AGBench')).toBe('TaskWraith')
    expect(formatLocalServerWorkspaceLabel('agbench')).toBe('TaskWraith')
  })

  it('leaves other workspace names unchanged', () => {
    expect(formatLocalServerWorkspaceLabel('My Project')).toBe('My Project')
  })

  it('falls back to path basename with legacy mapping', () => {
    expect(
      localServerWorkspaceLabel({
        workspacePath: '/Users/me/Documents/AGBench'
      })
    ).toBe('TaskWraith')
  })
})
