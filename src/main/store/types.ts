export type AppearanceMode = 'solid' | 'soft_glass' | 'native_glass'
export type VisualEffectStyle = 'auto' | 'liquid_glass' | 'thin_material' | 'classic'
export type ThemeAppearance =
  | 'system'
  | 'dark'
  | 'light'
  | 'midnight'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'graphite'
  | 'rainbow'
  | 'nebula'
  | 'citrus'
  | 'twilight'
  | 'ocean'
  | 'sunset'
  | 'forest'
  | 'cyber'
  | 'candy'
  | 'mist'
  | 'sage'
  /**
   * 1.0.5-EW54 — "Obsidian" theme. Deep warm-leaning charcoal base
   * with subtle peach/copper halo gradients leaking in at the top
   * and bottom edges, and crisp 1px lit "rim shine" borders on
   * every panel. Glassmorphic panel translucency. Distinct from
   * `graphite` (which trends colder + flatter) — this is the
   * "premium postmodern" reading of dark mode the design brief
   * called for: light catches the lip of every surface rather
   * than the fill itself carrying the identity.
   */
  | 'obsidian'
  /**
   * 1.0.5-EW61 — "Alabaster" theme. Polar inverse of `obsidian`.
   * Where obsidian is volcanic-black glass with white rims and
   * warm dusk halos, alabaster is translucent cream-white stone
   * with charcoal rims and cool blue/lavender halos. Same
   * design language (rim-carries-identity, opaque transcript,
   * deliberately discordant sidebar) — every value mirrored.
   * Distinct from `light` / `mist` / `sage` (which trend
   * cooler, flatter, more "iOS sunlight") — this is the
   * premium-stone postmodern reading of light mode, paired
   * with the obsidian composer's polar twin.
   */
  | 'alabaster'
export type ThemeCornerStyle = 'rounded' | 'hard'
export type ThemeAccentStyle =
  | 'system'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'orange'
  | 'green'
  | 'red'
  | 'yellow'
/**
 * Tool-call icon accent override. `system` = follow theme accent
 * (default). Named overrides target an explicit colour for the
 * tool-call icons only, leaving the rest of the UI on the user's
 * chosen theme accent. CSS seam: `--tool-call-icon-accent` +
 * `[data-tool-icon-accent="X"]` rules in `theme.css`.
 */
export type ToolIconAccent =
  | 'system'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'orange'
  | 'green'
  | 'red'
  | 'yellow'
  | 'graphite'
  | 'amber'
  | 'cyan'
  | 'violet'
/**
 * User chat-bubble colour. `system` (default) keeps the current
 * neutral elevated-surface look. The named overrides tint both the
 * `.message-bubble.user` background AND the matching `.message-meta`
 * "You" label with the same hue — the bubble gets a soft mix into
 * the elevated surface for legibility, the label uses the saturated
 * colour for the typographic accent. CSS seam: `--user-bubble-base`
 * + `[data-user-bubble-color="X"]` rules in `theme.css`.
 */
export type UserBubbleColor =
  | 'system'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'orange'
  | 'green'
  | 'red'
  | 'yellow'
  | 'graphite'
export type PromptSurfaceStyle = 'theme' | 'solid' | 'liquid_glass' | 'classic'
export type ComposerStyle =
  | 'default'
  | 'codex'
  | 'claude'
  /** Cursor: VISUAL-ONLY shell. Copies the Gemini composer layout but
   * strips all chroma + glass — flat neutral GRAY, theme-immune.
   * NOT the ProviderId 'cursor' (the runtime); a chat's shell is
   * independent of its provider, exactly like 'grok' below. */
  | 'cursor'
  /** Grok: visual-only shell. Copies the Gemini composer layout but
   * strips all chroma + glass — strictly monochrome black/white,
   * theme-immune. NOT a provider/runtime. */
  | 'grok'
  | 'gemini'
  | 'kimi'
  /** Modular: every composer element gets its own floating pill,
   * no grouping container. Spacing preserved; chrome inverted. */
  | 'modular'
  /** Terminal: monospace + sharp corners + bracket-style chips +
   * a `>` caret prefix on the textarea. Command-line aesthetic. */
  | 'terminal'
  /** Ticket stub: paper-textured composer with a perforated
   * separator between the controls strip and the textarea bubble.
   * Mirrors AGBench's tool-call ticket grouping aesthetic. */
  | 'stub'
  /** Satellite: everything floats; all containers, borders, and
   * fills go invisible. Layout intact, chrome stripped. */
  | 'satellite'
  /**
   * 1.0.5-EW55 — "Obsidian" composer style (renamed from EW54's
   * `rimshine`). Pure black fill, crisp 1px white rim along the
   * top edge, subtle white outer glow, slow rim-shimmer chase
   * animation that travels the perimeter every ~12 seconds, and
   * matching chrome on every detached above-row (Ensemble chip
   * strip, queued-messages, Create-PR row, secondary workspace
   * pill) so the composer reads as a single black-with-white-rim
   * family. Pairs natively with the `obsidian` theme but works
   * on any dark theme via fallback variables. The brief words
   * "charcoal rimshine premium" map to this style.
   */
  | 'obsidian'
  /**
   * 1.0.5-EW61 — "Alabaster" composer style. Polar inverse of
   * `obsidian`. Cream-white fill, crisp 2px charcoal rim,
   * subtle warm-cream outer glow, slow black/charcoal rim-
   * chase animation. Theme-immune subtree (locks light-mode
   * tokens regardless of app theme) — same family of chrome
   * as obsidian, every value mirrored on the luma axis.
   * Pairs natively with the `alabaster` theme.
   */
  | 'alabaster'
// 'grok' is now first-class (gate lifted). 'cursor' (Composer 2.5) is gated
// behind AGBENCH_EXPERIMENTAL_CURSOR (default OFF) — a real ProviderId at the
// type level (so adapters/records compile), but kept OUT of every user-visible
// array + validation Set unless the gate is on, so the gate-off state is
// structurally inert (the same discipline Grok used at G2).
export type ProviderId = 'gemini' | 'codex' | 'claude' | 'kimi' | 'grok' | 'cursor'
export type ChatScope = 'workspace' | 'global'
export type ChatKind = 'single' | 'ensemble'
export type AgenticServiceId = 'shellCommands' | 'fileChanges' | 'mcpTools' | 'subThreadDelegation'
export type AgenticServicePolicy = 'ask' | 'workspace' | 'allow' | 'deny'
export type AgenticNetworkPolicy = 'allow' | 'deny'
export type PermissionPresetId =
  | 'read_only'
  | 'default'
  | 'workspace_write'
  | 'full_access'
  | 'custom'
export type CodexSandboxFallbackMode = 'ask_rerun' | 'off'
export type ProductUpdateChannel = 'debug' | 'stable' | 'nightly'
/** Phase M1 — picks which runtime path AGBench uses for Gemini runs.
 *
 *   - `'auto'` (default): use the API runtime when an API key /
 *     `GeminiAuthProfile` is configured, otherwise fall back to the CLI
 *     provider. Lets users opt in to the hedge against the upcoming
 *     `gemini` CLI deprecation without losing existing CLI workflows
 *     when no API credentials are set.
 *   - `'always'`: require the API runtime. Fail the run with a
 *     setup-required message if no API credentials are available
 *     instead of silently falling back to the CLI.
 *   - `'never'`: force the CLI provider regardless of API credentials.
 *     Useful for users who want to keep using `gemini login` / OAuth
 *     flows or who need CLI-only features (MCP, ACP) and want to opt
 *     out of the API path entirely.
 *
 * The setting is read by the eventual Step-2 wiring inside
 * `runGeminiProvider`. Step 1 only persists the field — nothing
 * consumes it yet. */
export type GeminiApiRuntimeMode = 'auto' | 'always' | 'never'
export type ProductOperationStatus = 'ok' | 'warning' | 'error' | 'unknown'
export type ExternalPathGrantAccess = 'read' | 'write'
export type ExternalPathGrantDuration = 'thisRun' | 'thisThread' | 'workspace'
export type NativeSubAgentRequestPolicy = 'ask' | 'provider' | 'agbench'
export type AgentApprovalAction =
  | 'accept'
  | 'acceptForSession'
  | 'acceptForWorkspace'
  | 'decline'
  | 'cancel'
  | 'useProviderNative'
  | 'useAGBenchSubthread'
  // Slice 4 of the external-path-redesign arc. When the runtime
  // detector (slice 5) spots a tool call referencing a path outside
  // the workspace, the approval payload uses these actions in place
  // of the generic accept/decline pair. `grantExternalPathRead` /
  // `grantExternalPathEdit` issue a signed grant for the detected
  // path AND resolve the pending approval as if the user accepted;
  // `declineExternalPath` is behaviourally identical to `decline`
  // but signals the renderer to render path-specific copy.
  | 'grantExternalPathRead'
  | 'grantExternalPathEdit'
  | 'declineExternalPath'

export interface ExternalPathGrant {
  id: string
  provider: ProviderId
  workspaceId?: string
  chatId?: string
  path: string
  kind: 'file' | 'directory'
  access: ExternalPathGrantAccess
  duration: ExternalPathGrantDuration
  securityScopedBookmark?: string
  issuedBy?: 'main'
  signature?: string
  createdAt: string
  /**
   * 1.0.6-EW66 — Display order for the additional-workspace list
   * in the composer workspace manager. Order is per-PATH, not
   * per-grant: an ensemble chat creates one grant per enabled
   * participant-provider, and all grants sharing a `path` carry
   * the same `order`. Optional + excluded from the HMAC signing
   * payload (`externalGrantSigningPayload`), so it can be mutated
   * renderer-side without invalidating the grant signature.
   * Coalescing self-heals missing values from `createdAt` order
   * on load — see `coalesceExternalPathGrants`.
   */
  order?: number
}

export interface AgenticServicesSettings {
  shellCommands: AgenticServicePolicy
  fileChanges: AgenticServicePolicy
  mcpTools: AgenticServicePolicy
  subThreadDelegation: AgenticServicePolicy
  networkAccess: AgenticNetworkPolicy
}

export interface AgenticWorkspaceGrant {
  id: string
  workspacePath: string
  provider: ProviderId
  service: AgenticServiceId
  createdAt: string
  updatedAt: string
  expiresAt?: string
  expiresOn?: 'workspace_revocation'
}

export interface PermissionPreset {
  id: PermissionPresetId
  label: string
  approvalMode: string
  agenticServices?: Partial<Record<AgenticServiceId, AgenticServicePolicy>>
  networkAccess?: AgenticNetworkPolicy
}

export interface PermissionOverrides {
  approvalMode?: string
  agenticServices?: Partial<Record<AgenticServiceId, AgenticServicePolicy>>
  networkAccess?: AgenticNetworkPolicy
  externalPathGrants?: ExternalPathGrant[]
}

export interface EffectiveRunPermissions {
  presetId: PermissionPresetId
  approvalMode: string
  agenticServices: Record<AgenticServiceId, AgenticServicePolicy>
  networkAccess: AgenticNetworkPolicy
  externalPathGrants: ExternalPathGrant[]
  workspaceGrantServiceIds: AgenticServiceId[]
  readOnly: boolean
}

export type EnsembleParticipantStatus =
  | 'idle'
  | 'running'
  | 'answered'
  | 'yielded'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  /**
   * 1.0.5-Phase-N — participant voluntarily paused via
   * `schedule_wakeup`. This is Ensemble state only; RunManager
   * still treats provider processes as running / exited.
   */
  | 'sleeping'
  /**
   * 1.0.4-AD — pre-flight health check ran at round start and the
   * participant's runtime / socket / binary couldn't be verified.
   * Distinct from `failed` (which fires after dispatch starts and the
   * provider returned an error) so the chip strip can render a
   * "never reached" affordance and the user knows to re-launch the
   * underlying provider before the next round.
   */
  | 'unreachable'

export type EnsembleOrchestrationMode = 'turn_bound' | 'continuous'

