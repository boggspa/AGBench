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
  | BridgeCancelRunAction
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
    case 'cancelRun':
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
    case 'cancelRun':
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
    case 'cancelRun':
    case 'questionReply':
    case 'setYoloMode':
    case 'togglePinChat':
    case 'togglePinWorkspace':
      return true
    case 'approvalReply':
    case 'questionReject':
    case 'registerApnsToken':
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
    case 'cancelRun':
      return isCancelRun(parsed)
        ? (parsed as unknown as BridgeCancelRunAction)
        : { kind: 'unknown', rawKind: 'cancelRun', raw: parsed }
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

function isComposerPrompt(v: Record<string, unknown>): boolean {
  return (
    hasValidActionMetadata(v) &&
    typeof v.workspaceId === 'string' &&
    typeof v.threadId === 'string' &&
    typeof v.text === 'string' &&
    typeof v.provider === 'string' &&
    (v.approvalMode === undefined || typeof v.approvalMode === 'string') &&
    (v.model === undefined || typeof v.model === 'string') &&
    (v.contextTurns === undefined ||
      (typeof v.contextTurns === 'number' &&
        Number.isInteger(v.contextTurns) &&
        v.contextTurns >= 0))
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
