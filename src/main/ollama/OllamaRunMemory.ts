import { summarizeOllamaToolArgs } from './OllamaToolResultSummary'

export interface OllamaLoopMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: unknown[]
  tool_name?: string
}

export const OLLAMA_ROLLING_SUMMARY_AFTER_TOOL_TURNS = 3
export const OLLAMA_WORKING_MEMORY_MAX_CHARS = 1800

export interface OllamaToolTrajectoryEntry {
  toolName: string
  argsSummary: string
  ok: boolean
  resultSummary: string
}

export interface OllamaSessionMemory {
  modelId: string
  updatedAt: number
  workingMemory: string
  toolTurnCount: number
  trajectory?: OllamaToolTrajectoryEntry[]
}

export function normalizeOllamaSessionMemory(
  memory: OllamaSessionMemory | null | undefined
): OllamaSessionMemory | null {
  if (!memory) return null
  return {
    ...memory,
    trajectory: memory.trajectory ?? []
  }
}

export function createEmptyOllamaSessionMemory(modelId: string): OllamaSessionMemory {
  return {
    modelId,
    updatedAt: Date.now(),
    workingMemory: '',
    toolTurnCount: 0,
    trajectory: []
  }
}

function summarizeToolResultForMemory(output: string, maxChars = 220): string {
  const normalized = output.replace(/\s+/g, ' ').trim()
  if (!normalized) return '(empty)'
  return normalized.length <= maxChars
    ? normalized
    : `${normalized.slice(0, maxChars)}...`
}

export function appendOllamaTrajectoryEntry(
  memory: OllamaSessionMemory,
  entry: Omit<OllamaToolTrajectoryEntry, 'argsSummary'> & {
    args: Record<string, unknown>
  }
): OllamaSessionMemory {
  const trajectory = [
    ...(memory.trajectory ?? []),
    {
      toolName: entry.toolName,
      argsSummary: summarizeOllamaToolArgs(entry.toolName, entry.args),
      ok: entry.ok,
      resultSummary: summarizeToolResultForMemory(entry.resultSummary)
    }
  ].slice(-12)
  return {
    ...memory,
    updatedAt: Date.now(),
    toolTurnCount: memory.toolTurnCount + 1,
    trajectory,
    workingMemory: buildOllamaWorkingMemoryBlock(trajectory)
  }
}

export function buildOllamaWorkingMemoryBlock(trajectory: OllamaToolTrajectoryEntry[]): string {
  if (trajectory.length === 0) return ''
  const lines = [
    'Ollama working memory (compressed prior tool trajectory):',
    ...trajectory.map(
      (entry, index) =>
        `${index + 1}. ${entry.argsSummary} → ${entry.ok ? 'ok' : 'error'}: ${entry.resultSummary}`
    )
  ]
  const block = lines.join('\n')
  if (block.length <= OLLAMA_WORKING_MEMORY_MAX_CHARS) return block
  return `${block.slice(0, OLLAMA_WORKING_MEMORY_MAX_CHARS)}\n[working memory truncated]`
}

export function formatOllamaSessionMemoryForPrompt(memory: OllamaSessionMemory | null | undefined): string {
  if (!memory?.workingMemory?.trim()) return ''
  return [
    'Prior Ollama session memory (pruned — tool calls + summaries, not full file bodies):',
    memory.workingMemory.trim()
  ].join('\n')
}

export function shouldRollOllamaRunSummary(toolTurnCount: number): boolean {
  return toolTurnCount > 0 && toolTurnCount % OLLAMA_ROLLING_SUMMARY_AFTER_TOOL_TURNS === 0
}

/** Replace raw tool I/O in the in-flight message list with a stable working-memory block. */
export function compressOllamaMessagesWithWorkingMemory(
  messages: OllamaLoopMessage[],
  workingMemory: string
): OllamaLoopMessage[] {
  if (!workingMemory.trim()) return messages
  const system = messages.filter((message) => message.role === 'system')
  const initialUser = messages.find((message) => message.role === 'user')
  return [
    ...system,
    ...(initialUser ? [initialUser] : []),
    { role: 'user', content: workingMemory }
  ]
}

export function pruneOllamaSessionMemoryForPersist(memory: OllamaSessionMemory): OllamaSessionMemory {
  return {
    modelId: memory.modelId,
    updatedAt: memory.updatedAt,
    workingMemory: memory.workingMemory.slice(0, OLLAMA_WORKING_MEMORY_MAX_CHARS),
    toolTurnCount: memory.toolTurnCount,
    trajectory: (memory.trajectory ?? []).slice(-8)
  }
}
