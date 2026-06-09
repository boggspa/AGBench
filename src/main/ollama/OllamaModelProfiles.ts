import { ollamaGptOssFewShotTrajectories } from './OllamaModelProtocol'
import { resolveOllamaModelFamily } from './OllamaModelPreflight'
import type { OllamaPromptIntent } from './OllamaPromptIntent'
import type { OllamaToolControlTier } from '../store/types'
import {
  normalizeOllamaToolControlTier,
  ollamaTierLabel,
  ollamaToolNamesForTier,
  type OllamaToolName
} from './OllamaToolTiers'

/** Family-specific lines appended to the local tool system prompt.
 *
 * Conversational turns keep only the tool-call discipline lines (the failure
 * modes they guard are universal); the explore/read/edit workflow, checklist
 * ritual, and worked trajectories are workspace-task scaffolding that small
 * models otherwise apply to "hi, how are you?". */
export function ollamaModelFamilyPromptLines(
  modelId: string,
  intent: OllamaPromptIntent = 'workspace'
): string[] {
  const family = resolveOllamaModelFamily(modelId)
  if (intent === 'conversational') {
    if (family === 'gpt_oss_20b') {
      return [
        'Model profile (GPT OSS): you may reason internally, but you MUST emit a real tool call or a final answer — never stop on a tool-intent stub.',
        'Prefer native tool/function calls over describing tools in prose.',
        'Call exactly one TaskWraith tool per turn.'
      ]
    }
    return []
  }
  switch (family) {
    case 'qwen3_5_9b':
      return [
        'Model profile (Qwen 3.5 9B): prefer workspace_search before read_file; read only the files you need.',
        'Keep tool arguments compact — do not paste large file bodies into JSON string fields.',
        'For multi-file refactors or long test-fix loops, summarize your plan and stop rather than guessing.'
      ]
    case 'qwen3_4b':
      return [
        'Model profile (Qwen 3 4B): stay lightweight — search first, read one file at a time, answer concisely.',
        'Avoid wide refactors; prefer a short plan the user can hand to a larger model.'
      ]
    case 'gemma4_12b':
      return [
        'Model profile (Gemma 4 12B): search narrowly, then read targeted files before editing.',
        'Use one tool at a time and summarize results instead of chaining many speculative calls.'
      ]
    case 'gpt_oss_20b':
      return [
        'Model profile (GPT OSS): you may reason internally, but you MUST emit a real tool call or a final answer — never stop on a tool-intent stub.',
        'When embedding code in JSON tool args, escape backslashes correctly (Swift \\(…), Windows paths).',
        'Prefer native tool/function calls over describing tools in prose.',
        'Call exactly one TaskWraith tool per turn.',
        'Use todo_write (merge:true) to publish the harness checklist, then follow explore → read → edit → verify.',
        'Worked trajectories:',
        ...ollamaGptOssFewShotTrajectories()
      ]
    default:
      return [
        'Model profile (local): search first, read narrowly, and keep tool payloads small.',
        'Stop with a concise plan when the task outgrows local model reliability.'
      ]
  }
}

export function ollamaModelFamilyTemperature(modelId: string): number | undefined {
  const family = resolveOllamaModelFamily(modelId)
  if (family === 'gpt_oss_20b') return 0.15
  if (family === 'qwen3_4b') return 0.25
  return undefined
}

function describeTool(toolName: OllamaToolName): string | null {
  if (toolName === 'list_directory') return '- list_directory: {"path":"."}'
  if (toolName === 'read_file') return '- read_file: {"path":"relative/path.txt"}'
  if (toolName === 'workspace_search') {
    return '- workspace_search: {"query":"text or regex","path":".","maxResults":50,"contextLines":1} — ripgrep over the workspace; search a distinctive literal string to pinpoint the exact file and line you will read or edit.'
  }
  if (toolName === 'web_search') {
    return '- web_search: {"query":"current information to search for"} — returns a ranked list of result titles and URLs from the live web.'
  }
  if (toolName === 'web_fetch') {
    return '- web_fetch: {"url":"https://example.com/page"} — downloads a page and returns its readable text (HTML markup is stripped), ready for you to read and summarize.'
  }
  if (toolName === 'write_file') {
    return '- write_file: {"path":"relative/path.txt","content":"...","intent":"short reason before changing files"}'
  }
  if (toolName === 'replace') {
    return '- replace: {"path":"relative/path.txt","old_string":"...","new_string":"...","intent":"short reason before changing files"}'
  }
  if (toolName === 'apply_patch') {
    return '- apply_patch: {"patch":"unified diff","intent":"short reason before changing files"}'
  }
  if (toolName === 'run_shell_command') {
    return '- run_shell_command: {"command":"exact command","intent":"short reason before running it"}'
  }
  if (toolName === 'todo_write') {
    return '- todo_write: {"merge":true,"todos":[{"id":"1","content":"short step label","status":"in_progress"}]} — publish goal steps the user sees as a checklist; keep one item in_progress.'
  }
  return `- ${toolName}: use the TaskWraith MCP argument schema for this tool.`
}

