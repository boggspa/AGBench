import { resolveOllamaModelFamily } from './OllamaModelPreflight'

export function ollamaUsesCompactToolSchemas(modelId?: string | null): boolean {
  return resolveOllamaModelFamily(modelId || '') === 'gpt_oss_20b'
}

export function ollamaOneToolAtATime(modelId?: string | null): boolean {
  return resolveOllamaModelFamily(modelId || '') === 'gpt_oss_20b'
}

export function ollamaPrefersJsonToolProtocol(modelId?: string | null): boolean {
  return resolveOllamaModelFamily(modelId || '') === 'gpt_oss_20b'
}

export function ollamaGptOssFewShotTrajectories(): string[] {
  return [
    'Example A — todo then search then read: todo_write({"merge":true,"todos":[{"id":"explore","content":"Explore workspace","status":"in_progress"},{"id":"read","content":"Read target files","status":"pending"}]}) → workspace_search({"query":"resolveContextBudget","path":"src","maxResults":20,"contextLines":1}) → read_file({"path":"src/main/PromptComposition.ts"}) → answer with findings.',
    'Example B — patch one file: workspace_search({"query":"OLLAMA_TOOL_LOOP_LIMIT","path":"src/main/ollama","maxResults":10,"contextLines":1}) → read_file({"path":"src/main/ollama/OllamaProvider.ts"}) → replace({"path":"...","old_string":"...","new_string":"...","intent":"raise tool loop cap"})',
    'Example C — no tool needed: answer directly in prose when the user question is conceptual and does not require workspace facts.'
  ]
}
