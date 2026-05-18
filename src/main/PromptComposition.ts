import type { ChatMessage, ProviderId } from './store/types'

/**
 * Prompt-composition utilities (Phase B3 step 1).
 *
 * These helpers build the "conversation context" block that AGBench appends
 * to outgoing prompts so a fresh provider session can see prior turns.
 * Originally lived inline in `src/renderer/src/App.tsx` (~lines 2418-2548);
 * extracted here so:
 *
 *   1. Both the renderer (today's call site) AND the future main-process
 *      RunService can use the same composition without a copy/paste fork.
 *   2. The logic becomes testable in isolation.
 *   3. App.tsx shrinks by ~50 lines.
 *
 * All exports are pure functions — no Node, no Electron, no DOM. Safe to
 * import from either main or renderer.
 */

/** Hard upper-bound on how many turns we'll consider for context, regardless
 * of user setting. Anything beyond this is too lossy at provider context-window
 * sizes to be worth the prompt bloat. */
export const MAX_CONTEXT_TURNS = 20

/** Sensible default for new chats. */
export const DEFAULT_CONTEXT_TURNS = 6

/** Per-turn truncation cap. Each historical turn is summarized to at most this
 * many characters before being appended to the context block. */
export const MAX_CONTEXT_CHARS_PER_TURN = 420

/** Aggregate cap on the entire context block (after concatenation). Anything
 * over this gets sliced and tagged `[context truncated]`. */
export const MAX_CONTEXT_BLOCK_CHARS = 6000

/**
 * Collapse whitespace + truncate. Used per-turn so a single huge historical
 * message can't dominate the context block.
 */