export interface EnsembleParticipant {
  id: string
  provider: ProviderId
  enabled: boolean
  role: string
  instructions: string
  order: number
  model?: string
  runtimeProfileId?: string
  geminiAuthProfileId?: string | null
  permissionPresetId?: PermissionPresetId
  permissionOverrides?: PermissionOverrides
  linkedProviderSessionId?: string | null
  /**
   * Slice D — per-participant reasoning + speed + thinking settings.
   * All optional; orchestrator dispatch falls back to provider
   * defaults when absent so existing ensemble chats remain valid.
   *
   *   reasoningEffort  Codex: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
   *                    Claude: 'off' | 'low' | 'medium' | 'high'
   *   fastModeEnabled  Codex (serviceTier=fast) + Claude (claudeFastMode)
   *   thinkingEnabled  Kimi only — toggles k2.6 thinking mode
   *   serviceTier      Reserved for explicit Codex tier overrides if
   *                    we ever expose more than the fast toggle.
   */
  reasoningEffort?: string
  fastModeEnabled?: boolean
  thinkingEnabled?: boolean
  serviceTier?: string
  tokenTotals?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
    duration_ms?: number
  }
}

export interface EnsembleRoundParticipantState {
  participantId: string
  provider: ProviderId
  role: string
  order: number
  status: EnsembleParticipantStatus
  runId?: string
  reason?: string
  startedAt?: string
  endedAt?: string
  /**
   * 1.0.4-AD — last observed failure reason for this participant, set
   * by the pre-flight `probeParticipant` check or by a failed dispatch.
   * Surfaced in the chip strip tooltip so the user can see *why* the
   * participant was marked unreachable without diving into the
   * transcript notes.
   */
  lastFailureReason?: string
}

/**
 * 1.0.5-C4 — Actor-chain entry. One stop on the chain from a
 * leaf envelope back to the root delegator. Captured on
 * approval rows + audit log entries so the trail is
 * inspectable ("Codex → Claude → Kimi" for a tool call that
 * originated in Codex, was delegated to Claude, who further
 * delegated to Kimi to actually run).
 *
 * Walked by `walkActorChain` in `PermissionEnvelope.ts`.
 */
export interface ActorChainEntry {
  envelopeId: string
  parentRunId: string
  childProvider?: ProviderId
  purpose: string
}

/**
 * 1.0.5-C3 — Permission envelope for child-agent delegation.
 *
 * Every sub-thread spawned via `delegate_to_subthread` (or any
 * future child-agent surface) carries an envelope describing
 * what the child can do, scoped relative to the parent. Default
 * child permissions are read-only: the parent must explicitly
 * grant write / network / tool scopes via the delegation
 * request, otherwise the child can't mutate state.
 *
 * The envelope is also the audit-trail seam: every action a
 * child takes is checked against its envelope at enforcement
 * time, and the actor chain (parent → child → grandchild …) is
 * recorded on every approval row + audit log entry.
 *
 * Scope strings use the same glob/path syntax as the existing
 * `fileScopes` patterns — `'*'` for unrestricted, an absolute
 * path for exact match, an absolute path with trailing `/`
 * for directory subtree, or any of the existing
 * `ExternalPathGrant` shapes. Network patterns are host globs
 * (`'github.com'`, `'*.openai.com'`).
 */
export interface PermissionEnvelope {
  /** Stable id for this envelope (`env-${parentRunId}-${ulid}`). */
  envelopeId: string
  /** Parent run that issued the delegation. */
  parentRunId: string
  /** Optional parent envelope, when the parent was itself a child
   * (delegation chain). Set on derivation; surfaces in the
   * actor chain. */
  parentEnvelopeId?: string
  /** Child provider — set once the delegation target is chosen. */
  childProvider?: ProviderId
  /** Child run id — set once the child spawns. */
  childRunId?: string
  /** Human-readable rationale ("Codex delegated to Claude to
   * cross-check the auth fix"). Persisted in the audit log so
   * the chain is interpretable months later. */
  purpose: string
  /**
   * Allowed tool names. Empty array = no tools (the child can
   * still respond conversationally). `['*']` = all tools
   * (rare — the parent must explicitly opt in). The standard
   * "read-only" preset enumerates only non-mutating tools
   * (`read_file`, `list_directory`, `grep`, etc.) — never `['*']`.
   */
  allowedTools: string[]
  /** File paths the child may read. Empty = no file reads. */
  fileReadScope: string[]
  /** File paths the child may write. Empty = no writes (the default). */
  fileWriteScope: string[]
  /** Network host patterns the child may reach. Empty = no
   * network access. */
  networkScope: string[]
  /** ISO timestamp. After this the envelope refuses all actions
   * and the child run must be re-delegated by the parent.
   * Undefined = inherit parent's expiry (or no expiry). */
  expiry?: string
  /** Regex patterns the enforcer redacts from prompts / tool
   * inputs / outputs flowing through this envelope. */
  redactionPatterns: string[]
  /**
   * 1.0.5-C4 — Maximum approvals this envelope is allowed to
   * generate over its lifetime. Undefined = no cap (the child
   * shares the parent's pool implicitly). Once `consumed`
   * crosses `approvalBudget`, the approval is returned to the
   * parent / router / user with an `'exhausted'` decision and
   * the child can't request further approvals until the
   * envelope is renewed.
   *
   * Tracked at runtime by `ApprovalBudgetTracker`; not
   * persisted on the envelope itself (the budget is the cap;
   * consumption is volatile per-process state that resets at
   * app restart along with the lanes that owned it).
   */
  approvalBudget?: number
  /** Stamp from when the envelope was derived. */
  createdAt: string
}

/**
 * 1.0.5-C1 — Concurrent lane lifecycle. Same set of terminal
 * states as `EnsembleParticipantStatus`, but scoped to a single
 * dispatch attempt rather than the participant's overall round
 * state. A participant can have multiple lifetime lanes within a
 * round (e.g. cancelled + retried) — the lane id is the stable
 * key, the participant id groups them.
 *
 * `awaiting-approval` is a concurrent-specific status: an
 * approval gate is open against this lane and the dispatch is
 * paused until the user resolves it (or another lane's approval
 * cascade unblocks it).
 *
 * `blocked` means a write-intent conflict surfaced from the
 * per-workspace registry (1.0.5-C2): another lane already holds
 * a write lock on a resource this lane wants to write to.
 */
export type ConcurrentLaneStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked'
  | 'awaiting-approval'

/**
 * 1.0.5-C1 — Concurrent lane intent. `none` means the lane is
 * purely conversational (no tool calls planned). `read` means it
 * intends to read but not modify. `write` means it intends to
 * mutate filesystem / external state. The registry uses this to
 * decide whether to grant or block a write-intent acquisition;
 * `read` lanes never block each other.
 *
 * The intent is a hint, not a contract — the actual approvals +
 * write-intent registry enforce the underlying safety.
 */
export type ConcurrentLaneIntent = 'none' | 'read' | 'write'

/**
 * 1.0.5-C1 — Concurrent Ensemble lane record. Bookkeeping seam
 * for multi-writer execution. Persisted on
 * `EnsembleRoundState.lanes` keyed by `laneId`. Serial dispatch
 * paths NEVER populate this — they keep using
 * `activeParticipantId` + `participants[].status` as the source
 * of truth. Concurrent dispatch (gated behind
 * `AGBENCH_CONCURRENT_LANES`) populates a lane per dispatched
 * participant.
 */
export interface ConcurrentLane {
  /** Stable lane id (`lane-${roundId}-${participantId}-${attempt}`). */
  laneId: string
  participantId: string
  runId?: string
  provider: ProviderId
  status: ConcurrentLaneStatus
  /** Hint of what this lane plans to do; informs write-intent acquisition. */
  intent: ConcurrentLaneIntent
  startedAt: string
  endedAt?: string
  /** Provider-side session id, when the adapter supports session resume. */
  providerSessionId?: string | null
  /** Count of approvals open against this lane. Bumped when an approval
   * registers, decremented on resolve/timeout/cancel. UI uses this to
   * show "(N pending)" on the lane chip. */
  approvalsQueued?: number
  /** When the user (or another orchestrator path) requested cancel.
   * The lane stays in its current status until the underlying adapter
   * confirms the cancel; then it transitions to `'cancelled'`. */
  cancellationRequestedAt?: string
  /** Last failure or block reason, surfaced in tooltips. */
  reason?: string
}

export interface EnsembleRoundState {
  roundId: string
  status: 'running' | 'completed' | 'cancelled' | 'failed'
  prompt: string
  startedAt: string
  endedAt?: string
  activeParticipantId?: string
  orchestrationMode?: EnsembleOrchestrationMode
  continuationHops?: number
  maxContinuationHops?: number
  /**
   * 1.0.5-C1 — Concurrent-mode lane records, keyed by `laneId`.
   * Only populated when the round dispatched in concurrent mode
   * (`concurrentMode === true` AND the
   * `AGBENCH_CONCURRENT_LANES` env flag is on). Serial dispatch
   * leaves this undefined; readers should treat
   * `participants[].status` as authoritative when `lanes` is
   * absent or empty.
   */
  lanes?: Record<string, ConcurrentLane>
  /**
   * 1.0.5-C1 — Round-level concurrent-mode flag. When `true` the
   * orchestrator dispatches all eligible participants in parallel
   * lanes; serial-write-conflict pauses fire as the
   * write-intent registry detects collisions. Default `undefined`
   * (treated as serial) so existing rounds keep their behaviour.
   *
   * Refused when the env gate is off — the orchestrator's
   * `startRound` rejects with a structured error rather than
   * silently falling back to serial.
   */
  concurrentMode?: boolean
  /**
   * Legacy single-prompt queue (1.0.3 ship). Kept for back-compat
   * with persisted round records — the orchestrator's new path uses
   * `queuedPrompts` (array) to accumulate multiple queued sends.
   * Reads in the renderer should prefer `queuedPrompts` and fall
   * back to this field only when migrating an older record.
   */
  queuedPrompt?: string
  /**
   * Multi-entry queue of prompts to dispatch as fresh rounds once
   * the current round finishes (or on Steer). Each entry becomes a
   * new round, processed in order. Defaults to an empty array so
   * existing code that checks length doesn't need null guards.
   */
  queuedPrompts?: string[]
  sleepingParticipantIds?: string[]
  pendingWakeupIds?: string[]
  participants: EnsembleRoundParticipantState[]
}

export type SessionActivityChangedBy = 'user' | 'orchestrator' | 'system'
export type SessionActivityScope = 'session' | 'round' | 'participant'

export interface SessionActivityLedgerEntry {
  id: string
  timestamp: string
  changedBy: SessionActivityChangedBy
  scope: SessionActivityScope
  target?: string
  oldValue?: string | null
  newValue?: string | null
  reason?: string
}

export interface EnsembleRunIdentity {
  roundId: string
  participantId: string
  provider: ProviderId
  role: string
  order: number
}

/**
 * 1.0.4-AR13 — explicit round-mode model.
 *
 * Orthogonal to `EnsembleOrchestrationMode` (turn_bound /
 * continuous) which describes whether participants can hand
 * work back and forth. `EnsembleRoundMode` describes the
 * STRUCTURE of a single round:
 *
 *   - `targeted`       — only the named participant speaks
 *                        (overlaps with the existing
 *                        `dmTargetParticipantId` DM path; this is
 *                        the explicit name for it).
 *   - `roundtable`     — every enabled participant speaks once,
 *                        no special structure. Default.
 *   - `chair-summary`  — the synthesizer participant (AT8) goes
 *                        LAST and is explicitly told to
 *                        summarise the prior turns.
 *   - `rebuttal`       — each participant responds to a
 *                        designated peer's last contribution
 *                        rather than starting from the user's
 *                        original prompt.
 *
 * Undefined reads as `'roundtable'` (the pre-AR13 default).
 */
export type EnsembleRoundMode = 'targeted' | 'roundtable' | 'chair-summary' | 'rebuttal'

export interface EnsembleRoundSummaryRecord {
  roundId: string
  participantId: string
  provider: ProviderId
  role?: string
  runId?: string
  summary: string
  capturedAt: string
}

export type EnsembleWakeupStatus = 'pending' | 'fired' | 'cancelled' | 'expired'

