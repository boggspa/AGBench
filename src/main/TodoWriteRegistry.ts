import { applyTodoWrite, type TodoItem } from './TodoList'

/**
 * Per-chat merged todo state for TaskWraith MCP `todo_write` (merge:true).
 * Renderer recomputes from the activity stream; this registry only backs
 * MCP tool results during an in-flight run.
 */
const todosByChatId = new Map<string, TodoItem[]>()

export function getChatTodoList(chatId: string): TodoItem[] {
  return [...(todosByChatId.get(chatId) || [])]
}

export function setChatTodoList(chatId: string, todos: readonly TodoItem[]): TodoItem[] {
  const next = [...todos]
  todosByChatId.set(chatId, next)
  return next
}

export function clearChatTodoList(chatId: string): void {
  todosByChatId.delete(chatId)
}

export function handleChatTodoWrite(
  chatId: string,
  batch: readonly TodoItem[],
  merge: boolean
): TodoItem[] {
  const prior = todosByChatId.get(chatId) || []
  const next = applyTodoWrite(prior, batch, merge)
  todosByChatId.set(chatId, next)
  return next
}

/** Test-only reset. */
export function resetTodoWriteRegistryForTests(): void {
  todosByChatId.clear()
}
