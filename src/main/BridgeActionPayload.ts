/**
 * BridgeActionPayload — typed schema for the bytes inside `bridge.requestActionAck`.
 *
 * Today's wire format (Phase C-late slice 1):
 *   - iOS device serializes a `BridgeActionPayload` as UTF-8 JSON.
 *   - Swift bridge daemon base64-encodes those bytes in
 *     `bridge.requestActionAck`'s `payloadBase64` field.
 *   - Electron decodes base64 → UTF-8 → JSON → typed payload via
 *     `decodeBridgeActionPayload(...)`.
 *
 * Why typed (not opaque)?
 *   - Phase C4 gave us `RemoteWorkspaceAllowlist`, but
 *     `handleActionAck` couldn't consult it: opaque bytes carry no
 *     `workspaceId`. Every action variant in this schema embeds a
 *     `workspaceId` so the router can workspace-gate.
 *   - The Swift side stays untouched. The daemon does not decode
 *     payloads — it relays bytes. All payload-level semantics live in
 *     Electron, where RunService/ApprovalService/ChatService are.
 *   - Versioning by `kind` field rather than a top-level `v`: adding a
 *     new action variant is a new `kind`, and unknown `kind`s decode to
 *     `BridgeUnknownAction` so future iOS clients targeting newer
 *     Electron versions get a structured deny instead of a hard parse error.
 *
 * Variant catalog (covers Lunel's permissionReply + questionReply + prompt
 * model, plus cancel; matches our plan's iOS-minimal action set):
 *   - `approvalReply`    — user tapped accept/acceptForSession/decline
 *                          on a pending tool-call approval prompt.
 *   - `questionReply`    — user typed an answer to a tool-driven question.
 *   - `questionReject`   — user explicitly rejected a question without
 *                          providing an answer.
 *   - `composerPrompt`   — user sent a new message to an existing thread
 *                          via the iOS composer.
 *   - `cancelRun`        — user tapped "cancel" on an in-flight run.
 *   - `ensemble*`        — remote task-console controls for ensemble rounds,
 *                          wakeups, queued prompts, and steering.
 *
 * Workspace-bound payloads MUST carry `workspaceId`. The router relies on
 * this for allowlist evaluation; a workspace-bound payload missing it decodes
 * as `BridgeUnknownAction` (deny). Device-level system payloads such as
 * `registerApnsToken` are pair-scoped instead.
 */

export type BridgeApprovalDecision =
  | 'accept'
  | 'acceptForSession'
  | 'acceptForWorkspace'
  | 'decline'
  | 'cancel'

export interface BridgeActionMetadata {
  /** Client-generated id for stale/replay protection. Optional so older
   * companion builds keep working; when present it must be unique per pair. */
  actionId?: string
  /** Client issuance timestamp (ms since epoch). Informational for now. */
  issuedAt?: number
  /** Client expiry timestamp (ms since epoch). Router denies when stale. */
  expiresAt?: number
}

export interface BridgeApprovalReplyAction extends BridgeActionMetadata {
  kind: 'approvalReply'
  workspaceId: string
  threadId: string
  toolCallId: string
  decision: BridgeApprovalDecision
  /** Optional human-readable note (e.g. "approved from iPhone"). */
  message?: string
}

export interface BridgeQuestionReplyAction extends BridgeActionMetadata {
  kind: 'questionReply'
  workspaceId: string
  threadId: string
  promptId: string
  answer: string
}

export interface BridgeQuestionRejectAction extends BridgeActionMetadata {
  kind: 'questionReject'
  workspaceId: string
  threadId: string
  promptId: string
  /** Optional rejection reason surfaced back into the chat as a system note. */
  message?: string
}

export interface BridgeComposerPromptAction extends BridgeActionMetadata {
  kind: 'composerPrompt'
  workspaceId: string
  threadId: string
  text: string
  /** Provider id. Required so the dispatcher can route to the right
   * provider adapter without inferring from the thread. Allowlist will
   * reject if not in the workspace's allowed-providers set. */
  provider: string
  /** Optional approval-mode override; allowlist will reject if not allowed. */
  approvalMode?: string
  /** Optional model override (provider-specific). */
  model?: string
  /** Optional context-turn count (0–20 per the plan's standard payload). */
  contextTurns?: number
  /** Phone-attached images (downscaled JPEG/PNG, base64). The executor
   * writes them to temp files and forwards as AgentRunPayload.imagePaths
   * — the same attachment lane the desktop composer uses. Capped at 2
   * images / ~900KB combined base64 to respect the relay frame budget. */
  imageAttachments?: BridgeImageAttachment[]
  /** Additional allowlisted workspaces granted to this run (the desktop's
   * secondary-workspace picker). The executor validates each against the
   * allowlist and resolves them to AgentRunPayload.externalPathGrants. */
  extraWorkspaceIds?: string[]
}

