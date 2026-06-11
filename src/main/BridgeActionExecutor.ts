import type {
  BridgeApprovalReplyAction,
  BridgeCancelRunAction,
  BridgeComposerPromptAction,
  BridgeCreateThreadAction,
  BridgeThreadRowExpandAction,
  BridgeThreadSnapshotRequestAction,
  BridgeEnsembleCancelRoundAction,
  BridgeEnsembleCancelWakeupAction,
  BridgeEnsembleQueuePromptAction,
  BridgeEnsembleSkipActiveParticipantAction,
  BridgeEnsembleSteerAction,
  BridgeEnsembleRosterUpdateAction,
  BridgeEnsembleQueueItemAction,
  BridgeSetGuestParticipantAction,
  BridgeRemoveGuestParticipantAction,
  BridgeCreateSideChatAction,
  BridgeSetThreadNotesAction,
  BridgeToggleMessagePinAction,
  BridgeEnsembleWakeNowAction,
  BridgeQuestionRejectAction,
  BridgeQuestionReplyAction,
  BridgeRegisterApnsTokenAction,
  BridgeSetYoloModeAction,
  BridgeTogglePinChatAction,
  BridgeTogglePinWorkspaceAction
} from './BridgeActionPayload'
import type { AgentApprovalAction } from './store/types'

/**
 * BridgeActionExecutor — Phase C-late execution surface.
 *
 * BridgeActionRouter answers the **policy** question: "should we let this
 * iOS action through?" (allowlist + payload validity). The executor
 * answers the **dispatch** question: "given that we are letting it
 * through, what does the desktop actually DO?"
 *
 * Splitting policy from execution keeps:
 *   - The router thin and easy to test (no service mocking needed).
 *   - Service integrations independently swappable. Each `execute*`
 *     method can be wired (or rewired) without touching policy code.
 *   - A clear contract for what's "done" vs "scaffolded": each method
 *     returns `executed: boolean` so the router can tell iOS the
 *     difference between "policy-denied" and "policy-allowed but the
 *     wiring isn't done yet".
 *
 * Today's slice wires `executeCancelRun` for real (cleanest dispatch
 * surface — single line through `providerAdapters.cancel`). The other
 * four variants return `executed: false, message: 'not yet implemented'`.
 * Each becomes its own focused slice as the underlying main-process
 * service surface stabilizes (the approval-response handler is 182
 * lines deep and needs its own extraction before bridge wiring).
 */

export interface BridgeActionExecutionResult {
  /** Whether the action's real effect was applied (run canceled,
   * approval resolved, prompt sent, etc.). When false, the action was
   * authorized by policy but the dispatch path isn't yet wired. */
  executed: boolean
  /** Human-readable message that surfaces in the iOS ack. */
  message: string
  /** Optional structured data the iOS UI can use to navigate (e.g. the
   * new runId after a composerPrompt is dispatched). */
  data?: Record<string, unknown>
}

