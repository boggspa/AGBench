import { describe, expect, it } from 'vitest'
import {
  applyTodoWrite,
  computeMergedTodosByActivityId,
  computeMergedTodosFromActivities,
  findCurrentTodoStep,
  isTodoToolName,
  mergeTodoLists,
  parseTodoItemsFromActivity,
  summarizeTodoProgress,
  validateTodoWriteArgs
} from './TodoList'

describe('TodoList', () => {
  it('recognises provider todo tool aliases', () => {
    expect(isTodoToolName('todo_write')).toBe(true)
    expect(isTodoToolName('mcp__TaskWraith__todo_write')).toBe(true)
    expect(isTodoToolName('update_todo_list')).toBe(true)
    expect(isTodoToolName('read_file')).toBe(false)
  })

  it('parses todos from parameters and normalises status aliases', () => {
    const items = parseTodoItemsFromActivity({
      toolName: 'todo_write',
      parameters: {
        merge: true,
        todos: [
          { id: 'a', content: 'Scout codebase', status: 'done' },
          { id: 'b', content: 'Implement fix', status: 'in progress' }
        ]
      }
    })
    expect(items).toEqual([
      { id: 'a', content: 'Scout codebase', status: 'completed' },
      { id: 'b', content: 'Implement fix', status: 'in_progress' }
    ])
  })

  it('merges todo batches by id while preserving order', () => {
    const merged = mergeTodoLists(
      [
        { id: '1', content: 'First', status: 'completed' },
        { id: '2', content: 'Second', status: 'pending' }
      ],
      [{ id: '2', content: 'Second', status: 'in_progress' }, { id: '3', content: 'Third', status: 'pending' }]
    )
    expect(merged.map((item) => item.id)).toEqual(['1', '2', '3'])
    expect(merged[1].status).toBe('in_progress')
  })

  it('replaces the list when merge is false', () => {
    const next = applyTodoWrite(
      [{ id: 'old', content: 'Old', status: 'pending' }],
      [{ id: 'new', content: 'New', status: 'pending' }],
      false
    )
    expect(next).toEqual([{ id: 'new', content: 'New', status: 'pending' }])
  })

  it('tracks merged todos per activity id', () => {
    const map = computeMergedTodosByActivityId([
      {
        id: 'a1',
        toolName: 'todo_write',
        parameters: {
          merge: false,
          todos: [{ id: '1', content: 'Plan', status: 'in_progress' }]
        }
      },
      {
        id: 'a2',
        toolName: 'todo_write',
        parameters: {
          merge: true,
          todos: [{ id: '1', content: 'Plan', status: 'completed' }]
        }
      }
    ])
    expect(map.get('a1')).toEqual([{ id: '1', content: 'Plan', status: 'in_progress' }])
    expect(map.get('a2')).toEqual([{ id: '1', content: 'Plan', status: 'completed' }])
  })

  it('computes merged todos across activities chronologically', () => {
    const merged = computeMergedTodosFromActivities([
      {
        toolName: 'todo_write',
        parameters: {
          merge: false,
          todos: [{ id: '1', content: 'Plan', status: 'in_progress' }]
        }
      },
      {
        toolName: 'todo_write',
        parameters: {
          merge: true,
          todos: [{ id: '1', content: 'Plan', status: 'completed' }]
        }
      }
    ])
    expect(merged).toEqual([{ id: '1', content: 'Plan', status: 'completed' }])
  })

  it('summarises progress and finds the current step', () => {
    const todos = [
      { id: '1', content: 'Done', status: 'completed' as const },
      { id: '2', content: 'Now', status: 'in_progress' as const },
      { id: '3', content: 'Later', status: 'pending' as const }
    ]
    expect(summarizeTodoProgress(todos).label).toBe('1/3 complete')
    expect(findCurrentTodoStep(todos)?.content).toBe('Now')
  })

  it('validates MCP todo_write args', () => {
    expect(validateTodoWriteArgs({ todos: [] }).ok).toBe(false)
    expect(validateTodoWriteArgs({ todos: [{ content: 'Ship' }] })).toEqual({
      ok: true,
      merge: false,
      todos: [{ id: 'todo-1', content: 'Ship', status: 'pending' }]
    })
  })
})
