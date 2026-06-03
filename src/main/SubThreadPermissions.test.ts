import { describe, expect, it } from 'vitest'
import { inheritedSubThreadPermissions } from './SubThreadPermissions'
import type { EffectiveRunPermissions } from './store/types'

const readOnly = {
  approvalMode: 'plan',
  agenticServices: {
    shellCommands: 'deny',
    fileChanges: 'deny',
    mcpTools: 'ask',
    subThreadDelegation: 'ask'
  },
  networkAccess: 'deny',
  readOnly: true
} as unknown as EffectiveRunPermissions

describe('inheritedSubThreadPermissions', () => {
  it('carries a read-only parent posture to the sub-thread (no escalation)', () => {
    const inherited = inheritedSubThreadPermissions({ effectivePermissions: readOnly })
    expect(inherited?.agenticServices.shellCommands).toBe('deny')
    expect(inherited?.agenticServices.fileChanges).toBe('deny')
    expect(inherited?.readOnly).toBe(true)
  })

  it('returns undefined when the parent has no explicit posture', () => {
    expect(inheritedSubThreadPermissions({})).toBeUndefined()
  })
})