export interface BridgeActionExecutor {
  executeApprovalReply(action: BridgeApprovalReplyAction): Promise<BridgeActionExecutionResult>
  executeQuestionReply(action: BridgeQuestionReplyAction): Promise<BridgeActionExecutionResult>
  executeQuestionReject(action: BridgeQuestionRejectAction): Promise<BridgeActionExecutionResult>
  executeComposerPrompt(action: BridgeComposerPromptAction): Promise<BridgeActionExecutionResult>
  executeCreateThread(action: BridgeCreateThreadAction): Promise<BridgeActionExecutionResult>
  executeThreadRowExpand(
    action: BridgeThreadRowExpandAction
  ): Promise<BridgeActionExecutionResult>
  executeThreadSnapshotRequest(
    action: BridgeThreadSnapshotRequestAction
  ): Promise<BridgeActionExecutionResult>
  executeCancelRun(action: BridgeCancelRunAction): Promise<BridgeActionExecutionResult>
  executeEnsembleCancelRound(
    action: BridgeEnsembleCancelRoundAction
  ): Promise<BridgeActionExecutionResult>
  executeEnsembleSkipActiveParticipant(
    action: BridgeEnsembleSkipActiveParticipantAction
  ): Promise<BridgeActionExecutionResult>
  executeEnsembleWakeNow(action: BridgeEnsembleWakeNowAction): Promise<BridgeActionExecutionResult>
  executeEnsembleCancelWakeup(
    action: BridgeEnsembleCancelWakeupAction
  ): Promise<BridgeActionExecutionResult>
  executeEnsembleQueuePrompt(
    action: BridgeEnsembleQueuePromptAction
  ): Promise<BridgeActionExecutionResult>
  executeEnsembleSteer(action: BridgeEnsembleSteerAction): Promise<BridgeActionExecutionResult>
  executeEnsembleRosterUpdate(
    action: BridgeEnsembleRosterUpdateAction
  ): Promise<BridgeActionExecutionResult>
  executeEnsembleQueueItem(
    action: BridgeEnsembleQueueItemAction
  ): Promise<BridgeActionExecutionResult>
  executeSetGuestParticipant(
    action: BridgeSetGuestParticipantAction
  ): Promise<BridgeActionExecutionResult>
  executeRemoveGuestParticipant(
    action: BridgeRemoveGuestParticipantAction
  ): Promise<BridgeActionExecutionResult>
  executeCreateSideChat(
    action: BridgeCreateSideChatAction
  ): Promise<BridgeActionExecutionResult>
  executeSetThreadNotes(action: BridgeSetThreadNotesAction): Promise<BridgeActionExecutionResult>
  executeToggleMessagePin(
    action: BridgeToggleMessagePinAction
  ): Promise<BridgeActionExecutionResult>
  executeRegisterApnsToken(
    action: BridgeRegisterApnsTokenAction
  ): Promise<BridgeActionExecutionResult>
  executeSetYoloMode(action: BridgeSetYoloModeAction): Promise<BridgeActionExecutionResult>
  executeTogglePinChat(action: BridgeTogglePinChatAction): Promise<BridgeActionExecutionResult>
  executeTogglePinWorkspace(
    action: BridgeTogglePinWorkspaceAction
  ): Promise<BridgeActionExecutionResult>
}

/**
 * NoopActionExecutor — every method returns `executed: false`. Used by
 * the router when no real executor is configured (tests, or main-process
 * states where service dispatch isn't yet available). The router
 * propagates the message back to iOS verbatim so the user sees
 * "scaffolded, not wired" instead of a generic deny.
 */