export interface EnsembleWakeupRecord {
  wakeupId: string
  chatId: string
  roundId: string
  participantId: string
  provider: ProviderId
  role?: string
  runId?: string
  scheduledAt: string
  wakeAt: string
  status: EnsembleWakeupStatus
  reason?: string
  cancelOnUserInput?: boolean
  firedAt?: string
  cancelledAt?: string
  expiredAt?: string
  message?: string
}

/**
 * 1.0.5-EW37 — Solo-chat wakeup record. Mirrors `EnsembleWakeupRecord`
 * minus the ensemble-specific routing fields (`roundId`,
 * `participantId`, `role`). Persisted on `ChatRecord.soloWakeups`
 * so it survives app restart via the same recovery flow as the
 * ensemble path.
 *
 * Reuses `EnsembleWakeupStatus` — same lifecycle of
 * `pending → fired/cancelled/expired`.
 */
export interface SoloChatWakeupRecord {
  wakeupId: string
  chatId: string
  provider: ProviderId
  /** Optional — the solo run that scheduled the wakeup. Used by the
   * fire handler to seed the continuation run's prompt with the
   * original reason and (where possible) reuse the provider session
   * via `chat.linkedProviderSessionId`. */
  runId?: string
  scheduledAt: string
  wakeAt: string
  status: EnsembleWakeupStatus
  reason?: string
  cancelOnUserInput?: boolean
  firedAt?: string
  cancelledAt?: string
  expiredAt?: string
}

/** M4 — TTL scope for a blackboard entry.
 * - `round`   : visible only during the round that wrote it (pruned next round)
 * - `session` : persists across rounds while the ensemble session is live
 * - `chat`    : persists for the lifetime of the chat */
export type BlackboardScope = 'round' | 'session' | 'chat'

/** M4 — category buckets, mirroring the synthesizer's round-summary shape so a
 * round summary can be auto-derived into blackboard entries. */
export type BlackboardCategory = 'decision' | 'fact' | 'risk' | 'do-not-repeat' | 'note'

/** M4 — a single entry in the cross-participant shared scratchpad. Participants
 * read a compact digest of in-scope entries in their prompt (so shared context
 * doesn't mean dumping full transcript memory) and can post new entries via the
 * `blackboard_post` MCP tool. See src/main/blackboard/Blackboard.ts. */
export interface BlackboardEntry {
  id: string
  chatId: string
  /** Round in which the entry was written (drives `round`-scope pruning). */
  roundId: string
  /** Author participant id, or 'synthesizer' / 'system' for derived entries. */
  participantId: string
  /** Short stable handle for the note (used for de-dupe/upsert per author). */
  key: string
  value: string
  category: BlackboardCategory
  scope: BlackboardScope
  /** Provenance — a tool-call id or a prior entry id this was derived from. */
  derivedFrom?: string
  createdAt: string
}

export interface EnsembleConfig {
  enabled: boolean
  maxParticipants: number
  orchestrationMode?: EnsembleOrchestrationMode
  /** 1.0.4-AR13 — see `EnsembleRoundMode` for semantics. Undefined
   * reads as `'roundtable'` so all pre-AR13 chats keep their
   * existing structure. */
  roundMode?: EnsembleRoundMode
  maxContinuationHops?: number
  participants: EnsembleParticipant[]
  sessionActivityLedger?: SessionActivityLedgerEntry[]
  activeRound?: EnsembleRoundState
  updatedAt?: string
  /**
   * 1.0.4-AF — opt-in "self-reflective" mode. When true, the ensemble
   * prompt's deictic-resolution rule (1.0.4-Q) is inverted so
   * "this app / this repo" refers to AGBench itself rather than the
   * active workspace. Used by the `/discuss` slash command for
   * meta-conversations about the harness.
   */
  selfReflective?: boolean
  /**
   * 1.0.4-AK — supervised multi-round autonomy mode. When present
   * AND `status === 'active'`, the orchestrator queues follow-up
   * rounds via `ensemble_continue` (the MCP control tool) instead
   * of returning to the user after each round. See
   * `src/main/EnsembleContinue.ts` for the handler and
   * `WorkSessionConfig` for field semantics.
   */
  workSession?: WorkSessionConfig
  /**
   * 1.0.4-AT8 — designated synthesizer/owner participant. When set,
   * the prompt builder appends a structured "summarise this round"
   * instruction to this participant's prompt (decisions / open
   * risks / next action), letting the panel produce a canonical
   * round summary instead of leaving every participant's final
   * paragraph as N parallel takes the user has to reconcile.
   *
   * The orchestrator's end-of-round hook captures the synthesizer's
   * final text into `lastRoundSummary` once the round is complete.
   * Subsequent rounds' participant prompts read
   * `lastRoundSummary` (when non-empty) and prepend it as a
   * "Prior round summary:" block so corrections propagate.
   *
   * Undefined = no synthesizer (pre-AT8 behavior; each participant
   * speaks for themselves).
   */
  synthesizerParticipantId?: string
  /**
   * 1.0.4-AT8 — canonical summary of the most recent completed
   * round. Set by the orchestrator (follow-up) when the
   * synthesizer participant emits their structured summary. Read
   * by subsequent rounds' prompt builders. Cleared by `Steer`
   * (intentional reset) and `Stop` (round cancelled).
   */
  lastRoundSummary?: string
  /**
   * 1.0.5-AT8 — per-round summary history keyed by round id. This
   * backs historical round cards and future long-running checkpoint
   * views while `lastRoundSummary` remains the prompt-facing latest
   * summary.
   */
  roundSummaries?: Record<string, EnsembleRoundSummaryRecord>
  /**
   * 1.0.5-Phase-N — persisted pending/fired/cancelled wakeups for
   * Ensemble participants. These records are the source of truth for
   * restart recovery; timers are only in-memory accelerators.
   */
  wakeups?: Record<string, EnsembleWakeupRecord>
  /**
   * M4 (1.0.7) — cross-participant shared scratchpad. Entries are
   * auto-derived from each round's synthesizer summary (decisions /
   * corrections / open risks / next action) and surfaced to every
   * participant's prompt next round as a compact digest, so shared
   * context propagates without dumping full transcript memory. TTL-
   * pruned per round/session/chat. See src/main/blackboard/Blackboard.ts.
   */
  blackboard?: BlackboardEntry[]
}

/**
 * 1.0.4-AK — supervised multi-round autonomy ("Work Session") mode.
 * The user defines an objective + acceptance criteria + safety
 * budget; participants drive themselves through rounds via the
 * `ensemble_continue` MCP control tool until acceptance is reported,
 * a hard-stop trips, or the user clicks Stop.
 *
 * Critically, Work Session does NOT bypass `EffectiveRunPermissions`
 * — the `permissionPresetId` here is fed INTO the existing per-run
 * permission resolution (see `EnsembleOrchestrator.ts`'s
 * `resolveParticipantPermissions`) rather than replacing it. Every
 * mutation still goes through the same approval gate it would in
 * an interactive serial session.
 */
export type WorkSessionStatus =
  /** No active session — the field may exist but ignored. */
  | 'idle'
  /** Session running, rounds may auto-queue via `ensemble_continue`. */
  | 'active'
  /** Blocked on user (a participant called `ask_user_question` or
   * `ensemble_continue(acceptanceStatus: 'blocked')`). Resume button
   * re-arms the session once the user has answered. */
  | 'paused'
  /** Acceptance criteria reported met by `ensemble_continue`. */
  | 'completed'
  /** User clicked Stop. */
  | 'cancelled'
  /** Round / duration / token budget exhausted. The transcript
   * status row distinguishes which budget hit (see `endedReason`). */
  | 'limit_reached'

export interface WorkSessionConfig {
  /** Whether this session field is meaningful. Lets us persist
   * a "last config" without it counting as an active session. */
  enabled: boolean
  status: WorkSessionStatus
  objective: string
  acceptanceCriteria: string
  /** Subset of ensemble participants allowed to act in the session.
   * `null` means "all currently-enabled participants". Participants
   * not in the list are skipped from rotation but may still receive
   * `@user` returns. */
  allowedParticipantIds: string[] | null
  /** Designated lead — gets the first speaker slot of every round.
   * Optional; absent = roster-order. */
  leadParticipantId?: string
  /** Permission preset clamped over each participant for the
   * duration of the session. Fed into the existing
   * `resolveEffectiveRunPermissions` pipeline so workspace grants +
   * overrides still apply. Never bypasses approval gates. */
  permissionPresetId: PermissionPresetId
  /** Hard-stop budgets. */
  maxRoundsPerProvider: number
  maxDurationMs: number
  maxTokenBudget?: number
  /** Parallel Scout Pass opt-in (1.0.4-AK5/AK6). When false the
   * session stays pure-serial regardless of participant count. */
  enableScoutPass: boolean
  startedAt?: string
  endedAt?: string
  /** Human-readable reason captured at terminal-status transition
   * (e.g. "Round budget reached for codex (38/38)"). */
  endedReason?: string
  /** Rolling counters surfaced in the session strip + used for
   * `limit_reached` checks. Initialised to zero per-provider when
   * the session starts. */
  roundsUsed: Record<ProviderId, number>
  /** Sum of `roundsUsed[*]`. Cached so the UI doesn't re-sum on
   * every render. */
  totalRoundsUsed: number
}

/**
 * 1.0.4-AE — typed shape for the `provider_auth_status` MCP tool,
 * split out of the legacy single-string `appServer` field into
 * orthogonal concerns the panel review flagged as conflated:
 *   - `serverState`: lifecycle. `'error'` is reserved for helpers
 *     that crashed mid-run; `'unavailable'` for "not reachable at
 *     all"; `'started'` / `'lazy'` cover the codex hot/cold path.
 *   - `transport`: wire protocol. The `'pty'` and `'http'` arms are
 *     reserved for adapters in flight (cf. the Kimi wire / Gemini
 *     API transport ramps) so MCP consumers don't need a schema
 *     bump when they land.
 *   - `approvalSupport`: capability — does this provider's adapter
 *     route approvals through AGBench's main-authority gate?
 *   - `mcpStatusSupport`: capability — can the adapter answer
 *     MCP status probes (Codex via app-server, the others not yet).
 *   - `authState`: actionable state, not the previous vague
 *     `'unknown'` catch-all. `'expired'` is reserved for credentials
 *     we proactively detect as past TTL (vs `'missing'` for never-set).
 *
 * `appServer` and `accountStatus` are preserved as deprecated
 * aliases for the 1.0.4 → 1.0.5 transition window and are removed
 * after 1.0.5. MCP consumers should migrate to
 * `serverState` / `transport` (replaces `appServer`) and
 * `authState` / `authReason` (replaces `accountStatus`).
 */
export type ProviderAuthServerState = 'started' | 'lazy' | 'error' | 'unavailable'
export type ProviderAuthTransport = 'sdk' | 'cli' | 'app-server' | 'pty' | 'http' | 'unavailable'
export type ProviderAuthState =
  | 'authenticated'
  | 'not-queried'
  | 'not-observable'
  | 'missing'
  | 'expired'

export interface ProviderAuthStatusV2 {
  provider: ProviderId
  serverState: ProviderAuthServerState
  transport: ProviderAuthTransport
  approvalSupport: boolean
  mcpStatusSupport: boolean
  authState: ProviderAuthState
  /** Optional human-readable reason — populated for `missing` /
   * `not-observable` / `not-queried` / `expired` states where context
   * helps the agent decide what to do next (re-auth, surface to user,
   * etc.). */
  authReason?: string
  /** @deprecated 1.0.4 → 1.0.5 alias for the legacy single-string
   * `appServer` field. Use `serverState` and `transport` instead.
   * Removed after 1.0.5. */
  appServer?: string
  /** @deprecated 1.0.4 → 1.0.5 alias for the legacy `accountStatus`
   * field. Use `authState` and `authReason` instead. Removed after
   * 1.0.5. */
  accountStatus?: string
}

