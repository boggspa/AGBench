import { describe, expect, it } from 'vitest'
import {
  activeGoalModeLabel,
  createActiveGoal,
  formatActiveGoalPromptBlock,
  resolveActiveGoalForProvider,
  resolveActiveGoalMode,
  shouldInjectActiveGoal,
  updateActiveGoalLifecycle
} from './GoalState'

describe('GoalState', () => {
  it('creates provider-aware goals without treating todos as the objective', () => {
    const goal = createActiveGoal('ollama', 'Fix the failing parser test', {
      now: new Date('2026-06-13T12:00:00Z')
    })

    expect(goal.status).toBe('active')
    expect(goal.mode).toBe('ollama_harness')
    expect(activeGoalModeLabel(goal.mode)).toBe('Ollama managed')
    expect(goal.objective).toBe('Fix the failing parser test')
  })

  it('distinguishes native and steered provider modes', () => {
    expect(resolveActiveGoalMode('codex')).toBe('taskwraith_steered')
    expect(resolveActiveGoalMode('codex', { codexNativeAvailable: true })).toBe('codex_native')
    expect(resolveActiveGoalMode('claude')).toBe('taskwraith_steered')
    expect(resolveActiveGoalMode('claude', { claudeNativeAvailable: true })).toBe('claude_native')
  })

  it('resolves stored goals against the provider handling the next turn', () => {
    const goal = createActiveGoal('codex', 'Keep the objective portable', {
      now: new Date('2026-06-13T12:00:00Z'),
      codexNativeAvailable: true
    })

    const ollamaGoal = resolveActiveGoalForProvider(goal, 'ollama')
    expect(ollamaGoal?.provider).toBe('ollama')
    expect(ollamaGoal?.mode).toBe('ollama_harness')
    expect(goal.provider).toBe('codex')
    expect(goal.mode).toBe('codex_native')

    expect(resolveActiveGoalForProvider(goal, 'gemini')?.mode).toBe('taskwraith_steered')
    expect(
      resolveActiveGoalForProvider(goal, 'claude', { claudeNativeAvailable: true })?.mode
    ).toBe('claude_native')
  })

  it('injects active and blocked goals, not paused or completed goals', () => {
    const goal = createActiveGoal('codex', 'Ship the goal control', {
      now: new Date('2026-06-13T12:00:00Z')
    })

    expect(shouldInjectActiveGoal(goal)).toBe(true)
    expect(shouldInjectActiveGoal(updateActiveGoalLifecycle(goal, 'blocked', 'Need tests'))).toBe(
      true
    )
    expect(shouldInjectActiveGoal(updateActiveGoalLifecycle(goal, 'paused'))).toBe(false)
    expect(shouldInjectActiveGoal(updateActiveGoalLifecycle(goal, 'completed'))).toBe(false)
  })

  it('formats steering rules for provider prompts', () => {
    const goal = createActiveGoal('codex', 'Implement /goal without replacing todo_write', {
      now: new Date('2026-06-13T12:00:00Z')
    })
    const block = formatActiveGoalPromptBlock(goal)

    expect(block).toContain('<taskwraith_active_goal>')
    expect(block).toContain('Guided by TaskWraith')
    expect(block).toContain('todo_write may publish visible steps')
    expect(block).toContain('Use goal_read to inspect')
  })
})