export class NoopActionExecutor implements BridgeActionExecutor {
  async executeApprovalReply(
    action: BridgeApprovalReplyAction
  ): Promise<BridgeActionExecutionResult> {
    return notWired('approvalReply', action.toolCallId)
  }
  async executeQuestionReply(
    action: BridgeQuestionReplyAction
  ): Promise<BridgeActionExecutionResult> {
    return notWired('questionReply', action.promptId)
  }
  async executeQuestionReject(
    action: BridgeQuestionRejectAction
  ): Promise<BridgeActionExecutionResult> {
    return notWired('questionReject', action.promptId)
  }
  async executeComposerPrompt(
    action: BridgeComposerPromptAction
  ): Promise<BridgeActionExecutionResult> {
    return notWired('composerPrompt', action.threadId)
  }
  async executeCreateThread(
    action: BridgeCreateThreadAction
  ): Promise<BridgeActionExecutionResult> {
    return notWired('createThread', action.threadId ?? action.workspaceId)
  }
  async executeThreadRowExpand(
    action: BridgeThreadRowExpandAction
  ): Promise<BridgeActionExecutionResult> {
    return notWired('threadRowExpand', action.rowId)
  }
  async executeThreadSnapshotRequest(
    action: BridgeThreadSnapshotRequestAction
  ): Promise<BridgeActionExecutionResult> {
    return notWired('threadSnapshotRequest', action.threadId)
  }
  async executeCancelRun(action: BridgeCancelRunAction): Promise<BridgeActionExecutionResult> {
    return notWired('cancelRun', action.runId)
  }
  async executeEnsembleCancelRound(
    action: BridgeEnsembleCancelRoundAction
  ): Promise<BridgeActionExecutionResult> {
    return notWired('ensembleCancelRound', action.threadId)
  }
  async executeEnsembleSkipActiveParticipant(
    action: BridgeEnsembleSkipActiveParticipantAction
  ): Promise<BridgeActionExecutionResult> {
    return notWired('ensembleSkipActiveParticipant', action.threadId)
  }
  async executeEnsembleWakeNow(
    action: BridgeEnsembleWakeNowAction
  ): Promise<BridgeActionExecutionResult> {
    return notWired('ensembleWakeNow', action.wakeupId)
  }
  async executeEnsembleCancelWakeup(
    action: BridgeEnsembleCancelWakeupAction
  ): Promise<BridgeActionExecutionResult> {
    return notWired('ensembleCancelWakeup', action.wakeupId)
  }
  async executeEnsembleQueuePrompt(
    action: BridgeEnsembleQueuePromptAction
  ): Promise<BridgeActionExecutionResult> {
    return notWired('ensembleQueuePrompt', action.threadId)
  }
  async executeEnsembleSteer(
    action: BridgeEnsembleSteerAction
  ): Promise<BridgeActionExecutionResult> {
    return notWired('ensembleSteer', action.threadId)
  }
  async executeEnsembleRosterUpdate(
    action: BridgeEnsembleRosterUpdateAction
  ): Promise<BridgeActionExecutionResult> {
    return notWired('ensembleRosterUpdate', action.threadId)
  }
  async executeEnsembleQueueItem(
    action: BridgeEnsembleQueueItemAction
  ): Promise<BridgeActionExecutionResult> {
    return notWired('ensembleQueueItem', action.threadId)
  }
  async executeSetGuestParticipant(
    action: BridgeSetGuestParticipantAction
  ): Promise<BridgeActionExecutionResult> {
    return notWired('setGuestParticipant', action.threadId)
  }
  async executeRemoveGuestParticipant(
    action: BridgeRemoveGuestParticipantAction
  ): Promise<BridgeActionExecutionResult> {
    return notWired('removeGuestParticipant', action.threadId)
  }
  async executeCreateSideChat(
    action: BridgeCreateSideChatAction
  ): Promise<BridgeActionExecutionResult> {
    return notWired('createSideChat', action.threadId)
  }
  async executeSetThreadNotes(
    action: BridgeSetThreadNotesAction
  ): Promise<BridgeActionExecutionResult> {
    return notWired('setThreadNotes', action.threadId)
  }
  async executeToggleMessagePin(
    action: BridgeToggleMessagePinAction
  ): Promise<BridgeActionExecutionResult> {
    return notWired('toggleMessagePin', action.threadId)
  }
  async executeRegisterApnsToken(
    action: BridgeRegisterApnsTokenAction
  ): Promise<BridgeActionExecutionResult> {
    return notWired('registerApnsToken', action.pairID)
  }
  async executeSetYoloMode(action: BridgeSetYoloModeAction): Promise<BridgeActionExecutionResult> {
    return notWired('setYoloMode', String(action.enabled))
  }
  async executeTogglePinChat(
    action: BridgeTogglePinChatAction
  ): Promise<BridgeActionExecutionResult> {
    return notWired('togglePinChat', action.appChatId)
  }
  async executeTogglePinWorkspace(
    action: BridgeTogglePinWorkspaceAction
  ): Promise<BridgeActionExecutionResult> {
    return notWired('togglePinWorkspace', action.workspaceId)
  }
}

function notWired(kind: string, id: string): BridgeActionExecutionResult {
  return {
    executed: false,
    message: `Action "${kind}" (id=${id}) authorized but execution not yet wired`
  }
}

/**
 * MainProcessActionExecutor — the production implementation that
 * dispatches into Electron's main-process services.
 *
 * Wired today:
 *   - `executeCancelRun` → `cancelRunFn(provider, runId)` which delegates
 *     to the provider adapter's `cancel` method (same dispatch path the
 *     `cancel-agent-run` IPC handler uses).
 *
 * Scaffolded (return `executed: false`):
 *   - `executeApprovalReply` — wires after the `respond-agent-approval`
 *     IPC handler body is extracted into a callable. Owns ~5 provider-
 *     specific pending-approval registries; that extraction is its own
 *     slice.
 *   - `executeQuestionReply` / `executeQuestionReject` — tool-driven
 *     prompt-reply paths; provider-specific (Kimi/Gemini/Codex each have
 *     their own ask-question shapes).
 *   - `executeComposerPrompt` — needs the prompt-composition + run-start
 *     surface from main (currently distributed across IPC handlers
 *     `run-agent` etc.).
 */