export interface BridgeImageAttachment {
  /** Display name, e.g. "IMG_0123.jpg". */
  name?: string
  mimeType: string
  dataBase64: string
}

/** On-demand bounded transcript window for one thread. The phone sends
 * this when opening a chat outside the recent-N snapshot window (the
 * periodic snapshot only ships threadSnapshots for the most-recent few —
 * relay frame budget). Gated by the `monitor` capability. */
export interface BridgeThreadSnapshotRequestAction extends BridgeActionMetadata {
  kind: 'threadSnapshotRequest'
  workspaceId: string
  threadId: string
  /** Requested row-window size; the executor clamps to 1–100 (default 40). */
  limit?: number
}

/** Expand one clipped transcript row to (near) full text. Read-only —
 * the ack returns the re-projected row; nothing is broadcast. */
export interface BridgeThreadRowExpandAction extends BridgeActionMetadata {
  kind: 'threadRowExpand'
  workspaceId: string
  threadId: string
  /** Desktop `message.id` for the row to expand. */
  rowId: string
  /** Preview char ceiling (executor clamps 400–32000, default 32000). */
  maxChars?: number
}

/** Create an empty chat thread without starting a run. Used by the iOS
 * "New chat / New ensemble / New global" flows so the phone can land on
 * a welcome surface before the first prompt. */
export interface BridgeCreateThreadParticipant {
  provider: string
  /** Provider-specific model id ('cli-default' when omitted). */
  model?: string
  /** Role label; defaults to the Mac's default role for that provider. */
  role?: string
}

export interface BridgeCreateThreadAction extends BridgeActionMetadata {
  kind: 'createThread'
  workspaceId: string
  variant: 'workspace' | 'ensemble' | 'global'
  /** Optional client-minted id (e.g. `ios-<uuid>`). When omitted the Mac
   * generates one. */
  threadId?: string
  /** Solo-chat provider when `variant` is `workspace`. */
  provider?: string
  /** Optional display title seed. */
  title?: string
  /** Ensemble roster override (variant 'ensemble'), in speaking order.
   * Omitted → the Mac's default roster. Capped at 12 (the panel ceiling);
   * role/instructions default per provider from the Mac's role seeds. */
  participants?: BridgeCreateThreadParticipant[]
}

export interface BridgeRegisterApnsTokenAction extends BridgeActionMetadata {
  kind: 'registerApnsToken'
  /** Pair identifier this device token belongs to. iOS knows it from the
   * completed pairing exchange. */
  pairID: string
  /** Apple-issued push token (hex string). Rotates routinely per OS
   * behavior; iOS re-registers on each new token. */
  deviceToken: string
  /** Targeted APNs gateway. `sandbox` for TestFlight / dev builds,
   * `production` for App Store builds. The desktop uses this to pick
   * the right gateway when sending pushes. */
  env: 'production' | 'sandbox'
}

export interface BridgeCancelRunAction extends BridgeActionMetadata {
  kind: 'cancelRun'
  workspaceId: string
  threadId: string
  /** Provider id (e.g. `'gemini'`, `'codex'`, `'claude'`, `'kimi'`). Required
   * so the executor can route to the right provider adapter without
   * scanning all of them. iOS knows the provider because it received it
   * with the run record. */
  provider: string
  runId: string
  /** Optional rationale; surfaces in audit logs. */
  message?: string
}

export interface BridgeEnsembleCancelRoundAction extends BridgeActionMetadata {
  kind: 'ensembleCancelRound'
  workspaceId: string
  threadId: string
  roundId?: string
  message?: string
}

export interface BridgeEnsembleSkipActiveParticipantAction extends BridgeActionMetadata {
  kind: 'ensembleSkipActiveParticipant'
  workspaceId: string
  threadId: string
  roundId?: string
  participantId?: string
  message?: string
}

export interface BridgeEnsembleWakeNowAction extends BridgeActionMetadata {
  kind: 'ensembleWakeNow'
  workspaceId: string
  threadId: string
  wakeupId: string
  message?: string
}

export interface BridgeEnsembleCancelWakeupAction extends BridgeActionMetadata {
  kind: 'ensembleCancelWakeup'
  workspaceId: string
  threadId: string
  wakeupId: string
  message?: string
}

export interface BridgeEnsembleQueuePromptAction extends BridgeActionMetadata {
  kind: 'ensembleQueuePrompt'
  workspaceId: string
  threadId: string
  roundId?: string
  text: string
  message?: string
}