export interface GeminiMcpBridgeStatus {
  checkedAt: string
  enabled: boolean
  installed: boolean
  available: boolean
  serverName: 'AGBench'
  command?: string[]
  socketPath?: string
  message?: string
  raw?: string
  error?: string
}

export type ProviderCapabilityState =
  | 'available'
  | 'gated'
  | 'blocked'
  | 'delegated'
  | 'unavailable'
export type ProviderCapabilityWarningSeverity = 'info' | 'warning' | 'error'
export type ProviderToolingCapabilityId =
  | Exclude<AgenticServiceId, 'subThreadDelegation'>
  | 'creativeApps'
  | 'networkAccess'

export interface ProviderCapabilityWarning {
  id: string
  severity: ProviderCapabilityWarningSeverity
  title: string
  message: string
}

export interface ProviderToolingCapability {
  id: ProviderToolingCapabilityId
  label: string
  state: ProviderCapabilityState
  source: 'agentbench' | 'provider' | 'bridge' | 'settings'
  enforcedByAgentBench?: boolean
  enforcement?: 'agentbench' | 'provider' | 'bridge' | 'settings' | 'best_effort' | 'none'
  policy?: AgenticServicePolicy | AgenticNetworkPolicy
  requiresApproval: boolean
  tools: string[]
  details?: string
}

export interface ProviderApprovalCapability {
  requestedMode: string
  effectiveMode: string
  providerMode: string
  inAppApprovals: boolean
  supportsWorkspaceGrants: boolean
  notes: string[]
}

export interface ProviderMcpCapability {
  state: ProviderCapabilityState
  source: 'agentbench' | 'provider' | 'bridge' | 'unsupported'
  available: boolean
  enabled?: boolean
  installed?: boolean
  serverName?: string
  tools: string[]
  message?: string
}

export interface ProviderAvailabilityCapability {
  available: boolean
  setupRequired?: boolean
  binaryPath?: string | null
  binarySource?: string
  version?: string
  authState?: string
  appServer?: string
  error?: string
}

export interface ProviderCapabilityContract {
  provider: ProviderId
  label: string
  refreshedAt: string
  workspacePath?: string
  availability: ProviderAvailabilityCapability
  tools: Record<ProviderToolingCapabilityId, ProviderToolingCapability>
  approvals: ProviderApprovalCapability
  mcp: ProviderMcpCapability
  warnings: ProviderCapabilityWarning[]
}

export type ProviderAdapterTransport =
  | 'gemini-cli'
  | 'codex-app-server'
  | 'claude-sdk-or-cli'
  | 'kimi-wire-or-cli'
  | 'grok-cli'
  | 'cursor-cli'

export type ProviderAdapterRunChannel = 'run-agent'

export interface ProviderAdapterFeatureFlags {
  persistentSessions: boolean
  appManagedApprovals: boolean
  workspaceGrants: boolean
  agentBenchMcpBridge: boolean
  providerManagedMcp: boolean
  nativeThreadTools: boolean
  hostCommandFallback: boolean
}

/** Static per-provider capability declarations.
 *
 * `features` (above) describes INFRASTRUCTURE characteristics —
 * whether the adapter uses AGBench's MCP bridge, has persistent
 * sessions, etc. `ProviderAdapterCapabilities` describes USER-FACING
 * UX capabilities — what the iOS composer / desktop renderer should
 * render for this provider.
 *
 * Examples of how UI consumes these:
 *   - `reasoningEffort: false` → hide the reasoning-effort picker
 *   - `imageAttachments: false` → disable the paperclip button
 *   - `approvalModes: ['default']` → hide the "plan mode" toggle
 *   - `speedTiers: []` → no speed-tier picker at all
 *
 * iOS UI subscribes to a provider's capabilities snapshot (sent during
 * pair init, refreshed on capability changes) and renders accordingly.
 * Desktop renderer can do the same via the existing
 * `get-provider-adapters` IPC.
 *
 * Future additions: thinking-mode flags, tool-call-batch support,
 * worktree variants — extend cautiously, since iOS clients tolerate
 * unknown fields but new required fields would break older clients. */
export interface ProviderAdapterCapabilities {
  /** Approval modes the provider's runtime accepts. iOS composer
   * filters this against `RemoteWorkspaceEntry.allowedApprovalModes`
   * to produce the final picker contents. */
  approvalModes: Array<'default' | 'plan' | 'allow-all'>
  /** Whether the run payload's `reasoningEffort` field has any effect
   * for this provider. Codex / Claude honor it; Gemini / Kimi
   * currently don't. */
  reasoningEffort: boolean
  /** Provider-specific speed tier identifiers. Empty array → no
   * speed-tier picker. */
  speedTiers: string[]
  /** Whether `imagePaths` in the run payload are forwarded to the
   * provider. iOS composer's image-picker is gated by this. */
  imageAttachments: boolean
  /** Whether the prompt-composition layer's context-turn injection
   * applies. When false, the composer's contextTurns slider has no
   * effect — UI hides it. */
  contextInjection: boolean
  /** Whether `providerSessionId` in the run payload resumes a prior
   * session (vs the provider creating a fresh session every turn). */
  sessionResumption: boolean
  /** Whether the provider supports per-thread MCP server scoping
   * (Gemini-style). When false, MCP servers are workspace-wide. */
  perThreadMcp: boolean
}

export interface ProviderAdapterDescriptor {
  provider: ProviderId
  label: string
  transport: ProviderAdapterTransport
  runChannel: ProviderAdapterRunChannel
  capabilitySource: 'agentbench' | 'provider' | 'bridge' | 'mixed'
  features: ProviderAdapterFeatureFlags
  capabilities: ProviderAdapterCapabilities
}

export type RuntimeWorkspaceMode = 'local' | 'worktree' | 'container'
export type RuntimeNetworkPolicy = 'inherit' | 'allow' | 'deny'
export type RuntimePersistence = 'reusable' | 'ephemeral'

export interface RuntimeProfile {
  id: string
  name: string
  provider: ProviderId
  scope: ChatScope
  workspaceMode: RuntimeWorkspaceMode
  binaryPath?: string
  env: Record<string, string>
  mcpProfileId?: string
  approvalMode?: string
  agenticServices?: AgenticServicesSettings
  networkPolicy: RuntimeNetworkPolicy
  persistence: RuntimePersistence
  containerConfig?: {
    image?: string
    workdir?: string
    mounts?: Array<{ source: string; target: string; access: 'read' | 'write' }>
  }
  builtin?: boolean
  createdAt: string
  updatedAt: string
}

export interface HandoffCard {
  id: string
  status: 'draft' | 'dispatched' | 'archived'
  sourceChatId: string
  sourceRunId?: string
  sourceProvider: ProviderId
  workspaceId?: string
  workspacePath?: string
  summary: string
  selectedFiles: string[]
  workspaceChangeSetIds: string[]
  rawEventRunIds: string[]
  recommendedProvider?: ProviderId
  recommendedModel?: string
  recommendedApprovalMode?: string
  targetChatId?: string
  dispatchedRunId?: string
  finalPrompt: string
  createdAt: string
  updatedAt: string
  dispatchedAt?: string
}

export interface HandoffCardFilter {
  sourceChatId?: string
  sourceRunId?: string
  status?: HandoffCard['status']
}

export type FunFxMode = 'off' | 'subtle' | 'cinematic' | 'epic'

export interface AdvancedFxSettings {
  agentAura: boolean
  livingWorkspace: boolean
  dataViz: boolean
  intensity: Exclude<FunFxMode, 'off'>
}

export interface ProviderApiKeyStatus {
  available: boolean
  authState: string
  apiKeyConfigured: boolean
  encryptionAvailable: boolean
  version?: string
  binaryPath?: string | null
}

export type GeminiAuthProfileKind = 'api-key' | 'vertex-ai' | 'google-oauth'

export interface GeminiAuthProfile {
  id: string
  label: string
  kind: GeminiAuthProfileKind
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
  encryptedApiKey?: string
  vertexProject?: string
  vertexLocation?: string
}

export type GeminiOAuthLoginStatusValue = 'idle' | 'running' | 'success' | 'error' | 'cancelled'

export interface GeminiOAuthLoginStatus {
  profileId: string
  status: GeminiOAuthLoginStatusValue
  startedAt?: string
  finishedAt?: string
  message?: string
  authUrl?: string
  exitCode?: number | null
}

export interface GeminiAuthProfileSummary {
  id: string
  label: string
  kind: GeminiAuthProfileKind
  configured: boolean
  isDefault: boolean
  authState: string
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
  vertexProject?: string
  vertexLocation?: string
  oauthEmail?: string
  oauthConfigured?: boolean
  oauthLogin?: GeminiOAuthLoginStatus
}

export interface GeminiAuthStatus extends ProviderApiKeyStatus {
  activeProfileId?: string | null
  activeProfileLabel?: string
  profiles: GeminiAuthProfileSummary[]
  oauthLogin?: GeminiOAuthLoginStatus
}