export interface MainProcessActionExecutorDependencies {
  /** Callback the executor uses to cancel a run. Same dispatch surface
   * the `cancel-agent-run` IPC handler uses. */
  cancelRunFn: (provider: string, runId: string) => Promise<unknown>
  /** Callback the executor uses to resolve a pending approval or question.
   * Wraps the extracted `processAgentApprovalResponse` so iOS-initiated
   * decisions walk the same registries as renderer-initiated ones.
   * Returns `true` when the entry was found and processed, `false` when
   * no pending request matched (already resolved / expired / never
   * existed). The `options.userInput` field lets question-reply paths
   * pass typed answers through to Codex's `tool/requestUserInput` /
   * `mcp/elicitation/request` methods. */
  respondApprovalFn?: (
    requestId: string,
    action: AgentApprovalAction,
    options?: { userInput?: string }
  ) => Promise<boolean>
  /** Callback the executor uses to dispatch an iOS-initiated agent run.
   * The caller in main/index.ts looks up the workspace path by id,
   * builds an `AgentRunPayload`, and calls `dispatchAgentRun` with
   * `mainWindow.webContents` as the sender (so streaming events show
   * up in the desktop renderer's transcript view). Returns the appRunId
   * the run was dispatched as, or null when the run could not be
   * dispatched (workspace not found, main window missing, etc.). */
  composerPromptFn?: (action: BridgeComposerPromptAction) => Promise<{
    dispatched: boolean
    appRunId: string | null
    reason?: string
  }>
  createThreadFn?: (action: BridgeCreateThreadAction) => Promise<{
    ok: boolean
    threadId?: string
    chatKind?: string
    reason?: string
  }>
  threadRowExpandFn?: (action: BridgeThreadRowExpandAction) => Promise<{
    ok: boolean
    row?: Record<string, unknown>
    reason?: string
  }>
  /** Callback the executor uses to register an iOS device's APNs token.
   * The caller in main/index.ts forwards to `BridgeApnsTokenStore.upsert`.
   * Returns true on success, false (with a reason) on validation failure. */
  /** Callback that projects a bounded transcript window for one thread
   * and pushes it to the paired device as a single threadSnapshot
   * envelope (`bridge.broadcastRemoteProjection`). The ack only reports
   * ok/reason — the snapshot itself travels on the broadcast channel. */
  threadSnapshotRequestFn?: (action: BridgeThreadSnapshotRequestAction) => Promise<{
    ok: boolean
    reason?: string
  }>
  registerApnsTokenFn?: (action: BridgeRegisterApnsTokenAction) => Promise<{
    registered: boolean
    reason?: string
  }>
  setYoloModeFn?: (enabled: boolean) => Promise<{ enabled: boolean }>
  togglePinChatFn?: (action: BridgeTogglePinChatAction) => Promise<{
    pinned: boolean
    reason?: string
  }>
  togglePinWorkspaceFn?: (action: BridgeTogglePinWorkspaceAction) => Promise<{
    pinned: boolean
    reason?: string
  }>
  ensembleCancelRoundFn?: (action: BridgeEnsembleCancelRoundAction) => Promise<unknown>
  ensembleSkipActiveParticipantFn?: (
    action: BridgeEnsembleSkipActiveParticipantAction
  ) => Promise<unknown>
  ensembleWakeNowFn?: (action: BridgeEnsembleWakeNowAction) => Promise<unknown>
  ensembleCancelWakeupFn?: (action: BridgeEnsembleCancelWakeupAction) => Promise<unknown>
  ensembleQueuePromptFn?: (action: BridgeEnsembleQueuePromptAction) => Promise<unknown>
  ensembleSteerFn?: (action: BridgeEnsembleSteerAction) => Promise<unknown>
  ensembleRosterUpdateFn?: (action: BridgeEnsembleRosterUpdateAction) => Promise<unknown>
  ensembleQueueItemFn?: (action: BridgeEnsembleQueueItemAction) => Promise<unknown>
  setGuestParticipantFn?: (action: BridgeSetGuestParticipantAction) => Promise<unknown>
  removeGuestParticipantFn?: (action: BridgeRemoveGuestParticipantAction) => Promise<unknown>
  createSideChatFn?: (action: BridgeCreateSideChatAction) => Promise<unknown>
  setThreadNotesFn?: (action: BridgeSetThreadNotesAction) => Promise<unknown>
  toggleMessagePinFn?: (action: BridgeToggleMessagePinAction) => Promise<unknown>
  log?: (line: string) => void
}

export class MainProcessActionExecutor implements BridgeActionExecutor {
  private readonly deps: MainProcessActionExecutorDependencies
  private readonly log: (line: string) => void

  constructor(deps: MainProcessActionExecutorDependencies) {
    this.deps = deps
    this.log = deps.log ?? (() => {})
  }