export function sanitizeContextText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`
}

/**
 * Coerce arbitrary input (settings load, user keystroke, etc.) into a valid
 * number-of-context-turns:
 *   - non-finite ⇒ `DEFAULT_CONTEXT_TURNS`
 *   - <= 0       ⇒ 0 (disable context entirely)
 *   - otherwise  ⇒ clamped to [1, MAX_CONTEXT_TURNS]
 */
export function clampContextTurns(value: number | undefined | null): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CONTEXT_TURNS
  }
  const integer = Math.trunc(parsed)
  if (integer <= 0) {
    return 0
  }
  return Math.max(1, Math.min(MAX_CONTEXT_TURNS, integer))
}

/**
 * Build the "Conversation context (last N turn(s))" block from a chat's
 * message history. Returns an empty string when there's nothing useful to
 * append (maxTurns <= 0, no qualifying messages, etc.).
 *
 * Skips the most-recent user message if it matches `latestPrompt` exactly —
 * that avoids double-quoting the just-typed prompt back at the model.
 */
export function buildConversationContextBlock(
  messages: ChatMessage[],
  maxTurns: number,
  latestPrompt: string
): string {
  if (maxTurns <= 0) {
    return ''
  }

  const sanitizedLatestPrompt = latestPrompt.trim()
  const relevantMessages = messages.filter((message) =>
    (message.role === 'user' || message.role === 'assistant') && Boolean(message.content && message.content.trim())
  )

  let historyMessages = relevantMessages
  const lastMessage = historyMessages[historyMessages.length - 1]
  if (sanitizedLatestPrompt && lastMessage && lastMessage.role === 'user' && lastMessage.content.trim() === sanitizedLatestPrompt) {
    historyMessages = historyMessages.slice(0, -1)
  }

  if (historyMessages.length === 0) {
    return ''
  }

  const windowStart = Math.max(0, historyMessages.length - (maxTurns * 2))
  const windowedMessages = historyMessages.slice(windowStart)
  if (windowedMessages.length === 0) {
    return ''
  }

  const lines = windowedMessages.map((item) =>
    `${item.role === 'user' ? 'User' : 'Gemini'}: ${sanitizeContextText(item.content, MAX_CONTEXT_CHARS_PER_TURN)}`
  )

  const contextBlock = [
    `\n\nConversation context (last ${Math.min(maxTurns, Math.ceil(windowedMessages.length / 2))} turn(s)):`,
    ...lines
  ].join('\n')

  if (contextBlock.length <= MAX_CONTEXT_BLOCK_CHARS) {
    return contextBlock
  }

  return `${contextBlock.slice(0, MAX_CONTEXT_BLOCK_CHARS - 18)}\n[context truncated]`
}

/**
 * Append a conversation context block to the user's current prompt. Returns
 * the prompt unchanged when there's no context to append.
 *
 * Output shape (when context is non-empty):
 *   <context block>
 *   Current user request:
 *   <prompt>
 */
export function appendConversationContext(
  prompt: string,
  messages: ChatMessage[],
  maxTurns: number,
  latestPrompt: string
): string {
  const context = buildConversationContextBlock(messages, maxTurns, latestPrompt)
  if (!context) return prompt
  return `${context}\nCurrent user request:\n${prompt}`
}

// ============================================================================
// composeRunPrompt — the single entry point for "given a user request and
// the chat's state, produce the final prompt the provider will receive".
// Originally inline in App.tsx around lines 6105-6159 (per-provider context-
// injection branches + Codex model-handoff handling + Gemini write-tool
// preamble). Extracted as a pure function so:
//
//   - the future iOS bridge can call it via IPC (or direct import in main),
//   - it's testable in isolation,
//   - per-provider quirks live in one place instead of three branches.
//
// The function is intentionally side-effect free. Codex handoff bookkeeping
// (which keys have been applied) and the UI "context applied once" notice are
// returned as data; the caller decides whether to persist them.
// ============================================================================

export interface ComposeRunPromptInput {
  provider: ProviderId
  /** The user's typed prompt (already merged with any pre-existing attachments). */
  finalPrompt: string
  /** Chat message history available for context injection. */
  messages: ChatMessage[]
  /** User setting: how many prior turns to consider. Will be clamped. */
  chatContextTurns: number
  /** When set, the provider's own session will resume — Gemini skips its
   * generic context block in that case; Kimi still injects. */
  resumeSessionId?: string
  /** For Codex model-handoff detection. The last completed Codex model in
   * this chat (so we can detect handoffs like 5.5 → 5.4-mini). */
  lastCompletedCodexModel?: string | null
  /** The model selected for the upcoming run. */
  nextModel?: string
  /** The set of handoff-keys already applied to this chat (so we only inject
   * once per direction). */
  codexHandoffsApplied: string[]
  /** Workspace-scope flag — gates the Gemini write-tool preamble. */
  isGlobalRun: boolean
  /** Resolved approval mode for the run ('default' | 'plan' | etc.). */
  approvalMode: string
  /** Provider display label used in the application-log message. */
  providerLabel: string
}

export interface ComposeRunPromptResult {
  /** The fully composed prompt to send to the provider. */
  contextualPrompt: string
  /** How many context turns were actually applied (0 when none). */
  contextTurnsApplied: number
  /** Human-readable diagnostic line, suitable for the raw-logs panel. */
  applicationLog: string
  /** Set when a Codex model-handoff context-application happened — the caller
   * persists this to `chat.providerMetadata.codexModelContextAppliedKeys`. */
  codexHandoffApplied?: {
    handoffKey: string
    previousModel: string
    nextModel: string
    appliedAt: string
  }
  /** Set when the UI should show a one-shot notice — the caller maps this to
   * its toast/notice state. */
  uiNoticeMessage?: string
}

/** Compose the final prompt for an outgoing run according to provider rules.
 *
 * Pure function — no IO, no state mutation. All decisions are derivable from
 * the input shape, and side-effecting bookkeeping is returned as data. */
export function composeRunPrompt(input: ComposeRunPromptInput): ComposeRunPromptResult {
  const {
    provider,
    finalPrompt,
    messages,
    chatContextTurns,
    resumeSessionId,
    lastCompletedCodexModel,
    nextModel,
    codexHandoffsApplied,
    isGlobalRun,
    approvalMode,
    providerLabel
  } = input

  // (1) Decide whether to append the generic conversation-context block.
  // Kimi's Wire-protocol --resume restores only a session token, not the
  // transcript, so we always inject for Kimi. Gemini's CLI resume restores
  // context properly, so we skip when resuming. Codex/Claude rely on their
  // own session continuity (with a special Codex handoff branch below).
  const kimiNeedsContextInjection = provider === 'kimi'
  const geminiNeedsContextInjection = provider === 'gemini' && !resumeSessionId
  const shouldAppendContextForRun = kimiNeedsContextInjection || geminiNeedsContextInjection

  let contextTurnsApplied = shouldAppendContextForRun ? clampContextTurns(chatContextTurns) : 0
  let contextualPrompt = shouldAppendContextForRun
    ? appendConversationContext(finalPrompt, messages, contextTurnsApplied, finalPrompt)
    : finalPrompt
  let applicationLog = kimiNeedsContextInjection
    ? `Context turns: ${contextTurnsApplied} (Kimi: appending compact conversation context because Wire protocol --resume does not restore message history)`
    : provider !== 'gemini'
      ? `Context turns: 0 (${providerLabel} provider/session history is authoritative when available)`
      : resumeSessionId
        ? 'Context turns: 0 (resuming Gemini CLI session context)'
        : `Context turns: ${contextTurnsApplied} (sending compact context + current request)`

  let codexHandoffApplied: ComposeRunPromptResult['codexHandoffApplied'] | undefined
  let uiNoticeMessage: string | undefined

  // (2) Codex model-handoff: when the user switches Codex models mid-chat
  // (e.g. 5.5 → 5.4-mini), the new model needs the existing transcript once
  // since Codex sessions are model-scoped. We track applied handoff keys on
  // the chat so we don't re-inject.
  if (provider === 'codex') {
    const previousModelKey = normalizeKey(lastCompletedCodexModel)
    const nextModelKey = normalizeKey(nextModel)
    const hasCompletedWork = Boolean(lastCompletedCodexModel)
    const modelChangedAfterWork = hasCompletedWork && previousModelKey && nextModelKey && previousModelKey !== nextModelKey
    const handoffKey = `${previousModelKey}->${nextModelKey}`

    if (modelChangedAfterWork && !codexHandoffsApplied.includes(handoffKey)) {
      contextTurnsApplied = clampContextTurns(chatContextTurns)
      contextualPrompt = appendConversationContext(finalPrompt, messages, contextTurnsApplied, finalPrompt)
      applicationLog = `Context turns: ${contextTurnsApplied} (Codex model changed from ${lastCompletedCodexModel} to ${nextModel}; applying chat context once)`
      codexHandoffApplied = {
        handoffKey,
        previousModel: lastCompletedCodexModel || '',
        nextModel: nextModel || '',
        appliedAt: new Date().toISOString()
      }
      uiNoticeMessage = `Chat context is being applied once for the Codex model change: ${lastCompletedCodexModel} -> ${nextModel}.`
    }
  }

  // (3) Gemini write-tool preamble: workspace runs (non-global) outside plan
  // mode get a leading instruction so Gemini reaches for the AGBench MCP
  // tools instead of delegating writes to invoke_agent (which loses write
  // capability). Phase I3.1 additionally surfaces the cross-provider
  // delegation tool so Gemini doesn't quietly fall back to its built-in
  // invoke_agent for tasks the user expressed should be handled by Kimi
  // / Codex / Claude.
  if (provider === 'gemini' && !isGlobalRun && approvalMode !== 'plan') {
    const geminiWriteToolPreamble = [
      'AGBench runtime note: this Gemini workspace run is write-capable.',
      'Use the AGBench MCP tools directly for file changes: read_file, list_directory, write_file, replace, run_shell_command, and delegate_to_subthread.',
      'If Gemini exposes MCP-qualified names, use agentbench__read_file, agentbench__list_directory, agentbench__write_file, agentbench__replace, agentbench__run_shell_command, and agentbench__delegate_to_subthread.',
      'Do not delegate file-modification work to invoke_agent or generalist agents; delegated agents may not inherit AGBench write tools.',
      'For CROSS-PROVIDER delegation (e.g. asking Kimi or Codex to handle a sub-task), call agentbench__delegate_to_subthread({ provider, prompt, returnResult }) — NEVER use your built-in invoke_agent / generalist agent for cross-provider work, those run inside your own process and cannot reach other AGBench providers.',
      "Example: agentbench__delegate_to_subthread({ provider: 'kimi', prompt: 'Generate 9 song data tables...', returnResult: true }).",
      'If any of those tools are unavailable, stop and report the exact missing tool names instead of pasting full replacement files for manual application.'
    ].join('\n')
    contextualPrompt = `${geminiWriteToolPreamble}\n\n${contextualPrompt}`
  }

  // (4) Phase I3 (Claude initiator): Claude workspace runs (non-global)
  // outside plan mode get a parallel preamble pointing the agent at the
  // agentbench MCP server registered by the SDK / CLI layer. Without it
  // Claude tends to reach for its own Task tool for sub-agent work,
  // which stays inside Claude's process and cannot reach other AGBench
  // providers.
  if (provider === 'claude' && !isGlobalRun && approvalMode !== 'plan') {
    const claudeDelegationPreamble = [
      'AGBench runtime note: this Claude workspace run has access to the agentbench MCP server (delegate_to_subthread + filesystem helpers).',
      'For CROSS-PROVIDER delegation (e.g. asking Gemini, Kimi, or Codex to handle a sub-task), call mcp__agentbench__delegate_to_subthread({ provider, prompt, returnResult }) — NEVER use Claude\'s built-in Task tool for cross-provider work, that runs inside Claude\'s process and cannot reach other AGBench providers.',
      "Example: mcp__agentbench__delegate_to_subthread({ provider: 'gemini', prompt: 'Analyze this codebase...', returnResult: true }).",
      'If the agentbench MCP tools are unavailable, stop and report the exact missing tool names instead of pasting full replacement files for manual application.'
    ].join('\n')
    contextualPrompt = `${claudeDelegationPreamble}\n\n${contextualPrompt}`
  }

  // (5) Phase I4 (Kimi initiator): Kimi workspace runs (non-global)
  // outside plan mode get the same delegation preamble — register the
  // agentbench MCP tool list and forbid built-in generalist-agent paths
  // for cross-provider work. Kimi's MCP host inherits the tools from
  // `~/.kimi/mcp.json` (installed by `kimi mcp add agentbench …`).
  if (provider === 'kimi' && !isGlobalRun && approvalMode !== 'plan') {
    const kimiDelegationPreamble = [
      'AGBench runtime note: this Kimi workspace run has access to the agentbench MCP server (delegate_to_subthread + filesystem helpers).',
      'For CROSS-PROVIDER delegation (e.g. asking Gemini, Claude, or Codex to handle a sub-task), call agentbench__delegate_to_subthread({ provider, prompt, returnResult }) — NEVER use any built-in generalist-agent path for cross-provider work, those run inside Kimi\'s process and cannot reach other AGBench providers.',
      "Example: agentbench__delegate_to_subthread({ provider: 'claude', prompt: 'Review this design doc...', returnResult: true }).",
      'If the agentbench MCP tools are unavailable, stop and report the exact missing tool names instead of pasting full replacement files for manual application.'
    ].join('\n')
    contextualPrompt = `${kimiDelegationPreamble}\n\n${contextualPrompt}`
  }

  // (6) Phase I2 (Codex initiator): Codex workspace runs (non-global)
  // outside plan mode get a parallel preamble pointing the agent at the
  // agentbench MCP server that the Codex CLI registers at spawn via
  // `-c mcp_servers.agentbench.*` (see `CodexAppServerClient.ts`).
  //
  // Without this note Codex agents silently never invoke the MCP tools:
  // empirically, the bridge subprocess gets spawned by Codex CLI on
  // every turn for capability discovery but ZERO tools/call entries
  // appear from Codex-parented bridges in
  // `~/Library/Logs/AGBench/bridge-subprocess.log`. Codex sees the
  // tools in tools/list but its reasoning never selects them for
  // cross-provider delegation tasks the way Gemini/Claude/Kimi do
  // (those three got runtime notes in Phase I3/I4 and immediately
  // started invoking delegate_to_subthread successfully).
  //
  // The fix is prompt-level only — the MCP wiring itself (Phase I2's
  // `buildCodexAgentbenchMcpArgs` + broker socket + parentProvider
  // stamp) was already correct, agents just needed to be told the
  // tools exist and that built-in invoke paths can't reach other
  // providers.
  if (provider === 'codex' && !isGlobalRun && approvalMode !== 'plan') {
    const codexDelegationPreamble = [
      'AGBench runtime note: this Codex workspace run has access to the agentbench MCP server (delegate_to_subthread + filesystem helpers).',
      'For CROSS-PROVIDER delegation (e.g. asking Gemini, Claude, or Kimi to handle a sub-task), call agentbench__delegate_to_subthread({ provider, prompt, returnResult }) — NEVER use Codex\'s built-in invoke / generalist-agent path for cross-provider work, those run inside Codex\'s process and cannot reach other AGBench providers.',
      'The tool may also surface as the plain `delegate_to_subthread` name depending on Codex CLI version; either form invokes the same AGBench MCP entrypoint.',
      "Example: agentbench__delegate_to_subthread({ provider: 'gemini', prompt: 'Audit this codebase for unused exports...', returnResult: true }).",
      'If the agentbench MCP tools are unavailable, stop and report the exact missing tool names instead of pasting full replacement files for manual application.'
    ].join('\n')
    contextualPrompt = `${codexDelegationPreamble}\n\n${contextualPrompt}`
  }

  return {
    contextualPrompt,
    contextTurnsApplied,
    applicationLog,
    codexHandoffApplied,
    uiNoticeMessage
  }
}

/** Local normalize helper — mirrors `normalizeProviderModelKey` in App.tsx
 * but kept private to this module so PromptComposition stays self-contained. */
function normalizeKey(model?: string | null): string {
  return String(model || '').trim().toLowerCase()
}