export interface AppSettings {
  activeProvider?: ProviderId
  windowBounds?: {
    x?: number
    y?: number
    width: number
    height: number
    isMaximized?: boolean
  }
  claudeBinaryPath?: string
  claudeApiKey?: string
  kimiBinaryPath?: string
  kimiApiKey?: string
  defaultGeminiAuthProfileId?: string | null
  geminiAuthProfiles?: GeminiAuthProfile[]
  /** Phase M1 — Gemini API runtime selection. See {@link GeminiApiRuntimeMode}
   * for the per-mode semantics. Defaults to `'auto'`: use the API path
   * when an API key is configured, else CLI. `'always'` requires API;
   * `'never'` forces CLI. Step 1 persists this field but does not yet
   * consume it — wiring lands in Phase M1 Step 2. */
  geminiApiRuntime?: GeminiApiRuntimeMode
  codexUsageCredential?: {
    encryptedAccessToken?: string
    accountId?: string
    importedAt?: string
    source?: string
    encryptionAvailable?: boolean
  }
  storeLocalChatHistory: boolean
  storeRawEvents: boolean
  storePromptResponseInUsage: boolean
  ensembleModeEnabled: boolean
  geminiCheckpointingEnabled: boolean
  chatContextTurns: number
  appearanceMode: AppearanceMode
  visualEffectStyle: VisualEffectStyle
  themeAppearance: ThemeAppearance
  themeCornerStyle: ThemeCornerStyle
  themeAccentStyle: ThemeAccentStyle
  toolIconAccent: ToolIconAccent
  userBubbleColor: UserBubbleColor
  promptSurfaceStyle: PromptSurfaceStyle
  composerStyle: ComposerStyle
  transcriptFontFamily?: string
  composerFontFamily?: string
  /** 1.0.5-EW25 — Display currency for cost / token-spend chips.
   * The underlying USD value comes verbatim from provider event
   * payloads (`cost_usd`); the renderer converts to the user's
   * chosen display currency via `src/renderer/src/lib/formatCost.ts`.
   * Rates are static approximations (no live FX lookup yet — that's
   * deferred to 1.0.6 sub-slice c). USD is the default. */
  currency: 'USD' | 'GBP' | 'EUR'
  /** 1.0.5-EW34 — Currency sub-slice (e): conservative-overestimate
   * mode. When non-zero, cost displays are multiplied by
   * `1 + (percent / 100)` BEFORE FX conversion, so a `$0.10` actual
   * cost renders as `$0.11` with a 10% safety bias. Useful for
   * users who want their displayed cost to over-shoot the real bill
   * (so a session that "looks like" $5 has actually spent under
   * that). Clamped to 0–25 at the slider UI; we also clamp
   * defensively in `formatCost` so a stored value outside the
   * range can't break rendering. Default 0 (no bias). Optional
   * field so older settings files / test fixtures don't need to
   * round-trip a value they never set. */
  currencyOverestimatePercent?: number
  /**
   * 1.0.5-EW49 — Dashboard statistics preferences. Two slots:
   *   - `visibility` (per-stat boolean map): hide a chip to
   *     remove it from the dense grid without losing the
   *     underlying data. Re-enable any time. Default: every
   *     stat visible (`undefined` entry resolves to `true`).
   *   - `resetAt` (single epoch-ms timestamp): user clicked
   *     "Reset all dashboard stats" — every stat that supports
   *     reset filters its input records by
   *     `record.timestamp >= resetAt`. Default: `0` / undefined
   *     means "no reset, include all history".
   * The shared key set is enumerated in
   * `src/renderer/src/lib/dashboardStatRegistry.ts` so the
   * Settings UI + dashboard renderer + builder stay in sync.
   * Per-stat reset (one button per stat) is deferred to EW49b
   * because the builder threading would touch every stat
   * computation invasively.
   */
  dashboardStatPrefs?: {
    visibility?: Record<string, boolean>
    resetAt?: number
    /**
     * 1.0.5-EW51 — Workspaces tab on/off. Default: visible. The
     * tab itself filters the dashboard tab strip; the underlying
     * data is still computed so toggling it back on doesn't
     * re-cost anything.
     */
    workspacesTabEnabled?: boolean
    /**
     * 1.0.5-EW51 — Max number of workspace cards shown in the
     * scrollable list at the top of the Workspaces tab. The full
     * sorted list is always computed; the renderer slices to
     * this count. Default 8; clamped 4–20 at the slider UI.
     */
    workspacesShown?: number
    /**
     * 1.0.5-EW52 — Providers tab visibility (default true).
     * When false, the Providers tab hides from the dashboard
     * tab strip and the auto-cycle skips it. The underlying
     * data is still computed — toggling back doesn't re-cost.
     */
    providersTabEnabled?: boolean
    /**
     * 1.0.5-EW52 — Auto-cycle the dashboard tabs in a loop
     * every N seconds while the welcome screen is mounted.
     * Default 180 (3 minutes). 0 / undefined disables the
     * cycle. Range 30–3600 enforced by the slider UI.
     */
    autoCycleSeconds?: number
  }
  /**
   * Welcome-screen standalone heatmap visibility. All three heatmaps
   * default to visible; a stored `false` hides only that heatmap.
   */
  welcomeHeatmapPrefs?: {
    workspaceActivityEnabled?: boolean
    agbenchActivityEnabled?: boolean
    externalActivityEnabled?: boolean
  }
  /** 1.0.5-EW26 — Kimi (Moonshot) compatibility filter toggle.
   * When true, prompts dispatched to a Kimi participant are
   * scanned by `src/main/lib/kimiSanitiser.ts` and any sentence
   * containing a configured trigger keyword (default list +
   * `kimiSanitiserCustomKeywords`) is replaced with a redacted
   * placeholder before the Kimi process spawns. Other
   * participants always see the unfiltered prompt. Default
   * `false` — opt-in for users who hit Moonshot content_filter
   * rejections on incidental world-news / geopolitics digressions. */
  kimiSanitiserEnabled: boolean
  /** 1.0.5-EW26 — Newline-separated extra trigger keywords the
   * user wants the Kimi compatibility filter to catch on top of
   * the curated defaults. Lines starting with `#` are treated as
   * comments and skipped. Empty string = use defaults only. */
  kimiSanitiserCustomKeywords: string
  /** 1.0.7-M10 — Opt-in second-pass Kimi classifier redaction.
   * When enabled, a Kimi content-filter retry can escalate beyond
   * literal EW26 keyword matches to a deterministic sentence
   * classifier. Missing/false keeps the retry envelope keyword-only. */
  kimiClassifierEnabled?: boolean
  funFxEnabled: boolean
  funFxMode: FunFxMode
  advancedFx: AdvancedFxSettings
  reduceTransparency: boolean
  reduceMotion: boolean
  compactDensity: boolean
  showInspector: boolean
  inspectorWidth: number
  sidebarWidth: number
  agenticServices: AgenticServicesSettings
  agenticWorkspaceGrants: AgenticWorkspaceGrant[]
  /** User preference for provider-native sub-agent tools (`Task`,
   * `invoke_agent`, etc.) versus AGBench durable sub-threads. When
   * unset, the runtime asks on the first observable native request. */
  nativeSubAgentRequests?: NativeSubAgentRequestPolicy
  /** When true (default), an agent's parent chat is automatically
   * "nudged" with a synthetic continuation prompt after a sub-thread
   * the agent delegated to (with `returnResultToParent: true`) finishes
   * and its final assistant message has been back-propagated to the
   * parent transcript. Without this, the back-propagated result just
   * sits in the parent transcript until the user manually types
   * something — the agent has no event to wake up on. See
   * `src/main/AutoResumeParent.ts` for the gating logic and
   * `maybePropagateSubThreadResult` in `src/main/index.ts` for the
   * dispatch site. */
  autoResumeParentOnSubThreadCompletion: boolean
  geminiMcpBridgeEnabled: boolean
  geminiMcpBridgeLastStatus?: GeminiMcpBridgeStatus
  bridgeDaemonEnabled?: boolean
  codexSandboxFallback: CodexSandboxFallbackMode
  updateChannel: ProductUpdateChannel
  /** Per-provider + main-authority approval timeout policy (Phase E1.1).
   * When an approval enters the pending registry, a timer fires after
   * the matching ms value and auto-denies the request. `enabled: false`
   * disables the entire scheduler (same effect as
   * `AGBENCH_APPROVAL_TIMEOUT_OFF=1`). */
  approvalTimeouts: {
    enabled: boolean
    perProviderMs: {
      gemini: number
      codex: number
      claude: number
      kimi: number
    }
    mainAuthorityMs: number
  }
  /** Phase E1 (iOS bridge gap #1) — APNs production credentials for
   * wake-on-approval push delivery to paired iOS devices. The .p8
   * auth-key content is encrypted via Electron `safeStorage` before
   * persistence; everything else is plain strings. When all four
   * credential fields are populated AND the encrypted key decrypts,
   * `createBridgeApnsPusher` returns a real `Http2ApnsPusher` instead
   * of the default no-op. */
  apnsConfig?: {
    /** base64 ciphertext of the .p8 PEM bytes, encrypted via
     * `safeStorage.encryptString`. Set to undefined when cleared. */
    encryptedAuthKey?: string
    /** Apple Developer "Key ID" (10 chars, from Keys > APNs). */
    keyId?: string
    /** Apple Developer "Team ID" (10 chars, from Membership). */
    teamId?: string
    /** iOS companion app bundle id. Defaults to
     * `com.example.AGBench.ios` (the value the iOS companion
     * project ships with). Surfaced as a field so future companion
     * builds with a different bundle id don't require code changes. */
    bundleId?: string
    /** ISO timestamp of the most recent successful save. */
    configuredAt?: string
    /** Snapshot of the most recent test-push round-trip so the
     * Settings UI can show "delivered 1/1" or "failed: reason" without
     * keeping the result in renderer state. */
    lastTestResult?: {
      at: string
      delivered: number
      failed: number
      error?: string
    }
    /** Caches `safeStorage.isEncryptionAvailable()` at save-time so the
     * UI can warn if the user previously saved a key on a Mac with
     * encryption but is now reading on one without (e.g. fresh login). */
    encryptionAvailable?: boolean
  }
}

export type ProductCrashSource =
  | 'main'
  | 'renderer'
  | 'child_process'
  | 'provider'
  | 'bridge'
  | 'startup'
  | 'unknown'

export interface ProductCrashRecord {
  schemaVersion: 1
  id: string
  source: ProductCrashSource
  severity: 'warning' | 'error' | 'fatal'
  occurredAt: string
  appVersion: string
  platform: string
  arch: string
  processType?: string
  reason?: string
  exitCode?: number | null
  name?: string
  message: string
  stack?: string
  metadata?: Record<string, unknown>
}

export type ProductCrashInput = Omit<
  ProductCrashRecord,
  'schemaVersion' | 'id' | 'occurredAt' | 'appVersion' | 'platform' | 'arch'
> &
  Partial<Pick<ProductCrashRecord, 'id' | 'occurredAt' | 'appVersion' | 'platform' | 'arch'>>

export interface ProductCrashFilter {
  source?: ProductCrashSource
  severity?: ProductCrashRecord['severity']
  since?: string
  limit?: number
}

export interface ProductHealthCheck {
  id: string
  label: string
  status: ProductOperationStatus
  message: string
  repairAction?: 'install_gemini_bridge' | 'create_user_data_dir' | 'none'
  checkedAt: string
}

export interface ProductBridgeHealthRecord {
  provider: ProviderId
  bridgeId: string
  label: string
  status: ProductOperationStatus
  checkedAt: string
  enabled: boolean
  installed: boolean
  available: boolean
  message: string
  rawStatus?: GeminiMcpBridgeStatus
}

export interface ProductInstallRepairStatus {
  checkedAt: string
  status: ProductOperationStatus
  appPath: string
  userDataPath: string
  checks: ProductHealthCheck[]
}

export interface ProductReleaseAutomationStatus {
  checkedAt: string
  status: ProductOperationStatus
  updateChannel: ProductUpdateChannel
  appId?: string
  productName?: string
  outputDirectory?: string
  scripts: {
    build?: string
    test?: string
    ci?: string
    buildUnpack?: string
    buildMac?: string
    buildMacNotarized?: string
    buildDebugMac?: string
    buildDebugMacNotarized?: string
    smokeNodePty?: string
    smokePackage?: string
    validateRelease?: string
  }
  nativeModules: {
    configured: boolean
    validationScript?: string
    message: string
  }
  updateDistribution: {
    configured: boolean
    provider?: string
    owner?: string
    repo?: string
    url?: string
    message: string
  }
  notarization: {
    configured: boolean
    keychainProfile?: string
    scriptName?: string
    message: string
  }
  signing: {
    configured: boolean
    identity?: string
    message: string
  }
  releaseSteps: string[]
}

export interface ProductOperationsStatus {
  generatedAt: string
  updateChannel: ProductUpdateChannel
  overallStatus: ProductOperationStatus
  app: {
    name: string
    version: string
    isPackaged: boolean
    appPath: string
    userDataPath: string
  }
  system: {
    platform: string
    arch: string
    osRelease: string
  }
  bridgeHealth: ProductBridgeHealthRecord[]
  installRepair: ProductInstallRepairStatus
  releaseAutomation: ProductReleaseAutomationStatus
  recentCrashes: ProductCrashRecord[]
  counts: {
    workspaces: number
    chats: number
    queuedRuns: number
    activeRuns: number
    interruptedRuns: number
    approvalLedgerRecords: number
    workspaceChangeSets: number
    scheduledTasks: number
    runtimeProfiles?: number
    handoffCards?: number
  }
}

export interface ProductDiagnosticsSnapshot {
  schemaVersion: 1
  generatedAt: string
  status: ProductOperationsStatus
  settings: {
    activeProvider?: ProviderId
    updateChannel: ProductUpdateChannel
    storeLocalChatHistory: boolean
    storeRawEvents: boolean
    agenticServices: AgenticServicesSettings
    geminiMcpBridgeEnabled: boolean
    codexSandboxFallback: CodexSandboxFallbackMode
  }
  workspaces: Array<
    Pick<WorkspaceRecord, 'id' | 'path' | 'displayName' | 'lastOpenedAt' | 'pinned'>
  >
  runQueue: RunQueueJob[]
  runRecovery: RunRecoveryRecord[]
  scheduledTasks: ScheduledTask[]
  approvalLedger: ApprovalLedgerRecord[]
  workspaceChanges: WorkspaceChangeSet[]
  recentCrashes: ProductCrashRecord[]
}

export interface ProductDiagnosticsExportResult {
  ok: boolean
  path?: string
  snapshot?: ProductDiagnosticsSnapshot
  error?: string
}

export interface GeminiWorktreeConfig {
  enabled: boolean
  name?: string
  effectivePath?: string
}

export type GeminiWorktreeLaunchOption = GeminiWorktreeConfig | string | boolean | null | undefined