/** Baseline + per-family tuning for the Ollama local tool system prompt. */
export function ollamaLocalToolSystemPrompt(
  tier: OllamaToolControlTier | string | undefined | null = 'read_only',
  modelId?: string | null,
  options: { intent?: OllamaPromptIntent } = {}
): string {
  const intent = options.intent ?? 'workspace'
  const normalizedTier = normalizeOllamaToolControlTier(tier)
  const tools = ollamaToolNamesForTier(normalizedTier)
  const hasWebTools = tools.includes('web_search') || tools.includes('web_fetch')
  const familyLines = modelId?.trim() ? ollamaModelFamilyPromptLines(modelId, intent) : []
  const lines = [
    'You are running inside TaskWraith through local Ollama.',
    'You do not have direct shell or filesystem access, but TaskWraith DOES give you working tools (listed below) that you can call right now. Use them instead of telling the user you lack a capability.',
    ...(hasWebTools
      ? [
          'You CAN access the live internet through the web_search and web_fetch tools below. When the user asks about current events, weather, prices, or anything you cannot answer from memory, use web_search to find sources, then web_fetch to read a chosen page. web_fetch returns the readable text of the page, so you can summarize it directly.'
        ]
      : []),
    'To request a tool, either emit a native tool/function call, or reply with ONLY a JSON object in this exact shape:',
    '{"taskwraith_tool":{"name":"read_file","arguments":{"path":"README.md"}}}',
    'Do NOT announce or describe a tool call in prose (for example, "we need to use web_search" or "let\'s do web_search"). Either actually issue the tool call now, or give your final answer in normal prose. Describing a tool without calling it does nothing.',
    `Current Ollama tool-control tier: ${ollamaTierLabel(normalizedTier)}.`,
    ...(intent === 'conversational'
      ? [
          'The current user message is conversational (a greeting, thanks, or general question — not a coding task). Answer it directly in friendly prose. Do not call tools, explore the workspace, or publish todo checklists unless the question genuinely needs live web data or workspace facts — and then call at most one tool before answering.'
        ]
      : []),
    ...familyLines,
    'Available tools:'
  ]
  for (const toolName of tools) {
    const line = describeTool(toolName)
    if (line) lines.push(line)
  }
  lines.push(
    'Paths must stay inside the active workspace.',
    'web_search and web_fetch are read-only network tools routed through TaskWraith policy. A typical flow is: web_search for the topic, pick the most relevant result, then web_fetch that URL and summarize its readable text for the user.',
    'Mutating tools require an intent or summary. TaskWraith will show a modal approval before running approved-edit and approved-shell tools.',
    'After TaskWraith returns a tool result, answer normally or request one more tool with the same JSON shape.',
    'Do not invent file contents or workspace facts when a tool result is needed.'
  )
  return lines.join('\n')
}

export function ollamaScoutDelegateWorkflowHint(modelId?: string | null): string {
  const family = resolveOllamaModelFamily(modelId || '')
  const scout =
    family === 'qwen3_5_9b' || family === 'qwen3_4b' || family === 'gemma4_12b'
      ? 'Use this Ollama thread to search, read narrowly, and draft a short implementation plan.'
      : 'Use this local thread to explore the workspace and outline the next steps.'
  return [
    'TaskWraith local-scout workflow:',
    scout,
    'When the plan is ready, ask the user to delegate implementation to Codex or Claude (↪ delegate on this chat) and attach the plan in the delegation prompt.',
    'Do not attempt repo-wide refactors or full test-suite repair loops alone on a local model.'
  ].join(' ')
}

export function ollamaStruggleHandoffMessage(modelLabel: string): string {
  return [
    `${modelLabel} hit a local reliability limit (tool-loop cap or repeated malformed/tool-intent turns).`,
    'Consider delegating the remainder to Codex or Claude via ↪ delegate on this chat.',
    'Attach your scout notes/plan in the delegation prompt so the cloud agent can implement without re-exploring.'
  ].join(' ')
}