/** One desired roster entry for ensembleRosterUpdate. Array order IS the
 * speaking order. `id` matches an existing participant (preserving its
 * runtime profile / permission / session fields); absent or unknown ids
 * mint a new participant seeded from the Mac's same-provider defaults. */
export interface BridgeRosterParticipant {
  id?: string
  provider: string
  model?: string
  role?: string
  /** Goal/brief — maps to the participant's instructions. */
  brief?: string
  enabled?: boolean
}

export interface BridgeSetThreadNotesAction extends BridgeActionMetadata {
  kind: 'setThreadNotes'
  workspaceId: string
  threadId: string
  /** Markdown thread notes; empty string clears. */
  notes: string
}

export interface BridgeToggleMessagePinAction extends BridgeActionMetadata {
  kind: 'toggleMessagePin'
  workspaceId: string
  threadId: string
  messageId: string
  pinned: boolean
}

export interface BridgeEnsembleQueueItemAction extends BridgeActionMetadata {
  kind: 'ensembleQueueItem'
  workspaceId: string
  threadId: string
  /** Index into the COMBINED queue (legacy slot first, then the array). */
  index: number
  /** Optional race guard — first chars of the expected text; the executor
   * rejects if the item at `index` no longer starts with it. */
  textPrefix?: string
  op: 'steerNow' | 'remove'
}

export interface BridgeEnsembleRosterUpdateAction extends BridgeActionMetadata {
  kind: 'ensembleRosterUpdate'
  workspaceId: string
  threadId: string
  participants: BridgeRosterParticipant[]
}

export interface BridgeEnsembleSteerAction extends BridgeActionMetadata {
  kind: 'ensembleSteer'
  workspaceId: string
  threadId: string
  roundId?: string
  text: string
  message?: string
  /** Phone-attached images — same shape/caps as composerPrompt's. */
  imageAttachments?: BridgeImageAttachment[]
}

export interface BridgeSetYoloModeAction extends BridgeActionMetadata {
  kind: 'setYoloMode'
  /** Used to gate this process-wide escalation through the remote
   * workspace allowlist. */
  workspaceId: string
  enabled: boolean
}

export interface BridgeTogglePinChatAction extends BridgeActionMetadata {
  kind: 'togglePinChat'
  workspaceId: string
  appChatId: string
  pinned: boolean
}

export interface BridgeTogglePinWorkspaceAction extends BridgeActionMetadata {
  kind: 'togglePinWorkspace'
  workspaceId: string
  pinned: boolean
}

/** Fallback for any unrecognized `kind`. The router treats this as a
 * structured deny (no execution) but logs the original kind so we can
 * monitor schema drift between iOS and Electron versions. */
export interface BridgeUnknownAction {
  kind: 'unknown'
  /** Best-effort echo of whatever `kind` value arrived on the wire. */
  rawKind: string
  /** The original parsed object (after JSON parse but before type-gate). */
  raw: unknown
}

export type BridgeActionPayload =
  | BridgeApprovalReplyAction
  | BridgeQuestionReplyAction
  | BridgeQuestionRejectAction
  | BridgeComposerPromptAction
  | BridgeCreateThreadAction
  | BridgeThreadRowExpandAction
  | BridgeThreadSnapshotRequestAction
  | BridgeCancelRunAction
  | BridgeEnsembleCancelRoundAction
  | BridgeEnsembleSkipActiveParticipantAction
  | BridgeEnsembleWakeNowAction
  | BridgeEnsembleCancelWakeupAction
  | BridgeEnsembleQueuePromptAction
  | BridgeEnsembleSteerAction
  | BridgeEnsembleRosterUpdateAction
  | BridgeEnsembleQueueItemAction
  | BridgeSetThreadNotesAction
  | BridgeToggleMessagePinAction
  | BridgeRegisterApnsTokenAction
  | BridgeSetYoloModeAction
  | BridgeTogglePinChatAction
  | BridgeTogglePinWorkspaceAction
  | BridgeUnknownAction

export interface DecodedActionPayload {
  payload: BridgeActionPayload
  /** Original raw JSON object (for diagnostics). */
  rawJson: unknown
}

/** Sentinel error type so callers (router) can distinguish decoder failure
 * from policy denial. */
export class BridgeActionPayloadDecodeError extends Error {
  readonly stage: 'base64' | 'utf8' | 'json' | 'shape'
  constructor(stage: BridgeActionPayloadDecodeError['stage'], message: string) {
    super(message)
    this.name = 'BridgeActionPayloadDecodeError'
    this.stage = stage
  }
}