export interface WorkspaceRecord {
  id: string
  path: string
  displayName: string
  lastOpenedAt: number
  createdAt: number
  isGitRepo?: boolean
  branch?: string
  remoteOriginUrl?: string
  geminiWorktree?: GeminiWorktreeConfig
  pinned: boolean
  lastActiveChatId?: string
  notes?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool' | 'error'
  content: string
  timestamp: string
  runId?: string
  toolActivities?: ToolActivity[]
  /** Phase F2: structured metadata for synthetic messages. The most
   * common case is a sub-thread result-return entry: the parent
   * transcript shows "↩ Result from <Provider>" with the sub-thread's
   * final assistant message inlined as untrusted tool output; metadata lets the renderer
   * detect and treat it differently from a regular tool activity
   * (link back to the sub-thread, distinct visual treatment, etc.). */
  metadata?: {
    kind?: 'subThreadReturn' | 'subThreadDelegation' | string
    /** Sub-thread id for `kind: 'subThreadReturn' | 'subThreadDelegation'`. */
    subThreadId?: string
    /** Sub-thread's provider for badge/icon rendering. */
    subThreadProvider?: ProviderId
    /** Sub-thread title at time of delegation/return for the inline
     * card header (may differ from current title if user renamed). */
    subThreadTitle?: string
    /** Phase I3.2 — parent provider at delegation time, used by the
     * inline delegation card to render the cross-provider arc. */
    parentProvider?: ProviderId
    /** Phase I3.2 — full delegation prompt (kept for click-through). */
    delegationPrompt?: string
    /** Phase I3.2 — truncated delegation prompt (140-240 chars) for the
     * card preview area. */
    delegationPromptPreview?: string
    /** Phase I3.2 — whether the sub-thread is configured to return its
     * result to the parent transcript. */
    returnResultToParent?: boolean
    [key: string]: unknown
  }
}

export interface ChatRun {
  runId: string
  provider?: ProviderId
  providerRunId?: string
  providerThreadId?: string
  providerMetadata?: Record<string, unknown>
  startedAt: string
  endedAt?: string
  promptMessageId?: string
  requestedModel?: string
  actualModel?: string
  approvalMode?: string
  status?: string // RunStatus
  warnings?: RunWarning[]
  exitCode?: number
  cancelled?: boolean
  stats?: any
  geminiWorktree?: GeminiWorktreeConfig
  effectiveWorkspacePath?: string
  diffUnavailableReason?: string
  rawEventsFile?: string
  diffSnapshot?: string
  runDiff?: RunDiffResult
  /**
   * 1.0.6-TV7 — per-WRITE-workspace file-change summaries for this run,
   * keyed by absolute workspace path. Populated at run end from the
   * run's tool-reported diffs (the same source that drives the WRITE
   * workspace rows + the "this run" summary view), so multi-workspace
   * runs are reviewable per workspace in Diff Studio (TV8). `runDiff`
   * stays the authoritative snapshot diff for the PRIMARY workspace;
   * this is additive and best-effort (absent when no WRITE workspace
   * changed). A snapshot-based RunDiffResult per path is a future
   * upgrade gated on main-process external-path snapshot support.
   */
  runDiffByPath?: Record<string, DiffFileSummary[]>
  workspaceChangeSetId?: string
  preSnapshot?: WorkspaceSnapshot
  postSnapshot?: WorkspaceSnapshot
  runtimeProfileId?: string
  geminiAuthProfileId?: string | null
  handoffSourceRunId?: string
  ensembleRoundId?: string
  ensembleParticipantId?: string
  ensembleRole?: string
  ensembleOrder?: number
  ensembleSleepWakeupId?: string
  ensembleSleepUntil?: string
  ensembleSleepReason?: string
  ensembleSleepResumeWarning?: string
}

export interface ChatRecord {
  appChatId: string
  scope?: ChatScope
  chatKind?: ChatKind
  provider?: ProviderId
  title: string
  workspaceId?: string
  workspacePath?: string
  createdAt: number
  updatedAt: number
  archived: boolean
  /** When true the chat is rendered in the sidebar's "Pinned" section
   * and excluded from "Recents". Default false. Persisted via the
   * existing `save-chat` IPC. */
  pinned?: boolean
  linkedProviderSessionId?: string
  providerMetadata?: Record<string, unknown>
  linkedGeminiSessionId?: string
  ensemble?: EnsembleConfig
  /**
   * 1.0.5-C3 — Permission envelope for this chat, when it was
   * spawned as a sub-thread (`parentChatId` is set). Stays
   * undefined for top-level chats. Enforced on every tool /
   * file / network action the child takes; the actor chain
   * traces back via `parentEnvelopeId` to the root delegator.
   */
  permissionEnvelope?: PermissionEnvelope
  /**
   * 1.0.5-EW37 — Solo-chat wakeup records. Mirror of
   * `ensemble.wakeups` for solo chats: the agent calls
   * `schedule_wakeup`, we persist the record here, and on fire the
   * `SoloChatWakeupService` dispatches a continuation prompt
   * against this chat using its existing
   * `linkedProviderSessionId`. Only populated for chats where
   * `chatKind !== 'ensemble'` (ensemble chats use the path under
   * `ensemble.wakeups`).
   *
   * Keyed by `wakeupId` so the recovery classifier on app boot
   * can iterate across all chats uniformly without caring whether
   * the source was ensemble or solo.
   */
  soloWakeups?: Record<string, SoloChatWakeupRecord>
  requestedModel?: string
  lastActualModel?: string
  messages: ChatMessage[]
  runs: ChatRun[]
  settingsSnapshot?: {
    model: string
    approvalMode: string
    sandboxEnabled: boolean
  }
  /** Phase F1 — Multi-Provider Sub-Threads. When set, this chat was
   * spawned as a sub-thread of `parentChatId`. The parent and child
   * are context-isolated (each has its own provider session, message
   * history, and run state) but topologically linked so the sidebar
   * can show parent-child nesting and the user can navigate between
   * them. Sub-threads inherit the parent's workspaceId/workspacePath
   * by default but can pick a different provider — that's the entire
   * point of the feature: hand off CLI work to Codex while Claude
   * runs the parent plan, etc.
   *
   * v1 constraint: max depth 1. A sub-thread cannot itself spawn a
   * sub-thread (UI affordance disabled when `parentChatId` is set).
   * Future revs can lift this. */
  parentChatId?: string
  /** Phase F1 — delegation metadata, present only when `parentChatId`
   * is set. Records WHY this sub-thread exists so the audit trail +
   * future auto-orchestration can reconstruct intent. */
  delegationContext?: {
    /** When the delegation was created (ms since epoch). */
    createdAt: number
    /** Provider running the parent thread at the moment of delegation
     * — preserved even if the parent later switches provider. */
    parentProvider: ProviderId
    /** The user-supplied (or future: auto-generated) delegation
     * prompt that primes the sub-thread's first turn. Persisted for
     * the parent-thread "↪ Delegated to X" surface to show. */
    delegationPrompt: string
    /** Whether the user asked for the sub-thread's final assistant
     * message to be auto-propagated back to the parent transcript
     * when the sub-thread completes. v1 records the flag but does
     * NOT auto-propagate yet (manual navigation only); F2 will wire
     * the back-propagation. */
    returnResultToParent: boolean
    /** Last time a sub-thread assistant result was returned to the parent (F2+). */
    resultReturnedAt?: number
    /** Populated when the agent-driven dispatch that should have
     * started this sub-thread's first run failed before the adapter
     * was reached (null `runCoordinatorRef`, thrown `dispatch`, etc.).
     * The sub-thread record exists (the user can still see + open it
     * in the sidebar) but `runs` will stay empty until the user kicks
     * off a manual run. The renderer surfaces this so the parent's
     * delegation card no longer hangs on "Pending" forever — it flips
     * to a "Failed to dispatch" state with the message below. */
    dispatchError?: {
      /** ms since epoch when the failure was observed. */
      at: number
      /** Short user-readable failure message — already sanitized for
       * display, no stack traces. */
      message: string
    }
  }
}

export type RunEventKind =
  | 'provider_raw'
  | 'provider_error'
  | 'provider_exit'
  | 'timeline'
  | 'delegation'
  | 'tool'
  | 'approval_request'
  | 'approval_response'
  | 'approval_timer_armed'
  | 'approval_timer_timeout'
  | 'subthread_spawned'
  | 'subthread_returned'
  | 'subthread_dispatch_failed'
  | 'subthread_autoresume_dispatched'
  | 'diff'
  | 'final_message'
  | 'lifecycle'

export type RunEventPhase = 'raw' | 'normalized' | 'control' | 'artifact'

export type RunEventArtifactKind =
  | 'stdin'
  | 'stdout'
  | 'stderr'
  | 'file'
  | 'snapshot'
  | 'diff'
  | 'other'

export interface RunEventArtifactRef {
  id: string
  kind: RunEventArtifactKind
  path: string
  sha256: string
  sizeBytes: number
  sequence?: number
  metadata?: Record<string, unknown>
}

export interface RunEventRecord {
  schemaVersion: 1
  id: string
  sequence: number
  previousHash?: string
  hash?: string
  runId: string
  chatId?: string
  workspaceId?: string
  workspacePath?: string
  provider?: ProviderId
  providerSessionId?: string
  providerRunId?: string
  spanId?: string
  parentSpanId?: string
  toolCallId?: string
  kind: RunEventKind
  phase: RunEventPhase
  source: 'main' | 'renderer' | 'provider' | 'replay'
  timestamp: string
  summary?: string
  payload?: unknown
  artifacts?: RunEventArtifactRef[]
}

export type AgentActivityKind =
  | 'root'
  | 'subagent'
  | 'fork'
  | 'handoff'
  | 'tool'
  | 'approval'
  | 'artifact'
  | 'progress'

export type AgentActivityStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'unknown'

export interface AgentActivity {
  activityId: string
  parentActivityId?: string
  runId?: string
  turnId?: string
  provider?: ProviderId
  providerThreadId?: string
  providerAgentId?: string
  parentToolCallId?: string
  kind: AgentActivityKind
  name: string
  model?: string
  status: AgentActivityStatus
  promptPreview?: string
  summary?: string
  toolPolicy?: string
  mcpPolicy?: string
  approvalMode?: string
  filesTouched?: string[]
  tokenUsage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
  rawEventRefs?: Array<{
    sequence?: number
    hash?: string
    toolCallId?: string
    spanId?: string
  }>
}

export type RunEventInput = Omit<
  RunEventRecord,
  'schemaVersion' | 'id' | 'sequence' | 'timestamp'
> &
  Partial<Pick<RunEventRecord, 'id' | 'sequence' | 'timestamp'>>

export interface RunEventFilter {
  runId?: string
  chatId?: string
  workspaceId?: string
  provider?: ProviderId
  kinds?: RunEventKind[]
  phases?: RunEventPhase[]
  fromSequence?: number
  limit?: number
}

export interface RunEventReplay {
  runId: string
  events: RunEventRecord[]
  count: number
  lastSequence: number
  hashHead?: string
  hashChainValid: boolean
  countsByKind: Partial<Record<RunEventKind, number>>
  timeline: Array<{
    sequence: number
    timestamp: string
    kind: RunEventKind
    phase: RunEventPhase
    source: RunEventRecord['source']
    summary?: string
    spanId?: string
    parentSpanId?: string
    toolCallId?: string
    artifactIds?: string[]
    hash?: string
  }>
  startedAt?: string
  endedAt?: string
}

export type ApprovalLedgerStatus = 'pending' | 'approved' | 'denied' | 'cancelled' | 'expired'
export type ApprovalLedgerScope = 'request' | 'run' | 'session' | 'workspace'
export type ApprovalLedgerDecisionSource =
  | 'user'
  | 'policy'
  | 'workspace_grant'
  | 'session_grant'
  | 'session_yolo'
  | 'system'
export type ApprovalLedgerExpirationMode =
  | 'pending_timeout'
  | 'on_decision'
  | 'run_end'
  | 'session_end'
  | 'workspace_revocation'
  | 'none'

export interface ApprovalLedgerExpiration {
  mode: ApprovalLedgerExpirationMode
  description: string
  expiresAt?: string
  expiredAt?: string
  expiredReason?: string
}

