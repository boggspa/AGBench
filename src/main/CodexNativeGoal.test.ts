import { describe, expect, it } from 'vitest'
import {
  activeGoalFromCodexThreadGoal,
  activeGoalStatusFromCodexGoal,
  codexGoalStatusFromActiveGoal,
  codexThreadGoalSetParams,
  isCodexNativeGoalUnsupportedError
} from './CodexNativeGoal'
import type { ActiveGoal } from './store/types'

const baseGoal: ActiveGoal = {
  id: 'goal-1',
  objective: 'Ship the native goal bridge',
  status: 'active',
  mode: 'taskwraith_steered',
  provider: 'codex',
  createdAt: '2026-06-13T12:00:00.000Z',
  updatedAt: '2026-06-13T12:00:00.000Z'
}

describe('CodexNativeGoal', () => {
  it('maps TaskWraith goal statuses to Codex thread-goal statuses', () => {
    expect(codexGoalStatusFromActiveGoal('active')).toBe('active')
    expect(codexGoalStatusFromActiveGoal('paused')).toBe('paused')
    expect(codexGoalStatusFromActiveGoal('blocked')).toBe('blocked')
    expect(codexGoalStatusFromActiveGoal('completed')).toBe('complete')
  })

  it('maps Codex usage and budget limits to blocked TaskWraith goals', () => {
    expect(activeGoalStatusFromCodexGoal('usageLimited')).toBe('blocked')
    expect(activeGoalStatusFromCodexGoal('budgetLimited')).toBe('blocked')
    expect(activeGoalStatusFromCodexGoal('complete')).toBe('completed')
  })

  it('builds thread goal set params from the active goal', () => {
    expect(codexThreadGoalSetParams('thread-1', { ...baseGoal, status: 'completed' })).toEqual({
      threadId: 'thread-1',
      objective: 'Ship the native goal bridge',
      status: 'complete',
      tokenBudget: null
    })
  })

  it('mirrors native Codex thread goals into TaskWraith goal state', () => {
    const goal = activeGoalFromCodexThreadGoal(
      {
        threadId: 'thread-1',
        objective: 'Finish from Codex',
        status: 'budgetLimited',
        createdAt: 1_718_280_000,
        updatedAt: 1_718_283_600
      },
      baseGoal
    )

    expect(goal.id).toBe('goal-1')
    expect(goal.objective).toBe('Finish from Codex')
    expect(goal.status).toBe('blocked')
    expect(goal.mode).toBe('codex_native')
    expect(goal.blockedReason).toBe('Codex reported a goal budget limit.')
    expect(goal.createdAt).toBe('2024-06-13T12:00:00.000Z')
  })

  it('detects method-not-found errors as unsupported native goal control', () => {
    expect(isCodexNativeGoalUnsupportedError(new Error('JSON-RPC -32601 method not found'))).toBe(
      true
    )
    expect(isCodexNativeGoalUnsupportedError(new Error('network failed'))).toBe(false)
  })
})
