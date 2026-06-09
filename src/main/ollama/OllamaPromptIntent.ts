export type OllamaPromptIntent = 'conversational' | 'workspace'

// Marker emitted by appendConversationContext (PromptComposition.ts) ahead of
// the live request whenever prior chat turns are prepended.
const CURRENT_REQUEST_MARKER = 'Current user request:'

// Signals that the prompt is about the repo / code even without dev verbs:
// inline code, fenced blocks, path-ish tokens, or a known source extension.
const HARD_WORKSPACE_PATTERNS: RegExp[] = [
  /```/,
  /`[^`]+`/,
  /(?:^|[\s("'])\.{0,2}\/?[\w.-]+\/[\w.-]+/,
  /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|swift|mm?|cc?|h|hpp|cpp|cs|rb|php|sh|zsh|bash|sql|css|scss|html|vue|svelte|json|ya?ml|toml|md|lock|plist)\b/i
]

const DEV_KEYWORD_PATTERN = new RegExp(
  '\\b(' +
    [
      // task verbs
      'fix(es|ed|ing)?',
      'debug(s|ged|ging)?',
      'implement(s|ed|ing)?',
      'refactor(s|ed|ing)?',
      'rename(s|d|ing)?',
      'patch(es|ed|ing)?',
      'rewrite(s|ing)?',
      'optimi[sz]e(s|d)?',
      'lint(s|ed|ing)?',
      'compile(s|d)?',
      'build(s|ing)?',
      'deploy(s|ed|ing)?',
      'install(s|ed|ing)?',
      'migrat(e|es|ed|ing|ion)',
      'revert(s|ed|ing)?',
      'merge(s|d)?',
      'rebase(s|d)?',
      'commit(s|ted)?',
      'investigate',
      'audit',
      'grep',
      'ripgrep',
      // artifacts
      'code',
      'codebase',
      'file(s)?',
      'folder(s)?',
      'director(y|ies)',
      'repo(s)?',
      'repositor(y|ies)',
      'workspace',
      'project',
      'branch(es)?',
      'function(s)?',
      'method(s)?',
      'class(es)?',
      'module(s)?',
      'component(s)?',
      'variable(s)?',
      'interface(s)?',
      'schema(s)?',
      'api(s)?',
      'endpoint(s)?',
      'database(s)?',
      'quer(y|ies)',
      'script(s)?',
      'config(s|uration)?',
      'dependenc(y|ies)',
      'package(s)?',
      'librar(y|ies)',
      'framework(s)?',
      'bug(s)?',
      'error(s)?',
      'exception(s)?',
      'crash(es)?',
      'stack trace(s)?',
      'log(s)?',
      'warning(s)?',
      'failure(s)?',
      'regression(s)?',
      'test(s|ing)?',
      'suite(s)?',
      'todo(s)?',
      'checklist(s)?',
      'readme',
      'changelog',
      'docs',
      'documentation',
      'diff(s)?',
      'shell',
      'terminal',
      'command(s)?',
      'cli'
    ].join('|') +
    ')\\b',
  'i'
)

// Conservative allow-list of clearly conversational openers. Used as the only
// path to 'conversational' once a chat has prior tool work, so "continue" or
// "now make it faster" keep their workspace scaffolding.
const CONVERSATIONAL_PATTERNS: RegExp[] = [
  /^(hi|hiya|hello|hey|yo|howdy|sup|hej|hola)\b/i,
  /\bgood (morning|afternoon|evening|night)\b/i,
  /\bhow (are|r) (you|u|things)\b/i,
  /\bhow('s| is) it going\b/i,
  /\bhow are things\b/i,
  /\byou doing (ok|okay|well|good)\b/i,
  /^(thanks|thank you|thankyou|ty|cheers|nice|neat|cool|great|awesome|perfect|amazing|brilliant|lovely|well done|good job|love it)\b/i,
  /\b(who|what) (are|r) (you|u)\b/i,
  /\bwhat can you do\b/i,
  /\bwhat model (are you|is this)\b/i,
  /\bintroduce yourself\b/i,
  /\btell me about yourself\b/i,
  /^(bye|goodbye|goodnight|good night|see you|later|take care)\b/i
]

const LONG_PROMPT_CHARS = 280
const LONG_PROMPT_LINES = 4

/** The live request portion of a composed Ollama prompt. Composition prepends
 * session memory / scout hints / chat context above a `Current user request:`
 * marker; classification should only see what the user typed this turn. */
export function extractOllamaCurrentRequestText(composedPrompt: string): string {
  const text = String(composedPrompt || '')
  const markerIndex = text.lastIndexOf(CURRENT_REQUEST_MARKER)
  if (markerIndex === -1) return text.trim()
  return text.slice(markerIndex + CURRENT_REQUEST_MARKER.length).trim()
}

export function classifyOllamaPromptIntent(
  promptText: string,
  options: { ongoingWork?: boolean } = {}
): OllamaPromptIntent {
  const text = String(promptText || '').trim()
  if (!text) return 'workspace'

  const lineCount = text.split(/\r?\n/).filter((line) => line.trim().length > 0).length
  const looksLikeTaskBrief = text.length > LONG_PROMPT_CHARS || lineCount >= LONG_PROMPT_LINES
  const hasWorkspaceSignal =
    looksLikeTaskBrief ||
    HARD_WORKSPACE_PATTERNS.some((pattern) => pattern.test(text)) ||
    DEV_KEYWORD_PATTERN.test(text)
  if (hasWorkspaceSignal) return 'workspace'

  if (options.ongoingWork) {
    return CONVERSATIONAL_PATTERNS.some((pattern) => pattern.test(text))
      ? 'conversational'
      : 'workspace'
  }
  return 'conversational'
}
