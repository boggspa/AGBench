import { describe, expect, it } from 'vitest'
import type { EnsembleParticipant } from '../../../main/store/types'
import {
  buildParticipantToolGrantPatch,
  getParticipantToolGrantIds
} from './ensembleParticipantToolGrants'

function participant(overrides: Partial<EnsembleParticipant> = {}): EnsembleParticipant {
  return {
    id: 'ensemble-codex',
    provider: 'codex',
    enabled: true,
    role: 'Worker',
    instructions: 'Work.',
    order: 1,
    permissionPresetId: 'workspace_write',
    ...overrides
  }
}

describe('ensemble participant tool grants', () => {
  it('reads participant-scoped allow overrides as enabled grants', () => {
    const ids = getParticipantToolGrantIds(
      participant({
        permissionOverrides: {
          agenticServices: {
            shellCommands: 'allow',
            fileChanges: 'deny',
            mcpTools: 'ask'
          }
        }
      })
    )

    expect([...ids]).toEqual(['shellCommands'])
  })

  it('adds allow overrides without touching other participant overrides', () => {
    const patch = buildParticipantToolGrantPatch(
      participant({
        permissionOverrides: {
          networkAccess: 'deny',
          agenticServices: {
            fileChanges: 'allow'
          }
        }
      }),
      'shellCommands',
      true
    )

    expect(patch).toMatchObject({
      permissionOverrides: {
        networkAccess: 'deny',
        agenticServices: {
          fileChanges: 'allow',
          shellCommands: 'allow'
        }
      }
    })
  })

  it('removes the participant override when a grant is toggled off', () => {
    const patch = buildParticipantToolGrantPatch(
      participant({
        permissionOverrides: {
          agenticServices: {
            shellCommands: 'allow'
          }
        }
      }),
      'shellCommands',
      false
    )

    expect(patch.permissionOverrides).toBeUndefined()
  })

  it('promotes read-only participants to custom when a tool grant is enabled', () => {
    const patch = buildParticipantToolGrantPatch(
      participant({ permissionPresetId: 'read_only' }),
      'fileChanges',
      true
    )

    expect(patch.permissionPresetId).toBe('custom')
    expect(patch.permissionOverrides?.agenticServices?.fileChanges).toBe('allow')
  })
})