  async executeApprovalReply(
    action: BridgeApprovalReplyAction
  ): Promise<BridgeActionExecutionResult> {
    if (!this.deps.respondApprovalFn) {
      this.log(
        `[BridgeActionExecutor] approvalReply has no respondApprovalFn — toolCallId=${action.toolCallId}`
      )
      return notWired('approvalReply', action.toolCallId)
    }
    this.log(
      `[BridgeActionExecutor] approvalReply toolCallId=${action.toolCallId} decision=${action.decision}`
    )
    try {
      const resolved = await this.deps.respondApprovalFn(action.toolCallId, action.decision)
      if (resolved) {
        return {
          executed: true,
          message: `Approval "${action.toolCallId}" resolved as "${action.decision}"`,
          data: { toolCallId: action.toolCallId, decision: action.decision }
        }
      }
      return {
        executed: false,
        message: `No pending approval found for toolCallId="${action.toolCallId}" (already resolved, expired, or never registered)`
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err)
      this.log(`[BridgeActionExecutor] approvalReply failed: ${errMessage}`)
      return {
        executed: false,
        message: `Approval dispatch failed: ${errMessage}`
      }
    }
  }

  async executeQuestionReply(
    action: BridgeQuestionReplyAction
  ): Promise<BridgeActionExecutionResult> {
    if (!this.deps.respondApprovalFn) {
      this.log(
        `[BridgeActionExecutor] questionReply has no respondApprovalFn — promptId=${action.promptId}`
      )
      return notWired('questionReply', action.promptId)
    }
    this.log(
      `[BridgeActionExecutor] questionReply promptId=${action.promptId} answerLen=${action.answer.length}`
    )
    try {
      const resolved = await this.deps.respondApprovalFn(action.promptId, 'accept', {
        userInput: action.answer
      })
      if (resolved) {
        return {
          executed: true,
          message: `Question "${action.promptId}" answered`,
          data: { promptId: action.promptId, answerLength: action.answer.length }
        }
      }
      return {
        executed: false,
        message: `No pending question found for promptId="${action.promptId}" (already resolved, expired, or never registered)`
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err)
      this.log(`[BridgeActionExecutor] questionReply failed: ${errMessage}`)
      return {
        executed: false,
        message: `Question reply dispatch failed: ${errMessage}`
      }
    }
  }

  async executeQuestionReject(
    action: BridgeQuestionRejectAction
  ): Promise<BridgeActionExecutionResult> {
    if (!this.deps.respondApprovalFn) {
      this.log(
        `[BridgeActionExecutor] questionReject has no respondApprovalFn — promptId=${action.promptId}`
      )
      return notWired('questionReject', action.promptId)
    }
    this.log(`[BridgeActionExecutor] questionReject promptId=${action.promptId}`)
    try {
      const resolved = await this.deps.respondApprovalFn(action.promptId, 'decline')
      if (resolved) {
        return {
          executed: true,
          message: `Question "${action.promptId}" rejected`,
          data: { promptId: action.promptId }
        }
      }
      return {
        executed: false,
        message: `No pending question found for promptId="${action.promptId}" (already resolved, expired, or never registered)`
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err)
      this.log(`[BridgeActionExecutor] questionReject failed: ${errMessage}`)
      return {
        executed: false,
        message: `Question reject dispatch failed: ${errMessage}`
      }
    }
  }

  async executeThreadSnapshotRequest(
    action: BridgeThreadSnapshotRequestAction
  ): Promise<BridgeActionExecutionResult> {
    if (!this.deps.threadSnapshotRequestFn) {
      return notWired('threadSnapshotRequest', action.threadId)
    }
    try {
      const result = await this.deps.threadSnapshotRequestFn(action)
      return result.ok
        ? { executed: true, message: `Thread snapshot pushed for ${action.threadId}` }
        : {
            executed: false,
            message: `Thread snapshot unavailable${result.reason ? `: ${result.reason}` : ''}`
          }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log(`[BridgeActionExecutor] threadSnapshotRequest failed: ${message}`)
      return { executed: false, message: `Thread snapshot failed: ${message}` }
    }
  }