/** Decode a base64-encoded UTF-8 JSON payload into a typed action.
 * Throws `BridgeActionPayloadDecodeError` on each failure stage so the
 * router can return a tailored deny reason ("malformed base64",
 * "malformed JSON", etc.). */
export function decodeBridgeActionPayload(payloadBase64: string): DecodedActionPayload {
  let bytes: Buffer
  try {
    bytes = Buffer.from(payloadBase64, 'base64')
  } catch (err) {
    throw new BridgeActionPayloadDecodeError(
      'base64',
      `Failed to base64-decode payload: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  if (bytes.length === 0) {
    throw new BridgeActionPayloadDecodeError('base64', 'Payload is empty after base64 decode')
  }
  // Buffer.from('garbage!', 'base64') silently produces partial bytes — re-encoding
  // and checking for a mismatch catches obviously-non-base64 inputs. We compare
  // canonical forms (strip padding) since Buffer's output is always padded.
  const reencoded = bytes.toString('base64')
  const canonInput = payloadBase64.replace(/=+$/, '')
  const canonReencoded = reencoded.replace(/=+$/, '')
  if (canonInput !== canonReencoded) {
    throw new BridgeActionPayloadDecodeError(
      'base64',
      'Payload base64 does not round-trip — likely corrupted on the wire'
    )
  }

  let text: string
  try {
    text = bytes.toString('utf-8')
  } catch (err) {
    throw new BridgeActionPayloadDecodeError(
      'utf8',
      `Failed UTF-8 decode: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new BridgeActionPayloadDecodeError(
      'json',
      `Malformed JSON in payload: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const payload = coerceToPayload(parsed)
  return { payload, rawJson: parsed }
}

/** Extract the workspace id from a payload variant for allowlist lookups.
 * Returns null for `unknown` actions (so callers can deny with
 * "unrecognized action") and for non-workspace-bound variants like
 * `registerApnsToken` (which are paired-device-level, not workspace-level).
 * Combine with `payloadRequiresWorkspaceGating` to decide whether a null
 * workspaceId is a legitimate skip or a malformed payload. */
export function workspaceIdFromPayload(payload: BridgeActionPayload): string | null {
  switch (payload.kind) {
    case 'approvalReply':
    case 'questionReply':
    case 'questionReject':
    case 'composerPrompt':
    case 'createThread':
    case 'threadRowExpand':
    case 'threadSnapshotRequest':
    case 'cancelRun':
    case 'ensembleCancelRound':
    case 'ensembleSkipActiveParticipant':
    case 'ensembleWakeNow':
    case 'ensembleCancelWakeup':
    case 'ensembleQueuePrompt':
    case 'ensembleSteer':
    case 'ensembleRosterUpdate':
    case 'ensembleQueueItem':
    case 'setThreadNotes':
    case 'toggleMessagePin':
    case 'setYoloMode':
    case 'togglePinChat':
    case 'togglePinWorkspace':
      return payload.workspaceId
    case 'registerApnsToken':
    case 'unknown':
      return null
  }
}

export function actionIdFromPayload(payload: BridgeActionPayload): string | null {
  if (payload.kind === 'unknown') return null
  return payload.actionId ?? null
}

export function expiresAtFromPayload(payload: BridgeActionPayload): number | null {
  if (payload.kind === 'unknown') return null
  return payload.expiresAt ?? null
}

/** Whether a payload variant must pass the workspace-allowlist gate.
 * Most action kinds are workspace-bound; `registerApnsToken` is a
 * paired-device-level system action and bypasses (the pair gate at the
 * QUIC layer is the only authentication needed). */
export function payloadRequiresWorkspaceGating(payload: BridgeActionPayload): boolean {
  switch (payload.kind) {
    case 'approvalReply':
    case 'questionReply':
    case 'questionReject':
    case 'composerPrompt':
    case 'createThread':
    case 'threadRowExpand':
    case 'threadSnapshotRequest':
    case 'cancelRun':
    case 'ensembleCancelRound':
    case 'ensembleSkipActiveParticipant':
    case 'ensembleWakeNow':
    case 'ensembleCancelWakeup':
    case 'ensembleQueuePrompt':
    case 'ensembleSteer':
    case 'ensembleRosterUpdate':
    case 'ensembleQueueItem':
    case 'setThreadNotes':
    case 'toggleMessagePin':
    case 'setYoloMode':
    case 'togglePinChat':
    case 'togglePinWorkspace':
      return true
    case 'registerApnsToken':
      return false
    case 'unknown':
      // Unknown variants are rejected upstream; the gating question
      // doesn't apply. Return true so a stray unknown-with-workspaceId
      // still gets routed through the workspace path defensively.
      return true
  }
}

/** Legacy coarse classification for compatibility tests and older call sites.
 * The router now uses fine-grained allowlist capabilities, but this remains
 * useful for documenting which payloads mutate desktop-side state (kick off a
 * new run, cancel an in-flight one, inject input into an agent). The
 * non-mutating set — approvalReply, questionReject — is iOS responding to
 * desktop-initiated prompts.
 *
 * Notes on individual variants:
 *   - `approvalReply`: responding to an approval prompt the DESKTOP
 *     already surfaced. The decision itself doesn't initiate new work;
 *     it lets an already-pending tool call proceed. Allowed in read-only.
 *   - `questionReject`: declining to provide input. Strictly less
 *     mutating than answering. Allowed in read-only.
 *   - `questionReply`: provides TYPED INPUT to an in-flight agent. This
 *     is real data flowing into the workspace's state. Blocked in
 *     read-only.
 *   - `composerPrompt`: initiates a new turn. Clearly mutating.
 *   - `cancelRun`: terminates an in-flight run. Read-only blocks; the
 *     desktop user still has full control. (We might revisit this if
 *     "safety cancel from phone" becomes a desired feature, but the
 *     conservative read-only semantic is to deny.)
 *   - `registerApnsToken`: never reaches this check — it bypasses
 *     workspace gating entirely via `payloadRequiresWorkspaceGating`.
 *   - `unknown`: classify defensively as mutating so a forward-compat
 *     unknown action can't sneak past read-only gating.
 */
export function payloadIsMutating(payload: BridgeActionPayload): boolean {
  switch (payload.kind) {
    case 'composerPrompt':
    case 'createThread':
    case 'cancelRun':
    case 'questionReply':
    case 'ensembleCancelRound':
    case 'ensembleSkipActiveParticipant':
    case 'ensembleWakeNow':
    case 'ensembleCancelWakeup':
    case 'ensembleQueuePrompt':
    case 'ensembleSteer':
    case 'ensembleRosterUpdate':
    case 'ensembleQueueItem':
    case 'setThreadNotes':
    case 'toggleMessagePin':
    case 'setYoloMode':
    case 'togglePinChat':
    case 'togglePinWorkspace':
      return true
    case 'approvalReply':
    case 'questionReject':
    case 'registerApnsToken':
    case 'threadSnapshotRequest':
    case 'threadRowExpand':
      return false
    case 'unknown':
      return true
  }
}

// MARK: - Shape gates

function coerceToPayload(parsed: unknown): BridgeActionPayload {
  if (!isRecord(parsed) || typeof parsed.kind !== 'string') {
    return { kind: 'unknown', rawKind: '?', raw: parsed }
  }
  switch (parsed.kind) {
    case 'approvalReply':
      return isApprovalReply(parsed)
        ? (parsed as unknown as BridgeApprovalReplyAction)
        : { kind: 'unknown', rawKind: 'approvalReply', raw: parsed }
    case 'questionReply':
      return isQuestionReply(parsed)
        ? (parsed as unknown as BridgeQuestionReplyAction)
        : { kind: 'unknown', rawKind: 'questionReply', raw: parsed }
    case 'questionReject':
      return isQuestionReject(parsed)
        ? (parsed as unknown as BridgeQuestionRejectAction)
        : { kind: 'unknown', rawKind: 'questionReject', raw: parsed }
    case 'composerPrompt':
      return isComposerPrompt(parsed)
        ? (parsed as unknown as BridgeComposerPromptAction)
        : { kind: 'unknown', rawKind: 'composerPrompt', raw: parsed }
    case 'createThread':
      return isCreateThread(parsed)
        ? (parsed as unknown as BridgeCreateThreadAction)
        : { kind: 'unknown', rawKind: 'createThread', raw: parsed }
    case 'threadRowExpand':
      return isThreadRowExpand(parsed)
        ? (parsed as unknown as BridgeThreadRowExpandAction)
        : { kind: 'unknown', rawKind: 'threadRowExpand', raw: parsed }
    case 'threadSnapshotRequest':
      return isThreadSnapshotRequest(parsed)
        ? (parsed as unknown as BridgeThreadSnapshotRequestAction)
        : { kind: 'unknown', rawKind: 'threadSnapshotRequest', raw: parsed }
    case 'cancelRun':
      return isCancelRun(parsed)
        ? (parsed as unknown as BridgeCancelRunAction)
        : { kind: 'unknown', rawKind: 'cancelRun', raw: parsed }
    case 'ensembleCancelRound':
      return isEnsembleCancelRound(parsed)
        ? (parsed as unknown as BridgeEnsembleCancelRoundAction)
        : { kind: 'unknown', rawKind: 'ensembleCancelRound', raw: parsed }
    case 'ensembleSkipActiveParticipant':
      return isEnsembleSkipActiveParticipant(parsed)
        ? (parsed as unknown as BridgeEnsembleSkipActiveParticipantAction)
        : { kind: 'unknown', rawKind: 'ensembleSkipActiveParticipant', raw: parsed }
    case 'ensembleWakeNow':
      return isEnsembleWakeNow(parsed)
        ? (parsed as unknown as BridgeEnsembleWakeNowAction)
        : { kind: 'unknown', rawKind: 'ensembleWakeNow', raw: parsed }
    case 'ensembleCancelWakeup':
      return isEnsembleCancelWakeup(parsed)
        ? (parsed as unknown as BridgeEnsembleCancelWakeupAction)
        : { kind: 'unknown', rawKind: 'ensembleCancelWakeup', raw: parsed }
    case 'ensembleQueuePrompt':
      return isEnsembleQueuePrompt(parsed)
        ? (parsed as unknown as BridgeEnsembleQueuePromptAction)
        : { kind: 'unknown', rawKind: 'ensembleQueuePrompt', raw: parsed }
    case 'ensembleSteer':
      return isEnsembleSteer(parsed)
        ? (parsed as unknown as BridgeEnsembleSteerAction)
        : { kind: 'unknown', rawKind: 'ensembleSteer', raw: parsed }
    case 'ensembleRosterUpdate':
      return isEnsembleRosterUpdate(parsed)
        ? (parsed as unknown as BridgeEnsembleRosterUpdateAction)
        : { kind: 'unknown', rawKind: 'ensembleRosterUpdate', raw: parsed }
    case 'ensembleQueueItem':
      return isEnsembleQueueItem(parsed)
        ? (parsed as unknown as BridgeEnsembleQueueItemAction)
        : { kind: 'unknown', rawKind: 'ensembleQueueItem', raw: parsed }
    case 'setThreadNotes':
      return isSetThreadNotes(parsed)
        ? (parsed as unknown as BridgeSetThreadNotesAction)
        : { kind: 'unknown', rawKind: 'setThreadNotes', raw: parsed }
    case 'toggleMessagePin':
      return isToggleMessagePin(parsed)
        ? (parsed as unknown as BridgeToggleMessagePinAction)
        : { kind: 'unknown', rawKind: 'toggleMessagePin', raw: parsed }
    case 'registerApnsToken':
      return isRegisterApnsToken(parsed)
        ? (parsed as unknown as BridgeRegisterApnsTokenAction)
        : { kind: 'unknown', rawKind: 'registerApnsToken', raw: parsed }
    case 'setYoloMode':
      return isSetYoloMode(parsed)
        ? (parsed as unknown as BridgeSetYoloModeAction)
        : { kind: 'unknown', rawKind: 'setYoloMode', raw: parsed }
    case 'togglePinChat':
      return isTogglePinChat(parsed)
        ? (parsed as unknown as BridgeTogglePinChatAction)
        : { kind: 'unknown', rawKind: 'togglePinChat', raw: parsed }
    case 'togglePinWorkspace':
      return isTogglePinWorkspace(parsed)
        ? (parsed as unknown as BridgeTogglePinWorkspaceAction)
        : { kind: 'unknown', rawKind: 'togglePinWorkspace', raw: parsed }
    default:
      return { kind: 'unknown', rawKind: parsed.kind, raw: parsed }
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function isApprovalReply(v: Record<string, unknown>): boolean {
  const decision = v.decision
  return (
    hasValidActionMetadata(v) &&
    typeof v.workspaceId === 'string' &&
    typeof v.threadId === 'string' &&
    typeof v.toolCallId === 'string' &&
    isBridgeApprovalDecision(decision) &&
    (v.message === undefined || typeof v.message === 'string')
  )
}

function isBridgeApprovalDecision(value: unknown): value is BridgeApprovalDecision {
  return (
    value === 'accept' ||
    value === 'acceptForSession' ||
    value === 'acceptForWorkspace' ||
    value === 'decline' ||
    value === 'cancel'
  )
}

function isQuestionReply(v: Record<string, unknown>): boolean {
  return (
    hasValidActionMetadata(v) &&
    typeof v.workspaceId === 'string' &&
    typeof v.threadId === 'string' &&
    typeof v.promptId === 'string' &&
    typeof v.answer === 'string'
  )
}

function isQuestionReject(v: Record<string, unknown>): boolean {
  return (
    hasValidActionMetadata(v) &&
    typeof v.workspaceId === 'string' &&
    typeof v.threadId === 'string' &&
    typeof v.promptId === 'string' &&
    (v.message === undefined || typeof v.message === 'string')
  )
}

const MAX_IMAGE_ATTACHMENTS = 2
const MAX_IMAGE_ATTACHMENT_COMBINED_BASE64 = 900_000

function isImageAttachments(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_IMAGE_ATTACHMENTS) {
    return false
  }
  let combined = 0
  for (const entry of value) {
    if (!isRecord(entry)) return false
    if (typeof entry.mimeType !== 'string' || !entry.mimeType.startsWith('image/')) return false
    if (typeof entry.dataBase64 !== 'string' || entry.dataBase64.length === 0) return false
    if (entry.name !== undefined && typeof entry.name !== 'string') return false
    combined += entry.dataBase64.length
  }
  return combined <= MAX_IMAGE_ATTACHMENT_COMBINED_BASE64
}

function isComposerPrompt(v: Record<string, unknown>): boolean {
  return (
    hasValidActionMetadata(v) &&
    typeof v.workspaceId === 'string' &&
    typeof v.threadId === 'string' &&
    typeof v.text === 'string' &&
    typeof v.provider === 'string' &&
    (v.approvalMode === undefined || typeof v.approvalMode === 'string') &&
    (v.model === undefined || typeof v.model === 'string') &&
    (v.imageAttachments === undefined || isImageAttachments(v.imageAttachments)) &&
    (v.contextTurns === undefined ||
      (typeof v.contextTurns === 'number' &&
        Number.isInteger(v.contextTurns) &&
        v.contextTurns >= 0)) &&
    (v.extraWorkspaceIds === undefined ||
      (Array.isArray(v.extraWorkspaceIds) &&
        v.extraWorkspaceIds.length <= 2 &&
        v.extraWorkspaceIds.every(
          (id) => typeof id === 'string' && id.trim().length > 0
        )))
  )
}

function isCreateThread(v: Record<string, unknown>): boolean {
  return (
    hasValidActionMetadata(v) &&
    typeof v.workspaceId === 'string' &&
    (v.variant === 'workspace' || v.variant === 'ensemble' || v.variant === 'global') &&
    (v.threadId === undefined || typeof v.threadId === 'string') &&
    (v.provider === undefined || typeof v.provider === 'string') &&
    (v.title === undefined || typeof v.title === 'string') &&
    (v.participants === undefined || isCreateThreadParticipants(v.participants))
  )
}

function isCreateThreadParticipants(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) return false
  return value.every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.provider === 'string' &&
      entry.provider.trim().length > 0 &&
      (entry.model === undefined || typeof entry.model === 'string') &&
      (entry.role === undefined || typeof entry.role === 'string')
  )
}

function isThreadRowExpand(v: Record<string, unknown>): boolean {
  return (
    hasValidActionMetadata(v) &&
    typeof v.workspaceId === 'string' &&
    typeof v.threadId === 'string' &&
    typeof v.rowId === 'string' &&
    (v.maxChars === undefined ||
      (typeof v.maxChars === 'number' && Number.isInteger(v.maxChars) && v.maxChars > 0))
  )
}

function isThreadSnapshotRequest(v: Record<string, unknown>): boolean {
  return (
    hasValidActionMetadata(v) &&
    typeof v.workspaceId === 'string' &&
    typeof v.threadId === 'string' &&
    (v.limit === undefined ||
      (typeof v.limit === 'number' && Number.isInteger(v.limit) && v.limit > 0))
  )
}

function isCancelRun(v: Record<string, unknown>): boolean {
  return (
    hasValidActionMetadata(v) &&
    typeof v.workspaceId === 'string' &&
    typeof v.threadId === 'string' &&
    typeof v.provider === 'string' &&
    typeof v.runId === 'string' &&
    (v.message === undefined || typeof v.message === 'string')
  )
}

function isWorkspaceThreadAction(v: Record<string, unknown>): boolean {
  return (
    hasValidActionMetadata(v) && typeof v.workspaceId === 'string' && typeof v.threadId === 'string'
  )
}

function isEnsembleCancelRound(v: Record<string, unknown>): boolean {
  return (
    isWorkspaceThreadAction(v) &&
    (v.roundId === undefined || typeof v.roundId === 'string') &&
    (v.message === undefined || typeof v.message === 'string')
  )
}

function isEnsembleSkipActiveParticipant(v: Record<string, unknown>): boolean {
  return (
    isWorkspaceThreadAction(v) &&
    (v.roundId === undefined || typeof v.roundId === 'string') &&
    (v.participantId === undefined || typeof v.participantId === 'string') &&
    (v.message === undefined || typeof v.message === 'string')
  )
}

function isEnsembleWakeNow(v: Record<string, unknown>): boolean {
  return (
    isWorkspaceThreadAction(v) &&
    typeof v.wakeupId === 'string' &&
    v.wakeupId.length > 0 &&
    (v.message === undefined || typeof v.message === 'string')
  )
}

function isEnsembleCancelWakeup(v: Record<string, unknown>): boolean {
  return (
    isWorkspaceThreadAction(v) &&
    typeof v.wakeupId === 'string' &&
    v.wakeupId.length > 0 &&
    (v.message === undefined || typeof v.message === 'string')
  )
}

function isEnsembleQueuePrompt(v: Record<string, unknown>): boolean {
  return (
    isWorkspaceThreadAction(v) &&
    (v.roundId === undefined || typeof v.roundId === 'string') &&
    typeof v.text === 'string' &&
    v.text.trim().length > 0 &&
    (v.message === undefined || typeof v.message === 'string')
  )
}

function isSetThreadNotes(v: Record<string, unknown>): boolean {
  return (
    isWorkspaceThreadAction(v) && typeof v.notes === 'string' && v.notes.length <= 20_000
  )
}

function isToggleMessagePin(v: Record<string, unknown>): boolean {
  return (
    isWorkspaceThreadAction(v) &&
    typeof v.messageId === 'string' &&
    v.messageId.trim().length > 0 &&
    typeof v.pinned === 'boolean'
  )
}

function isEnsembleQueueItem(v: Record<string, unknown>): boolean {
  return (
    isWorkspaceThreadAction(v) &&
    typeof v.index === 'number' &&
    Number.isInteger(v.index) &&
    v.index >= 0 &&
    v.index < 100 &&
    (v.textPrefix === undefined ||
      (typeof v.textPrefix === 'string' && v.textPrefix.length <= 120)) &&
    (v.op === 'steerNow' || v.op === 'remove')
  )
}

function isEnsembleRosterUpdate(v: Record<string, unknown>): boolean {
  if (!isWorkspaceThreadAction(v)) return false
  if (!Array.isArray(v.participants)) return false
  if (v.participants.length < 1 || v.participants.length > 12) return false
  return v.participants.every((entry) => {
    if (!entry || typeof entry !== 'object') return false
    const e = entry as Record<string, unknown>
    if (typeof e.provider !== 'string' || e.provider.trim().length === 0) return false
    if (e.id !== undefined && typeof e.id !== 'string') return false
    if (e.model !== undefined && typeof e.model !== 'string') return false
    if (e.role !== undefined && (typeof e.role !== 'string' || e.role.length > 120)) return false
    if (e.brief !== undefined && (typeof e.brief !== 'string' || e.brief.length > 2000)) {
      return false
    }
    if (e.enabled !== undefined && typeof e.enabled !== 'boolean') return false
    return true
  })
}

function isEnsembleSteer(v: Record<string, unknown>): boolean {
  return (
    isWorkspaceThreadAction(v) &&
    (v.roundId === undefined || typeof v.roundId === 'string') &&
    typeof v.text === 'string' &&
    v.text.trim().length > 0 &&
    (v.message === undefined || typeof v.message === 'string') &&
    (v.imageAttachments === undefined || isImageAttachments(v.imageAttachments))
  )
}

function isSetYoloMode(v: Record<string, unknown>): boolean {
  return (
    hasValidActionMetadata(v) && typeof v.workspaceId === 'string' && typeof v.enabled === 'boolean'
  )
}

function isTogglePinChat(v: Record<string, unknown>): boolean {
  return (
    hasValidActionMetadata(v) &&
    typeof v.workspaceId === 'string' &&
    typeof v.appChatId === 'string' &&
    typeof v.pinned === 'boolean'
  )
}

function isTogglePinWorkspace(v: Record<string, unknown>): boolean {
  return (
    hasValidActionMetadata(v) && typeof v.workspaceId === 'string' && typeof v.pinned === 'boolean'
  )
}

function isRegisterApnsToken(v: Record<string, unknown>): boolean {
  return (
    hasValidActionMetadata(v) &&
    typeof v.pairID === 'string' &&
    v.pairID.length > 0 &&
    typeof v.deviceToken === 'string' &&
    v.deviceToken.length > 0 &&
    (v.env === 'production' || v.env === 'sandbox')
  )
}

function hasValidActionMetadata(v: Record<string, unknown>): boolean {
  return (
    (v.actionId === undefined || (typeof v.actionId === 'string' && v.actionId.length > 0)) &&
    (v.issuedAt === undefined || (typeof v.issuedAt === 'number' && Number.isFinite(v.issuedAt))) &&
    (v.expiresAt === undefined || (typeof v.expiresAt === 'number' && Number.isFinite(v.expiresAt)))
  )
}