export interface ApprovalLedgerRecord {
  schemaVersion: 1
  id: string
  approvalId: string
  provider: ProviderId
  service?: AgenticServiceId
  method: string
  title: string
  body?: string
  preview?: unknown
  params?: unknown
  actions: AgentApprovalAction[]
  status: ApprovalLedgerStatus
  requestedAt: string
  respondedAt?: string
  decision?: AgentApprovalAction | 'autoAllow' | 'autoDeny' | 'expired'
  decisionSource?: ApprovalLedgerDecisionSource
  grantedScope?: ApprovalLedgerScope
  expiration: ApprovalLedgerExpiration
  runId?: string
  chatId?: string
  workspaceId?: string
  workspacePath?: string
  providerSessionId?: string
  providerRunId?: string
  rpcId?: number | string
  metadata?: Record<string, unknown>
  /**
   * 1.0.5-C4 — Actor chain from the leaf envelope (the agent
   * that actually requested this approval) back to the root
   * delegator. Empty / undefined for top-level approvals where
   * no delegation was involved. Stamped on the row at
   * `requestedAt` time via `walkActorChain`; immutable
   * thereafter.
   */
  actorChain?: ActorChainEntry[]
}

export type ApprovalLedgerRequestInput = Omit<
  ApprovalLedgerRecord,
  | 'schemaVersion'
  | 'id'
  | 'status'
  | 'requestedAt'
  | 'respondedAt'
  | 'decision'
  | 'decisionSource'
  | 'grantedScope'
  | 'expiration'
> &
  Partial<
    Pick<
      ApprovalLedgerRecord,
      | 'id'
      | 'requestedAt'
      | 'status'
      | 'respondedAt'
      | 'decision'
      | 'decisionSource'
      | 'grantedScope'
      | 'expiration'
    >
  >

export interface ApprovalLedgerFilter {
  approvalId?: string
  runId?: string
  chatId?: string
  workspaceId?: string
  provider?: ProviderId
  service?: AgenticServiceId
  statuses?: ApprovalLedgerStatus[]
  scopes?: ApprovalLedgerScope[]
  includeExpired?: boolean
  limit?: number
}

export interface UsageRecord {
  id: string
  provider?: ProviderId
  timestamp: number
  workspaceId: string
  chatId: string
  runId: string
  usageKind?: 'run' | 'reset_hint'
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  inputTokenLimit?: number
  outputTokenLimit?: number
  totalTokenLimit?: number
  resetAt?: string
  resetText?: string
  durationMs: number
  promptText?: string
  responseText?: string
}

export type WorkspaceActivityEventKind = 'git_commit' | 'worktree_change' | 'filesystem_change'

export interface WorkspaceActivityEvent {
  timestamp: number
  kind: WorkspaceActivityEventKind
  count: number
  weight: number
}

export interface WorkspaceActivitySnapshot {
  workspacePath: string
  dayCount: number
  generatedAt: number
  source: 'git' | 'filesystem' | 'none'
  truncated: boolean
  events: WorkspaceActivityEvent[]
  stats: {
    gitRepo: boolean
    commits: number
    worktreeFiles: number
    filesystemFiles: number
    scannedFiles: number
    scanLimit: number
  }
}

export type ScheduledTaskStatus =
  | 'pending'
  | 'due'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

/**
 * 1.0.4-AT3 — discriminant for solo vs ensemble scheduled runs.
 *
 * Pre-AT3 every scheduled task was implicitly a single-provider
 * dispatch (`kind` undefined). Ensemble chats COULD be scheduled
 * (the dispatch path correctly routed via `chat.chatKind` at fire
 * time) BUT the schedule didn't snapshot the participant roster
 * / orchestration mode at schedule time. A user who scheduled a
 * 4-participant ensemble at 9am and then disabled two
 * participants at 9:30 would see only the remaining two
 * participants fire at 10am — not what they scheduled.
 *
 * `kind: 'ensemble'` plus an `ensembleSnapshot` locks in the
 * panel state at schedule time. The dispatcher applies the
 * snapshot to the chat's ensemble config before kicking off the
 * round so the panel composition matches the user's intent.
 *
 * Undefined `kind` reads as `'single'` so existing scheduled
 * records (and the solo-chat scheduling path) keep working
 * verbatim.
 */
export type ScheduledTaskKind = 'single' | 'ensemble'

/**
 * 1.0.4-AT3 — snapshot of the ensemble state captured when the
 * user clicked Schedule. Applied to the chat's ensemble config
 * before the round fires so subsequent roster/mode edits don't
 * change what the user scheduled. Participants are stored in
 * full (not just ids) so we can rehydrate a disabled-since
 * participant if the chat's live record was mutated.
 *
 * `EnsembleOrchestrationMode` and `EnsembleParticipant` are
 * imported below; we reference them via `import type` to avoid
 * a runtime circular.
 */
export interface ScheduledEnsembleSnapshot {
  orchestrationMode: EnsembleOrchestrationMode
  participants: EnsembleParticipant[]
  /** Direct-message target participant id, when scheduled with
   * Cmd/Ctrl-Send while a chip was selected. */
  dmTargetParticipantId?: string
  maxParticipants?: number
  maxContinuationHops?: number
  /** Snapshot ISO timestamp — purely informational, so the user
   * can compare "scheduled with this roster at X" vs the chat's
   * current ensemble config at fire time. */
  capturedAt: string
}

export interface ScheduledTask {
  id: string
  workspaceId: string
  workspacePath: string
  chatId: string
  provider: ProviderId
  prompt: string
  displayPrompt?: string
  selectedModelType: string
  customModel: string
  approvalMode: string
  sessionTrust: boolean
  imageAttachments: Array<{
    id: string
    path: string
    name: string
  }>
  externalPathGrants?: ExternalPathGrant[]
  geminiWorktree?: GeminiWorktreeConfig
  codexReasoningEffort?: string | null
  codexServiceTier?: string | null
  claudeFastMode?: boolean | null
  kimiThinkingEnabled?: boolean
  runtimeProfileId?: string
  geminiAuthProfileId?: string | null
  handoffSourceRunId?: string
  runAt: string
  timezone: string
  status: ScheduledTaskStatus
  createdAt: string
  updatedAt: string
  firedAt?: string
  completedAt?: string
  lastError?: string
  /** 1.0.4-AT3 — discriminant. Undefined == legacy single-provider. */
  kind?: ScheduledTaskKind
  /** 1.0.4-AT3 — required when `kind === 'ensemble'`. Applied to
   * the chat's ensemble config at fire time so roster/mode edits
   * after scheduling don't reshape the dispatch. */
  ensembleSnapshot?: ScheduledEnsembleSnapshot
}

export type RunQueueJobStatus =
  | 'queued'
  | 'starting'
  | 'active'
  | 'paused'
  | 'cancelling'
  | 'cancelled'
  | 'failed'
  | 'completed'

export type RunQueueJobSource =
  | 'manual'
  | 'scheduled'
  | 'retry'
  | 'permission_retry'
  | 'review'
  | 'host_rerun'
  | 'system'

export interface RunQueueImageAttachmentSnapshot {
  id?: string
  path: string
  name?: string
}

export interface RunQueueRequestSnapshot {
  scope?: ChatScope
  prompt: string
  displayPrompt?: string
  selectedModelType: string
  customModel: string
  approvalMode: string
  sessionTrust: boolean
  imageAttachments: RunQueueImageAttachmentSnapshot[]
  externalPathGrants?: ExternalPathGrant[]
  geminiWorktree?: GeminiWorktreeConfig
  codexNativeReview?: boolean
  codexReasoningEffort?: string | null
  codexServiceTier?: string | null
  claudeFastMode?: boolean | null
  kimiThinkingEnabled?: boolean
  scheduledTaskId?: string
  preserveComposer?: boolean
  runtimeProfileId?: string
  geminiAuthProfileId?: string | null
  handoffSourceRunId?: string
}

export type RunRecoveryProcessAction = 'left_running' | 'not_found' | 'inaccessible' | 'unknown'

export interface RunRecoveryProcessSnapshot {
  pid: number
  checkedAt: string
  alive: boolean
  command?: string
  errorCode?: string
  errorMessage?: string
  detection: 'pid_signal' | 'pid_signal_and_ps'
  action: RunRecoveryProcessAction
}

export interface RunQueueJob {
  id: string
  runId: string
  provider: ProviderId
  scope?: ChatScope
  workspaceId?: string
  workspacePath?: string
  chatId?: string
  source: RunQueueJobSource
  status: RunQueueJobStatus
  priority: number
  attempt: number
  promptPreview?: string
  request?: RunQueueRequestSnapshot
  providerSessionId?: string
  providerRunId?: string
  processPid?: number
  processStartedAt?: string
  processCommand?: string
  runtimeProfileId?: string
  handoffSourceRunId?: string
  orphanProcess?: RunRecoveryProcessSnapshot
  parentRunId?: string
  createdAt: string
  updatedAt: string
  enqueuedAt?: string
  startedAt?: string
  pausedAt?: string
  endedAt?: string
  cancelledAt?: string
  failedAt?: string
  completedAt?: string
  interruptedAt?: string
  recoveredAt?: string
  statusReason?: string
  lastError?: string
  recoveryReason?: string
  resumeAvailable?: boolean
  resumeHint?: string
}

export interface RunQueueJobFilter {
  workspaceId?: string
  chatId?: string
  provider?: ProviderId
  statuses?: RunQueueJobStatus[]
  includeTerminal?: boolean
}

export type RunRecoveryAction =
  | 'marked_failed'
  | 'marked_failed_orphan_detected'
  | 'cleared_stale_process'
  | 'cleared_stale_orphan_process'

export interface RunRecoveryRecord {
  schemaVersion: 1
  id: string
  runId: string
  jobId: string
  provider: ProviderId
  chatId?: string
  workspaceId?: string
  workspacePath?: string
  previousStatus: RunQueueJobStatus
  recoveredStatus: RunQueueJobStatus
  action: RunRecoveryAction
  reason: string
  recoveredAt: string
  process?: RunRecoveryProcessSnapshot
  resumeAvailable: boolean
  resumeHint: string
  jobSnapshot: {
    providerSessionId?: string
    providerRunId?: string
    promptPreview?: string
    startedAt?: string
    updatedAt?: string
    processPid?: number
    processStartedAt?: string
    processCommand?: string
  }
}

export interface RunRecoveryFilter {
  runId?: string
  chatId?: string
  workspaceId?: string
  provider?: ProviderId
  actions?: RunRecoveryAction[]
  onlyOrphans?: boolean
  limit?: number
}

export type RunStatus =
  | 'success'
  | 'success_with_warnings'
  | 'failed'
  | 'cancelled'
  | 'running'
  | 'sleeping'

export interface RunWarning {
  message: string
  timestamp: string
}

export type ToolActivityStatus = 'pending' | 'running' | 'success' | 'warning' | 'error'

export interface ToolDiffFileSummary {
  path?: string
  status?: DiffFileStatus | 'updated' | 'unknown'
  additions?: number
  deletions?: number
}

export interface ToolDiffSummary {
  additions?: number
  deletions?: number
  files?: ToolDiffFileSummary[]
  source:
    | 'codex_changes'
    | 'patch_preview'
    | 'string_replace'
    | 'content'
    | 'result_diff'
    | 'unknown'
  confidence: 'exact' | 'estimated' | 'unknown'
}

export interface ToolActivity {
  id: string
  toolName: string
  displayName: string
  category: 'task' | 'read' | 'write' | 'search' | 'shell' | 'unknown'
  status: ToolActivityStatus
  startedAt?: string
  endedAt?: string
  durationMs?: number
  parameters?: Record<string, unknown>
  resultSummary?: string
  outputPreview?: string
  filePath?: string
  diffSummary?: ToolDiffSummary
  rawUseEvent?: unknown
  rawResultEvent?: unknown
  /** If this tool call was emitted by a sub-agent, the tool_use id of the parent Task / Agent call that spawned it. */
  parentToolCallId?: string
  /** 1.0.4-AG — optional attribution metadata. `provider` names the
   * CLI/runtime that issued the call, `ensembleProvider` names the
   * specific ensemble participant when the chat is multi-provider —
   * so the compact tool-trace render can read "Codex calls write_file"
   * vs "Claude calls Edit" distinctly during cross-provider rounds.
   * Both are optional; absent means "fall back to the chat-level
   * provider passed to ActivityStack". */
  metadata?: {
    provider?: ProviderId
    ensembleProvider?: ProviderId
  }
  // Legacy fields preserved for backward compatibility
  affectedFilePath?: string
  operationCategory?: 'update_topic' | 'read_file' | 'edit_file' | 'search' | 'shell' | 'unknown'
  outputSummary?: string
  rawEventRefs?: string[]
}