  async executeThreadRowExpand(
    action: BridgeThreadRowExpandAction
  ): Promise<BridgeActionExecutionResult> {
    if (!this.deps.threadRowExpandFn) {
      return notWired('threadRowExpand', action.rowId)
    }
    try {
      const result = await this.deps.threadRowExpandFn(action)
      if (result.ok && result.row) {
        return {
          executed: true,
          message: 'Expanded row.',
          data: { row: result.row, rowId: action.rowId, threadId: action.threadId }
        }
      }
      return {
        executed: false,
        message: result.reason ?? 'Could not expand row.'
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { executed: false, message: `Row expand failed: ${message}` }
    }
  }

  async executeCreateThread(
    action: BridgeCreateThreadAction
  ): Promise<BridgeActionExecutionResult> {
    if (!this.deps.createThreadFn) {
      return notWired('createThread', action.threadId ?? action.workspaceId)
    }
    this.log(
      `[BridgeActionExecutor] createThread variant=${action.variant} ws=${action.workspaceId}`
    )
    try {
      const result = await this.deps.createThreadFn(action)
      if (result.ok && result.threadId) {
        return {
          executed: true,
          message: 'Chat created on your Mac.',
          data: {
            threadId: result.threadId,
            workspaceId: action.workspaceId,
            chatKind: result.chatKind
          }
        }
      }
      return {
        executed: false,
        message: result.reason ?? 'Could not create chat on your Mac.'
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log(`[BridgeActionExecutor] createThread failed: ${message}`)
      return { executed: false, message: `Create thread failed: ${message}` }
    }
  }

  async executeComposerPrompt(
    action: BridgeComposerPromptAction
  ): Promise<BridgeActionExecutionResult> {
    if (!this.deps.composerPromptFn) {
      this.log(
        `[BridgeActionExecutor] composerPrompt has no composerPromptFn — threadId=${action.threadId}`
      )
      return notWired('composerPrompt', action.threadId)
    }
    this.log(
      `[BridgeActionExecutor] composerPrompt provider=${action.provider} ws=${action.workspaceId} thread=${action.threadId}`
    )
    try {
      const result = await this.deps.composerPromptFn(action)
      if (result.dispatched) {
        // `appRunId` may be null: the dispatcher acks at ACCEPTANCE and
        // runs preflight/dispatch async so the phone's ack window isn't
        // held hostage to provider startup. The run id reaches the phone
        // via the projection snapshot that follows dispatch.
        return {
          executed: true,
          message: 'Dispatching on your Mac.',
          data: {
            ...(result.appRunId ? { appRunId: result.appRunId } : {}),
            workspaceId: action.workspaceId,
            threadId: action.threadId,
            provider: action.provider
          }
        }
      }
      return {
        executed: false,
        message: `Composer prompt could not be dispatched${result.reason ? `: ${result.reason}` : ''}`
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err)
      this.log(`[BridgeActionExecutor] composerPrompt failed: ${errMessage}`)
      return {
        executed: false,
        message: `Composer prompt dispatch failed: ${errMessage}`
      }
    }
  }

  async executeCancelRun(action: BridgeCancelRunAction): Promise<BridgeActionExecutionResult> {
    this.log(`[BridgeActionExecutor] cancelRun provider=${action.provider} runId=${action.runId}`)
    try {
      const result = await this.deps.cancelRunFn(action.provider, action.runId)
      return {
        executed: true,
        message: `Run "${action.runId}" cancellation dispatched to provider "${action.provider}"`,
        data: {
          cancelResult: serializableOrNull(result),
          runId: action.runId,
          provider: action.provider
        }
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err)
      this.log(`[BridgeActionExecutor] cancelRun failed: ${errMessage}`)
      return {
        executed: false,
        message: `Cancel dispatch failed: ${errMessage}`
      }
    }
  }

  async executeEnsembleCancelRound(
    action: BridgeEnsembleCancelRoundAction
  ): Promise<BridgeActionExecutionResult> {
    return this.executeEnsembleAction(
      'ensembleCancelRound',
      action.threadId,
      this.deps.ensembleCancelRoundFn,
      action
    )
  }

  async executeEnsembleSkipActiveParticipant(
    action: BridgeEnsembleSkipActiveParticipantAction
  ): Promise<BridgeActionExecutionResult> {
    return this.executeEnsembleAction(
      'ensembleSkipActiveParticipant',
      action.threadId,
      this.deps.ensembleSkipActiveParticipantFn,
      action
    )
  }

  async executeEnsembleWakeNow(
    action: BridgeEnsembleWakeNowAction
  ): Promise<BridgeActionExecutionResult> {
    return this.executeEnsembleAction(
      'ensembleWakeNow',
      action.wakeupId,
      this.deps.ensembleWakeNowFn,
      action
    )
  }

  async executeEnsembleCancelWakeup(
    action: BridgeEnsembleCancelWakeupAction
  ): Promise<BridgeActionExecutionResult> {
    return this.executeEnsembleAction(
      'ensembleCancelWakeup',
      action.wakeupId,
      this.deps.ensembleCancelWakeupFn,
      action
    )
  }

  async executeEnsembleQueuePrompt(
    action: BridgeEnsembleQueuePromptAction
  ): Promise<BridgeActionExecutionResult> {
    return this.executeEnsembleAction(
      'ensembleQueuePrompt',
      action.threadId,
      this.deps.ensembleQueuePromptFn,
      action
    )
  }

  async executeEnsembleSteer(
    action: BridgeEnsembleSteerAction
  ): Promise<BridgeActionExecutionResult> {
    return this.executeEnsembleAction(
      'ensembleSteer',
      action.threadId,
      this.deps.ensembleSteerFn,
      action
    )
  }

  async executeEnsembleRosterUpdate(
    action: BridgeEnsembleRosterUpdateAction
  ): Promise<BridgeActionExecutionResult> {
    return this.executeEnsembleAction(
      'ensembleRosterUpdate',
      action.threadId,
      this.deps.ensembleRosterUpdateFn,
      action
    )
  }

  async executeEnsembleQueueItem(
    action: BridgeEnsembleQueueItemAction
  ): Promise<BridgeActionExecutionResult> {
    return this.executeEnsembleAction(
      'ensembleQueueItem',
      action.threadId,
      this.deps.ensembleQueueItemFn,
      action
    )
  }

  async executeSetGuestParticipant(
    action: BridgeSetGuestParticipantAction
  ): Promise<BridgeActionExecutionResult> {
    return this.executeEnsembleAction(
      'setGuestParticipant',
      action.threadId,
      this.deps.setGuestParticipantFn,
      action
    )
  }

  async executeRemoveGuestParticipant(
    action: BridgeRemoveGuestParticipantAction
  ): Promise<BridgeActionExecutionResult> {
    return this.executeEnsembleAction(
      'removeGuestParticipant',
      action.threadId,
      this.deps.removeGuestParticipantFn,
      action
    )
  }

  async executeCreateSideChat(
    action: BridgeCreateSideChatAction
  ): Promise<BridgeActionExecutionResult> {
    return this.executeEnsembleAction(
      'createSideChat',
      action.threadId,
      this.deps.createSideChatFn,
      action
    )
  }

  async executeSetThreadNotes(
    action: BridgeSetThreadNotesAction
  ): Promise<BridgeActionExecutionResult> {
    return this.executeEnsembleAction(
      'setThreadNotes',
      action.threadId,
      this.deps.setThreadNotesFn,
      action
    )
  }

  async executeToggleMessagePin(
    action: BridgeToggleMessagePinAction
  ): Promise<BridgeActionExecutionResult> {
    return this.executeEnsembleAction(
      'toggleMessagePin',
      action.threadId,
      this.deps.toggleMessagePinFn,
      action
    )
  }

  async executeRegisterApnsToken(
    action: BridgeRegisterApnsTokenAction
  ): Promise<BridgeActionExecutionResult> {
    if (!this.deps.registerApnsTokenFn) {
      this.log(
        `[BridgeActionExecutor] registerApnsToken has no registerApnsTokenFn — pairID=${action.pairID}`
      )
      return notWired('registerApnsToken', action.pairID)
    }
    this.log(`[BridgeActionExecutor] registerApnsToken pairID=${action.pairID} env=${action.env}`)
    try {
      const result = await this.deps.registerApnsTokenFn(action)
      if (result.registered) {
        return {
          executed: true,
          message: `APNs token registered for pairID="${action.pairID}" (env=${action.env})`,
          data: { pairID: action.pairID, env: action.env }
        }
      }
      return {
        executed: false,
        message: `APNs token registration declined${result.reason ? `: ${result.reason}` : ''}`
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err)
      this.log(`[BridgeActionExecutor] registerApnsToken failed: ${errMessage}`)
      return {
        executed: false,
        message: `APNs token registration failed: ${errMessage}`
      }
    }
  }

  async executeSetYoloMode(action: BridgeSetYoloModeAction): Promise<BridgeActionExecutionResult> {
    if (!this.deps.setYoloModeFn) {
      this.log('[BridgeActionExecutor] setYoloMode has no setYoloModeFn')
      return notWired('setYoloMode', String(action.enabled))
    }
    try {
      const result = await this.deps.setYoloModeFn(action.enabled)
      return {
        executed: true,
        message: `YOLO mode ${result.enabled ? 'enabled' : 'disabled'}`,
        data: { enabled: result.enabled }
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err)
      this.log(`[BridgeActionExecutor] setYoloMode failed: ${errMessage}`)
      return { executed: false, message: `YOLO mode update failed: ${errMessage}` }
    }
  }

  async executeTogglePinChat(
    action: BridgeTogglePinChatAction
  ): Promise<BridgeActionExecutionResult> {
    if (!this.deps.togglePinChatFn) {
      this.log(
        `[BridgeActionExecutor] togglePinChat has no togglePinChatFn — appChatId=${action.appChatId}`
      )
      return notWired('togglePinChat', action.appChatId)
    }
    try {
      const result = await this.deps.togglePinChatFn(action)
      if (result.reason) {
        return { executed: false, message: result.reason }
      }
      return {
        executed: true,
        message: `Chat "${action.appChatId}" ${result.pinned ? 'pinned' : 'unpinned'}`,
        data: { appChatId: action.appChatId, pinned: result.pinned }
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err)
      this.log(`[BridgeActionExecutor] togglePinChat failed: ${errMessage}`)
      return { executed: false, message: `Pin chat update failed: ${errMessage}` }
    }
  }

  async executeTogglePinWorkspace(
    action: BridgeTogglePinWorkspaceAction
  ): Promise<BridgeActionExecutionResult> {
    if (!this.deps.togglePinWorkspaceFn) {
      this.log(
        `[BridgeActionExecutor] togglePinWorkspace has no togglePinWorkspaceFn — workspaceId=${action.workspaceId}`
      )
      return notWired('togglePinWorkspace', action.workspaceId)
    }
    try {
      const result = await this.deps.togglePinWorkspaceFn(action)
      if (result.reason) {
        return { executed: false, message: result.reason }
      }
      return {
        executed: true,
        message: `Workspace "${action.workspaceId}" ${result.pinned ? 'pinned' : 'unpinned'}`,
        data: { workspaceId: action.workspaceId, pinned: result.pinned }
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err)
      this.log(`[BridgeActionExecutor] togglePinWorkspace failed: ${errMessage}`)
      return { executed: false, message: `Pin workspace update failed: ${errMessage}` }
    }
  }

  private async executeEnsembleAction<TAction>(
    kind: string,
    id: string,
    handler: ((action: TAction) => Promise<unknown>) | undefined,
    action: TAction
  ): Promise<BridgeActionExecutionResult> {
    if (!handler) {
      this.log(`[BridgeActionExecutor] ${kind} has no handler — id=${id}`)
      return notWired(kind, id)
    }
    try {
      const result = await handler(action)
      const resultRecord = isRecord(result) ? result : null
      const okValue = typeof resultRecord?.ok === 'boolean' ? resultRecord.ok : undefined
      const appliedValue =
        typeof resultRecord?.applied === 'boolean' ? resultRecord.applied : undefined
      const executed = okValue ?? appliedValue ?? Boolean(result)
      const reason =
        typeof resultRecord?.error === 'string'
          ? resultRecord.error
          : typeof resultRecord?.reason === 'string'
            ? resultRecord.reason
            : typeof resultRecord?.message === 'string'
              ? resultRecord.message
              : undefined
      return {
        executed,
        message: executed
          ? `Ensemble action "${kind}" applied`
          : `Ensemble action "${kind}" was not applied${reason ? `: ${reason}` : ''}`,
        data: {
          actionKind: kind,
          result: serializableOrNull(result)
        }
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err)
      this.log(`[BridgeActionExecutor] ${kind} failed: ${errMessage}`)
      return {
        executed: false,
        message: `Ensemble action "${kind}" failed: ${errMessage}`
      }
    }
  }
}

/** Best-effort coercion of a service-returned value into something
 * JSON-safe for the executor result. Strings/numbers/booleans/objects
 * pass through; functions / undefined become null. */
function serializableOrNull(value: unknown): unknown {
  if (value === undefined || typeof value === 'function') return null
  try {
    // Round-trip through JSON to strip non-serializable bits.
    return JSON.parse(JSON.stringify(value))
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