export type ChildAgentKind =
  | 'claude-task'
  | 'codex-background'
  | 'kimi-swarm'
  | 'grok-agent'
  | 'cursor-agent'
  | 'gemini-subagent'
  | 'manual'
export type ChildAgentInteractivity = 'interactive' | 'oneshot' | 'observe-only'
export type ChildAgentState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface ChildAgentThread {
  id: string
  parentChatId?: string
  parentRunId?: string
  /** The tool_use id of the Task/Agent call that produced this thread (when applicable). */
  parentToolCallId?: string
  provider: ProviderId
  kind: ChildAgentKind
  interactivity: ChildAgentInteractivity
  name: string
  role?: string
  state: ChildAgentState
  startedAt?: string
  endedAt?: string
  durationMs?: number
  seedPrompt?: string
  finalResult?: string
  /** Tool activity ids that belong to this child thread. */
  toolActivityIds: string[]
  /** Visual identity (display name + color) assigned by `assignAgentIdentity`.
   * For Codex this may carry a platform-extracted name; for other providers it
   * comes from our bespoke nickname pool. Persisted to
   * `ChatRecord.providerMetadata.agentIdentities` so the same thread keeps the
   * same identity across renders and app reloads. */
  identity?: AgentIdentity
}

/** Source of a subagent's display identity. */
export type AgentIdentitySource = 'pool' | 'platform' | 'manual'

/** Visual identity for a single sub-agent. Indexed by `ChildAgentThread.id`
 * inside `ChatRecord.providerMetadata.agentIdentities`. */
export interface AgentIdentity {
  agentId: string
  /** Display name shown in chips, cards, panels. */
  name: string
  /** Accent color (hex). Drives chip color, card name color, dot color. */
  color: string
  /** Generated fallback-identity slug when this identity maps to a named SVG. */
  slug?: string
  /** Generated fallback-identity accent. Mirrors `color` for named SVG identities. */
  accent?: string
  /** Optional role label (e.g. "explorer", "reviewer"). */
  role?: string
  source: AgentIdentitySource
  /** ISO timestamp the identity was assigned. */
  assignedAt: string
}

export type TrustStatus = 'trusted' | 'untrusted' | 'inherited' | 'unknown' | 'not_checked'

export interface TrustStatusResult {
  status: TrustStatus
  reason?: string
  isSessionOnly?: boolean
}

/**
 * Result of a persistent workspace-trust WRITE (the one-click
 * "Trust this folder" button that writes ~/.gemini/trustedFolders.json
 * directly, replacing the broken interactive `/permissions trust`
 * terminal flow). `status` is the resulting trust state ('trusted' on
 * success); `path` is the canonical realpath that was keyed into the
 * trust file.
 */
export interface TrustWriteResult {
  ok: boolean
  status: TrustStatus
  path?: string
  reason?: string
}

export interface GeminiSessionSummary {
  id: string
  title?: string
  createdAt?: string
  updatedAt?: string
  raw?: string
}

export interface GeminiSessionListResult {
  ok: boolean
  sessions: GeminiSessionSummary[]
  rawLines: string[]
  error?: string
}

export interface WorkspaceFileEntry {
  path: string
  name: string
  isDirectory: boolean
  sizeBytes?: number
  depth: number
}

export interface WorkspaceFileReadResult {
  path: string
  content: string
  sizeBytes: number
  changeSet?: WorkspaceChangeSet
}

export type DiffFileStatus =
  | 'modified'
  | 'created'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'binary'
  | 'too_large'
  | 'hidden_sensitive'
  | 'noise'

export type DiffPreviewKind =
  | 'git_diff'
  | 'synthetic_new_file'
  | 'text_preview'
  | 'binary'
  | 'hidden'
  | 'none'

export interface DiffFileSummary {
  path: string
  status: DiffFileStatus
  additions?: number
  deletions?: number
  isBinary?: boolean
  isNoise?: boolean
  isSensitive?: boolean
  previewKind: DiffPreviewKind
  diffText?: string
  sizeBytes?: number
}

export interface WorkspaceSnapshot {
  capturedAt: string
  isGitRepo: boolean
  workspacePath?: string
  gitStatus?: string // git status --porcelain=v1 -z output
  files?: FileSnapshot[]
}

export interface FileSnapshot {
  path: string
  sizeBytes: number
  mtimeMs: number
  hash?: string
}

export interface RunDiffResult {
  runId: string
  preSnapshot: WorkspaceSnapshot
  postSnapshot?: WorkspaceSnapshot
  changeSetId?: string
  createdFiles: DiffFileSummary[]
  modifiedFiles: DiffFileSummary[]
  deletedFiles: DiffFileSummary[]
  preExistingFiles: DiffFileSummary[]
}

export type WorkspaceChangeSource =
  | 'provider_run'
  | 'editor'
  | 'host_command'
  | 'checkpoint'
  | 'worktree'
  | 'system'

export type WorkspaceChangeStatus = 'captured' | 'failed' | 'superseded'

export type WorkspaceChangeFileOrigin =
  | 'run_diff'
  | 'manual_edit'
  | 'tool_activity'
  | 'git_status'
  | 'snapshot'
  | 'pre_existing'

export type WorkspaceArtifactKind =
  | 'file'
  | 'directory'
  | 'diff'
  | 'snapshot'
  | 'checkpoint'
  | 'worktree'

export interface WorkspaceChangeFile {
  path: string
  status: DiffFileStatus
  origin: WorkspaceChangeFileOrigin
  additions?: number
  deletions?: number
  sizeBytes?: number
  isBinary?: boolean
  isNoise?: boolean
  isSensitive?: boolean
  previewKind?: DiffPreviewKind
  diffText?: string
}

export interface WorkspaceChangeArtifact {
  id: string
  kind: WorkspaceArtifactKind
  path?: string
  label?: string
  source: WorkspaceChangeSource
  sizeBytes?: number
  metadata?: Record<string, unknown>
}

export interface WorkspaceChangeWorktreeContext {
  enabled: boolean
  name?: string
  baseWorkspacePath?: string
  effectivePath?: string
}

export interface WorkspaceChangeCheckpointContext {
  enabled: boolean
  provider?: ProviderId
  checkpointId?: string
  label?: string
}

export interface WorkspaceChangeStats {
  filesCreated: number
  filesModified: number
  filesDeleted: number
  filesPreExisting: number
  artifactsGenerated: number
  additions: number
  deletions: number
}

export interface WorkspaceChangeSet {
  schemaVersion: 1
  id: string
  source: WorkspaceChangeSource
  status: WorkspaceChangeStatus
  title: string
  summary?: string
  workspaceId?: string
  workspacePath: string
  effectiveWorkspacePath?: string
  chatId?: string
  runId?: string
  provider?: ProviderId
  createdAt: string
  updatedAt: string
  preSnapshot?: WorkspaceSnapshot
  postSnapshot?: WorkspaceSnapshot
  files: WorkspaceChangeFile[]
  artifacts: WorkspaceChangeArtifact[]
  worktree?: WorkspaceChangeWorktreeContext
  checkpoint?: WorkspaceChangeCheckpointContext
  stats: WorkspaceChangeStats
  metadata?: Record<string, unknown>
}

export type WorkspaceChangeSetInput = Omit<
  WorkspaceChangeSet,
  'schemaVersion' | 'id' | 'status' | 'createdAt' | 'updatedAt' | 'stats' | 'files' | 'artifacts'
> &
  Partial<
    Pick<
      WorkspaceChangeSet,
      'id' | 'status' | 'createdAt' | 'updatedAt' | 'stats' | 'files' | 'artifacts'
    >
  >

export interface WorkspaceRunChangeInput {
  runId: string
  chatId?: string
  workspaceId?: string
  workspacePath: string
  effectiveWorkspacePath?: string
  provider?: ProviderId
  runDiff: RunDiffResult
  worktree?: WorkspaceChangeWorktreeContext
  checkpoint?: WorkspaceChangeCheckpointContext
  metadata?: Record<string, unknown>
}

export interface WorkspaceEditorChangeInput {
  workspaceId?: string
  workspacePath: string
  effectiveWorkspacePath?: string
  chatId?: string
  filePath: string
  existedBefore: boolean
  previousContent?: string
  nextContent: string
  sizeBytes?: number
  metadata?: Record<string, unknown>
}

export interface WorkspaceChangeFilter {
  workspaceId?: string
  workspacePath?: string
  chatId?: string
  runId?: string
  provider?: ProviderId
  sources?: WorkspaceChangeSource[]
  statuses?: WorkspaceChangeStatus[]
  since?: string
  limit?: number
}

export type BenchmarkArtifactKind =
  | 'stdout'
  | 'stderr'
  | 'file'
  | 'directory'
  | 'snapshot'
  | 'diff'
  | 'score'
  | 'other'

export interface BenchmarkPinnedFile {
  path: string
  sizeBytes: number
  sha256: string
  mtimeMs?: number
  mode?: number
}

export interface BenchmarkGitManifest {
  root?: string
  head?: string
  branch?: string
  dirty: boolean
  statusPorcelain?: string
  trackedFiles?: BenchmarkPinnedFile[]
}

export type BenchmarkScorerKind =
  | 'exact_match'
  | 'regex_match'
  | 'file_exists'
  | 'artifact_exists'
  | 'json_field_equals'

export interface BenchmarkScorerDefinition {
  id: string
  kind: BenchmarkScorerKind
  weight?: number
  target?: string
  expected?: unknown
  pattern?: string
  flags?: string
  path?: string
  sha256?: string
  artifactName?: string
  artifactKind?: BenchmarkArtifactKind
  metadata?: Record<string, unknown>
}

export interface BenchmarkTaskManifest {
  schemaVersion: 1
  id: string
  title: string
  prompt: string
  provider?: ProviderId
  workspacePath?: string
  inputFiles?: string[]
  expectedArtifacts?: Array<{
    name: string
    kind: BenchmarkArtifactKind
    sha256?: string
  }>
  scorers: BenchmarkScorerDefinition[]
  metadata?: Record<string, unknown>
}

export interface BenchmarkEnvironmentManifest {
  schemaVersion: 1
  capturedAt: string
  platform: NodeJS.Platform
  arch: NodeJS.Architecture
  nodeVersion: string
  appVersion?: string
  workspacePath?: string
  git?: BenchmarkGitManifest
  files: BenchmarkPinnedFile[]
  env?: Record<string, string>
}

export interface BenchmarkArtifactRecord {
  id: string
  runId: string
  kind: BenchmarkArtifactKind
  name: string
  relativePath: string
  absolutePath?: string
  sha256: string
  sizeBytes: number
  createdAt: string
  metadata?: Record<string, unknown>
}

export interface BenchmarkScoreResult {
  scorerId: string
  kind: BenchmarkScorerKind
  passed: boolean
  score: number
  maxScore: number
  message?: string
  metadata?: Record<string, unknown>
}

export interface BenchmarkEvaluationReport {
  schemaVersion: 1
  taskId: string
  evaluatedAt: string
  score: number
  maxScore: number
  passed: boolean
  results: BenchmarkScoreResult[]
}

export interface BenchmarkRunManifest {
  schemaVersion: 1
  id: string
  taskId: string
  runId?: string
  provider?: ProviderId
  workspacePath?: string
  createdAt: string
  taskManifestSha256: string
  environmentManifestSha256: string
  promptSha256: string
  task: BenchmarkTaskManifest
  environment: BenchmarkEnvironmentManifest
  artifacts: BenchmarkArtifactRecord[]
  evaluation?: BenchmarkEvaluationReport
  metadata?: Record<string, unknown>
}
