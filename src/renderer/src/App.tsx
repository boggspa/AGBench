import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react'
import type { CSSProperties } from 'react'
import { GeminiStreamAdapter, NormalizedEvent } from './lib/GeminiAdapter'
import { resolveAssistantDeltaMerge } from './lib/assistantDeltaMerge'
import { resolveSessionLinkRouting } from './lib/participantSessionLink'
import { resolveRuntimePickerScope } from './lib/participantRuntimeProfile'
import {
  applyScheduledEnsembleSnapshot,
  buildScheduledEnsembleSnapshot
} from './lib/scheduledEnsembleSnapshot'
import { classifyError, redactLog } from './lib/ErrorClassifier'
import { shouldBackfillRunStats } from './lib/RunStatsBackfill'
// 1.0.5-EW25 — User-currency cost formatting helper.
import { setFxRatesPerUsd, type DisplayCurrency } from './lib/formatCost'
import { computeCumulativeRunBaseMs } from './lib/cumulativeRunTimecode'
import {
  AppSettings,
  WorkspaceRecord,
  ChatRecord,
  ChatMessage,
  ChatRun,
  RunWarning,
  DiffFileSummary,
  UsageRecord,
  ToolActivity,
  RunDiffResult,
  GeminiWorktreeConfig,
  ProviderId,
  ExternalPathGrant,
  ScheduledTask,
  AgenticServicesSettings,
  AgenticWorkspaceGrant,
  AgenticServiceId,
  GeminiApiRuntimeMode,
  GeminiMcpBridgeStatus,
  CodexSandboxFallbackMode,
  ProviderCapabilityContract,
  ProviderApiKeyStatus,
  GeminiAuthStatus,
  GeminiAuthProfileSummary,
  GeminiOAuthLoginStatus,
  RunQueueJob,
  RunQueueJobSource,
  RunQueueJobStatus,
  RunQueueRequestSnapshot,
  RunEventInput,
  RunEventRecord,
  RunRecoveryRecord,
  ProductOperationsStatus,
  ProductUpdateChannel,
  ProductChangelogSnapshot,
  ChatScope,
  RuntimeProfile,
  HandoffCard,
  EnsembleParticipant,
  EnsembleOrchestrationMode,
  PermissionPresetId,
  SideChatLifecycleState
} from '../../main/store/types'
import type { NativeCapabilitySnapshot } from '../../main/NativeCapabilities'
import {
  canonicalizeExternalPathGrantMetadata,
  collectExternalPathGrantsFromMetadata,
  reorderExternalPathGrantsByPath
} from '../../main/store/ExternalPathGrants'
import type {
  ModelUsageAggregate,
  UsageWindowAggregate,
  UsageBalanceAggregate
} from './lib/usageAggregateTypes'
export type {
  ModelUsageAggregate,
  UsageWindowAggregate,
  UsageBalanceAggregate
} from './lib/usageAggregateTypes'
import { isNativeSubAgentPreferenceApproval } from './lib/agentApprovalTypes'
import type { AgentApprovalAction, AgentApprovalRequest } from './lib/agentApprovalTypes'
import { toDateTimeLocalValue, formatScheduledRunTime } from './lib/dateTimeFormat'
import { buildReviewCurrentDiffPrompt } from './lib/reviewDiffPrompt'
import { normalizeExternalPathGrants } from './lib/normalizeExternalPathGrants'
import type { SettingsPanelUpdate } from './lib/settingsPanelUpdate'
import { IOS_REMOTE_ENABLED } from './lib/featureFlags'
import {
  getKeyCommandForEvent,
  resolveKeyCommandBindings,
  type KeyCommandId
} from './lib/keyCommands'
import {
  MIN_RIGHT_PANEL_WIDTH,
  MAX_RIGHT_PANEL_WIDTH,
  DEFAULT_SIDE_CHAT_WIDTH,
  MIN_SIDE_CHAT_WIDTH,
  MAX_SIDE_CHAT_WIDTH,
  MIN_WORKSPACE_SIDEBAR_WIDTH,
  MAX_WORKSPACE_SIDEBAR_WIDTH,
  clampPanelWidth,
  clampSideChatWidth,
  clampWorkspaceSidebarWidth,
  getStoredFileEditorWidth,
  getStoredSideChatWidth,
  setStoredSideChatWidth,
  getStoredWorkspaceSidebarWidth
} from './lib/panelWidths'
import { getProviderLabel } from './lib/providerLabels'
import {
  GLOBAL_USAGE_WORKSPACE_ID,
  getChatProvider,
  getChatScope,
  isGlobalChat,
  isSubThreadChat,
  getUsageWorkspaceIdForChat
} from './lib/chatScope'
import { renderAgentApprovalPreview } from './lib/agentApprovalPreview'
import {
  CODEX_DEFAULT_MODELS,
  CODEX_DEFAULT_MODEL,
  CLAUDE_THINKING_EFFORTS,
  CLAUDE_DEFAULT_MODELS,
  KIMI_DEFAULT_MODELS,
  KIMI_DEFAULT_MODEL,
  GEMINI_DEFAULT_MODELS,
  GROK_DEFAULT_MODELS,
  CURSOR_DEFAULT_MODELS,
  isGeminiModelId,
  isCodexModelId,
  isClaudeModelId,
  isKimiModelId,
  normalizeProviderModelKey
} from './lib/providerModelDefaults'
import type { CodexModelOption } from './lib/providerModelDefaults'
import {
  WORKTREE_DIFF_UNAVAILABLE_TEXT,
  createWorktreeDiffUnavailable,
  resolveGeminiWorktreeConfig,
  isGeminiWorktreeDiffUnavailable,
  getDiffWorkspacePath
} from './lib/geminiWorktree'
import { normalizeGeminiResumeTarget, resolveGeminiResumeForRun } from './lib/geminiResume'
import {
  buildChatTokenTally,
  formatEnsembleTokenBreakdown
} from './lib/threadTokenTally'
import { buildCodexUsageWindows } from './lib/codexUsageWindows'
import type { QueuedRunRequest, RunRouteEventPayload, ActiveRunContext } from './lib/runRequestTypes'
import { CockpitPanel } from './components/CockpitPanel'
import {
  createToolActivity,
  pairToolResult,
  isToolUseEvent,
  isToolResultEvent,
  estimateLineChanges
} from './lib/ToolParser'
import { getLiveToolFileDiffSummaries, liveSummariesAreFuzzy } from './lib/LiveFileDiffSummary'
import { parseGeminiPermissionRequest } from './lib/GeminiPermissionParser'
import type { GeminiPermissionRequest } from './lib/GeminiPermissionParser'
import type {
  CommandPaletteGroup,
  CommandPaletteItem,
  ComposerSlashCommand
} from './lib/ComposerSlashCommands'
import {
  GEMINI_PALETTE_CORE as COMMAND_PALETTE_CORE,
  CODEX_PALETTE_CORE as CODEX_COMMAND_PALETTE_CORE,
  CLI_PROVIDER_PALETTE_CORE as CLI_PROVIDER_COMMAND_PALETTE_CORE,
  buildComposerSlashCommandRegistry
} from './lib/ComposerSlashCommands'
import { ComposerSlashMenu } from './components/ComposerSlashMenu'
import { CreativeActionApprovalModal } from './components/CreativeActionApprovalModal'
import { UsageHeatmap } from './components/UsageHeatmap'
import { WorkspaceActivityHeatmap } from './components/WorkspaceActivityHeatmap'
import { WelcomeHeatmaps, type WelcomeHeatmapSlot } from './components/WelcomeHeatmaps'
import { useAppearance } from './hooks/useAppearance'
import { useExternalPathRepoMetadata } from './hooks/useExternalPathRepoMetadata'
import { useUpdateStatus } from './hooks/useUpdateStatus'
import { ExternalPathAboveRow } from './components/ExternalPathAboveRow'
import { GitCommitControls } from './components/GitCommitControls'
import { branchTone, GitCiChip, GitMergeBadge, GitSyncChip } from './components/GitStatusChips'
import type { GitPrSummary, GitRepositorySnapshot } from '../../main/services/GitService'
import { ProviderBadgeIcon, Sidebar } from './components/Sidebar'
import { Inspector } from './components/Inspector'
import { SettingsPanel, type SettingsTab } from './components/SettingsPanel'
import { SettingsSidebar } from './components/SettingsSidebar'
import { SubThreadCreator } from './components/SubThreadCreator'
import { FirstLaunchSheet } from './components/FirstLaunchSheet'
import { BugReportSheet, type BugReportSubmission } from './components/BugReportSheet'
import { ChangelogSheet } from './components/ChangelogSheet'
import {
  WorkSessionSetupSheet,
  type WorkSessionSetupConfirmInput
} from './components/WorkSessionSetupSheet'
import { IncomingPairingPrompt } from './components/IncomingPairingPrompt'
import { FileTypeIcon } from './components/FileTypeIcon'
import {
  ArrowUpSendIcon,
  AppleTerminalIcon,
  ChatMediaIcon,
  ChatPopoutIcon,
  ClaudeReturnSymbolIcon,
  ClockSymbolIcon,
  CommandSymbolIcon,
  ContextWheel,
  FileMenuSelectionIcon,
  GhostCompanionIcon,
  LinkCircleSymbolIcon,
  ModelSymbolIcon,
  PermissionSymbolIcon,
  PlusSymbolIcon,
  QueueSymbolIcon,
  ReviewSymbolIcon,
  RunSymbolIcon,
  ScreenWatchSymbolIcon,
  SidebarCornerIcon,
  SkyWeatherIcon,
  SplitChatIcon,
  SteerSymbolIcon,
  StopSymbolIcon,
  TrustSymbolIcon,
  XSymbolIcon
} from './components/AppChromeSymbols'
import {
  ChatMediaFloatingPanel,
  ChatMediaPreviewOverlay,
  collectChatMediaRefs,
  type ChatMediaRef
} from './components/ChatMediaPanel'
import { FileEditorPanel } from './components/FileEditorPanel'
import { RunInspector } from './components/RunInspector'
// PairingSheet retired in the post-1.0.2 Settings full-app takeover.
// The pairing flow now lives as a Settings tab (`PairingPage` mounted
// inside SettingsPanel). Triggers route through `setShowSettings(true)
// + setSettingsActiveTab('pairing')`.
import { EnsembleParticipantsAboveRow } from './components/EnsembleParticipantsAboveRow'
import {
  QueuedMessagesAboveRow,
  type QueuedMessageRowEntry
} from './components/QueuedMessagesAboveRow'
import { ComposerHighlightOverlay } from './components/ComposerHighlightOverlay'
import { hasResolvedMention } from './lib/mentionHighlight'
import { useCopyFeedback } from './lib/useCopyFeedback'
import { reasoningDisplayLabel, shortModelName } from './lib/composerChipFormat'
import {
  getDefaultEnsembleParticipantConfig,
  resolveEnsembleParticipantSettings
} from './lib/ensembleProviderDefaults'
import {
  rebindEnsembleChatToWorkspace,
  rebindWelcomeEnsembleChatToGlobal,
  rebindWelcomeEnsembleChatToWorkspace
} from './lib/ensembleWelcomeWorkspace'
import { withSessionActivityLedger } from './lib/sessionActivityLedger'
import { applyWorkSessionConfirmation, cancelWorkSessionOnChat } from './lib/workSessionChat'
// EnsembleSetupSheet retired in 1.0.3 — the bottom-pinned modal had a
// z-index race with the picker popovers and the form felt foreign. All
// per-participant config now lives inline in the composer above-row
// (EnsembleParticipantsAboveRow) where each chip opens a flyout in the
// same visual language as the rest of the composer pickers.
import { WorkspaceAccessControls } from './components/WorkspaceAccessControls'
import { LinkedChatsStrip } from './components/LinkedChatsStrip'
import { AgentMentionMenu } from './components/AgentMentionMenu'
import {
  extractFirstEnsembleDmTarget,
  formatComposerPathMention,
  parseComposerMentionTrigger
} from './lib/ComposerMentionTrigger'
import {
  CombinedModelPicker,
  type CombinedModelPickerModelOption,
  type CombinedModelPickerReasoningOption
} from './components/CombinedModelPicker'
import {
  CombinedPermissionsPicker,
  type PermissionOption
} from './components/CombinedPermissionsPicker'
import { ComposerPlusPicker, type ComposerPlusPickerSection } from './components/ComposerPlusPicker'
import { EnsembleModePicker } from './components/EnsembleModePicker'
import { ComposerProviderPicker } from './components/ComposerProviderPicker'
import { ContinuousHopsLimitChip } from './components/ContinuousHopsLimitChip'
import { WORKSPACE_POLICY_SERVICES } from './lib/workspacePolicyServices'
import { applyStateAction, usePerChatState } from './hooks/usePerChatState'
import { DEFAULT_CONTEXT_TURNS, clampContextTurns } from '../../main/PromptComposition'
import { resolveRuntimeProfileIdForChat } from '../../main/RuntimeProfileResolution'
import {
  buildRunLanes,
  compactPromptPreview,
  extractRunTouchedFiles,
  resolveCockpitRunSource,
  type RunLane
} from './lib/RunLanes'
import { formatOpaqueMarkdownPromptSection } from './lib/HandoffPrompt'
import { resolveContextWindow, formatContextTokens } from './lib/contextWindows'
import { rawLogFromRunEvent, type RawLogEntry } from './lib/rawLogEntry'
import { findNextRunnableQueueIndex, isTerminalRunQueueStatus } from './lib/runQueueScheduling'
import { applyRecoveryRecordsToChatRuns } from './lib/recoverChatRunTerminals'
import { visibleRunningChatIds } from './lib/runningChatVisibility'
import {
  DEFAULT_STEER_CANCEL_TIMEOUT_MS,
  DEFAULT_STEER_POLL_INTERVAL_MS,
  IDLE_STEER_STATE,
  beginSteer,
  decideSteerWait,
  getSteerIndicatorMessage,
  isSteerInFlight,
  markSteerFailed,
  resetSteer,
  transitionToDispatching,
  type SteerState
} from './lib/steerState'
import {
  shouldEngageAutoFollow,
  shouldDisengageAutoFollow,
  shouldRepinAfterFrame,
  shouldRepinAfterCodeBlockResize,
  shouldRepinAfterTranscriptResize,
  shouldShowJumpToLatestPill,
  CODE_BLOCK_RESIZE_EVENT
} from './lib/TranscriptScroll'
import { buildRunDiffByPath } from './lib/RunWorkspaceDiff'
import { shouldRunUsageRefresh } from './lib/usageRefresh'
import { shouldRenderWelcome } from './lib/welcomeState'
import { buildWelcomeCopy } from './lib/welcomeCopy'
import {
  collectDroppedAttachmentPaths,
  dedupePaths,
  getImageName,
  getImagePreviewSrc,
  isImageAttachmentPath,
  MAX_IMAGE_ATTACHMENTS,
  mergeImageAttachments,
  sanitizeImagePath,
  type ImageAttachment
} from './lib/imageAttachments'
import { parsePlanModeChoice, type PlanChoiceState } from './lib/planModeChoice'
import { messageAnchorsActivePrompt } from './lib/transcriptDeleteGuard'
import { type AgentQuestionState } from './components/AgentQuestionCard'
import {
  extractModelUsageEntriesFromStats,
  extractResetHintsFromText,
  extractUsageCount,
  extractUsageLimits,
  isProviderExecutionToolEvent,
  mergeUsageReset,
  normalizeModelName
} from './lib/usageStats'
import { formatWorkDuration } from './lib/runCompleteSummary'
import { fetchProviderRates, type RendererProviderRates } from './lib/providerRateEstimate'
import {
  getMemoryPreviewText,
  mergeCommandPaletteItems,
  normalizeDiscoveredCommandItems,
  type GeminiMemoryFile
} from './lib/geminiCommandDiscovery'
import {
  buildParticipantToolGrantPatch,
  getParticipantToolGrantIds
} from './lib/ensembleParticipantToolGrants'
import {
  buildWelcomeUsageDashboardData,
  type WelcomeUsageTab
} from './lib/welcomeUsageDashboard'
import {
  AgentAuraLayer,
  GhostCompanion,
  LivingWorkspaceLayer,
  RunDataVizLayer,
  SkyWeatherVisual,
  type AgentAuraStatus,
  type HostWeatherVisualState
} from './components/FxLayers'
import { ComposerCumulativeTimecode, ComposerRunTimecode } from './components/ComposerTimecodes'
import {
  LiveThreadTokenTally,
  estimateLiveOutputTokensFromChars
} from './components/LiveThreadTokenTally'
import { WelcomeWorkspacePicker } from './components/WelcomeWorkspacePicker'
import { WelcomeUsageDashboard } from './components/WelcomeUsageDashboard'
import { ComposerWorkspaceSwitcher } from './components/ComposerWorkspaceSwitcher'
import { TranscriptPanel } from './components/TranscriptPanel'
// Re-exported so the existing `TranscriptPanel.test.tsx` (which imports it
// from './App') keeps resolving after the component moved to its own module.
export { TranscriptPanel } from './components/TranscriptPanel'
import { formatBytes } from './lib/formatBytes'
import { FILE_DIFF_STATUSES } from './lib/fileDiffStatuses'
import { RUN_WRITE_TOOLS } from './lib/runWriteTools'
import type { RunCompleteNotice } from './lib/runCompleteNotice'
import type { PersistentSessionStatus } from './lib/persistentSessionStatus'
import { DEFAULT_AGENTIC_SERVICES } from './lib/agenticServicesDefaults'
import { EMPTY_CHAT_MESSAGES, EMPTY_IMAGE_ATTACHMENTS } from './lib/stableEmpties'
import {
  EMPTY_PERMISSION_STATE,
  type ComposerPermissionState
} from './lib/composerPermissionState'
import { createAppRunId, createMessageId } from './lib/idGenerators'
import {
  GHOST_COMPANION_STORAGE_KEY,
  ONBOARDING_HINT_DISMISSED_STORAGE_KEY,
  FIRST_LAUNCH_SHEET_DISMISSED_STORAGE_KEY,
  SKY_VISUAL_FX_STORAGE_KEY,
  getStoredGhostCompanionEnabled,
  getStoredOnboardingHintDismissed,
  getStoredFirstLaunchSheetDismissed,
  getStoredSkyVisualFxEnabled
} from './lib/localStorageFlags'
import { isFunFxMode, getLegacyFunFxSettingsFromLocalStorage } from './lib/funFxSettings'
import {
  clampGeminiTerminalHeight,
  MIN_GEMINI_TERMINAL_HEIGHT,
  DEFAULT_GEMINI_TERMINAL_HEIGHT
} from './lib/geminiTerminalHeight'

// Composer-unification (Phase J1 → slash-picker): the legacy
// CommandPaletteItem / Action / Group / Source types and the per-provider
// CORE constants live in src/renderer/src/lib/ComposerSlashCommands.ts
// so the Cmd-K palette AND the new slash picker consume the same data
// without drift. Imported here to keep their historical names in scope
// for the rest of App.tsx.
//
// Imports below the const block — see top-of-file `import` group.

const FX_BURST_DURATION_MS = 1150
/**
 * Lifetime of the post-dismissal pointer animation on the sidebar
 * `+` workspace button. After the sheet closes for the first
 * time, the pointer pulses for this many milliseconds so the user
 * can see exactly which control adds their first workspace. The
 * animation also dismisses on click anywhere — the timer is the
 * fallback floor. Kept under 7s so it never lingers if the user
 * tabs away. */
const WORKSPACE_ADD_POINTER_DURATION_MS = 6000
// Per-provider palette CORE constants moved to
// src/renderer/src/lib/ComposerSlashCommands.ts. Imported under the
// historical names (COMMAND_PALETTE_CORE / CODEX_COMMAND_PALETTE_CORE /
// CLI_PROVIDER_COMMAND_PALETTE_CORE) via the top-of-file import block,
// so existing usages downstream remain unchanged.

// sanitizeContextText moved to `src/main/PromptComposition.ts` and re-exported below.

// (Previously: `renderGeminiMessage(text)` returned `<MarkdownMessage content={text} />`.
// Removed — the transcript now calls `<MarkdownMessage content chat>` directly so
// the chat is available for `[@Name](agent://uuid)` chip lookups.)

// clampContextTurns moved to `src/main/PromptComposition.ts` and re-exported below.

const SKY_WEATHER_REFRESH_MS = 30 * 60 * 1000

// Prompt-composition helpers moved to `src/main/PromptComposition.ts` (Phase B3 step 1).
// Re-exported below from the canonical module so existing call sites keep working
// without an import-statement migration; future call sites should import directly.


/**
 * QMOD (1.0.3) — modal card rendered next to a synthetic system
 * message when an agent calls the `ask_user_question` MCP tool.
 * Reuses `.plan-choice-card` visual surface for parity with the
 * (parser-based) plan-mode picker so users have ONE mental model
 * for "agent wants my decision".
 *
 * Two paths:
 *   - Pre-set options → render each as a button. First button is
 *     focused on mount so Enter submits the first option (mirrors
 *     the AskUserQuestion UX in Claude Code).
 *   - Free-text (no options OR user clicks "Type your own answer"):
 *     surface a textarea; Cmd/Ctrl+Enter submits.
 *
 * Dismiss button always present — user can bail out and the parked
 * MCP tool call resolves with `cancelled: true`, letting the agent
 * handle "skip" semantics gracefully.
 */



const getInitialChatPopoutChatId = (): string => {
  if (typeof window === 'undefined') return ''
  const params = new URLSearchParams(window.location.search)
  return params.get('popout') === 'chat' ? params.get('chat') || '' : ''
}

const ACTIVE_RUN_QUEUE_STATUSES = new Set<RunQueueJobStatus>([
  'starting',
  'active',
  'cancelling'
])

type SidePanelPresentation = 'split' | 'drawer'
type SideChatCreateMode = 'ensembleClone' | 'singleProvider' | 'fanOut'
type SideChatSeedContext = {
  originMessageId?: string
  originRunId?: string
}
type ChatScrollState = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  scrollRatio: number
  atBottom: boolean
}
type ChatPopoutHandoffState = {
  draft?: string
  scrollState?: ChatScrollState
  writtenAt: number
}

const CHAT_POPOUT_HANDOFF_PREFIX = 'taskwraith.chatPopoutHandoff.'

function getSideChatMode(chat: ChatRecord): SideChatCreateMode {
  if (chat.sideChatContext?.mode) return chat.sideChatContext.mode
  return chat.chatKind === 'ensemble' ? 'ensembleClone' : 'singleProvider'
}

function getSideChatLifecycleState(chat: ChatRecord): SideChatLifecycleState {
  const state = chat.sideChatContext?.lifecycleState
  if (state === 'active' || state === 'closed' || state === 'terminated') return state
  return chat.archived ? 'terminated' : 'active'
}

function isTerminatedSideChat(chat: ChatRecord): boolean {
  return chat.parentChatRelation === 'sideChat' && getSideChatLifecycleState(chat) === 'terminated'
}

function applySideChatLifecycle(
  chat: ChatRecord,
  lifecycleState: SideChatLifecycleState,
  terminationReason?: string
): ChatRecord {
  if (chat.parentChatRelation !== 'sideChat') return chat
  const now = Date.now()
  const sideChatContext: ChatRecord['sideChatContext'] = {
    createdAt: chat.sideChatContext?.createdAt || chat.createdAt || now,
    ...(chat.sideChatContext || {}),
    lifecycleState
  }
  if (lifecycleState === 'active') {
    sideChatContext.openedAt = now
    sideChatContext.closedAt = undefined
    sideChatContext.terminatedAt = undefined
    sideChatContext.terminationReason = undefined
  } else if (lifecycleState === 'closed') {
    sideChatContext.closedAt = now
    sideChatContext.terminatedAt = undefined
    sideChatContext.terminationReason = undefined
  } else {
    sideChatContext.closedAt = now
    sideChatContext.terminatedAt = now
    sideChatContext.terminationReason = terminationReason || 'ended_by_user'
  }
  return {
    ...chat,
    sideChatContext,
    ...(lifecycleState === 'terminated' ? { archived: true, updatedAt: now } : {})
  }
}

function permissionPresetToApprovalMode(preset?: string): string {
  if (preset === 'read_only') return 'plan'
  if (preset === 'workspace_write' || preset === 'full_access') return 'auto_edit'
  return 'default'
}

function captureChatScrollState(scroller: HTMLElement | null | undefined): ChatScrollState | undefined {
  if (!scroller) return undefined
  const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  const scrollTop = Math.max(0, Math.min(maxScrollTop, scroller.scrollTop))
  const distanceFromBottom = maxScrollTop - scrollTop
  return {
    scrollTop,
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    scrollRatio: maxScrollTop > 0 ? scrollTop / maxScrollTop : 1,
    atBottom: distanceFromBottom <= 24
  }
}

function normalizeChatScrollState(value: unknown): ChatScrollState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  const scrollTop = Number(source.scrollTop)
  const scrollHeight = Number(source.scrollHeight)
  const clientHeight = Number(source.clientHeight)
  const scrollRatio = Number(source.scrollRatio)
  if (
    !Number.isFinite(scrollTop) ||
    !Number.isFinite(scrollHeight) ||
    !Number.isFinite(clientHeight) ||
    !Number.isFinite(scrollRatio)
  ) {
    return undefined
  }
  return {
    scrollTop: Math.max(0, scrollTop),
    scrollHeight: Math.max(0, scrollHeight),
    clientHeight: Math.max(0, clientHeight),
    scrollRatio: Math.max(0, Math.min(1, scrollRatio)),
    atBottom: Boolean(source.atBottom)
  }
}

function restoreChatScrollState(
  scroller: HTMLElement | null | undefined,
  scrollState: ChatScrollState | undefined
): void {
  if (!scroller || !scrollState) return
  const apply = () => {
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    scroller.scrollTop = scrollState.atBottom
      ? scroller.scrollHeight
      : Math.max(0, Math.min(maxScrollTop, scrollState.scrollRatio * maxScrollTop))
  }
  requestAnimationFrame(() => {
    apply()
    requestAnimationFrame(apply)
  })
}

function chatPopoutHandoffKey(chatId: string): string {
  return `${CHAT_POPOUT_HANDOFF_PREFIX}${chatId}`
}

function writeChatPopoutHandoff(chatId: string, handoff: Omit<ChatPopoutHandoffState, 'writtenAt'>): void {
  if (typeof window === 'undefined' || !chatId) return
  try {
    window.localStorage.setItem(
      chatPopoutHandoffKey(chatId),
      JSON.stringify({ ...handoff, writtenAt: Date.now() })
    )
  } catch {
    // Best-effort only. Transcript/run state still lives on the chat record.
  }
}

function readChatPopoutHandoff(chatId: string): ChatPopoutHandoffState | null {
  if (typeof window === 'undefined' || !chatId) return null
  const key = chatPopoutHandoffKey(chatId)
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    window.localStorage.removeItem(key)
    const parsed = JSON.parse(raw) as Partial<ChatPopoutHandoffState>
    return {
      ...(typeof parsed.draft === 'string' ? { draft: parsed.draft } : {}),
      ...(parsed.scrollState
        ? { scrollState: normalizeChatScrollState(parsed.scrollState) }
        : {}),
      writtenAt: typeof parsed.writtenAt === 'number' ? parsed.writtenAt : Date.now()
    }
  } catch {
    window.localStorage.removeItem(key)
    return null
  }
}

/**
 * Derive the per-thread run-complete card from a chat's PERSISTED last run
 * so the "Task complete" notice survives chat switches (the card is otherwise
 * driven by ephemeral `runCompleteNotice` state that handleSelectChat wiped).
 *
 * Returns null while the chat is currently running (the card hides for the
 * live run and reappears when the next run completes) or when there is no
 * finished run to describe. Failed / cancelled runs still surface — the
 * `exitCode` carries the outcome and the card copy reflects it, matching the
 * live setRunCompleteNotice call sites. Shape mirrors RunCompleteNotice.
 */
function deriveRunCompleteNotice(
  chat: ChatRecord,
  isRunning: boolean
): RunCompleteNotice | null {
  if (isRunning) return null
  const runs = chat.runs
  if (!Array.isArray(runs) || runs.length === 0) return null
  const lastRun = runs[runs.length - 1]
  // A run with no endedAt is still in flight (or never recorded an end) — no
  // completed outcome to show. Guards the "last run running" edge case even
  // if the running set hasn't caught up yet.
  if (!lastRun || !lastRun.endedAt) return null
  return {
    timestamp: lastRun.endedAt,
    exitCode: lastRun.exitCode ?? 0,
    startedAt: lastRun.startedAt || undefined
  }
}

function App(): React.JSX.Element {
  // Shared copy-to-clipboard feedback for every in-app copy affordance
  // (message chips, latest-response button). One instance keeps the
  // transient "Copied" state consistent across the transcript.
  const { copiedId, copy } = useCopyFeedback()
  const chatPopoutChatIdRef = useRef(getInitialChatPopoutChatId())
  const isChatPopoutWindow = Boolean(chatPopoutChatIdRef.current)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  // 1.0.7 — per-provider rate table (USD per 1M tokens) for the ensemble
  // run-complete card's projected cost estimate. Hydrated once at mount from
  // the `providerRates:get` IPC; empty until then (no estimate shown).
  const [providerRates, setProviderRates] = useState<RendererProviderRates>({})
  const [chatContextTurns, setChatContextTurns] = useState<number>(DEFAULT_CONTEXT_TURNS)
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([])
  const [workspacesHydrated, setWorkspacesHydrated] = useState(false)
  const [currentWorkspace, setCurrentWorkspace] = useState<WorkspaceRecord | null>(null)

  const [chats, setChats] = useState<ChatRecord[]>([])
  const [currentChat, setCurrentChat] = useState<ChatRecord | null>(null)
  // Phase J3: session-scoped YOLO mode visibility. Driven by main's
  // `agentic-yolo-state` broadcasts so an indicator badge can show the
  // user that approvals are being auto-allowed for the rest of the run.
  const [sessionYoloMode, setSessionYoloModeState] = useState<{
    enabled: boolean
    enabledAt: string | null
  }>({
    enabled: false,
    enabledAt: null
  })

  // Slice A: full YOLO banner is dismissible. When dismissed, a compact
  // inline chip replaces it in the composer's action row so the user
  // still has a persistent reminder that auto-approve is on. Toggling
  // YOLO off and back on resets the dismissed flag so the user
  // re-acknowledges the warning each fresh activation.
  const [yoloBannerDismissed, setYoloBannerDismissed] = useState(false)
  const previousYoloEnabledRef = useRef(sessionYoloMode.enabled)
  useEffect(() => {
    const wasEnabled = previousYoloEnabledRef.current
    const isEnabled = sessionYoloMode.enabled
    if (!wasEnabled && isEnabled) {
      // Fresh enable — show the full banner again so the user
      // re-acknowledges the trust mode.
      setYoloBannerDismissed(false)
    }
    previousYoloEnabledRef.current = isEnabled
  }, [sessionYoloMode.enabled])

  const [composerDraftsByChatId, setComposerDraftForChat] = usePerChatState('')
  const [isRunning, setIsRunning] = useState(false)
  const [queuedRuns, setQueuedRuns] = useState<QueuedRunRequest[]>([])
  // Mirror of `queuedRuns` for handlers that need synchronous
  // access without re-reading React state (esp. edit/delete/steer
  // on the queued-messages above-row).
  const queuedRunsRef = useRef<QueuedRunRequest[]>([])
  useEffect(() => {
    queuedRunsRef.current = queuedRuns
  }, [queuedRuns])
  // Phase J3 (steer): the composer's "Steer" action — interrupt the
  // active turn in this chat and dispatch a new prompt immediately.
  // Sibling of Queue (which waits passively). At most one steer flight
  // is live at a time per chat; the state machine lives in
  // `lib/steerState.ts` for unit-testability.
  const [steerState, setSteerState] = useState<SteerState>(IDLE_STEER_STATE)
  const steerStateRef = useRef<SteerState>(IDLE_STEER_STATE)
  // Chats whose in-flight assistant_message_delta + _complete events
  // should be dropped because the user clicked Steer and we're cancelling
  // the active run. Without this, providers like Codex emit a brief
  // "farewell summary" agentMessage while exiting that pollutes the
  // transcript with a mid-flow run summary the user explicitly moved
  // on from. Cleared when the cancel lands OR the steer times out (in
  // the timeout case the prior run survives so deltas are legitimate).
  const steerSuppressionChatIdsRef = useRef<Set<string>>(new Set())
  const [runQueueJobs, setRunQueueJobs] = useState<RunQueueJob[]>([])
  const [runtimeProfiles, setRuntimeProfiles] = useState<RuntimeProfile[]>([])
  const [selectedRuntimeProfileByChatId, setSelectedRuntimeProfileByChatId] = useState<
    Record<string, string>
  >({})
  const [handoffCards, setHandoffCards] = useState<HandoffCard[]>([])
  const [showCockpit, setShowCockpit] = useState(false)

  // Model & Mode Selectors
  const [activeProvider, setActiveProvider] = useState<ProviderId>('gemini')
  // 1.0.6 — Grok is now first-class (the experimental gate was lifted in GLIFT).
  // We still learn its availability from the get-provider-adapters descriptor
  // list on init: the main process registers the Grok adapter by default, so
  // this resolves true unless Grok is force-disabled (TASKWRAITH_DISABLE_GROK=1),
  // in which case the adapter is absent → this stays false → grok never shows.
  const [grokProviderAvailable, setGrokProviderAvailable] = useState(false)
  const [cursorProviderAvailable, setCursorProviderAvailable] = useState(false)
  const [selectedModelType, setSelectedModelType] = useState<string>('flash-lite')
  const [lastNonCustomModelType, setLastNonCustomModelType] = useState<string>('flash-lite')
  const [customModel, setCustomModel] = useState('')
  const [codexModels, setCodexModels] = useState<CodexModelOption[]>(CODEX_DEFAULT_MODELS)
  const [codexStatus, setCodexStatus] = useState<any>(null)
  const [codexMcpStatus, setCodexMcpStatus] = useState<any>(null)
  const [codexThreads, setCodexThreads] = useState<any[]>([])
  const [agentStatusByProvider, setAgentStatusByProvider] = useState<
    Partial<Record<ProviderId, any>>
  >({})
  const [agentMcpStatusByProvider, setAgentMcpStatusByProvider] = useState<
    Partial<Record<ProviderId, any>>
  >({})
  const [agentModelsByProvider, setAgentModelsByProvider] = useState<
    Partial<Record<ProviderId, CodexModelOption[]>>
  >({})
  const [providerCapabilitiesByProvider, setProviderCapabilitiesByProvider] = useState<
    Partial<Record<ProviderId, ProviderCapabilityContract>>
  >({})
  const [codexReasoningEffort, setCodexReasoningEffort] = useState<string>('medium')
  const [codexServiceTier, setCodexServiceTier] = useState<string>('')
  const [claudeReasoningEffort, setClaudeReasoningEffort] = useState<string>('off')
  /**
   * Claude's paid Fast tier toggle. Mirrors Codex's `codexServiceTier`;
   * Claude runs receive it as `fastMode` settings for SDK and CLI paths.
   */
  const [claudeFastMode, setClaudeFastMode] = useState<boolean>(false)
  const [kimiThinkingEnabled, setKimiThinkingEnabled] = useState<boolean>(true)
  const [approvalMode, setApprovalMode] = useState<string>('default')
  const [claudeBinaryPath, setClaudeBinaryPath] = useState('')
  const [kimiBinaryPath, setKimiBinaryPath] = useState('')
  const [claudeAuthStatus, setClaudeAuthStatus] = useState<ProviderApiKeyStatus | null>(null)
  const [kimiAuthStatus, setKimiAuthStatus] = useState<ProviderApiKeyStatus | null>(null)
  const [geminiAuthStatus, setGeminiAuthStatus] = useState<GeminiAuthStatus | null>(null)
  const [geminiAuthProfiles, setGeminiAuthProfiles] = useState<GeminiAuthProfileSummary[]>([])
  const [claudeLoginState, setClaudeLoginState] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle')
  const [agenticServices, setAgenticServices] =
    useState<AgenticServicesSettings>(DEFAULT_AGENTIC_SERVICES)
  const [autoResumeParentOnSubThreadCompletion, setAutoResumeParentOnSubThreadCompletion] =
    useState(true)
  const [agenticWorkspaceGrants, setAgenticWorkspaceGrants] = useState<AgenticWorkspaceGrant[]>([])
  const [agenticWorkspaceGrantCount, setAgenticWorkspaceGrantCount] = useState(0)
  const [geminiMcpBridgeEnabled, setGeminiMcpBridgeEnabledState] = useState(false)
  const [geminiMcpBridgeStatus, setGeminiMcpBridgeStatus] = useState<GeminiMcpBridgeStatus | null>(
    null
  )
  const [codexSandboxFallback, setCodexSandboxFallback] =
    useState<CodexSandboxFallbackMode>('ask_rerun')
  const [updateChannel, setUpdateChannel] = useState<ProductUpdateChannel>('stable')
  const [approvalTimeouts, setApprovalTimeouts] = useState<AppSettings['approvalTimeouts']>({
    enabled: true,
    perProviderMs: { gemini: 120_000, codex: 30_000, claude: 120_000, kimi: 60_000 },
    mainAuthorityMs: 60_000
  })
  const [productOperationsStatus, setProductOperationsStatus] =
    useState<ProductOperationsStatus | null>(null)

  // Trust & Session
  const [trustResult, setTrustResult] = useState<any>(null)
  const [sessionTrust, setSessionTrust] = useState(false)
  // #272: inline feedback for the one-click persistent-trust button.
  // null = no message; set to a human string on write failure, cleared
  // on success (the trust state flip is the success signal).
  const [geminiTrustWriteError, setGeminiTrustWriteError] = useState<string | null>(null)
  const [geminiTrustWriteBusy, setGeminiTrustWriteBusy] = useState(false)
  const [showTerminal, setShowTerminal] = useState(false)
  const [isPersistentSessionEnabled, setIsPersistentSessionEnabled] = useState(false)
  const [persistentSessionStatus, setPersistentSessionStatus] =
    useState<PersistentSessionStatus>('idle')
  const [persistentSessionNeedsRestart, setPersistentSessionNeedsRestart] = useState(false)
  const [geminiCheckpointingEnabled, setGeminiCheckpointingEnabled] = useState(false)
  // Phase M1 Step 6 — Gemini API runtime mode. Defaults to 'auto' (the
  // same default the main store applies on first load). The actual
  // API-vs-CLI dispatch lives in main; this state is only used by the
  // Settings UI to surface the picker and the runtime status row.
  const [geminiApiRuntime, setGeminiApiRuntime] = useState<GeminiApiRuntimeMode>('auto')

  // Diff & Logs
  const [rawLogs, setRawLogs] = useState<RawLogEntry[]>([])
  const [rawFilter, setRawFilter] = useState<'all' | 'stdout' | 'stderr' | 'tool'>('all')
  const [diff, setDiff] = useState<any>(null)
  const [runDiff, setRunDiff] = useState<DiffFileSummary[] | null>(null)
  const [diffView, setDiffView] = useState<'this_run' | 'workspace'>('workspace')
  const [diffRefreshStatus, setDiffRefreshStatus] = useState<string>('')
  const [isPreparingDiffReview, setIsPreparingDiffReview] = useState(false)

  const currentRunWarningsRef = useRef<RunWarning[]>([])
  const preSnapshotRef = useRef<any>(null)

  // Right Panel Tabs
  const [rightTab, setRightTab] = useState<
    'diff' | 'raw' | 'delegation' | 'timeline' | 'safety' | 'capabilities' | 'background-tasks'
  >('diff')

  // Version Preflight
  const [geminiVersion, setGeminiVersion] = useState<string>('unknown')

  // Appearance & Settings
  const appearance = useAppearance()
  const [showSettings, setShowSettings] = useState(false)
  // Active Settings tab. Hoisted from `SettingsPanel`'s internal
  // state because the full-app takeover layout renders the tab list
  // in a sibling `SettingsSidebar` — both render sites need to read
  // and drive the same value. Remembered across opens so the user
  // re-enters Settings on whichever tab they were on last.
  const [settingsActiveTab, setSettingsActiveTab] = useState<SettingsTab>('appearance')
  // Pairing trigger callback. Opens the Settings takeover on the
  // Pairing tab — see also the legacy `setShowPairingSheet(true)`
  // call sites that have been updated to use this helper instead.
  // Wrapped in a function so the trigger can be passed as a prop
  // without binding identity to render output.
  // Phase F1: sub-thread creator modal state. Null when closed; holds
  // the parent chat when open so the modal knows what to delegate from.
  const [subThreadCreatorParent, setSubThreadCreatorParent] = useState<ChatRecord | null>(null)
  // EnsembleSetupSheet retired in 1.0.3 — no modal state required.
  // EnsembleParticipantsAboveRow handles configuration inline.
  const [showWorkspaceSidebar, setShowWorkspaceSidebar] = useState(() => !isChatPopoutWindow)
  const [workspaceSidebarWidth, setWorkspaceSidebarWidth] = useState(getStoredWorkspaceSidebarWidth)
  /**
   * First-launch onboarding hint visibility. Renders a faint
   * "Click + above to add your first workspace" card under the
   * sidebar's `+` button. Default: visible if the user hasn't
   * explicitly dismissed it. The `?` button in the chat-corner-
   * controls-left lets existing users manually re-open the hint
   * for demo / testing purposes even after dismissal.
   */
  const [showOnboardingHint, setShowOnboardingHint] = useState<boolean>(
    () => !getStoredOnboardingHintDismissed()
  )
  const handleDismissOnboardingHint = useCallback(() => {
    setShowOnboardingHint(false)
    try {
      window.localStorage.setItem(ONBOARDING_HINT_DISMISSED_STORAGE_KEY, 'true')
    } catch {
      /* localStorage may be disabled — non-fatal */
    }
  }, [])
  /**
   * Full-modal first-launch onboarding sheet. Auto-shows on a fresh
   * install (dismissal flag absent from localStorage) and can be
   * re-opened at any time via the `?` button in the chat-corner
   * controls. Distinct from the lightweight T1b sidebar hint which
   * stays as an inline reminder once the sheet is closed.
   */
  const [showFirstLaunchSheet, setShowFirstLaunchSheet] = useState<boolean>(
    () => !getStoredFirstLaunchSheetDismissed()
  )
  /**
   * Transient "this is the button" pointer that pulses around the
   * sidebar `+` workspace button after the FirstLaunchSheet
   * dismisses for the very first time. Lifetime is bounded by
   * `WORKSPACE_ADD_POINTER_DURATION_MS` and an early-click escape
   * hatch — never persists across launches. */
  const [workspaceAddPointerActive, setWorkspaceAddPointerActive] = useState(false)
  const workspaceAddPointerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleDismissFirstLaunchSheet = useCallback(() => {
    setShowFirstLaunchSheet(false)
    let wasFirstDismissal = false
    try {
      wasFirstDismissal =
        window.localStorage.getItem(FIRST_LAUNCH_SHEET_DISMISSED_STORAGE_KEY) !== 'true'
      window.localStorage.setItem(FIRST_LAUNCH_SHEET_DISMISSED_STORAGE_KEY, 'true')
    } catch {
      /* localStorage may be disabled — treat as not-first-dismissal so
       * the pointer animation doesn't kick in spuriously every time
       * the user re-opens and closes the sheet. */
      wasFirstDismissal = false
    }
    if (!wasFirstDismissal) return
    // First-time dismissal: light up the sidebar `+` pointer for
    // the configured window. A subsequent click anywhere on the
    // app surface fires the cleanup branch below to dismiss early.
    setWorkspaceAddPointerActive(true)
    if (workspaceAddPointerTimerRef.current) {
      clearTimeout(workspaceAddPointerTimerRef.current)
    }
    workspaceAddPointerTimerRef.current = setTimeout(() => {
      setWorkspaceAddPointerActive(false)
      workspaceAddPointerTimerRef.current = null
    }, WORKSPACE_ADD_POINTER_DURATION_MS)
  }, [])
  // Pointer dismisses early on any user click. Stays out of the
  // way once `setWorkspaceAddPointerActive(false)` runs.
  useEffect(() => {
    if (!workspaceAddPointerActive) return
    const dismissPointer = (): void => {
      setWorkspaceAddPointerActive(false)
      if (workspaceAddPointerTimerRef.current) {
        clearTimeout(workspaceAddPointerTimerRef.current)
        workspaceAddPointerTimerRef.current = null
      }
    }
    window.addEventListener('pointerdown', dismissPointer, { once: true })
    return () => window.removeEventListener('pointerdown', dismissPointer)
  }, [workspaceAddPointerActive])
  // Cleanup on unmount — never leave a stray timer.
  useEffect(() => {
    return () => {
      if (workspaceAddPointerTimerRef.current) {
        clearTimeout(workspaceAddPointerTimerRef.current)
      }
    }
  }, [])

  /**
   * 1.0.5-EW35 — Currency sub-slice (c): hydrate `formatCost`'s
   * in-memory FX rate table from the main-side `FxRateService` once
   * on mount. Main keeps the cache fresh in the background (12h
   * interval) and on app boot reads the cache file first, so this
   * read returns almost immediately — even before the first live
   * fetch resolves. If the read fails for any reason we leave the
   * baked-in EW25 fallback constants in place, so `formatCost`
   * always has usable rates.
   *
   * This is intentionally one-shot. The live-refresh interval lives
   * main-side; a future "refresh now" button can re-call
   * `api.refreshFxRates(true)` and re-hydrate, but for normal usage
   * one read at mount is enough — the rates barely move during a
   * session.
   */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const snapshot = await window.api.getFxRates()
        if (cancelled || !snapshot?.rates) return
        setFxRatesPerUsd(snapshot.rates)
      } catch {
        // Silent — baked-in EW25 constants remain in effect.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  /**
   * 1.0.7 — one-shot fetch of the per-provider rate table over the existing
   * `providerRates:get` IPC. Powers the ensemble run-complete card's projected
   * cost ESTIMATE for subscription/credit seats (Codex / Grok / Cursor) that
   * report no `cost_usd`. The rates are USD per 1M tokens and barely change
   * during a session, so one read at mount is enough; on failure we leave the
   * map empty and simply render no estimate.
   */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const rates = await fetchProviderRates()
      if (cancelled) return
      setProviderRates(rates)
    })()
    return () => {
      cancelled = true
    }
  }, [])
  /**
   * Inline bug-report sheet. The tester opens this from the
   * "!" button next to the onboarding `?` button, describes whatever
   * he just hit, and the main process appends a markdown record to
   * `<userData>/TaskWraith/bug-reports.md` for later triage. No persisted draft
   * state — the sheet
   * resets every open. */
  const [showBugReportSheet, setShowBugReportSheet] = useState(false)
  const updateStatus = useUpdateStatus()
  const [showChangelogSheet, setShowChangelogSheet] = useState(false)
  const [changelogSnapshot, setChangelogSnapshot] = useState<ProductChangelogSnapshot | null>(null)
  const autoChangelogOpenedRef = useRef(false)
  const refreshChangelogSnapshot =
    useCallback(async (): Promise<ProductChangelogSnapshot | null> => {
      try {
        const next = await window.api.changelogSnapshot()
        setChangelogSnapshot(next)
        return next
      } catch {
        return null
      }
    }, [])
  const handleOpenChangelogSheet = useCallback(() => {
    setShowChangelogSheet(true)
    void refreshChangelogSnapshot()
  }, [refreshChangelogSnapshot])
  /** 1.0.4-AK2 — Work Session setup sheet open/closed state.
   * Opened by the composer's "Work Session" button (alongside
   * Turn/Continuous). On confirm, persists the WorkSessionConfig
   * onto chat.ensemble + pre-fills the composer with the first-round
   * prompt so the user clicks Send to launch (avoids re-implementing
   * the full send-message payload composition here). */
  const [showWorkSessionSheet, setShowWorkSessionSheet] = useState(false)
  /** Fetched once on mount so the BugReportSheet's auto-captured row
   * shows the same version string the main process will stamp into
   * the file. Falls back to "unknown" before the IPC resolves so the
   * UI never flashes empty. */
  const [appVersion, setAppVersion] = useState<string>('unknown')
  useEffect(() => {
    let cancelled = false
    const api = window.api as typeof window.api & {
      getAppVersion?: () => Promise<string>
    }
    if (typeof api.getAppVersion !== 'function') return
    api
      .getAppVersion()
      .then((version) => {
        if (!cancelled && typeof version === 'string' && version.trim()) {
          setAppVersion(version)
        }
      })
      .catch(() => {
        /* Non-fatal — the sheet displays "unknown" and the main
         * process stamps the canonical version on the file regardless. */
      })
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => {
    void refreshChangelogSnapshot()
  }, [refreshChangelogSnapshot])
  useEffect(() => {
    if (autoChangelogOpenedRef.current) return
    if (!changelogSnapshot || appVersion === 'unknown') return
    if (changelogSnapshot.pendingUpdateChangelog?.version !== appVersion) return
    if (changelogSnapshot.lastSeenChangelogVersion === appVersion) return
    autoChangelogOpenedRef.current = true
    setShowChangelogSheet(true)
  }, [appVersion, changelogSnapshot])
  const handleDismissChangelogSheet = useCallback(() => {
    setShowChangelogSheet(false)
    const pendingVersion = changelogSnapshot?.pendingUpdateChangelog?.version
    if (!pendingVersion || pendingVersion !== appVersion) return
    if (changelogSnapshot?.lastSeenChangelogVersion === appVersion) return
    void window.api
      .markChangelogSeen(appVersion)
      .then((next) => setChangelogSnapshot(next))
      .catch(() => {})
  }, [appVersion, changelogSnapshot])
  const handleSubmitBugReport = useCallback(
    async (submission: BugReportSubmission): Promise<void> => {
      const api = window.api as typeof window.api & {
        submitBugReport?: (
          payload: BugReportSubmission
        ) => Promise<{ ok: boolean; path?: string; error?: string }>
      }
      if (typeof api.submitBugReport !== 'function') {
        throw new Error('Bug-report bridge is not available — please update the app.')
      }
      const result = await api.submitBugReport(submission)
      if (!result?.ok) {
        throw new Error(result?.error || 'Main process refused the report.')
      }
    },
    []
  )
  const [showFileEditor, setShowFileEditor] = useState(false)
  const [showGeminiTerminal, setShowGeminiTerminal] = useState(false)
  const [geminiTerminalInputByChatId, setGeminiTerminalInputForChat] = usePerChatState('')
  const [geminiTerminalHeight, setGeminiTerminalHeight] = useState(DEFAULT_GEMINI_TERMINAL_HEIGHT)
  const [isChatMediaPanelOpen, setIsChatMediaPanelOpen] = useState(false)
  const [previewChatMediaRef, setPreviewChatMediaRef] = useState<ChatMediaRef | null>(null)
  const [showGhostCompanion, setShowGhostCompanion] = useState(getStoredGhostCompanionEnabled)
  const [showSkyVisualFx, setShowSkyVisualFx] = useState(getStoredSkyVisualFxEnabled)
  const [hostWeather, setHostWeather] = useState<HostWeatherVisualState | null>(null)
  const [fxBurstClass, setFxBurstClass] = useState('')
  const [fileEditorWidth, setFileEditorWidth] = useState(getStoredFileEditorWidth)
  const [sideChatWidth, setSideChatWidth] = useState(DEFAULT_SIDE_CHAT_WIDTH)
  const [runCompleteNotice, setRunCompleteNotice] = useState<RunCompleteNotice | null>(null)
  const [chatContextNotice, setChatContextNotice] = useState<{
    id: string
    message: string
  } | null>(null)
  const [usageSummary, setUsageSummary] = useState<ModelUsageAggregate[]>([])
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([])
  const [welcomeUsageTab, setWelcomeUsageTab] = useState<WelcomeUsageTab>('overview')
  // Welcome L7 — fixed 30-day rolling window; the toggle UI is gone.
  // (Builder still accepts the range param so the lib stays flexible
  // for future surfaces; this is the single canonical caller.)
  const saveChatTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const lastUsageWindowsByProviderRef = useRef<Record<ProviderId, UsageWindowAggregate[]>>({
    gemini: [],
    codex: [],
    claude: [],
    kimi: [],
    grok: [],
    cursor: []
  })
  const usageSummarySignatureRef = useRef('')
  const usageRecordsSignatureRef = useRef('')
  // Autonomous-refresh plumbing — see the matching `useEffect` below for the
  // heartbeat that polls usage IPC on a 90s cadence without touching focused
  // UI state. The ref-to-latest pattern keeps the timer stable across renders
  // so we don't tear down & reinstall it whenever `codexStatus` changes.
  const refreshUsageSummaryRef = useRef<
    (_workspaceId?: string, _providerHint?: ProviderId, codexStatusHint?: any) => Promise<void>
  >(async () => {})
  const usageRefreshInFlightRef = useRef(false)
  const usageRefreshLastFiredAtRef = useRef<number | null>(null)
  const [imageAttachmentsByChatId, setImageAttachmentsByChatId] = useState<
    Record<string, ImageAttachment[]>
  >({})
  const [permissionRequestByChatId, setPermissionRequestByChatId] = useState<
    Record<string, ComposerPermissionState>
  >({})
  const [
    pendingAgentApprovalByChatId,
    setPendingAgentApprovalForChatId,
    setPendingAgentApprovalByChatId
  ] = usePerChatState<AgentApprovalRequest | null>(null)
  /**
   * 1.0.4-AK4 — approval queue tail per chat. Holds extra
   * approvals that arrived while another was already pending for
   * the same chat. Pre-AK4 the second arrival would overwrite the
   * first; with parallel fan-out (AK5/AK6) N concurrent runs each
   * blocking on their own approval is the normal case, so we now
   * keep them in a FIFO and surface the depth via a "+N more"
   * badge in the modal.
   *
   * Lifecycle:
   *   - Arrival (`onAgentApprovalRequest`): if `pendingAgentApprovalByChatId`
   *     already has a value for this chat, push the new request
   *     onto this queue. Otherwise set it as the visible head.
   *   - Decision (`handleAgentApprovalAction`): after responding,
   *     shift the next from this queue into the head. Empty queue
   *     → head goes to null as before.
   *   - Timeout (`onAgentApprovalTimeout`): same as decision —
   *     shift the next queued approval into the head.
   *
   * Storing the queue separately from the head keeps every
   * existing consumer that reads `pendingAgentApprovalByChatId[id]`
   * as a single value working unchanged.
   */
  const [pendingApprovalQueueByChatId, setPendingApprovalQueueByChatId] = useState<
    Record<string, AgentApprovalRequest[]>
  >({})
  // Order-4 — optional one-line "why" note the user can attach to an
  // approval decision. Rides the existing approval-ledger metadata
  // channel as `{ intentNote }` (no schema migration). At most one
  // approval card is on screen at a time (the queue head), so a single
  // string suffices; it's cleared whenever an approval resolves so the
  // next queued request starts blank.
  const [intentNote, setIntentNote] = useState('')
  const [isSendConfirming, setIsSendConfirming] = useState(false)
  // 1.0.6-EW66-1d — Create-PR state is now keyed by workspace PATH
  // so the primary workspace and each WRITE-access additional
  // workspace track their own pending/success/error independently.
  // The primary is keyed by `currentWorkspace.path`; write grants by
  // `grant.path`. (Same-path grants in an ensemble share one entry,
  // so all rows for a repo reflect that repo's PR state coherently.)
  type CreatePrState = {
    status: 'idle' | 'pending' | 'success' | 'error'
    message?: string
  }
  const [createPrStateByPath, setCreatePrStateByPath] = useState<Record<string, CreatePrState>>({})
  const getCreatePrState = (path: string | null | undefined): CreatePrState =>
    (path && createPrStateByPath[path]) || { status: 'idle' }
  const setCreatePrStateFor = (path: string, next: CreatePrState): void =>
    setCreatePrStateByPath((prev) => ({ ...prev, [path]: next }))
  const [diffActionMenuOpen, setDiffActionMenuOpen] = useState(false)
  // Live git snapshot lifted out of the GitCommitControls menu so the
  // above-bar header can surface real repo state (branch, changed-file
  // count, staged/unstaged, push/PR readiness) sourced from
  // `gitSnapshot` rather than the stale `currentWorkspace.branch` /
  // tool-derived diff counts. Null until the menu opens (lazy fetch) or
  // the repo read fails.
  const [primaryGitSnapshot, setPrimaryGitSnapshot] = useState<GitRepositorySnapshot | null>(null)
  // PR check rollup for the current workspace, lifted alongside the snapshot so
  // the unified workspace line shows CI without a separate git-status row.
  const [primaryPr, setPrimaryPr] = useState<GitPrSummary | null>(null)
  // P4 — live git snapshot per unique external-workspace path, so each collapsed
  // additional-workspace row shows git-grounded "N files changed +A −B" that
  // resets on commit (same as the primary). Keyed by path.
  const [externalGitSnapshots, setExternalGitSnapshots] = useState<
    Record<string, GitRepositorySnapshot | null>
  >({})
  const currentWorkspacePath = currentWorkspace?.path
  // Eagerly fetch the live git snapshot for the current workspace so the
  // above-bar shows real repo state (changed-file count, +/- lines, clean)
  // WITHOUT waiting for the diff-action menu to open. Refetches on workspace
  // change, on run-finish (runCompleteNotice.timestamp) so a just-finished
  // edit shows immediately, and on window focus so an external commit that
  // cleans the tree drops the count to 0 — the Codex/Claude-style git
  // grounding. GitCommitControls' onSnapshot writes the SAME state, so
  // opening/using the menu (incl. committing) just refreshes it.
  useEffect(() => {
    if (!currentWorkspacePath) {
      setPrimaryGitSnapshot(null)
      setPrimaryPr(null)
      return
    }
    let cancelled = false
    const fetchSnapshot = async (): Promise<void> => {
      try {
        const res = await window.api.gitSnapshot({ workspacePath: currentWorkspacePath })
        const snap = res?.ok ? res.data : null
        if (cancelled) return
        setPrimaryGitSnapshot(snap)
        // CI is best-effort + slower (gh CLI) — only when the repo has a remote.
        if (!snap?.remoteUrl) {
          setPrimaryPr(null)
          return
        }
        try {
          const prRes = await window.api.githubPrStatus({ workspacePath: currentWorkspacePath })
          if (!cancelled) setPrimaryPr(prRes?.ok ? prRes.data : null)
        } catch {
          if (!cancelled) setPrimaryPr(null)
        }
      } catch {
        /* keep the last good snapshot on a transient read failure */
      }
    }
    void fetchSnapshot()
    const onFocus = (): void => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        void fetchSnapshot()
      }
    }
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
    }
  }, [currentWorkspacePath, runCompleteNotice?.timestamp])
  const [isComposerDragOver, setIsComposerDragOver] = useState(false)
  type AttachedWindowSnapshot = {
    handleID: string
    windowMeta: {
      windowID: number
      title: string
      bundleID: string
      applicationName: string
      pid: number
    }
    attachedAt: string
    // Phase M1 — set by main when Appwatch is running for this handle. The
    // pill flips to its `is-streaming` variant whenever this field is set;
    // bare `attached` (no streaming) still uses the original visual.
    streaming?: {
      fps: number
      bufferSeconds: number
      frameCount: number
      startedAt: string
    }
  }
  const [attachedWindow, setAttachedWindow] = useState<AttachedWindowSnapshot | null>(null)
  const [nativeCapabilities, setNativeCapabilities] = useState<NativeCapabilitySnapshot | null>(
    null
  )
  // 1.0.5-AU — Track which chat owns the current attachment so we
  // can auto-detach when the user switches away. Pre-AU the
  // `attachedWindow` state was app-global: attach in Chat A, switch
  // to Chat B, and the Screen Watch button in B still showed
  // "Watching <app>" because the renderer state hadn't reset. Worse,
  // tools called from Chat B would observe Chat A's stream — a real
  // cross-chat leak.
  //
  // Conservative scoping: the attachment belongs to the chat it was
  // created in. Switching to ANY other chat triggers a detach so each
  // chat starts with a clean slate. Per-chat sticky attachments
  // (switch back to Chat A and the attachment reactivates) are
  // deferred to 1.0.6 — they need main-side state restructuring +
  // Swift daemon re-attach plumbing that's more than this slice can
  // safely land.
  const attachedWindowOwnerChatIdRef = useRef<string | null>(null)
  // M11 (1.0.7) — sticky AppWatch. When the current chat has a remembered
  // attachment (stashed on a prior auto-detach, persisted across restart), this
  // holds its metadata so the composer can offer a one-tap "Resume watching
  // <app>". Null when the current chat has no stash. macOS can't silently
  // re-grant the window, so resume re-opens the picker — this is the affordance,
  // not a live attachment.
  const [resumeAppWatchSnapshot, setResumeAppWatchSnapshot] = useState<{
    chatId: string
    windowMeta: {
      windowID: number
      title: string
      bundleID: string
      applicationName: string
      pid: number
    }
    wasStreaming: boolean
  } | null>(null)
  const screenWatchUnavailableReason =
    nativeCapabilities && !nativeCapabilities.screenWatch.available
      ? nativeCapabilities.screenWatch.reason || 'Appwatch/Appshots are macOS-only in v1.'
      : null
  useEffect(() => {
    if (!diffActionMenuOpen) return
    const closeFromPointer = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.composer-diff-action-menu-wrap')) return
      setDiffActionMenuOpen(false)
    }
    const closeFromEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setDiffActionMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', closeFromPointer, true)
    document.addEventListener('keydown', closeFromEscape, true)
    return () => {
      document.removeEventListener('mousedown', closeFromPointer, true)
      document.removeEventListener('keydown', closeFromEscape, true)
    }
  }, [diffActionMenuOpen])
  const [isAttachingWindow, setIsAttachingWindow] = useState(false)
  const [pendingPlanChoiceByChatId, setPendingPlanChoiceForChat] =
    usePerChatState<PlanChoiceState | null>(null)
  // QMOD (1.0.3) — per-chat pending agent question state. Driven by the
  // `agent-question-requested` IPC event from main. Cleared on submit /
  // dismiss / cancellation. See AgentQuestionState type for shape.
  const [pendingAgentQuestionByChatId, setPendingAgentQuestionForChat] =
    usePerChatState<AgentQuestionState | null>(null)
  const [commandPaletteOpenByChatId, setCommandPaletteOpenForChat] = usePerChatState(false)
  const [commandPaletteQueryByChatId, setCommandPaletteQueryForChat] = usePerChatState('')
  const [discoveredCommands, setDiscoveredCommands] = useState<CommandPaletteItem[]>([])
  const [commandDiscoveryStatus, setCommandDiscoveryStatus] = useState(
    'Static Gemini commands loaded.'
  )
  const [isMemoryInspectorOpen, setIsMemoryInspectorOpen] = useState(false)
  const [geminiMemoryFiles, setGeminiMemoryFiles] = useState<GeminiMemoryFile[]>([])
  const [geminiMemoryStatus, setGeminiMemoryStatus] = useState(
    'GEMINI.md memory has not been inspected yet.'
  )
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([])
  const [scheduleRunAtByChatId, setScheduleRunAtForChat] = usePerChatState('')
  const [dueScheduledTasks, setDueScheduledTasks] = useState<ScheduledTask[]>([])
  const [runningChatIds, setRunningChatIds] = useState<Set<string>>(new Set())

  const imageDragCounterRef = useRef(0)
  const sendConfirmationTimeoutRef = useRef<number | null>(null)

  // Error handling & Fallback
  const [showFallbackUX, setShowFallbackUX] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const errorCountRef = useRef(0)
  const toolCallsCountRef = useRef(0)

  // Phase K1B: when set, the chat panel renders `<RunInspector />` in
  // place of the transcript scroll. Entered via RunCard's "Inspect →"
  // affordance; cleared via the inspector's close button or by switching
  // chats. The composer stays mounted below either way.
  const [inspectingRunId, setInspectingRunId] = useState<string | null>(null)
  const [sideChatId, setSideChatId] = useState<string | null>(null)
  const [sidePanelPresentation, setSidePanelPresentation] =
    useState<SidePanelPresentation>('split')
  const [sideChatMenuOpen, setSideChatMenuOpen] = useState(false)
  const [sideChatSeedMessageId, setSideChatSeedMessageId] = useState<string | null>(null)

  // Reset inspector when the user navigates to a chat that doesn't own
  // the currently-inspected run. Conditional (not unconditional) because
  // the sidebar's inspect-from-Active-Runs flow navigates to a chat AND
  // sets inspectingRunId in the same handler: if we cleared blindly on
  // chat change, that flow would race and the inspector would close
  // immediately. Gating on ownership lets both flows work: switching to
  // an unrelated chat still clears (stale runId), but switching to a
  // chat that contains the run keeps the inspector open.
  useEffect(() => {
    if (!inspectingRunId) return
    const runs = currentChat?.runs || []
    const runBelongsToCurrentChat = runs.some((r) => r.runId === inspectingRunId)
    if (!runBelongsToCurrentChat) {
      setInspectingRunId(null)
    }
  }, [currentChat?.appChatId, currentChat?.runs, inspectingRunId])

  const logsEndRef = useRef<HTMLDivElement>(null)
  const rawLogsEndRef = useRef<HTMLDivElement>(null)
  const geminiTerminalEndRef = useRef<HTMLDivElement>(null)
  const chatSplitRegionRef = useRef<HTMLDivElement>(null)
  const appTranscriptRef = useRef<HTMLDivElement>(null)
  const transcriptScrollRef = useRef<HTMLDivElement>(null)
  const sideTranscriptScrollRef = useRef<HTMLDivElement>(null)
  const sideTranscriptContentRef = useRef<HTMLDivElement>(null)
  const sideLogsEndRef = useRef<HTMLDivElement>(null)
  const sideComposerTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const sideChatMenuRef = useRef<HTMLDivElement | null>(null)
  const getSideChatMaxWidth = useCallback((): number => {
    const regionWidth =
      chatSplitRegionRef.current?.getBoundingClientRect().width || window.innerWidth
    return Math.min(
      MAX_SIDE_CHAT_WIDTH,
      Math.max(MIN_SIDE_CHAT_WIDTH, Math.floor(regionWidth * 0.62))
    )
  }, [])
  // Ref pinned to the SINGLE inner content div inside `transcriptScrollRef`
  // (rendered as `.transcript-inner` in `TranscriptPanel`). A single
  // `ResizeObserver` watches this node and dispatches a coalesced rAF
  // re-pin whenever it grows or shrinks — catching ALL late-mount
  // layout sources (CodeMirror code blocks, ActivityStack rows
  // revealing tool-result output, shell-command stdout that measures
  // asynchronously, future content types). See the
  // `shouldRepinAfterTranscriptResize` doc comment for why this does
  // NOT reintroduce the historical RO feedback loop.
  const transcriptContentRef = useRef<HTMLDivElement>(null)
  // autoFollowRef tracks whether the transcript should auto-stick to the bottom
  // as new content streams in. The user "owns" scroll: once they scroll away
  // from the bottom auto-follow disengages until they scroll back near the
  // bottom. Thresholds and the post-frame re-pin policy live in
  // `lib/TranscriptScroll` so they can be unit-tested. Stored in a ref to
  // avoid re-renders.
  const autoFollowRef = useRef(true)
  const sideAutoFollowRef = useRef(true)
  // Tracks whether the user has initiated a real upward scroll (wheel,
  // touchmove, page-up/arrow-up) since the last paint. The post-frame
  // re-pin in the messages-update layoutEffect is suppressed when this is
  // true, so a deliberate scroll-away is never fought by the rAF callback.
  // Cleared at the start of each layoutEffect pass.
  const userScrolledAwayInFrameRef = useRef(false)
  // Holds the rAF id for the pending post-frame re-pin so consecutive
  // streaming updates can coalesce into a single re-pin write per frame.
  const repinRafIdRef = useRef<number | null>(null)
  // "↓ N new messages" jump-to-latest pill state (Slack/Discord/YouTube
  // pattern). After the 1.0.4 race-window fix the user can scroll up
  // freely without auto-scroll fighting them — but they had no visible
  // signal that messages were still arriving below. The pill makes that
  // *absence* of auto-scroll visible.
  //
  // Two-piece state by design: a React state for the rendered count
  // (drives the pill text + visibility) plus a paired ref for reads
  // inside layout effects that must observe the latest value without
  // waiting for a re-render. The ref shadows the state on every write
  // so layout-effect increments and scroll-listener resets stay in
  // lockstep with the rendered count.
  const [unreadFromBottomCount, setUnreadFromBottomCount] = useState(0)
  const unreadFromBottomCountRef = useRef(0)
  // Per-chat baseline for computing the new-message delta on each
  // messages-update pass. Keyed by chatId so a chat switch is
  // self-correcting: when the id flips, the layout effect treats the
  // current length as the new baseline rather than counting the full
  // length of the newly-active chat as "unread". The chat-switch
  // useEffect at the bottom of this scroll block additionally resets
  // the count to zero so the pill never carries over across threads.
  const previousMessagesCountRef = useRef<{ chatId: string | null; count: number }>({
    chatId: null,
    count: 0
  })
  // Click/keypress handler for the jump-to-latest pill. Re-engages
  // auto-follow eagerly (so subsequent streaming ticks re-pin without
  // waiting for the smooth scroll to land), clears the unread count
  // immediately (so the pill fades as the scroll begins rather than
  // lingering through the smooth animation), and kicks a smooth
  // scroll-to-bottom on the transcript scroller. Stable identity via
  // useCallback so it can be passed to scroller-scoped event listeners
  // through a ref without forcing those listeners to re-bind.
  const handleJumpToLatest = useCallback(() => {
    const scroller = transcriptScrollRef.current
    if (!scroller) return
    autoFollowRef.current = true
    userScrolledAwayInFrameRef.current = false
    if (unreadFromBottomCountRef.current !== 0) {
      unreadFromBottomCountRef.current = 0
      setUnreadFromBottomCount(0)
    }
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
  }, [])
  // Ref shadow of `handleJumpToLatest` so the scroller's keydown
  // listener (registered once with an empty-deps useEffect) can
  // invoke the latest callback without re-binding. The callback is
  // already useCallback'd with [] so this is belt-and-braces — the
  // ref also gives us a single read site if we later want to
  // hot-swap the implementation under test.
  const handleJumpToLatestRef = useRef(handleJumpToLatest)
  handleJumpToLatestRef.current = handleJumpToLatest
  // Raw Events panel auto-follow mirror of the transcript pair above.
  // The Inspector's Raw Events tab streams every run event as it arrives;
  // an earlier implementation unconditionally scrolled the panel to the
  // bottom whenever `rawLogs.length` changed, which made it impossible
  // for the user to scroll up and read earlier events during an active
  // run. The fix reuses the same `lib/TranscriptScroll` engage/disengage
  // helpers and intent-detection wheel/touch/key listeners so the two
  // surfaces share one truth source for "sticky bottom" semantics.
  const rawEventsAutoFollowRef = useRef(true)
  const rawEventsUserScrolledAwayRef = useRef(false)
  const composerAreaRef = useRef<HTMLDivElement>(null)
  // Composer textarea + @-mention popover state. AgentMentionMenu can insert
  // agent markdown mentions or plain path text at the caret.
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  // Caret position of the `@` (or `-` of `-@`) that opened the menu —
  // used to splice the picked mention back over the trigger.
  const mentionAnchorIndexRef = useRef<number | null>(null)
  /**
   * 1.0.4-AQ3 — composer textarea selection ref + epoch.
   *
   * Captures `{ start, end }` immediately on every `onChange` so a
   * post-commit layout effect can restore the caret if React's
   * controlled-input caret preservation didn't fire correctly. The
   * preservation glitches when the textarea's className flips
   * mid-keystroke — specifically when `composerHasMention` flips
   * `false → true` once an `@token` resolves, adding the
   * `has-mention-overlay` class AND mounting the
   * `ComposerHighlightOverlay` sibling in the same commit. The
   * class-change + sibling-mount race against React's caret-keep
   * heuristic and the caret can land at the end of the text instead
   * of where the user was typing.
   *
   * The epoch ensures we only attempt restoration when the user
   * actually changed the value (not on unrelated re-renders triggered
   * by other state).
   */
  const composerSelectionRef = useRef<{ start: number; end: number } | null>(null)
  const composerCaretRestoreEpochRef = useRef(0)
  // Which trigger fired the popover. `'mention'` (`@`) → sub-agents
  // (normal chats) or participants (ensemble); `'file-mention'`
  // (`-@`) → workspace files + external grants. Tracked alongside
  // the anchor so the pick handler knows how many characters to
  // strip (1 for `@`, 2 for `-@`).
  const [mentionTriggerKind, setMentionTriggerKind] = useState<'mention' | 'file-mention'>(
    'mention'
  )
  const mentionTriggerLengthRef = useRef<number>(1)
  // Slash-command picker state. Same shape as the mention menu — visibility
  // flag, current filter substring (what comes after the leading `/`), and
  // an anchor index pointing at the `/` we'll later replace on pick.
  // Mutually exclusive with mentionMenuOpen — only one popover at a time.
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const slashAnchorIndexRef = useRef<number | null>(null)
  const adapterRef = useRef<GeminiStreamAdapter | null>(null)
  const activeRunsRef = useRef<Map<string, ActiveRunContext>>(new Map())
  // Phase K1 — short-window completion memory. The 07d6811 stream-safe
  // merge gates on `hasActiveRun`; that flips false the moment
  // `handleProviderExit` runs `clearActiveRunContext`. Any `chat-updated`
  // broadcast that races 1+ IPC ticks later (the renderer's 200ms
  // debounced save-chat, late delegation-card writes, etc.) hits the
  // unconditional-replace branch and clobbers the tail of the assistant
  // message — visible to the user as "tokens jumping around at the
  // summary stage." Treating a chat as "still active" for 2 seconds past
  // its exit covers stragglers without leaking the guard indefinitely.
  const recentlyCompletedChatIdsRef = useRef<Map<string, number>>(new Map())
  const RECENTLY_COMPLETED_WINDOW_MS = 2000
  const fxProfileRef = useRef({
    enabled: false,
    mode: 'off' as AppSettings['funFxMode'],
    reduceMotion: false
  })
  const fxBurstTimeoutRef = useRef<number | null>(null)
  const currentWorkspaceIdRef = useRef<string | null>(null)
  const currentChatIdRef = useRef<string | null>(null)
  const chatByIdRef = useRef<Map<string, ChatRecord>>(new Map())
  const rawLogsByChatIdRef = useRef<Map<string, RawLogEntry[]>>(new Map())
  const activeRunChatSnapshotRef = useRef<ChatRecord | null>(null)
  const activeRunChatIdRef = useRef<string | null>(null)
  const activeRunIdRef = useRef<string | null>(null)
  const activeRunWorkspacePathRef = useRef<string | null>(null)
  const activeRunStartedAtRef = useRef<string | null>(null)
  const activeRunDiffUnavailableRef = useRef(false)
  const activeRunUsageResetHintsRef = useRef<Map<string, { resetAt?: string; resetText?: string }>>(
    new Map()
  )
  const latestRunRequestRef = useRef<QueuedRunRequest | null>(null)
  const runQueueJobsRef = useRef<RunQueueJob[]>([])
  const rehydratedRunQueueRef = useRef(false)
  const runSchedulerBusyRef = useRef(false)
  const persistentSessionActiveRef = useRef(false)
  const activeScheduledTaskIdRef = useRef<string | null>(null)
  const currentProvider = currentChat ? getChatProvider(currentChat) : activeProvider
  const currentChatScope = getChatScope(currentChat)
  const isCurrentGlobalChat = currentChatScope === 'global'
  const bugReportInitialSurface = showSettings
    ? 'Settings'
    : currentChat?.chatKind === 'ensemble'
      ? 'Ensemble'
      : appearance.showInspector
        ? 'Inspector'
        : 'Transcript'
  const bugReportEnsembleSummary = useMemo(() => {
    const ensemble = currentChat?.ensemble
    if (!ensemble) return ''
    const enabled = (ensemble.participants || []).filter((participant) => participant.enabled)
    const labels = enabled
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((participant) => `${participant.role || participant.provider}/${participant.provider}`)
      .join(', ')
    const mode = ensemble.orchestrationMode || 'turn'
    return `${enabled.length} participants · ${mode} · ${labels}`
  }, [currentChat?.ensemble])
  const hasWorkspaceContext = Boolean(currentWorkspace && currentChat && !isCurrentGlobalChat)
  const currentWorkspacePopoutPath = currentWorkspace?.path || currentChat?.workspacePath || ''
  const canOpenWorkspacePopout = Boolean(currentWorkspacePopoutPath)
  const isCurrentChatProviderLocked = Boolean(
    currentChat &&
    ((currentChat.messages?.length || 0) > 0 ||
      (currentChat.runs?.length || 0) > 0 ||
      Boolean(currentChat.linkedGeminiSessionId) ||
      Boolean(currentChat.linkedProviderSessionId))
  )
  const isFxEnabled = appearance.funFxEnabled && appearance.funFxMode !== 'off'
  const shouldShowSkyVisualFxInFxMode = isFxEnabled
    ? appearance.funFxMode === 'subtle'
      ? showSkyVisualFx || !showGhostCompanion
      : showSkyVisualFx
    : false
  const shouldShowGhostCompanion = isFxEnabled
    ? appearance.funFxMode === 'subtle'
      ? showGhostCompanion && !showSkyVisualFx
      : showGhostCompanion
    : false
  // Canonical external-path grant list. New writes use
  // providerMetadata.externalPathGrants; legacy provider-specific keys
  // are coalesced here for old chats.
  const externalPathGrants = useMemo(
    () =>
      !isCurrentGlobalChat
        ? normalizeExternalPathGrants(
            collectExternalPathGrantsFromMetadata(currentChat?.providerMetadata)
          )
        : [],
    [currentChat?.providerMetadata, isCurrentGlobalChat]
  )
  // Slice 3 of the external-path-redesign arc. Per-grant repo
  // metadata (isRepo / branch) drives the stacked secondary rows
  // rendered alongside the primary above-bar. Probe results are
  // cached in the hook so re-renders are free; only changes to the
  // grant set trigger new probes.
  const externalPathRepoMetadata = useExternalPathRepoMetadata(externalPathGrants)
  const currentComposerChatId = currentChat?.appChatId || null
  useEffect(() => {
    setPreviewChatMediaRef(null)
  }, [currentComposerChatId])
  const prompt = currentComposerChatId ? composerDraftsByChatId[currentComposerChatId] || '' : ''
  const imageAttachments = useMemo(
    () =>
      currentComposerChatId
        ? imageAttachmentsByChatId[currentComposerChatId] || EMPTY_IMAGE_ATTACHMENTS
        : EMPTY_IMAGE_ATTACHMENTS,
    [currentComposerChatId, imageAttachmentsByChatId]
  )
  const composerImageAttachments = useMemo(
    () => imageAttachments.filter((attachment) => isImageAttachmentPath(attachment.path)),
    [imageAttachments]
  )
  const composerFileAttachments = useMemo(
    () => imageAttachments.filter((attachment) => !isImageAttachmentPath(attachment.path)),
    [imageAttachments]
  )
  const currentChatMediaRefs = useMemo(
    () => collectChatMediaRefs(currentChat, imageAttachments, externalPathGrants),
    [currentChat, imageAttachments, externalPathGrants]
  )
  const sideChat = useMemo(() => {
    if (!sideChatId) return null
    return (
      chatByIdRef.current.get(sideChatId) ||
      chats.find((chat) => chat.appChatId === sideChatId) ||
      null
    )
  }, [sideChatId, chats])
  const sideProvider = sideChat ? getChatProvider(sideChat) : currentProvider
  const sidePrompt = sideChat ? composerDraftsByChatId[sideChat.appChatId] || '' : ''
  const sidePanelParentChat = sideChat?.parentChatId
    ? chatByIdRef.current.get(sideChat.parentChatId) ||
      chats.find((chat) => chat.appChatId === sideChat.parentChatId) ||
      null
    : null
  const sidePanelRelation = sideChat
    ? isSubThreadChat(sideChat)
      ? 'subThread'
      : sideChat.parentChatRelation === 'sideChat'
        ? 'sideChat'
        : 'linkedChat'
    : null
  const sidePanelKindLabel =
    sidePanelRelation === 'subThread'
      ? 'Agent sub-thread'
      : sideChat?.chatKind === 'ensemble'
        ? 'Side ensemble'
        : 'Side chat'
  const sidePanelContextLabel =
    sidePanelRelation === 'subThread'
      ? 'Delegation context'
      : sideChat?.sideChatContext?.originMessageId
        ? 'Seeded from selected message'
        : sideChat?.sideChatContext?.originRunId
          ? 'Seeded from run result'
          : sideChat?.sideChatContext?.transcriptVisibility === 'summary'
            ? 'Seeded from summary'
            : 'No parent context'
  const sideSplitParentChatId = sideChat?.parentChatId || null
  const setSideChatSplitWidth = (nextWidth: number) => {
    const maxWidth = getSideChatMaxWidth()
    const clampedWidth = clampSideChatWidth(
      Math.max(MIN_SIDE_CHAT_WIDTH, Math.min(maxWidth, nextWidth))
    )
    setSideChatWidth(clampedWidth)
    if (sideSplitParentChatId) {
      setStoredSideChatWidth(sideSplitParentChatId, clampedWidth)
    }
  }
  useEffect(() => {
    if (!sideChatId) return
    const liveSideChat =
      chatByIdRef.current.get(sideChatId) || chats.find((chat) => chat.appChatId === sideChatId)
    if (
      !liveSideChat ||
      liveSideChat.archived ||
      isTerminatedSideChat(liveSideChat) ||
      liveSideChat.parentChatId !== currentChat?.appChatId
    ) {
      if (
        liveSideChat?.parentChatRelation === 'sideChat' &&
        !liveSideChat.archived &&
        !isTerminatedSideChat(liveSideChat)
      ) {
        const closedSideChat = applySideChatLifecycle(liveSideChat, 'closed')
        chatByIdRef.current.set(closedSideChat.appChatId, closedSideChat)
        setChats((prev) =>
          prev.map((chat) =>
            chat.appChatId === closedSideChat.appChatId ? closedSideChat : chat
          )
        )
        void window.api.saveChat(closedSideChat).catch(() => {})
      }
      setSideChatId(null)
    }
  }, [sideChatId, chats, currentChat?.appChatId])
  useEffect(() => {
    if (!sideSplitParentChatId) return
    const storedWidth = getStoredSideChatWidth(sideSplitParentChatId)
    const maxWidth = getSideChatMaxWidth()
    setSideChatWidth(
      clampSideChatWidth(Math.max(MIN_SIDE_CHAT_WIDTH, Math.min(maxWidth, storedWidth)))
    )
  }, [getSideChatMaxWidth, sideSplitParentChatId])
  useLayoutEffect(() => {
    if (!sideChat || !sideAutoFollowRef.current) return
    const scroller = sideTranscriptScrollRef.current
    if (!scroller) return
    requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight
    })
  }, [sideChat?.appChatId, sideChat?.messages?.length, sideChat?.updatedAt])
  useEffect(() => {
    if (!sideChatMenuOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      if (sideChatMenuRef.current?.contains(event.target as Node)) return
      setSideChatMenuOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [sideChatMenuOpen])
  useEffect(() => {
    setSideChatMenuOpen(false)
    setSideChatSeedMessageId(null)
  }, [currentChat?.appChatId])
  const permissionRequestState = currentComposerChatId
    ? permissionRequestByChatId[currentComposerChatId] || EMPTY_PERMISSION_STATE
    : EMPTY_PERMISSION_STATE
  const permissionRequestPaths = permissionRequestState.paths
  const permissionRequestMessage = permissionRequestState.message
  const permissionRequestKind = permissionRequestState.kind
  const permissionRequestSource = permissionRequestState.source
  const pendingAgentApproval = currentComposerChatId
    ? pendingAgentApprovalByChatId[currentComposerChatId] || null
    : null
  const pendingPlanChoice = currentComposerChatId
    ? pendingPlanChoiceByChatId[currentComposerChatId] || null
    : null
  const pendingAgentQuestion = currentComposerChatId
    ? pendingAgentQuestionByChatId[currentComposerChatId] || null
    : null
  const isCommandPaletteOpen = currentComposerChatId
    ? Boolean(commandPaletteOpenByChatId[currentComposerChatId])
    : false
  const commandPaletteQuery = currentComposerChatId
    ? commandPaletteQueryByChatId[currentComposerChatId] || ''
    : ''
  const scheduleRunAt = currentComposerChatId
    ? scheduleRunAtByChatId[currentComposerChatId] || ''
    : ''
  const geminiTerminalInput = currentComposerChatId
    ? geminiTerminalInputByChatId[currentComposerChatId] || ''
    : ''
  // Auto-default picks a built-in profile whose scope matches the current
  // chat — workspace chats get `{provider} local` (worktree mode for gemini),
  // global chats get `{provider} global`. Falls back to any matching-provider
  // profile if neither scope variant is registered (e.g. user has wiped the
  // builtins and only has a custom profile).
  const defaultRuntimeProfileIdForProvider = (provider: ProviderId): string => {
    const desiredScope: ChatScope = isCurrentGlobalChat ? 'global' : 'workspace'
    return (
      runtimeProfiles.find(
        (profile) => profile.provider === provider && profile.scope === desiredScope
      )?.id ||
      runtimeProfiles.find((profile) => profile.provider === provider)?.id ||
      ''
    )
  }
  const chatLevelSelectedRuntimeProfileId = currentComposerChatId
    ? selectedRuntimeProfileByChatId[currentComposerChatId] ||
      defaultRuntimeProfileIdForProvider(currentProvider)
    : defaultRuntimeProfileIdForProvider(currentProvider)
  // 1.0.4-AT2 — `selectedRuntimeProfileId` and
  // `currentProviderRuntimeProfiles` are derived AFTER
  // `selectedParticipant` is in scope (see ~line 14000), so the
  // picker can branch between chat-scope and participant-scope.
  // Earlier consumers (if any) should use the chat-level fallback
  // above directly.
  let selectedRuntimeProfileId: string = chatLevelSelectedRuntimeProfileId
  let currentProviderRuntimeProfiles = runtimeProfiles.filter(
    (profile) => profile.provider === currentProvider
  )
  const setChatPromptDraft = useCallback(
    (chatId: string | null | undefined, value: string) => {
      setComposerDraftForChat(chatId, value)
    },
    [setComposerDraftForChat]
  )
  const setPrompt = useCallback(
    (value: string) => {
      setChatPromptDraft(currentChatIdRef.current || currentComposerChatId, value)
    },
    [currentComposerChatId, setChatPromptDraft]
  )
  // 1.0.4-AQ3 — restore the composer textarea's caret position
  // after each `prompt` change. React's controlled-input caret
  // preservation glitches when the textarea's className flips
  // mid-keystroke (specifically when `composerHasMention` flips
  // `false → true` once an `@token` resolves to a participant).
  // The class change adds `position: relative` + `color: transparent`
  // and the `ComposerHighlightOverlay` sibling mounts in the same
  // commit; both happen in React's commit phase BEFORE the
  // browser has a chance to keep the caret where the user was
  // typing, and the caret can land at the end of the text instead.
  //
  // The fix: snapshot the caret position in `onChange` (before
  // React reconciles), then this layout effect re-applies it
  // post-commit if it doesn't already match. Only runs when the
  // textarea is focused (otherwise we'd hijack the caret from
  // other inputs that share renders).
  useLayoutEffect(() => {
    const ta = composerTextareaRef.current
    const stored = composerSelectionRef.current
    if (!ta || !stored) return
    // Only restore when the textarea is the active element. If
    // focus moved elsewhere (slash-picker click, mention popover,
    // send button), the snapshot is stale and we'd jump the caret
    // into a backgrounded input on next focus.
    if (typeof document !== 'undefined' && document.activeElement !== ta) return
    // Skip if React already preserved the caret correctly.
    if (ta.selectionStart === stored.start && ta.selectionEnd === stored.end) return
    try {
      ta.setSelectionRange(stored.start, stored.end)
    } catch {
      // Some browsers throw if the textarea is disabled/readonly
      // at the moment of restore. The user re-typed; they can
      // retry. Better than a thrown error breaking the round.
    }
  }, [prompt])
  const getCurrentComposerStateChatId = (): string | null =>
    currentChatIdRef.current || currentComposerChatId
  const setImageAttachments = (
    value: ImageAttachment[] | ((previous: ImageAttachment[]) => ImageAttachment[])
  ) => {
    const chatId = getCurrentComposerStateChatId()
    if (!chatId) return
    setImageAttachmentsByChatId((prev) => {
      const nextValue = applyStateAction(value, prev[chatId] || [])
      return { ...prev, [chatId]: nextValue }
    })
  }
  const updatePermissionRequestState = (
    patch:
      | Partial<ComposerPermissionState>
      | ((previous: ComposerPermissionState) => ComposerPermissionState)
  ) => {
    const chatId = getCurrentComposerStateChatId()
    if (!chatId) return
    setPermissionRequestByChatId((prev) => {
      const previous = prev[chatId] || EMPTY_PERMISSION_STATE
      const nextValue = typeof patch === 'function' ? patch(previous) : { ...previous, ...patch }
      return { ...prev, [chatId]: nextValue }
    })
  }
  const setPermissionRequestPaths = (value: string[] | ((previous: string[]) => string[])) => {
    updatePermissionRequestState((previous) => ({
      ...previous,
      paths: applyStateAction(value, previous.paths)
    }))
  }
  const setPermissionRequestMessage = (message: string) => updatePermissionRequestState({ message })
  const setPermissionRequestKind = (kind: GeminiPermissionRequest['kind'] | null) =>
    updatePermissionRequestState({ kind })
  const setPermissionRequestSource = (source: GeminiPermissionRequest['source'] | null) =>
    updatePermissionRequestState({ source })
  const setPendingAgentApproval = (
    value:
      | AgentApprovalRequest
      | null
      | ((previous: AgentApprovalRequest | null) => AgentApprovalRequest | null)
  ) => {
    const chatId = getCurrentComposerStateChatId()
    setPendingAgentApprovalForChatId(chatId, value)
  }
  const setPendingAgentApprovalForChat = (
    chatId: string | null | undefined,
    value:
      | AgentApprovalRequest
      | null
      | ((previous: AgentApprovalRequest | null) => AgentApprovalRequest | null)
  ) => {
    setPendingAgentApprovalForChatId(chatId, value)
  }
  // 1.0.4-AK4 — append an approval onto a chat's pending queue
  // (tail). Used when an approval arrives while the head slot is
  // already occupied.
  const enqueueApprovalForChat = (chatId: string, request: AgentApprovalRequest): void => {
    if (!chatId) return
    setPendingApprovalQueueByChatId((prev) => {
      const existing = prev[chatId] || []
      // Idempotency: skip if this exact approvalId is already in
      // the queue. Defensive against duplicate IPC fires.
      if (existing.some((entry) => entry.id === request.id)) return prev
      return { ...prev, [chatId]: [...existing, request] }
    })
  }
  // 1.0.4-AK4 — pop the next queued approval for a chat into the
  // visible head slot. Called when the current head resolves
  // (user decision OR timeout). Returns the popped approval (or
  // null when the queue was empty) so callers can log the
  // promotion if useful.
  const advanceApprovalQueueForChat = (chatId: string): AgentApprovalRequest | null => {
    if (!chatId) return null
    let promoted: AgentApprovalRequest | null = null
    setPendingApprovalQueueByChatId((prev) => {
      const existing = prev[chatId] || []
      if (existing.length === 0) return prev
      const [next, ...rest] = existing
      promoted = next
      if (rest.length === 0) {
        const { [chatId]: _omit, ...without } = prev
        return without
      }
      return { ...prev, [chatId]: rest }
    })
    if (promoted) {
      setPendingAgentApprovalForChatId(chatId, promoted)
    }
    return promoted
  }
  const setPendingPlanChoice = (
    value: PlanChoiceState | null | ((previous: PlanChoiceState | null) => PlanChoiceState | null)
  ) => {
    const chatId = getCurrentComposerStateChatId()
    setPendingPlanChoiceForChat(chatId, value)
  }
  const setCommandPaletteQuery = (value: string | ((previous: string) => string)) => {
    const chatId = getCurrentComposerStateChatId()
    setCommandPaletteQueryForChat(chatId, value)
  }
  const setIsCommandPaletteOpen = (value: boolean | ((previous: boolean) => boolean)) => {
    const chatId = getCurrentComposerStateChatId()
    setCommandPaletteOpenForChat(chatId, value)
  }
  const setScheduleRunAt = (value: string | ((previous: string) => string)) => {
    const chatId = getCurrentComposerStateChatId()
    setScheduleRunAtForChat(chatId, value)
  }
  const setGeminiTerminalInput = (value: string | ((previous: string) => string)) => {
    const chatId = getCurrentComposerStateChatId()
    setGeminiTerminalInputForChat(chatId, value)
  }
  const setRuntimeProfileForChat = (
    chatId: string | null | undefined,
    runtimeProfileId: string
  ) => {
    if (!chatId) return
    setSelectedRuntimeProfileByChatId((prev) => ({ ...prev, [chatId]: runtimeProfileId }))
  }
  const getRuntimeProfileIdForChat = (
    chat: ChatRecord | null | undefined,
    provider: ProviderId
  ): string | undefined => {
    // Resolution rules live in main (Phase B3.4 extraction) so the future
    // iOS bridge can answer the same question without forking logic.
    return resolveRuntimeProfileIdForChat({
      chat: chat || null,
      provider,
      selectionByChatId: selectedRuntimeProfileByChatId,
      profiles: runtimeProfiles
    })
  }

  useEffect(() => {
    fxProfileRef.current = {
      enabled: appearance.funFxEnabled,
      mode: appearance.funFxMode,
      reduceMotion: appearance.reduceMotion
    }
  }, [appearance.funFxEnabled, appearance.funFxMode, appearance.reduceMotion])

  // Keep `steerStateRef` in lockstep with the `steerState` React state.
  // The async steer wait-loop pulls from the ref to avoid the stale-
  // closure problem (the loop captures the state from the render it
  // was scheduled in; subsequent setSteerState calls wouldn't otherwise
  // be visible to it).
  useEffect(() => {
    steerStateRef.current = steerState
  }, [steerState])

  const clearFxBurst = () => {
    if (fxBurstTimeoutRef.current) {
      window.clearTimeout(fxBurstTimeoutRef.current)
      fxBurstTimeoutRef.current = null
    }
    setFxBurstClass('')
  }

  const triggerFxBurst = (type: 'run-start' | 'run-complete' | 'run-summary' | 'warning') => {
    const profile = fxProfileRef.current
    if (!profile.enabled || profile.mode === 'off' || profile.reduceMotion) {
      return
    }
    clearFxBurst()
    setFxBurstClass(`fx-burst-${type}`)
    fxBurstTimeoutRef.current = window.setTimeout(() => {
      setFxBurstClass('')
      fxBurstTimeoutRef.current = null
    }, FX_BURST_DURATION_MS)
  }

  useEffect(() => {
    return () => {
      clearFxBurst()
    }
  }, [])

  useEffect(() => {
    if (!isFxEnabled && fxBurstClass) {
      clearFxBurst()
    }
  }, [isFxEnabled, fxBurstClass])

  useEffect(() => {
    let cancelled = false
    const nativeCapabilityLoad = window.api.getNativeCapabilities?.()
    if (!nativeCapabilityLoad) return
    void nativeCapabilityLoad.then((snapshot) => {
      if (!cancelled) setNativeCapabilities(snapshot)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api.attachWindowStatus().then(({ snapshot }) => {
      if (!cancelled) setAttachedWindow(snapshot)
    })
    const unsubscribe = window.api.onAttachedWindowChanged((snapshot) => {
      setAttachedWindow(snapshot)
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  const triggerSendConfirmation = () => {
    if (!currentChat || (!isCurrentGlobalChat && !currentWorkspace) || !prompt.trim()) return
    if (sendConfirmationTimeoutRef.current) {
      window.clearTimeout(sendConfirmationTimeoutRef.current)
      sendConfirmationTimeoutRef.current = null
    }
    setIsSendConfirming(false)
    window.requestAnimationFrame(() => {
      setIsSendConfirming(true)
      sendConfirmationTimeoutRef.current = window.setTimeout(() => {
        setIsSendConfirming(false)
        sendConfirmationTimeoutRef.current = null
      }, 620)
    })
  }

  const setThreadRawLogs = (chatId: string | null | undefined, logs: RawLogEntry[]) => {
    const nextLogs = logs.slice(-1000)
    if (!chatId) {
      setRawLogs(nextLogs)
      return
    }
    rawLogsByChatIdRef.current.set(chatId, nextLogs)
    if (currentChatIdRef.current === chatId) {
      setRawLogs(nextLogs)
    }
  }

  const appendThreadRawLog = (chatId: string | null | undefined, log: RawLogEntry) => {
    if (!chatId) {
      setRawLogs((prev) => [...prev, log].slice(-1000))
      return
    }
    const previous = rawLogsByChatIdRef.current.get(chatId) || []
    setThreadRawLogs(chatId, [...previous, log])
  }

  const appendDurableRunEvent = (_event: RunEventInput) => {
    // Durable event writes are main-owned; renderer keeps local raw logs only.
  }

  const hydrateThreadRawLogsFromEvents = (chatId: string) => {
    if (rawLogsByChatIdRef.current.has(chatId) || typeof window.api.getRunEvents !== 'function')
      return
    window.api
      .getRunEvents({ chatId, limit: 1000 })
      .then((events: RunEventRecord[]) => {
        if (!Array.isArray(events) || rawLogsByChatIdRef.current.has(chatId)) return
        const logs = events
          .map(rawLogFromRunEvent)
          .filter((log): log is RawLogEntry => Boolean(log))
          .slice(-1000)
        if (logs.length > 0) {
          setThreadRawLogs(chatId, logs)
        }
      })
      .catch(() => {})
  }

  const syncRunningState = () => {
    const activeRuns = activeRunsRef.current
    runSchedulerBusyRef.current = activeRuns.size > 0
    setIsRunning(activeRuns.size > 0)
  }

  const getActiveRunContextsForProvider = (provider: ProviderId): ActiveRunContext[] => {
    const contexts: ActiveRunContext[] = []
    for (const context of activeRunsRef.current.values()) {
      if (context.provider === provider) {
        contexts.push(context)
      }
    }
    return contexts
  }

  // Per-chat busy check (replaces the per-provider check at every queue
  // decision site). Previously starting a new chat on a provider whose
  // OTHER chat had an in-flight run caused the new prompt to silently
  // queue onto the new chat's transcript with a buried "Queued behind
  // the active task" system note — even though there was nothing yet
  // running in the new chat. Codex's app-server, Claude's SDK, Gemini
  // / Kimi CLI all handle concurrent dispatches per chat just fine;
  // the UI-level lock was the only thing forcing serialisation.
  const isChatBusy = (chatId: string | null | undefined): boolean => {
    if (!chatId) return false
    for (const ctx of activeRunsRef.current.values()) {
      if (ctx.chatId === chatId) return true
    }
    for (const job of runQueueJobsRef.current) {
      if (job.chatId === chatId && ACTIVE_RUN_QUEUE_STATUSES.has(job.status)) return true
    }
    return false
  }

  const getActiveRunContextForProvider = (provider: ProviderId): ActiveRunContext | null => {
    const contexts = getActiveRunContextsForProvider(provider)
    const currentChatId = currentChatIdRef.current
    if (currentChatId) {
      const currentChatContext = contexts.find((context) => context.chatId === currentChatId)
      if (currentChatContext) return currentChatContext
    }
    return contexts[0] || null
  }

  const markCapacityStoppedRun = (context: ActiveRunContext, message: string) => {
    const stoppedAt = new Date().toISOString()
    updateRunQueueJobStatus(context.runId, 'failed', message, 'Gemini model capacity exhausted.')
    updateChatById(context.chatId, (source) => ({
      ...source,
      runs: (source.runs || []).map((run) =>
        run.runId === context.runId
          ? {
              ...run,
              status: 'failed',
              endedAt: stoppedAt,
              warnings: [...context.warnings]
            }
          : run
      )
    }))
  }

  const clearQueuedRunsForProvider = (provider: ProviderId, reason: string) => {
    setQueuedRuns((current) => {
      const removed = current.filter((request) => request.provider === provider)
      if (removed.length === 0) return current
      for (const request of removed) {
        updateRunQueueJobStatus(request.appRunId, 'cancelled', reason)
      }
      return current.filter((request) => request.provider !== provider)
    })
  }

  const getRouteProvider = (value: unknown, fallback: ProviderId): ProviderId => {
    if (value && typeof value === 'object') {
      const provider = (value as RunRouteEventPayload).provider
      if (
        provider === 'gemini' ||
        provider === 'codex' ||
        provider === 'claude' ||
        provider === 'kimi'
      ) {
        return provider
      }
    }
    return fallback
  }

  const getRouteRunId = (value: unknown): string | undefined =>
    value &&
    typeof value === 'object' &&
    typeof (value as RunRouteEventPayload).appRunId === 'string'
      ? (value as RunRouteEventPayload).appRunId
      : undefined

  const getRouteChatId = (value: unknown): string | undefined =>
    value &&
    typeof value === 'object' &&
    typeof (value as RunRouteEventPayload).appChatId === 'string'
      ? (value as RunRouteEventPayload).appChatId
      : undefined

  const resolveActiveRunContext = (
    provider: ProviderId,
    appRunId?: string,
    appChatId?: string
  ): ActiveRunContext | null => {
    if (appRunId) {
      const byRunId = activeRunsRef.current.get(appRunId)
      if (byRunId) return byRunId
    }
    if (appChatId) {
      for (const context of activeRunsRef.current.values()) {
        if (context.chatId === appChatId && context.provider === provider) return context
      }
    }
    return getActiveRunContextForProvider(provider)
  }

  const clearActiveRunContext = (context: ActiveRunContext | null) => {
    if (!context) return
    activeRunsRef.current.delete(context.runId)
    if (adapterRef.current === context.adapter) {
      adapterRef.current = null
    }
    if (activeRunIdRef.current === context.runId) {
      activeRunIdRef.current = null
      activeRunChatIdRef.current = null
      activeRunChatSnapshotRef.current = null
      activeRunWorkspacePathRef.current = null
      activeRunStartedAtRef.current = null
      activeRunDiffUnavailableRef.current = false
      activeScheduledTaskIdRef.current = null
      preSnapshotRef.current = null
    }
    setRunningChatIds((prev) => {
      const next = new Set(prev)
      next.delete(context.chatId)
      return next
    })
    syncRunningState()
  }

  const extractStreamText = (value: unknown, key: 'data' | 'error'): string => {
    if (typeof value === 'string') return value
    if (value && typeof value === 'object') {
      const text = (value as RunRouteEventPayload)[key]
      if (typeof text === 'string') return text
    }
    return ''
  }

  const extractExitCode = (value: unknown): number | null => {
    if (typeof value === 'number') return value
    if (value && typeof value === 'object') {
      const code = (value as RunRouteEventPayload).code
      return typeof code === 'number' ? code : null
    }
    return null
  }

  const updateChatById = useCallback(
    (
      chatId: string | null | undefined,
      updater: (chat: ChatRecord) => ChatRecord
    ): ChatRecord | null => {
      if (!chatId) return null
      const base =
        chatByIdRef.current.get(chatId) ||
        (activeRunChatSnapshotRef.current?.appChatId === chatId
          ? activeRunChatSnapshotRef.current
          : null)
      if (!base) return null

      const updated = updater(base)
      chatByIdRef.current.set(chatId, updated)
      if (activeRunChatIdRef.current === chatId) {
        activeRunChatSnapshotRef.current = updated
      }
      setChats((prev) => {
        const index = prev.findIndex((chat) => chat.appChatId === chatId)
        if (index < 0) return [updated, ...prev]
        return prev.map((chat) => (chat.appChatId === chatId ? updated : chat))
      })
      setCurrentChat((prev) => (prev?.appChatId === chatId ? updated : prev))
      const existingTimer = saveChatTimersRef.current.get(chatId)
      if (existingTimer) clearTimeout(existingTimer)
      const timer = setTimeout(() => {
        saveChatTimersRef.current.delete(chatId)
        const latest = chatByIdRef.current.get(chatId) || updated
        window.api.saveChat(latest).catch(() => {})
      }, 200)
      saveChatTimersRef.current.set(chatId, timer)
      return updated
    },
    []
  )

  const getProviderModelOptions = (provider: ProviderId): CodexModelOption[] => {
    if (provider === 'codex') return codexModels
    if (provider === 'claude') return agentModelsByProvider.claude || CLAUDE_DEFAULT_MODELS
    if (provider === 'kimi') return KIMI_DEFAULT_MODELS
    if (provider === 'gemini') return GEMINI_DEFAULT_MODELS
    if (provider === 'grok') return GROK_DEFAULT_MODELS
    if (provider === 'cursor') return CURSOR_DEFAULT_MODELS
    return []
  }

  const getDefaultModelForProvider = (provider: ProviderId): string => {
    if (provider === 'codex') return codexModels[0]?.id || CODEX_DEFAULT_MODEL
    if (provider === 'claude') return 'default'
    if (provider === 'kimi') return KIMI_DEFAULT_MODEL
    if (provider === 'grok') return 'grok-build'
    if (provider === 'cursor') return 'composer-2.5-fast'
    return 'flash-lite'
  }

  const isValidModelForProvider = (
    provider: ProviderId,
    modelId: string | undefined | null
  ): modelId is string => {
    if (!modelId) return false
    if (modelId === 'custom') return provider !== 'kimi'
    if (provider === 'codex') return isCodexModelId(modelId)
    if (provider === 'claude') return isClaudeModelId(modelId)
    if (provider === 'kimi') return isKimiModelId(modelId)
    // Grok (gated, read-only): only a genuine grok* model id is valid — never a
    // model carried over from another provider. A legacy 'cli-default' coerces
    // to the default (grok-build) so the picker shows "Grok Build 0.1", not blank.
    if (provider === 'grok') return modelId.startsWith('grok')
    if (provider === 'cursor') return modelId.startsWith('composer-')
    return isGeminiModelId(modelId)
  }

  const getLastRequestedModelForProvider = (
    chat: ChatRecord,
    provider: ProviderId
  ): string | undefined => {
    const runs = [...(chat.runs || [])].reverse()
    const run = runs.find((candidate) => (candidate.provider || getChatProvider(chat)) === provider)
    return run?.requestedModel || run?.actualModel || chat.requestedModel
  }

  const getChatComposerSelection = (chat: ChatRecord, providerOverride?: ProviderId) => {
    const provider = providerOverride || getChatProvider(chat)
    const metadata = chat.providerMetadata || {}
    const metadataModel =
      typeof metadata.selectedModelType === 'string' ? metadata.selectedModelType : undefined
    const runModel = getLastRequestedModelForProvider(chat, provider)
    const selected = isValidModelForProvider(provider, metadataModel)
      ? metadataModel
      : isValidModelForProvider(provider, runModel)
        ? runModel
        : getDefaultModelForProvider(provider)
    const modelOption =
      provider === 'codex' ? codexModels.find((model) => model.id === selected) : undefined
    return {
      provider,
      selectedModelType: selected,
      customModel: typeof metadata.customModel === 'string' ? metadata.customModel : '',
      approvalMode:
        typeof metadata.approvalMode === 'string'
          ? metadata.approvalMode
          : chat.settingsSnapshot?.approvalMode || approvalMode,
      codexReasoningEffort:
        typeof metadata.codexReasoningEffort === 'string'
          ? metadata.codexReasoningEffort
          : modelOption?.defaultReasoningEffort || 'medium',
      codexServiceTier:
        typeof metadata.codexServiceTier === 'string' ? metadata.codexServiceTier : '',
      claudeReasoningEffort:
        typeof metadata.claudeReasoningEffort === 'string' ? metadata.claudeReasoningEffort : 'off',
      claudeFastMode:
        typeof metadata.claudeFastMode === 'boolean' ? metadata.claudeFastMode : false,
      kimiThinkingEnabled:
        typeof metadata.kimiThinkingEnabled === 'boolean' ? metadata.kimiThinkingEnabled : true
    }
  }

  const applyChatComposerSelection = (chat: ChatRecord, providerOverride?: ProviderId) => {
    const selection = getChatComposerSelection(chat, providerOverride)
    setActiveProvider(selection.provider)
    setSelectedModelType(selection.selectedModelType)
    if (selection.selectedModelType !== 'custom') {
      setLastNonCustomModelType(selection.selectedModelType)
    }
    setCustomModel(selection.customModel)
    setApprovalMode(selection.approvalMode)
    setCodexReasoningEffort(selection.codexReasoningEffort)
    setCodexServiceTier(selection.codexServiceTier)
    setClaudeReasoningEffort(selection.claudeReasoningEffort)
    setClaudeFastMode(selection.claudeFastMode)
    setKimiThinkingEnabled(selection.kimiThinkingEnabled)
    setRuntimeProfileForChat(
      chat.appChatId,
      getRuntimeProfileIdForChat(chat, selection.provider) || ''
    )
    if (selection.provider === 'gemini' && selection.selectedModelType !== 'custom') {
      syncPersistentModelSelection(selection.selectedModelType)
    }
  }

  const rememberCurrentChatComposerSelection = (patch: Record<string, unknown>) => {
    const chatId = currentChatIdRef.current || currentChat?.appChatId
    if (!chatId) return
    updateChatById(chatId, (source) => ({
      ...source,
      providerMetadata: {
        ...(source.providerMetadata || {}),
        ...patch
      },
      updatedAt: Date.now()
    }))
  }

  const getWorkspaceForChat = (chat?: ChatRecord | null): WorkspaceRecord | null => {
    if (!chat) return currentWorkspace
    if (isGlobalChat(chat)) return null
    if (currentWorkspace?.id === chat.workspaceId) return currentWorkspace
    const knownWorkspace = workspaces.find((workspace) => workspace.id === chat.workspaceId)
    if (knownWorkspace) return knownWorkspace
    if (!chat.workspaceId || !chat.workspacePath) return null
    const fallbackName = chat.workspacePath.split(/[\\/]/).filter(Boolean).pop() || 'Workspace'
    return {
      id: chat.workspaceId,
      path: chat.workspacePath,
      displayName: fallbackName,
      lastOpenedAt: Date.now(),
      createdAt: Date.now(),
      pinned: false
    }
  }
  const sideWorkspace = sideChat ? getWorkspaceForChat(sideChat) : null

  const refreshProviderMetadata = async (
    provider: ProviderId,
    workspacePath: string | null | undefined = currentWorkspace?.path
  ) => {
    const capabilityWorkspacePath = workspacePath || undefined
    if (typeof window.api.getProviderCapabilities === 'function') {
      window.api
        .getProviderCapabilities(provider, capabilityWorkspacePath, approvalMode)
        .then((capabilities) => {
          setProviderCapabilitiesByProvider((prev) => ({ ...prev, [provider]: capabilities }))
        })
        .catch(() => {
          setProviderCapabilitiesByProvider((prev) => ({ ...prev, [provider]: undefined }))
        })
    }
    if (provider === 'gemini' || typeof window.api.getAgentStatus !== 'function') {
      return
    }
    if (typeof window.api.getAgentModels === 'function') {
      window.api
        .getAgentModels(provider)
        .then((models) => {
          const normalized =
            provider === 'kimi'
              ? KIMI_DEFAULT_MODELS
              : Array.isArray(models) && models.length > 0
                ? models.map((model) => ({ ...model, label: model.label || model.id }))
                : provider === 'claude'
                  ? CLAUDE_DEFAULT_MODELS
                  : CODEX_DEFAULT_MODELS
          if (provider === 'codex') {
            setCodexModels(normalized)
          } else {
            setAgentModelsByProvider((prev) => ({ ...prev, [provider]: normalized }))
          }
        })
        .catch(() => {
          if (provider === 'codex') setCodexModels(CODEX_DEFAULT_MODELS)
          if (provider === 'claude')
            setAgentModelsByProvider((prev) => ({ ...prev, claude: CLAUDE_DEFAULT_MODELS }))
          if (provider === 'kimi')
            setAgentModelsByProvider((prev) => ({ ...prev, kimi: KIMI_DEFAULT_MODELS }))
        })
    }
    window.api
      .getAgentStatus(provider)
      .then((status) => {
        if (provider === 'codex') {
          setCodexStatus(status)
          if (currentWorkspaceIdRef.current) {
            void refreshUsageSummary(currentWorkspaceIdRef.current, 'codex', status)
          }
        } else {
          setAgentStatusByProvider((prev) => ({ ...prev, [provider]: status }))
        }
      })
      .catch(() => {
        if (provider === 'codex') setCodexStatus(null)
        else setAgentStatusByProvider((prev) => ({ ...prev, [provider]: null }))
      })
    if (typeof window.api.getAgentMcpStatus === 'function') {
      window.api
        .getAgentMcpStatus(provider)
        .then((status) => {
          if (provider === 'codex') setCodexMcpStatus(status)
          else setAgentMcpStatusByProvider((prev) => ({ ...prev, [provider]: status }))
        })
        .catch(() => {
          if (provider === 'codex') setCodexMcpStatus(null)
          else setAgentMcpStatusByProvider((prev) => ({ ...prev, [provider]: null }))
        })
    }
  }

  const refreshGeminiAuthStatus = async () => {
    if (typeof window.api.getGeminiAuthStatus !== 'function') return
    try {
      const status = await window.api.getGeminiAuthStatus()
      setGeminiAuthStatus(status)
      setGeminiAuthProfiles(Array.isArray(status.profiles) ? status.profiles : [])
    } catch {
      setGeminiAuthStatus(null)
      setGeminiAuthProfiles([])
    }
  }

  useEffect(() => {
    if (!geminiAuthProfiles.some((profile) => profile.oauthLogin?.status === 'running')) return
    const interval = window.setInterval(() => {
      void refreshGeminiAuthStatus()
    }, 2000)
    return () => window.clearInterval(interval)
  }, [geminiAuthProfiles])

  const normalizeDiffPath = (value: string, workspacePathOverride?: string | null): string => {
    const normalized = value.replace(/\\/g, '/')
    const workspacePath = (
      workspacePathOverride ||
      activeRunWorkspacePathRef.current ||
      ''
    ).replace(/\\/g, '/')
    if (!workspacePath) {
      return normalized
    }
    const ws = workspacePath.endsWith('/') ? workspacePath : `${workspacePath}/`
    if (normalized.startsWith(ws)) {
      return normalized.slice(ws.length)
    }
    return normalized
  }

  const isFileSummaryRecord = (summary: DiffFileSummary): summary is DiffFileSummary =>
    Boolean(summary?.path && summary.path.trim() && FILE_DIFF_STATUSES.has(summary.status))

  const getRunFileDiffSummaries = (
    runDiffValue?: DiffFileSummary[] | RunDiffResult | null
  ): DiffFileSummary[] => {
    if (!runDiffValue) {
      return []
    }
    const candidates = Array.isArray(runDiffValue)
      ? runDiffValue
      : [...runDiffValue.createdFiles, ...runDiffValue.modifiedFiles, ...runDiffValue.deletedFiles]
    return candidates.filter(isFileSummaryRecord)
  }

  const summarizeWriteToolForDiff = (
    activity: ToolActivity,
    workspacePath?: string | null
  ): {
    path: string
    status: 'created' | 'modified' | 'deleted'
    additions: number
    deletions: number
  } | null => {
    const toolName = (activity.toolName || '').toLowerCase()
    const status: 'created' | 'modified' | 'deleted' | null =
      toolName === 'create_file'
        ? 'created'
        : toolName === 'delete_file'
          ? 'deleted'
          : RUN_WRITE_TOOLS.includes(toolName)
            ? 'modified'
            : null
    if (!status) return null

    const rawPath =
      typeof activity.parameters?.file_path === 'string' && activity.parameters.file_path.trim()
        ? activity.parameters.file_path
        : typeof activity.parameters?.path === 'string' && activity.parameters.path.trim()
          ? activity.parameters.path
          : activity.filePath && activity.filePath.trim()
            ? activity.filePath
            : activity.affectedFilePath && activity.affectedFilePath.trim()
              ? activity.affectedFilePath
              : undefined

    if (!rawPath) return null

    const changes = estimateLineChanges(activity.parameters || {})
    return {
      path: normalizeDiffPath(rawPath.trim(), workspacePath),
      status,
      additions: changes.additions || 0,
      deletions: changes.deletions || 0
    }
  }

  const upsertRunDiffFromTool = (activity: ToolActivity, workspacePath?: string | null) => {
    const change = summarizeWriteToolForDiff(activity, workspacePath)
    if (!change) return

    setRunDiff((prev) => {
      const next = [...(prev || [])]
      const existingIndex = next.findIndex((item) => item.path === change.path)
      if (existingIndex >= 0) {
        const existing = next[existingIndex]
        const mergedStatus =
          existing.status === 'created'
            ? 'created'
            : change.status === 'created'
              ? 'created'
              : change.status === 'deleted'
                ? 'deleted'
                : 'modified'

        next[existingIndex] = {
          ...existing,
          status: mergedStatus,
          additions: (existing.additions || 0) + change.additions,
          deletions: (existing.deletions || 0) + change.deletions,
          previewKind: existing.previewKind || 'none'
        }
      } else {
        next.push({
          path: change.path,
          status: change.status,
          additions: change.additions,
          deletions: change.deletions,
          previewKind: 'none'
        })
      }
      return next
    })
  }

  const loadInitialDataRef = useRef<(() => Promise<void>) | null>(null)

  // Initialize
  useEffect(() => {
    loadInitialDataRef.current?.().catch((err) => {
      // Defensive: unhandled rejection here would silently leave the
      // sidebar empty until the user manually performs an action that
      // re-fetches workspaces. Surface the failure so we have a chance
      // to triage instead of presenting a blank app.
      console.error('[loadInitialData] unhandled rejection:', err)
    })
    window.api.getGeminiVersion().then((v) => setGeminiVersion(v))
  }, [])

  useEffect(() => {
    const recordRendererCrash = (input: {
      message: string
      name?: string
      stack?: string
      metadata?: Record<string, unknown>
    }) => {
      if (typeof window.api.recordProductCrash !== 'function') return
      window.api
        .recordProductCrash({
          source: 'renderer',
          severity: 'error',
          ...input
        })
        .catch(() => {})
    }
    const handleError = (event: ErrorEvent) => {
      recordRendererCrash({
        name: event.error instanceof Error ? event.error.name : 'RendererError',
        message: event.message || String(event.error || 'Renderer error'),
        stack: event.error instanceof Error ? event.error.stack : undefined,
        metadata: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno
        }
      })
    }
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      const error = reason instanceof Error ? reason : null
      recordRendererCrash({
        name: error?.name || 'UnhandledRejection',
        message: error?.message || String(reason),
        stack: error?.stack
      })
    }
    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleRejection)
    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleRejection)
    }
  }, [])

  useEffect(() => {
    if (!chatContextNotice) return
    const timeout = window.setTimeout(() => {
      setChatContextNotice((current) => (current?.id === chatContextNotice.id ? null : current))
    }, 4500)
    return () => window.clearTimeout(timeout)
  }, [chatContextNotice])

  useEffect(() => {
    runQueueJobsRef.current = runQueueJobs
  }, [runQueueJobs])

  const loadInitialData = async () => {
    const s = await window.api.getSettings()
    const legacyFunFx = getLegacyFunFxSettingsFromLocalStorage()
    const nextFunFxEnabled =
      typeof s.funFxEnabled === 'boolean' ? s.funFxEnabled : legacyFunFx.funFxEnabled
    const nextFunFxMode = isFunFxMode(s.funFxMode) ? s.funFxMode : legacyFunFx.funFxMode
    appearance.update({
      funFxEnabled: nextFunFxEnabled,
      funFxMode: nextFunFxMode
    })
    if (typeof s.funFxEnabled !== 'boolean' || !isFunFxMode(s.funFxMode)) {
      window.api
        .updateSettings({
          funFxEnabled: nextFunFxEnabled,
          funFxMode: nextFunFxMode
        })
        .catch(() => {})
    }
    setSettings(s)
    setActiveProvider(s.activeProvider || 'gemini')
    setClaudeBinaryPath(s.claudeBinaryPath || '')
    setKimiBinaryPath(s.kimiBinaryPath || '')
    setAgenticServices({ ...DEFAULT_AGENTIC_SERVICES, ...(s.agenticServices || {}) })
    setAutoResumeParentOnSubThreadCompletion(
      typeof s.autoResumeParentOnSubThreadCompletion === 'boolean'
        ? s.autoResumeParentOnSubThreadCompletion
        : true
    )
    setAgenticWorkspaceGrants(
      Array.isArray(s.agenticWorkspaceGrants) ? s.agenticWorkspaceGrants : []
    )
    setAgenticWorkspaceGrantCount(
      Array.isArray(s.agenticWorkspaceGrants) ? s.agenticWorkspaceGrants.length : 0
    )
    setGeminiMcpBridgeEnabledState(Boolean(s.geminiMcpBridgeEnabled))
    setGeminiMcpBridgeStatus(s.geminiMcpBridgeLastStatus || null)
    setCodexSandboxFallback(s.codexSandboxFallback || 'ask_rerun')
    setUpdateChannel(s.updateChannel || 'stable')
    if (s.approvalTimeouts) {
      setApprovalTimeouts(s.approvalTimeouts)
    }
    setChatContextTurns(clampContextTurns(s.chatContextTurns))
    setGeminiCheckpointingEnabled(Boolean(s.geminiCheckpointingEnabled))
    setGeminiApiRuntime(
      s.geminiApiRuntime === 'auto' ||
        s.geminiApiRuntime === 'always' ||
        s.geminiApiRuntime === 'never'
        ? s.geminiApiRuntime
        : 'auto'
    )
    void refreshProviderMetadata(s.activeProvider || 'gemini')
    // 1.0.6-G3d — derive Grok availability from the registered adapters (the
    // registry includes 'grok' only when the experimental gate is on).
    if (typeof window.api.getProviderAdapters === 'function') {
      void window.api
        .getProviderAdapters()
        .then((adapters) => {
          const ids = Array.isArray(adapters)
            ? adapters.map((adapter) => (adapter as { provider?: string } | null)?.provider)
            : []
          setGrokProviderAvailable(ids.includes('grok'))
          setCursorProviderAvailable(ids.includes('cursor'))
        })
        .catch(() => {})
    }
    if (typeof window.api.getGeminiMcpBridgeStatus === 'function') {
      void window.api
        .getGeminiMcpBridgeStatus()
        .then(setGeminiMcpBridgeStatus)
        .catch(() => {})
    }
    if (typeof window.api.getProductOperationsStatus === 'function') {
      void window.api
        .getProductOperationsStatus()
        .then(setProductOperationsStatus)
        .catch(() => {})
    }
    if (typeof window.api.getClaudeAuthStatus === 'function') {
      void window.api
        .getClaudeAuthStatus()
        .then(setClaudeAuthStatus)
        .catch(() => {})
    }
    if (typeof window.api.getKimiAuthStatus === 'function') {
      void window.api
        .getKimiAuthStatus()
        .then(setKimiAuthStatus)
        .catch(() => {})
    }
    void refreshGeminiAuthStatus()
    // Defensive: a previous regression where any of the four
    // mount-time loads threw silently (e.g. one malformed chat JSON in
    // `getChats`) would block the rest of the chain — `setWorkspaces`
    // would never fire and the sidebar painted with the initial empty
    // state until the user manually added a workspace, at which point
    // `handleSelectWorkspace` re-fetched and all "previously loaded"
    // workspaces suddenly appeared. Use `Promise.allSettled` so each
    // load is independent, then apply whatever resolved.
    const [wsResult, chatsResult, profilesResult, handoffsResult] = await Promise.allSettled([
      window.api.getWorkspaces(),
      window.api.getChats(),
      typeof window.api.getRuntimeProfiles === 'function'
        ? window.api.getRuntimeProfiles()
        : Promise.resolve([]),
      typeof window.api.getHandoffCards === 'function'
        ? window.api.getHandoffCards()
        : Promise.resolve([])
    ])
    const wsList = wsResult.status === 'fulfilled' ? wsResult.value : []
    const allChats = chatsResult.status === 'fulfilled' ? chatsResult.value : []
    const profiles = profilesResult.status === 'fulfilled' ? profilesResult.value : []
    const handoffs = handoffsResult.status === 'fulfilled' ? handoffsResult.value : []
    if (wsResult.status === 'rejected') {
      console.error('[loadInitialData] getWorkspaces failed:', wsResult.reason)
    }
    if (chatsResult.status === 'rejected') {
      console.error('[loadInitialData] getChats failed:', chatsResult.reason)
    }
    if (profilesResult.status === 'rejected') {
      console.error('[loadInitialData] getRuntimeProfiles failed:', profilesResult.reason)
    }
    if (handoffsResult.status === 'rejected') {
      console.error('[loadInitialData] getHandoffCards failed:', handoffsResult.reason)
    }
    setRuntimeProfiles(profiles)
    setHandoffCards(handoffs)
    setChats(allChats)
    setWorkspaces(wsList)
    setWorkspacesHydrated(true)
    await rehydrateQueuedRuns(wsList).catch(() => {})
    if (isChatPopoutWindow) {
      const popoutChat = allChats.find((chat) => chat.appChatId === chatPopoutChatIdRef.current)
      if (popoutChat) {
        const provider = getChatProvider(popoutChat)
        chatByIdRef.current.set(popoutChat.appChatId, popoutChat)
        currentChatIdRef.current = popoutChat.appChatId
        if (isGlobalChat(popoutChat)) {
          setCurrentWorkspace(null)
          currentWorkspaceIdRef.current = null
        } else {
          const workspaceForChat =
            wsList.find((workspace) => workspace.id === popoutChat.workspaceId) ||
            (popoutChat.workspacePath
              ? {
                  id: popoutChat.workspaceId || popoutChat.workspacePath,
                  path: popoutChat.workspacePath,
                  displayName:
                    popoutChat.workspacePath.split(/[\\/]/).filter(Boolean).pop() || 'Workspace',
                  lastOpenedAt: Date.now(),
                  createdAt: Date.now(),
                  pinned: false
                }
              : null)
          setCurrentWorkspace(workspaceForChat)
          currentWorkspaceIdRef.current = workspaceForChat?.id || popoutChat.workspaceId || null
          if (workspaceForChat?.path) {
            window.api
              .checkTrust(workspaceForChat.path)
              .then(setTrustResult)
              .catch(() => {})
          }
        }
        setCurrentChat(popoutChat)
        applyChatComposerSelection(popoutChat, provider)
        const popoutHandoff = readChatPopoutHandoff(popoutChat.appChatId)
        if (typeof popoutHandoff?.draft === 'string') {
          setChatPromptDraft(popoutChat.appChatId, popoutHandoff.draft)
        }
        void refreshUsageSummary(getUsageWorkspaceIdForChat(popoutChat), provider)
        void refreshProviderMetadata(provider, popoutChat.workspacePath)
        setRawLogs(rawLogsByChatIdRef.current.get(popoutChat.appChatId) || [])
        hydrateThreadRawLogsFromEvents(popoutChat.appChatId)
        setShowFallbackUX(false)
        setIsThinking(runningChatIds.has(popoutChat.appChatId))
        if (popoutHandoff?.scrollState) {
          autoFollowRef.current = popoutHandoff.scrollState.atBottom
          restoreChatScrollState(transcriptScrollRef.current, popoutHandoff.scrollState)
        }
        return
      }
      console.warn('[chat-popout] requested chat was not found:', chatPopoutChatIdRef.current)
    }
    if (wsList.length > 0) {
      // Sort by lastOpenedAt descending
      const sorted = [...wsList].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
      handleSelectExistingWorkspace(sorted[0])
    } else {
      // First-launch / zero-workspace case: prefer an existing global chat so
      // the composer is immediately usable in workspace-less mode, falling
      // back to creating a fresh global chat. Both paths route through
      // selectGlobalChat which sets scope='global' on the active chat.
      const existingGlobalChats = allChats
        .filter((chat) => isGlobalChat(chat))
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
      if (existingGlobalChats.length > 0) {
        await selectGlobalChat(existingGlobalChats[0])
      } else {
        try {
          await handleNewGlobalChat()
        } catch (error) {
          console.warn(
            '[TaskWraith] Failed to create initial global chat for workspace-less first launch:',
            error
          )
        }
      }
    }
  }
  loadInitialDataRef.current = loadInitialData

  const handleSettingsChange = (next: SettingsPanelUpdate) => {
    const nextChatContextTurns =
      next.chatContextTurns === undefined ? undefined : clampContextTurns(next.chatContextTurns)

    const settingsPatch: Partial<AppSettings> = {}
    const providersToRefresh: ProviderId[] = []

    if (nextChatContextTurns !== undefined) {
      setChatContextTurns(nextChatContextTurns)
      settingsPatch.chatContextTurns = nextChatContextTurns
    }

    // 1.0.5-EW25 — Currency selection. No local state to mirror
    // (the `displayCurrency` const derives from `settings?.currency`
    // on each render), just persist the patch through the IPC
    // pipeline like every other AppSettings field.
    if (next.currency !== undefined) {
      settingsPatch.currency = next.currency
    }
    if (next.currencyOverestimatePercent !== undefined) {
      settingsPatch.currencyOverestimatePercent = next.currencyOverestimatePercent
    }
    // 1.0.5-EW49 — Dashboard stat prefs (visibility map / global
    // reset timestamp). The patch sets the whole object at once
    // so partial updates still need the caller to spread the
    // existing prefs (which Settings does via
    // `...(dashboardStatPrefs || {})` before mutating just the
    // changed field). No local state mirror — the
    // `denseStatItems` filter + dashboard builder both read from
    // `settings?.dashboardStatPrefs` directly on each render.
    if (next.dashboardStatPrefs !== undefined) {
      settingsPatch.dashboardStatPrefs = next.dashboardStatPrefs
    }
    if (next.welcomeHeatmapPrefs !== undefined) {
      settingsPatch.welcomeHeatmapPrefs = next.welcomeHeatmapPrefs
    }

    // 1.0.5-EW26 — Kimi compatibility filter. Same persist-only
    // pattern — the renderer reads `settings.kimiSanitiserEnabled`
    // / `settings.kimiSanitiserCustomKeywords` directly when
    // rendering the Settings UI; the actual sanitisation happens
    // main-side in `runKimiProvider` when an ensemble dispatch
    // for Kimi is about to spawn.
    if (next.kimiSanitiserEnabled !== undefined) {
      settingsPatch.kimiSanitiserEnabled = next.kimiSanitiserEnabled
    }
    if (next.kimiSanitiserCustomKeywords !== undefined) {
      settingsPatch.kimiSanitiserCustomKeywords = next.kimiSanitiserCustomKeywords
    }

    if (next.mode !== undefined) {
      settingsPatch.appearanceMode = next.mode
      appearance.update({ mode: next.mode })
    }
    if (next.visualEffectStyle !== undefined) {
      settingsPatch.visualEffectStyle = next.visualEffectStyle
      if (next.visualEffectStyle === 'thin_material') {
        settingsPatch.appearanceMode = 'native_glass'
        appearance.update({ visualEffectStyle: next.visualEffectStyle, mode: 'native_glass' })
      } else if (
        next.visualEffectStyle === 'classic' ||
        next.visualEffectStyle === 'liquid_glass'
      ) {
        settingsPatch.appearanceMode = 'soft_glass'
        appearance.update({ visualEffectStyle: next.visualEffectStyle, mode: 'soft_glass' })
      } else {
        appearance.update({ visualEffectStyle: next.visualEffectStyle })
      }
    }
    if (next.themeAppearance !== undefined) {
      settingsPatch.themeAppearance = next.themeAppearance
      appearance.update({ themeAppearance: next.themeAppearance })
    }
    if (next.themeCornerStyle !== undefined) {
      settingsPatch.themeCornerStyle = next.themeCornerStyle
      appearance.update({ themeCornerStyle: next.themeCornerStyle })
    }
    if (next.themeAccentStyle !== undefined) {
      settingsPatch.themeAccentStyle = next.themeAccentStyle
      appearance.update({ themeAccentStyle: next.themeAccentStyle })
    }
    if (next.toolIconAccent !== undefined) {
      settingsPatch.toolIconAccent = next.toolIconAccent
      appearance.update({ toolIconAccent: next.toolIconAccent })
    }
    if (next.userBubbleColor !== undefined) {
      settingsPatch.userBubbleColor = next.userBubbleColor
      appearance.update({ userBubbleColor: next.userBubbleColor })
    }
    if (next.promptSurfaceStyle !== undefined) {
      settingsPatch.promptSurfaceStyle = next.promptSurfaceStyle
      appearance.update({ promptSurfaceStyle: next.promptSurfaceStyle })
    }
    if (next.composerStyle !== undefined) {
      settingsPatch.composerStyle = next.composerStyle
      appearance.update({ composerStyle: next.composerStyle })
    }
    if (next.transcriptFontFamily !== undefined) {
      settingsPatch.transcriptFontFamily = next.transcriptFontFamily
      appearance.update({ transcriptFontFamily: next.transcriptFontFamily })
    }
    if (next.composerFontFamily !== undefined) {
      settingsPatch.composerFontFamily = next.composerFontFamily
      appearance.update({ composerFontFamily: next.composerFontFamily })
    }
    if (next.keyCommandBindings !== undefined) {
      settingsPatch.keyCommandBindings = next.keyCommandBindings
    }
    if (next.funFxEnabled !== undefined) {
      settingsPatch.funFxEnabled = next.funFxEnabled
      appearance.update({ funFxEnabled: next.funFxEnabled })
    }
    if (next.funFxMode !== undefined) {
      settingsPatch.funFxMode = next.funFxMode
      appearance.update({ funFxMode: next.funFxMode })
    }
    if (next.advancedFx !== undefined) {
      settingsPatch.advancedFx = next.advancedFx
      appearance.update({ advancedFx: next.advancedFx })
    }
    if (next.reduceTransparency !== undefined) {
      settingsPatch.reduceTransparency = next.reduceTransparency
      appearance.update({ reduceTransparency: next.reduceTransparency })
    }
    if (next.reduceMotion !== undefined) {
      settingsPatch.reduceMotion = next.reduceMotion
      appearance.update({ reduceMotion: next.reduceMotion })
    }
    if (next.compactDensity !== undefined) {
      settingsPatch.compactDensity = next.compactDensity
      appearance.update({ compactDensity: next.compactDensity })
    }
    if (next.sidebarOpacity !== undefined || next.sidebarOpacityOverride !== undefined) {
      if (next.sidebarOpacity !== undefined) {
        settingsPatch.sidebarOpacity = next.sidebarOpacity
      }
      if (next.sidebarOpacityOverride !== undefined) {
        settingsPatch.sidebarOpacityOverride = next.sidebarOpacityOverride
      }
      appearance.update({
        ...(next.sidebarOpacity !== undefined ? { sidebarOpacity: next.sidebarOpacity } : {}),
        ...(next.sidebarOpacityOverride !== undefined
          ? { sidebarOpacityOverride: next.sidebarOpacityOverride }
          : {})
      })
    }
    if (next.mainPaneOpacity !== undefined || next.mainPaneOpacityOverride !== undefined) {
      if (next.mainPaneOpacity !== undefined) {
        settingsPatch.mainPaneOpacity = next.mainPaneOpacity
      }
      if (next.mainPaneOpacityOverride !== undefined) {
        settingsPatch.mainPaneOpacityOverride = next.mainPaneOpacityOverride
      }
      appearance.update({
        ...(next.mainPaneOpacity !== undefined ? { mainPaneOpacity: next.mainPaneOpacity } : {}),
        ...(next.mainPaneOpacityOverride !== undefined
          ? { mainPaneOpacityOverride: next.mainPaneOpacityOverride }
          : {})
      })
    }
    if (next.geminiCheckpointingEnabled !== undefined) {
      setGeminiCheckpointingEnabled(next.geminiCheckpointingEnabled)
      settingsPatch.geminiCheckpointingEnabled = next.geminiCheckpointingEnabled
      if (persistentSessionActiveRef.current) {
        setPersistentSessionNeedsRestart(true)
        setRawLogs((prev) => [
          ...prev,
          {
            type: 'info',
            content:
              'Gemini checkpointing setting changed. Restart the persistent session to apply --checkpointing.'
          }
        ])
      }
    }
    if (next.geminiApiRuntime !== undefined) {
      setGeminiApiRuntime(next.geminiApiRuntime)
      settingsPatch.geminiApiRuntime = next.geminiApiRuntime
      // Refresh the Gemini provider metadata so any cached capability /
      // status reflects the new runtime intent on the next render. The
      // actual dispatch logic in main reads the setting at run time, so
      // no extra IPC call is needed beyond the standard updateSettings
      // below.
      if (currentProvider === 'gemini') providersToRefresh.push('gemini')
    }
    if (next.claudeBinaryPath !== undefined) {
      setClaudeBinaryPath(next.claudeBinaryPath)
      settingsPatch.claudeBinaryPath = next.claudeBinaryPath
      if (currentProvider === 'claude') providersToRefresh.push('claude')
    }
    if (next.kimiBinaryPath !== undefined) {
      setKimiBinaryPath(next.kimiBinaryPath)
      settingsPatch.kimiBinaryPath = next.kimiBinaryPath
      if (currentProvider === 'kimi') providersToRefresh.push('kimi')
    }
    if (next.agenticServices !== undefined) {
      const normalizedServices = { ...DEFAULT_AGENTIC_SERVICES, ...next.agenticServices }
      setAgenticServices(normalizedServices)
      settingsPatch.agenticServices = normalizedServices
      providersToRefresh.push(currentProvider)
    }
    if (next.nativeSubAgentRequests !== undefined) {
      settingsPatch.nativeSubAgentRequests = next.nativeSubAgentRequests
    }
    if (next.autoResumeParentOnSubThreadCompletion !== undefined) {
      setAutoResumeParentOnSubThreadCompletion(next.autoResumeParentOnSubThreadCompletion)
      settingsPatch.autoResumeParentOnSubThreadCompletion =
        next.autoResumeParentOnSubThreadCompletion
    }
    if (next.geminiMcpBridgeEnabled !== undefined) {
      const enabled = Boolean(next.geminiMcpBridgeEnabled)
      setGeminiMcpBridgeEnabledState(enabled)
      settingsPatch.geminiMcpBridgeEnabled = enabled
      if (typeof window.api.setGeminiMcpBridgeEnabled === 'function') {
        window.api
          .setGeminiMcpBridgeEnabled(enabled)
          .then((status) => {
            setGeminiMcpBridgeStatus(status)
            void refreshProviderMetadata('gemini')
          })
          .catch((error) => {
            setRawLogs((prev) => [
              ...prev,
              {
                type: 'stderr',
                content: `Failed to update Gemini MCP bridge: ${redactLog(String(error))}`
              }
            ])
          })
      }
    }
    if (next.codexSandboxFallback !== undefined) {
      setCodexSandboxFallback(next.codexSandboxFallback)
      settingsPatch.codexSandboxFallback = next.codexSandboxFallback
    }
    if (next.updateChannel !== undefined) {
      setUpdateChannel(next.updateChannel)
      settingsPatch.updateChannel = next.updateChannel
    }
    if (next.approvalTimeouts !== undefined) {
      setApprovalTimeouts(next.approvalTimeouts)
      settingsPatch.approvalTimeouts = next.approvalTimeouts
    }

    if (Object.keys(settingsPatch).length > 0) {
      window.api
        .updateSettings(settingsPatch)
        .then(() =>
          providersToRefresh.forEach((provider) => void refreshProviderMetadata(provider))
        )
        .catch(() => {})
      setSettings((prev) => (prev ? { ...prev, ...settingsPatch } : prev))
    }
  }

  const applyAgenticWorkspaceGrantSettings = (nextSettings: AppSettings) => {
    setSettings(nextSettings)
    setAgenticServices({ ...DEFAULT_AGENTIC_SERVICES, ...(nextSettings.agenticServices || {}) })
    setAutoResumeParentOnSubThreadCompletion(
      typeof nextSettings.autoResumeParentOnSubThreadCompletion === 'boolean'
        ? nextSettings.autoResumeParentOnSubThreadCompletion
        : true
    )
    setAgenticWorkspaceGrants(
      Array.isArray(nextSettings.agenticWorkspaceGrants) ? nextSettings.agenticWorkspaceGrants : []
    )
    setAgenticWorkspaceGrantCount(
      Array.isArray(nextSettings.agenticWorkspaceGrants)
        ? nextSettings.agenticWorkspaceGrants.length
        : 0
    )
    void refreshProviderMetadata(currentProvider)
  }

  const handleSetAgenticWorkspaceGrant = async (
    service: AgenticServiceId,
    enabled: boolean,
    providerOverride?: ProviderId
  ) => {
    if (!currentWorkspace?.path || isCurrentGlobalChat) return
    // Slice F v2 (1.0.3) — when toggling grants from the composer
    // pickers on an ensemble chat with a participant selected, the
    // grant should target THAT participant's provider, not the chat's
    // default. providerOverride threads it through; falls back to the
    // chat-level currentProvider when not specified (the solo path).
    const targetProvider = providerOverride ?? currentProvider
    const nextSettings = enabled
      ? await window.api.upsertAgenticWorkspaceGrant(targetProvider, currentWorkspace.path, service)
      : await window.api.removeAgenticWorkspaceGrant(targetProvider, currentWorkspace.path, service)
    applyAgenticWorkspaceGrantSettings(nextSettings)
  }

  const handleRemoveAgenticWorkspaceGrant = async (
    provider: ProviderId,
    workspacePath: string,
    service: AgenticServiceId
  ) => {
    const nextSettings = await window.api.removeAgenticWorkspaceGrant(
      provider,
      workspacePath,
      service
    )
    applyAgenticWorkspaceGrantSettings(nextSettings)
  }

  const handleTriggerClaudeLogin = async () => {
    if (typeof window.api.triggerClaudeLogin !== 'function') return
    setClaudeLoginState('loading')
    try {
      await window.api.triggerClaudeLogin()
      setClaudeLoginState('success')
      setTimeout(() => setClaudeLoginState('idle'), 4000)
      if (typeof window.api.getClaudeAuthStatus === 'function') {
        void window.api
          .getClaudeAuthStatus()
          .then(setClaudeAuthStatus)
          .catch(() => {})
      }
    } catch {
      setClaudeLoginState('error')
      setTimeout(() => setClaudeLoginState('idle'), 4000)
    }
  }

  const handleStoreClaudeApiKey = async (key: string) => {
    if (typeof window.api.storeClaudeApiKey !== 'function') return
    await window.api.storeClaudeApiKey(key).catch(() => {})
    if (typeof window.api.getClaudeAuthStatus === 'function') {
      void window.api
        .getClaudeAuthStatus()
        .then(setClaudeAuthStatus)
        .catch(() => {})
    }
  }

  const handleClearClaudeApiKey = async () => {
    if (typeof window.api.clearClaudeApiKey !== 'function') return
    await window.api.clearClaudeApiKey().catch(() => {})
    if (typeof window.api.getClaudeAuthStatus === 'function') {
      void window.api
        .getClaudeAuthStatus()
        .then(setClaudeAuthStatus)
        .catch(() => {})
    }
  }

  const handleStoreKimiApiKey = async (key: string) => {
    if (typeof window.api.storeKimiApiKey !== 'function') return
    await window.api.storeKimiApiKey(key).catch(() => {})
    if (typeof window.api.getKimiAuthStatus === 'function') {
      void window.api
        .getKimiAuthStatus()
        .then(setKimiAuthStatus)
        .catch(() => {})
    }
  }

  const handleClearKimiApiKey = async () => {
    if (typeof window.api.clearKimiApiKey !== 'function') return
    await window.api.clearKimiApiKey().catch(() => {})
    if (typeof window.api.getKimiAuthStatus === 'function') {
      void window.api
        .getKimiAuthStatus()
        .then(setKimiAuthStatus)
        .catch(() => {})
    }
  }

  const handleSaveGeminiAuthProfile = async (profile: {
    id?: string
    label?: string
    kind: 'api-key' | 'vertex-ai' | 'google-oauth'
    apiKey?: string
    vertexProject?: string
    vertexLocation?: string
    makeDefault?: boolean
  }) => {
    if (typeof window.api.saveGeminiAuthProfile !== 'function') return
    await window.api.saveGeminiAuthProfile(profile).catch((error) => {
      setRawLogs((prev) => [
        ...prev,
        {
          type: 'stderr',
          content: `Failed to save Gemini auth profile: ${redactLog(String(error))}`
        }
      ])
    })
    await refreshGeminiAuthStatus()
  }

  const handleStartGeminiOAuthLogin = async (input: {
    profileId?: string
    label?: string
    makeDefault?: boolean
  }): Promise<GeminiOAuthLoginStatus | null> => {
    if (typeof window.api.startGeminiOAuthLogin !== 'function') return null
    const status = await window.api.startGeminiOAuthLogin(input).catch((error) => {
      setRawLogs((prev) => [
        ...prev,
        {
          type: 'stderr',
          content: `Failed to start Gemini Google login: ${redactLog(String(error))}`
        }
      ])
      return null
    })
    await refreshGeminiAuthStatus()
    markPersistentSessionRestartNeeded(
      'Gemini auth profile changed. Restart the persistent session to apply the selected account.'
    )
    return status
  }

  const handleCancelGeminiOAuthLogin = async (profileId?: string | null) => {
    if (typeof window.api.cancelGeminiOAuthLogin !== 'function') return
    await window.api.cancelGeminiOAuthLogin(profileId).catch((error) => {
      setRawLogs((prev) => [
        ...prev,
        {
          type: 'stderr',
          content: `Failed to cancel Gemini Google login: ${redactLog(String(error))}`
        }
      ])
    })
    await refreshGeminiAuthStatus()
  }

  const handleSetDefaultGeminiAuthProfile = async (profileId: string | null) => {
    if (typeof window.api.setDefaultGeminiAuthProfile !== 'function') return
    await window.api.setDefaultGeminiAuthProfile(profileId).catch((error) => {
      setRawLogs((prev) => [
        ...prev,
        {
          type: 'stderr',
          content: `Failed to select Gemini auth profile: ${redactLog(String(error))}`
        }
      ])
    })
    await refreshGeminiAuthStatus()
    markPersistentSessionRestartNeeded(
      'Gemini auth profile changed. Restart the persistent session to apply the selected account.'
    )
  }

  const handleDeleteGeminiAuthProfile = async (profileId: string) => {
    if (typeof window.api.deleteGeminiAuthProfile !== 'function') return
    await window.api.deleteGeminiAuthProfile(profileId).catch((error) => {
      setRawLogs((prev) => [
        ...prev,
        {
          type: 'stderr',
          content: `Failed to delete Gemini auth profile: ${redactLog(String(error))}`
        }
      ])
    })
    await refreshGeminiAuthStatus()
    markPersistentSessionRestartNeeded(
      'Gemini auth profile changed. Restart the persistent session to apply the selected account.'
    )
  }

  const handleProviderChange = async (provider: ProviderId) => {
    if (currentChat && isCurrentChatProviderLocked && provider !== currentProvider) {
      setRawLogs((prev) => [
        ...prev,
        {
          type: 'info',
          content:
            'Provider is locked for this chat (' +
            currentProvider +
            '). Create a new chat to use ' +
            provider +
            '.'
        }
      ])
      return
    }
    const nextModel = getDefaultModelForProvider(provider)
    const nextRuntimeProfileId = defaultRuntimeProfileIdForProvider(provider)
    const nextMetadata = {
      selectedModelType: nextModel,
      customModel: '',
      approvalMode,
      ...(provider === 'kimi' ? { kimiThinkingEnabled: true } : {}),
      runtimeProfileId: nextRuntimeProfileId
    }
    setActiveProvider(provider)
    setSelectedModelType(nextModel)
    setLastNonCustomModelType(nextModel)
    setCustomModel('')
    if (provider === 'kimi') {
      setKimiThinkingEnabled(true)
    }
    setRuntimeProfileForChat(currentChat?.appChatId, nextRuntimeProfileId)
    if (provider === 'gemini') {
      syncPersistentModelSelection(nextModel)
    }
    if (currentChat && !isCurrentChatProviderLocked) {
      const updatedChat = {
        ...currentChat,
        provider,
        providerMetadata: {
          ...(currentChat.providerMetadata || {}),
          ...nextMetadata
        },
        updatedAt: Date.now()
      }
      currentChatIdRef.current = updatedChat.appChatId
      chatByIdRef.current.set(updatedChat.appChatId, updatedChat)
      setCurrentChat(updatedChat)
      setChats((prev) =>
        prev.map((chat) => (chat.appChatId === currentChat.appChatId ? updatedChat : chat))
      )
      window.api.saveChat(updatedChat).catch(() => {})
    }
    setPendingAgentApproval(null)
    window.api.updateSettings({ activeProvider: provider }).catch(() => {})
    void refreshProviderMetadata(provider, isCurrentGlobalChat ? null : undefined)
    const usageWorkspaceId =
      getUsageWorkspaceIdForChat(currentChat) || currentWorkspaceIdRef.current || undefined
    if (usageWorkspaceId) {
      void refreshUsageSummary(usageWorkspaceId, provider)
    }
    if (provider === 'codex') {
      if (typeof window.api.listAgentThreads === 'function') {
        window.api
          .listAgentThreads('codex', { cwd: currentWorkspace?.path || null })
          .then((response) => setCodexThreads(Array.isArray(response?.data) ? response.data : []))
          .catch(() => setCodexThreads([]))
      }
    } else {
      setCodexThreads([])
    }

    if (provider !== 'gemini' && showGeminiTerminal) {
      setShowGeminiTerminal(false)
    }
    if (provider !== 'gemini' && persistentSessionActiveRef.current) {
      const geminiSessionApi = window.api as any
      if (typeof geminiSessionApi.stopGeminiSession === 'function') {
        geminiSessionApi.stopGeminiSession().catch(() => {})
      }
      persistentSessionActiveRef.current = false
      setIsPersistentSessionEnabled(false)
      setPersistentSessionStatus('idle')
      setPersistentSessionNeedsRestart(false)
    }
  }

  const handleRuntimeProfileChange = (runtimeProfileId: string) => {
    const chatId = currentChatIdRef.current || currentChat?.appChatId
    if (!chatId) return
    // 1.0.4-AT2 — write-through to the selected participant when
    // the runtime picker is in participant scope. Pre-AT2 the
    // picker always wrote to chat-level state regardless of
    // Ensemble selection, so the per-participant
    // `runtimeProfileId` (which is what dispatch actually uses)
    // never got updated. We still set the chat-level cache
    // because it's the picker's fallback for the next render
    // when no participant is selected — but the source of truth
    // for Ensemble dispatch is now correctly the participant.
    if (isCurrentEnsembleChat && selectedParticipant && currentChat?.ensemble) {
      updateSelectedParticipant({ runtimeProfileId })
      // Skip the chat-level write for ensembles so we don't
      // poison the chat-level provider/runtime metadata with
      // a participant-scoped choice. The chat-level cache below
      // still mirrors the selection so the picker keeps
      // displaying the right value mid-render.
      setRuntimeProfileForChat(chatId, runtimeProfileId)
      return
    }
    setRuntimeProfileForChat(chatId, runtimeProfileId)
    updateChatById(chatId, (source) => ({
      ...source,
      providerMetadata: {
        ...(source.providerMetadata || {}),
        runtimeProfileId
      },
      updatedAt: Date.now()
    }))
  }

  // 1.0.5-EW53 — useCallback'd so WorkspaceAccessControls (now
  // memo'd) doesn't re-render on every keystroke. Deps narrow to
  // the only values the body genuinely closes over (currentWorkspace
  // + isRunning); state setters and imported helpers are stable.
  // `persistentSessionActiveRef` is read via `.current` lazily — no
  // dep needed.
  const handleGeminiWorktreeToggle = useCallback(async () => {
    if (!currentWorkspace || isRunning) {
      return
    }

    const isEnabled = Boolean(resolveGeminiWorktreeConfig(currentWorkspace)?.enabled)
    const geminiWorktree: GeminiWorktreeConfig = isEnabled ? { enabled: false } : { enabled: true }

    const updatedWorkspace = await window.api.addOrUpdateWorkspace(currentWorkspace.path, {
      geminiWorktree
    })
    setCurrentWorkspace(updatedWorkspace)
    setWorkspaces((prev) =>
      prev.map((workspace) => (workspace.id === updatedWorkspace.id ? updatedWorkspace : workspace))
    )
    setRunDiff(null)

    const nextWorktree = resolveGeminiWorktreeConfig(updatedWorkspace)
    if (isGeminiWorktreeDiffUnavailable(nextWorktree)) {
      setDiff(createWorktreeDiffUnavailable())
      setDiffView('workspace')
      setDiffRefreshStatus('Diff disabled: worktree path unknown.')
    } else {
      setDiff(null)
      setDiffRefreshStatus('')
    }

    if (persistentSessionActiveRef.current) {
      setPersistentSessionNeedsRestart(true)
      setRawLogs((prev) => [
        ...prev,
        {
          type: 'info',
          content:
            'Gemini worktree setting changed. Restart the persistent session to apply --worktree.'
        }
      ])
    }
  }, [currentWorkspace, isRunning])
  // 1.0.5-EW53 — Stable wrapper for the `() => void` prop signature
  // on WorkspaceAccessControls. The inner handler returns a Promise;
  // wrapping each call site in an inline arrow created a fresh
  // function identity every render and defeated the parent's memo
  // wrapper. This callback is stable as long as the inner handler is.
  const onGeminiWorktreeToggleProp = useCallback((): void => {
    void handleGeminiWorktreeToggle()
  }, [handleGeminiWorktreeToggle])

  const refreshCodexThreads = async () => {
    if (typeof window.api.listAgentThreads !== 'function') {
      setCodexThreads([])
      return
    }
    try {
      const response = await window.api.listAgentThreads('codex', {
        cwd: currentWorkspace?.path || null
      })
      setCodexThreads(Array.isArray(response?.data) ? response.data : [])
    } catch {
      setCodexThreads([])
    }
  }

  const linkCodexThreadToCurrentChat = async (threadId: string) => {
    if (!currentChat || !threadId) return
    // 1.0.4-AT1 — route the linkage decision through the shared
    // helper. In Ensemble chats with a matching-provider selected
    // participant, the thread id binds to the participant's
    // `linkedProviderSessionId` instead of the chat-level field.
    // Pre-AT1 every `/resume` clobbered the chat-level field even
    // when the user clearly meant "resume Codex#2's session", which
    // poisoned sub-thread recall + transcript export downstream.
    const routing = resolveSessionLinkRouting({
      chat: currentChat,
      provider: 'codex',
      selectedParticipant: isCurrentEnsembleChat ? selectedParticipant : null
    })
    if (routing.warning) {
      setRawLogs((prev) => [...prev, { type: 'info', content: routing.warning! }])
    }
    let updatedChat: ChatRecord
    if (routing.target === 'participant' && routing.participantId && currentChat.ensemble) {
      // Patch the selected participant's `linkedProviderSessionId`
      // in place. The chat's own `linkedProviderSessionId` is left
      // alone so multi-participant ensembles keep independent
      // provider sessions per participant.
      const patchedParticipants = (currentChat.ensemble.participants || []).map((p) =>
        p.id === routing.participantId ? { ...p, linkedProviderSessionId: threadId } : p
      )
      updatedChat = {
        ...currentChat,
        ensemble: {
          ...currentChat.ensemble,
          participants: patchedParticipants,
          updatedAt: new Date().toISOString()
        }
      }
    } else {
      updatedChat = {
        ...currentChat,
        provider: 'codex',
        linkedProviderSessionId: threadId
      }
    }
    setCurrentChat(updatedChat)
    setChats((prev) =>
      prev.map((chat) => (chat.appChatId === updatedChat.appChatId ? updatedChat : chat))
    )
    await window.api.saveChat(updatedChat)
    const linkScope =
      routing.target === 'participant' ? ` to participant ${routing.participantId}` : ''
    setRawLogs((prev) => [
      ...prev,
      { type: 'info', content: `Linked Codex thread${linkScope}: ${threadId}` }
    ])
  }

  const handleResumeCodexThread = async (threadId: string) => {
    await linkCodexThreadToCurrentChat(threadId)
  }

  const handleForkCodexThread = async (threadId: string) => {
    if (!threadId || typeof window.api.forkAgentThread !== 'function') return
    try {
      const response = await window.api.forkAgentThread('codex', threadId, {
        cwd: currentWorkspace?.path || undefined,
        model: isCodexModelId(selectedModelType) ? selectedModelType : CODEX_DEFAULT_MODEL,
        excludeTurns: true
      })
      const forkedThreadId = response?.thread?.id
      if (forkedThreadId) {
        await linkCodexThreadToCurrentChat(forkedThreadId)
        await refreshCodexThreads()
      }
    } catch (error) {
      setRawLogs((prev) => [
        ...prev,
        { type: 'stderr', content: `Failed to fork Codex thread: ${redactLog(String(error))}` }
      ])
    }
  }

  const handleSelectExistingWorkspace = async (ws: WorkspaceRecord) => {
    const geminiSessionApi = window.api as any
    if (
      persistentSessionActiveRef.current &&
      typeof geminiSessionApi.stopGeminiSession === 'function'
    ) {
      geminiSessionApi.stopGeminiSession().catch(() => {})
    }
    persistentSessionActiveRef.current = false
    setIsPersistentSessionEnabled(false)
    setPersistentSessionStatus('idle')
    setPersistentSessionNeedsRestart(false)
    setCurrentWorkspace(ws)
    currentWorkspaceIdRef.current = ws.id

    // 1.0.5-EW41 — When the current chat is an Ensemble, rebind it
    // in place to the new workspace instead of falling through to
    // the "find empty chat or create new single-provider chat"
    // path below. Pre-EW41 a user mid-Ensemble who switched
    // workspaces (composer workspace switcher → Add new workspace
    // or pick another) was dropped onto a fresh Gemini single-
    // provider welcome screen — losing their entire curated panel
    // and transcript. The helper preserves participants + ensemble
    // config + history; subsequent rounds dispatch against the new
    // workspace path. The helper returns null when the rebind is a
    // no-op (chat is already on this workspace) — we then short-
    // circuit without churning state, since the user effectively
    // re-selected their current workspace from the popover.
    if (isCurrentEnsembleChat && currentChat) {
      const rebound = rebindEnsembleChatToWorkspace(currentChat, ws)
      if (rebound) {
        const chatWithLedger = withSessionActivityLedger(currentChat, rebound)
        const provider = getChatProvider(chatWithLedger)
        updateChatById(chatWithLedger.appChatId, () => chatWithLedger)
        await refreshUsageSummary(ws.id, provider)
        setDiff(
          provider === 'gemini' && isGeminiWorktreeDiffUnavailable(resolveGeminiWorktreeConfig(ws))
            ? createWorktreeDiffUnavailable()
            : null
        )
        void refreshProviderMetadata(provider, ws.path)
        setRunDiff(null)
        setRunCompleteNotice(null)
        setRawLogs(rawLogsByChatIdRef.current.get(chatWithLedger.appChatId) || [])
        hydrateThreadRawLogsFromEvents(chatWithLedger.appChatId)
        setShowFallbackUX(false)
        setSessionTrust(false)
        setIsThinking(runningChatIds.has(chatWithLedger.appChatId))
        if (provider === 'codex' && typeof window.api.listAgentThreads === 'function') {
          window.api
            .listAgentThreads('codex', { cwd: ws.path })
            .then((response) => setCodexThreads(Array.isArray(response?.data) ? response.data : []))
            .catch(() => setCodexThreads([]))
        }
        const tr = await window.api.checkTrust(ws.path)
        setTrustResult(tr)
        return
      }
      // rebound === null → chat is already on this workspace.
      // No state churn needed; we already set currentWorkspace
      // above (cheap no-op when identical), so just refresh trust
      // and bail. This handles the edge case where the user picks
      // the workspace they're already in from the popover.
      const tr = await window.api.checkTrust(ws.path)
      setTrustResult(tr)
      return
    }

    const allChats = await window.api.getChats()
    const workspaceChats = allChats.filter((chat) => chat.workspaceId === ws.id)
    const emptyChat = workspaceChats.find((chat) => chat.messages.length === 0)
    let selectedProvider: ProviderId = 'gemini'
    let selectedChat: ChatRecord
    if (emptyChat) {
      const provider = getChatProvider(emptyChat)
      selectedProvider = provider
      selectedChat = emptyChat
      setChats(allChats)
      currentChatIdRef.current = emptyChat.appChatId
      chatByIdRef.current.set(emptyChat.appChatId, emptyChat)
      setCurrentChat(emptyChat)
      applyChatComposerSelection(emptyChat, provider)
    } else {
      const newChat = await window.api.createChat(ws.id, ws.path)
      const provider = getChatProvider(newChat)
      selectedProvider = provider
      selectedChat = newChat
      const updatedChats = await window.api.getChats()
      setChats(updatedChats)
      currentChatIdRef.current = newChat.appChatId
      chatByIdRef.current.set(newChat.appChatId, newChat)
      setCurrentChat(newChat)
      applyChatComposerSelection(newChat, provider)
    }
    await refreshUsageSummary(ws.id, selectedProvider)
    setDiff(
      selectedProvider === 'gemini' &&
        isGeminiWorktreeDiffUnavailable(resolveGeminiWorktreeConfig(ws))
        ? createWorktreeDiffUnavailable()
        : null
    )
    void refreshProviderMetadata(selectedProvider, ws.path)
    setRunDiff(null)
    setRunCompleteNotice(null)
    setRawLogs(rawLogsByChatIdRef.current.get(selectedChat.appChatId) || [])
    hydrateThreadRawLogsFromEvents(selectedChat.appChatId)
    setShowFallbackUX(false)
    setSessionTrust(false)
    setIsThinking(runningChatIds.has(selectedChat.appChatId))
    if (selectedProvider === 'codex' && typeof window.api.listAgentThreads === 'function') {
      window.api
        .listAgentThreads('codex', { cwd: ws.path })
        .then((response) => setCodexThreads(Array.isArray(response?.data) ? response.data : []))
        .catch(() => setCodexThreads([]))
    }

    // Check trust
    const tr = await window.api.checkTrust(ws.path)
    setTrustResult(tr)
  }

  const handleSelectWelcomeWorkspace = async (ws: WorkspaceRecord) => {
    const rebound = rebindWelcomeEnsembleChatToWorkspace(currentChat, ws, isWelcomeChat)
    if (!rebound) {
      await handleSelectExistingWorkspace(ws)
      return
    }
    const chatWithLedger = currentChat ? withSessionActivityLedger(currentChat, rebound) : rebound

    setCurrentWorkspace(ws)
    currentWorkspaceIdRef.current = ws.id
    updateChatById(chatWithLedger.appChatId, () => chatWithLedger)
    await refreshUsageSummary(ws.id, getChatProvider(chatWithLedger))
    setDiff(null)
    setRunDiff(null)
    setRunCompleteNotice(null)
    setRawLogs(rawLogsByChatIdRef.current.get(chatWithLedger.appChatId) || [])
    hydrateThreadRawLogsFromEvents(chatWithLedger.appChatId)
    setShowFallbackUX(false)
    setSessionTrust(false)
    setIsThinking(runningChatIds.has(rebound.appChatId))
    void refreshProviderMetadata(getChatProvider(chatWithLedger), ws.path)
    const tr = await window.api.checkTrust(ws.path)
    setTrustResult(tr)
  }

  const refreshUsageSummary = async (
    _workspaceId?: string,
    _providerHint?: ProviderId,
    codexStatusHint?: any
  ) => {
    const now = Date.now()
    const effectiveCodexStatus = codexStatusHint ?? codexStatus

    const [geminiSnap, codexSnap, claudeSnap, kimiSnap, cursorSnap, allUsageRecords] =
      await Promise.all([
        window.api.getAgentRateLimits('gemini').catch(() => null),
        typeof window.api.getCodexUsageSnapshot === 'function'
          ? window.api.getCodexUsageSnapshot().catch(() => null)
          : Promise.resolve(null),
        window.api.getAgentRateLimits('claude').catch(() => null),
        window.api.getAgentRateLimits('kimi').catch(() => null),
        window.api.getAgentRateLimits('cursor').catch(() => null),
        window.api.getUsage().catch(() => [])
      ])

    const normalizedUsageRecords = Array.isArray(allUsageRecords) ? allUsageRecords : []
    const nextUsageRecordsSignature = JSON.stringify(
      normalizedUsageRecords.map((record) => [
        record.id,
        record.timestamp,
        record.provider || '',
        record.model,
        record.totalTokens,
        record.chatId
      ])
    )
    if (usageRecordsSignatureRef.current !== nextUsageRecordsSignature) {
      usageRecordsSignatureRef.current = nextUsageRecordsSignature
      setUsageRecords(normalizedUsageRecords)
    }

    const normalizeQuotaWindow = (
      provider: ProviderId,
      windowEntry: any,
      fallbackId: string
    ): UsageWindowAggregate | null => {
      const label = String(windowEntry?.label || '').trim()
      const limitLabel = String(windowEntry?.limitLabel || '').trim()
      if (!label || !limitLabel) return null
      // Compute REMAINING honestly from whichever raw percent the
      // upstream IPC provided. (Some sources expose `remainingPercent`
      // directly; others expose `usedPercent` and we derive remaining
      // as the complement.)
      const rawRemainingPercent = Number(windowEntry?.remainingPercent)
      const rawUsedPercent = Number(windowEntry?.usedPercent)
      const remainingPercentRaw =
        provider === 'claude'
          ? Number.isFinite(rawRemainingPercent)
            ? rawRemainingPercent
            : Number.isFinite(rawUsedPercent)
              ? 100 - rawUsedPercent
              : undefined
          : Number.isFinite(rawRemainingPercent)
            ? rawRemainingPercent
            : Number.isFinite(rawUsedPercent)
              ? 100 - rawUsedPercent
              : undefined
      const remainingPercent = Number.isFinite(remainingPercentRaw)
        ? Math.max(0, Math.min(100, remainingPercentRaw as number))
        : undefined
      const usedPercent = Number.isFinite(remainingPercent)
        ? Math.max(0, Math.min(100, 100 - (remainingPercent as number)))
        : undefined
      return {
        id: String(windowEntry?.id || fallbackId),
        label,
        runs: 0,
        totalTokens: 0,
        limitLabel,
        resetAt: typeof windowEntry?.resetAt === 'string' ? windowEntry.resetAt : undefined,
        trackingOnly: false,
        // Honest names: usedPercent = USED, remainingPercent = REMAINING.
        usedPercent,
        remainingPercent,
        limitWindowSeconds:
          Number.isFinite(Number(windowEntry?.limitWindowSeconds)) &&
          Number(windowEntry?.limitWindowSeconds) > 0
            ? Number(windowEntry.limitWindowSeconds)
            : undefined
      }
    }

    const normalizeUsageBalances = (
      provider: ProviderId,
      balances: unknown
    ): UsageBalanceAggregate[] => {
      if (!Array.isArray(balances)) return []
      return balances
        .map((balance: any, index): UsageBalanceAggregate | null => {
          const label = String(balance?.label || '').trim()
          const amount = Number(balance?.amount)
          if (!label || !Number.isFinite(amount)) return null
          const unit = String(balance?.unit || '').trim()
          const resetAt =
            typeof balance?.resetAt === 'string'
              ? balance.resetAt
              : typeof balance?.resetDate === 'string'
                ? balance.resetDate
                : undefined
          return {
            id: String(balance?.id || `${provider}-balance-${index}`),
            label,
            amount,
            unit,
            subtitle: typeof balance?.subtitle === 'string' ? balance.subtitle : undefined,
            resetAt
          }
        })
        .filter((balance): balance is UsageBalanceAggregate => Boolean(balance))
    }
    const hasUsageBalances = (balances: unknown): boolean =>
      Array.isArray(balances) &&
      balances.some((balance: any) => {
        const label = String(balance?.label || '').trim()
        const amount = Number(balance?.amount)
        return Boolean(label) && Number.isFinite(amount)
      })
    const hasQuotaSnapshotContent = (snapshot: any): boolean =>
      (Array.isArray(snapshot?.windows) && snapshot.windows.length > 0) ||
      hasUsageBalances(snapshot?.balances)

    const buildQuotaAggregate = (
      provider: ProviderId,
      windows: UsageWindowAggregate[],
      snapshot?: any
    ): ModelUsageAggregate => ({
      provider,
      model: 'usage limits',
      runs: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      durationMs: 0,
      windows,
      balances: normalizeUsageBalances(provider, snapshot?.balances),
      quotaSource: typeof snapshot?.source === 'string' ? snapshot.source : undefined,
      quotaFetchedAt: typeof snapshot?.fetchedAt === 'string' ? snapshot.fetchedAt : undefined,
      quotaConfigured:
        typeof snapshot?.configured === 'boolean' ? Boolean(snapshot.configured) : undefined,
      quotaError: typeof snapshot?.error === 'string' ? snapshot.error : undefined,
      quotaStale: Boolean(snapshot?.stale)
    })

    const ordered: ModelUsageAggregate[] = []

    const resolveWithCache = (
      provider: ProviderId,
      fresh: UsageWindowAggregate[]
    ): UsageWindowAggregate[] => {
      if (fresh.length > 0) {
        lastUsageWindowsByProviderRef.current[provider] = fresh
        return fresh
      }
      return lastUsageWindowsByProviderRef.current[provider] || []
    }

    // Gemini — only Pro 3.1 (preview), Flash 3 (preview), Flash Lite 3.1 (preview)
    const geminiAllowed = new Set([
      'Pro 3.1 (preview)',
      'Flash 3 (preview)',
      'Flash Lite 3.1 (preview)'
    ])
    const geminiFresh = (Array.isArray(geminiSnap?.windows) ? geminiSnap.windows : [])
      .filter((w: any) => geminiAllowed.has(String(w?.label || '').trim()))
      .map((w: any, i: number) => normalizeQuotaWindow('gemini', w, `gemini-quota-${i}`))
      .filter((w): w is UsageWindowAggregate => Boolean(w))
    const geminiWindows = resolveWithCache('gemini', geminiFresh)
    if (geminiWindows.length > 0 || hasUsageBalances(geminiSnap?.balances)) {
      ordered.push(buildQuotaAggregate('gemini', geminiWindows, geminiSnap))
    }

    // Codex — 5H + weekly + (Pro only) GPT-5.3-Codex-Spark windows, real quotas only
    const effectiveCodexUsage =
      hasQuotaSnapshotContent(codexSnap) ||
      !hasQuotaSnapshotContent(effectiveCodexStatus?.codexUsage)
        ? codexSnap
        : effectiveCodexStatus?.codexUsage
    const codexWindowsRaw = buildCodexUsageWindows(
      [],
      'usage limits',
      now,
      {
        ...(effectiveCodexStatus || {}),
        codexUsage: effectiveCodexUsage
      },
      true
    )
    const codexFresh = codexWindowsRaw.filter((w) => w.usedPercent !== undefined)
    const codexWindows = resolveWithCache('codex', codexFresh)
    if (codexWindows.length > 0 || hasUsageBalances(effectiveCodexUsage?.balances)) {
      ordered.push(buildQuotaAggregate('codex', codexWindows, effectiveCodexUsage))
    }

    // Claude — 5H (Session), Weekly, (Max-gated) Sonnet Weekly, (Max20x) Opus Weekly
    const claudeFresh = (Array.isArray(claudeSnap?.windows) ? claudeSnap.windows : [])
      .map((w: any, i: number) => normalizeQuotaWindow('claude', w, `claude-quota-${i}`))
      .filter((w): w is UsageWindowAggregate => Boolean(w))
    const claudeWindows = resolveWithCache('claude', claudeFresh)
    if (claudeWindows.length > 0 || hasUsageBalances(claudeSnap?.balances)) {
      ordered.push(buildQuotaAggregate('claude', claudeWindows, claudeSnap))
    }

    // Kimi — only 5H and Weekly
    const kimiAllowed = new Set(['5H', 'Weekly'])
    const kimiFresh = (Array.isArray(kimiSnap?.windows) ? kimiSnap.windows : [])
      .filter((w: any) => kimiAllowed.has(String(w?.label || '').trim()))
      .map((w: any, i: number) => normalizeQuotaWindow('kimi', w, `kimi-quota-${i}`))
      .filter((w): w is UsageWindowAggregate => Boolean(w))
    const kimiWindows = resolveWithCache('kimi', kimiFresh)
    if (kimiWindows.length > 0 || hasUsageBalances(kimiSnap?.balances)) {
      ordered.push(buildQuotaAggregate('kimi', kimiWindows, kimiSnap))
    }

    // Cursor — Included in Pro / Auto + Composer / API monthly windows +
    // an On-Demand Spend balance (from the Cursor dashboard RPC).
    const cursorFresh = (Array.isArray(cursorSnap?.windows) ? cursorSnap.windows : [])
      .map((w: any, i: number) => normalizeQuotaWindow('cursor', w, `cursor-quota-${i}`))
      .filter((w): w is UsageWindowAggregate => Boolean(w))
    const cursorWindows = resolveWithCache('cursor', cursorFresh)
    if (cursorWindows.length > 0 || hasUsageBalances(cursorSnap?.balances)) {
      ordered.push(buildQuotaAggregate('cursor', cursorWindows, cursorSnap))
    }

    const inferUsageProvider = (model: string): ProviderId => {
      const normalized = model.toLowerCase()
      if (
        normalized.includes('claude') ||
        normalized.includes('opus') ||
        normalized.includes('sonnet') ||
        normalized.includes('haiku')
      )
        return 'claude'
      if (
        normalized.includes('kimi') ||
        normalized.includes('moonshot') ||
        normalized.includes('k2')
      )
        return 'kimi'
      if (normalized.includes('composer') || normalized.includes('cursor')) return 'cursor'
      if (normalized.includes('grok')) return 'grok'
      if (
        normalized.includes('codex') ||
        normalized.includes('gpt') ||
        normalized.includes('o3') ||
        normalized.includes('o4') ||
        normalized.includes('o5')
      )
        return 'codex'
      return 'gemini'
    }

    const isKnownProvider = (provider: unknown): provider is ProviderId =>
      provider === 'gemini' ||
      provider === 'codex' ||
      provider === 'claude' ||
      provider === 'kimi' ||
      provider === 'grok' ||
      provider === 'cursor'

    const runAggregateMap = new Map<string, ModelUsageAggregate>()
    const modelComparisonCutoff = now - 30 * 24 * 60 * 60 * 1000
    for (const record of normalizedUsageRecords) {
      if (record?.usageKind === 'reset_hint') continue
      if (Number(record?.timestamp || 0) < modelComparisonCutoff) continue
      const model = String(record?.model || '').trim() || 'unknown'
      const provider = isKnownProvider(record?.provider)
        ? record.provider
        : inferUsageProvider(model)
      const key = `${provider}:${model}`
      const inputTokens = Math.max(0, Number(record?.inputTokens || 0))
      const outputTokens = Math.max(0, Number(record?.outputTokens || 0))
      const totalTokens = Math.max(
        0,
        Number(record?.totalTokens || inputTokens + outputTokens || 0)
      )
      const durationMs = Math.max(0, Number(record?.durationMs || 0))
      const existing =
        runAggregateMap.get(key) ||
        ({
          provider,
          model,
          runs: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          durationMs: 0
        } satisfies ModelUsageAggregate)
      existing.runs += 1
      existing.inputTokens += inputTokens
      existing.outputTokens += outputTokens
      existing.totalTokens += totalTokens
      existing.durationMs += durationMs
      existing.inputTokenLimit = Math.max(
        existing.inputTokenLimit || 0,
        Number(record?.inputTokenLimit || 0)
      )
      existing.outputTokenLimit = Math.max(
        existing.outputTokenLimit || 0,
        Number(record?.outputTokenLimit || 0)
      )
      existing.totalTokenLimit = Math.max(
        existing.totalTokenLimit || 0,
        Number(record?.totalTokenLimit || 0)
      )
      if (typeof record?.resetAt === 'string') existing.resetAt = record.resetAt
      if (typeof record?.resetText === 'string') existing.resetText = record.resetText
      runAggregateMap.set(key, existing)
    }

    ordered.push(
      ...Array.from(runAggregateMap.values()).sort(
        (a, b) => b.totalTokens - a.totalTokens || b.runs - a.runs
      )
    )

    const nextUsageSignature = JSON.stringify(
      ordered.map((entry) => ({
        provider: entry.provider,
        model: entry.model,
        runs: entry.runs,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        totalTokens: entry.totalTokens,
        durationMs: entry.durationMs,
        windows: (entry.windows || []).map((windowEntry) => ({
          id: windowEntry.id,
          label: windowEntry.label,
          limitLabel: windowEntry.limitLabel,
          resetAt: windowEntry.resetAt || '',
          usedPercent: windowEntry.usedPercent ?? null,
          remainingPercent: windowEntry.remainingPercent ?? null,
          limitWindowSeconds: windowEntry.limitWindowSeconds ?? null
        })),
        balances: (entry.balances || []).map((balance) => ({
          id: balance.id,
          label: balance.label,
          amount: balance.amount,
          unit: balance.unit,
          resetAt: balance.resetAt || ''
        })),
        quotaSource: entry.quotaSource || '',
        quotaFetchedAt: entry.quotaFetchedAt || '',
        quotaError: entry.quotaError || '',
        quotaStale: entry.quotaStale || false
      }))
    )
    if (usageSummarySignatureRef.current !== nextUsageSignature) {
      usageSummarySignatureRef.current = nextUsageSignature
      setUsageSummary(ordered)
    }
  }

  /**
   * Keep a ref to the *latest* `refreshUsageSummary` closure so the
   * autonomous polling effect (below) doesn't need to depend on `codexStatus`
   * and tear the timer down on every status mutation.
   */

  refreshUsageSummaryRef.current = refreshUsageSummary

  const handleSelectWorkspace = async () => {
    const ws = await window.api.selectWorkspace()
    if (ws) {
      setWorkspaces(await window.api.getWorkspaces())
      await handleSelectExistingWorkspace(ws)
    }
  }

  /**
   * 1.0.5-EW42a — Proactive read-only grant for a secondary folder.
   * Opens an OS folder picker via main; main issues one
   * `ExternalPathGrant` per chat-provider, persists to the chat's
   * metadata, broadcasts chat-updated → the `ExternalPathAboveRow`
   * banner appears immediately. No state-management on the renderer
   * side: the broadcast re-renders. Errors are swallowed because
   * the cancel + invalid-state paths return structured `ok: false`
   * results, not throws.
   */
  /**
   * 1.0.6-EW66-1c — Attach an *additional* workspace folder with a
   * caller-chosen access level (read OR write). Generalizes the old
   * read-only `handleGrantReadAccessFolder`. The IPC
   * (`external-path:pick-and-persist`) + the per-provider write
   * enforcement already honour `access: 'write'` (Codex
   * `writableRoots`, Gemini `hasExternalPathGrantForTarget`,
   * Claude/Kimi `--add-dir` + approval gate), so no main-process
   * change is needed — write is free parameterization here.
   */
  const handleAddWorkspaceFolder = async (access: ExternalPathGrant['access']) => {
    const chatId = currentChat?.appChatId
    if (!chatId) return
    try {
      const result = await window.api.pickAndPersistExternalPathGrant({
        chatId,
        access
      })
      if (!result.ok) {
        // 'cancelled' is the common path; 'no-chat' / 'no-provider'
        // / 'no-window' are defensive. No UI surface needed for any
        // of them — the user already knows they cancelled, and the
        // other reasons indicate an impossible-state we can't show
        // anything meaningful for.
        return
      }
      // Banner / diff row appears via the main → renderer chat-updated
      // broadcast; nothing else to do on this side.
    } catch (err) {
      console.warn('[external-path:pick-and-persist] failed', err)
    }
  }

  /**
   * 1.0.6-EW69 — Attach an EXISTING known workspace as an additional
   * (secondary) workspace with the chosen access, WITHOUT the OS
   * folder dialog. Passes the workspace's path to the same
   * pick-and-persist IPC (which skips the dialog when `path` is set).
   * Makes building a multi-workspace set from already-registered
   * workspaces a one-click action instead of re-picking the folder.
   */
  const handleAddKnownWorkspaceAsSecondary = async (
    workspacePath: string,
    access: ExternalPathGrant['access']
  ) => {
    const chatId = currentChat?.appChatId
    if (!chatId || !workspacePath) return
    try {
      const result = await window.api.pickAndPersistExternalPathGrant({
        chatId,
        access,
        path: workspacePath
      })
      if (!result.ok) return
    } catch (err) {
      console.warn('[external-path:pick-and-persist] (known path) failed', err)
    }
  }

  const handleSelectWelcomeWorkspaceDialog = async () => {
    const ws = await window.api.selectWorkspace()
    if (ws) {
      setWorkspaces(await window.api.getWorkspaces())
      await handleSelectWelcomeWorkspace(ws)
    }
  }

  const handleRemoveWorkspace = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const ok =
      typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm('Remove this workspace from TaskWraith?')
        : true
    if (!ok) return
    await window.api.removeWorkspace(id)
    const wsList = await window.api.getWorkspaces()
    setWorkspaces(wsList)
    if (currentWorkspace?.id === id) {
      setCurrentWorkspace(null)
      setCurrentChat(null)
      setChats(await window.api.getChats())
      setUsageSummary([])
    }
  }

  const handleTogglePinChat = (chatId: string) => {
    updateChatById(chatId, (source) => ({
      ...source,
      pinned: !source.pinned
    }))
  }

  /**
   * Archive / unarchive a chat. Existing sidebar filters already drop
   * archived chats from the visible lists; flipping the flag and saving
   * is enough to hide / restore the tile. Persisted via the same chat
   * save pipeline `handleTogglePinChat` uses so optimistic state and
   * remote state stay in sync.
   */
  const handleToggleArchiveChat = (chatId: string, nextArchived: boolean) => {
    updateChatById(chatId, (source) => ({
      ...(source.parentChatRelation === 'sideChat'
        ? applySideChatLifecycle(
            source,
            nextArchived ? 'terminated' : 'closed',
            'archived_by_user'
          )
        : source),
      archived: nextArchived
    }))
  }

  /**
   * 1.0.3 — rename a chat's user-visible title from the sidebar
   * (overflow menu Rename or double-click on the title of the
   * currently-selected chat). Trimmed + no-op-on-empty enforcement
   * already happens at the sidebar component level; this handler
   * trusts whatever string lands, persists it, and lets the
   * `updateChatById` write fan out to the chat-by-id cache + the
   * IPC saveChat call.
   */
  const handleRenameChat = (chatId: string, nextTitle: string) => {
    const trimmed = nextTitle.trim()
    if (!trimmed) return
    updateChatById(chatId, (source) => {
      if (source.title === trimmed) return source
      const updated: ChatRecord = { ...source, title: trimmed, updatedAt: Date.now() }
      void window.api.saveChat(updated).catch((err) => {
        console.error('[renameChat] saveChat failed', err)
      })
      return updated
    })
  }

  /**
   * Permanently delete a chat. Uses the existing `deleteChat` IPC; the
   * main store cascades sub-thread deletion. Drop the chat from our
   * local list immediately for snappy feedback, then refresh from
   * source-of-truth (if the IPC fails the next refresh restores it).
   */
  const handleDeleteChat = async (chatId: string) => {
    if (!chatId) return
    const ok =
      typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm("Delete this chat? This can't be undone.")
        : true
    if (!ok) return
    setChats((prev) => prev.filter((chat) => chat.appChatId !== chatId))
    chatByIdRef.current.delete(chatId)
    if (currentChat?.appChatId === chatId) {
      setCurrentChat(null)
    }
    try {
      await window.api.deleteChat(chatId)
    } catch (err) {
      console.error('[deleteChat] failed', err)
      // Best-effort: if delete failed, the next chat refresh on focus or
      // navigation will restore the chat from store.
    }
  }

  const handleTogglePinWorkspace = async (workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId)
    if (!workspace) return

    const optimisticWorkspace: WorkspaceRecord = {
      ...workspace,
      pinned: !workspace.pinned
    }

    setWorkspaces((prev) =>
      prev.map((item) => (item.id === workspaceId ? optimisticWorkspace : item))
    )
    setCurrentWorkspace((prev) => (prev?.id === workspaceId ? optimisticWorkspace : prev))

    try {
      const updatedWorkspace = await window.api.addOrUpdateWorkspace(workspace.path, {
        pinned: optimisticWorkspace.pinned
      })
      setWorkspaces((prev) =>
        prev.map((item) => (item.id === updatedWorkspace.id ? updatedWorkspace : item))
      )
      setCurrentWorkspace((prev) => (prev?.id === updatedWorkspace.id ? updatedWorkspace : prev))
    } catch {
      setWorkspaces((prev) => prev.map((item) => (item.id === workspaceId ? workspace : item)))
      setCurrentWorkspace((prev) => (prev?.id === workspaceId ? workspace : prev))
    }
  }

  const handleNewChat = async (wsId: string, wsPath: string) => {
    const newChat = await window.api.createChat(wsId, wsPath)
    const provider = getChatProvider(newChat)
    const workspace = workspaces.find((item) => item.id === wsId) || getWorkspaceForChat(newChat)
    if (workspace) {
      setCurrentWorkspace(workspace)
      currentWorkspaceIdRef.current = workspace.id
      window.api
        .checkTrust(workspace.path)
        .then(setTrustResult)
        .catch(() => {})
    }
    setChats(await window.api.getChats())
    currentChatIdRef.current = newChat.appChatId
    chatByIdRef.current.set(newChat.appChatId, newChat)
    setCurrentChat(newChat)
    applyChatComposerSelection(newChat, provider)
    if (provider === 'codex') {
      setShowGeminiTerminal(false)
    }
    void refreshUsageSummary(wsId, provider)
    setRunDiff(null)
    setRunCompleteNotice(null)
    setRawLogs(rawLogsByChatIdRef.current.get(newChat.appChatId) || [])
    setShowFallbackUX(false)
    clearImagePermissions()
    setIsThinking(runningChatIds.has(newChat.appChatId))
  }

  const clearWorkspaceOnlyUiState = () => {
    const geminiSessionApi = window.api as any
    if (
      persistentSessionActiveRef.current &&
      typeof geminiSessionApi.stopGeminiSession === 'function'
    ) {
      geminiSessionApi.stopGeminiSession().catch(() => {})
    }
    persistentSessionActiveRef.current = false
    setIsPersistentSessionEnabled(false)
    setPersistentSessionStatus('idle')
    setPersistentSessionNeedsRestart(false)
    setCurrentWorkspace(null)
    currentWorkspaceIdRef.current = null
    setTrustResult(null)
    setDiff(null)
    setRunDiff(null)
    setDiffRefreshStatus('')
    setShowGeminiTerminal(false)
    setShowFileEditor(false)
    setIsMemoryInspectorOpen(false)
    setScheduledTasks([])
    activeRunWorkspacePathRef.current = null
  }

  const selectGlobalChat = async (chat: ChatRecord) => {
    const provider = getChatProvider(chat)
    clearWorkspaceOnlyUiState()
    const normalizedChat: ChatRecord = { ...chat, scope: 'global' }
    currentChatIdRef.current = normalizedChat.appChatId
    chatByIdRef.current.set(normalizedChat.appChatId, normalizedChat)
    setCurrentChat(normalizedChat)
    applyChatComposerSelection(normalizedChat, provider)
    setChats((prev) => {
      const index = prev.findIndex((item) => item.appChatId === normalizedChat.appChatId)
      if (index < 0) return [normalizedChat, ...prev]
      return prev.map((item) =>
        item.appChatId === normalizedChat.appChatId ? normalizedChat : item
      )
    })
    void refreshUsageSummary(GLOBAL_USAGE_WORKSPACE_ID, provider)
    void refreshProviderMetadata(provider, null)
    setRawLogs(rawLogsByChatIdRef.current.get(normalizedChat.appChatId) || [])
    hydrateThreadRawLogsFromEvents(normalizedChat.appChatId)
    setShowFallbackUX(false)
    clearImagePermissions()
    setCodexThreads([])
    setIsThinking(runningChatIds.has(normalizedChat.appChatId))
  }

  const handleNewGlobalChat = async () => {
    // 1.0.4-AQ5 — preserve the current chat's `chatKind` when the
    // user picks "No Workspace" from the workspace browser. Pre-AQ5
    // this always called `createGlobalChat()` which hardcodes
    // `chatKind: 'single'`, so a user on an ensemble welcome screen
    // who switched to global would land on a Codex single-provider
    // welcome screen — losing their ensemble configuration intent.
    //
    // 1.0.5-EW4 — AQ5 preserved chatKind but still LOST the user's
    // ensemble setup (participants, roles, models, reasoning) by
    // creating a brand-new global ensemble chat with defaults. For
    // the welcome-chat case we now rebind the current chat in
    // place to `scope: 'global'` + clear workspace fields, keeping
    // every participant + the ensemble config. The
    // `rebindWelcomeEnsembleChatToGlobal` helper returns null when
    // the rebind isn't applicable (non-welcome, non-Ensemble, or
    // already global), in which case we fall back to the old
    // create-new path below.
    if (isCurrentEnsembleChat) {
      const rebound = rebindWelcomeEnsembleChatToGlobal(currentChat, isWelcomeChat)
      if (rebound) {
        const chatWithLedger = currentChat
          ? withSessionActivityLedger(currentChat, rebound)
          : rebound
        setCurrentWorkspace(null)
        currentWorkspaceIdRef.current = null
        updateChatById(chatWithLedger.appChatId, () => chatWithLedger)
        await selectGlobalChat(chatWithLedger)
        return
      }
      const newChat = await window.api.createEnsembleChat()
      const allChats = await window.api.getChats()
      const mergedChats = allChats.some((chat) => chat.appChatId === newChat.appChatId)
        ? allChats
        : [newChat, ...allChats]
      setChats(mergedChats)
      chatByIdRef.current.set(newChat.appChatId, newChat)
      currentChatIdRef.current = newChat.appChatId
      await selectGlobalChat(newChat)
      return
    }
    const newChat = await window.api.createGlobalChat()
    const allChats = await window.api.getChats()
    setChats(allChats)
    await selectGlobalChat(newChat)
  }

  const handleNewEnsemble = async () => {
    if (settings?.ensembleModeEnabled === false) return
    const workspace =
      currentWorkspace ||
      (currentChat?.scope === 'workspace' ? getWorkspaceForChat(currentChat) : null)
    const args =
      workspace?.id && workspace.path
        ? { workspaceId: workspace.id, workspacePath: workspace.path }
        : undefined
    const newChat = await window.api.createEnsembleChat(args)
    const allChats = await window.api.getChats()
    const mergedChats = allChats.some((chat) => chat.appChatId === newChat.appChatId)
      ? allChats
      : [newChat, ...allChats]
    setChats(mergedChats)
    chatByIdRef.current.set(newChat.appChatId, newChat)
    currentChatIdRef.current = newChat.appChatId
    if (newChat.scope === 'global') {
      await selectGlobalChat(newChat)
    } else {
      const chatWorkspace = getWorkspaceForChat(newChat) || workspace
      if (chatWorkspace) {
        setCurrentWorkspace(chatWorkspace)
        currentWorkspaceIdRef.current = chatWorkspace.id
      }
      setCurrentChat(newChat)
      applyChatComposerSelection(newChat, getChatProvider(newChat))
    }
    setRunDiff(null)
    setRunCompleteNotice(null)
    setRawLogs([])
    setShowFallbackUX(false)
    // 1.0.3 — no setup modal. EnsembleParticipantsAboveRow renders
    // inline once `setCurrentChat(newChat)` above lands the chat in
    // view; the user edits per-participant settings via chip flyouts.
  }

  const handleWelcomeSuggestion = (suggestion: string) => {
    setPrompt(suggestion)
  }

  // Phase F1: navigate to a freshly-spawned sub-thread and pre-fill its
  // composer with the delegation prompt the user wrote in the modal.
  // The user reviews/edits + sends manually — v1 doesn't auto-submit.
  const handleSubThreadCreated = async (
    subThread: ChatRecord,
    delegationPrompt: string
  ): Promise<void> => {
    setSubThreadCreatorParent(null)
    const refreshed = await window.api.getChats()
    setChats(refreshed)
    const provider = getChatProvider(subThread)
    if (subThread.scope === 'global') {
      await selectGlobalChat(subThread)
    } else {
      currentChatIdRef.current = subThread.appChatId
      chatByIdRef.current.set(subThread.appChatId, subThread)
      setCurrentChat(subThread)
      applyChatComposerSelection(subThread, provider)
      setRawLogs(rawLogsByChatIdRef.current.get(subThread.appChatId) || [])
      hydrateThreadRawLogsFromEvents(subThread.appChatId)
    }
    // Pre-fill the composer for the new sub-thread (per-chat draft).
    setChatPromptDraft(subThread.appChatId, delegationPrompt)
  }

  const refreshCommandDiscovery = useCallback(
    async (workspacePath: string | undefined = currentWorkspace?.path) => {
      const discoveryApi = window.api as any
      if (!workspacePath || typeof discoveryApi.discoverGeminiCommands !== 'function') {
        setDiscoveredCommands([])
        setCommandDiscoveryStatus(
          'Static Gemini commands loaded. Custom command discovery is unavailable.'
        )
        return
      }

      setCommandDiscoveryStatus('Discovering custom Gemini commands...')
      try {
        const commands = normalizeDiscoveredCommandItems(
          await discoveryApi.discoverGeminiCommands(workspacePath)
        )
        setDiscoveredCommands(commands)
        setCommandDiscoveryStatus(
          commands.length > 0
            ? `Discovered ${commands.length} custom command${commands.length === 1 ? '' : 's'}.`
            : 'Static Gemini commands loaded. No custom command files found.'
        )
      } catch (error) {
        setDiscoveredCommands([])
        setCommandDiscoveryStatus(
          `Static Gemini commands loaded. Discovery failed: ${redactLog(String(error))}`
        )
      }
    },
    [currentWorkspace?.path]
  )

  const refreshGeminiMemory = useCallback(
    async (workspacePath: string | undefined = currentWorkspace?.path) => {
      const memoryApi = window.api as any
      if (!workspacePath || typeof memoryApi.discoverGeminiMemory !== 'function') {
        setGeminiMemoryFiles([])
        setGeminiMemoryStatus('GEMINI.md discovery is unavailable.')
        return
      }

      setGeminiMemoryStatus('Inspecting GEMINI.md files...')
      try {
        const memoryFiles = await memoryApi.discoverGeminiMemory(workspacePath)
        const normalized = Array.isArray(memoryFiles)
          ? memoryFiles.filter((item) => item?.path && item?.displayPath)
          : []
        setGeminiMemoryFiles(normalized)
        setGeminiMemoryStatus(
          normalized.length > 0
            ? `Found ${normalized.length} GEMINI.md file${normalized.length === 1 ? '' : 's'}.`
            : 'No workspace or global GEMINI.md files found.'
        )
      } catch (error) {
        setGeminiMemoryFiles([])
        setGeminiMemoryStatus(`GEMINI.md inspection failed: ${redactLog(String(error))}`)
      }
    },
    [currentWorkspace?.path]
  )

  const clearImagePermissions = () => {
    setPermissionRequestPaths([])
    setPermissionRequestMessage('')
    setPermissionRequestKind(null)
    setPermissionRequestSource(null)
  }

  const showAttachmentPermissionRequest = (request: GeminiPermissionRequest) => {
    const permissionPaths = dedupePaths(request.paths)
    if (permissionPaths.length === 0) {
      return
    }

    setPermissionRequestPaths((prev) => {
      const prevItems = prev.map((existingPath) => ({
        id: `${existingPath}`,
        path: existingPath,
        name: getImageName(existingPath)
      }))
      const incomingItems = permissionPaths.map((incomingPath) => ({
        id: `${incomingPath}`,
        path: incomingPath,
        name: getImageName(incomingPath)
      }))
      const merged = mergeImageAttachments(prevItems, incomingItems).map((item) => item.path)
      return merged.slice(-MAX_IMAGE_ATTACHMENTS)
    })
    setPermissionRequestKind(request.kind)
    setPermissionRequestSource(request.source)
    setPermissionRequestMessage(
      request.message.length > 240 ? `${request.message.slice(0, 240)}...` : request.message
    )
  }

  const clearComposerAttachmentsForSubmittedRequest = (request: QueuedRunRequest) => {
    if (request.existingPrompt) {
      return
    }
    const targetChatId = request.chatRecord?.appChatId || getCurrentComposerStateChatId()
    if (!targetChatId) return
    setImageAttachmentsByChatId((prev) => ({ ...prev, [targetChatId]: [] }))
  }

  const addImageAttachments = (paths: string[]) => {
    const parsed = paths.map((path, index) => ({
      id: `${Date.now()}-${index}-${Math.random()}`,
      path: sanitizeImagePath(path),
      name: getImageName(path)
    }))
    setImageAttachments((prev) => mergeImageAttachments(prev, parsed))
  }

  const handlePickImages = async () => {
    const selected = await window.api.selectImageFiles()
    if (!selected || selected.length === 0) return
    addImageAttachments(selected)
    if (imageAttachments.length + selected.length > MAX_IMAGE_ATTACHMENTS) {
      setRawLogs((prev) => [
        ...prev,
        {
          type: 'info',
          content: `Attachment limit reached (${MAX_IMAGE_ATTACHMENTS}); oldest files were removed.`
        }
      ])
    }
  }

  const handleAttachWindow = async () => {
    if (isAttachingWindow) return
    if (screenWatchUnavailableReason) {
      setRawLogs((prev) => [
        ...prev,
        {
          type: 'info',
          content: `Screen Watch unavailable: ${screenWatchUnavailableReason}`
        }
      ])
      return
    }
    setIsAttachingWindow(true)
    try {
      const result = await window.api.attachWindowPick()
      if (result.cancelled) return
      if (!result.ok) {
        setRawLogs((prev) => [
          ...prev,
          {
            type: 'info',
            content: `Attach window failed: ${result.error || 'unknown error'}`
          }
        ])
        return
      }
      if (result.snapshot) {
        setAttachedWindow(result.snapshot)
        // 1.0.5-AU — Record the chat that owns this attachment so
        // the cross-chat auto-detach effect knows when to clear.
        const ownerChatId = currentChat?.appChatId || null
        attachedWindowOwnerChatIdRef.current = ownerChatId
        // M11 — a fresh attach supersedes any remembered stash for this chat.
        if (ownerChatId) {
          setResumeAppWatchSnapshot((prev) => (prev?.chatId === ownerChatId ? null : prev))
          void window.api.stickyAppWatchClear?.(ownerChatId)
        }
      }
    } finally {
      setIsAttachingWindow(false)
    }
  }

  const handleDetachWindow = async () => {
    // M11 — a USER-initiated detach is intentional: clear any sticky stash for
    // this chat so we don't offer to resume something they deliberately stopped.
    const ownerChatId = attachedWindowOwnerChatIdRef.current
    setAttachedWindow(null)
    // 1.0.5-AU — Clear ownership marker too so a subsequent
    // chat-switch effect doesn't try to detach again.
    attachedWindowOwnerChatIdRef.current = null
    if (ownerChatId) {
      setResumeAppWatchSnapshot((prev) => (prev?.chatId === ownerChatId ? null : prev))
      void window.api.stickyAppWatchClear?.(ownerChatId)
    }
    try {
      await window.api.attachWindowDetach()
    } catch {
      // Optimistic clear — main has already received the request, daemon
      // detach is best-effort.
    }
  }

  // 1.0.5-AU — Auto-detach when the active chat changes to anything
  // other than the chat that owns the current attachment. Keeps
  // each chat's Screen Watch surface honest: if you attached in
  // Chat A and switched to Chat B, the chip should not show
  // "Watching <app>" anymore, and Chat B's tools should not be
  // able to observe Chat A's stream.
  //
  // M11 (1.0.7) — sticky AppWatch: BEFORE the auto-detach clears state, stash
  // the attachment metadata keyed by the owner chat (persisted main-side). When
  // the user returns to that chat the resume-loader effect below surfaces a
  // one-tap "Resume watching <app>". A USER detach (handleDetachWindow) clears
  // the stash instead — only an auto-detach-on-switch is "sticky".
  //
  // Triggered on every `currentChat?.appChatId` change, including
  // initial mount (no-op when no attachment exists yet) and chat
  // creation (when switching from null to a new chat — also a
  // no-op because the previous chatId was null and the
  // attachedWindow is null too).
  useEffect(() => {
    const currentChatId = currentChat?.appChatId || null
    const ownerChatId = attachedWindowOwnerChatIdRef.current
    if (!attachedWindow) return
    if (!ownerChatId) return
    if (ownerChatId === currentChatId) return
    // Different chat is active — stash for resume, then detach. The detach
    // clears React state + the ref + sends the IPC; stashing first preserves
    // what the owner chat was watching.
    void window.api.stickyAppWatchStash?.({
      chatId: ownerChatId,
      windowMeta: attachedWindow.windowMeta,
      attachedAt: attachedWindow.attachedAt,
      wasStreaming: Boolean(attachedWindow.streaming)
    })
    // Detach WITHOUT clearing the stash (handleDetachWindow clears it, so do
    // the detach inline here).
    setAttachedWindow(null)
    attachedWindowOwnerChatIdRef.current = null
    void window.api.attachWindowDetach().catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChat?.appChatId])

  // M11 (1.0.7) — resume loader. On switching TO a chat, fetch its remembered
  // sticky-AppWatch snapshot (if any) so the composer can offer to resume.
  // Cleared while an attachment is live (the chip shows "Watching" instead).
  useEffect(() => {
    const chatId = currentChat?.appChatId || null
    if (!chatId || attachedWindow) {
      setResumeAppWatchSnapshot(null)
      return
    }
    let cancelled = false
    void window.api.stickyAppWatchGet?.(chatId).then((res) => {
      if (cancelled) return
      const snap = res?.snapshot
      setResumeAppWatchSnapshot(
        snap && snap.chatId === chatId
          ? { chatId: snap.chatId, windowMeta: snap.windowMeta, wasStreaming: snap.wasStreaming }
          : null
      )
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChat?.appChatId, attachedWindow])

  const handleComposerDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    imageDragCounterRef.current += 1
    const hasAttachmentPaths = collectDroppedAttachmentPaths(event.dataTransfer).length > 0
    if (hasAttachmentPaths) {
      setIsComposerDragOver(true)
    }
  }

  const handleComposerDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleComposerDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    imageDragCounterRef.current -= 1
    if (imageDragCounterRef.current <= 0) {
      setIsComposerDragOver(false)
      imageDragCounterRef.current = 0
    }
  }

  const handleComposerDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    imageDragCounterRef.current = 0
    setIsComposerDragOver(false)

    const paths = collectDroppedAttachmentPaths(event.dataTransfer)
    if (paths.length === 0) {
      return
    }

    addImageAttachments(paths)
    if (imageAttachments.length + paths.length > MAX_IMAGE_ATTACHMENTS) {
      setRawLogs((prev) => [
        ...prev,
        {
          type: 'info',
          content: `Attachment limit reached (${MAX_IMAGE_ATTACHMENTS}); oldest files were removed.`
        }
      ])
    }
  }

  const handleRemoveImageAttachment = (id: string) => {
    setImageAttachments((prev) => prev.filter((item) => item.id !== id))
  }

  const updateExternalPathGrants = (nextGrants: ExternalPathGrant[]) => {
    if (!currentChat) return
    const normalized = normalizeExternalPathGrants(nextGrants).map((grant) => ({
      ...grant,
      workspaceId: currentWorkspace?.id || grant.workspaceId,
      chatId: currentChat.appChatId
    }))
    const updatedChat = {
      ...currentChat,
      providerMetadata: canonicalizeExternalPathGrantMetadata(
        currentChat.providerMetadata,
        normalized
      ),
      updatedAt: Date.now()
    }
    setCurrentChat(updatedChat)
    setChats((prev) =>
      prev.map((chat) => (chat.appChatId === updatedChat.appChatId ? updatedChat : chat))
    )
    window.api.saveChat(updatedChat)
  }

  // `handlePickExternalPathGrant` was the entry point for the
  // pre-emptive picker pill that lived in the composer's above-bar.
  // Removed with the pill (slice 8) — runtime detection (slice 5)
  // now drives the grant flow via the approval modal. The IPC
  // (`window.api.selectExternalPathGrant`) is preserved in preload
  // so a future Settings → Approvals tab can offer a manual
  // grant-entry escape hatch (post-lunch plan item).

  const handleRemoveExternalPathGrant = (id: string) => {
    updateExternalPathGrants(externalPathGrants.filter((grant) => grant.id !== id))
  }

  // 1.0.6-EW66 — Remove ALL grants for a path (an ensemble stores
  // one grant per enabled participant-provider for the same folder),
  // so the workspace manager's × removes the whole additional
  // workspace rather than a single provider's grant.
  const handleRemoveExternalPathGrantsByPath = (path: string) => {
    updateExternalPathGrants(externalPathGrants.filter((grant) => grant.path !== path))
  }

  // 1.0.6-EW66 — Apply a renderer-supplied drag order to the
  // additional-workspace list. `reorderExternalPathGrantsByPath`
  // rewrites each grant's per-path `order` to match `orderedPaths`;
  // the write goes through `updateExternalPathGrants` → saveChat.
  // `order` sits outside the HMAC signing payload, so rewriting it
  // never invalidates a grant signature.
  const handleReorderExternalPathGrants = (orderedPaths: string[]) => {
    updateExternalPathGrants(reorderExternalPathGrantsByPath(externalPathGrants, orderedPaths))
  }

  const handleSelectChat = async (chat: ChatRecord) => {
    if (isGlobalChat(chat)) {
      await selectGlobalChat(chat)
      return
    }
    const provider = getChatProvider(chat)
    const workspaceForChat = getWorkspaceForChat(chat)
    if (workspaceForChat && currentWorkspace?.id !== workspaceForChat.id) {
      const geminiSessionApi = window.api as any
      if (
        persistentSessionActiveRef.current &&
        typeof geminiSessionApi.stopGeminiSession === 'function'
      ) {
        geminiSessionApi.stopGeminiSession().catch(() => {})
      }
      persistentSessionActiveRef.current = false
      setIsPersistentSessionEnabled(false)
      setPersistentSessionStatus('idle')
      setPersistentSessionNeedsRestart(false)
      setCurrentWorkspace(workspaceForChat)
      currentWorkspaceIdRef.current = workspaceForChat.id
      window.api
        .checkTrust(workspaceForChat.path)
        .then(setTrustResult)
        .catch(() => {})
    } else {
      currentWorkspaceIdRef.current = chat.workspaceId || null
    }
    currentChatIdRef.current = chat.appChatId
    chatByIdRef.current.set(chat.appChatId, chat)
    setCurrentChat(chat)
    applyChatComposerSelection(chat, provider)
    if (provider === 'codex') {
      setShowGeminiTerminal(false)
    }
    void refreshUsageSummary(getUsageWorkspaceIdForChat(chat), provider)
    setRunDiff(null)
    // Re-derive the run-complete card from this chat's PERSISTED last run
    // instead of clearing it, so the "Task complete" notice persists per
    // thread across switches. Hidden while this chat is currently running;
    // reappears/updates when its next run completes (a new run clears it at
    // start via isRunVisibleAtStart / the ensemble round effect).
    setRunCompleteNotice(deriveRunCompleteNotice(chat, runningChatIds.has(chat.appChatId)))
    setRawLogs(rawLogsByChatIdRef.current.get(chat.appChatId) || [])
    hydrateThreadRawLogsFromEvents(chat.appChatId)
    setShowFallbackUX(false)
    setIsThinking(runningChatIds.has(chat.appChatId))
  }
  const handleSelectChatRef = useRef(handleSelectChat)
  useEffect(() => {
    handleSelectChatRef.current = handleSelectChat
  })

  useEffect(() => {
    const transcript = appTranscriptRef.current
    const composerArea = composerAreaRef.current
    if (!transcript || !composerArea) {
      return
    }

    let lastWrittenHeight = -1
    const updateComposerReservation = () => {
      const height = Math.ceil(composerArea.getBoundingClientRect().height)
      // Skip CSS-var writes when the height hasn't actually changed — otherwise
      // we trigger a style recalc which cascades into the transcript
      // ResizeObserver below and produces a feedback loop / flicker.
      if (height === lastWrittenHeight) return
      lastWrittenHeight = height
      transcript.style.setProperty('--composer-reserved-height', `${height}px`)
    }

    updateComposerReservation()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateComposerReservation)
      return () => window.removeEventListener('resize', updateComposerReservation)
    }

    const resizeObserver = new ResizeObserver(updateComposerReservation)
    resizeObserver.observe(composerArea)
    window.addEventListener('resize', updateComposerReservation)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateComposerReservation)
    }
    // Mount-once: ResizeObserver natively responds to every size change
    // (typing, attachments, approvals, terminal toggles) without us needing
    // to tear down + reinstall the observer on each state change. The previous
    // dependency array included `prompt`, which re-ran this effect on every
    // keystroke — each remount fired the observer callback, which mutated
    // a CSS var that the transcript layout reads, which fed back into the
    // composer's measured height. That was a primary source of UI flicker.
  }, [])

  // ----- Transcript auto-follow scrolling -------------------------------
  // Pins the transcript to the bottom while messages stream in, *unless*
  // the user has scrolled up to read older content. Replaced an earlier
  // ResizeObserver-based implementation that introduced a feedback loop:
  // the composer-area ResizeObserver wrote a CSS variable that drove the
  // transcript's margin-bottom; observing the transcript content fed
  // every composer height tick back into a scrollTop write, which
  // re-laid-out the transcript, which fired the composer observer again.
  // That loop manifested as freezes-on-typing (severe enough to disconnect
  // bluetooth keyboards) and the transcript appearing to slide under the
  // composer.
  //
  // Current design — no observers on the scroll container itself:
  //  1. Scroll listener flips autoFollowRef based on distance-from-bottom,
  //     with hysteresis (engage / disengage thresholds live in
  //     `lib/TranscriptScroll`) and rAF throttling.
  //  2. Wheel/touch/keyboard listeners record real user-initiated
  //     scroll-aways into `userScrolledAwayInFrameRef`. The post-frame
  //     re-pin honours this flag so a deliberate scroll-up is never
  //     fought by the rAF callback.
  //  3. Layout-effect on `currentChat?.messages` snaps to bottom when new
  //     messages arrive, then schedules one extra rAF re-pin so any
  //     late-mount layout shift (CodeMirror chat code blocks,
  //     ActivityStack collapsing on tool-result arrival — frequent in
  //     Kimi runs) cannot leave the user stranded above the new bottom.
  //  4. Chat-switch effect resets autoFollow + snaps to bottom on the new
  //     thread's last message.
  //  5. The composer-area observer still writes its measured height, but
  //     the transcript consumes it as bottom padding / scroll-padding so
  //     the scroll viewport can extend behind the overlay.
  useEffect(() => {
    const scroller = transcriptScrollRef.current
    if (!scroller) return

    const evaluate = () => {
      const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
      // Only the actual bottom opts back into auto-follow. This keeps
      // transcript scrolling fully user-owned until they deliberately
      // return to the live edge.
      if (shouldEngageAutoFollow(distanceFromBottom)) {
        autoFollowRef.current = true
        // Once the user lands at the bottom again we forget any
        // previously-recorded scroll-away so the next stream tick can
        // re-pin without delay.
        userScrolledAwayInFrameRef.current = false
        // Returning to the bottom dismisses the "↓ N new messages"
        // pill — the user has visually caught up, so there is
        // nothing left to advertise. Mirror the state write onto
        // the ref so the layout effect's next pass sees a zero
        // baseline immediately, not on the following frame.
        if (unreadFromBottomCountRef.current !== 0) {
          unreadFromBottomCountRef.current = 0
          setUnreadFromBottomCount(0)
        }
      } else if (shouldDisengageAutoFollow(distanceFromBottom)) {
        autoFollowRef.current = false
      }
    }
    const onScroll = evaluate
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
    }
    // Re-bind on scroller remount. TranscriptPanel is keyed by appChatId
    // (see its render site) and replaces the scroll node on chat-open; with an
    // empty dep array this listener stayed orphaned on the initial 'no-chat'
    // node, so the only auto-follow *disengage* write (above) never ran on the
    // live scroller — auto-follow could never be turned off by a user scroll-up.
  }, [currentChat?.appChatId])

  // Detect _real_ user-initiated upward scroll attempts. The plain
  // `scroll` event fires for both user input and programmatic writes
  // (including the browser clamping `scrollTop` when content shrinks),
  // so it cannot by itself distinguish "user wants to read older
  // content" from "layout just shifted underneath them". The wheel +
  // touch + keyboard listeners below capture the user-intent signal
  // and feed it into `userScrolledAwayInFrameRef`, which gates the
  // post-frame re-pin.
  useEffect(() => {
    const scroller = transcriptScrollRef.current
    if (!scroller) return

    const handleUpwardIntent = (deltaY: number) => {
      // Only treat _upward_ movement as a scroll-away signal: scrolling
      // further toward the bottom should not flip the flag (we'd just
      // immediately re-engage on the next scroll event anyway).
      if (deltaY >= 0) return
      // Only react when there's actually somewhere up to scroll. This
      // catches the race before the browser emits the corresponding
      // scroll event, including the common "wheel up from bottom"
      // case where distance-from-bottom is still zero at wheel time.
      if (scroller.scrollTop > 0) {
        userScrolledAwayInFrameRef.current = true
        autoFollowRef.current = false
      }
    }

    const onWheel = (event: WheelEvent) => handleUpwardIntent(event.deltaY)

    let lastTouchY: number | null = null
    const onTouchStart = (event: TouchEvent) => {
      lastTouchY = event.touches[0]?.clientY ?? null
    }
    const onTouchMove = (event: TouchEvent) => {
      const currentY = event.touches[0]?.clientY ?? null
      if (currentY === null || lastTouchY === null) return
      // Touch dragging _down_ scrolls _up_ — invert the delta to match
      // wheel semantics (negative = upward intent).
      handleUpwardIntent(lastTouchY - currentY)
      lastTouchY = currentY
    }
    const onTouchEnd = () => {
      lastTouchY = null
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'PageUp' || event.key === 'ArrowUp' || event.key === 'Home') {
        handleUpwardIntent(-1)
        return
      }
      // `End` mirrors the jump-to-latest pill: smooth-scroll to the
      // bottom and clear the unread counter. Fires only when focus is
      // within the transcript scroller (the listener is scroller-
      // scoped). When focus is on an editable element inside the
      // transcript (an inline chat-title rename, a textarea inside a
      // tool card, a contenteditable code block) End is line-end
      // navigation — let the native behaviour through and skip our
      // jump-to-bottom. Otherwise the user can never reach the end
      // of a line they're editing.
      if (event.key === 'End') {
        const focused = event.target as Element | null
        const isEditable =
          focused instanceof HTMLInputElement ||
          focused instanceof HTMLTextAreaElement ||
          (focused instanceof HTMLElement && focused.isContentEditable)
        if (!isEditable) {
          event.preventDefault()
          handleJumpToLatestRef.current()
        }
      }
    }

    scroller.addEventListener('wheel', onWheel, { passive: true })
    scroller.addEventListener('touchstart', onTouchStart, { passive: true })
    scroller.addEventListener('touchmove', onTouchMove, { passive: true })
    scroller.addEventListener('touchend', onTouchEnd, { passive: true })
    scroller.addEventListener('keydown', onKeyDown)

    return () => {
      scroller.removeEventListener('wheel', onWheel)
      scroller.removeEventListener('touchstart', onTouchStart)
      scroller.removeEventListener('touchmove', onTouchMove)
      scroller.removeEventListener('touchend', onTouchEnd)
      scroller.removeEventListener('keydown', onKeyDown)
    }
    // Re-bind on scroller remount (keyed by appChatId) — see the scroll-evaluate
    // effect above. These wheel/touch/key listeners hold the explicit disengage.
  }, [currentChat?.appChatId])

  // Listen for `CODE_BLOCK_RESIZE_EVENT` from individual
  // `HighlightedCodeBlock` instances. CodeMirror measures fenced code
  // asynchronously after mount: the block paints small, then resizes
  // once the editor view computes its real layout. In long Kimi
  // transcripts (lots of fenced code in tool output) that late growth
  // happens _after_ the messages-update layoutEffect has already
  // snapped to bottom, leaving the user stranded above the new bottom
  // ("view scrolls upward each time a new message arrives"). The
  // bubbling custom event arrives at this scroller and we run the
  // standard rAF re-pin under the same guards as the messages-update
  // path — never fighting a deliberate scroll-away.
  //
  // The observers live on individual code-block elements (see
  // `HighlightedCodeBlock`), NOT on the scroll container. The
  // historical ResizeObserver feedback loop (documented in App.tsx
  // and `TranscriptScroll.ts`) observed the whole transcript, where
  // every scrollTop write fed back into more reflows. A scoped
  // observer on a code block's own bounds is not affected by ancestor
  // `scrollTop` writes, so this path cannot loop.
  useEffect(() => {
    const scroller = transcriptScrollRef.current
    if (!scroller) return

    let rafId: number | null = null
    const onCodeBlockResize = () => {
      // Coalesce bursts of resize events (multiple code blocks in one
      // assistant message all measuring on the same frame) into a
      // single rAF re-pin.
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        const node = transcriptScrollRef.current
        if (!node) return
        if (
          !shouldRepinAfterCodeBlockResize({
            autoFollow: autoFollowRef.current,
            userScrolledAwayInThisFrame: userScrolledAwayInFrameRef.current
          })
        ) {
          return
        }
        node.scrollTop = node.scrollHeight
      })
    }

    scroller.addEventListener(CODE_BLOCK_RESIZE_EVENT, onCodeBlockResize)
    return () => {
      scroller.removeEventListener(CODE_BLOCK_RESIZE_EVENT, onCodeBlockResize)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
    // Re-bind on scroller remount (keyed by appChatId) — see the scroll-evaluate
    // effect above. Otherwise code-block re-pins target the dead 'no-chat' node.
  }, [currentChat?.appChatId])

  // Generalised re-pin: a SINGLE `ResizeObserver` on the inner transcript
  // content div (`.transcript-inner`) catches every source of late layout
  // growth in one place, not just CodeMirror code blocks.
  //
  // Follow-up to a12f913. That fix observed individual
  // `HighlightedCodeBlock` instances and dispatched a custom event so
  // the messages-update rAF re-pin could re-anchor the bottom after
  // CodeMirror measured asynchronously. It worked for Kimi transcripts
  // (heavy with fenced code blocks) but did NOT cover Codex chats heavy
  // with `Ran /bin/zsh -lc '...'` activity rows — those bounced the user
  // upward when:
  //   * a shell-command activity row mounted with multi-line stdout
  //     that measured asynchronously,
  //   * a pending tool row transitioned to completed and revealed
  //     previously-hidden output,
  //   * new activity rows were appended during streaming faster than
  //     the rAF re-pin coalesced.
  //
  // A content-level observer catches all of the above plus any future
  // late-mount source (markdown tables expanding to fit, images
  // loading, future activity types) without per-component plumbing.
  //
  // Why this does NOT reintroduce the documented ResizeObserver
  // feedback loop:
  //   * The historical bug observed the SCROLL CONTAINER itself — a
  //     `scrollTop` write caused a reflow that re-fired the observer
  //     and chained back into more scroll writes.
  //   * Here we observe the INNER CONTENT div. Its border-box /
  //     content-box dimensions are determined by its children's
  //     intrinsic sizes, NOT by the ancestor scroller's `scrollTop`.
  //     Writing `scrollTop` on the scroller cannot change the content
  //     div's measured rect.
  //   * The re-pin is gated on `shouldRepinAfterTranscriptResize`
  //     which is identical to `shouldRepinAfterFrame` — same guards
  //     as every other re-pin path (autoFollow engaged AND no user
  //     scroll-away in this frame). Even in a pathological spurious
  //     fire, `scrollTop = scrollHeight` is idempotent at the bottom.
  //   * The per-`HighlightedCodeBlock` observer added in a12f913 is
  //     intentionally left in place. The two paths are redundant but
  //     not contradictory — both ultimately schedule the same rAF
  //     re-pin and the rafId coalescing inside each handler prevents
  //     multiple writes in one frame.
  useEffect(() => {
    const scroller = transcriptScrollRef.current
    const content = transcriptContentRef.current
    if (!scroller || !content) return
    if (typeof ResizeObserver === 'undefined') return

    let rafId: number | null = null
    const observer = new ResizeObserver(() => {
      // Coalesce bursts of resize entries from a single batched
      // callback (multiple children resizing in the same frame) into
      // a single rAF re-pin.
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        const node = transcriptScrollRef.current
        if (!node) return
        if (
          !shouldRepinAfterTranscriptResize({
            autoFollow: autoFollowRef.current,
            userScrolledAwayInThisFrame: userScrolledAwayInFrameRef.current
          })
        ) {
          return
        }
        node.scrollTop = node.scrollHeight
      })
    })

    observer.observe(content)
    return () => {
      observer.disconnect()
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
    // Re-observe on scroller remount (keyed by appChatId) — see the
    // scroll-evaluate effect above. Otherwise the ResizeObserver watches the
    // dead 'no-chat' content node and never re-measures the live transcript.
  }, [currentChat?.appChatId])

  // Stick to bottom when the messages array reference changes. Streaming
  // updates produce a fresh `currentChat.messages` array via immutable
  // updates, so this fires once per render that affects messages — never
  // mid-layout, never inside a ResizeObserver callback.
  //
  // After the synchronous scrollTop write we schedule exactly one rAF
  // re-pin. This is the fix for the "Kimi transcript snaps upward" bug:
  // the synchronous write captures the post-render `scrollHeight` _before_
  // child useEffects fire (e.g. `ActivityStack`'s tool-status auto-collapse,
  // CodeMirror measuring fenced code blocks). Those side effects mutate
  // `scrollHeight` in the next frame; without a follow-up write the
  // browser clamps `scrollTop` to the now-smaller maximum and the visible
  // content shifts upward. The rAF callback re-asserts the snap once those
  // layout shifts have settled. The `userScrolledAwayInFrameRef` guard
  // ensures we never fight a deliberate user scroll-up that happened
  // between the layout effect and the next animation frame.
  useLayoutEffect(() => {
    // Compute the new-message delta for the "↓ N new messages" pill
    // BEFORE any early returns. The pill exists precisely because the
    // bail-out paths below leave the user stranded above silent new
    // content — incrementing here is the only place we can observe
    // "messages arrived AND we chose not to snap to them".
    //
    // Why the delta is per-chat: chat switches change `currentChat?.
    // messages` to a completely different array. Without keying the
    // baseline on chatId, switching from a 200-message chat to a
    // 2-message chat would compute a delta of -198 (clamped to 0)
    // and switching the other way would falsely flag 198 new
    // messages on a thread the user never scrolled away from.
    const currentChatIdForCount = currentChat?.appChatId ?? null
    const currentMessageCount = currentChat?.messages?.length ?? 0
    const sameChatAsBaseline = previousMessagesCountRef.current.chatId === currentChatIdForCount
    const deltaSinceLastPass = sameChatAsBaseline
      ? currentMessageCount - previousMessagesCountRef.current.count
      : 0
    previousMessagesCountRef.current = {
      chatId: currentChatIdForCount,
      count: currentMessageCount
    }
    // On a chat switch (baseline chatId mismatch) the pill must reset
    // synchronously, before paint. The chat-switch useEffect at the
    // bottom of this scroll block also resets the count, but it runs
    // AFTER paint — without the synchronous reset here the user would
    // briefly see the previous chat's "↓ N new" pill rendered over
    // the newly-loaded transcript for one frame.
    if (!sameChatAsBaseline && unreadFromBottomCountRef.current !== 0) {
      unreadFromBottomCountRef.current = 0
      setUnreadFromBottomCount(0)
    }
    const incrementUnreadIfNewMessagesArrived = () => {
      if (deltaSinceLastPass <= 0) return
      const next = unreadFromBottomCountRef.current + deltaSinceLastPass
      unreadFromBottomCountRef.current = next
      setUnreadFromBottomCount(next)
    }

    if (!autoFollowRef.current) {
      incrementUnreadIfNewMessagesArrived()
      return
    }
    const scroller = transcriptScrollRef.current
    if (!scroller) return
    // 1.0.4 — two additional guards prevent the synchronous snap from
    // fighting a user who has just started scrolling up. Without them,
    // ensemble chats (which produce 10–100× more store updates per
    // second than solo runs — per-participant token tallies, active-
    // round flips, per-tool events) could hit the race window where a
    // wheel event lands between two rAF-coalesced scroll-listener evals
    // and `autoFollowRef` is still `true` from the previous frame.
    //
    //   (1) `userScrolledAwayInFrameRef` already records the user's
    //   wheel/touch/key intent. The rAF re-pin path checks it (line
    //   8794) but the synchronous write below previously didn't —
    //   the old code reset the flag at the top of the effect, losing
    //   the signal before it could be honoured. Now the flag is read
    //   first; if set we bail entirely and never reset it, so the
    //   next streaming tick will also bail until the scroll listener
    //   (line 8547) clears it when the user actually returns to the
    //   bottom.
    //
    //   The scroll listener now updates synchronously, so
    //   `autoFollowRef` is the "was at the bottom before this message
    //   update" signal. Do not re-measure distance here: after a large
    //   incoming message, the user who was previously bottom-pinned
    //   would incorrectly look far from the bottom.
    if (userScrolledAwayInFrameRef.current) {
      incrementUnreadIfNewMessagesArrived()
      return
    }
    // The flag is reset here (rather than at the top of the effect)
    // because the rAF re-pin below needs a clean signal: any wheel
    // event landing between this sync write and the rAF callback
    // should disable the re-pin.
    userScrolledAwayInFrameRef.current = false
    // Single scrollTop write per messages-update; the browser clamps to
    // [0, scrollHeight - clientHeight] so we don't need to compute target.
    scroller.scrollTop = scroller.scrollHeight
    // Schedule a follow-up rAF re-pin. The cleanup returned below cancels
    // it when the effect re-runs (next messages update) or the component
    // unmounts, so consecutive streaming updates coalesce naturally into
    // one rAF write per frame.
    repinRafIdRef.current = requestAnimationFrame(() => {
      repinRafIdRef.current = null
      const node = transcriptScrollRef.current
      if (!node) return
      if (
        !shouldRepinAfterFrame({
          autoFollow: autoFollowRef.current,
          userScrolledAwayInThisFrame: userScrolledAwayInFrameRef.current
        })
      ) {
        return
      }
      node.scrollTop = node.scrollHeight
    })
    return () => {
      // Cancel any pending re-pin if the effect is torn down (component
      // unmount or the next layout pass scheduling its own rAF).
      if (repinRafIdRef.current !== null) {
        cancelAnimationFrame(repinRafIdRef.current)
        repinRafIdRef.current = null
      }
    }
  }, [currentChat?.appChatId, currentChat?.messages, runCompleteNotice, showFallbackUX])

  useEffect(() => {
    // When the active chat changes, snap to the bottom and re-arm auto-follow
    // so the user lands on the latest message in their new thread.
    const scroller = transcriptScrollRef.current
    if (!scroller) return
    autoFollowRef.current = true
    userScrolledAwayInFrameRef.current = false
    // The "↓ N new messages" pill is a per-thread affordance — landing
    // on a fresh chat must never inherit unread count from the
    // previous one. Reset both the rendered state and the per-chat
    // baseline so the messages layout effect treats the incoming
    // thread as already-caught-up.
    if (unreadFromBottomCountRef.current !== 0) {
      unreadFromBottomCountRef.current = 0
      setUnreadFromBottomCount(0)
    }
    previousMessagesCountRef.current = {
      chatId: currentChat?.appChatId ?? null,
      count: currentChat?.messages?.length ?? 0
    }
    // Defer one frame so the new messages render before we measure.
    const rafId = requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight
    })
    return () => cancelAnimationFrame(rafId)
    // Chat-switch only: message growth is handled by the message layout effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChat?.appChatId])
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!showTerminal && currentWorkspace) {
      window.api.checkTrust(currentWorkspace.path).then(setTrustResult)
    }
  }, [showTerminal, currentWorkspace])

  useEffect(() => {
    if (!appearance.showInspector && showTerminal) {
      setShowTerminal(false)
    }
  }, [appearance.showInspector, showTerminal])

  useEffect(() => {
    currentWorkspaceIdRef.current = currentWorkspace?.id ?? null
  }, [currentWorkspace?.id])

  // Autonomous background refresh for the sidebar "MODEL USAGE" meters.
  //
  // Previously the meters only refreshed when the user switched chats or
  // workspaces, so a long-lived window would show stale provider quotas
  // until the user clicked around. This effect polls the same usage IPC
  // path on a 90s cadence, fully off the UI thread.
  //
  // Guarantees:
  //  - Mounts once and lives for the lifetime of the app — no thrash on
  //    chat/workspace switches. The latest `refreshUsageSummary` closure is
  //    pulled from `refreshUsageSummaryRef` so we don't need it in deps.
  //  - `usageRefreshInFlightRef` ensures only one refresh is outstanding at
  //    a time; overlapping ticks are skipped, not queued.
  //  - Polling pauses when the window is hidden/blurred (`visibilitychange`
  //    + `online`/`offline`). On regaining focus we kick a refresh and
  //    resume the heartbeat.
  //  - `refreshUsageSummary` already does signature-based diff suppression,
  //    so identical payloads don't call `setState` — selection, scroll
  //    position, and in-flight composer text are not perturbed.
  useEffect(() => {
    const INTERVAL_MS = 90_000

    const fireRefresh = (force = false) => {
      const decision = force
        ? !usageRefreshInFlightRef.current &&
          (typeof navigator === 'undefined' || navigator.onLine !== false)
        : shouldRunUsageRefresh({
            msSinceLastRefresh:
              usageRefreshLastFiredAtRef.current === null
                ? null
                : Date.now() - usageRefreshLastFiredAtRef.current,
            intervalMs: INTERVAL_MS,
            inFlight: usageRefreshInFlightRef.current,
            windowFocused:
              typeof document === 'undefined' ? true : document.visibilityState !== 'hidden',
            online: typeof navigator === 'undefined' ? true : navigator.onLine !== false
          })
      if (!decision) return
      usageRefreshInFlightRef.current = true
      usageRefreshLastFiredAtRef.current = Date.now()
      const workspaceId = currentWorkspaceIdRef.current || undefined
      void refreshUsageSummaryRef
        .current(workspaceId)
        .catch(() => {
          // Swallow — `refreshUsageSummary` already swallows its own IPC
          // failures via `.catch(() => null)`. Anything that reaches here is
          // unexpected, but we still want the in-flight flag cleared so
          // future heartbeats fire.
        })
        .finally(() => {
          usageRefreshInFlightRef.current = false
        })
    }

    const intervalId = window.setInterval(() => fireRefresh(false), INTERVAL_MS)

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fireRefresh(true)
      }
    }
    const handleOnline = () => fireRefresh(true)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleVisibilityChange)
    window.addEventListener('online', handleOnline)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleVisibilityChange)
      window.removeEventListener('online', handleOnline)
    }
    // Mount-once: deps intentionally empty. All values consumed inside
    // (workspace id, the refresh function) come from refs and are read at
    // call time, so we never need to tear the timer down.
  }, [])

  useEffect(() => {
    currentChatIdRef.current = currentChat?.appChatId ?? null
    if (currentChat?.appChatId) {
      chatByIdRef.current.set(currentChat.appChatId, currentChat)
    }
  }, [currentChat])

  useEffect(() => {
    // Phase L2 — fix streaming transcript content loss.
    //
    // The naive rebuild (`chatByIdRef.current = new Map(chats)`) caused
    // visible token drops in long Codex assistant messages. Sequence:
    //
    //   1. Render N commits with chats[i].content = "abcde" (5 deltas
    //      accumulated).
    //   2. Delta 6 arrives. `updateChatById` reads the ref → "abcde",
    //      writes "abcdef" to the ref, schedules setChats.
    //   3. Delta 7 arrives. Reads ref → "abcdef", writes "abcdefg",
    //      schedules setChats.
    //   4. React hasn't repainted yet, but this effect's closure was
    //      captured at render N — its `chats` value is the "abcde"
    //      snapshot.
    //   5. Effect fires (post-commit hook for render N) and overwrites
    //      `chatByIdRef.current` with a map built from the closed-over
    //      "abcde" snapshot — wiping deltas 6+7 from the ref.
    //   6. Delta 8 arrives. Reads ref → "abcde" (stale), writes
    //      "abcdeh". Deltas 6+7 are now permanently lost.
    //   7. setChats from step 6 runs with prev=chats[N] (post react
    //      batch resolution → "abcdefg"), then overwrites with our
    //      broken "abcdeh".
    //
    // Symptom in user-visible transcript: alternating runs of ~5
    // tokens kept / 1-6 tokens dropped, matching React's frame pacing
    // against Codex's 5-60 deltas/sec stream. The raw event log on
    // disk shows the full content — only the rendered/persisted view
    // is broken. Garbled saved messages like "Phase 0 handoff is to
    // Gemini for research use a new V2 this is a fresh pass subthread
    // for any Phase." come from this clobber path; raw events show
    // the full "Phase 0 handoff is going to Gemini for research only;
    // I'll use a new V2 Gemini subthread now because this is a fresh
    // pass, and I'll reuse that subthread for any Phase 0 follow-
    // ups." sequence.
    //
    // Fix: still rebuild from React state for the GENERAL case (new
    // chats, deletions, workspace switches) but PRESERVE the ref's
    // entry for any chat with an active or recently-completed run.
    // Those chats' content is being written directly to the ref by
    // the streaming hot path, and that ref content is strictly more
    // up-to-date than any React-state-derived snapshot.
    const next = new Map<string, ChatRecord>()
    chats.forEach((chat) => next.set(chat.appChatId, chat))
    if (currentChat?.appChatId) {
      next.set(currentChat.appChatId, currentChat)
    }
    const now = Date.now()
    for (const [chatId, liveEntry] of chatByIdRef.current.entries()) {
      let preserve = false
      // Phase K-followup — H1 garbling fix. activeRunsRef.set() lives
      // ~520 lines after the initial setChats() in runChat. A delta
      // arriving in that window triggers this effect with no entry
      // yet in activeRunsRef, so preserve=false → the live ref
      // (carrying partial streaming content) gets clobbered by the
      // React snapshot (which doesn't yet have the streaming content
      // either). Consequence: tokens that arrived between the
      // initial setChats and the activeRunsRef.set are lost.
      // The early-set activeRunChatIdRef closes the gap — it's
      // populated at line 8845, BEFORE the initial setChats call.
      if (activeRunChatIdRef.current === chatId) {
        preserve = true
      }
      if (!preserve) {
        for (const ctx of activeRunsRef.current.values()) {
          if (ctx.chatId === chatId) {
            preserve = true
            break
          }
        }
      }
      if (!preserve) {
        const completedAt = recentlyCompletedChatIdsRef.current.get(chatId)
        if (completedAt !== undefined && now - completedAt < RECENTLY_COMPLETED_WINDOW_MS) {
          preserve = true
        }
      }
      if (preserve) {
        next.set(chatId, liveEntry)
      }
    }
    chatByIdRef.current = next
  }, [chats, currentChat])

  useEffect(() => {
    void window.api.getScheduledTasks(currentWorkspace?.id).then(setScheduledTasks)
  }, [currentWorkspace?.id])

  useEffect(() => {
    const overdueTasks = scheduledTasks.filter((task) => {
      if (task.status === 'due') return true
      if (task.status !== 'pending') return false
      const runAtMs = new Date(task.runAt).getTime()
      return Number.isFinite(runAtMs) && runAtMs <= Date.now()
    })
    if (overdueTasks.length === 0) return
    setDueScheduledTasks((prev) => {
      const existingIds = new Set(prev.map((task) => task.id))
      const next = overdueTasks.filter((task) => !existingIds.has(task.id))
      return next.length > 0 ? [...prev, ...next] : prev
    })
  }, [scheduledTasks])

  useEffect(() => {
    if (!currentWorkspace?.path) {
      setDiscoveredCommands([])
      setGeminiMemoryFiles([])
      setCommandDiscoveryStatus('Static Gemini commands loaded.')
      setGeminiMemoryStatus('GEMINI.md memory has not been inspected yet.')
      return
    }

    void refreshCommandDiscovery(currentWorkspace.path)
    void refreshGeminiMemory(currentWorkspace.path)
  }, [currentWorkspace?.path, refreshCommandDiscovery, refreshGeminiMemory])

  // ----- Raw Events auto-follow scrolling -------------------------------
  // Mirrors the transcript auto-follow design (see the long block above
  // anchored around `transcriptScrollRef`). The Raw Events panel streams
  // a new entry for every run event; before this fix the effect below
  // unconditionally wrote `scrollTop = scrollHeight` whenever
  // `rawLogs.length` changed, which fought the user any time they tried
  // to scroll up to inspect earlier events during an active run.
  //
  // Three effects implement the policy and intentionally reuse the same
  // `lib/TranscriptScroll` helpers as the transcript so the two surfaces
  // share one truth source:
  //   1. Scroll listener flips `rawEventsAutoFollowRef` based on
  //      distance-from-bottom with hysteresis
  //      (`shouldEngageAutoFollow` / `shouldDisengageAutoFollow`).
  //   2. Wheel/touch/keyboard listeners record real user-initiated
  //      upward scrolls into `rawEventsUserScrolledAwayRef` so the
  //      auto-scroll effect can stand down.
  //   3. The auto-scroll effect (the original site of the bug) is gated
  //      on `rawEventsAutoFollowRef`; when auto-follow is engaged it
  //      writes once to the bottom, when disengaged it leaves the user
  //      where they are.
  //
  // The scroll container is `.raw-events-body` — the inspector tab
  // re-mounts each time `rightTab` flips, so the listener effects are
  // keyed on `rightTab === 'raw'` to (a) bind only when the panel is
  // present in the DOM and (b) re-bind cleanly when the user switches
  // tabs and back.
  useEffect(() => {
    if (rightTab !== 'raw') return
    const scroller = rawLogsEndRef.current?.closest('.raw-events-body') as HTMLElement | null
    if (!scroller) return

    let rafId: number | null = null
    const evaluate = () => {
      rafId = null
      const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
      if (shouldEngageAutoFollow(distanceFromBottom)) {
        rawEventsAutoFollowRef.current = true
        // Returning to the bottom clears any prior user scroll-away so
        // the next streamed entry can re-pin without delay.
        rawEventsUserScrolledAwayRef.current = false
      } else if (shouldDisengageAutoFollow(distanceFromBottom)) {
        rawEventsAutoFollowRef.current = false
      }
    }
    const onScroll = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(evaluate)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [rightTab])

  // Detect real user-initiated upward scroll attempts on the Raw Events
  // panel. Plain `scroll` events fire for both user input and the
  // browser clamping `scrollTop` when content grows underneath, so the
  // wheel + touch + keyboard listeners below capture the user-intent
  // signal and feed it into `rawEventsUserScrolledAwayRef`. The
  // auto-scroll effect then refuses to fight a deliberate scroll-up.
  useEffect(() => {
    if (rightTab !== 'raw') return
    const scroller = rawLogsEndRef.current?.closest('.raw-events-body') as HTMLElement | null
    if (!scroller) return

    const handleUpwardIntent = (deltaY: number) => {
      // Only upward intent counts: scrolling further down should not
      // flip the flag (it would immediately re-engage anyway).
      if (deltaY >= 0) return
      const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
      if (distanceFromBottom > 0) {
        rawEventsUserScrolledAwayRef.current = true
      }
    }

    const onWheel = (event: WheelEvent) => handleUpwardIntent(event.deltaY)

    let lastTouchY: number | null = null
    const onTouchStart = (event: TouchEvent) => {
      lastTouchY = event.touches[0]?.clientY ?? null
    }
    const onTouchMove = (event: TouchEvent) => {
      const currentY = event.touches[0]?.clientY ?? null
      if (currentY === null || lastTouchY === null) return
      // Touch dragging down scrolls up — invert delta to match wheel
      // semantics (negative = upward intent).
      handleUpwardIntent(lastTouchY - currentY)
      lastTouchY = currentY
    }
    const onTouchEnd = () => {
      lastTouchY = null
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'PageUp' || event.key === 'ArrowUp' || event.key === 'Home') {
        handleUpwardIntent(-1)
      }
    }

    scroller.addEventListener('wheel', onWheel, { passive: true })
    scroller.addEventListener('touchstart', onTouchStart, { passive: true })
    scroller.addEventListener('touchmove', onTouchMove, { passive: true })
    scroller.addEventListener('touchend', onTouchEnd, { passive: true })
    scroller.addEventListener('keydown', onKeyDown)

    return () => {
      scroller.removeEventListener('wheel', onWheel)
      scroller.removeEventListener('touchstart', onTouchStart)
      scroller.removeEventListener('touchmove', onTouchMove)
      scroller.removeEventListener('touchend', onTouchEnd)
      scroller.removeEventListener('keydown', onKeyDown)
    }
  }, [rightTab])

  // Auto-scroll the Raw Events panel to the bottom when new events
  // arrive — but only when auto-follow is engaged. `shouldRepinAfterFrame`
  // guards against scrolling while the user has actively scrolled away
  // since the last paint, so a deliberate read-back is never fought.
  // Switching filters / opening the panel also fires this effect, which
  // is the expected "snap to bottom on (re)mount" behaviour.
  useEffect(() => {
    if (rightTab !== 'raw') return
    if (
      !shouldRepinAfterFrame({
        autoFollow: rawEventsAutoFollowRef.current,
        userScrolledAwayInThisFrame: rawEventsUserScrolledAwayRef.current
      })
    ) {
      return
    }
    const rawEventsBody = rawLogsEndRef.current?.closest('.raw-events-body') as HTMLElement | null
    if (rawEventsBody) {
      rawEventsBody.scrollTo({
        top: rawEventsBody.scrollHeight,
        behavior: appearance.reduceMotion ? 'auto' : 'smooth'
      })
      // Clear the per-frame intent flag after a successful auto-scroll
      // so a later wheel event in the same frame can still register.
      rawEventsUserScrolledAwayRef.current = false
    }
  }, [rawLogs.length, rawFilter, rightTab, appearance.reduceMotion])

  useEffect(() => {
    if (showGeminiTerminal) {
      geminiTerminalEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [rawLogs, showGeminiTerminal])

  useEffect(() => {
    if (!showGeminiTerminal) {
      return
    }

    const clampTerminalOnResize = () => {
      setGeminiTerminalHeight((current) => clampGeminiTerminalHeight(current))
    }

    window.addEventListener('resize', clampTerminalOnResize)
    return () => window.removeEventListener('resize', clampTerminalOnResize)
  }, [showGeminiTerminal])

  useEffect(() => {
    const geminiSessionApi = window.api as any
    if (
      typeof geminiSessionApi.onGeminiSessionData !== 'function' &&
      typeof geminiSessionApi.onGeminiSessionExit !== 'function'
    ) {
      return
    }

    if (typeof geminiSessionApi.onGeminiSessionData === 'function') {
      geminiSessionApi.onGeminiSessionData((data: string) => {
        setRawLogs((prev) => [...prev, { type: 'stdout', content: redactLog(String(data)) }])
      })
    }

    if (typeof geminiSessionApi.onGeminiSessionExit === 'function') {
      geminiSessionApi.onGeminiSessionExit((code: number | null) => {
        persistentSessionActiveRef.current = false
        setPersistentSessionStatus('exited')
        setIsPersistentSessionEnabled(false)
        setRawLogs((prev) => [
          ...prev,
          {
            type: 'info',
            content: `Persistent Gemini session exited with code ${typeof code === 'number' ? code : 'unknown'}.`
          }
        ])
      })
    }

    return () => {
      if (typeof geminiSessionApi.removeGeminiSessionListeners === 'function') {
        geminiSessionApi.removeGeminiSessionListeners()
      }
    }
  }, [])

  useEffect(() => {
    const geminiSessionApi = window.api as any
    if (
      !isPersistentSessionEnabled ||
      !persistentSessionActiveRef.current ||
      typeof geminiSessionApi.resizeGeminiSession !== 'function'
    ) {
      return
    }

    const resizeSession = () => {
      const cols = Math.max(80, Math.floor(window.innerWidth / 8))
      const rows = Math.max(24, Math.floor(window.innerHeight / 18))
      geminiSessionApi.resizeGeminiSession(cols, rows).catch?.(() => {})
    }

    resizeSession()
    window.addEventListener('resize', resizeSession)
    return () => window.removeEventListener('resize', resizeSession)
  }, [isPersistentSessionEnabled])

  const handleGeminiCapacityExhaustion = (
    provider: ProviderId,
    context: ActiveRunContext | null,
    message: string,
    runChatId: string | null | undefined,
    isVisibleRun: boolean
  ): boolean => {
    if (
      provider !== 'gemini' ||
      !context ||
      classifyError(message) !== 'model_capacity_exhausted'
    ) {
      return false
    }

    const redacted = redactLog(message)
    context.warnings.push({ message: redacted, timestamp: new Date().toISOString() })
    context.errorCount += 1
    triggerFxBurst('warning')

    if (context.errorCount >= 3 && context.toolCallsCount === 0 && !context.capacityFallbackShown) {
      context.capacityFallbackShown = true
      const stopReason = `Stopped after repeated Gemini model capacity exhaustion (${context.errorCount} retries).`
      markCapacityStoppedRun(context, stopReason)
      clearQueuedRunsForProvider('gemini', 'Cancelled because Gemini Pro capacity is exhausted.')
      void window.api
        .cancelAgentRun('gemini', context.runId)
        .catch(() => window.api.cancelGemini(context.runId))
      clearActiveRunContext(context)
      if (isVisibleRun) setIsThinking(false)
      if (isVisibleRun) setShowFallbackUX(true)
      if (runChatId) {
        updateChatById(runChatId, (source) => {
          const msgs = [
            ...source.messages,
            {
              id: createMessageId(),
              role: 'system',
              content: `Run auto-stopped due to repeated Gemini model capacity exhaustion (${context.errorCount} retries). Try Flash or Flash Lite for this request.`,
              timestamp: new Date().toISOString()
            }
          ] as ChatMessage[]
          return { ...source, messages: msgs }
        })
      }
    }

    return true
  }

  const refreshDiff = async () => {
    if (currentWorkspace) {
      const worktree =
        currentProvider === 'gemini' ? resolveGeminiWorktreeConfig(currentWorkspace) : undefined
      if (isGeminiWorktreeDiffUnavailable(worktree)) {
        setDiff(createWorktreeDiffUnavailable())
        setRunDiff(null)
        setDiffView('workspace')
        setDiffRefreshStatus('Diff disabled: worktree path unknown.')
        return
      }

      const diffObj = await window.api.getDiff(getDiffWorkspacePath(currentWorkspace, worktree))
      setDiff(diffObj)
    }
  }

  const appEventHandlersRef = useRef({
    appendThreadRawLog,
    clearActiveRunContext,
    getRunFileDiffSummaries,
    handleGeminiCapacityExhaustion,
    refreshDiff,
    refreshUsageSummary,
    resolveActiveRunContext,
    setPendingAgentApprovalByChatId,
    setPendingAgentApprovalForChat,
    enqueueApprovalForChat,
    advanceApprovalQueueForChat,
    showAttachmentPermissionRequest,
    triggerFxBurst
  })
  appEventHandlersRef.current = {
    appendThreadRawLog,
    clearActiveRunContext,
    getRunFileDiffSummaries,
    handleGeminiCapacityExhaustion,
    refreshDiff,
    refreshUsageSummary,
    resolveActiveRunContext,
    setPendingAgentApprovalByChatId,
    setPendingAgentApprovalForChat,
    enqueueApprovalForChat,
    advanceApprovalQueueForChat,
    showAttachmentPermissionRequest,
    triggerFxBurst
  }

  // IPC Listeners
  useEffect(() => {
    const handleProviderOutput = (fallbackProvider: ProviderId, payload: unknown) => {
      const handlers = appEventHandlersRef.current
      const provider = getRouteProvider(payload, fallbackProvider)
      const text = extractStreamText(payload, 'data')
      if (!text) return
      const context = handlers.resolveActiveRunContext(
        provider,
        getRouteRunId(payload),
        getRouteChatId(payload)
      )
      if (context) {
        handlers.handleGeminiCapacityExhaustion(
          provider,
          context,
          text,
          context.chatId,
          !context.chatId || currentChatIdRef.current === context.chatId
        )
        context.adapter.appendChunk(text)
      } else {
        handlers.appendThreadRawLog(getRouteChatId(payload) || currentChatIdRef.current, {
          type: 'stdout',
          content: text
        })
      }
    }

    const handleProviderError = (fallbackProvider: ProviderId, payload: unknown) => {
      const handlers = appEventHandlersRef.current
      const provider = getRouteProvider(payload, fallbackProvider)
      const error = extractStreamText(payload, 'error')
      if (!error) return
      const context = handlers.resolveActiveRunContext(
        provider,
        getRouteRunId(payload),
        getRouteChatId(payload)
      )
      const redacted = redactLog(error)
      const category = classifyError(error)
      const permissionRequest = parseGeminiPermissionRequest(error)
      const errorRunChatId = context?.chatId || getRouteChatId(payload) || currentChatIdRef.current
      const isVisibleErrorRun = !errorRunChatId || currentChatIdRef.current === errorRunChatId
      if (
        provider === 'gemini' &&
        isVisibleErrorRun &&
        permissionRequest &&
        (category === 'permission_or_approval_required' || category === 'untrusted_workspace')
      ) {
        handlers.showAttachmentPermissionRequest({
          ...permissionRequest,
          message: redactLog(permissionRequest.message)
        })
        handlers.triggerFxBurst('warning')
      }

      if (provider === 'gemini' && context && category === 'model_capacity_exhausted') {
        handlers.handleGeminiCapacityExhaustion(
          provider,
          context,
          error,
          errorRunChatId,
          isVisibleErrorRun
        )
      }
      if (
        provider === 'gemini' &&
        isVisibleErrorRun &&
        category !== 'model_capacity_exhausted' &&
        redacted.toLowerCase().includes('warning')
      ) {
        handlers.triggerFxBurst('warning')
      }

      handlers.appendThreadRawLog(errorRunChatId, { type: 'stderr', content: redacted })
    }

    const handleProviderExit = (fallbackProvider: ProviderId, payload: unknown) => {
      const handlers = appEventHandlersRef.current
      const provider = getRouteProvider(payload, fallbackProvider)
      const context = handlers.resolveActiveRunContext(
        provider,
        getRouteRunId(payload),
        getRouteChatId(payload)
      )
      if (!context) {
        syncRunningState()
        return
      }

      context.adapter.end()
      const hasToolCalls = context.toolCallsCount > 0
      const exitCode = extractExitCode(payload) ?? 0
      const completedRunId = context.runId
      const completedRunChatId = context.chatId
      const completedScheduledTaskId = context.scheduledTaskId
      const completedRunDiffUnavailable = context.diffUnavailable
      const isGlobalCompletedRun = !context.baseWorkspacePath
      const completedWorkspacePath =
        isGlobalCompletedRun || completedRunDiffUnavailable ? null : context.workspacePath
      const completedRunStartedAt = context.startedAt
      const completedRunExitStats =
        payload && typeof payload === 'object' ? (payload as RunRouteEventPayload).stats : undefined
      const isVisibleCompletedRun = () =>
        !completedRunChatId || currentChatIdRef.current === completedRunChatId
      updateRunQueueJobStatus(
        completedRunId,
        exitCode === 0 ? 'completed' : 'failed',
        exitCode === 0 ? 'Provider run completed.' : `Provider run exited with code ${exitCode}.`,
        exitCode === 0 ? undefined : `Run exited with code ${exitCode}`
      )
      appendDurableRunEvent({
        runId: completedRunId,
        chatId: completedRunChatId,
        workspaceId: isGlobalCompletedRun
          ? undefined
          : chatByIdRef.current.get(completedRunChatId)?.workspaceId,
        workspacePath: completedWorkspacePath || context.workspacePath || undefined,
        provider,
        kind: 'lifecycle',
        phase: 'control',
        source: 'renderer',
        summary: `Renderer observed provider exit: ${exitCode}`,
        payload: {
          exitCode,
          hasToolCalls,
          diffUnavailable: completedRunDiffUnavailable,
          scheduledTaskId: completedScheduledTaskId
        }
      })
      handlers.triggerFxBurst('run-complete')
      if (context.warnings.length > 0) {
        handlers.triggerFxBurst('run-summary')
      }
      if (isVisibleCompletedRun()) {
        setIsThinking(false)
      }

      updateChatById(completedRunChatId, (source) => {
        const updated = { ...source }

        const runs = [...(updated.runs || [])]
        const runIndex = runs.findIndex((run) => run.runId === completedRunId)
        const targetRun = runIndex >= 0 ? runs[runIndex] : undefined
        if (targetRun) {
          if (targetRun.status === 'success' && context.warnings.length > 0) {
            targetRun.status = 'success_with_warnings'
          } else if (!targetRun.status) {
            targetRun.status =
              exitCode === 0
                ? context.warnings.length > 0
                  ? 'success_with_warnings'
                  : 'success'
                : 'failed'
          }
          targetRun.exitCode = exitCode || undefined
          targetRun.warnings = [...context.warnings]
          if (shouldBackfillRunStats(targetRun.stats, completedRunExitStats)) {
            targetRun.stats = completedRunExitStats
          }
        }
        updated.runs = runs

        const completedAt = new Date().toISOString()
        // Skip the per-participant run-complete notice for ensemble
        // chats — each participant's exit would clobber the card
        // with that participant's metadata. The notice fires once
        // per ROUND via the dedicated `activeRound.status` effect
        // below.
        const isEnsembleChat = updated.chatKind === 'ensemble'
        if (exitCode === 0) {
          if (!isEnsembleChat && isVisibleCompletedRun()) {
            setRunCompleteNotice({
              timestamp: completedAt,
              exitCode,
              startedAt: targetRun?.startedAt || completedRunStartedAt || undefined
            })
          }
        }
        if (exitCode !== 0) {
          // A failed run used to surface only a terse "Check Raw Events"
          // line with the exit code thrown away. Now we (a) raise the
          // run-complete card (same as success) so the outcome is
          // visible without digging into Raw Events, and (b) name the
          // exit code + last error line in the system message. Code 130
          // is the SIGINT a user Cancel produces — report it as a
          // cancellation, not a failure.
          if (!isEnsembleChat && isVisibleCompletedRun()) {
            setRunCompleteNotice({
              timestamp: completedAt,
              exitCode,
              startedAt: targetRun?.startedAt || completedRunStartedAt || undefined
            })
          }
          const lastErrorLine =
            (payload && typeof payload === 'object'
              ? (payload as RunRouteEventPayload).error
              : undefined) ||
            context.warnings[context.warnings.length - 1]?.message ||
            ''
          const exitMessage =
            exitCode === 130
              ? 'Run cancelled.'
              : `Task ended before completing (exit code ${exitCode}).${
                  lastErrorLine ? ` Last error: ${lastErrorLine}` : ''
                } See Raw Events for the full log.`
          const msgs = [
            ...updated.messages,
            {
              id: createMessageId(),
              role: 'system',
              content: exitMessage,
              timestamp: completedAt
            }
          ] as ChatMessage[]
          updated.messages = msgs
        }
        return updated
      })

      // 1.0.6-TV7 — per-WRITE-workspace run diff summaries. Additive +
      // fully isolated from the primary snapshot diff below: derived
      // from the just-finalised chat's tool-reported changes (no
      // filesystem snapshot, no IPC), so a failure here can never block
      // or corrupt the authoritative primary-path diff. Stored on the
      // run as `runDiffByPath` for Diff Studio's Workspaces selector
      // (TV8); omitted entirely when no WRITE workspace changed.
      try {
        updateChatById(completedRunChatId, (source) => {
          const grants = normalizeExternalPathGrants(
            collectExternalPathGrantsFromMetadata(source.providerMetadata)
          )
          const byPath = buildRunDiffByPath(source.messages, grants)
          if (Object.keys(byPath).length === 0) return source
          const runs = [...(source.runs || [])]
          const idx = runs.findIndex((run) => run.runId === completedRunId)
          if (idx < 0) return source
          runs[idx] = { ...runs[idx], runDiffByPath: byPath }
          return { ...source, runs }
        })
      } catch {
        /* per-workspace diff is best-effort; never blocks the primary path */
      }

      if (completedRunDiffUnavailable) {
        if (isVisibleCompletedRun()) {
          setRunDiff(null)
          setDiffView('workspace')
          setDiff(createWorktreeDiffUnavailable())
          setDiffRefreshStatus('Diff disabled: worktree path unknown.')
        }
      } else if (
        !isGlobalCompletedRun &&
        completedWorkspacePath &&
        completedRunId &&
        context.preSnapshot
      ) {
        const completedPreSnapshot = context.preSnapshot
        window.api
          .captureSnapshot(completedWorkspacePath)
          .then((postSnapshot) => {
            window.api
              .computeRunDiff(completedRunId, completedPreSnapshot, postSnapshot, {
                chatId: completedRunChatId,
                workspaceId:
                  context.workspaceId || chatByIdRef.current.get(completedRunChatId)?.workspaceId,
                workspacePath: context.baseWorkspacePath!,
                effectiveWorkspacePath: completedWorkspacePath,
                provider,
                ...(context.worktree
                  ? {
                      worktree: {
                        enabled: Boolean(context.worktree.enabled),
                        name: context.worktree.name,
                        baseWorkspacePath: context.baseWorkspacePath!,
                        effectivePath: context.worktree.effectivePath || completedWorkspacePath
                      }
                    }
                  : {}),
                ...(provider === 'gemini'
                  ? {
                      checkpoint: {
                        enabled: Boolean(context.checkpointingEnabled),
                        provider: 'gemini' as const
                      }
                    }
                  : {}),
                metadata: {
                  scheduledTaskId: completedScheduledTaskId || undefined
                }
              })
              .then(async (runDiffResult) => {
                appendDurableRunEvent({
                  runId: completedRunId,
                  chatId: completedRunChatId,
                  workspaceId: chatByIdRef.current.get(completedRunChatId)?.workspaceId,
                  workspacePath: completedWorkspacePath,
                  provider,
                  kind: 'diff',
                  phase: 'artifact',
                  source: 'renderer',
                  summary: `Run diff: ${runDiffResult.createdFiles.length} created, ${runDiffResult.modifiedFiles.length} modified, ${runDiffResult.deletedFiles.length} deleted`,
                  payload: {
                    ...runDiffResult,
                    workspaceChangeSetId: runDiffResult.changeSetId
                  }
                })
                updateChatById(completedRunChatId, (source) => {
                  const runs = [...(source.runs || [])]
                  const targetIndex = runs.findIndex((run) => run.runId === completedRunId)
                  if (targetIndex >= 0) {
                    runs[targetIndex].preSnapshot = completedPreSnapshot
                    runs[targetIndex].postSnapshot = postSnapshot
                    runs[targetIndex].runDiff = runDiffResult
                    runs[targetIndex].workspaceChangeSetId = runDiffResult.changeSetId
                  }
                  return { ...source, runs }
                })
                const allRunChanges = [
                  ...runDiffResult.createdFiles,
                  ...runDiffResult.modifiedFiles,
                  ...runDiffResult.deletedFiles
                ]
                if (isVisibleCompletedRun()) {
                  setRunDiff(handlers.getRunFileDiffSummaries(allRunChanges))
                  setDiffView('this_run')
                }
              })
              .catch(() => {
                if (isVisibleCompletedRun()) setDiffView('workspace')
              })
          })
          .catch(() => {
            if (isVisibleCompletedRun()) setDiffView('workspace')
          })
      } else if (!isGlobalCompletedRun && isVisibleCompletedRun()) {
        setDiffView('this_run')
      }

      if (isVisibleCompletedRun() && !completedRunDiffUnavailable) {
        handlers.refreshDiff().then(() => {
          if (hasToolCalls || exitCode === 0) {
            setDiffRefreshStatus('Diff refreshed after run.')
          }
        })
      }

      // Phase K1: stamp this chat as "recently completed" BEFORE we
      // clear the active-run context so onChatUpdated's stream-safe
      // merge keeps protecting the live tail for ~2s. Stragglers
      // (delegation card writes, debounced save-chat round-trips) can
      // arrive 1+ IPC ticks after exit and would otherwise replace
      // the live transcript with a disk-stale snapshot.
      if (completedRunChatId) {
        recentlyCompletedChatIdsRef.current.set(completedRunChatId, Date.now())
      }
      handlers.clearActiveRunContext(context)

      if (completedScheduledTaskId) {
        void window.api
          .updateScheduledTask(completedScheduledTaskId, {
            status: exitCode === 0 ? 'completed' : 'failed',
            completedAt: new Date().toISOString(),
            lastError: exitCode === 0 ? undefined : `Run exited with code ${exitCode}`
          })
          .then(() =>
            window.api
              .getScheduledTasks(currentWorkspaceIdRef.current || undefined)
              .then(setScheduledTasks)
          )
      }

      if (currentWorkspaceIdRef.current) {
        void handlers.refreshUsageSummary(currentWorkspaceIdRef.current)
      }
    }

    window.api.onGeminiOutput((payload) => handleProviderOutput('gemini', payload))
    window.api.onGeminiError((payload) => handleProviderError('gemini', payload))
    window.api.onGeminiExit((payload) => handleProviderExit('gemini', payload))

    if (typeof window.api.onAgentOutput === 'function') {
      window.api.onAgentOutput((payload) => {
        if (payload?.provider === 'gemini') return
        handleProviderOutput(payload?.provider || 'codex', payload)
      })
    }

    if (typeof window.api.onAgentError === 'function') {
      window.api.onAgentError((payload) => {
        if (payload?.provider === 'gemini') return
        handleProviderError(payload?.provider || 'codex', payload)
      })
    }

    if (typeof window.api.onAgentExit === 'function') {
      window.api.onAgentExit((payload) => {
        if (payload?.provider === 'gemini') return
        handleProviderExit(payload?.provider || 'codex', payload)
      })
    }

    if (typeof window.api.onAgentApprovalRequest === 'function') {
      window.api.onAgentApprovalRequest((request) => {
        const handlers = appEventHandlersRef.current
        const context = handlers.resolveActiveRunContext(
          request.provider,
          request.appRunId,
          request.appChatId
        )
        const targetChatId = context?.chatId || request.appChatId || currentChatIdRef.current
        // 1.0.4-AK4 — queue when an approval is already pending for
        // this chat. Pre-AK4 the second arrival would overwrite the
        // first (losing the user's chance to act on it). With AK5/AK6
        // parallel fan-out lanes each can produce their own approval gate
        // simultaneously; queueing keeps them all addressable.
        handlers.setPendingAgentApprovalForChat(targetChatId, (previous) => {
          if (previous && targetChatId) {
            handlers.enqueueApprovalForChat(targetChatId, request)
            return previous
          }
          return request
        })
        handlers.appendThreadRawLog(targetChatId, {
          type: 'info',
          content: `${getProviderLabel(request.provider)} approval requested: ${request.title}\n${request.body}`
        })
      })
    }

    if (typeof window.api.onAgentApprovalTimeout === 'function') {
      window.api.onAgentApprovalTimeout((timeout) => {
        const handlers = appEventHandlersRef.current
        // Find which chat held this approval, clear it, and surface a
        // visible "auto-denied" note. The main process has already
        // dispatched action='decline' through the same processAgentApprovalResponse
        // path the renderer would use — this is just the UI tidy-up.
        // Raw-log uses `stderr` (red-toned in the existing UI) rather
        // than introducing a new `error` kind to the union.
        const matchedChatIds: string[] = []
        handlers.setPendingAgentApprovalByChatId((prev) => {
          const next: Record<string, AgentApprovalRequest | null> = {}
          for (const [chatId, request] of Object.entries(prev)) {
            if (request && request.id === timeout.approvalId) {
              matchedChatIds.push(chatId)
              next[chatId] = null
              handlers.appendThreadRawLog(chatId, {
                type: 'stderr',
                content: `Approval ${timeout.approvalId} auto-denied after ${(timeout.appliedMs / 1000).toFixed(0)}s (timeout). Run will need manual intervention if it stalled.`
              })
            } else {
              next[chatId] = request
            }
          }
          // No matching chat — log into the active chat as a fallback
          // so the user at least sees something happened.
          if (matchedChatIds.length === 0) {
            const fallbackChatId = currentChatIdRef.current
            if (fallbackChatId) {
              handlers.appendThreadRawLog(fallbackChatId, {
                type: 'stderr',
                content: `Approval ${timeout.approvalId} auto-denied after ${(timeout.appliedMs / 1000).toFixed(0)}s (timeout).`
              })
            }
          }
          return next
        })
        // 1.0.4-AK4 — advance queued approvals for any chat whose
        // head approval just timed out. The setState above runs
        // synchronously enough for our advance to see the cleared
        // head, but advanceApprovalQueueForChat reads from the
        // queue state (not the head), so order doesn't matter
        // here — it just promotes the next queued approval into
        // the head slot for each affected chat.
        for (const chatId of matchedChatIds) {
          handlers.advanceApprovalQueueForChat(chatId)
        }
      })
    }

    if (typeof window.api.onScheduledTaskDue === 'function') {
      window.api.onScheduledTaskDue((task) => {
        setDueScheduledTasks((prev) =>
          prev.some((item) => item.id === task.id) ? prev : [...prev, task]
        )
      })
    }

    if (typeof window.api.onScheduledTasksChanged === 'function') {
      window.api.onScheduledTasksChanged((tasks) => {
        setScheduledTasks(tasks)
      })
    }

    if (typeof window.api.onUsageChanged === 'function') {
      // Live-refresh the usage meters the moment a run records usage, rather
      // than waiting for the 90s poll.
      window.api.onUsageChanged(() => {
        void refreshUsageSummaryRef.current?.()
      })
    }

    if (typeof window.api.onChatUpdated === 'function') {
      // Phase F2: when the main process updates a chat (sub-thread
      // result back-propagation in particular), splice the fresh
      // record into our local state so the user sees the synthetic
      // "↩ Result from X" message without a manual reload.
      //
      // Phase J2: previously this handler returned `prev` unchanged
      // when the broadcast chat wasn't already in state — meaning a
      // brand-new sub-thread chat (broadcast right after the
      // delegation approval) was silently dropped, and the sidebar
      // only caught up on the next full `getChats()` poll. INSERT
      // when not found so newly-spawned sub-threads appear in the
      // sidebar within a single render frame. The companion sidebar
      // auto-expand for the parent workspace lives inside Sidebar.tsx
      // (it diffs `chats` against a ref of previously-seen
      // appChatIds), so when a sub-thread is added here the workspace
      // group containing its parent auto-expands too.
      window.api.onChatUpdated((chat) => {
        // Stream-safe merge: main may broadcast a disk-stale `ChatRecord`
        // mid-stream (saveChat debounces by 200ms; sub-thread delegation
        // card injection, F2 back-prop, surfaceSubThreadDispatchFailure
        // etc. all read-from-disk → splice → broadcast). Unconditionally
        // replacing `chatByIdRef.current` with that snapshot wipes out
        // every token streamed since the last persisted write. Net
        // effect: the rendered assistant transcript shows keep/drop/
        // drop/keep — the source of the "Codex transcript is garbled"
        // reports (raw event stream contains all tokens; we were
        // dropping them at the merge layer).
        //
        // Heuristic when a run is active for this chat: prefer the
        // live ref's content for any assistant message whose live copy
        // is longer than the incoming copy (streaming-only path —
        // disk can never be ahead of memory mid-run), and append any
        // assistant messages the live ref has that the broadcast
        // doesn't (newly-spawned assistant message, snapshot pre-
        // dating the first delta). System cards added by main
        // (delegation cards, sub-thread return cards) flow through
        // unchanged because they only exist in the broadcast.
        let merged = chat
        const liveChat = chatByIdRef.current.get(chat.appChatId)
        const hasActiveRun = (() => {
          for (const ctx of activeRunsRef.current.values()) {
            if (ctx.chatId === chat.appChatId) return true
          }
          return false
        })()
        // Phase K1 — extend the merge guard for ~2s past run completion
        // to catch the post-exit-race straggler broadcasts (delegation
        // card writes, debounced save-chat round-trips). After the
        // window expires we let the regular replace branch resume; if
        // there's no active run AND no recent completion, the broadcast
        // really IS authoritative.
        let hadRecentRun = false
        const completedAt = recentlyCompletedChatIdsRef.current.get(chat.appChatId)
        if (completedAt !== undefined) {
          if (Date.now() - completedAt < RECENTLY_COMPLETED_WINDOW_MS) {
            hadRecentRun = true
          } else {
            recentlyCompletedChatIdsRef.current.delete(chat.appChatId)
          }
        }
        if ((hasActiveRun || hadRecentRun) && liveChat && liveChat.messages.length > 0) {
          const liveById = new Map(liveChat.messages.map((m) => [m.id, m]))
          const mergedMessages = chat.messages.map((m) => {
            const live = liveById.get(m.id)
            if (
              live &&
              live.role === 'assistant' &&
              (live.content?.length ?? 0) > (m.content?.length ?? 0)
            ) {
              return { ...m, content: live.content }
            }
            return m
          })
          const incomingIds = new Set(chat.messages.map((m) => m.id))
          const orphanedLiveAssistants = liveChat.messages.filter(
            (m) => m.role === 'assistant' && !incomingIds.has(m.id)
          )
          /*
           * 1.0.5-EW36 — Also preserve orphaned synthetic `agentQuestion`
           * system markers added by the `onAgentQuestionRequested` IPC
           * listener (around line 10929). Without this, when an agent
           * calls `ask_user_question`:
           *
           *  1. Renderer creates a synthetic `role: 'system'` marker
           *     in `chat.messages` with `metadata.kind: 'agentQuestion'`
           *     and sets `pendingAgentQuestionByChatId[chatId]`.
           *  2. Main broadcasts `chat-updated` (e.g. because the tool-
           *     call event from the participant was just flushed, or
           *     because another participant in the same ensemble round
           *     emitted output). That broadcast doesn't include the
           *     synthetic marker — main doesn't know about it.
           *  3. The merge above ONLY preserved orphaned `assistant`
           *     messages, so the synthetic system marker silently
           *     vanished from `chat.messages`.
           *  4. The transcript-side `AgentQuestionCard` renders inline
           *     next to the marker via
           *     `pendingAgentQuestion.messageId === msg.id`. With the
           *     marker gone, the card never appears — the modal never
           *     pops, the user has no way to answer, the question
           *     times out after 10 minutes, and the agent reports
           *     "interactive question card timed out" in chat.
           *
           * Fix: filter the same orphaned-from-incoming list but also
           * include synthetic `agentQuestion` system markers.
           * Conservative — only matches the specific metadata kind so
           * other system messages (delegation cards, status notes,
           * etc.) keep flowing through unchanged.
           */
          const orphanedAgentQuestionMarkers = liveChat.messages.filter(
            (m) =>
              m.role === 'system' && m.metadata?.kind === 'agentQuestion' && !incomingIds.has(m.id)
          )
          const orphans = [...orphanedLiveAssistants, ...orphanedAgentQuestionMarkers]
          if (
            mergedMessages.length !== chat.messages.length ||
            orphans.length > 0 ||
            mergedMessages.some((m, i) => m !== chat.messages[i])
          ) {
            merged = {
              ...chat,
              messages: orphans.length > 0 ? [...mergedMessages, ...orphans] : mergedMessages
            }
          }
        }
        setChats((prev) => {
          const idx = prev.findIndex((c) => c.appChatId === merged.appChatId)
          if (idx < 0) {
            return [...prev, merged]
          }
          const next = prev.slice()
          next[idx] = merged
          return next
        })
        chatByIdRef.current.set(merged.appChatId, merged)
        if (currentChatIdRef.current === merged.appChatId) {
          setCurrentChat(merged)
        }
      })
    }

    if (typeof window.api.onRunQueueChanged === 'function') {
      window.api.onRunQueueChanged((jobs) => {
        setRunQueueJobs(jobs)
      })
    }

    // Phase J3: subscribe to YOLO state broadcasts + fetch the initial
    // value at mount. Main resets `enabled: false` on every process
    // start so any previous YOLO session is gone after an app restart;
    // we still read the current value in case multiple windows are
    // attached to the same main process.
    let yoloUnsubscribe: (() => void) | null = null
    if (typeof window.api.agenticYoloGet === 'function') {
      window.api
        .agenticYoloGet()
        .then((state) => setSessionYoloModeState(state))
        .catch(() => {})
    }
    if (typeof window.api.onAgenticYoloState === 'function') {
      yoloUnsubscribe = window.api.onAgenticYoloState((state) => setSessionYoloModeState(state))
    }

    // QMOD (1.0.3) — listen for `ask_user_question` MCP-driven question
    // requests from main. When an agent calls the tool, main fires this
    // event with the question payload; we materialise a synthetic
    // system message in the chat (so the question appears in-line with
    // the conversation) and stash the metadata in per-chat state so the
    // transcript renderer can show the modal card next to it.
    let agentQuestionUnsubscribe: (() => void) | null = null
    let agentQuestionCancelUnsubscribe: (() => void) | null = null
    if (typeof window.api.onAgentQuestionRequested === 'function') {
      agentQuestionUnsubscribe = window.api.onAgentQuestionRequested((request) => {
        const messageId = `agent-question-${request.questionId}`
        // Insert a synthetic system message into the chat's transcript
        // marking the question. Persisted in `chat.messages` so the
        // question + answer trail survives chat reloads. The transcript
        // renderer keys off `metadata.kind === 'agentQuestion'` to
        // render the modal card next to this message.
        updateChatById(request.appChatId, (prev) => {
          // Avoid duplicating the marker on re-fires (e.g. main retries
          // an event after a renderer reload). We key on questionId.
          if (prev.messages?.some((msg) => msg.id === messageId)) return prev
          const askedAt = new Date().toISOString()
          const provider = (request.provider as ProviderId | undefined) ?? null
          const headerProvider = provider ? getProviderLabel(provider) : 'Agent'
          const headerLine = request.options?.length
            ? `${headerProvider} asked you to pick an option:`
            : `${headerProvider} asked you a question:`
          const next: ChatMessage = {
            id: messageId,
            role: 'system',
            content: headerLine,
            timestamp: askedAt,
            ...(request.appRunId ? { runId: request.appRunId } : {}),
            metadata: {
              kind: 'agentQuestion',
              questionId: request.questionId,
              ensembleProvider: provider || undefined,
              agentQuestion: request.question,
              agentQuestionOptions: request.options,
              agentQuestionContext: request.context
            }
          }
          return { ...prev, messages: [...(prev.messages || []), next] }
        })
        setPendingAgentQuestionForChat(request.appChatId, {
          questionId: request.questionId,
          appRunId: request.appRunId,
          messageId,
          provider: (request.provider as ProviderId | undefined) ?? null,
          question: request.question,
          options: request.options,
          context: request.context,
          askedAt: Date.now()
        })
      })
    }
    if (typeof window.api.onAgentQuestionCancelled === 'function') {
      agentQuestionCancelUnsubscribe = window.api.onAgentQuestionCancelled((info) => {
        // Clear the pending-question slot for the chat that owned the
        // question. appChatId comes back on the cancellation payload so
        // we don't have to maintain our own questionId → chatId map.
        if (info.appChatId) {
          setPendingAgentQuestionForChat(info.appChatId, (prev) =>
            prev?.questionId === info.questionId ? null : prev
          )
        }
      })
    }

    return () => {
      window.api.removeListeners()
      yoloUnsubscribe?.()
      agentQuestionUnsubscribe?.()
      agentQuestionCancelUnsubscribe?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- app-wide IPC subscriptions register once; mutable handlers route through refs.
  }, [])

  const currentGeminiWorktree =
    currentProvider === 'gemini' ? resolveGeminiWorktreeConfig(currentWorkspace) : undefined
  const activeDiff = isGeminiWorktreeDiffUnavailable(currentGeminiWorktree)
    ? createWorktreeDiffUnavailable()
    : diffView === 'this_run' && runDiff
      ? { type: 'changes', summaries: runDiff }
      : diff

  const getRunQueueSource = (request: QueuedRunRequest): RunQueueJobSource => {
    if (request.scheduledTaskId) return 'scheduled'
    if (request.codexNativeReview) return 'review'
    if (request.existingPrompt) return 'retry'
    return 'manual'
  }

  const createRunQueueRequestSnapshot = (request: QueuedRunRequest): RunQueueRequestSnapshot => ({
    scope: request.scope || getChatScope(request.chatRecord || currentChat),
    prompt: request.prompt,
    ...(request.displayPrompt ? { displayPrompt: request.displayPrompt } : {}),
    selectedModelType: request.selectedModelType,
    customModel: request.customModel,
    approvalMode: request.approvalMode,
    sessionTrust: request.sessionTrust,
    imageAttachments: request.imageAttachments.map((attachment) => ({
      id: attachment.id,
      path: attachment.path,
      name: attachment.name
    })),
    ...(request.externalPathGrants?.length
      ? { externalPathGrants: request.externalPathGrants }
      : {}),
    ...(request.geminiWorktree ? { geminiWorktree: request.geminiWorktree } : {}),
    ...(request.codexNativeReview ? { codexNativeReview: true } : {}),
    ...(request.codexReasoningEffort !== undefined
      ? { codexReasoningEffort: request.codexReasoningEffort }
      : {}),
    ...(request.codexServiceTier !== undefined
      ? { codexServiceTier: request.codexServiceTier }
      : {}),
    ...(request.claudeFastMode !== undefined ? { claudeFastMode: request.claudeFastMode } : {}),
    ...(request.kimiThinkingEnabled !== undefined
      ? { kimiThinkingEnabled: request.kimiThinkingEnabled }
      : {}),
    ...(request.scheduledTaskId ? { scheduledTaskId: request.scheduledTaskId } : {}),
    ...(request.runtimeProfileId ? { runtimeProfileId: request.runtimeProfileId } : {}),
    ...(request.geminiAuthProfileId ? { geminiAuthProfileId: request.geminiAuthProfileId } : {}),
    ...(request.handoffSourceRunId ? { handoffSourceRunId: request.handoffSourceRunId } : {}),
    ...(request.preserveComposer ? { preserveComposer: true } : {})
  })

  const persistRunQueueJobForRequest = (
    request: QueuedRunRequest,
    status: RunQueueJobStatus,
    statusReason?: string
  ) => {
    const workspace =
      request.workspaceRecord || getWorkspaceForChat(request.chatRecord) || currentWorkspace
    const chat = request.chatRecord || currentChat
    const scope = request.scope || getChatScope(chat)
    const runId = request.appRunId
    if (!runId || !chat) return
    if (scope !== 'global' && !workspace) return
    window.api
      .requestRunQueueJob({
        id: runId,
        runId,
        provider: request.provider,
        scope,
        ...(scope === 'global'
          ? {}
          : { workspaceId: workspace!.id, workspacePath: workspace!.path }),
        chatId: chat?.appChatId,
        source: getRunQueueSource(request),
        status,
        promptPreview: request.displayPrompt || request.prompt,
        runtimeProfileId: request.runtimeProfileId,
        handoffSourceRunId: request.handoffSourceRunId,
        request: createRunQueueRequestSnapshot(request),
        ...(statusReason ? { statusReason } : {})
      })
      .catch(() => {})
  }

  const updateRunQueueJobStatus = (
    runId: string | undefined,
    status: RunQueueJobStatus,
    statusReason?: string,
    lastError?: string
  ) => {
    if (!runId) return
    const existing = runQueueJobsRef.current.find((job) => job.runId === runId || job.id === runId)
    if (existing && isTerminalRunQueueStatus(existing.status) && isTerminalRunQueueStatus(status)) {
      return
    }
    window.api
      .transitionRunQueueJob(runId, status, {
        ...(statusReason ? { statusReason } : {}),
        ...(lastError ? { lastError } : {})
      })
      .catch(() => {})
  }

  const queuedRunRequestFromJob = (
    job: RunQueueJob,
    workspaceList: WorkspaceRecord[],
    chatList: ChatRecord[]
  ): QueuedRunRequest | null => {
    if (job.status !== 'queued' || !job.request) return null
    const workspaceRecord = workspaceList.find(
      (workspace) => workspace.id === job.workspaceId || workspace.path === job.workspacePath
    )
    const chatRecord = chatList.find((chat) => chat.appChatId === job.chatId)
    const scope =
      job.scope === 'global' || job.request.scope === 'global' || isGlobalChat(chatRecord)
        ? 'global'
        : 'workspace'
    if (!chatRecord || (scope !== 'global' && !workspaceRecord)) return null
    const request = job.request
    const selectedModel = isValidModelForProvider(job.provider, request.selectedModelType)
      ? request.selectedModelType
      : getDefaultModelForProvider(job.provider)
    return {
      appRunId: job.runId,
      scope,
      provider: job.provider,
      prompt: request.prompt,
      displayPrompt: request.displayPrompt,
      selectedModelType: selectedModel,
      customModel: request.customModel,
      approvalMode: request.approvalMode,
      sessionTrust: request.sessionTrust,
      imageAttachments: request.imageAttachments.map((attachment, index) => ({
        id: attachment.id || `${job.runId}-attachment-${index}`,
        path: attachment.path,
        name: attachment.name || getImageName(attachment.path)
      })),
      externalPathGrants: request.externalPathGrants,
      geminiWorktree: request.geminiWorktree,
      codexNativeReview: request.codexNativeReview,
      codexReasoningEffort: request.codexReasoningEffort,
      codexServiceTier: request.codexServiceTier,
      claudeFastMode: request.claudeFastMode,
      kimiThinkingEnabled: request.kimiThinkingEnabled,
      scheduledTaskId: request.scheduledTaskId,
      runtimeProfileId: job.runtimeProfileId || request.runtimeProfileId,
      geminiAuthProfileId: request.geminiAuthProfileId,
      handoffSourceRunId: job.handoffSourceRunId || request.handoffSourceRunId,
      workspaceRecord: scope === 'global' ? undefined : workspaceRecord,
      chatRecord,
      preserveComposer: request.preserveComposer
    }
  }

  const recoveryMessageId = (record: RunRecoveryRecord): string => `recovery-${record.id}`

  const recoveryMessageContent = (record: RunRecoveryRecord): string => {
    const providerLabel = getProviderLabel(record.provider)
    const processText = record.process?.alive
      ? ` A process with PID ${record.process.pid}${record.process.command ? ` (${record.process.command})` : ''} may still be running outside TaskWraith.`
      : record.process
        ? ` No live process was found for the recorded PID ${record.process.pid}.`
        : ''
    return `Recovered interrupted ${providerLabel} run after app restart. ${record.reason} TaskWraith marked the run as ${record.recoveredStatus}.${processText} ${record.resumeHint}`
  }

  const applyRecoveryRecordsToChats = async (
    records: RunRecoveryRecord[],
    chatList: ChatRecord[]
  ): Promise<ChatRecord[]> => {
    if (records.length === 0 || chatList.length === 0) return chatList
    const recordsByChatId = new Map<string, RunRecoveryRecord[]>()
    for (const record of records) {
      if (!record.chatId) continue
      const existing = recordsByChatId.get(record.chatId) || []
      existing.push(record)
      recordsByChatId.set(record.chatId, existing)
    }

    if (recordsByChatId.size === 0) return chatList

    // Sidebar-badge fix: reconcile `runs[]` terminal state from the
    // recovery record so the chat record's persisted view matches the
    // run queue's. Without this, a chat whose Kimi (or other-provider)
    // run was orphaned by an app shutdown keeps a `runs[]` entry with
    // `endedAt`/`status` undefined, and the Sidebar's
    // `getLastRunStatus` keeps painting "Running" indefinitely — even
    // after `recoverRunQueueJobsAfterStartup` flipped the queue job
    // itself to `failed`. The pure helper lives in
    // `lib/recoverChatRunTerminals` so it is unit-tested without IPC.
    const runsReconciledChats = applyRecoveryRecordsToChatRuns(records, chatList)

    const updatedChats = runsReconciledChats.map((chat) => {
      const chatRecords = recordsByChatId.get(chat.appChatId) || []
      if (chatRecords.length === 0) return chat
      const existingMessageIds = new Set(chat.messages.map((message) => message.id))
      const messagesToAdd = chatRecords
        .filter((record) => !existingMessageIds.has(recoveryMessageId(record)))
        .map(
          (record): ChatMessage => ({
            id: recoveryMessageId(record),
            role: 'system',
            content: recoveryMessageContent(record),
            timestamp: record.recoveredAt,
            runId: record.runId
          })
        )
      if (messagesToAdd.length === 0) return chat
      return {
        ...chat,
        messages: [...chat.messages, ...messagesToAdd],
        updatedAt: Math.max(chat.updatedAt, Date.now())
      }
    })

    const changedChats = updatedChats.filter((chat, index) => chat !== chatList[index])
    if (changedChats.length === 0) return chatList

    for (const chat of changedChats) {
      chatByIdRef.current.set(chat.appChatId, chat)
    }
    await Promise.all(changedChats.map((chat) => window.api.saveChat(chat).catch(() => {})))
    setChats((prev) => {
      if (prev.length === 0) return updatedChats
      const updatedById = new Map(updatedChats.map((chat) => [chat.appChatId, chat]))
      return prev.map((chat) => updatedById.get(chat.appChatId) || chat)
    })
    setCurrentChat((prev) =>
      prev ? updatedChats.find((chat) => chat.appChatId === prev.appChatId) || prev : prev
    )
    return updatedChats
  }

  const rehydrateQueuedRuns = async (workspaceList: WorkspaceRecord[]) => {
    if (rehydratedRunQueueRef.current || typeof window.api.getRunQueueJobs !== 'function') return
    rehydratedRunQueueRef.current = true
    const [jobs, chatList, recoveryRecords] = await Promise.all([
      window.api.getRunQueueJobs({ statuses: ['queued'] }),
      window.api.getChats(),
      typeof window.api.getRunRecoveryRecords === 'function'
        ? window.api.getRunRecoveryRecords({ limit: 100 })
        : Promise.resolve([])
    ])
    const recoveredChatList = await applyRecoveryRecordsToChats(recoveryRecords, chatList)
    setRunQueueJobs(jobs)
    const restoredRuns = jobs
      .map((job) => queuedRunRequestFromJob(job, workspaceList, recoveredChatList))
      .filter((request): request is QueuedRunRequest => Boolean(request))
    if (restoredRuns.length > 0) {
      setQueuedRuns((current) => {
        const knownRunIds = new Set(current.map((request) => request.appRunId))
        return [...current, ...restoredRuns.filter((request) => !knownRunIds.has(request.appRunId))]
      })
    }
  }

  const buildRunRequest = (
    overrideModel?: string,
    existingPrompt?: string,
    target?: {
      chat?: ChatRecord | null
      prompt?: string
      imageAttachments?: ImageAttachment[]
    }
  ): QueuedRunRequest => {
    const selectedChat =
      target?.chat ||
      (currentChatIdRef.current ? chatByIdRef.current.get(currentChatIdRef.current) : null) ||
      currentChat
    const scope = getChatScope(selectedChat)
    const selectedWorkspace =
      scope === 'global' ? null : getWorkspaceForChat(selectedChat) || currentWorkspace
    const provider = selectedChat ? getChatProvider(selectedChat) : currentProvider
    const composerSelection = selectedChat ? getChatComposerSelection(selectedChat, provider) : null
    const rawRequestModel = overrideModel
      ? selectedModelType
      : composerSelection?.selectedModelType || selectedModelType
    const requestModel = isValidModelForProvider(provider, rawRequestModel)
      ? rawRequestModel
      : getDefaultModelForProvider(provider)
    const requestCustomModel = composerSelection?.customModel ?? customModel
    const requestApprovalMode = composerSelection?.approvalMode || approvalMode
    const requestReasoningEffort =
      provider === 'codex'
        ? composerSelection?.codexReasoningEffort || codexReasoningEffort
        : codexReasoningEffort
    const requestServiceTier =
      provider === 'codex'
        ? composerSelection?.codexServiceTier || codexServiceTier
        : codexServiceTier
    const requestKimiThinkingEnabled =
      provider === 'kimi'
        ? (composerSelection?.kimiThinkingEnabled ?? kimiThinkingEnabled)
        : kimiThinkingEnabled
    const requestClaudeReasoningEffort =
      provider === 'claude'
        ? composerSelection?.claudeReasoningEffort || claudeReasoningEffort
        : claudeReasoningEffort
    const requestClaudeFastMode =
      provider === 'claude' ? (composerSelection?.claudeFastMode ?? claudeFastMode) : claudeFastMode
    const externalPathGrants =
      scope !== 'global'
        ? normalizeExternalPathGrants(
            collectExternalPathGrantsFromMetadata(selectedChat?.providerMetadata)
          ).filter((grant) => grant.provider === provider)
        : []

    return {
      appRunId: createAppRunId(),
      scope,
      provider,
      prompt: target?.prompt !== undefined ? target.prompt : existingPrompt || prompt,
      overrideModel,
      existingPrompt,
      selectedModelType: requestModel,
      customModel: requestCustomModel,
      approvalMode: requestApprovalMode,
      sessionTrust,
      imageAttachments: target?.imageAttachments ?? imageAttachments,
      externalPathGrants,
      geminiWorktree:
        scope === 'global' ? undefined : resolveGeminiWorktreeConfig(selectedWorkspace),
      codexReasoningEffort: requestReasoningEffort,
      codexServiceTier: requestServiceTier,
      claudeReasoningEffort: requestClaudeReasoningEffort,
      claudeFastMode: requestClaudeFastMode,
      kimiThinkingEnabled: requestKimiThinkingEnabled,
      runtimeProfileId: getRuntimeProfileIdForChat(selectedChat, provider),
      geminiAuthProfileId:
        provider === 'gemini'
          ? typeof selectedChat?.providerMetadata?.geminiAuthProfileId === 'string'
            ? selectedChat.providerMetadata.geminiAuthProfileId
            : geminiAuthStatus?.activeProfileId || null
          : null,
      workspaceRecord: selectedWorkspace || undefined,
      chatRecord: selectedChat || undefined
    }
  }

  const queueRunRequest = (
    request: QueuedRunRequest,
    reason = 'Another task is currently active.'
  ) => {
    const queuedRequest = request.appRunId ? request : { ...request, appRunId: createAppRunId() }
    const queuedAt = new Date().toISOString()
    const targetChatId = queuedRequest.chatRecord?.appChatId
    const targetProvider = queuedRequest.provider
    const capacityContext =
      targetProvider === 'gemini' ? getActiveRunContextForProvider('gemini') : null
    if (capacityContext?.capacityFallbackShown) {
      updateRunQueueJobStatus(
        queuedRequest.appRunId,
        'cancelled',
        'Gemini Pro capacity fallback is active.'
      )
      appendThreadRawLog(targetChatId, {
        type: 'info',
        content:
          'Gemini run was not queued because the active Pro run hit model capacity. Retry with Flash or Flash Lite instead.'
      })
      return
    }
    const duplicateQueuedRun = queuedRuns.some(
      (queued) =>
        queued.provider === targetProvider &&
        queued.chatRecord?.appChatId === targetChatId &&
        queued.prompt === queuedRequest.prompt &&
        queued.selectedModelType === queuedRequest.selectedModelType &&
        queued.overrideModel === queuedRequest.overrideModel
    )
    if (duplicateQueuedRun) {
      updateRunQueueJobStatus(queuedRequest.appRunId, 'cancelled', 'Duplicate queued run ignored.')
      appendThreadRawLog(targetChatId, {
        type: 'info',
        content: `${getProviderLabel(targetProvider)} run was already queued for this request.`
      })
      return
    }
    const queuePosition = queuedRuns.length + 1
    persistRunQueueJobForRequest(queuedRequest, 'queued', reason)
    setQueuedRuns((prev) => [...prev, queuedRequest])
    appendThreadRawLog(targetChatId, {
      type: 'info',
      content: `${getProviderLabel(targetProvider)} run queued (${queuePosition} waiting). ${reason}`
    })
    if (targetChatId) {
      // Phase J3: surface the actual queued prompt + a clear delivery
      // state. Previously the system note was a generic "Queued behind
      // the active task" line that buried what the user typed — they
      // couldn't tell which queued message was theirs vs. an internal
      // permission-retry queue card. Now the card shows the prompt
      // preview, the queue position, and a `queuedRunRequest` metadata
      // ref so the UI can later render this as a dedicated queued-
      // message component (follow-up). The metadata.appRunId lets a
      // dispatched run replace this card in place.
      const promptPreview = (queuedRequest.displayPrompt || queuedRequest.prompt || '').trim()
      const promptOneLiner =
        promptPreview.length > 240 ? `${promptPreview.slice(0, 240)}…` : promptPreview
      updateChatById(targetChatId, (source) => ({
        ...source,
        messages: [
          ...source.messages,
          {
            id: `queued-${queuedRequest.appRunId || createMessageId()}`,
            role: 'system',
            content: promptPreview
              ? `Queued (#${queuePosition}): ${promptOneLiner}\n— Will dispatch when this chat's current ${getProviderLabel(targetProvider)} turn finishes.`
              : `Queued (#${queuePosition}). Will dispatch when this chat's current ${getProviderLabel(targetProvider)} turn finishes.`,
            timestamp: queuedAt,
            metadata: {
              kind: 'queuedRunRequest',
              appRunId: queuedRequest.appRunId,
              queuePosition,
              provider: targetProvider,
              promptPreview: promptOneLiner
            }
          }
        ],
        updatedAt: Date.now()
      }))
    }
  }

  const handlePermissionRetry = async () => {
    if (permissionRequestPaths.length === 0 || !currentWorkspace || !currentChat) {
      clearImagePermissions()
      return
    }

    const permissionAttachments = permissionRequestPaths.map((path, index) => ({
      id: `perm-${Date.now()}-${index}`,
      path,
      name: getImageName(path)
    }))
    const lastRequest = latestRunRequestRef.current
    const request = lastRequest
      ? {
          ...lastRequest,
          imageAttachments: mergeImageAttachments(
            lastRequest.imageAttachments,
            permissionAttachments
          )
        }
      : buildRunRequest()

    clearImagePermissions()

    if (isChatBusy(request.chatRecord?.appChatId || currentChat?.appChatId)) {
      queueRunRequest(
        request,
        `Permission retry is waiting for this chat's active ${getProviderLabel(request.provider)} task to exit.`
      )
      return
    }

    void executeRun(request)
  }

  const executeRun = async (runRequest?: QueuedRunRequest) => {
    // Diagnostic fix (send-message regression investigation, 2026-05-16):
    // Every call site invokes this via `void executeRun(...)` which
    // discards the returned promise. Without a function-level try/catch
    // any uncaught exception silently rejects — producing the reported
    // "clicking Send does nothing" symptom. Wrap the entire body so the
    // user always sees an error if something escapes the inner catches.
    try {
      const baseRequest = runRequest ?? buildRunRequest()
      const request = baseRequest.appRunId
        ? baseRequest
        : { ...baseRequest, appRunId: createAppRunId() }
      const runChat = request.chatRecord || currentChat
      const isGlobalRun = request.scope === 'global' || isGlobalChat(runChat)
      const runWorkspace = isGlobalRun ? null : request.workspaceRecord || currentWorkspace
      if (!runChat || (!isGlobalRun && !runWorkspace) || !request.prompt.trim()) return
      const runProvider = request.provider || currentProvider
      if (runChat.chatKind === 'ensemble') {
        const mode =
          runChat.ensemble?.activeRound?.status === 'running'
            ? ('queue' as const)
            : ('normal' as const)
        const concurrentMode = Boolean(
          runChat.ensemble?.concurrentModeEnabled && !request.dmTargetParticipantId
        )
        await window.api.runEnsembleRound({
          chatId: runChat.appChatId,
          prompt: request.prompt,
          mode,
          concurrentMode,
          imageAttachments: request.imageAttachments.map((attachment) => ({
            id: attachment.id,
            path: attachment.path,
            name: attachment.name
          })),
          // A2 (1.0.3) — DM the selected chip only when the user
          // sent with Cmd/Ctrl held. The orchestrator filters
          // participants to just this one for the round.
          ...(request.dmTargetParticipantId
            ? { dmTargetParticipantId: request.dmTargetParticipantId }
            : {}),
          // 1.0.4-AT4 — composer-level external path grants. Pre-AT4
          // these were dropped at the IPC boundary, so file-mention
          // grants the user added in the composer never reached
          // ensemble participants. The orchestrator runs them
          // through `resolveEffectiveRunPermissions`'s
          // `explicitExternalPathGrants` input which provider-
          // filters per participant.
          ...(request.externalPathGrants && request.externalPathGrants.length > 0
            ? { externalPathGrants: request.externalPathGrants }
            : {})
        })
        if (!request.existingPrompt && !request.preserveComposer) {
          setChatPromptDraft(runChat.appChatId, '')
          clearComposerAttachmentsForSubmittedRequest(request)
        }
        setIsThinking(true)
        setChats(await window.api.getChats())
        return
      }
      // Per-chat busy check: only queue when THIS chat has an active
      // run. Multiple chats can dispatch in parallel to the same
      // provider — the underlying runner (Codex app-server thread,
      // fresh CLI process for Gemini/Kimi, independent SDK call for
      // Claude) handles concurrency per-chat.
      if (isChatBusy(runChat.appChatId)) {
        queueRunRequest(
          request,
          `This ${getProviderLabel(runProvider)} chat already has an in-flight run; TaskWraith will dispatch this turn when the chat's previous turn finishes.`
        )
        return
      }

      persistRunQueueJobForRequest(request, 'starting', 'Provider runner is preparing this task.')
      runSchedulerBusyRef.current = true

      errorCountRef.current = 0
      toolCallsCountRef.current = 0
      activeRunUsageResetHintsRef.current = new Map()
      currentRunWarningsRef.current = []
      setShowFallbackUX(false)
      clearImagePermissions()
      latestRunRequestRef.current = request

      const runWorktree =
        !isGlobalRun && runProvider === 'gemini' ? request.geminiWorktree : undefined
      const runDiffUnavailable = !isGlobalRun && isGeminiWorktreeDiffUnavailable(runWorktree)
      const runDiffWorkspacePath =
        !isGlobalRun && runWorkspace && !runDiffUnavailable
          ? getDiffWorkspacePath(runWorkspace, runWorktree)
          : undefined
      const currentRunId = request.appRunId || Date.now().toString()
      let composedPayload: Awaited<ReturnType<typeof window.api.composeRun>>
      try {
        composedPayload = await window.api.composeRun({
          chatId: runChat.appChatId,
          appRunId: currentRunId,
          provider: runProvider,
          scope: isGlobalRun ? 'global' : 'workspace',
          ...(isGlobalRun ? {} : { workspace: runWorkspace!.path }),
          userInput: request.prompt,
          selectedModelType: request.selectedModelType,
          customModel: request.customModel,
          overrideModel: request.overrideModel,
          approvalMode: request.approvalMode,
          sessionTrust: request.sessionTrust,
          imageAttachments: request.imageAttachments,
          externalPathGrants: request.externalPathGrants,
          geminiWorktree: runWorktree,
          codexReasoningEffort: request.codexReasoningEffort,
          codexServiceTier: request.codexServiceTier,
          claudeReasoningEffort: request.claudeReasoningEffort,
          claudeFastMode: request.claudeFastMode,
          kimiThinkingEnabled: request.kimiThinkingEnabled,
          runtimeProfileId: request.runtimeProfileId,
          geminiAuthProfileId: request.geminiAuthProfileId,
          handoffSourceRunId: request.handoffSourceRunId,
          chatSnapshot: runChat
        })
      } catch (error) {
        // Diagnostic fix (send-message regression investigation, 2026-05-16):
        // Previously this catch wrote only to the Inspector raw log, which a
        // user without the Inspector tab open never sees — producing the
        // exact "clicking Send does nothing" symptom that was reported.
        // Surface the failure as an error-role chat message + a queue-job
        // failure, mirroring the runAgent catch at lines 6513-6523. This
        // does not fix any underlying composeRun bug — it makes one visible.
        const message = `Failed to compose ${getProviderLabel(runProvider)} run: ${redactLog(String(error))}`
        updateRunQueueJobStatus(currentRunId, 'failed', 'Run payload composition failed.', message)
        appendThreadRawLog(runChat.appChatId, { type: 'stderr', content: message })
        updateChatById(runChat.appChatId, (source) => ({
          ...source,
          messages: [
            ...source.messages,
            {
              id: createMessageId(),
              role: 'error',
              content: message,
              timestamp: new Date().toISOString()
            }
          ]
        }))
        return
      }
      const composerMetadata = composedPayload.composer
      const finalPrompt = composerMetadata.finalPrompt
      const displayFinalPrompt = request.displayPrompt ? request.displayPrompt : finalPrompt
      const modelToPass =
        composedPayload.model ||
        request.overrideModel ||
        (request.selectedModelType === 'custom'
          ? request.customModel.trim()
          : request.selectedModelType)
      const modeToPass = composerMetadata.approvalMode
      const resumeSessionId = composedPayload.providerSessionId || undefined
      const geminiResumeSkippedReason = composerMetadata.geminiResumeSkippedReason
      const contextTurnsForRun = composerMetadata.contextTurnsApplied
      const contextualPrompt = composedPayload.prompt
      const contextApplicationLog = composerMetadata.applicationLog

      activeScheduledTaskIdRef.current = request.scheduledTaskId || null
      const chatToUpdate = { ...runChat, provider: runProvider }
      if (composerMetadata.clearLinkedGeminiSession) {
        chatToUpdate.linkedGeminiSessionId = undefined
      }
      const selectedChatIdAtRunStart = currentChatIdRef.current || currentChat?.appChatId || null
      const isRunVisibleAtStart = selectedChatIdAtRunStart === chatToUpdate.appChatId
      if (isRunVisibleAtStart) {
        setRunCompleteNotice(null)
        setRunDiff(null)
        setPendingPlanChoice(null)
        setIsThinking(true)
      }

      if (chatToUpdate.messages.length === 0) {
        chatToUpdate.title =
          displayFinalPrompt.length > 30
            ? displayFinalPrompt.substring(0, 30) + '...'
            : displayFinalPrompt
      }

      let runStartedAt = new Date().toISOString()
      let promptMessageId: string | undefined
      if (!request.existingPrompt) {
        const imageAttachmentMetadata = request.imageAttachments
          .map((attachment) => ({
            id: attachment.id,
            path: attachment.path,
            name: attachment.name || getImageName(attachment.path)
          }))
          .filter((attachment) => Boolean(attachment.path))
        const userMessage: ChatMessage = {
          id: createMessageId(),
          role: 'user',
          content: displayFinalPrompt,
          timestamp: runStartedAt,
          ...(imageAttachmentMetadata.length
            ? { metadata: { imageAttachments: imageAttachmentMetadata } }
            : {})
        }
        promptMessageId = userMessage.id
        chatToUpdate.messages = [...chatToUpdate.messages, userMessage]
      } else {
        const lastUserMessage = [...chatToUpdate.messages]
          .reverse()
          .find((message) => message.role === 'user')
        runStartedAt = lastUserMessage?.timestamp || runStartedAt
        promptMessageId = lastUserMessage?.id
      }
      activeRunChatIdRef.current = chatToUpdate.appChatId
      activeRunIdRef.current = currentRunId
      activeRunWorkspacePathRef.current = runDiffWorkspacePath || null
      activeRunStartedAtRef.current = runStartedAt
      activeRunDiffUnavailableRef.current = runDiffUnavailable
      const newRun: ChatRun = {
        runId: currentRunId,
        provider: runProvider,
        startedAt: runStartedAt,
        promptMessageId,
        rawEventsFile: `run-events/${currentRunId}.jsonl`,
        requestedModel: modelToPass,
        approvalMode: modeToPass,
        runtimeProfileId: request.runtimeProfileId,
        handoffSourceRunId: request.handoffSourceRunId,
        ...(runProvider !== 'gemini' && resumeSessionId
          ? { providerThreadId: resumeSessionId }
          : {}),
        ...(runWorktree ? { geminiWorktree: runWorktree } : {}),
        ...(runDiffWorkspacePath ? { effectiveWorkspacePath: runDiffWorkspacePath } : {}),
        ...(runDiffUnavailable ? { diffUnavailableReason: WORKTREE_DIFF_UNAVAILABLE_TEXT } : {}),
        ...(composedPayload.geminiAuthProfileId
          ? { geminiAuthProfileId: composedPayload.geminiAuthProfileId }
          : {})
      }
      chatToUpdate.runs = [...(chatToUpdate.runs || []), newRun]
      if (composerMetadata.providerMetadataPatch) {
        chatToUpdate.providerMetadata = {
          ...(chatToUpdate.providerMetadata || {}),
          ...composerMetadata.providerMetadataPatch
        }
      }
      if (composerMetadata.uiNoticeMessage) {
        setChatContextNotice({
          id: `${Date.now()}-${composerMetadata.codexHandoffApplied?.handoffKey || 'context'}`,
          message: composerMetadata.uiNoticeMessage
        })
      }

      const runChatId = chatToUpdate.appChatId
      activeRunChatSnapshotRef.current = chatToUpdate
      chatByIdRef.current.set(runChatId, chatToUpdate)
      setRunningChatIds((prev) => {
        const next = new Set(prev)
        next.add(runChatId)
        return next
      })
      if (isRunVisibleAtStart) {
        setCurrentChat(chatToUpdate)
      }
      setChats((prev) => {
        const index = prev.findIndex((chat) => chat.appChatId === runChatId)
        if (index < 0) return [chatToUpdate, ...prev]
        return prev.map((chat) => (chat.appChatId === runChatId ? chatToUpdate : chat))
      })
      window.api.saveChat(chatToUpdate)
      appendDurableRunEvent({
        runId: currentRunId,
        chatId: runChatId,
        workspaceId: isGlobalRun ? undefined : chatToUpdate.workspaceId,
        workspacePath: isGlobalRun ? undefined : runWorkspace!.path,
        provider: runProvider,
        kind: 'lifecycle',
        phase: 'control',
        source: 'renderer',
        summary: `Run requested for ${getProviderLabel(runProvider)}`,
        payload: {
          promptMessageId,
          requestedModel: modelToPass,
          approvalMode: modeToPass,
          contextTurns: contextTurnsForRun,
          workspacePath: isGlobalRun ? undefined : runWorkspace!.path,
          effectiveWorkspacePath: runDiffWorkspacePath,
          diffUnavailable: runDiffUnavailable,
          scheduledTaskId: request.scheduledTaskId || null,
          runtimeProfileId: request.runtimeProfileId || null,
          handoffSourceRunId: request.handoffSourceRunId || null
        }
      })

      const initialRawLogs: RawLogEntry[] = [
        { type: 'info', content: contextApplicationLog },
        { type: 'info', content: `Exact prompt being sent: ${contextualPrompt}` },
        { type: 'info', content: `Requested model: ${modelToPass}` },
        { type: 'info', content: `Approval Mode: ${modeToPass}` },
        ...(geminiResumeSkippedReason
          ? [{ type: 'info' as const, content: geminiResumeSkippedReason }]
          : []),
        ...(resumeSessionId
          ? [
              {
                type: 'info' as const,
                content: `Resuming ${getProviderLabel(runProvider)} session: ${resumeSessionId}`
              }
            ]
          : []),
        ...(runWorktree?.enabled
          ? [
              {
                type: 'info' as const,
                content: `Gemini worktree: ${runWorktree.name || 'enabled'}${runDiffWorkspacePath ? ` (diff path: ${runDiffWorkspacePath})` : ' (effective path unknown; Diff Studio disabled)'}`
              }
            ]
          : [])
      ]
      setThreadRawLogs(runChatId, initialRawLogs)
      triggerFxBurst('run-start')
      setIsRunning(true)
      setDiffRefreshStatus('')

      let preSnapshot: any = null
      try {
        if (runDiffUnavailable) {
          setDiff(createWorktreeDiffUnavailable())
          setDiffView('workspace')
          setDiffRefreshStatus('Diff disabled: worktree path unknown.')
        } else if (runDiffWorkspacePath) {
          preSnapshot = await window.api.captureSnapshot(runDiffWorkspacePath)
        }
      } catch {
        preSnapshot = null
      }
      preSnapshotRef.current = preSnapshot

      const isVisibleRunChat = () => currentChatIdRef.current === runChatId
      const runContext = {} as ActiveRunContext
      const durableKindForAdapterEvent = (event: NormalizedEvent): RunEventInput['kind'] => {
        if (event.type === 'tool_event') return 'tool'
        if (event.type === 'assistant_message_complete') return 'final_message'
        if (event.type === 'run_started' || event.type === 'run_finished') return 'lifecycle'
        return 'timeline'
      }
      const durableSummaryForAdapterEvent = (event: NormalizedEvent): string => {
        if (event.type === 'tool_event')
          return `Tool ${event.isResult ? 'result' : 'event'}: ${event.name || event.data?.tool_name || event.data?.toolName || 'unknown'}`
        if (event.type === 'assistant_message_complete') return 'Assistant final message'
        if (event.type === 'assistant_message_delta') return 'Assistant message delta'
        if (event.type === 'run_started')
          return `Provider run started${event.model ? `: ${event.model}` : ''}`
        if (event.type === 'run_finished')
          return `Provider run finished: ${event.status || 'unknown'}`
        if (event.type === 'raw_event')
          return `Raw event${event.data?.type ? `: ${event.data.type}` : ''}`
        if (event.type === 'malformed_json') return 'Malformed provider JSON'
        if (event.type === 'error') return event.message || 'Provider error'
        return event.type
      }
      const durablePayloadForAdapterEvent = (event: NormalizedEvent): unknown => {
        if (event.type === 'raw_event') {
          return {
            type: event.data?.type,
            preview: redactLog(JSON.stringify(event.data, null, 2))
          }
        }
        if (event.type === 'malformed_json') {
          return {
            text: redactLog(event.text)
          }
        }
        return event
      }
      const adapter = new GeminiStreamAdapter((event: NormalizedEvent) => {
        appendDurableRunEvent({
          runId: currentRunId,
          chatId: runChatId,
          workspaceId: isGlobalRun ? undefined : chatToUpdate.workspaceId,
          workspacePath: isGlobalRun ? undefined : runWorkspace!.path,
          provider: runProvider,
          kind: durableKindForAdapterEvent(event),
          phase: 'normalized',
          source: 'renderer',
          summary: durableSummaryForAdapterEvent(event),
          payload: durablePayloadForAdapterEvent(event)
        })

        if (event.type === 'raw_event') {
          const redacted = redactLog(JSON.stringify(event.data, null, 2))
          handleGeminiCapacityExhaustion(
            runProvider,
            runContext,
            redacted,
            runChatId,
            isVisibleRunChat()
          )
          const permissionRequest = parseGeminiPermissionRequest(event.data)
          if (permissionRequest && isVisibleRunChat()) {
            showAttachmentPermissionRequest({
              ...permissionRequest,
              message: redactLog(permissionRequest.message)
            })
          }
          const exitMatch = redacted.match(/Process exited with code\s+(\d+)/i)
          if (exitMatch) {
            const exitCode = Number(exitMatch[1])
            if (exitCode === 0 && isVisibleRunChat()) {
              // Skip per-participant notice for ensemble (round-level
              // effect handles it). Same reasoning as the main exit
              // handler above.
              const runChat = chatByIdRef.current.get(runChatId)
              if (runChat?.chatKind !== 'ensemble') {
                setRunCompleteNotice({
                  timestamp: new Date().toISOString(),
                  exitCode,
                  startedAt: runContext.startedAt || undefined
                })
              }
              return
            }
          }
          const isTool =
            event.data.type === 'tool_use' ||
            event.data.type === 'tool_result' ||
            [
              'update_topic',
              'invoke_agent',
              'summary',
              'intent',
              'progress',
              'tool_progress'
            ].includes(String(event.data.type || ''))
          appendThreadRawLog(runChatId, { type: isTool ? 'tool' : 'stdout', content: redacted })
          return
        }
        if (event.type === 'malformed_json') {
          appendThreadRawLog(runChatId, { type: 'stdout', content: redactLog(event.text) })
          return
        }

        updateChatById(runChatId, (source) => {
          const updated = { ...source }

          // Steer suppression: while the user has clicked Steer and the
          // cancel is in flight, drop in-flight assistant content so the
          // provider's farewell wrap-up doesn't pollute the transcript
          // with a mid-flow "final summary." See `handleSteer`.
          const isSteerSuppressed =
            (event.type === 'assistant_message_delta' ||
              event.type === 'assistant_message_complete') &&
            steerSuppressionChatIdsRef.current.has(runChatId)
          if (isSteerSuppressed) {
            return updated
          }

          if (event.type === 'user_message') {
            // Handled manually before run
          } else if (event.type === 'assistant_message_delta') {
            if (isVisibleRunChat()) setIsThinking(false)
            // Phase K-followup — H2 garbling fix. Codex interleaves
            // reasoning + tool-call events between content deltas. The
            // naive `last = messages[length-1]` would see the tool
            // message that just got appended and route the next content
            // delta to the `else` branch, creating a NEW assistant
            // bubble. Result: one logical assistant turn split across
            // multiple bubbles with content fragments visually lost.
            // Scan BACKWARD for the last assistant message, allowing
            // tool messages to "pass through" without breaking the
            // merge. Stop on user/system/error (a real conversation
            // boundary that should end the merge).
            let lastAssistantIdx = -1
            for (let i = updated.messages.length - 1; i >= 0; i--) {
              const candidate = updated.messages[i]
              if (candidate.role === 'assistant') {
                lastAssistantIdx = i
                break
              }
              if (candidate.role === 'tool') continue
              break
            }
            const last = lastAssistantIdx >= 0 ? updated.messages[lastAssistantIdx] : null
            // Phase K2 (b) — merge-with-separator. When Codex emits a new
            // `agentMessage` item within the same turn (different `itemId`
            // than the message we're streaming into), the deltas would
            // otherwise concatenate seamlessly and the body + summary
            // would visually merge into one continuous paragraph. We
            // insert a horizontal-rule separator at the item boundary so
            // the user can SEE where one item ended and the next began,
            // without the larger UX shift of splitting into two bubbles
            // (parked as Phase K3 if it ever becomes worth the change).
            const incomingItemId = (event as { itemId?: unknown }).itemId
            const incomingItemIdStr =
              typeof incomingItemId === 'string' && incomingItemId ? incomingItemId : undefined
            if (last && last.role === 'assistant') {
              // 1.0.6 dup-fix — idempotent merge. Claude (a cumulative
              // `assistant` envelope that diverged from the streamed
              // deltas, tagged `cumulative` by main) and Cursor (each
              // `assistant` frame is a full cumulative snapshot) can
              // deliver the WHOLE turn as one content event. A blind
              // append would then double/triple the bubble, so decide
              // append vs replace vs skip. Genuine increments — and new
              // Codex items — still take the append branch below unchanged.
              const merge = resolveAssistantDeltaMerge(last.content, event.content, {
                cumulative: event.cumulative === true
              })
              if (merge.action === 'skip') {
                // Stale/duplicate re-statement we already render in full —
                // leave the bubble untouched.
              } else if (merge.action === 'replace') {
                updated.messages = [
                  ...updated.messages.slice(0, lastAssistantIdx),
                  { ...last, content: merge.content },
                  ...updated.messages.slice(lastAssistantIdx + 1)
                ]
              } else {
                const lastItemId =
                  typeof last.metadata?.codexItemId === 'string'
                    ? last.metadata.codexItemId
                    : undefined
                const itemTransition =
                  incomingItemIdStr !== undefined &&
                  lastItemId !== undefined &&
                  incomingItemIdStr !== lastItemId &&
                  last.content.length > 0
                const separator = itemTransition ? '\n\n---\n\n' : ''
                const nextMetadata = incomingItemIdStr
                  ? { ...(last.metadata ?? {}), codexItemId: incomingItemIdStr }
                  : last.metadata
                // Replace the assistant message in-place at its actual
                // index (may not be `length - 1` when tool messages are
                // interleaved). Tool messages between this assistant and
                // the array end stay in place.
                updated.messages = [
                  ...updated.messages.slice(0, lastAssistantIdx),
                  {
                    ...last,
                    content: last.content + separator + event.content,
                    metadata: nextMetadata
                  },
                  ...updated.messages.slice(lastAssistantIdx + 1)
                ]
              }
            } else {
              const metadata = incomingItemIdStr ? { codexItemId: incomingItemIdStr } : undefined
              updated.messages = [
                ...updated.messages,
                {
                  id: createMessageId(),
                  role: 'assistant',
                  content: event.content,
                  timestamp: new Date().toISOString(),
                  ...(metadata ? { metadata } : {})
                }
              ]
            }
          } else if (event.type === 'assistant_message_complete') {
            if (isVisibleRunChat()) setIsThinking(false)
            const isPlanMode = updated.runs?.[updated.runs.length - 1]?.approvalMode === 'plan'
            const parsedChoice = parsePlanModeChoice(event.content)
            const last = updated.messages[updated.messages.length - 1]
            const assistantMessageId =
              last && last.role === 'assistant' ? last.id : createMessageId()

            if (last && last.role === 'assistant') {
              updated.messages = [
                ...updated.messages.slice(0, -1),
                { ...last, content: event.content }
              ]
            } else {
              updated.messages = [
                ...updated.messages,
                {
                  id: assistantMessageId,
                  role: 'assistant',
                  content: event.content,
                  timestamp: new Date().toISOString()
                }
              ]
            }
            const resetHints = extractResetHintsFromText(event.content)
            for (const hint of resetHints) {
              const key = normalizeModelName(hint.model)
              const existing = runContext.usageResetHints.get(key) || {}
              runContext.usageResetHints.set(key, mergeUsageReset(existing, hint))
            }
            if (resetHints.length > 0) {
              Promise.all(
                resetHints.map((hint) =>
                  window.api.recordUsage({
                    provider: runProvider,
                    workspaceId: getUsageWorkspaceIdForChat(updated) || GLOBAL_USAGE_WORKSPACE_ID,
                    chatId: updated.appChatId,
                    runId: currentRunId,
                    usageKind: 'reset_hint',
                    model: hint.model,
                    inputTokens: 0,
                    outputTokens: 0,
                    totalTokens: 0,
                    resetAt: hint.resetAt,
                    resetText: hint.resetText,
                    durationMs: 0
                  })
                )
              ).then(() => {
                const usageWorkspaceId = getUsageWorkspaceIdForChat(updated)
                if (
                  usageWorkspaceId &&
                  (currentWorkspaceIdRef.current === usageWorkspaceId || isGlobalChat(updated))
                ) {
                  void refreshUsageSummary(usageWorkspaceId)
                }
              })
            }
            if (isVisibleRunChat() && isPlanMode && parsedChoice) {
              setPendingPlanChoice({
                messageId: assistantMessageId,
                question: parsedChoice.question,
                options: parsedChoice.options
              })
            } else if (isVisibleRunChat()) {
              setPendingPlanChoice(null)
            }
          } else if (event.type === 'run_started') {
            const sessionId = normalizeGeminiResumeTarget(event.session_id)
            if (sessionId && (runProvider !== 'gemini' || !event.fallback)) {
              if (runProvider !== 'gemini') {
                updated.linkedProviderSessionId = sessionId
              } else {
                updated.linkedGeminiSessionId = sessionId
              }
            }
            const runs = [...(updated.runs || [])]
            if (runs.length > 0) {
              runs[runs.length - 1].actualModel = event.model
              if (runProvider !== 'gemini') {
                runs[runs.length - 1].providerThreadId =
                  sessionId || runs[runs.length - 1].providerThreadId
              }
            }
            updated.runs = runs
          } else if (event.type === 'run_finished') {
            if (isVisibleRunChat()) setIsThinking(false)
            const runs = [...(updated.runs || [])]
            const finishedSessionId = normalizeGeminiResumeTarget(event.providerThreadId)
            if (finishedSessionId && runProvider !== 'gemini') {
              updated.linkedProviderSessionId = finishedSessionId
            }
            const resolvedRunModel =
              runs.length > 0
                ? runs[runs.length - 1].actualModel ||
                  runs[runs.length - 1].requestedModel ||
                  'unknown'
                : 'unknown'
            const runUsageEntries = extractModelUsageEntriesFromStats(
              event.stats || {},
              resolvedRunModel
            )

            if (runs.length > 0) {
              runs[runs.length - 1].status = event.status
              runs[runs.length - 1].stats = event.stats
              runs[runs.length - 1].endedAt = new Date().toISOString()
              if (finishedSessionId && runProvider !== 'gemini') {
                runs[runs.length - 1].providerThreadId = finishedSessionId
              }
            }
            updated.runs = runs

            const runDurationMs = Math.max(
              0,
              extractUsageCount(event.stats, [['duration_ms'], ['durationMs']])
            )

            const usageAlreadyRecorded = Boolean(event.stats?._taskwraith_usage_recorded)
            const usageRecordPromises = usageAlreadyRecorded
              ? []
              : runUsageEntries.map((usageEntry) => {
                  const {
                    model,
                    inputTokens,
                    outputTokens,
                    totalTokens,
                    inputTokenLimit,
                    outputTokenLimit,
                    totalTokenLimit,
                    resetAt,
                    resetText,
                    durationMs: entryDurationMs
                  } = usageEntry
                  const resetHint = runContext.usageResetHints.get(normalizeModelName(model)) || {}
                  const mergedReset = mergeUsageReset({ resetAt, resetText }, resetHint)

                  return window.api.recordUsage({
                    provider: runProvider,
                    workspaceId: getUsageWorkspaceIdForChat(updated) || GLOBAL_USAGE_WORKSPACE_ID,
                    chatId: updated.appChatId,
                    runId: currentRunId,
                    usageKind: 'run',
                    model,
                    inputTokens,
                    outputTokens,
                    totalTokens,
                    inputTokenLimit,
                    outputTokenLimit,
                    totalTokenLimit,
                    resetAt: mergedReset.resetAt,
                    resetText: mergedReset.resetText,
                    durationMs: entryDurationMs ?? runDurationMs,
                    promptText: contextualPrompt,
                    responseText:
                      updated.messages[updated.messages.length - 1]?.role === 'assistant'
                        ? updated.messages[updated.messages.length - 1].content
                        : undefined
                  })
                })

            Promise.all(usageRecordPromises).then(() => {
              const usageWorkspaceId = getUsageWorkspaceIdForChat(updated)
              if (
                usageWorkspaceId &&
                (currentWorkspaceIdRef.current === usageWorkspaceId || isGlobalChat(updated))
              ) {
                void refreshUsageSummary(usageWorkspaceId)
              }
            })
          } else if (event.type === 'tool_event') {
            if (
              updated.messages.length === 0 ||
              updated.messages[updated.messages.length - 1].role !== 'tool'
            ) {
              updated.messages = [
                ...updated.messages,
                {
                  id: createMessageId(),
                  role: 'tool',
                  content: '',
                  timestamp: new Date().toISOString(),
                  toolActivities: []
                }
              ]
            }

            const lastMsgIndex = updated.messages.length - 1
            const lastMsg = updated.messages[lastMsgIndex]
            const acts = [...(lastMsg.toolActivities || [])]

            const tData = event.data
            const isUse = event.isUse || isToolUseEvent(tData)
            const isResult = event.isResult || isToolResultEvent(tData)
            if (isProviderExecutionToolEvent(event)) {
              runContext.toolCallsCount += 1
            }
            const tId =
              event.data?.tool_id ||
              event.data?.toolId ||
              event.data?.id ||
              event.data?.call_id ||
              `unknown-${Date.now()}`
            let latestToolActivity: ToolActivity | null = null

            if (isUse) {
              const newActivity = createToolActivity(tData)
              acts.push(newActivity)
              latestToolActivity = newActivity
            } else if (isResult) {
              const idx = acts.findIndex((a) => a.id === tId)
              if (idx >= 0) {
                acts[idx] = pairToolResult(acts[idx], tData)
                latestToolActivity = acts[idx]
              } else {
                // Orphan result: create a minimal activity for it
                const orphan = createToolActivity({
                  type: 'tool_use',
                  tool_id: tId,
                  tool_name: event.name || 'unknown'
                })
                const paired = pairToolResult(orphan, tData)
                acts.push(paired)
                latestToolActivity = paired
              }
            } else {
              // Fallback for unstructured tools
              const fallback = createToolActivity({
                type: 'tool_use',
                tool_id: tId,
                tool_name: event.name || 'unknown',
                ...tData
              })
              fallback.status = 'success'
              acts.push(fallback)
              latestToolActivity = fallback
            }

            if (
              isVisibleRunChat() &&
              !runContext.diffUnavailable &&
              latestToolActivity &&
              isResult
            ) {
              upsertRunDiffFromTool(latestToolActivity, runContext.workspacePath)
            }

            updated.messages = [
              ...updated.messages.slice(0, lastMsgIndex),
              { ...lastMsg, toolActivities: acts }
            ]
          } else if (event.type === 'error') {
            updated.messages = [
              ...updated.messages,
              {
                id: createMessageId(),
                role: 'error',
                content: event.message,
                timestamp: new Date().toISOString()
              }
            ]
          }

          return updated
        })
      })
      Object.assign(runContext, {
        runId: currentRunId,
        chatId: runChatId,
        provider: runProvider,
        adapter,
        warnings: currentRunWarningsRef.current,
        usageResetHints: activeRunUsageResetHintsRef.current,
        errorCount: errorCountRef.current,
        toolCallsCount: toolCallsCountRef.current,
        preSnapshot,
        baseWorkspacePath: isGlobalRun ? null : runWorkspace!.path,
        workspacePath: runDiffWorkspacePath || null,
        workspaceId: isGlobalRun ? undefined : runWorkspace!.id,
        worktree: runWorktree,
        checkpointingEnabled: runProvider === 'gemini' ? geminiCheckpointingEnabled : false,
        startedAt: runStartedAt,
        diffUnavailable: runDiffUnavailable,
        scheduledTaskId: request.scheduledTaskId || null
      })
      activeRunsRef.current.set(currentRunId, runContext)
      adapterRef.current = adapter
      syncRunningState()

      if (!request.existingPrompt && !request.preserveComposer) {
        setChatPromptDraft(runChatId, '')
        clearComposerAttachmentsForSubmittedRequest(request)
      }
      try {
        if (
          runProvider === 'codex' &&
          request.codexNativeReview &&
          resumeSessionId &&
          typeof window.api.startAgentReview === 'function'
        ) {
          await window.api.startAgentReview('codex', resumeSessionId, {
            model: modelToPass,
            target: { type: 'uncommittedChanges' },
            delivery: 'inline',
            cwd: runWorkspace!.path,
            appRunId: currentRunId,
            appChatId: runChatId
          })
        } else {
          await window.api.runAgent(composedPayload)
        }
      } catch (error) {
        clearActiveRunContext(runContext)
        const message = `Failed to start ${getProviderLabel(runProvider)}: ${redactLog(String(error))}`
        updateRunQueueJobStatus(
          currentRunId,
          'failed',
          'Provider process failed before startup completed.',
          message
        )
        appendThreadRawLog(runChatId, { type: 'stderr', content: message })
        updateChatById(runChatId, (source) => ({
          ...source,
          messages: [
            ...source.messages,
            {
              id: createMessageId(),
              role: 'error',
              content: message,
              timestamp: new Date().toISOString()
            }
          ],
          runs: source.runs.map((run) =>
            run.runId === currentRunId
              ? { ...run, status: 'failed', endedAt: new Date().toISOString() }
              : run
          )
        }))
      }
      setChats(await window.api.getChats())
    } catch (error) {
      // Last line of defense — any uncaught exception in the function
      // body (between the inner try/catches that wrap composeRun + the
      // runAgent dispatch) surfaces here. Without this catch the void
      // promise rejection vanishes silently.

      console.warn('[executeRun] uncaught exception:', error)
      const message = `Run execution failed unexpectedly: ${redactLog(String(error))}`
      const chatId = runRequest?.chatRecord?.appChatId || currentChat?.appChatId
      if (chatId) {
        appendThreadRawLog(chatId, { type: 'stderr', content: message })
        updateChatById(chatId, (source) => ({
          ...source,
          messages: [
            ...source.messages,
            {
              id: createMessageId(),
              role: 'error',
              content: message,
              timestamp: new Date().toISOString()
            }
          ]
        }))
      }
    }
  }

  const executeRunRef = useRef(executeRun)
  executeRunRef.current = executeRun

  const handleReviewCurrentDiff = async () => {
    if (!currentWorkspace || !currentChat || isPreparingDiffReview) {
      return
    }

    setIsPreparingDiffReview(true)

    try {
      const diffObj = await window.api.getDiff(currentWorkspace.path)
      setDiff(diffObj)
      setDiffView('workspace')
      setRightTab('diff')

      // 1.0.4-AT5 — surface a clear distinction between Codex's
      // native `/review` (only fires when the solo path resumes a
      // linked Codex thread via `startAgentReview`) and the
      // ensemble-mode prompt-based review (which runs as a panel
      // discussion of the diff through `runEnsembleRound`, with no
      // native review invocation). Pre-AT5 there was no signal that
      // these two paths produced different behavior — users
      // assumed Ensemble `/review` had the same correctness
      // guarantees as Codex's solo native review and were surprised
      // when the panel's output differed.
      if (isCurrentEnsembleChat) {
        setRawLogs((prev) => [
          ...prev,
          {
            type: 'info',
            content:
              'Ensemble /review: runs as a panel discussion of the diff (prompt-only). ' +
              'Native Codex review only fires in solo Codex chats with a linked thread.'
          }
        ])
      }

      // 1.0.4-AT5 — `codexNativeReview` only fires for solo Codex
      // chats. In Ensemble the dispatch goes through
      // `runEnsembleRound` (see `executeRun`'s chatKind branch),
      // which ignores this flag — every participant gets the same
      // diff as a prompt and reviews it in their role. The flag
      // is kept on the request so the downstream
      // `formatReviewRequestPrompt` / activity-categorization paths
      // can still tag the run as a "review" intent.
      const reviewRequest: QueuedRunRequest = {
        provider: currentProvider,
        prompt: buildReviewCurrentDiffPrompt(diffObj),
        displayPrompt: '/review current diff',
        selectedModelType,
        customModel,
        approvalMode: 'plan',
        sessionTrust,
        imageAttachments: [],
        codexNativeReview:
          currentProvider === 'codex' &&
          !isCurrentEnsembleChat &&
          Boolean(currentChat?.linkedProviderSessionId),
        workspaceRecord: currentWorkspace,
        chatRecord: currentChat
      }

      if (isChatBusy(reviewRequest.chatRecord?.appChatId)) {
        queueRunRequest(
          reviewRequest,
          `Diff review is waiting for this chat's active ${getProviderLabel(reviewRequest.provider)} task to exit.`
        )
        setDiffRefreshStatus('Diff review queued.')
        return
      }

      void executeRun(reviewRequest)
    } catch (error) {
      setDiffRefreshStatus('Diff review failed to prepare.')
      setRawLogs((prev) => [
        ...prev,
        { type: 'info', content: `Failed to prepare diff review: ${redactLog(String(error))}` }
      ])
    } finally {
      setIsPreparingDiffReview(false)
    }
  }

  const handleRun = (
    overrideModel?: string,
    existingPrompt?: string,
    /**
     * A2 (1.0.3) — DM routing. When set, the resulting dispatch
     * scopes the ensemble round to just this participant via the
     * orchestrator's `dmTargetParticipantId`. Ignored on solo chats.
     * Plumbed onto the request envelope (not chat-level state)
     * because each dispatch is an independent decision.
     */
    dmTargetParticipantId?: string
  ) => {
    const baseRequest = buildRunRequest(overrideModel, existingPrompt)
    const request = dmTargetParticipantId ? { ...baseRequest, dmTargetParticipantId } : baseRequest
    if (!request.prompt.trim()) {
      return
    }

    if (isChatBusy(request.chatRecord?.appChatId || currentChat?.appChatId)) {
      queueRunRequest(request)
      clearComposerAttachmentsForSubmittedRequest(request)
      if (!request.existingPrompt) {
        setChatPromptDraft(
          request.chatRecord?.appChatId || currentChatIdRef.current || currentChat?.appChatId,
          ''
        )
      }
      return
    }

    void executeRun(request)
  }

  const createSideChatFromCurrentChat = async (
    seedPrompt = '',
    clearParentDraft = false,
    presentation: SidePanelPresentation = 'split',
    seedContext: SideChatSeedContext = {},
    mode?: SideChatCreateMode
  ): Promise<ChatRecord | null> => {
    const parentChat = currentChat
    if (!parentChat) return null
    try {
      const parentProvider = getChatProvider(parentChat)
      const sideChatMode: SideChatCreateMode =
        mode || (parentChat.chatKind === 'ensemble' ? 'ensembleClone' : 'singleProvider')
      const selectedSideParticipant =
        sideChatMode === 'singleProvider' && parentChat.chatKind === 'ensemble'
          ? selectedParticipant ||
            parentChat.ensemble?.participants.find((participant) => participant.enabled) ||
            parentChat.ensemble?.participants[0] ||
            null
          : null
      const sideProvider = selectedSideParticipant?.provider || parentProvider
      const sideParticipantLabel = selectedSideParticipant
        ? selectedSideParticipant.role || getProviderLabel(selectedSideParticipant.provider)
        : getProviderLabel(sideProvider)
      const createdSideChat = await window.api.createSideChat({
        parentChatId: parentChat.appChatId,
        chatKind: sideChatMode === 'singleProvider' ? 'single' : 'ensemble',
        provider: sideProvider,
        sideChatMode,
        originMessageId: seedContext.originMessageId,
        originRunId: seedContext.originRunId,
        title:
          sideChatMode === 'fanOut'
            ? `Fan-out side chat from ${parentChat.title || 'ensemble chat'}`
            : sideChatMode === 'ensembleClone'
              ? `Side ensemble from ${parentChat.title || 'ensemble chat'}`
              : `Side ${sideParticipantLabel} chat from ${
                  parentChat.title || getProviderLabel(parentProvider)
                }`
      })
      let nextSideChat = createdSideChat
      if (selectedSideParticipant) {
        const participantMetadata: Record<string, unknown> = {
          selectedModelType:
            selectedSideParticipant.model ||
            getDefaultModelForProvider(selectedSideParticipant.provider),
          customModel: '',
          approvalMode: permissionPresetToApprovalMode(selectedSideParticipant.permissionPresetId)
        }
        if (selectedSideParticipant.runtimeProfileId) {
          participantMetadata.runtimeProfileId = selectedSideParticipant.runtimeProfileId
        }
        if (
          selectedSideParticipant.provider === 'gemini' &&
          selectedSideParticipant.geminiAuthProfileId
        ) {
          participantMetadata.geminiAuthProfileId = selectedSideParticipant.geminiAuthProfileId
        }
        if (selectedSideParticipant.provider === 'codex') {
          participantMetadata.codexReasoningEffort =
            selectedSideParticipant.reasoningEffort || 'medium'
          participantMetadata.codexServiceTier =
            selectedSideParticipant.serviceTier ||
            (selectedSideParticipant.fastModeEnabled ? 'fast' : '')
        }
        if (selectedSideParticipant.provider === 'claude') {
          participantMetadata.claudeReasoningEffort =
            selectedSideParticipant.reasoningEffort || 'off'
          participantMetadata.claudeFastMode = Boolean(selectedSideParticipant.fastModeEnabled)
        }
        if (selectedSideParticipant.provider === 'kimi') {
          participantMetadata.kimiThinkingEnabled =
            selectedSideParticipant.thinkingEnabled ?? true
        }
        nextSideChat = {
          ...createdSideChat,
          provider: selectedSideParticipant.provider,
          providerMetadata: {
            ...(createdSideChat.providerMetadata || {}),
            ...participantMetadata
          },
          updatedAt: Date.now()
        }
        void window.api.saveChat(nextSideChat).catch(() => {})
      }
      chatByIdRef.current.set(nextSideChat.appChatId, nextSideChat)
      setChats((prev) => [
        nextSideChat,
        ...prev.filter((chat) => chat.appChatId !== nextSideChat.appChatId)
      ])
      setSidePanelPresentation(presentation)
      setSideChatId(nextSideChat.appChatId)
      setSideChatWidth(getStoredSideChatWidth(parentChat.appChatId))
      setShowFileEditor(false)
      appearance.update({ showInspector: false })
      setChatPromptDraft(nextSideChat.appChatId, seedPrompt)
      if (clearParentDraft) {
        setChatPromptDraft(parentChat.appChatId, '')
      }
      requestAnimationFrame(() => {
        sideComposerTextareaRef.current?.focus()
      })
      return nextSideChat
    } catch (error) {
      appendThreadRawLog(parentChat.appChatId, {
        type: 'stderr',
        content: `Failed to create side chat: ${redactLog(String(error))}`
      })
      return null
    }
  }

  const findReusableSideChatForCurrentChat = (
    mode?: SideChatCreateMode,
    provider?: ProviderId
  ): ChatRecord | null => {
    if (!currentChat?.appChatId) return null
    const linked = chats
      .filter(
        (chat) =>
          !chat.archived &&
          !isTerminatedSideChat(chat) &&
          chat.parentChatId === currentChat.appChatId &&
          chat.parentChatRelation === 'sideChat' &&
          (!mode || getSideChatMode(chat) === mode) &&
          (!provider || getChatProvider(chat) === provider)
      )
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
    return linked[0] || null
  }

  const openLinkedChatInSidePanel = (
    chat: ChatRecord,
    presentation: SidePanelPresentation = 'split',
    parentOverride?: ChatRecord | null
  ) => {
    const parentChat = parentOverride || currentChat
    if (!parentChat?.appChatId || chat.parentChatId !== parentChat.appChatId) return
    const nextChat =
      chat.parentChatRelation === 'sideChat' ? applySideChatLifecycle(chat, 'active') : chat
    chatByIdRef.current.set(nextChat.appChatId, nextChat)
    if (nextChat !== chat) {
      setChats((prev) => {
        const index = prev.findIndex((item) => item.appChatId === nextChat.appChatId)
        if (index < 0) return [nextChat, ...prev]
        return prev.map((item) => (item.appChatId === nextChat.appChatId ? nextChat : item))
      })
      void window.api.saveChat(nextChat).catch(() => {})
    }
    setSidePanelPresentation(presentation)
    setSideChatId(nextChat.appChatId)
    setSideChatWidth(getStoredSideChatWidth(parentChat.appChatId))
    setShowFileEditor(false)
    appearance.update({ showInspector: false })
    setSideChatMenuOpen(false)
    requestAnimationFrame(() => {
      sideComposerTextareaRef.current?.focus()
    })
  }
  const openLinkedChatInSidePanelRef = useRef(openLinkedChatInSidePanel)
  useEffect(() => {
    openLinkedChatInSidePanelRef.current = openLinkedChatInSidePanel
  })

  const ensureSideChatForCurrentChat = async (
    seedPrompt = '',
    clearParentDraft = false,
    presentation: SidePanelPresentation = 'split',
    seedContext: SideChatSeedContext = {},
    mode?: SideChatCreateMode
  ): Promise<ChatRecord | null> => {
    const parentChat = currentChat
    if (!parentChat) return null
    const sideChatMode =
      mode || (parentChat.chatKind === 'ensemble' ? 'ensembleClone' : 'singleProvider')
    const selectedSideProvider =
      sideChatMode === 'singleProvider' && parentChat.chatKind === 'ensemble'
        ? (
            selectedParticipant ||
            parentChat.ensemble?.participants.find((participant) => participant.enabled) ||
            parentChat.ensemble?.participants[0] ||
            null
          )?.provider
        : undefined
    const existing = findReusableSideChatForCurrentChat(sideChatMode, selectedSideProvider)
    if (existing) {
      openLinkedChatInSidePanel(existing, presentation)
      if (seedContext.originMessageId || seedContext.originRunId) {
        updateChatById(existing.appChatId, (source) => ({
          ...source,
          updatedAt: Date.now(),
          sideChatContext: {
            createdAt: source.sideChatContext?.createdAt || Date.now(),
            ...source.sideChatContext,
            ...(seedContext.originMessageId
              ? { originMessageId: seedContext.originMessageId }
              : {}),
            ...(seedContext.originRunId ? { originRunId: seedContext.originRunId } : {}),
            transcriptVisibility: seedContext.originMessageId
              ? 'selected'
              : seedContext.originRunId
                ? 'snapshot'
                : source.sideChatContext?.transcriptVisibility || 'none'
          }
        }))
      }
      if (seedPrompt) {
        setChatPromptDraft(existing.appChatId, seedPrompt)
      }
      if (clearParentDraft) {
        setChatPromptDraft(parentChat.appChatId, '')
      }
      return existing
    }
    return createSideChatFromCurrentChat(
      seedPrompt,
      clearParentDraft,
      presentation,
      seedContext,
      sideChatMode
    )
  }

  const popOutLinkedChat = (chat: ChatRecord) => {
    const wasInlinePresentation = sideChat?.appChatId === chat.appChatId
    writeChatPopoutHandoff(chat.appChatId, {
      draft: composerDraftsByChatId[chat.appChatId] || '',
      scrollState: captureChatScrollState(
        wasInlinePresentation
          ? sideTranscriptScrollRef.current
          : currentChat?.appChatId === chat.appChatId
            ? transcriptScrollRef.current
            : null
      )
    })
    void window.api.openWorkspacePopout({
      kind: 'chat',
      chatId: chat.appChatId,
      workspacePath: chat.workspacePath
    })
    if (wasInlinePresentation) {
      setSideChatId(null)
      setSideChatMenuOpen(false)
    }
  }

  const openCurrentSideChatPresentation = async (
    presentation: SidePanelPresentation | 'popout' | 'main',
    mode?: SideChatCreateMode
  ) => {
    setSideChatMenuOpen(false)
    const linkedChat = await ensureSideChatForCurrentChat(
      '',
      false,
      presentation === 'drawer' ? 'drawer' : 'split',
      {},
      mode
    )
    if (!linkedChat) return
    if (presentation === 'popout') {
      popOutLinkedChat(linkedChat)
      return
    }
    if (presentation === 'main') {
      void handleSelectChat(linkedChat)
    }
  }

  const handleOpenLinkedChatInSidePanelById = (
    chatId: string,
    presentation: SidePanelPresentation = 'split'
  ) => {
    const chat = chatByIdRef.current.get(chatId) || chats.find((item) => item.appChatId === chatId)
    if (!chat) return
    openLinkedChatInSidePanel(chat, presentation)
  }

  const handleOpenLinkedChatInSidePanelFromSidebar = async (chat: ChatRecord) => {
    const parentChat = chat.parentChatId
      ? chatByIdRef.current.get(chat.parentChatId) ||
        chats.find((item) => item.appChatId === chat.parentChatId) ||
        null
      : null
    if (!parentChat) return
    if (currentChat?.appChatId !== parentChat.appChatId) {
      await handleSelectChat(parentChat)
    }
    openLinkedChatInSidePanel(chat, 'split', parentChat)
  }

  useEffect(() => {
    if (isChatPopoutWindow || typeof window.api.onSideChatDockRequest !== 'function') return
    const unsubscribe = window.api.onSideChatDockRequest((request) => {
      void (async () => {
        const dockScrollState = normalizeChatScrollState(request.scrollState)
        let linkedChat =
          chatByIdRef.current.get(request.chatId) ||
          (await window.api.getChat(request.chatId)) ||
          null
        if (
          !linkedChat ||
          linkedChat.parentChatId !== request.parentChatId ||
          (linkedChat.parentChatRelation !== 'sideChat' &&
            linkedChat.parentChatRelation !== 'subThread')
        ) {
          return
        }
        const parentChat =
          chatByIdRef.current.get(request.parentChatId) ||
          (await window.api.getChat(request.parentChatId)) ||
          null
        if (!parentChat) return

        chatByIdRef.current.set(parentChat.appChatId, parentChat)
        chatByIdRef.current.set(linkedChat.appChatId, linkedChat)
        setChats((prev) => {
          let next = prev
          for (const record of [parentChat, linkedChat]) {
            const idx = next.findIndex((chat) => chat.appChatId === record.appChatId)
            if (idx < 0) {
              next = [record, ...next]
              continue
            }
            if (next === prev) next = prev.slice()
            next[idx] = record
          }
          return next
        })
        if (typeof request.draft === 'string') {
          setChatPromptDraft(linkedChat.appChatId, request.draft)
        }
        if (currentChatIdRef.current !== parentChat.appChatId) {
          await handleSelectChatRef.current(parentChat)
        }
        openLinkedChatInSidePanelRef.current(linkedChat, request.presentation, parentChat)
        if (dockScrollState) {
          sideAutoFollowRef.current = dockScrollState.atBottom
          restoreChatScrollState(sideTranscriptScrollRef.current, dockScrollState)
        }
      })()
    })
    return unsubscribe
  }, [isChatPopoutWindow, setChatPromptDraft])

  const handleSideRun = () => {
    if (!sideChat || !sidePrompt.trim()) return
    const request = buildRunRequest(undefined, undefined, {
      chat: sideChat,
      prompt: sidePrompt,
      imageAttachments: []
    })
    if (isChatBusy(sideChat.appChatId)) {
      queueRunRequest(request)
      setChatPromptDraft(sideChat.appChatId, '')
      return
    }
    void executeRun(request)
  }

  const handleSideCancel = async () => {
    if (!sideChat) return
    if (sideChat.chatKind === 'ensemble') {
      await window.api.cancelEnsembleRound(sideChat.appChatId)
      setChats(await window.api.getChats())
      return
    }
    let activeContext: ActiveRunContext | null = null
    for (const ctx of activeRunsRef.current.values()) {
      if (ctx.chatId === sideChat.appChatId) {
        activeContext = ctx
        break
      }
    }
    const sideRun = sideChat.runs?.[sideChat.runs.length - 1]
    await window.api.cancelAgentRun(sideProvider, activeContext?.runId || sideRun?.runId)
    syncRunningState()
  }

  const cancelQueuedSideChatRuns = (chatId: string) => {
    setQueuedRuns((prev) =>
      prev.filter((request) => {
        const requestChatId = request.chatRecord?.appChatId
        if (requestChatId !== chatId) return true
        if (request.appRunId) {
          updateRunQueueJobStatus(
            request.appRunId,
            'cancelled',
            'Side chat was ended before this queued run started.'
          )
        }
        return false
      })
    )
    for (const job of runQueueJobsRef.current) {
      if (job.chatId !== chatId || isTerminalRunQueueStatus(job.status)) continue
      updateRunQueueJobStatus(
        job.runId || job.id,
        'cancelled',
        'Side chat was ended before this queued run started.'
      )
    }
  }

  const hideSideChatPane = () => {
    const targetChat = sideChat
    if (targetChat?.parentChatRelation === 'sideChat') {
      updateChatById(targetChat.appChatId, (source) =>
        source.archived || isTerminatedSideChat(source)
          ? source
          : applySideChatLifecycle(source, 'closed')
      )
    }
    setSideChatId(null)
    setSideChatMenuOpen(false)
  }

  const handleTerminateSideChat = async () => {
    const targetChat = sideChat
    if (!targetChat || targetChat.parentChatRelation !== 'sideChat') return
    if (isChatBusy(targetChat.appChatId)) {
      await handleSideCancel()
    }
    cancelQueuedSideChatRuns(targetChat.appChatId)
    updateChatById(targetChat.appChatId, (source) => ({
      ...applySideChatLifecycle(source, 'terminated', 'ended_by_user'),
      archived: true
    }))
    hideSideChatPane()
  }

  /**
   * Phase J3 (steer): Codex-CLI-style "interrupt + dispatch this prompt".
   *
   * Sibling of `handleRun` (which queues when the chat is busy) and the
   * `handleCancel` stop-button (which only cancels). Steer combines the
   * two: cancel the active turn for this chat, wait up to ~5s for the
   * active-run context to clear, then dispatch the new prompt via the
   * normal `executeRun` path. On timeout we fall back to the queue
   * (better than dropping the user's prompt) and surface a system note.
   *
   * State transitions are pure (see `lib/steerState.ts`); this function
   * is the side-effecting harness around them.
   */
  const handleSteer = async (overrideModel?: string, existingPrompt?: string) => {
    const request = buildRunRequest(overrideModel, existingPrompt)
    if (!request.prompt.trim()) {
      return
    }

    const targetChatId = request.chatRecord?.appChatId || currentChat?.appChatId
    if (!targetChatId) {
      return
    }

    const targetChat = request.chatRecord || currentChat
    if (targetChat?.chatKind === 'ensemble') {
      await window.api.runEnsembleRound({
        chatId: targetChatId,
        prompt: request.prompt,
        mode: targetChat.ensemble?.activeRound?.status === 'running' ? 'steer' : 'normal',
        concurrentMode: Boolean(targetChat.ensemble?.concurrentModeEnabled),
        imageAttachments: request.imageAttachments.map((attachment) => ({
          id: attachment.id,
          path: attachment.path,
          name: attachment.name
        }))
      })
      clearComposerAttachmentsForSubmittedRequest(request)
      if (!request.existingPrompt) {
        setChatPromptDraft(targetChatId, '')
      }
      setIsThinking(true)
      setChats(await window.api.getChats())
      return
    }

    // Guard: if there's no active run for this chat, just dispatch
    // normally. The Steer button is only visible while `isChatBusy`
    // returns true, but the predicate can flip between render and
    // click (race with `agent-exit`), so handle that gracefully.
    if (!isChatBusy(targetChatId)) {
      void executeRun(request)
      clearComposerAttachmentsForSubmittedRequest(request)
      if (!request.existingPrompt) {
        setChatPromptDraft(targetChatId, '')
      }
      return
    }

    // Single-flight guard: a second steer click while one is in flight
    // is a no-op. The button is also visually disabled while
    // `isSteerInFlight` reports true; defence-in-depth.
    const liveState = steerStateRef.current
    if (isSteerInFlight({ state: liveState, chatId: targetChatId })) {
      return
    }

    // Find the active run context (used for the cancel-target runId
    // and the post-cancel poll predicate).
    let activeContext: ActiveRunContext | null = null
    for (const ctx of activeRunsRef.current.values()) {
      if (ctx.chatId === targetChatId) {
        activeContext = ctx
        break
      }
    }

    const providerLabel = getProviderLabel(request.provider)
    const cancelTargetRunId = activeContext?.runId

    // Enter `cancelling` phase + clear composer state up-front so the
    // user can't double-submit. The transcript gets a dispatch
    // marker only AFTER the cancel lands (so the run-history reads
    // correctly even if the cancel times out and we fall back to
    // queue).
    const cancellingState = beginSteer({ chatId: targetChatId, cancelTargetRunId })
    setSteerState(cancellingState)
    steerStateRef.current = cancellingState
    // Mark this chat for delta+complete suppression so the provider's
    // wrap-up text emitted between SIGTERM and exit doesn't land as a
    // mid-transcript "final summary." Cleared in the cancel-landed or
    // timeout paths below.
    steerSuppressionChatIdsRef.current.add(targetChatId)
    clearComposerAttachmentsForSubmittedRequest(request)
    if (!request.existingPrompt) {
      setChatPromptDraft(targetChatId, '')
    }

    // Kick off the cancel via the existing IPC path (same one the
    // Stop button uses). We DON'T await here — the cancel-then-watch
    // loop below polls for the side effect (active run cleared) rather
    // than relying on the cancel call's return value, because the
    // provider-specific main-side code may resolve before/after the
    // renderer sees `agent-exit`.
    void window.api.cancelAgentRun(request.provider, cancelTargetRunId).catch((error) => {
      console.warn('[steer] cancelAgentRun rejected:', error)
    })

    appendThreadRawLog(targetChatId, {
      type: 'info',
      content: `Steer: interrupting current ${providerLabel} turn to dispatch a new prompt.`
    })

    // Watch loop. Poll `activeRunsRef` until either the cancel lands
    // (active run cleared) or the deadline elapses. The pure
    // `decideSteerWait` helper drives each tick so the branching is
    // unit-testable.
    const startedAt = Date.now()
    let outcome: 'cancel-landed' | 'timeout' = 'timeout'
    // Tight upper bound to avoid runaway polling: deadline + 5 ticks of slack.
    const maxIterations =
      Math.ceil(DEFAULT_STEER_CANCEL_TIMEOUT_MS / DEFAULT_STEER_POLL_INTERVAL_MS) + 5
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const decision = decideSteerWait({
        chatId: targetChatId,
        startedAt,
        now: Date.now(),
        hasRunForChat: (chatId) => {
          for (const ctx of activeRunsRef.current.values()) {
            if (ctx.chatId === chatId) return true
          }
          return false
        }
      })
      if (decision.kind === 'cancel-landed') {
        outcome = 'cancel-landed'
        break
      }
      if (decision.kind === 'timeout') {
        outcome = 'timeout'
        break
      }
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, DEFAULT_STEER_POLL_INTERVAL_MS)
      })
    }

    // The user may have navigated away from this chat or kicked off
    // another steer while we slept. Bail (no further state changes)
    // if either happened. Also clear the suppression entry — even
    // though another steer/navigation owns the state machine now, the
    // suppression set is keyed by chatId and we must not leak it.
    const stillCurrent = steerStateRef.current
    if (stillCurrent.phase !== 'cancelling' || stillCurrent.chatId !== targetChatId) {
      steerSuppressionChatIdsRef.current.delete(targetChatId)
      return
    }

    if (outcome === 'cancel-landed') {
      // Cancel landed — release the delta suppression so the NEW
      // (steered-into) run's tokens stream into the transcript as
      // normal. Any farewell tokens from the cancelled run that were
      // already buffered get dropped on the floor (intentional).
      steerSuppressionChatIdsRef.current.delete(targetChatId)
      // The cancel-path already marks the previous run's row + may emit
      // a "Task ended before completing" system message; we add an
      // additional, more meaningful `↳ Steered` system note so the
      // transcript explains what happened (the user actively steered,
      // it wasn't a generic abort).
      updateChatById(targetChatId, (source) => {
        const steeredAt = new Date().toISOString()
        const promptPreview = (request.displayPrompt || request.prompt || '').trim()
        const previewOneLiner =
          promptPreview.length > 240 ? `${promptPreview.slice(0, 240)}…` : promptPreview
        return {
          ...source,
          messages: [
            ...source.messages,
            {
              id: `steered-${request.appRunId || createMessageId()}`,
              role: 'system',
              content: previewOneLiner
                ? `↳ Steered: interrupted to run a new prompt — ${previewOneLiner}`
                : '↳ Steered: interrupted to run a new prompt.',
              timestamp: steeredAt,
              metadata: {
                kind: 'steerHandoff',
                appRunId: request.appRunId,
                provider: request.provider,
                promptPreview: previewOneLiner,
                interruptedRunId: cancelTargetRunId
              }
            }
          ],
          updatedAt: Date.now()
        }
      })

      const dispatchingState = transitionToDispatching({
        prev: steerStateRef.current,
        chatId: targetChatId
      })
      setSteerState(dispatchingState)
      steerStateRef.current = dispatchingState

      void executeRun(request)
      // Reset to idle on the next tick; `executeRun` schedules the
      // dispatch synchronously enough that the indicator visibly
      // flips from "interrupting" to "dispatching" and then off.
      window.setTimeout(() => {
        const latest = steerStateRef.current
        if (latest.phase === 'dispatching' && latest.chatId === targetChatId) {
          setSteerState(resetSteer())
          steerStateRef.current = resetSteer()
        }
      }, 350)
      return
    }

    // Timeout path: cancel didn't land cleanly. Release the
    // suppression — the prior run is going to continue (and complete
    // naturally), so its remaining tokens are legitimate transcript
    // content the user should still see.
    steerSuppressionChatIdsRef.current.delete(targetChatId)
    // The user's prompt is too valuable to drop, so queue it (the
    // existing fallback) and surface a visible error note. The active
    // run keeps running; when it finishes the queue scheduler
    // dispatches the steered prompt automatically.
    const failedMessage = `Steer timed out after ${(DEFAULT_STEER_CANCEL_TIMEOUT_MS / 1000).toFixed(0)}s; the ${providerLabel} run is still running. Your prompt was queued instead.`
    const failedState = markSteerFailed({
      chatId: targetChatId,
      reason: 'timeout',
      message: failedMessage
    })
    setSteerState(failedState)
    steerStateRef.current = failedState
    appendThreadRawLog(targetChatId, { type: 'stderr', content: failedMessage })
    queueRunRequest(
      request,
      `Steer fell back to queue: cancel of the active ${providerLabel} turn did not land in ${(DEFAULT_STEER_CANCEL_TIMEOUT_MS / 1000).toFixed(0)}s.`
    )
    // Clear the indicator after a short visible window so the user
    // sees the failure state for ~3s before the composer returns to
    // normal.
    window.setTimeout(() => {
      const latest = steerStateRef.current
      if (
        latest.phase === 'failed' &&
        latest.chatId === targetChatId &&
        latest.reason === 'timeout'
      ) {
        setSteerState(resetSteer())
        steerStateRef.current = resetSteer()
      }
    }, 3_000)
  }

  const handleScheduleRun = async () => {
    if (!currentWorkspace || !currentChat) return
    const request = buildRunRequest()
    if (!request.prompt.trim() || !scheduleRunAt) return
    const runAtDate = new Date(scheduleRunAt)
    if (Number.isNaN(runAtDate.getTime())) {
      setRawLogs((prev) => [...prev, { type: 'info', content: 'Scheduled run time is invalid.' }])
      return
    }
    if (runAtDate.getTime() <= Date.now()) {
      setRawLogs((prev) => [
        ...prev,
        { type: 'info', content: 'Choose a future time for scheduled runs.' }
      ])
      return
    }

    // 1.0.4-AT3 — when scheduling from an ensemble chat, capture
    // the panel state at schedule time (orchestration mode +
    // participants + caps + DM target) so the dispatcher can
    // apply it as the fire-time roster. Pre-AT3 the dispatcher
    // read the chat's LIVE ensemble config, so the user's
    // post-schedule edits silently reshaped what ran.
    const ensembleSnapshot = isCurrentEnsembleChat
      ? buildScheduledEnsembleSnapshot(currentChat, {
          dmTargetParticipantId: request.dmTargetParticipantId
        })
      : null

    const saved = await window.api.saveScheduledTask({
      workspaceId: currentWorkspace.id,
      workspacePath: currentWorkspace.path,
      chatId: currentChat.appChatId,
      provider: request.provider,
      prompt: request.prompt,
      displayPrompt: request.displayPrompt,
      selectedModelType: request.selectedModelType,
      customModel: request.customModel,
      approvalMode: request.approvalMode,
      sessionTrust: request.sessionTrust,
      imageAttachments: request.imageAttachments,
      externalPathGrants: request.externalPathGrants,
      geminiWorktree: request.geminiWorktree,
      codexReasoningEffort: request.codexReasoningEffort,
      codexServiceTier: request.codexServiceTier,
      claudeFastMode: request.claudeFastMode,
      kimiThinkingEnabled: request.kimiThinkingEnabled,
      runtimeProfileId: request.runtimeProfileId,
      geminiAuthProfileId: request.geminiAuthProfileId,
      handoffSourceRunId: request.handoffSourceRunId,
      runAt: runAtDate.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
      ...(ensembleSnapshot
        ? { kind: 'ensemble' as const, ensembleSnapshot }
        : { kind: 'single' as const })
    })
    setScheduledTasks(await window.api.getScheduledTasks(currentWorkspace.id))
    setScheduleRunAt('')
    setRawLogs((prev) => [
      ...prev,
      {
        type: 'info',
        content: `Scheduled ${getProviderLabel(saved.provider)} run for ${formatScheduledRunTime(saved.runAt)}.`
      }
    ])
  }

  const getCockpitRunSource = (
    lane: RunLane
  ): { chat: ChatRecord | null; run: ChatRun | null; prompt: string } => {
    return resolveCockpitRunSource(lane, chats, chatByIdRef.current)
  }

  const handleOpenCockpitThread = (chatId?: string) => {
    if (!chatId) return
    const chat = chatByIdRef.current.get(chatId) || chats.find((item) => item.appChatId === chatId)
    if (chat) {
      void handleSelectChat(chat)
      setShowCockpit(false)
    }
  }

  const handleCancelRunLane = (lane: RunLane) => {
    if (lane.scheduledTaskId) {
      void window.api
        .updateScheduledTask(lane.scheduledTaskId, {
          status: 'cancelled' as any,
          lastError: 'Cancelled from Cockpit.'
        })
        .then(() =>
          window.api
            .getScheduledTasks(currentWorkspaceIdRef.current || undefined)
            .then(setScheduledTasks)
        )
      return
    }
    if (!lane.runId) return
    setQueuedRuns((prev) => prev.filter((request) => request.appRunId !== lane.runId))
    if (lane.phase === 'queued' || lane.phase === 'paused') {
      updateRunQueueJobStatus(lane.runId, 'cancelled', 'Cancelled from Cockpit.')
      return
    }
    void window.api.cancelAgentRun(lane.provider, lane.runId).catch(() => {
      if (lane.provider === 'gemini') {
        void window.api.cancelGemini(lane.runId)
      }
    })
  }

  const handleRetryRunLane = (lane: RunLane) => {
    const { chat, run, prompt: sourcePrompt } = getCockpitRunSource(lane)
    if (!chat || !sourcePrompt.trim()) return
    const workspace = getWorkspaceForChat(chat) || undefined
    const provider = lane.provider || getChatProvider(chat)
    const selection = getChatComposerSelection(chat, provider)
    const requestedRetryModel = run?.requestedModel
    const retryModel = isValidModelForProvider(provider, requestedRetryModel)
      ? requestedRetryModel
      : selection.selectedModelType
    const request: QueuedRunRequest = {
      appRunId: createAppRunId(),
      scope: getChatScope(chat),
      provider,
      prompt: sourcePrompt,
      displayPrompt: `[retry] ${sourcePrompt}`,
      existingPrompt: sourcePrompt,
      selectedModelType: retryModel,
      customModel: selection.customModel,
      approvalMode: run?.approvalMode || selection.approvalMode,
      sessionTrust,
      imageAttachments: [],
      externalPathGrants:
        getChatScope(chat) === 'global'
          ? []
          : normalizeExternalPathGrants(
              collectExternalPathGrantsFromMetadata(chat.providerMetadata)
            ).filter((grant) => grant.provider === provider),
      geminiWorktree:
        getChatScope(chat) === 'global'
          ? undefined
          : resolveGeminiWorktreeConfig(workspace || null),
      codexReasoningEffort: selection.codexReasoningEffort,
      codexServiceTier: selection.codexServiceTier,
      claudeFastMode: selection.claudeFastMode,
      kimiThinkingEnabled: selection.kimiThinkingEnabled,
      runtimeProfileId: lane.runtimeProfileId || getRuntimeProfileIdForChat(chat, provider),
      handoffSourceRunId: lane.handoffSourceRunId,
      workspaceRecord: getChatScope(chat) === 'global' ? undefined : workspace,
      chatRecord: chat
    }
    if (isChatBusy(chat.appChatId)) {
      queueRunRequest(
        request,
        `Retry is waiting for this chat's active ${getProviderLabel(provider)} task to exit.`
      )
      return
    }
    void executeRun(request)
  }

  const handleDuplicateRunLane = async (lane: RunLane) => {
    const { chat, prompt: sourcePrompt } = getCockpitRunSource(lane)
    if (!chat) return
    const provider = lane.provider || getChatProvider(chat)
    const workspace = getWorkspaceForChat(chat)
    const duplicate = isGlobalChat(chat)
      ? await window.api.createGlobalChat()
      : workspace
        ? await window.api.createChat(workspace.id, workspace.path)
        : null
    if (!duplicate) return
    const updatedDuplicate: ChatRecord = {
      ...duplicate,
      provider,
      providerMetadata: {
        ...(duplicate.providerMetadata || {}),
        runtimeProfileId: lane.runtimeProfileId || getRuntimeProfileIdForChat(chat, provider)
      },
      title: `${chat.title || getProviderLabel(provider)} copy`,
      updatedAt: Date.now()
    }
    await window.api.saveChat(updatedDuplicate)
    chatByIdRef.current.set(updatedDuplicate.appChatId, updatedDuplicate)
    setChats(await window.api.getChats())
    setChatPromptDraft(updatedDuplicate.appChatId, sourcePrompt)
    setRuntimeProfileForChat(
      updatedDuplicate.appChatId,
      typeof updatedDuplicate.providerMetadata?.runtimeProfileId === 'string'
        ? updatedDuplicate.providerMetadata.runtimeProfileId
        : ''
    )
    void handleSelectChat(updatedDuplicate)
    setShowCockpit(false)
  }

  const handleCreateHandoffFromLane = async (lane: RunLane) => {
    const { chat, run, prompt: sourcePrompt } = getCockpitRunSource(lane)
    if (!chat || !run || typeof window.api.saveHandoffCard !== 'function') return
    const latestAssistantMessage = [...chat.messages]
      .reverse()
      .find((message) => message.role === 'assistant')
    const selectedFiles = extractRunTouchedFiles(run)
    const summary = latestAssistantMessage?.content
      ? compactPromptPreview(latestAssistantMessage.content)
      : `Continue work from ${getProviderLabel(lane.provider)} run ${run.runId}.`
    const finalPrompt = [
      `Continue from ${getProviderLabel(lane.provider)} run ${run.runId}.`,
      `Source chat: ${chat.title || chat.appChatId}.`,
      selectedFiles.length > 0
        ? `Files touched: ${selectedFiles.slice(0, 24).join(', ')}`
        : 'Files touched: none recorded.',
      formatOpaqueMarkdownPromptSection('Prior request', sourcePrompt),
      latestAssistantMessage?.content
        ? formatOpaqueMarkdownPromptSection(
            'Latest assistant summary',
            latestAssistantMessage.content
          )
        : ''
    ]
      .filter(Boolean)
      .join('\n\n')
    const card = await window.api.saveHandoffCard({
      sourceChatId: chat.appChatId,
      sourceRunId: run.runId,
      sourceProvider: lane.provider,
      workspaceId: chat.workspaceId,
      workspacePath: chat.workspacePath,
      summary,
      selectedFiles,
      workspaceChangeSetIds: run.workspaceChangeSetId ? [run.workspaceChangeSetId] : [],
      rawEventRunIds: [run.runId],
      recommendedProvider: lane.provider,
      recommendedModel: run.actualModel || run.requestedModel,
      recommendedApprovalMode: run.approvalMode,
      finalPrompt
    })
    setHandoffCards((prev) => [card, ...prev.filter((item) => item.id !== card.id)])
    setShowCockpit(true)
  }

  const handleDispatchHandoff = async (card: HandoffCard) => {
    const sourceChat =
      chatByIdRef.current.get(card.sourceChatId) ||
      chats.find((item) => item.appChatId === card.sourceChatId)
    const provider = card.recommendedProvider || card.sourceProvider
    const workspace = sourceChat ? getWorkspaceForChat(sourceChat) : null
    const targetChat =
      sourceChat && isGlobalChat(sourceChat)
        ? await window.api.createGlobalChat()
        : workspace
          ? await window.api.createChat(workspace.id, workspace.path)
          : null
    if (!targetChat) return
    const updatedTarget: ChatRecord = {
      ...targetChat,
      provider,
      title: `Handoff from ${getProviderLabel(card.sourceProvider)}`,
      updatedAt: Date.now()
    }
    await window.api.saveChat(updatedTarget)
    const updatedCard = await window.api.updateHandoffCard(card.id, {
      status: 'dispatched',
      targetChatId: updatedTarget.appChatId,
      dispatchedAt: new Date().toISOString()
    })
    if (updatedCard) {
      setHandoffCards((prev) =>
        prev.map((item) => (item.id === updatedCard.id ? updatedCard : item))
      )
    }
    chatByIdRef.current.set(updatedTarget.appChatId, updatedTarget)
    setChats(await window.api.getChats())
    setChatPromptDraft(updatedTarget.appChatId, card.finalPrompt)
    void handleSelectChat(updatedTarget)
    setShowCockpit(false)
  }

  const handleArchiveHandoff = async (card: HandoffCard) => {
    const updated = await window.api.updateHandoffCard(card.id, { status: 'archived' })
    if (updated) {
      setHandoffCards((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
    }
  }

  const dispatchScheduledTask = async (task: ScheduledTask) => {
    try {
      let workspace = workspaces.find((item) => item.id === task.workspaceId)
      if (!workspace) {
        const latestWorkspaces = await window.api.getWorkspaces()
        setWorkspaces(latestWorkspaces)
        setWorkspacesHydrated(true)
        workspace = latestWorkspaces.find((item) => item.id === task.workspaceId)
      }
      let chat = await window.api.getChat(task.chatId)
      if (!workspace || !chat) {
        await window.api.updateScheduledTask(task.id, {
          status: 'failed',
          lastError: 'Workspace or chat could not be loaded.'
        })
        setScheduledTasks(await window.api.getScheduledTasks(currentWorkspace?.id))
        return
      }

      // 1.0.4-AT3 — apply the schedule-time ensemble snapshot to the
      // chat record before dispatch so the orchestrator sees the
      // roster + mode the user actually scheduled, not whatever
      // edits happened between schedule + fire. Persist the snapshot
      // application so the renderer's local cache + main-process
      // store agree on the dispatch-time state.
      if (task.kind === 'ensemble' && task.ensembleSnapshot && chat.chatKind === 'ensemble') {
        chat = applyScheduledEnsembleSnapshot(chat, task.ensembleSnapshot)
        await window.api.saveChat(chat)
      }

      setCurrentWorkspace(workspace)
      currentWorkspaceIdRef.current = workspace.id
      currentChatIdRef.current = chat.appChatId
      chatByIdRef.current.set(chat.appChatId, chat)
      setCurrentChat(chat)
      applyChatComposerSelection(chat, task.provider)
      const taskSelectedModel = isValidModelForProvider(task.provider, task.selectedModelType)
        ? task.selectedModelType
        : getDefaultModelForProvider(task.provider)
      setSelectedModelType(taskSelectedModel)
      setCustomModel(task.customModel)
      setApprovalMode(task.approvalMode)
      setSessionTrust(task.sessionTrust)
      if (task.provider === 'codex') {
        setCodexReasoningEffort(task.codexReasoningEffort || 'medium')
        setCodexServiceTier(task.codexServiceTier || '')
      }
      if (task.provider === 'claude') {
        setClaudeFastMode(Boolean(task.claudeFastMode))
      }
      if (task.provider === 'kimi') {
        setKimiThinkingEnabled(task.kimiThinkingEnabled !== false)
      }

      await window.api.updateScheduledTask(task.id, {
        status: 'running',
        firedAt: task.firedAt || new Date().toISOString()
      })
      setScheduledTasks(await window.api.getScheduledTasks(currentWorkspace?.id))

      void executeRun({
        provider: task.provider,
        prompt: task.prompt,
        displayPrompt:
          task.displayPrompt || `[scheduled ${formatScheduledRunTime(task.runAt)}] ${task.prompt}`,
        selectedModelType: taskSelectedModel,
        customModel: task.customModel,
        approvalMode: task.approvalMode,
        sessionTrust: task.sessionTrust,
        imageAttachments: task.imageAttachments,
        externalPathGrants: task.externalPathGrants,
        geminiWorktree: task.geminiWorktree,
        codexReasoningEffort: task.codexReasoningEffort,
        codexServiceTier: task.codexServiceTier,
        claudeFastMode: task.claudeFastMode,
        kimiThinkingEnabled: task.kimiThinkingEnabled,
        runtimeProfileId: task.runtimeProfileId,
        geminiAuthProfileId: task.geminiAuthProfileId,
        handoffSourceRunId: task.handoffSourceRunId,
        scheduledTaskId: task.id,
        workspaceRecord: workspace,
        chatRecord: chat,
        preserveComposer: true
      }).catch(async (error) => {
        await window.api.updateScheduledTask(task.id, {
          status: 'failed',
          lastError: String(error)
        })
        setScheduledTasks(await window.api.getScheduledTasks(currentWorkspace?.id))
      })
    } catch (error) {
      await window.api.updateScheduledTask(task.id, { status: 'failed', lastError: String(error) })
      setScheduledTasks(await window.api.getScheduledTasks(currentWorkspace?.id))
    }
  }

  const dispatchScheduledTaskRef = useRef(dispatchScheduledTask)
  dispatchScheduledTaskRef.current = dispatchScheduledTask

  useEffect(() => {
    if (!workspacesHydrated) {
      return
    }
    if (dueScheduledTasks.length === 0) {
      return
    }
    const nextIndex = dueScheduledTasks.findIndex((task) => !isChatBusy(task.chatId))
    if (nextIndex < 0) return
    const nextTask = dueScheduledTasks[nextIndex]
    const remainingTasks = dueScheduledTasks.filter((_, index) => index !== nextIndex)
    setDueScheduledTasks(remainingTasks)
    void dispatchScheduledTaskRef.current(nextTask)
  }, [dueScheduledTasks, runningChatIds, workspacesHydrated, workspaces])

  const appendBridgeFallback = (commandText: string, reason: string) => {
    const timestamp = new Date().toISOString()
    setRawLogs((prev) => [
      ...prev,
      { type: 'info', content: `Queued Gemini command bridge text (${reason}): ${commandText}` }
    ])
    setCurrentChat((prev) => {
      if (!prev) return prev
      const updated = {
        ...prev,
        messages: [
          ...prev.messages,
          { id: `${createMessageId()}-bridge-user`, role: 'user', content: commandText, timestamp },
          {
            id: `${createMessageId()}-bridge-system`,
            role: 'system',
            content: `Command bridge queued because persistent Gemini session is ${reason}.`,
            timestamp: new Date().toISOString()
          }
        ] as ChatMessage[]
      }
      window.api.saveChat(updated)
      return updated
    })
  }

  const appendRawInfoOnce = (content: string) => {
    setRawLogs((prev) =>
      prev[prev.length - 1]?.content === content ? prev : [...prev, { type: 'info', content }]
    )
  }

  const markPersistentSessionRestartNeeded = (content: string) => {
    if (!persistentSessionActiveRef.current) {
      return
    }
    setPersistentSessionNeedsRestart(true)
    appendRawInfoOnce(content)
  }

  const stopPersistentGeminiSession = async (
    message = 'Persistent Gemini session stopped.'
  ): Promise<boolean> => {
    const geminiSessionApi = window.api as any
    if (typeof geminiSessionApi.stopGeminiSession !== 'function') {
      persistentSessionActiveRef.current = false
      setIsPersistentSessionEnabled(false)
      setPersistentSessionStatus('unavailable')
      setPersistentSessionNeedsRestart(false)
      return false
    }

    setPersistentSessionStatus('stopping')
    try {
      await geminiSessionApi.stopGeminiSession()
      persistentSessionActiveRef.current = false
      setIsPersistentSessionEnabled(false)
      setPersistentSessionStatus('idle')
      setPersistentSessionNeedsRestart(false)
      if (message) {
        appendRawInfoOnce(message)
      }
      return true
    } catch (error) {
      setPersistentSessionStatus('error')
      setRawLogs((prev) => [
        ...prev,
        {
          type: 'info',
          content: `Failed to stop persistent Gemini session: ${redactLog(String(error))}`
        }
      ])
      return false
    }
  }

  const startPersistentGeminiSession = async (): Promise<boolean> => {
    const geminiSessionApi = window.api as any

    if (persistentSessionActiveRef.current && persistentSessionNeedsRestart) {
      const stopped = await stopPersistentGeminiSession(
        'Persistent Gemini session stopped for restart.'
      )
      if (!stopped) {
        return false
      }
    }

    if (persistentSessionActiveRef.current) {
      setIsPersistentSessionEnabled(true)
      setPersistentSessionStatus('active')
      return true
    }

    if (!currentWorkspace || typeof geminiSessionApi.startGeminiSession !== 'function') {
      setPersistentSessionStatus('unavailable')
      setRawLogs((prev) => [
        ...prev,
        {
          type: 'info',
          content:
            'Persistent Gemini session API is unavailable; command bridge will queue text in chat/raw logs.'
        }
      ])
      return false
    }

    const modelToPass = selectedModelType === 'custom' ? customModel.trim() : selectedModelType
    const worktree = resolveGeminiWorktreeConfig(currentWorkspace)
    const resumeDecision = currentChat
      ? resolveGeminiResumeForRun(
          currentChat,
          modelToPass,
          approvalMode,
          worktree,
          geminiAuthStatus?.activeProfileId || null
        )
      : {}
    const resumeSessionId = resumeDecision.sessionId
    if (resumeDecision.skippedReason) {
      appendRawInfoOnce(resumeDecision.skippedReason)
      if (currentChat) {
        updateChatById(currentChat.appChatId, (source) => ({
          ...source,
          linkedGeminiSessionId: undefined,
          updatedAt: Date.now()
        }))
      }
    }
    setIsPersistentSessionEnabled(true)
    setPersistentSessionStatus('starting')
    setPersistentSessionNeedsRestart(false)

    try {
      await geminiSessionApi.startGeminiSession(
        currentWorkspace.path,
        modelToPass,
        approvalMode,
        sessionTrust,
        undefined,
        undefined,
        resumeSessionId,
        worktree
      )
      persistentSessionActiveRef.current = true
      setPersistentSessionStatus('active')
      setPersistentSessionNeedsRestart(false)
      if (isGeminiWorktreeDiffUnavailable(worktree)) {
        setDiff(createWorktreeDiffUnavailable())
        setRunDiff(null)
        setDiffView('workspace')
        setDiffRefreshStatus('Diff disabled: worktree path unknown.')
      }
      setRawLogs((prev) => [
        ...prev,
        {
          type: 'info',
          content: `Persistent Gemini session ${resumeSessionId ? `resumed from ${resumeSessionId}` : 'started'}${modelToPass ? ` with ${modelToPass}` : ''}${worktree?.enabled ? ` in worktree ${worktree.name || 'enabled'}` : ''}.`
        }
      ])
      if (typeof geminiSessionApi.resizeGeminiSession === 'function') {
        const cols = Math.max(80, Math.floor(window.innerWidth / 8))
        const rows = Math.max(24, Math.floor(window.innerHeight / 18))
        geminiSessionApi.resizeGeminiSession(cols, rows).catch?.(() => {})
      }
      return true
    } catch (error) {
      persistentSessionActiveRef.current = false
      setIsPersistentSessionEnabled(false)
      setPersistentSessionStatus('error')
      setPersistentSessionNeedsRestart(false)
      setRawLogs((prev) => [
        ...prev,
        {
          type: 'info',
          content: `Failed to start persistent Gemini session: ${redactLog(String(error))}`
        }
      ])
      return false
    }
  }

  const handleBridgeCommand = async (command: string) => {
    const commandText = command
    const geminiSessionApi = window.api as any
    const sessionReady = await startPersistentGeminiSession()
    if (!sessionReady || typeof geminiSessionApi.writeGeminiSession !== 'function') {
      appendBridgeFallback(commandText, sessionReady ? 'write-unavailable' : 'session-unavailable')
      return
    }

    geminiSessionApi
      .writeGeminiSession(`${commandText}\n`)
      .catch(() => appendBridgeFallback(commandText, 'write-unavailable'))
    setRightTab('raw')
    setRawLogs((prev) => [
      ...prev,
      { type: 'info', content: `Sent Gemini command: ${commandText}` }
    ])
  }

  const handlePaletteCommand = (item: CommandPaletteItem) => {
    setIsCommandPaletteOpen(false)
    setCommandPaletteQuery('')
    // 1.0.4-AT6 — when an ensemble chat has a selected participant,
    // route diagnostic slash commands (`/status`, `/model`,
    // `/permissions`, `/mcp`, `/resume`, `/fork`) at THAT
    // participant's provider rather than the chat-level provider.
    // Pre-AT6 these commands always read `currentProvider`, so
    // running `/status` from an ensemble where Codex was the
    // chat-level provider but the selected chip was a Claude
    // participant showed Codex's status, not Claude's. The
    // effective provider is also passed to `refreshProviderMetadata`
    // so the right-tab data reflects the targeted participant.
    const slashTargetProvider: ProviderId =
      isCurrentEnsembleChat && selectedParticipant ? selectedParticipant.provider : currentProvider
    // Composer-unification (Phase J1): renderer-side action items
    // dispatch to local handlers instead of running through the
    // provider command bridge. These are the Gemini quick-toggle
    // items moved from the inline-pickers tail.
    if (item.action) {
      switch (item.action) {
        case 'restore-checkpoint':
          void handleRestoreCheckpoint()
          return
        case 'toggle-memory-inspector':
          setIsMemoryInspectorOpen((current) => !current)
          return
        case 'toggle-persistent-session':
          void handlePersistentSessionToggle()
          return
        case 'toggle-checkpoints':
          handleSettingsChange({ geminiCheckpointingEnabled: !geminiCheckpointingEnabled })
          return
        default:
          return
      }
    }
    if (slashTargetProvider === 'codex') {
      if (item.command === '/status' || item.command === '/permissions') {
        setRightTab('safety')
      } else if (
        item.command === '/model' ||
        item.command === '/mcp' ||
        item.command === '/resume'
      ) {
        setRightTab('capabilities')
        if (item.command === '/resume') {
          void refreshCodexThreads()
        }
      } else if (item.command === '/diff') {
        setRightTab('diff')
      } else if (item.command === '/review') {
        void handleReviewCurrentDiff()
      } else if (item.command === '/fast') {
        // Codex-specific toggle — stays chat-level since fast mode
        // is a chat composer pick, not a per-participant setting.
        if (codexSupportsFast) {
          const nextTier = codexServiceTier === 'fast' ? '' : 'fast'
          setCodexServiceTier(nextTier)
          rememberCurrentChatComposerSelection({ codexServiceTier: nextTier })
        }
      } else if (item.command === '/fork') {
        // 1.0.4-AT1 + AT6 — fork sources from the selected
        // participant's `linkedProviderSessionId` in ensemble (the
        // AT1 routing helper handles the chat-vs-participant write
        // direction; here we just pick the right source thread to
        // fork against).
        const threadId =
          isCurrentEnsembleChat && selectedParticipant?.provider === 'codex'
            ? selectedParticipant.linkedProviderSessionId
            : currentChat?.linkedProviderSessionId
        if (threadId) {
          void handleForkCodexThread(threadId)
        } else {
          setRightTab('capabilities')
          void refreshCodexThreads()
        }
      }
      return
    }
    if (slashTargetProvider === 'claude' || slashTargetProvider === 'kimi') {
      if (item.command === '/status' || item.command === '/permissions') {
        void refreshProviderMetadata(slashTargetProvider)
        setRightTab('safety')
      } else if (item.command === '/model') {
        void refreshProviderMetadata(slashTargetProvider)
        setRightTab('capabilities')
      } else if (item.command === '/diff') {
        setRightTab('diff')
      } else if (item.command === '/review') {
        void handleReviewCurrentDiff()
      }
      return
    }
    void handleBridgeCommand(item.command)
  }

  /**
   * Strip the slash token (`/<query>`) the user typed to open the picker
   * from the composer prompt, leaving the caret at the position where
   * the slash used to be. Used after a slash-command dispatches so the
   * picker's trigger character doesn't end up sent to the provider.
   */
  const promptWithoutCurrentSlashToken = (): string => {
    const anchor = slashAnchorIndexRef.current
    if (anchor === null) return prompt
    const tokenLength = 1 + slashQuery.length // `/` + query chars
    const before = prompt.slice(0, anchor)
    const after = prompt.slice(anchor + tokenLength)
    return `${before}${after}`
  }

  const consumeSlashTokenFromPrompt = (): void => {
    const anchor = slashAnchorIndexRef.current
    if (anchor === null) return
    const before = prompt.slice(0, anchor)
    const next = promptWithoutCurrentSlashToken()
    setPrompt(next)
    requestAnimationFrame(() => {
      const ta = composerTextareaRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(before.length, before.length)
    })
  }

  const parseSideSlashPrompt = (value: string): string | null => {
    const withoutLeadingWhitespace = value.replace(/^\s+/, '')
    if (!withoutLeadingWhitespace.startsWith('/side')) return null
    const afterCommand = withoutLeadingWhitespace.slice('/side'.length)
    if (afterCommand && !/^\s/.test(afterCommand)) return null
    return afterCommand.trim()
  }

  const tryHandleSideSlashSubmit = (): boolean => {
    const sideSeedPrompt = parseSideSlashPrompt(prompt)
    if (sideSeedPrompt === null) return false
    void ensureSideChatForCurrentChat(sideSeedPrompt, true, 'split')
    setSlashMenuOpen(false)
    setSlashQuery('')
    slashAnchorIndexRef.current = null
    return true
  }

  /**
   * Slash-picker dispatch — discriminated by command `kind`. Reuses the
   * existing handlePaletteCommand for palette-passthrough kinds so the
   * dispatch shape doesn't fork. Strips the slash trigger token from
   * the prompt in every branch so the literal `/whatever` characters
   * never reach the provider.
   *
   * Kinds covered in L4: palette-passthrough, gemini-pty. The remaining
   * kinds (action, prompt-template, insert) land in L5+.
   */
  const handleComposerSlash = (command: ComposerSlashCommand): void => {
    setSlashMenuOpen(false)
    setSlashQuery('')
    const dispatch = () => {
      switch (command.kind) {
        case 'palette-passthrough':
          handlePaletteCommand(command.paletteItem)
          return
        case 'gemini-pty':
          // PTY pass-through — only viable on Gemini (Codex/Claude/Kimi
          // run-process invocations don't surface a live CLI). Bridge
          // command failure (no persistent session) surfaces via the
          // existing raw-events logging that handleBridgeCommand owns.
          void handleBridgeCommand(command.command)
          return
        case 'action':
          void command.run()
          return
        case 'prompt-template':
          // Insert the template at the slash position; caller can keep
          // typing to fill in template-specific arguments.

          {
            const anchor = slashAnchorIndexRef.current ?? 0
            const tokenLength = 1 + slashQuery.length
            const before = prompt.slice(0, anchor)
            const after = prompt.slice(anchor + tokenLength)
            const next = `${before}${command.template}${after}`
            setPrompt(next)
            const caretBase = before.length + (command.cursorOffset ?? command.template.length)
            requestAnimationFrame(() => {
              const ta = composerTextareaRef.current
              if (!ta) return
              ta.focus()
              ta.setSelectionRange(caretBase, caretBase)
            })
            slashAnchorIndexRef.current = null
          }
          return
        case 'insert':
          {
            const anchor = slashAnchorIndexRef.current ?? 0
            const tokenLength = 1 + slashQuery.length
            const before = prompt.slice(0, anchor)
            const after = prompt.slice(anchor + tokenLength)
            const next = `${before}${command.insertText}${after}`
            setPrompt(next)
            const caretBase = before.length + command.insertText.length
            requestAnimationFrame(() => {
              const ta = composerTextareaRef.current
              if (!ta) return
              ta.focus()
              ta.setSelectionRange(caretBase, caretBase)
            })
            slashAnchorIndexRef.current = null
          }
          return
      }
    }
    // For dispatch kinds that consume the token themselves (insert /
    // template), skip the generic strip. For everything else (palette-
    // passthrough / gemini-pty / action), strip the slash token first
    // so the next user prompt starts clean.
    if (command.kind !== 'insert' && command.kind !== 'prompt-template') {
      consumeSlashTokenFromPrompt()
    }
    slashAnchorIndexRef.current = null
    dispatch()
  }

  const handleRestoreCheckpoint = async () => {
    const confirmed = window.confirm(
      'Open Gemini /restore in the persistent session? This only opens Gemini CLI restore selection; restore is not executed by TaskWraith.'
    )
    if (!confirmed) {
      return
    }

    await handleBridgeCommand('/restore')
  }

  const syncPersistentModelSelection = (nextModel: string) => {
    if (!persistentSessionActiveRef.current) {
      return
    }
    const currentModel =
      selectedModelType === 'custom' ? customModel.trim() || 'custom' : selectedModelType
    const nextModelLabel = nextModel === 'custom' ? 'custom model' : nextModel
    if (normalizeProviderModelKey(currentModel) === normalizeProviderModelKey(nextModel)) {
      return
    }
    markPersistentSessionRestartNeeded(
      `Gemini model changed to ${nextModelLabel}. Restart the persistent session to apply the new model.`
    )
  }

  const handlePersistentSessionToggle = async () => {
    if (isPersistentSessionEnabled || persistentSessionActiveRef.current) {
      if (persistentSessionNeedsRestart) {
        const stopped = await stopPersistentGeminiSession(
          'Persistent Gemini session stopped for restart.'
        )
        if (stopped) {
          await startPersistentGeminiSession()
        }
        return
      }
      await stopPersistentGeminiSession()
      return
    }

    await startPersistentGeminiSession()
  }

  // 1.0.4-AQ4 — Copy message content to clipboard. 1.0.8: routed
  // through the shared `useCopyFeedback` hook so the originating
  // message chip shows a transient "Copied" confirmation (keyed on
  // `messageId`) instead of copying silently. The hook owns the
  // clipboard write + the reset timer.
  const handleCopyMessage = useCallback(
    (messageId: string, content: string) => {
      if (!content) return
      copy(messageId, content)
    },
    [copy]
  )

  const deleteMessageFromChat = useCallback(
    (chat: ChatRecord | null | undefined, messageId: string) => {
      if (!chat || !messageId) return
      const target = chat.messages.find((m) => m.id === messageId)
      if (!target) return
      const chatId = chat.appChatId
      if (
        messageAnchorsActivePrompt(
          messageId,
          pendingAgentQuestionByChatId[chatId]?.messageId,
          pendingPlanChoiceByChatId[chatId]?.messageId
        )
      ) {
        if (typeof window !== 'undefined' && typeof window.alert === 'function') {
          window.alert(
            'This message has an open prompt waiting on it. Answer or dismiss the prompt before deleting the message.'
          )
        }
        return
      }
      const preview =
        target.content && target.content.length > 80
          ? `${target.content.slice(0, 77)}…`
          : target.content || `(${target.role} message)`
      const ok =
        typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? window.confirm(`Delete this message from the transcript?\n\n${preview}`)
          : true
      if (!ok) return
      updateChatById(chat.appChatId, (source) => ({
        ...source,
        messages: source.messages.filter((m) => m.id !== messageId)
      }))
    },
    [updateChatById, pendingAgentQuestionByChatId, pendingPlanChoiceByChatId]
  )

  // 1.0.4-AQ4 — Delete a single message from the current chat's
  // transcript. Gates on `confirm()` because the action is
  // destructive and the user can't undo from the UI (no
  // tombstone). The orphan-pending guard below blocks deleting a
  // message that's currently the anchor of an in-flight
  // `pendingAgentQuestion` / `pendingPlanChoice` — deleting it
  // would strand the modal (its messageId would point at a row
  // that no longer exists in the transcript).
  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      deleteMessageFromChat(currentChat, messageId)
    },
    [currentChat, deleteMessageFromChat]
  )

  const handleOpenSideChatFromMessage = useCallback(
    (message: ChatMessage) => {
      if (!currentChat || !message?.id) return
      const roleLabel =
        message.role === 'user'
          ? 'user message'
          : message.role === 'assistant'
            ? 'assistant message'
            : `${message.role} message`
      const seedPrompt = [
        `Use this selected ${roleLabel} from the parent chat as the starting point.`,
        'This side chat is isolated and does not have the rest of the parent transcript unless I paste it here.',
        '',
        message.content.trim()
      ].join('\n')
      void ensureSideChatForCurrentChat(seedPrompt, false, 'split', {
        originMessageId: message.id
      })
    },
    [currentChat, ensureSideChatForCurrentChat]
  )
  const handleOpenSideChatFromRunResult = useCallback(
    (runId: string) => {
      if (!currentChat || !runId) return
      const sourceRun = (currentChat.runs || []).find((run) => run.runId === runId)
      const latestAssistantMessage = [...(currentChat.messages || [])]
        .reverse()
        .find((message) => message.role === 'assistant')
      const seedPrompt = [
        'Use this parent run result as the starting point.',
        'This side chat is isolated and does not have the full parent transcript unless I paste it here.',
        '',
        `Run ID: ${runId}`,
        sourceRun?.status ? `Run status: ${sourceRun.status}` : '',
        sourceRun?.startedAt ? `Started: ${sourceRun.startedAt}` : '',
        sourceRun?.endedAt ? `Ended: ${sourceRun.endedAt}` : '',
        latestAssistantMessage?.content?.trim()
          ? `Latest assistant response:\n\n${latestAssistantMessage.content.trim()}`
          : ''
      ]
        .filter(Boolean)
        .join('\n')
      void ensureSideChatForCurrentChat(seedPrompt, false, 'split', {
        originRunId: runId
      })
    },
    [currentChat, ensureSideChatForCurrentChat]
  )
  const selectedSideChatSeedMessage =
    sideChatSeedMessageId && currentChat?.messages
      ? currentChat.messages.find((message) => message.id === sideChatSeedMessageId) || null
      : null
  const handleMessageSelectionCandidate = useCallback((message: ChatMessage) => {
    if (!message?.id) return
    setSideChatSeedMessageId(message.id)
  }, [])
  const handleOpenSideChatFromSelectedMessage = useCallback(() => {
    if (!selectedSideChatSeedMessage) return
    handleOpenSideChatFromMessage(selectedSideChatSeedMessage)
    setSideChatMenuOpen(false)
  }, [handleOpenSideChatFromMessage, selectedSideChatSeedMessage])

  const handlePlanChoiceSubmit = (messageId: string, option: string) => {
    if (!currentWorkspace || !currentChat || !option.trim()) return

    setCurrentChat((prev) => {
      if (!prev) return prev
      const nextMessage: ChatMessage = {
        id: createMessageId(),
        role: 'user',
        content: option,
        timestamp: new Date().toISOString()
      }
      const updated = { ...prev, messages: [...prev.messages, nextMessage] }
      window.api.saveChat(updated)
      return updated
    })

    setPendingPlanChoice((prev) => (prev?.messageId === messageId ? null : prev))
    handleRun(undefined, option)
  }

  // QMOD (1.0.3) — user picked an answer (or typed free-text) for an
  // `ask_user_question` modal. Forward to main via IPC so the parked
  // MCP tool call resolves with the answer; also append a user-reply
  // message into the chat for transcript continuity so the trail of
  // "agent asked, user said X" stays visible after the modal closes.
  const handleAgentQuestionSubmit = useCallback(
    (questionId: string, answer: string, isCustom: boolean) => {
      const trimmed = answer.trim()
      if (!trimmed) return
      const targetChatId = currentChat?.appChatId
      const pending = targetChatId ? pendingAgentQuestionByChatId[targetChatId] || null : null
      if (pending && targetChatId) {
        updateChatById(targetChatId, (prev) => {
          const replyMsg: ChatMessage = {
            id: `agent-question-reply-${questionId}`,
            role: 'user',
            content: trimmed,
            timestamp: new Date().toISOString(),
            metadata: {
              kind: 'agentQuestionReply',
              questionId,
              respondedToMessageId: pending.messageId,
              isCustomAnswer: isCustom
            }
          }
          // Idempotent: don't append a duplicate if the user double-
          // clicked the button before state updates settle.
          if (prev.messages?.some((m) => m.id === replyMsg.id)) return prev
          return { ...prev, messages: [...(prev.messages || []), replyMsg] }
        })
      }
      if (targetChatId) {
        setPendingAgentQuestionForChat(targetChatId, (prev) =>
          prev?.questionId === questionId ? null : prev
        )
      }
      // Fire-and-forget — the parked Promise on main resolves and the
      // tool call returns to the agent. Errors here are benign (e.g.
      // the question already timed out) so we don't surface them.
      void window.api.answerAgentQuestion({ questionId, answer: trimmed, isCustom })
    },
    [
      currentChat?.appChatId,
      pendingAgentQuestionByChatId,
      updateChatById,
      setPendingAgentQuestionForChat
    ]
  )

  // QMOD (1.0.3) — user dismissed the modal without answering. The
  // agent's tool call resolves with `cancelled: true`; agent should
  // treat that as "skip / continue without answer" so the run isn't
  // pinned waiting forever (the 10-min timeout is the safety net).
  const handleAgentQuestionDismiss = useCallback(
    (questionId: string) => {
      const targetChatId = currentChat?.appChatId
      if (targetChatId) {
        setPendingAgentQuestionForChat(targetChatId, (prev) =>
          prev?.questionId === questionId ? null : prev
        )
      }
      void window.api.cancelAgentQuestion({ questionId, reason: 'user-dismissed' })
    },
    [currentChat?.appChatId, setPendingAgentQuestionForChat]
  )

  const handleRunFallback = async (fallbackModel: string) => {
    const capacityContext = getActiveRunContextForProvider('gemini')
    if (capacityContext?.capacityFallbackShown) {
      markCapacityStoppedRun(capacityContext, 'Gemini Pro capacity fallback selected.')
      clearQueuedRunsForProvider(
        'gemini',
        'Cancelled because Gemini capacity fallback was selected.'
      )
      await window.api
        .cancelAgentRun('gemini', capacityContext.runId)
        .catch(() => window.api.cancelGemini(capacityContext.runId))
      clearActiveRunContext(capacityContext)
      if (currentChatIdRef.current === capacityContext.chatId) {
        setIsThinking(false)
      }
    }

    setSelectedModelType(fallbackModel)
    setLastNonCustomModelType(fallbackModel)
    rememberCurrentChatComposerSelection({ selectedModelType: fallbackModel })

    // Find the last user message
    const msgs = currentChat?.messages || []
    let lastUserPrompt = ''
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        lastUserPrompt = msgs[i].content
        break
      }
    }

    if (lastUserPrompt) {
      handleRun(fallbackModel, lastUserPrompt)
    }
  }

  const handleAgentApprovalAction = async (requestId: string, action: AgentApprovalAction) => {
    // Order-4 — capture the optional intent note (trimmed) at decision
    // time and pass it down to the IPC, which stamps it onto the ledger
    // row's metadata. Empty stays undefined so we never persist a blank
    // note. Always optional — never gates the decision.
    const noteForDecision = intentNote.trim() || undefined
    try {
      await window.api.respondAgentApproval(requestId, action, noteForDecision)
      setRawLogs((prev) => [
        ...prev,
        {
          type: 'info',
          content: `${getProviderLabel(pendingAgentApproval?.provider || currentProvider)} approval response sent: ${action}`
        }
      ])
      if (action === 'acceptForWorkspace') {
        const settings = await window.api.getSettings()
        setAgenticWorkspaceGrantCount(
          Array.isArray(settings.agenticWorkspaceGrants)
            ? settings.agenticWorkspaceGrants.length
            : 0
        )
      }
    } catch (error) {
      setRawLogs((prev) => [
        ...prev,
        { type: 'stderr', content: `Failed to send approval response: ${redactLog(String(error))}` }
      ])
    } finally {
      // 1.0.4-AK4 — instead of nulling the head outright, advance
      // the queue so the next pending approval for this chat
      // (queued while the current one was on screen) becomes the
      // new head. When the queue is empty the head goes to null
      // as before. Pre-AK4 each chat held at most one in-flight
      // approval so this distinction didn't matter.
      const composerChatId = getCurrentComposerStateChatId()
      setPendingAgentApproval((prev) => (prev?.id === requestId ? null : prev))
      // Order-4 — reset the intent note so the next queued approval
      // (or the next request entirely) starts with an empty field.
      setIntentNote('')
      if (composerChatId) {
        advanceApprovalQueueForChat(composerChatId)
      }
    }
  }

  const refreshGeminiMcpBridgeStatus = async () => {
    if (typeof window.api.getGeminiMcpBridgeStatus !== 'function') return
    try {
      const status = await window.api.getGeminiMcpBridgeStatus()
      setGeminiMcpBridgeStatus(status)
    } catch (error) {
      setRawLogs((prev) => [
        ...prev,
        { type: 'stderr', content: `Gemini MCP bridge status failed: ${redactLog(String(error))}` }
      ])
    }
  }

  const refreshProductOperationsStatus = async () => {
    if (typeof window.api.getProductOperationsStatus !== 'function') return
    try {
      const status = await window.api.getProductOperationsStatus()
      setProductOperationsStatus(status)
      setRawLogs((prev) => [
        ...prev,
        { type: 'info', content: `Product operations health: ${status.overallStatus}` }
      ])
    } catch (error) {
      setRawLogs((prev) => [
        ...prev,
        {
          type: 'stderr',
          content: `Product operations health check failed: ${redactLog(String(error))}`
        }
      ])
    }
  }

  const exportProductDiagnostics = async () => {
    if (typeof window.api.exportProductDiagnostics !== 'function') return
    try {
      const result = await window.api.exportProductDiagnostics()
      if (result.ok) {
        setProductOperationsStatus(result.snapshot?.status || productOperationsStatus)
        setRawLogs((prev) => [
          ...prev,
          { type: 'info', content: `Diagnostics exported to ${result.path}` }
        ])
      } else if (result.error && result.error !== 'Diagnostics export cancelled.') {
        setRawLogs((prev) => [
          ...prev,
          {
            type: 'stderr',
            content: `Diagnostics export failed: ${redactLog(String(result.error))}`
          }
        ])
      }
    } catch (error) {
      setRawLogs((prev) => [
        ...prev,
        { type: 'stderr', content: `Diagnostics export failed: ${redactLog(String(error))}` }
      ])
    }
  }

  const repairProductInstall = async () => {
    if (typeof window.api.repairProductInstall !== 'function') return
    try {
      const status = await window.api.repairProductInstall()
      setProductOperationsStatus(status)
      setGeminiMcpBridgeStatus(
        status.bridgeHealth.find((item) => item.provider === 'gemini')?.rawStatus ||
          geminiMcpBridgeStatus
      )
      setRawLogs((prev) => [
        ...prev,
        { type: 'info', content: `Install repair completed with health: ${status.overallStatus}` }
      ])
    } catch (error) {
      setRawLogs((prev) => [
        ...prev,
        { type: 'stderr', content: `Install repair failed: ${redactLog(String(error))}` }
      ])
    }
  }

  const installGeminiMcpBridge = async () => {
    if (typeof window.api.installGeminiMcpBridge !== 'function') return
    try {
      const status = await window.api.installGeminiMcpBridge()
      setGeminiMcpBridgeEnabledState(true)
      setGeminiMcpBridgeStatus(status)
      setSettings((prev) =>
        prev ? { ...prev, geminiMcpBridgeEnabled: true, geminiMcpBridgeLastStatus: status } : prev
      )
      setRawLogs((prev) => [
        ...prev,
        { type: 'info', content: status.message || 'Gemini MCP bridge installed.' }
      ])
    } catch (error) {
      setRawLogs((prev) => [
        ...prev,
        { type: 'stderr', content: `Gemini MCP bridge install failed: ${redactLog(String(error))}` }
      ])
    }
  }

  const handleCancel = async () => {
    if (currentChat?.chatKind === 'ensemble') {
      await window.api.cancelEnsembleRound(currentChat.appChatId)
      setIsThinking(false)
      setChats(await window.api.getChats())
      return
    }
    const runId = currentRun?.runId
    await window.api.cancelAgentRun(currentProvider, runId)
    syncRunningState()
  }

  const handleGeminiTerminalSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const input = geminiTerminalInput
    if (!input.trim()) {
      return
    }

    setGeminiTerminalInput('')
    setRawLogs((prev) => [...prev, { type: 'info', content: `> ${input}` }])

    try {
      const didWrite = await window.api.writeGeminiInput(`${input}\n`)
      if (!didWrite) {
        setRawLogs((prev) => [
          ...prev,
          {
            type: 'info',
            content: 'No active Gemini process/session is currently accepting terminal input.'
          }
        ])
      }
    } catch (error) {
      setRawLogs((prev) => [
        ...prev,
        {
          type: 'stderr',
          content: `Failed to write Gemini terminal input: ${redactLog(String(error))}`
        }
      ])
    }
  }

  const startGeminiTerminalResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = geminiTerminalHeight

    const handleMouseMove = (moveEvent: MouseEvent) => {
      setGeminiTerminalHeight(clampGeminiTerminalHeight(startHeight - (moveEvent.clientY - startY)))
    }

    const handleMouseUp = () => {
      document.body.classList.remove('is-resizing-gemini-terminal')
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    document.body.classList.add('is-resizing-gemini-terminal')
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const handleGeminiTerminalResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      return
    }

    event.preventDefault()
    const step = event.shiftKey ? 48 : 20
    if (event.key === 'ArrowUp') {
      setGeminiTerminalHeight((current) => clampGeminiTerminalHeight(current + step))
    } else if (event.key === 'ArrowDown') {
      setGeminiTerminalHeight((current) => clampGeminiTerminalHeight(current - step))
    } else if (event.key === 'Home') {
      setGeminiTerminalHeight(MIN_GEMINI_TERMINAL_HEIGHT)
    } else if (event.key === 'End') {
      setGeminiTerminalHeight(clampGeminiTerminalHeight(window.innerHeight))
    }
  }

  useEffect(() => {
    if (queuedRuns.length === 0) return

    // Pure scheduling decision lives in main (Phase B3.3 extraction). The
    // renderer pump still orchestrates the lease + execute side effects, but
    // the "which job runs next" choice is now shared with future remote
    // pumpers via `findNextRunnableQueueIndex`.
    //
    // Phase J3: per-chat busy predicate. A queued job dispatches as soon
    // as its TARGET chat is idle, even if the same provider is busy in a
    // different chat. Parallel-per-chat dispatch matches both Codex's
    // app-server thread model and the user's mental model ("I queued
    // this in chat B; chat A finishing shouldn't be the trigger").
    const nextIndex = findNextRunnableQueueIndex(
      queuedRuns,
      (job) => !isChatBusy(job.chatRecord?.appChatId)
    )
    if (nextIndex < 0) return

    const nextRun = queuedRuns[nextIndex]
    const remainingRuns = queuedRuns.filter((_, index) => index !== nextIndex)
    setQueuedRuns(remainingRuns)
    void window.api
      .leaseRunQueueJob({
        runId: nextRun.appRunId,
        provider: nextRun.provider,
        statusReason: 'Dequeued by TaskWraith scheduler.'
      })
      .then((leased) => {
        if (!leased) {
          setQueuedRuns((prev) => [nextRun, ...prev])
          return
        }
        appEventHandlersRef.current.appendThreadRawLog(nextRun.chatRecord?.appChatId, {
          type: 'info',
          content: `Starting queued ${getProviderLabel(nextRun.provider)} run. ${remainingRuns.length} queued task${remainingRuns.length === 1 ? '' : 's'} remain.`
        })
        void executeRunRef.current({ ...nextRun, appRunId: leased.runId })
      })
  }, [queuedRuns, runningChatIds, currentWorkspace, currentChat])

  useEffect(() => {
    try {
      window.localStorage.setItem('taskwraith.fileEditorWidth', String(fileEditorWidth))
    } catch {
      // Local persistence is best-effort only.
    }
  }, [fileEditorWidth])

  useEffect(() => {
    try {
      window.localStorage.setItem('taskwraith.workspaceSidebarWidth', String(workspaceSidebarWidth))
    } catch {
      // Local persistence is best-effort only.
    }
  }, [workspaceSidebarWidth])

  useEffect(() => {
    try {
      window.localStorage.setItem(GHOST_COMPANION_STORAGE_KEY, String(showGhostCompanion))
    } catch {
      // Local persistence is best-effort only.
    }
  }, [showGhostCompanion])

  useEffect(() => {
    try {
      window.localStorage.setItem(SKY_VISUAL_FX_STORAGE_KEY, String(showSkyVisualFx))
    } catch {
      // Local persistence is best-effort only.
    }
  }, [showSkyVisualFx])

  useEffect(() => {
    if (!showSkyVisualFx) {
      return
    }

    let isDisposed = false
    const refreshHostWeather = async (): Promise<void> => {
      try {
        const nextWeather = await window.api.getHostWeather()
        if (!isDisposed) {
          setHostWeather(nextWeather)
        }
      } catch {
        if (!isDisposed) {
          const hour = new Date().getHours()
          setHostWeather({
            kind: 'unknown',
            description: hour >= 7 && hour < 19 ? 'Local daytime sky' : 'Local night sky',
            isDay: hour >= 7 && hour < 19,
            updatedAt: new Date().toISOString(),
            source: 'fallback'
          })
        }
      }
    }

    void refreshHostWeather()
    const weatherInterval = window.setInterval(() => {
      void refreshHostWeather()
    }, SKY_WEATHER_REFRESH_MS)

    return () => {
      isDisposed = true
      window.clearInterval(weatherInterval)
    }
  }, [showSkyVisualFx])

  const startRightPanelResize = (
    panel: 'fileEditor' | 'inspector',
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = panel === 'fileEditor' ? fileEditorWidth : appearance.inspectorWidth
    const maxWidth = Math.min(
      MAX_RIGHT_PANEL_WIDTH,
      Math.max(MIN_RIGHT_PANEL_WIDTH, Math.floor(window.innerWidth * 0.58))
    )

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.max(
        MIN_RIGHT_PANEL_WIDTH,
        Math.min(maxWidth, startWidth - (moveEvent.clientX - startX))
      )
      if (panel === 'fileEditor') {
        setFileEditorWidth(clampPanelWidth(nextWidth))
      } else {
        appearance.update({ inspectorWidth: clampPanelWidth(nextWidth) })
      }
    }

    const handleMouseUp = () => {
      document.body.classList.remove('is-resizing-panel')
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    document.body.classList.add('is-resizing-panel')
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const startWorkspaceSidebarResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = workspaceSidebarWidth
    const maxWidth = Math.min(
      MAX_WORKSPACE_SIDEBAR_WIDTH,
      Math.max(MIN_WORKSPACE_SIDEBAR_WIDTH, Math.floor(window.innerWidth * 0.42))
    )

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.max(
        MIN_WORKSPACE_SIDEBAR_WIDTH,
        Math.min(maxWidth, startWidth + (moveEvent.clientX - startX))
      )
      setWorkspaceSidebarWidth(clampWorkspaceSidebarWidth(nextWidth))
    }

    const handleMouseUp = () => {
      document.body.classList.remove('is-resizing-workspace-sidebar')
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    document.body.classList.add('is-resizing-workspace-sidebar')
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const handleWorkspaceSidebarResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return
    }

    event.preventDefault()
    const maxWidth = Math.min(
      MAX_WORKSPACE_SIDEBAR_WIDTH,
      Math.max(MIN_WORKSPACE_SIDEBAR_WIDTH, Math.floor(window.innerWidth * 0.42))
    )
    const step = event.shiftKey ? 40 : 16
    let nextWidth = workspaceSidebarWidth

    if (event.key === 'ArrowLeft') nextWidth = workspaceSidebarWidth - step
    if (event.key === 'ArrowRight') nextWidth = workspaceSidebarWidth + step
    if (event.key === 'Home') nextWidth = MIN_WORKSPACE_SIDEBAR_WIDTH
    if (event.key === 'End') nextWidth = maxWidth

    setWorkspaceSidebarWidth(
      clampWorkspaceSidebarWidth(
        Math.max(MIN_WORKSPACE_SIDEBAR_WIDTH, Math.min(maxWidth, nextWidth))
      )
    )
  }

  const handleRightPanelResizeKeyDown = (
    panel: 'fileEditor' | 'inspector',
    event: React.KeyboardEvent<HTMLDivElement>
  ) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return
    }

    event.preventDefault()
    const maxWidth = Math.min(
      MAX_RIGHT_PANEL_WIDTH,
      Math.max(MIN_RIGHT_PANEL_WIDTH, Math.floor(window.innerWidth * 0.58))
    )
    const currentWidth = panel === 'fileEditor' ? fileEditorWidth : appearance.inspectorWidth
    const step = event.shiftKey ? 40 : 16
    let nextWidth = currentWidth

    if (event.key === 'ArrowLeft') nextWidth = currentWidth + step
    if (event.key === 'ArrowRight') nextWidth = currentWidth - step
    if (event.key === 'Home') nextWidth = MIN_RIGHT_PANEL_WIDTH
    if (event.key === 'End') nextWidth = maxWidth

    const clampedWidth = Math.max(MIN_RIGHT_PANEL_WIDTH, Math.min(maxWidth, nextWidth))
    if (panel === 'fileEditor') {
      setFileEditorWidth(clampPanelWidth(clampedWidth))
    } else {
      appearance.update({ inspectorWidth: clampPanelWidth(clampedWidth) })
    }
  }

  const startSideChatResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sideChatWidth
    const maxWidth = getSideChatMaxWidth()

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.max(
        MIN_SIDE_CHAT_WIDTH,
        Math.min(maxWidth, startWidth - (moveEvent.clientX - startX))
      )
      setSideChatSplitWidth(nextWidth)
    }

    const handleMouseUp = () => {
      document.body.classList.remove('is-resizing-side-chat')
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    document.body.classList.add('is-resizing-side-chat')
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const handleSideChatResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return
    }

    event.preventDefault()
    const maxWidth = getSideChatMaxWidth()
    const step = event.shiftKey ? 40 : 16
    let nextWidth = sideChatWidth

    if (event.key === 'ArrowLeft') nextWidth = sideChatWidth + step
    if (event.key === 'ArrowRight') nextWidth = sideChatWidth - step
    if (event.key === 'Home') nextWidth = MIN_SIDE_CHAT_WIDTH
    if (event.key === 'End') nextWidth = maxWidth

    setSideChatSplitWidth(nextWidth)
  }

  const openWorkspacePopoutWindow = useCallback(
    (kind: 'file-editor' | 'diff-studio') => {
      if (!currentWorkspacePopoutPath) return
      void window.api.openWorkspacePopout({
        kind,
        workspacePath: currentWorkspacePopoutPath
      })
    },
    [currentWorkspacePopoutPath]
  )

  const openChatPopoutWindow = useCallback(() => {
    if (!currentChat?.appChatId) return
    writeChatPopoutHandoff(currentChat.appChatId, {
      draft: prompt,
      scrollState: captureChatScrollState(transcriptScrollRef.current)
    })
    void window.api.openWorkspacePopout({
      kind: 'chat',
      chatId: currentChat.appChatId,
      workspacePath: currentChat.workspacePath
    })
  }, [currentChat?.appChatId, currentChat?.workspacePath])

  const dockChatPopoutWindow = useCallback(
    (presentation: SidePanelPresentation) => {
      if (!isChatPopoutWindow || !currentChat?.appChatId) return
      void window.api.dockSideChatPopout({
        chatId: currentChat.appChatId,
        presentation,
        draft: prompt,
        scrollState: captureChatScrollState(transcriptScrollRef.current)
      })
    },
    [currentChat?.appChatId, isChatPopoutWindow, prompt]
  )

  const keyboardActionsRef = useRef({
    clearImagePermissions,
    handleRun,
    openChatPopoutWindow,
    openWorkspacePopoutWindow,
    rememberCurrentChatComposerSelection,
    setCommandPaletteQuery,
    setIsCommandPaletteOpen,
    syncPersistentModelSelection
  })
  keyboardActionsRef.current = {
    clearImagePermissions,
    handleRun,
    openChatPopoutWindow,
    openWorkspacePopoutWindow,
    rememberCurrentChatComposerSelection,
    setCommandPaletteQuery,
    setIsCommandPaletteOpen,
    syncPersistentModelSelection
  }

  useEffect(() => {
    const handleAppKeyDown = (event: KeyboardEvent) => {
      const keyboardActions = keyboardActionsRef.current
      const target = event.target as HTMLElement | null
      const tagName = target?.tagName?.toLowerCase()
      const isEditableTarget = Boolean(
        target?.isContentEditable ||
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select'
      )
      const command = getKeyCommandForEvent(
        event,
        resolveKeyCommandBindings(settings?.keyCommandBindings)
      )
      if (!command || (isEditableTarget && !command.allowWhenEditable)) {
        return
      }

      const runKeyCommand = (commandId: KeyCommandId): void => {
        if (commandId === 'close-overlays') {
          if (isCommandPaletteOpen) {
            keyboardActions.setIsCommandPaletteOpen(false)
            keyboardActions.setCommandPaletteQuery('')
            return
          }
          if (showSettings) {
            setShowSettings(false)
            return
          }
          if (permissionRequestPaths.length > 0) {
            keyboardActions.clearImagePermissions()
            return
          }
          if (selectedModelType === 'custom') {
            setCustomModel('')
            setSelectedModelType(lastNonCustomModelType)
            keyboardActions.rememberCurrentChatComposerSelection({
              customModel: '',
              selectedModelType: lastNonCustomModelType
            })
            if (currentProvider === 'gemini') {
              keyboardActions.syncPersistentModelSelection(lastNonCustomModelType)
            }
          }
          return
        }
        if (commandId === 'run-prompt') {
          keyboardActions.handleRun()
          return
        }
        if (commandId === 'command-palette') {
          keyboardActions.setIsCommandPaletteOpen(true)
          return
        }
        if (commandId === 'settings') {
          if (isChatPopoutWindow) return
          setShowSettings(true)
          return
        }
        if (commandId === 'toggle-sidebar') {
          if (isChatPopoutWindow) return
          setShowWorkspaceSidebar((current) => !current)
          return
        }
        if (commandId === 'toggle-inspector') {
          if (isChatPopoutWindow) return
          const nextShowInspector = !appearance.showInspector
          if (nextShowInspector && window.innerWidth <= 1180) {
            setShowFileEditor(false)
          }
          appearance.update({ showInspector: nextShowInspector })
          return
        }
        if (commandId === 'toggle-file-editor') {
          if (isChatPopoutWindow) return
          if (!hasWorkspaceContext) return
          setShowFileEditor((current) => {
            const nextShowFileEditor = !current
            if (nextShowFileEditor && window.innerWidth <= 1180 && appearance.showInspector) {
              appearance.update({ showInspector: false })
            }
            return nextShowFileEditor
          })
          return
        }
        if (commandId === 'open-diff-studio-window') {
          keyboardActions.openWorkspacePopoutWindow('diff-studio')
          return
        }
        if (commandId === 'open-file-editor-window') {
          keyboardActions.openWorkspacePopoutWindow('file-editor')
          return
        }
        if (commandId === 'popout-chat-window') {
          keyboardActions.openChatPopoutWindow()
        }
      }

      event.preventDefault()
      runKeyCommand(command.id)
    }

    window.addEventListener('keydown', handleAppKeyDown)
    return () => window.removeEventListener('keydown', handleAppKeyDown)
  }, [
    appearance,
    currentProvider,
    isCommandPaletteOpen,
    lastNonCustomModelType,
    permissionRequestPaths.length,
    selectedModelType,
    settings?.keyCommandBindings,
    showSettings,
    hasWorkspaceContext,
    isChatPopoutWindow
  ])

  const isOldVersion = geminiVersion !== 'unknown' && geminiVersion < '0.39.1'
  // Phase I3.2 — stable array view of the running-chat set so the
  // transcript/sidebar/header status surfaces can rely on referential
  // equality across renders (React.memo + Set semantics don't play well).
  //
  // Kimi-specific fix: the Kimi wire-mode child keeps the process alive
  // while it waits for an `ApprovalRequest` response, so no `agent-exit`
  // fires and `runningChatIds` would otherwise hold onto the chat. Drop
  // Kimi chats with a pending approval from the "running" view so the
  // sidebar badge clears while the user is mid-elicitation. Once they
  // resolve the approval, the next `agent-output`/`agent-exit` traffic
  // restores the badge via the existing `setRunningChatIds` path. Other
  // providers retain the legacy semantics.
  //
  // Defensive secondary filter (orphan in-memory entries): also drop
  // chats whose persisted `runs[]` already shows a terminal entry —
  // covers the case where `handleProviderExit` early-returned because
  // the active-run context had been evicted, or `cancelAgentRun`
  // killed the child without an `agent-exit` IPC. Both leave the chat
  // glued to `runningChatIds` and would otherwise paint "Running"
  // indefinitely. Pair this with `applyRecoveryRecordsToChatRuns` (in
  // `applyRecoveryRecordsToChats` above) which backfills `endedAt` on
  // boot, so even orphans from a previous app session pass through
  // this filter on startup.
  const chatsByAppChatIdForRunning = useMemo(() => {
    const map: Record<string, ChatRecord> = {}
    for (const chat of chats) {
      map[chat.appChatId] = chat
    }
    return map
  }, [chats])
  const activeRunQueueChatIds = useMemo(
    () =>
      runQueueJobs
        .filter((job) => job.chatId && ACTIVE_RUN_QUEUE_STATUSES.has(job.status))
        .map((job) => job.chatId!)
        .filter(Boolean),
    [runQueueJobs]
  )
  const runningChatIdsArray = useMemo(
    () =>
      Array.from(
        new Set([
          ...visibleRunningChatIds(
            runningChatIds,
            pendingAgentApprovalByChatId,
            chatsByAppChatIdForRunning
          ),
          ...activeRunQueueChatIds
        ])
      ),
    [runningChatIds, pendingAgentApprovalByChatId, chatsByAppChatIdForRunning, activeRunQueueChatIds]
  )
  const hasCurrentChatActiveRunQueueJob = Boolean(
    currentChat?.appChatId &&
      runQueueJobs.some(
        (job) =>
          job.chatId === currentChat.appChatId && ACTIVE_RUN_QUEUE_STATUSES.has(job.status)
      )
  )
  const isCurrentChatRunning = Boolean(
    currentChat?.appChatId &&
    (runningChatIds.has(currentChat.appChatId) ||
      hasCurrentChatActiveRunQueueJob ||
      currentChat.ensemble?.activeRound?.status === 'running')
  )
  const isCurrentEnsembleChat = currentChat?.chatKind === 'ensemble'
  const isEnsembleModeEnabled = settings?.ensembleModeEnabled !== false
  const isCurrentComposerLocked = isCurrentChatRunning && !isCurrentEnsembleChat

  // Slice F v2 (1.0.3) — which participant chip the composer pickers
  // currently target. Lives in App.tsx (not the chip-strip component)
  // because the composer's existing CombinedModelPicker /
  // CombinedPermissionsPicker read this to decide whether they're
  // editing the chat or the selected participant.
  //
  // Default selection: first enabled participant in `order`. On chat
  // switch the useMemo below picks a fresh default. During a running
  // round, an effect lower in the render syncs the selection to
  // `activeRound.activeParticipantId` so the user sees the speaker's
  // settings live.
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null)
  const ensembleParticipantsForCurrent = useMemo(
    () => [...(currentChat?.ensemble?.participants || [])].sort((a, b) => a.order - b.order),
    [currentChat?.ensemble?.participants]
  )
  const ensembleEnabledParticipantsForCurrent = useMemo(
    () =>
      isCurrentEnsembleChat
        ? ensembleParticipantsForCurrent.filter((participant) => participant.enabled)
        : [],
    [isCurrentEnsembleChat, ensembleParticipantsForCurrent]
  )
  const ensembleBlendStyle = useMemo<CSSProperties | undefined>(() => {
    if (!isCurrentEnsembleChat || ensembleEnabledParticipantsForCurrent.length === 0) {
      return undefined
    }
    const style: CSSProperties = {}
    ensembleEnabledParticipantsForCurrent.slice(0, 4).forEach((participant, idx) => {
      ;(style as Record<string, string>)[`--ensemble-provider-${idx + 1}`] =
        `var(--provider-${participant.provider}-color)`
    })
    return style
  }, [isCurrentEnsembleChat, ensembleEnabledParticipantsForCurrent])
  const effectiveSelectedParticipantId = useMemo(() => {
    if (!isCurrentEnsembleChat) return null
    const explicit = ensembleParticipantsForCurrent.find((p) => p.id === selectedParticipantId)
    if (explicit) return explicit.id
    const firstEnabled = ensembleParticipantsForCurrent.find((p) => p.enabled)
    return firstEnabled?.id || ensembleParticipantsForCurrent[0]?.id || null
  }, [isCurrentEnsembleChat, ensembleParticipantsForCurrent, selectedParticipantId])
  const selectedParticipant = useMemo(
    () =>
      effectiveSelectedParticipantId
        ? ensembleParticipantsForCurrent.find((p) => p.id === effectiveSelectedParticipantId) ||
          null
        : null,
    [ensembleParticipantsForCurrent, effectiveSelectedParticipantId]
  )
  // 1.0.4-AT2 — finalise the runtime-profile picker derivation now
  // that `selectedParticipant` is in scope. In Ensemble + selected
  // participant, the picker reads the participant's
  // `runtimeProfileId` and filters the profile list by the
  // participant's provider. Solo chats and Ensemble-without-
  // selection keep the chat-level behavior set above.
  const runtimePickerScope = resolveRuntimePickerScope({
    chat: currentChat,
    chatLevelSelection: chatLevelSelectedRuntimeProfileId,
    chatLevelProvider: currentProvider,
    selectedParticipant: isCurrentEnsembleChat ? selectedParticipant : null
  })
  selectedRuntimeProfileId =
    runtimePickerScope.selectedRuntimeProfileId ||
    defaultRuntimeProfileIdForProvider(runtimePickerScope.provider)
  currentProviderRuntimeProfiles = runtimeProfiles.filter(
    (profile) => profile.provider === runtimePickerScope.provider
  )
  const currentEnsembleRound = currentChat?.ensemble?.activeRound
  const currentEnsembleOrchestrationMode: EnsembleOrchestrationMode =
    currentChat?.ensemble?.orchestrationMode === 'continuous' ? 'continuous' : 'turn_bound'
  const activeEnsembleOrchestrationMode: EnsembleOrchestrationMode =
    currentEnsembleRound?.orchestrationMode === 'continuous'
      ? 'continuous'
      : currentEnsembleOrchestrationMode
  const currentEnsembleConcurrentMode = Boolean(currentChat?.ensemble?.concurrentModeEnabled)
  const activeEnsembleConcurrentMode =
    currentEnsembleRound?.concurrentMode ?? currentEnsembleConcurrentMode
  const currentEnsembleContinuationHops = currentEnsembleRound?.continuationHops || 0
  const currentEnsembleMaxContinuationHops =
    currentEnsembleRound?.maxContinuationHops || currentChat?.ensemble?.maxContinuationHops || 6
  const isCurrentEnsembleRoundRunning = currentEnsembleRound?.status === 'running'
  // Slice F v2 (1.0.3) — write-through helper used by the composer
  // pickers when an ensemble chip is selected. Patches the targeted
  // participant in chat.ensemble.participants and persists. Same
  // chat-state plumbing as the chip-strip's onChatChange callback —
  // kept as a separate callback so picker handlers can call it
  // without going through the strip component.
  const updateSelectedParticipant = useCallback(
    (patch: Partial<EnsembleParticipant>) => {
      if (!isCurrentEnsembleChat || !selectedParticipant || !currentChat?.ensemble) return
      const patchedChat: ChatRecord = {
        ...currentChat,
        ensemble: {
          ...currentChat.ensemble,
          participants: currentChat.ensemble.participants.map((p) =>
            p.id === selectedParticipant.id ? { ...p, ...patch } : p
          ),
          updatedAt: new Date().toISOString()
        }
      }
      const nextChat = withSessionActivityLedger(currentChat, patchedChat)
      chatByIdRef.current.set(nextChat.appChatId, nextChat)
      setCurrentChat((prev) => (prev?.appChatId === nextChat.appChatId ? nextChat : prev))
      setChats((prev) => prev.map((c) => (c.appChatId === nextChat.appChatId ? nextChat : c)))
      void window.api.saveChat(nextChat)
    },
    [isCurrentEnsembleChat, selectedParticipant, currentChat]
  )
  const updateCurrentEnsembleOrchestrationMode = useCallback(
    (mode: EnsembleOrchestrationMode) => {
      if (!isCurrentEnsembleChat || !currentChat?.ensemble) return
      updateChatById(currentChat.appChatId, (source) => {
        const patched: ChatRecord = {
          ...source,
          ensemble: {
            ...source.ensemble!,
            orchestrationMode: mode,
            // 1.0.4-AR2 — track the global ceiling of 8 (was 6).
            // 1.0.5-EW1 — ceiling raised again 8 → 12. Preserve any
            // existing per-chat override that's already within
            // [2, 12] instead of clobbering it to the cap.
            maxParticipants:
              Number.isFinite(source.ensemble!.maxParticipants) &&
              source.ensemble!.maxParticipants >= 2 &&
              source.ensemble!.maxParticipants <= 12
                ? source.ensemble!.maxParticipants
                : 12,
            maxContinuationHops: source.ensemble!.maxContinuationHops || 6,
            updatedAt: new Date().toISOString()
          }
        }
        return withSessionActivityLedger(source, patched)
      })
    },
    [isCurrentEnsembleChat, currentChat?.appChatId, currentChat?.ensemble, updateChatById]
  )
  const updateCurrentEnsembleConcurrentMode = useCallback(
    (enabled: boolean) => {
      if (!isCurrentEnsembleChat || !currentChat?.ensemble) return
      updateChatById(currentChat.appChatId, (source) => {
        if (!source.ensemble) return source
        const patched: ChatRecord = {
          ...source,
          ensemble: {
            ...source.ensemble,
            concurrentModeEnabled: enabled,
            updatedAt: new Date().toISOString()
          }
        }
        return withSessionActivityLedger(source, patched)
      })
    },
    [isCurrentEnsembleChat, currentChat?.appChatId, currentChat?.ensemble, updateChatById]
  )

  // D — persist the user-set shared-transcript char budget (5K–500K) onto
  // chat.ensemble.ensembleContextChars. Drives buildTaggedTranscript's budget
  // for the NEXT round; clamped here so a malformed value never lands.
  const updateCurrentEnsembleContextChars = useCallback(
    (nextChars: number) => {
      if (!isCurrentEnsembleChat || !currentChat?.ensemble) return
      const safeChars = Math.max(5_000, Math.min(500_000, Math.round(Number(nextChars) || 0)))
      if (!Number.isFinite(safeChars) || safeChars <= 0) return
      updateChatById(currentChat.appChatId, (source) => {
        if (!source.ensemble) return source
        const patched: ChatRecord = {
          ...source,
          ensemble: {
            ...source.ensemble,
            ensembleContextChars: safeChars,
            updatedAt: new Date().toISOString()
          }
        }
        return withSessionActivityLedger(source, patched)
      })
    },
    [isCurrentEnsembleChat, currentChat?.appChatId, currentChat?.ensemble, updateChatById]
  )

  // 1.0.6 — persist the user-set max handoff turns for continuous rounds onto
  // chat.ensemble.maxContinuationHops. Range-clamped at the call site
  // (ContinuousHopsLimitChip enforces 1–50); we still guard here so a malformed
  // value never lands in the store. New value takes effect immediately for the
  // NEXT round; an in-flight round keeps its captured cap (currentEnsembleMax-
  // ContinuationHops reads `round.maxContinuationHops || chat.ensemble.max…`),
  // which matches the rest of the per-round captured-config pattern in this app.
  const updateCurrentEnsembleMaxContinuationHops = useCallback(
    (nextMax: number) => {
      if (!isCurrentEnsembleChat || !currentChat?.ensemble) return
      const safeMax = Math.max(1, Math.min(50, Math.round(Number(nextMax) || 0)))
      if (!Number.isFinite(safeMax) || safeMax <= 0) return
      updateChatById(currentChat.appChatId, (source) => {
        if (!source.ensemble) return source
        const patched: ChatRecord = {
          ...source,
          ensemble: {
            ...source.ensemble,
            maxContinuationHops: safeMax,
            updatedAt: new Date().toISOString()
          }
        }
        return withSessionActivityLedger(source, patched)
      })
    },
    [isCurrentEnsembleChat, currentChat?.appChatId, currentChat?.ensemble, updateChatById]
  )

  // 1.0.4-AK2 — Work Session lifecycle callbacks wired to the setup
  // sheet + session strip. The sheet's confirm handler persists the
  // WorkSessionConfig onto the chat ensemble AND pre-fills the
  // composer textarea with the first-round prompt so the user
  // clicks Send to launch (avoids re-implementing send-message
  // payload composition). Stop calls cancelEnsembleRound which
  // already clears queuedPrompts; we then flip the session status
  // to 'cancelled' so the round-end check finalises cleanly.
  const handleConfirmWorkSession = useCallback(
    ({
      config,
      initialPrompt,
      roundMode,
      synthesizerParticipantId
    }: WorkSessionSetupConfirmInput) => {
      if (!isCurrentEnsembleChat || !currentChat?.ensemble) return
      updateChatById(currentChat.appChatId, (source) => {
        return applyWorkSessionConfirmation(source, {
          config,
          roundMode,
          synthesizerParticipantId
        })
      })
      setShowWorkSessionSheet(false)
      // Pre-fill the composer with the initial prompt so the user
      // can scan it once before launching. Setting via setPrompt
      // keeps the textarea reactive (the change handler picks up
      // mention overlay updates etc.).
      setPrompt(initialPrompt)
    },
    [
      isCurrentEnsembleChat,
      currentChat?.appChatId,
      currentChat?.ensemble,
      setPrompt,
      updateChatById
    ]
  )
  const handleStopWorkSession = useCallback(async () => {
    if (!isCurrentEnsembleChat || !currentChat?.ensemble?.workSession) return
    // First cancel any in-flight round + clear queued continuations.
    try {
      await window.api.cancelEnsembleRound(currentChat.appChatId)
    } catch {
      // cancelEnsembleRound surfaces its own errors via toast; we
      // proceed to mark the session cancelled regardless so the UI
      // doesn't show a stale active strip after a failed cancel.
    }
    updateChatById(currentChat.appChatId, (source) => {
      return cancelWorkSessionOnChat(source)
    })
  }, [
    isCurrentEnsembleChat,
    currentChat?.appChatId,
    currentChat?.ensemble?.workSession,
    updateChatById
  ])
  // Ensemble round-complete notice — fires once when the round
  // transitions to `completed` (or `cancelled`). Solo chats use the
  // per-run-exit notice path; for ensemble we suppress that and
  // emit here instead, so the card reflects round-level metadata
  // rather than the last participant's individual run.
  //
  // Lifecycle:
  //   - `completed` / `cancelled` → emit the notice (once per round).
  //   - `running` (new round started) → CLEAR any stale notice from
  //     a previous round so the user doesn't see a stale "Task
  //     complete" card overlapping a live run.
  //   - The ref dedupes within a single round so chat broadcasts
  //     landing in pairs (debounce + finalise) don't refire.
  const lastEnsembleRoundCompleteRef = useRef<string | null>(null)
  useEffect(() => {
    if (!isCurrentEnsembleChat) return
    const round = currentChat?.ensemble?.activeRound
    if (!round) return
    if (round.status === 'running') {
      // A new round (or a round-restart) is live — wipe any notice
      // left from a previous round. The dedupe ref also resets so
      // the upcoming round-end CAN fire a fresh notice.
      if (lastEnsembleRoundCompleteRef.current !== round.roundId) {
        lastEnsembleRoundCompleteRef.current = null
        setRunCompleteNotice(null)
      }
      return
    }
    if (round.status !== 'completed' && round.status !== 'cancelled') return
    if (lastEnsembleRoundCompleteRef.current === round.roundId) return
    lastEnsembleRoundCompleteRef.current = round.roundId
    setIsThinking(false)
    setRunCompleteNotice({
      timestamp: round.endedAt || new Date().toISOString(),
      // Treat `cancelled` like a non-zero exit so the card surfaces
      // the cancellation outcome via the existing copy.
      exitCode: round.status === 'cancelled' ? 130 : 0,
      startedAt: round.startedAt || undefined
    })
  }, [
    isCurrentEnsembleChat,
    currentChat?.ensemble?.activeRound?.roundId,
    currentChat?.ensemble?.activeRound,
    currentChat?.ensemble?.activeRound?.status,
    currentChat?.ensemble?.activeRound?.startedAt,
    currentChat?.ensemble?.activeRound?.endedAt
  ])

  // Auto-follow the active speaker during a running round so the
  // composer pickers always reflect who's speaking. When the round
  // isn't running, the selection is purely user-driven.
  //
  // Override path (1.0.3, post-ship-night UX fix): if the user
  // explicitly clicks a chip mid-round, auto-follow yields to user
  // intent so they can adjust a non-speaking participant's settings
  // without the next speaker-change clobbering their selection.
  // The override resets when the round transitions out of `running`
  // — the next round starts with fresh auto-follow behaviour.
  const userOverrodeSelectionRef = useRef(false)
  useEffect(() => {
    if (!isCurrentEnsembleChat) return
    const round = currentChat?.ensemble?.activeRound
    if (round?.status !== 'running') {
      // Round not running → drop any override so the next round
      // resumes auto-follow from a clean state.
      userOverrodeSelectionRef.current = false
      return
    }
    if (userOverrodeSelectionRef.current) return
    const activeId = round?.activeParticipantId
    if (!activeId) return
    if (activeId === selectedParticipantId) return
    setSelectedParticipantId(activeId)
  }, [
    isCurrentEnsembleChat,
    currentChat?.ensemble?.activeRound,
    currentChat?.ensemble?.activeRound?.activeParticipantId,
    currentChat?.ensemble?.activeRound?.status,
    selectedParticipantId
  ])
  // Click handler that records the override before applying the
  // selection. Passed to the chip strip as `onSelectParticipant`.
  const handleSelectParticipant = useCallback(
    (id: string) => {
      const status = currentChat?.ensemble?.activeRound?.status
      if (status === 'running') {
        userOverrodeSelectionRef.current = true
      }
      setSelectedParticipantId(id)
    },
    [currentChat?.ensemble?.activeRound?.status]
  )
  // Phase J3 (steer): the composer Steer button is visible while the
  // current chat has an in-flight run. `isChatBusy` is the per-chat
  // busy predicate already used by every queue-decision site.
  const isCurrentChatBusyForSteer = Boolean(
    currentChat?.appChatId &&
    (isChatBusy(currentChat.appChatId) || currentChat.ensemble?.activeRound?.status === 'running')
  )
  const steerIndicatorMessage = currentChat?.appChatId
    ? getSteerIndicatorMessage({
        state: steerState,
        chatId: currentChat.appChatId,
        providerLabel: getProviderLabel(currentProvider)
      })
    : null
  const isSteerBusyForCurrentChat = isSteerInFlight({
    state: steerState,
    chatId: currentChat?.appChatId || null
  })
  const currentProviderLabel = getProviderLabel(currentProvider)
  /*
    Composer-unification (Phase J1): placeholder follows the active
    provider, not the composer theme. Ensemble chats override this with
    provider-neutral copy because dispatch runs through participants, not
    the chat-level fallback provider.
  */
  const composerPlaceholder = isCurrentEnsembleChat
    ? 'Ask the ensemble. @ to direct a participant.'
    : currentProvider === 'codex'
      ? 'Ask Codex anything. @ to mention files'
      : currentProvider === 'claude'
        ? 'Describe a task or ask a question'
        : currentProvider === 'gemini'
          ? 'Ask Gemini'
          : currentProvider === 'kimi'
            ? 'Type "/" to quickly access skills'
            : `Enter prompt for ${currentProviderLabel}…`
  const composerAriaLabel = isCurrentEnsembleChat
    ? 'Prompt for Ensemble'
    : `Prompt for ${currentProviderLabel}`
  // Slice B: in an ensemble round, the "Thinking…" label should track the
  // actually-speaking participant — not the chat's base provider, which is
  // always "Codex" for ensemble chats. Falls back to the chat's provider
  // label for non-ensemble chats.
  //
  // Also derive the provider ID alongside the label so the renderer can
  // apply the matching `.provider-{name}` class to the thinking-indicator's
  // message-meta — same provider-tint treatment as the assistant labels
  // in the rest of the transcript.
  const { thinkingProviderLabel, thinkingProvider, thinkingModelBadge } = (() => {
    const activeRound = currentChat?.ensemble?.activeRound
    if (activeRound?.activeParticipantId) {
      const participant = currentChat?.ensemble?.participants.find(
        (p) => p.id === activeRound.activeParticipantId
      )
      if (participant) {
        const baseModelName = participant.model
          ? shortModelName(participant.provider, '', participant.model)
          : null
        // Mirror the assistant-header treatment in `formatAssistantMessageLabel`:
        // append the participant's reasoning effort / thinking flag so
        // the in-flight indicator reads "5.5 Extra High" / "K2.6
        // Thinking" — matching the composer chip the user picked.
        // `reasoningDisplayLabel` short-circuits to '' for providers
        // without a reasoning axis or when effort is 'off'.
        const thinkingReasoningSuffix = baseModelName
          ? reasoningDisplayLabel({
              provider: participant.provider,
              composerStyle: 'default',
              modelId: participant.model || '',
              modelLabel: '',
              codexReasoningEffort:
                participant.provider === 'codex' ? participant.reasoningEffort : undefined,
              claudeReasoningEffort:
                participant.provider === 'claude' ? participant.reasoningEffort : undefined,
              kimiThinkingEnabled:
                participant.provider === 'kimi' ? participant.thinkingEnabled : undefined
            })
          : ''
        return {
          thinkingProviderLabel: getProviderLabel(participant.provider),
          thinkingProvider: participant.provider as ProviderId | null,
          // Show the short model name alongside the "Codex Thinking…"
          // chip so the user can see at a glance which configured
          // model is actually producing the in-flight output. Empty
          // for participants without a custom model (legacy chats).
          thinkingModelBadge: baseModelName
            ? thinkingReasoningSuffix
              ? `${baseModelName} ${thinkingReasoningSuffix}`
              : baseModelName
            : null
        }
      }
    }
    // Ensemble fallback: when `activeParticipantId` is briefly cleared
    // (between one participant finalising and the next being seeded),
    // do NOT fall back to the chat's base provider. That field is the
    // user's last-active provider when the ensemble chat was created
    // (commonly 'codex'), so the indicator would show "Codex
    // Thinking…" for ~50-200ms even when Kimi or Gemini is about to
    // speak — confusing and wrong. Show a neutral "Ensemble" label
    // with no provider tint instead.
    if (currentChat?.chatKind === 'ensemble') {
      return {
        thinkingProviderLabel: 'Ensemble',
        thinkingProvider: null as ProviderId | null,
        thinkingModelBadge: null as string | null
      }
    }
    return {
      thinkingProviderLabel: currentProviderLabel,
      thinkingProvider: currentProvider as ProviderId | null,
      thinkingModelBadge: null as string | null
    }
  })()
  // Slice C (revised): clear the "Thinking…" indicator when the ensemble
  // round has already finished. Otherwise the indicator persists after the
  // last participant yields and the user sees stale "Codex Thinking…" even
  // though the round is over and the surface is back to "awaiting input".
  // For non-ensemble chats this passes through `isThinking` unchanged.
  const ensembleRoundStatus = currentChat?.ensemble?.activeRound?.status
  const effectiveIsThinking =
    isThinking && ensembleRoundStatus !== 'completed' && ensembleRoundStatus !== 'cancelled'
  const currentRun = currentChat?.runs?.[currentChat.runs.length - 1]
  const sideRun = sideChat?.runs?.[sideChat.runs.length - 1]
  const hasSideChatActiveRunQueueJob = Boolean(
    sideChat?.appChatId &&
      runQueueJobs.some(
        (job) => job.chatId === sideChat.appChatId && ACTIVE_RUN_QUEUE_STATUSES.has(job.status)
      )
  )
  const isSideChatRunning = Boolean(
    sideChat?.appChatId &&
      (runningChatIds.has(sideChat.appChatId) ||
        hasSideChatActiveRunQueueJob ||
        sideChat.ensemble?.activeRound?.status === 'running')
  )
  const sideRunCompleteNotice = sideChat
    ? deriveRunCompleteNotice(sideChat, isSideChatRunning)
    : null
  const sideThinkingProviderLabel =
    sideChat?.chatKind === 'ensemble' ? 'Ensemble' : getProviderLabel(sideProvider)
  const sideThinkingProvider = sideChat?.chatKind === 'ensemble' ? null : sideProvider
  const sideCanRun = Boolean(sideChat && (getChatScope(sideChat) === 'global' || sideWorkspace))
  const sideComposerSelection = sideChat ? getChatComposerSelection(sideChat, sideProvider) : null
  const sideComposerProvider = sideComposerSelection?.provider || sideProvider
  const sideComposerModelOptionsRaw = getProviderModelOptions(sideComposerProvider)
  const sideComposerSelectedModel = sideComposerSelection?.selectedModelType
    ? isValidModelForProvider(sideComposerProvider, sideComposerSelection.selectedModelType)
      ? sideComposerSelection.selectedModelType
      : getDefaultModelForProvider(sideComposerProvider)
    : getDefaultModelForProvider(sideComposerProvider)
  const sideComposerModelOptions: CombinedModelPickerModelOption[] = [
    ...sideComposerModelOptionsRaw.map((model) => {
      const retiresAtRaw = (model as { retiresAt?: unknown }).retiresAt
      const retiresAt = typeof retiresAtRaw === 'string' ? retiresAtRaw : undefined
      return {
        id: model.id,
        label: model.label || model.id,
        ...(retiresAt ? { retiresAt } : {})
      }
    }),
    ...(sideComposerProvider !== 'kimi' ? [{ id: 'custom', label: 'Custom…' }] : [])
  ]
  const sideCodexModelOption =
    sideComposerProvider === 'codex'
      ? codexModels.find((model) => model.id === sideComposerSelectedModel)
      : undefined
  const sideClaudeModelOption =
    sideComposerProvider === 'claude'
      ? (agentModelsByProvider.claude || CLAUDE_DEFAULT_MODELS).find(
          (model) => model.id === sideComposerSelectedModel
        )
      : undefined
  const sideCodexReasoning =
    sideComposerSelection?.codexReasoningEffort ||
    sideCodexModelOption?.defaultReasoningEffort ||
    'medium'
  const sideClaudeReasoning = sideComposerSelection?.claudeReasoningEffort || 'off'
  const sideKimiThinking = sideComposerSelection?.kimiThinkingEnabled ?? true
  let sideComposerReasoningOptions: CombinedModelPickerReasoningOption[] = []
  let sideComposerSelectedReasoning = ''
  if (sideComposerProvider === 'codex') {
    const sourceOptions = sideCodexModelOption?.supportedReasoningEfforts?.length
      ? sideCodexModelOption.supportedReasoningEfforts
      : [
          { reasoningEffort: 'low' },
          { reasoningEffort: 'medium' },
          { reasoningEffort: 'high' },
          { reasoningEffort: 'xhigh' }
        ]
    sideComposerReasoningOptions = sourceOptions.map((option) => ({
      value: option.reasoningEffort,
      label:
        option.reasoningEffort === 'xhigh'
          ? 'Extra High'
          : option.reasoningEffort.charAt(0).toUpperCase() + option.reasoningEffort.slice(1)
    }))
    sideComposerSelectedReasoning = sideCodexReasoning
  } else if (sideComposerProvider === 'claude') {
    const sourceOptions = sideClaudeModelOption?.supportedReasoningEfforts?.length
      ? sideClaudeModelOption.supportedReasoningEfforts
      : CLAUDE_THINKING_EFFORTS
    sideComposerReasoningOptions = sourceOptions.map((option) => ({
      value: option.reasoningEffort,
      label:
        option.reasoningEffort === 'off'
          ? 'Thinking off'
          : option.reasoningEffort === 'high'
            ? 'Max'
            : option.reasoningEffort.charAt(0).toUpperCase() + option.reasoningEffort.slice(1)
    }))
    sideComposerSelectedReasoning = sideClaudeReasoning
  } else if (sideComposerProvider === 'kimi') {
    sideComposerReasoningOptions = [
      { value: 'on', label: 'Thinking on' },
      { value: 'off', label: 'Thinking off' }
    ]
    sideComposerSelectedReasoning = sideKimiThinking ? 'on' : 'off'
  }
  const sideFastModeCapableModelIds = (() => {
    if (sideComposerProvider === 'codex') {
      return new Set(
        codexModels
          .filter((model) => model.additionalSpeedTiers?.includes('fast'))
          .map((model) => model.id)
      )
    }
    if (sideComposerProvider === 'claude') {
      return new Set(
        (agentModelsByProvider.claude || CLAUDE_DEFAULT_MODELS)
          .filter((model) => model.additionalSpeedTiers?.includes('fast'))
          .map((model) => model.id)
      )
    }
    if (sideComposerProvider === 'cursor') {
      return new Set(['composer-2.5', 'composer-2.5-fast'])
    }
    return new Set<string>()
  })()
  const sideFastModeEnabled =
    sideComposerProvider === 'codex'
      ? sideComposerSelection?.codexServiceTier === 'fast'
      : sideComposerProvider === 'claude'
        ? Boolean(sideComposerSelection?.claudeFastMode)
        : sideComposerProvider === 'cursor'
          ? sideComposerSelectedModel === 'composer-2.5-fast'
          : false
  const sidePermissionOptions: PermissionOption[] = [
    { value: 'plan', label: 'Plan / Read-only' },
    { value: 'default', label: 'Default Approval' },
    { value: 'auto_edit', label: 'Full Workspace Access' }
  ]
  const sideSelectedPermission = sideComposerSelection?.approvalMode || 'default'
  const sideIsGlobalChat = sideChat ? isGlobalChat(sideChat) : false
  const sideGrantWorkspacePath = sideWorkspace?.path || ''
  const sideEnabledGrantIds = new Set(
    !sideIsGlobalChat && sideGrantWorkspacePath
      ? agenticWorkspaceGrants
          .filter((grant) => {
            if (!grant || grant.provider !== sideComposerProvider || !grant.workspacePath) {
              return false
            }
            return grant.workspacePath.replace(/\/+$/, '') === sideGrantWorkspacePath.replace(/\/+$/, '')
          })
          .map((grant) => grant.service)
      : []
  )
  const sideGrantServices = sideChat && !sideIsGlobalChat && sideWorkspace
    ? WORKSPACE_POLICY_SERVICES
    : []
  const isSideChatProviderLocked = Boolean(
    sideChat &&
      (sidePanelRelation !== 'sideChat' ||
        (sideChat.messages?.length || 0) > 0 ||
        (sideChat.runs?.length || 0) > 0 ||
        Boolean(sideChat.linkedGeminiSessionId) ||
        Boolean(sideChat.linkedProviderSessionId))
  )
  const sideChatIsWelcome = Boolean(sideChat && (sideChat.messages?.length || 0) === 0)
  const isSideComposerLocked = Boolean(isSideChatRunning && sideChat?.chatKind !== 'ensemble')
  const sideComposerHasMention = Boolean(
    sideChat && hasResolvedMention(sidePrompt, sideChat.ensemble?.participants || [])
  )
  const rememberSideChatComposerSelection = (patch: Record<string, unknown>) => {
    if (!sideChat) return
    updateChatById(sideChat.appChatId, (source) => ({
      ...source,
      providerMetadata: {
        ...(source.providerMetadata || {}),
        ...patch
      },
      updatedAt: Date.now()
    }))
  }
  const handleSideProviderChange = (provider: ProviderId): void => {
    if (!sideChat || isSideChatProviderLocked || provider === sideComposerProvider) return
    const nextModel = getDefaultModelForProvider(provider)
    updateChatById(sideChat.appChatId, (source) => ({
      ...source,
      provider,
      providerMetadata: {
        ...(source.providerMetadata || {}),
        selectedModelType: nextModel,
        customModel: '',
        approvalMode: sideSelectedPermission,
        ...(provider === 'kimi' ? { kimiThinkingEnabled: true } : {}),
        runtimeProfileId: defaultRuntimeProfileIdForProvider(provider)
      },
      updatedAt: Date.now()
    }))
    void refreshProviderMetadata(provider, sideWorkspace?.path)
  }
  const handleSideModelChange = (nextModel: string): void => {
    if (!sideChat) return
    const metadataPatch: Record<string, unknown> = { selectedModelType: nextModel }
    if (sideComposerProvider === 'codex') {
      const modelOption = codexModels.find((model) => model.id === nextModel)
      if (modelOption?.defaultReasoningEffort) {
        metadataPatch.codexReasoningEffort = modelOption.defaultReasoningEffort
      }
      if (!modelOption?.additionalSpeedTiers?.includes('fast')) {
        metadataPatch.codexServiceTier = ''
      }
    }
    if (sideComposerProvider === 'claude') {
      const modelOption = (agentModelsByProvider.claude || CLAUDE_DEFAULT_MODELS).find(
        (model) => model.id === nextModel
      )
      if (!modelOption?.additionalSpeedTiers?.includes('fast')) {
        metadataPatch.claudeFastMode = false
      }
    }
    rememberSideChatComposerSelection(metadataPatch)
  }
  const handleSideReasoningChange = (value: string): void => {
    if (!sideChat) return
    if (sideComposerProvider === 'codex') {
      rememberSideChatComposerSelection({ codexReasoningEffort: value })
    } else if (sideComposerProvider === 'claude') {
      rememberSideChatComposerSelection({ claudeReasoningEffort: value })
    } else if (sideComposerProvider === 'kimi') {
      rememberSideChatComposerSelection({ kimiThinkingEnabled: value !== 'off' })
    }
  }
  const handleSideToggleFastMode =
    sideComposerProvider === 'codex'
      ? () =>
          rememberSideChatComposerSelection({
            codexServiceTier: sideComposerSelection?.codexServiceTier === 'fast' ? '' : 'fast'
          })
      : sideComposerProvider === 'claude'
        ? () =>
            rememberSideChatComposerSelection({
              claudeFastMode: !sideComposerSelection?.claudeFastMode
            })
        : sideComposerProvider === 'cursor'
          ? () =>
              handleSideModelChange(
                sideComposerSelectedModel === 'composer-2.5-fast'
                  ? 'composer-2.5'
                  : 'composer-2.5-fast'
              )
          : undefined
  const handleSetSideAgenticWorkspaceGrant = async (
    service: AgenticServiceId,
    enabled: boolean
  ) => {
    if (!sideChat || sideIsGlobalChat || !sideWorkspace?.path) return
    const nextSettings = enabled
      ? await window.api.upsertAgenticWorkspaceGrant(
          sideComposerProvider,
          sideWorkspace.path,
          service
        )
      : await window.api.removeAgenticWorkspaceGrant(
          sideComposerProvider,
          sideWorkspace.path,
          service
        )
    applyAgenticWorkspaceGrantSettings(nextSettings)
  }
  const composerRunTimecodeStartedAt = isCurrentChatRunning
    ? currentEnsembleRound?.startedAt || currentRun?.startedAt || null
    : null
  const chatTokenTally = useMemo(
    () => buildChatTokenTally(currentChat?.runs || []),
    [currentChat?.runs]
  )
  const liveRunOutputTokens = useMemo(() => {
    if (!isCurrentChatRunning || !currentChat) return 0
    const activeRunIds = new Set(
      (currentChat.runs || [])
        .filter((run) => !run.endedAt || run.status === 'running' || run.status === 'queued')
        .map((run) => run.runId)
        .filter((runId): runId is string => Boolean(runId))
    )
    if (activeRunIds.size === 0 && currentRun?.runId) {
      activeRunIds.add(currentRun.runId)
    }
    const activeRoundStartedAt =
      currentChat.ensemble?.activeRound?.status === 'running'
        ? Date.parse(currentChat.ensemble.activeRound.startedAt || '')
        : Number.NaN
    let liveChars = 0
    for (const message of currentChat.messages || []) {
      if (message.role !== 'assistant') continue
      if (message.runId && activeRunIds.has(message.runId)) {
        liveChars += message.content?.length || 0
        continue
      }
      if (Number.isFinite(activeRoundStartedAt)) {
        const messageTime = Date.parse(message.timestamp || '')
        if (Number.isFinite(messageTime) && messageTime >= activeRoundStartedAt) {
          liveChars += message.content?.length || 0
        }
      }
    }
    return estimateLiveOutputTokensFromChars(liveChars)
  }, [
    currentChat,
    currentChat?.ensemble?.activeRound?.startedAt,
    currentChat?.ensemble?.activeRound?.status,
    currentRun?.runId,
    isCurrentChatRunning
  ])
  // 1.0.4-AR10 — cumulative session timecode base. Derived from the
  // sealed run records (`endedAt - startedAt` per run, summed) so it
  // survives reloads automatically and pauses naturally between runs
  // (the in-flight run is added live inside the component itself).
  const cumulativeRunBaseMs = useMemo(
    () => computeCumulativeRunBaseMs(currentChat?.runs),
    [currentChat?.runs]
  )
  const cumulativeChatTokens =
    chatTokenTally.totalTokens + (isCurrentChatRunning ? liveRunOutputTokens : 0)
  const latestRunLimits = extractUsageLimits(currentRun?.stats)
  const contextModelId = currentRun?.actualModel || currentRun?.requestedModel || selectedModelType
  const contextWindowSize = resolveContextWindow(
    currentProvider,
    contextModelId,
    latestRunLimits.totalTokenLimit
  )
  const contextUsedPercent =
    contextWindowSize > 0 ? Math.min(100, (cumulativeChatTokens / contextWindowSize) * 100) : 0
  const contextLabel = `${formatContextTokens(cumulativeChatTokens)} / ${formatContextTokens(contextWindowSize)} context`
  // 1.0.5-EW25 — pass the user's display currency through so cost
  // numbers respect their Settings → General choice. Defaults to
  // USD if settings haven't hydrated yet, matching the helper's
  // own fallback.
  //
  // 1.0.5-EW34 — same idea for the conservative-overestimate bias
  // percent (sub-slice e). Clamped at the call site so a stored
  // value outside 0–25 can't surprise the formatter. Defaults to 0
  // (no bias) when the setting hasn't hydrated.
  const displayCurrency = (settings?.currency ?? 'USD') as DisplayCurrency
  const overestimatePercent = Math.max(
    0,
    Math.min(25, Number(settings?.currencyOverestimatePercent ?? 0) || 0)
  )
  const threadTokenTallyHasValue = chatTokenTally.totalTokens > 0 || liveRunOutputTokens > 0
  // B1 (1.0.3) — per-participant breakdown for the ensemble tally
  // footer's hover tooltip. Solo chats: `null` (the existing
  // `contextLabel` stays as the tooltip). Ensemble chats: a
  // multi-line breakdown like
  //   "Explorer: 1.2k in / 0.5k out · $0.02
  //    Worker:   3.0k in / 1.2k out · $0.04"
  // so users can see where the cumulative cost came from without
  // leaving the composer surface.
  const ensembleTallyBreakdown = useMemo(() => {
    if (!isCurrentEnsembleChat) return null
    return formatEnsembleTokenBreakdown(
      currentChat?.runs || [],
      currentChat?.ensemble?.participants || [],
      displayCurrency,
      overestimatePercent
    )
  }, [
    isCurrentEnsembleChat,
    currentChat?.runs,
    currentChat?.ensemble?.participants,
    displayCurrency,
    overestimatePercent
  ])
  const threadTokenTallyTooltip = ensembleTallyBreakdown
    ? `${contextLabel}\n\n${ensembleTallyBreakdown}`
    : contextLabel
  // Git-grounded workspace diff stats for the above-bar "N files changed +A −B"
  // pill. Sourced from the live primaryGitSnapshot (counts.changed + numstat
  // lineStats) rather than accumulating tool-activity diffSummary across the
  // whole transcript — so it reflects the CURRENT working tree and drops to 0
  // the moment the user commits (Codex/Claude-style), instead of growing
  // run-over-run. Zeros before the snapshot lands or for a non-repo workspace.
  const workspaceDiffStats = useMemo(
    () => ({
      filesChanged: primaryGitSnapshot?.counts?.changed ?? 0,
      additions: primaryGitSnapshot?.lineStats?.additions ?? 0,
      deletions: primaryGitSnapshot?.lineStats?.deletions ?? 0
    }),
    [primaryGitSnapshot]
  )
  // P4 — the per-grant and per-path TRANSCRIPT diff accumulators that used to
  // live here (externalPathDiffStatsByGrant / externalPathLiveDiffByPath) were
  // removed: the additional-workspace rows now read git-grounded diff from
  // `externalGitSnapshots` (the per-path snapshot fetch below), so each row's
  // "N files changed +A -B" reflects the working tree and resets on commit —
  // the same git grounding as the primary row, instead of summing tool activity
  // across the whole transcript.
  // P1 — collapse the per-provider grants (an ensemble mints one grant per
  // participant-provider for the same folder) into ONE group per unique path,
  // so the composer shows one native row per workspace instead of N duplicates.
  // Map insertion order follows externalPathGrants (already sorted by
  // order/path), so first-seen path order is preserved. access = union (any
  // write -> write); providers = the distinct list for the merged tooltip.
  const externalWorkspaceGroups = useMemo(() => {
    const byPath = new Map<
      string,
      {
        path: string
        representative: ExternalPathGrant
        access: 'read' | 'write'
        providers: ExternalPathGrant['provider'][]
      }
    >()
    for (const grant of externalPathGrants) {
      const existing = byPath.get(grant.path)
      if (existing) {
        if (grant.access === 'write') existing.access = 'write'
        if (!existing.providers.includes(grant.provider)) existing.providers.push(grant.provider)
      } else {
        byPath.set(grant.path, {
          path: grant.path,
          representative: grant,
          access: grant.access,
          providers: [grant.provider]
        })
      }
    }
    return Array.from(byPath.values())
  }, [externalPathGrants])
  // Fetch a live git snapshot per unique external path on the same triggers as
  // the primary (paths change, run-finish, window focus). gitSnapshot accepts an
  // arbitrary repoPath; non-repos resolve to null and simply show no diff.
  const externalWorkspacePathsKey = useMemo(
    () => externalWorkspaceGroups.map((group) => group.path).join('\n'),
    [externalWorkspaceGroups]
  )
  useEffect(() => {
    const paths = externalWorkspacePathsKey ? externalWorkspacePathsKey.split('\n') : []
    if (paths.length === 0) {
      setExternalGitSnapshots({})
      return
    }
    let cancelled = false
    const fetchAll = async (): Promise<void> => {
      const entries = await Promise.all(
        paths.map(async (path) => {
          try {
            const res = await window.api.gitSnapshot({ repoPath: path })
            return [path, res?.ok ? res.data : null] as const
          } catch {
            return [path, null] as const
          }
        })
      )
      if (!cancelled) setExternalGitSnapshots(Object.fromEntries(entries))
    }
    void fetchAll()
    const onFocus = (): void => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void fetchAll()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
    }
  }, [externalWorkspacePathsKey, runCompleteNotice?.timestamp])
  const currentProviderModelOptions = getProviderModelOptions(currentProvider)
  const selectedComposerModelType = isValidModelForProvider(currentProvider, selectedModelType)
    ? selectedModelType
    : getDefaultModelForProvider(currentProvider)
  const currentAgentStatus =
    currentProvider === 'codex' ? codexStatus : agentStatusByProvider[currentProvider]
  const currentAgentMcpStatus =
    currentProvider === 'codex' ? codexMcpStatus : agentMcpStatusByProvider[currentProvider]
  const currentProviderCapabilities = providerCapabilitiesByProvider[currentProvider]
  const currentProviderCapabilityWarning = currentProviderCapabilities?.warnings.find(
    (warning) => warning.severity !== 'info'
  )
  const queuedRunQueueCount = runQueueJobs.filter((job) => job.status === 'queued').length
  const currentChatQueuedRunCount = runQueueJobs.filter(
    (job) => job.chatId === currentChat?.appChatId && job.status === 'queued'
  ).length
  // Set of `appRunId`s whose run-queue job is still in `'queued'`
  // status. Used by the transcript dedup filter to suppress the
  // in-transcript "Queued (#N): …" system card while the queued-
  // messages above-row is showing it live. Once the job dispatches
  // (status leaves `'queued'`), the card resurfaces as the
  // historical "this run was queued" record.
  const pendingQueuedAppRunIds = useMemo(() => {
    const set = new Set<string>()
    for (const job of runQueueJobs) {
      if (job.status !== 'queued') continue
      if (typeof job.runId === 'string' && job.runId) set.add(job.runId)
    }
    return set
  }, [runQueueJobs])
  // Composer above-row stack input: queued requests targeting the
  // active chat, projected to the row component's narrow display
  // shape. Two sources merge here:
  //
  //   1. `queuedRuns` — the renderer-local solo-chat queue. Populated
  //      when the user sends while a non-ensemble run is busy.
  //
  //   2. `chat.ensemble.activeRound.queuedPrompt` — the orchestrator's
  //      single-string queue for ensemble rounds (set when the user
  //      sends while an ensemble round is still running). Ensemble
  //      queueing has a different mechanism than solo queues, so my
  //      first cut at this component missed it entirely.
  //
  // The ensemble entry uses a synthetic id keyed off the active
  // round + 'ensemble-pending' so the row stays stable across
  // re-renders. The Skip / Steer / Edit actions for ensemble entries
  // delegate to the right ensemble-aware paths.
  const queuedMessagesAboveRowEntries: QueuedMessageRowEntry[] = useMemo(() => {
    if (!currentChat) return []
    const chatId = currentChat.appChatId
    const entries: QueuedMessageRowEntry[] = queuedRuns
      .filter((request) => request.chatRecord?.appChatId === chatId)
      .map((request) => ({
        id: request.appRunId || `${request.provider}-${request.prompt.slice(0, 16)}`,
        provider: request.provider,
        prompt: request.displayPrompt || request.prompt,
        dmTargetParticipantId: request.dmTargetParticipantId
      }))
    // Append every ensemble-round queued prompt. The orchestrator
    // now supports a FIFO queue (`activeRound.queuedPrompts`); the
    // legacy `queuedPrompt` field stays in sync with the head for
    // back-compat readers. Iterate the array so the stack shows
    // every pending entry with its own Edit / Delete / Steer.
    const ensembleRound = currentChat.ensemble?.activeRound
    if (ensembleRound?.status === 'running') {
      const prompts =
        Array.isArray(ensembleRound.queuedPrompts) && ensembleRound.queuedPrompts.length > 0
          ? ensembleRound.queuedPrompts
          : ensembleRound.queuedPrompt
            ? [ensembleRound.queuedPrompt]
            : []
      const ensembleProvider: ProviderId =
        currentChat.provider ||
        currentChat.ensemble?.participants.find((p) => p.enabled)?.provider ||
        'codex'
      for (let idx = 0; idx < prompts.length; idx += 1) {
        entries.push({
          id: `ensemble-queued-${ensembleRound.roundId}-${idx}`,
          provider: ensembleProvider,
          prompt: prompts[idx]
        })
      }
    }
    return entries
  }, [currentChat, queuedRuns])
  // Edit: hoist the queued prompt into the composer textarea and
  // remove the queue entry. Most chat apps do this when the user
  // clicks "Edit" on a queued message — the result is a fresh
  // draft the user can revise + resend, not a magical in-place
  // mutator.
  const handleEditQueuedMessage = useCallback(
    (entryId: string) => {
      // Ensemble-queued entry: synthetic id
      // `ensemble-queued-<roundId>-<idx>`. The trailing `<idx>` is the
      // FIFO position in `activeRound.queuedPrompts`. Edit hoists THAT
      // index's prompt into the composer and splices the same index
      // out of the array so the chain continues with the rest.
      const ensembleMatch = entryId.match(/^ensemble-queued-(.+)-(\d+)$/)
      if (ensembleMatch) {
        const idx = Number(ensembleMatch[2])
        const chat = currentChat
        const round = chat?.ensemble?.activeRound
        if (!chat || !round) return
        const currentQueue =
          Array.isArray(round.queuedPrompts) && round.queuedPrompts.length > 0
            ? round.queuedPrompts
            : round.queuedPrompt
              ? [round.queuedPrompt]
              : []
        const target = currentQueue[idx]
        if (!target) return
        setChatPromptDraft(chat.appChatId, target)
        const nextQueue = [...currentQueue.slice(0, idx), ...currentQueue.slice(idx + 1)]
        const nextChat: ChatRecord = {
          ...chat,
          ensemble: {
            ...chat.ensemble!,
            activeRound: {
              ...round,
              queuedPrompt: nextQueue[0],
              queuedPrompts: nextQueue
            },
            updatedAt: new Date().toISOString()
          }
        }
        chatByIdRef.current.set(nextChat.appChatId, nextChat)
        setCurrentChat((prev) => (prev?.appChatId === nextChat.appChatId ? nextChat : prev))
        setChats((prev) => prev.map((c) => (c.appChatId === nextChat.appChatId ? nextChat : c)))
        void window.api.saveChat(nextChat)
        return
      }
      const match = queuedRunsRef.current.find(
        (request) =>
          (request.appRunId || `${request.provider}-${request.prompt.slice(0, 16)}`) === entryId
      )
      if (!match) return
      const targetChatId = match.chatRecord?.appChatId || currentChat?.appChatId
      if (targetChatId) {
        setChatPromptDraft(targetChatId, match.displayPrompt || match.prompt)
      }
      setQueuedRuns((prev) =>
        prev.filter(
          (request) =>
            (request.appRunId || `${request.provider}-${request.prompt.slice(0, 16)}`) !== entryId
        )
      )
      if (match.appRunId) {
        void window.api
          .transitionRunQueueJob(match.appRunId, 'cancelled', {
            statusReason: 'Edited; returned to composer for revision.'
          })
          .catch(() => {})
      }
    },
    [currentChat, setChatPromptDraft]
  )
  // Delete: drop from local queue + transition the persistent job
  // to 'cancelled' so the store-backed listing doesn't resurrect it
  // on the next sync.
  const handleDeleteQueuedMessage = useCallback(
    (entryId: string) => {
      // Ensemble-queued: splice the targeted index out of the queue
      // and persist. The orchestrator's next round-end dispatch
      // reads from the front, so future entries remain in order.
      const ensembleMatch = entryId.match(/^ensemble-queued-(.+)-(\d+)$/)
      if (ensembleMatch) {
        const idx = Number(ensembleMatch[2])
        const chat = currentChat
        const round = chat?.ensemble?.activeRound
        if (!chat || !round) return
        const currentQueue =
          Array.isArray(round.queuedPrompts) && round.queuedPrompts.length > 0
            ? round.queuedPrompts
            : round.queuedPrompt
              ? [round.queuedPrompt]
              : []
        if (idx < 0 || idx >= currentQueue.length) return
        const nextQueue = [...currentQueue.slice(0, idx), ...currentQueue.slice(idx + 1)]
        const nextChat: ChatRecord = {
          ...chat,
          ensemble: {
            ...chat.ensemble!,
            activeRound: {
              ...round,
              queuedPrompt: nextQueue[0],
              queuedPrompts: nextQueue
            },
            updatedAt: new Date().toISOString()
          }
        }
        chatByIdRef.current.set(nextChat.appChatId, nextChat)
        setCurrentChat((prev) => (prev?.appChatId === nextChat.appChatId ? nextChat : prev))
        setChats((prev) => prev.map((c) => (c.appChatId === nextChat.appChatId ? nextChat : c)))
        void window.api.saveChat(nextChat)
        return
      }
      const match = queuedRunsRef.current.find(
        (request) =>
          (request.appRunId || `${request.provider}-${request.prompt.slice(0, 16)}`) === entryId
      )
      if (!match) return
      setQueuedRuns((prev) =>
        prev.filter(
          (request) =>
            (request.appRunId || `${request.provider}-${request.prompt.slice(0, 16)}`) !== entryId
        )
      )
      if (match.appRunId) {
        void window.api
          .transitionRunQueueJob(match.appRunId, 'cancelled', {
            statusReason: 'Cancelled from the queued-messages above-row.'
          })
          .catch(() => {})
      }
    },
    [currentChat]
  )
  // Steer to a queued item: cancel the chat's active run, then
  // dispatch this queued request immediately. Same gentle handoff
  // as the composer's Steer button — no restart of unrelated state.
  const handleSteerToQueuedMessage = useCallback(
    (entryId: string) => {
      // Ensemble-queued: cancel the current round and dispatch the
      // targeted queued prompt as a fresh round (mode='steer'). The
      // orchestrator's cancelRound clears `runtime.queuedPrompts`,
      // so we need to re-stage the remaining queue entries on the
      // NEW round after dispatch. For ship-night simplicity we only
      // promote the targeted index immediately; entries after it
      // get lost on the steer (a known trade-off — drag-to-reorder
      // gives the user a way to bring something else to the front
      // first if they prefer).
      const ensembleMatch = entryId.match(/^ensemble-queued-(.+)-(\d+)$/)
      if (ensembleMatch) {
        const idx = Number(ensembleMatch[2])
        const chat = currentChat
        const round = chat?.ensemble?.activeRound
        if (!chat || !round) return
        const currentQueue =
          Array.isArray(round.queuedPrompts) && round.queuedPrompts.length > 0
            ? round.queuedPrompts
            : round.queuedPrompt
              ? [round.queuedPrompt]
              : []
        const prompt = currentQueue[idx]
        if (!prompt) return
        // Optimistically remove the targeted entry from the local
        // chat record so the row updates immediately; the
        // orchestrator's steer flow rebuilds round state on
        // dispatch.
        const nextQueue = [...currentQueue.slice(0, idx), ...currentQueue.slice(idx + 1)]
        const nextChat: ChatRecord = {
          ...chat,
          ensemble: {
            ...chat.ensemble!,
            activeRound: {
              ...round,
              queuedPrompt: nextQueue[0],
              queuedPrompts: nextQueue
            }
          }
        }
        setCurrentChat((prev) => (prev?.appChatId === nextChat.appChatId ? nextChat : prev))
        void window.api.runEnsembleRound({
          chatId: chat.appChatId,
          prompt,
          mode: 'steer',
          concurrentMode: Boolean(chat.ensemble?.concurrentModeEnabled)
        })
        return
      }
      const match = queuedRunsRef.current.find(
        (request) =>
          (request.appRunId || `${request.provider}-${request.prompt.slice(0, 16)}`) === entryId
      )
      if (!match) return
      const targetChatId = match.chatRecord?.appChatId || currentChat?.appChatId
      // Remove from queue first so the schedule loop doesn't race
      // and dispatch it again from the queue.
      setQueuedRuns((prev) =>
        prev.filter(
          (request) =>
            (request.appRunId || `${request.provider}-${request.prompt.slice(0, 16)}`) !== entryId
        )
      )
      // Cancel current run if one is in flight, then dispatch this
      // request. `handleCancel` handles ensemble vs solo internally.
      const dispatchSteered = (): void => {
        if (match.appRunId) {
          void window.api
            .transitionRunQueueJob(match.appRunId, 'cancelled', {
              statusReason: 'Promoted via Steer; running now.'
            })
            .catch(() => {})
        }
        void executeRunRef.current({ ...match })
      }
      if (targetChatId && isChatBusy(targetChatId)) {
        void handleCancel().then(dispatchSteered)
      } else {
        dispatchSteered()
      }
    },
    // `handleCancel` intentionally remains live from the current render; queued steering only
    // needs this callback to refresh when the target chat changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentChat]
  )
  // Local reorder — updates `queuedRuns` array order so the schedule
  // loop dispatches in the new order. Persisting the order across
  // restarts would need a new IPC; deferred until it's wanted.
  const handleReorderQueuedMessages = useCallback((orderedIds: string[]) => {
    setQueuedRuns((prev) => {
      const byId = new Map<string, (typeof prev)[number]>()
      for (const request of prev) {
        const id = request.appRunId || `${request.provider}-${request.prompt.slice(0, 16)}`
        byId.set(id, request)
      }
      const next: typeof prev = []
      // First: the explicitly-ordered IDs from the drag.
      for (const id of orderedIds) {
        const entry = byId.get(id)
        if (entry) {
          next.push(entry)
          byId.delete(id)
        }
      }
      // Then: anything that wasn't in the drag scope (e.g. queue
      // items for OTHER chats, or items added while the drag was in
      // flight). Preserves their original order.
      for (const entry of prev) {
        const id = entry.appRunId || `${entry.provider}-${entry.prompt.slice(0, 16)}`
        if (byId.has(id)) next.push(entry)
      }
      return next
    })
  }, [])
  const hasCurrentHandoffDraft = Boolean(
    currentChat?.appChatId &&
    handoffCards.some(
      (card) => card.status === 'draft' && card.sourceChatId === currentChat.appChatId
    )
  )
  const advancedFxIntensity =
    appearance.advancedFx.intensity ||
    (appearance.funFxMode === 'off' ? 'cinematic' : appearance.funFxMode)
  const isAdvancedFxActive = isFxEnabled && !appearance.reduceMotion
  const runFxStatus: AgentAuraStatus = pendingAgentApproval
    ? 'approval'
    : isCurrentChatRunning
      ? 'running'
      : currentChatQueuedRunCount > 0
        ? 'queued'
        : currentRun?.status === 'failed'
          ? 'failed'
          : currentRun?.status === 'completed'
            ? 'complete'
            : hasCurrentHandoffDraft
              ? 'handoff'
              : 'idle'
  const showAgentAuraFx = isAdvancedFxActive && appearance.advancedFx.agentAura
  const showLivingWorkspaceFx = isAdvancedFxActive && appearance.advancedFx.livingWorkspace
  const showRunDataVizFx =
    isAdvancedFxActive &&
    appearance.advancedFx.dataViz &&
    (isCurrentChatRunning ||
      queuedRunQueueCount > 0 ||
      rawLogs.length > 0 ||
      Boolean(pendingAgentApproval))
  // Ensemble has no single provider — point the aura at a dedicated
  // multi-provider palette (`fx-provider-ensemble`, shard 05) instead of
  // the active provider's single-brand aura, so the glow reads as the
  // whole ensemble rather than (e.g.) Codex.
  const auraProviderKey = isCurrentEnsembleChat ? 'ensemble' : currentProvider
  const appAgentAuraClass = showAgentAuraFx
    ? `fx-agent-aura-root fx-provider-${auraProviderKey} fx-status-${runFxStatus} fx-intensity-${advancedFxIntensity}`
    : ''
  const composerAgentAuraClass = showAgentAuraFx
    ? `fx-agent-aura fx-provider-${auraProviderKey} fx-status-${runFxStatus} fx-intensity-${advancedFxIntensity}`
    : ''
  // Phase K-followup — `providerSessionLabel` ("New Codex thread" /
  // "{Provider} session linked") removed alongside its only consumer
  // (the non-interactive pill in the composer top-toggles row). The
  // session state is still visible via the sidebar tile + active
  // chat tab. If a future surface needs it, recompute from
  // `currentChat?.linkedProviderSessionId` + `currentProvider`.
  const currentCodexModelOption = codexModels.find(
    (model) => model.id === selectedComposerModelType
  )
  const codexReasoningOptions = currentCodexModelOption?.supportedReasoningEfforts?.length
    ? currentCodexModelOption.supportedReasoningEfforts
    : [
        { reasoningEffort: 'low' },
        { reasoningEffort: 'medium' },
        { reasoningEffort: 'high' },
        { reasoningEffort: 'xhigh' }
      ]
  const codexSupportsFast = Boolean(currentCodexModelOption?.additionalSpeedTiers?.includes('fast'))
  const currentClaudeModelOption =
    currentProvider === 'claude'
      ? (agentModelsByProvider.claude || CLAUDE_DEFAULT_MODELS).find(
          (model) => model.id === selectedComposerModelType
        )
      : undefined
  const claudeReasoningOptions = currentClaudeModelOption?.supportedReasoningEfforts?.length
    ? currentClaudeModelOption.supportedReasoningEfforts
    : CLAUDE_THINKING_EFFORTS
  const hasAgenticApprovalGate =
    agenticServices.shellCommands !== 'allow' ||
    agenticServices.fileChanges !== 'allow' ||
    agenticServices.mcpTools !== 'allow'
  const permissionModeLabel =
    approvalMode === 'plan'
      ? 'Read-only sandbox'
      : isCurrentGlobalChat
        ? 'System scope, prompts'
        : approvalMode === 'auto_edit'
          ? hasAgenticApprovalGate
            ? 'Workspace write, gated'
            : 'Workspace write, no prompts'
          : 'Workspace write, prompts'
  const geminiWorkspaceTrustReady =
    isCurrentGlobalChat ||
    trustResult?.status === 'trusted' ||
    trustResult?.status === 'inherited' ||
    sessionTrust
  const trustSelectValue = geminiWorkspaceTrustReady ? 'trusted' : 'untrusted'
  const persistentSessionLabel =
    persistentSessionStatus === 'active'
      ? 'Persistent session on'
      : persistentSessionStatus === 'starting'
        ? 'Starting session'
        : persistentSessionStatus === 'stopping'
          ? 'Stopping session'
          : persistentSessionStatus === 'unavailable'
            ? 'Session API unavailable'
            : persistentSessionStatus === 'error'
              ? 'Session error'
              : persistentSessionStatus === 'exited'
                ? 'Session exited'
                : 'Persistent session off'
  const geminiTerminalStatusLabel = isRunning
    ? 'attached to current run'
    : persistentSessionStatus === 'active'
      ? 'attached to persistent session'
      : 'waiting for Gemini'
  const visibleGeminiTerminalLogs = rawLogs.slice(-500)
  const currentWorktreeDiffUnavailable = isGeminiWorktreeDiffUnavailable(currentGeminiWorktree)
  const worktreeToggleLabel = currentGeminiWorktree?.enabled
    ? currentWorktreeDiffUnavailable
      ? 'Worktree: diff off'
      : `Worktree ${currentGeminiWorktree.name || 'auto'}`
    : 'Worktree off'
  const sessionRestartReason = persistentSessionNeedsRestart
    ? 'Restart session to apply run mode changes'
    : ''
  const showComposerBranchChip =
    Boolean(currentWorkspace?.branch) &&
    appearance.composerStyle !== 'obsidian' &&
    appearance.composerStyle !== 'alabaster'
  const showComposerChips =
    showComposerBranchChip ||
    (currentProvider === 'gemini' && currentWorktreeDiffUnavailable) ||
    (currentProvider === 'gemini' && persistentSessionNeedsRestart) ||
    Boolean(currentProviderCapabilityWarning) ||
    queuedRunQueueCount > 0
  const permissionRequestTitle =
    permissionRequestKind === 'workspace_trust'
      ? 'Workspace trust requested'
      : permissionRequestKind === 'tool_permission'
        ? 'Tool permission requested'
        : 'Attachment access requested'
  const currentRunDiff = currentRun?.runDiff
  const exactFileChangeSummaries = getRunFileDiffSummaries(runDiff || currentRunDiff || null)
  const liveToolFileChangeSummaries = useMemo(
    () =>
      getLiveToolFileDiffSummaries(
        currentChat?.messages || EMPTY_CHAT_MESSAGES,
        currentWorkspace?.path
      ),
    [currentChat?.messages, currentWorkspace?.path]
  )
  const fileChangeSummaries =
    exactFileChangeSummaries.length > 0 ? exactFileChangeSummaries : liveToolFileChangeSummaries
  const fileChangeSummaryEstimated =
    exactFileChangeSummaries.length === 0 && liveSummariesAreFuzzy(liveToolFileChangeSummaries)
  const displayFileChangeSummaries = useMemo(
    () => fileChangeSummaries.filter((item) => !item.isNoise),
    [fileChangeSummaries]
  )
  const createdChangeCount = displayFileChangeSummaries.filter(
    (item) => item.status === 'created'
  ).length
  const modifiedChangeCount = displayFileChangeSummaries.filter(
    (item) => item.status === 'modified'
  ).length
  const deletedChangeCount = displayFileChangeSummaries.filter(
    (item) => item.status === 'deleted'
  ).length
  const fileChangeSummaryText =
    displayFileChangeSummaries.length > 0
      ? `Created ${createdChangeCount} · Edited ${modifiedChangeCount} · Deleted ${deletedChangeCount}${fileChangeSummaryEstimated ? ' · live est.' : ''}`
      : 'No file changes detected.'
  const fileChangeAdds = displayFileChangeSummaries.reduce(
    (total, item) => total + (item.additions || 0),
    0
  )
  const fileChangeDels = displayFileChangeSummaries.reduce(
    (total, item) => total + (item.deletions || 0),
    0
  )
  const fileChangeHasLineStats = displayFileChangeSummaries.some(
    (item) => item.additions !== undefined || item.deletions !== undefined
  )
  const fileChangeDisplayAdds = fileChangeHasLineStats
    ? fileChangeAdds
    : createdChangeCount + modifiedChangeCount
  const fileChangeDisplayDels = fileChangeHasLineStats ? fileChangeDels : deletedChangeCount
  const fileChangeShouldShowStats = fileChangeHasLineStats || displayFileChangeSummaries.length > 0
  const transcriptMessages = currentChat?.messages || EMPTY_CHAT_MESSAGES
  // Welcome-surface gate. Extracted into `lib/welcomeState` so the
  // predicate is independently unit-tested (see `welcomeState.test.ts`).
  // The helper centralises the rule that a chat is in welcome state iff
  // a chat is selected, has no real conversation content, is not running,
  // and the Gemini fallback retry card is not showing — preventing the
  // welcome hero from rendering on top of a transcript that should be
  // visible.
  const isWelcomeChat = useMemo(
    () =>
      shouldRenderWelcome({
        currentChat,
        messages: transcriptMessages,
        isCurrentChatRunning,
        showFallbackUX
      }),
    [currentChat, transcriptMessages, isCurrentChatRunning, showFallbackUX]
  )
  // Welcome L7 — fixed 30D rolling window. The toggle is gone; the
  // dashboard always reports against the same 30-day cutoff the
  // sidebar UsageHeatmap uses, so the two surfaces stay coherent.
  //
  // `workspaces` is passed so the dashboard can resolve `favoriteProject`
  // — the display-name of the workspace with the most tokens in-window
  // (Welcome L9 hero chip).
  // 1.0.5-EW49 — Pass the user's global "reset all dashboard
  // stats" timestamp (from AppSettings.dashboardStatPrefs.resetAt)
  // into the builder so every computation honours the cutoff.
  // `0` / undefined preserves the pre-EW49 "include all history"
  // behaviour. The visibility map is applied at the chip
  // renderer (further down), not the builder.
  const dashboardStatResetAt = Number(settings?.dashboardStatPrefs?.resetAt || 0)
  // 1.0.7 — refresh signal for the welcome standalone heatmaps. UsageHeatmap
  // fetches its own records via getUsage() in a useEffect keyed on `refreshKey`
  // (default 0 = fetch ONCE on mount). The welcome surface stays mounted for
  // long stretches, so without a key the 90-day heatmaps showed stale data
  // (the sidebar's copy looked fresher only because that card remounts often).
  // `usageRecords` is re-fetched on the 90s usage poll AND on ensemble-run
  // completion, so its length is a cheap, monotonic-enough refresh trigger.
  const welcomeHeatmapRefreshKey = usageRecords.length
  const welcomeUsageDashboardData = useMemo(
    () =>
      buildWelcomeUsageDashboardData(
        usageRecords,
        chats,
        '30d',
        undefined,
        workspaces,
        dashboardStatResetAt
      ),
    [usageRecords, chats, workspaces, dashboardStatResetAt]
  )
  // Welcome L6 — the outer guard uses `lifetimeHasActivity` so the
  // dashboard (and its range toggle) stay mounted even when the
  // currently-selected window happens to be empty. The empty-state
  // copy lives INSIDE the dashboard, gated on `hasActivity`.
  const shouldShowWelcomeUsageDashboard =
    isWelcomeChat && welcomeUsageDashboardData.lifetimeHasActivity
  const welcomeWorkspaceHeatmapEnabled =
    settings?.welcomeHeatmapPrefs?.workspaceActivityEnabled !== false
  const welcomeTaskWraithHeatmapEnabled =
    settings?.welcomeHeatmapPrefs?.taskwraithActivityEnabled !== false
  const welcomeExternalHeatmapEnabled =
    settings?.welcomeHeatmapPrefs?.externalActivityEnabled !== false
  const welcomeWorkspaceActivityPath =
    isWelcomeChat && !isCurrentGlobalChat && welcomeWorkspaceHeatmapEnabled
      ? currentWorkspace?.path || currentChat?.workspacePath
      : ''
  const shouldShowWelcomeStandaloneHeatmaps =
    Boolean(welcomeWorkspaceActivityPath) ||
    (shouldShowWelcomeUsageDashboard &&
      (welcomeTaskWraithHeatmapEnabled || welcomeExternalHeatmapEnabled))
  // 1.0.72 — welcome heatmap layout (stacked = all stacked; single = one at a
  // time auto-cycling every 90s) + whole-dashboard show/hide. The slots below
  // are the renderable heatmaps in display order; WelcomeHeatmaps handles the
  // stacked-vs-cycling presentation.
  const welcomeHeatmapLayout: 'single' | 'stacked' =
    settings?.welcomeHeatmapPrefs?.layout === 'single' ? 'single' : 'stacked'
  const welcomeDashboardCardEnabled = settings?.dashboardStatPrefs?.dashboardEnabled !== false
  const welcomeDashboardSize =
    settings?.dashboardStatPrefs?.dashboardSize === 'small' ? 'small' : 'large'
  const welcomeHeatmapSlots: WelcomeHeatmapSlot[] = []
  if (welcomeWorkspaceActivityPath) {
    welcomeHeatmapSlots.push({
      key: 'workspace',
      node: (
        <WorkspaceActivityHeatmap
          workspacePath={welcomeWorkspaceActivityPath}
          dayCount={90}
          refreshKey={welcomeHeatmapRefreshKey}
          className="usage-heatmap--welcome-standalone"
        />
      )
    })
  }
  if (shouldShowWelcomeUsageDashboard && welcomeTaskWraithHeatmapEnabled) {
    welcomeHeatmapSlots.push({
      key: 'taskwraith',
      node: (
        <UsageHeatmap
          dayCount={90}
          refreshKey={welcomeHeatmapRefreshKey}
          title="TaskWraith Activity"
          showProviderFilter
          className="usage-heatmap--welcome-standalone"
        />
      )
    })
  }
  if (shouldShowWelcomeUsageDashboard && welcomeExternalHeatmapEnabled) {
    welcomeHeatmapSlots.push({
      key: 'external',
      node: (
        <UsageHeatmap
          dayCount={90}
          refreshKey={welcomeHeatmapRefreshKey}
          usageSource="external"
          title="External Activity"
          showProviderFilter
          className="usage-heatmap--welcome-standalone"
        />
      )
    })
  }
  const transcriptStyle = useMemo<CSSProperties | undefined>(() => {
    const style: CSSProperties = {}
    if (showGeminiTerminal && currentProvider === 'gemini') {
      ;(style as Record<string, string>)['--gemini-terminal-height'] = `${geminiTerminalHeight}px`
    }
    if (ensembleBlendStyle) {
      Object.assign(style, ensembleBlendStyle)
    }
    return Object.keys(style).length > 0 ? style : undefined
  }, [showGeminiTerminal, currentProvider, geminiTerminalHeight, ensembleBlendStyle])
  const runCompleteDurationText =
    runCompleteNotice && !isWelcomeChat
      ? formatWorkDuration(runCompleteNotice.startedAt, runCompleteNotice.timestamp)
      : null
  const isChatExpanded = !showWorkspaceSidebar || (!appearance.showInspector && !showFileEditor)
  const activeDiffSummaries: DiffFileSummary[] = Array.isArray((activeDiff as any)?.summaries)
    ? (activeDiff as any).summaries.filter(isFileSummaryRecord)
    : []
  const welcomeDiffCount =
    activeDiffSummaries.filter((item) => !item.isNoise).length || displayFileChangeSummaries.length
  const hasWelcomeDiff = Boolean((activeDiff as any)?.type === 'changes' || welcomeDiffCount > 0)
  const relevantScheduledTasks = isCurrentGlobalChat
    ? []
    : scheduledTasks
        .filter((task) => !currentWorkspace || task.workspaceId === currentWorkspace.id)
        .filter(
          (task) => task.status === 'pending' || task.status === 'due' || task.status === 'running'
        )
  const welcomeCopy = buildWelcomeCopy({
    workspaceName: isCurrentGlobalChat ? 'Chats' : currentWorkspace?.displayName || 'TaskWraith',
    providerLabel: currentProviderLabel,
    permissionModeLabel,
    isGlobalChat: isCurrentGlobalChat,
    hasDiff: hasWelcomeDiff,
    diffCount: welcomeDiffCount,
    scheduledTaskCount: relevantScheduledTasks.length,
    lastRunStatus: currentRun?.status
  })
  const visibleScheduledTasks = relevantScheduledTasks.slice(0, 4)
  const runLanes = useMemo(
    () => buildRunLanes(runQueueJobs, chats, scheduledTasks, runtimeProfiles),
    [chats, runQueueJobs, runtimeProfiles, scheduledTasks]
  )
  const runtimeProfileControl =
    currentProviderRuntimeProfiles.length > 0 ? (
      <label className="composer-runtime-profile" title="Runtime profile for this thread">
        <span>Runtime</span>
        <select
          value={selectedRuntimeProfileId}
          onChange={(event) => handleRuntimeProfileChange(event.target.value)}
          disabled={!currentChat || isCurrentComposerLocked}
          aria-label="Runtime profile"
        >
          {currentProviderRuntimeProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>
    ) : null
  const scheduleControls = hasWorkspaceContext ? (
    <span className="composer-scheduler-controls">
      <label className="composer-schedule-label" title="Schedule this prompt">
        <ClockSymbolIcon />
        <input
          className="composer-schedule-input"
          type="datetime-local"
          value={scheduleRunAt}
          min={toDateTimeLocalValue(new Date(Date.now() + 60_000))}
          onChange={(event) => setScheduleRunAt(event.target.value)}
          disabled={!currentWorkspace || !currentChat || isCurrentComposerLocked}
          aria-label="Scheduled run time"
        />
      </label>
      <button
        className="composer-picker-command composer-icon-command"
        type="button"
        onClick={() => void handleScheduleRun()}
        disabled={
          !currentWorkspace ||
          !currentChat ||
          !prompt.trim() ||
          !scheduleRunAt ||
          isCurrentComposerLocked
        }
        title="Schedule prompt"
        aria-label="Schedule prompt"
      >
        <ClockSymbolIcon />
      </button>
    </span>
  ) : null

  // #272: one-click persistent workspace trust for Gemini. Writes the
  // folder into ~/.gemini/trustedFolders.json directly (main-process
  // TrustStatusService.trustWorkspace) so the CLI treats it as trusted on
  // its next run — replacing the broken interactive `/permissions trust`
  // "Trust Assistant" terminal flow that exits 0 without persisting.
  // Gated behind a confirmation dialog because trusting a folder lets
  // Gemini act on its files without re-prompting.
  const handleTrustWorkspaceClick = async () => {
    const ws = currentWorkspace
    if (!ws?.path || typeof window.api.trustWorkspace !== 'function') return
    const confirmed = window.confirm(
      `Trust this workspace for Gemini?\n\n${ws.path}\n\n` +
        'This writes the folder into ~/.gemini/trustedFolders.json so the Gemini CLI ' +
        'treats it as a trusted project. Gemini will then run its tools (read / edit / ' +
        'shell, per your permission mode) against files here without prompting to trust ' +
        'the folder first. Only trust folders whose contents you recognise.'
    )
    if (!confirmed) return
    setGeminiTrustWriteBusy(true)
    setGeminiTrustWriteError(null)
    try {
      const result = await window.api.trustWorkspace(ws.path)
      if (result?.ok) {
        const refreshed = await window.api.checkTrust(ws.path)
        setTrustResult(refreshed)
        setGeminiTrustWriteError(null)
        // The trust file is read by the CLI at process start, so an
        // already-running persistent session needs a restart to pick it up.
        markPersistentSessionRestartNeeded(
          'Gemini workspace trust was granted. Restart the persistent session to apply it.'
        )
      } else {
        setGeminiTrustWriteError(result?.reason || 'Could not write the trust file.')
      }
    } catch (err) {
      setGeminiTrustWriteError(
        err instanceof Error ? err.message : 'Could not write the trust file.'
      )
    } finally {
      setGeminiTrustWriteBusy(false)
    }
  }

  const handleRollbackCodexThread = async (threadId: string) => {
    if (!threadId || typeof window.api.rollbackAgentThread !== 'function') return
    const confirmed = window.confirm(
      'Rollback Codex thread history by one turn? This changes the Codex conversation thread only and does not revert workspace files. Use Diff Studio or git to revert files separately.'
    )
    if (!confirmed) return
    try {
      const result = await window.api.rollbackAgentThread('codex', threadId, 1)
      const nextThreadId =
        result?.result?.thread?.id ||
        result?.result?.threadId ||
        result?.thread?.id ||
        result?.threadId ||
        threadId
      setRawLogs((prev) => [
        ...prev,
        {
          type: 'info',
          content:
            nextThreadId && nextThreadId !== threadId
              ? 'Codex thread rolled back. New thread id: ' +
                nextThreadId +
                '. Files were not reverted.'
              : 'Codex thread rollback requested. Files were not reverted.'
        }
      ])
      if (
        currentWorkspace &&
        currentChat &&
        currentChat.linkedProviderSessionId === threadId &&
        nextThreadId &&
        nextThreadId !== threadId
      ) {
        const updatedChat = { ...currentChat, linkedProviderSessionId: nextThreadId }
        await window.api.saveChat(updatedChat)
        setCurrentChat(updatedChat)
        setChats((prev) =>
          prev.map((chat) => (chat.appChatId === currentChat.appChatId ? updatedChat : chat))
        )
      }
      await refreshCodexThreads()
    } catch (error) {
      setRawLogs((prev) => [
        ...prev,
        { type: 'stderr', content: error instanceof Error ? error.message : String(error) }
      ])
    }
  }

  const handleImportCodexUsageCredential = async () => {
    if (typeof window.api.importCodexUsageCredential !== 'function') return
    try {
      const result = await window.api.importCodexUsageCredential()
      if (result?.cancelled) {
        return
      }
      setRawLogs((prev) => [
        ...prev,
        {
          type: 'info',
          content: result?.imported
            ? `Imported Codex usage session for account ${result.accountId || 'unknown'}.`
            : 'Codex usage session was not imported.'
        }
      ])
      void refreshProviderMetadata('codex')
    } catch (error) {
      setRawLogs((prev) => [
        ...prev,
        {
          type: 'stderr',
          content: `Failed to import Codex usage session: ${redactLog(String(error))}`
        }
      ])
    }
  }

  const handleClearCodexUsageCredential = async () => {
    if (typeof window.api.clearCodexUsageCredential !== 'function') return
    try {
      await window.api.clearCodexUsageCredential()
      setCodexStatus((prev: any) =>
        prev
          ? {
              ...prev,
              codexUsage: { configured: false, error: 'Codex usage import is not configured.' }
            }
          : prev
      )
      if (currentWorkspaceIdRef.current) {
        void refreshUsageSummary(currentWorkspaceIdRef.current)
      }
      setRawLogs((prev) => [
        ...prev,
        { type: 'info', content: 'Cleared imported Codex usage session.' }
      ])
    } catch (error) {
      setRawLogs((prev) => [
        ...prev,
        {
          type: 'stderr',
          content: `Failed to clear Codex usage session: ${redactLog(String(error))}`
        }
      ])
    }
  }

  // 1.0.6-EW66-1d — `targetPath` selects which workspace to open a
  // PR for. Defaults to the primary workspace; a WRITE-access
  // additional workspace passes its own `grant.path`. The
  // `createGithubPr` IPC already accepts `workspacePath`, so this is
  // pure per-path parameterization. State is tracked per path so
  // each row's button reflects only its own PR progress.
  const handleCreateGithubPr = async (targetPath?: string) => {
    const workspacePath = targetPath || currentWorkspace?.path
    if (!workspacePath) {
      // No path to key state by; surface against the primary slot.
      const fallbackKey = currentWorkspace?.path || ''
      setCreatePrStateFor(fallbackKey, {
        status: 'error',
        message: 'Open a workspace to create a PR.'
      })
      window.setTimeout(() => setCreatePrStateFor(fallbackKey, { status: 'idle' }), 5000)
      return
    }
    if (getCreatePrState(workspacePath).status === 'pending') return
    if (typeof window.api.createGithubPr !== 'function') {
      setRightTab('diff')
      return
    }
    setCreatePrStateFor(workspacePath, { status: 'pending' })
    try {
      const result = await window.api.createGithubPr({ workspacePath, openInBrowser: true })
      if (result?.ok) {
        setCreatePrStateFor(workspacePath, {
          status: 'success',
          message: result.url ? `Opened ${result.url}` : 'Pull request created.'
        })
      } else {
        setCreatePrStateFor(workspacePath, {
          status: 'error',
          message: result?.error || 'Failed to create pull request.'
        })
      }
    } catch (error) {
      setCreatePrStateFor(workspacePath, {
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to create pull request.'
      })
    }
    window.setTimeout(() => setCreatePrStateFor(workspacePath, { status: 'idle' }), 6000)
  }

  // Phase Git-U1 — `handlePrimeCommitChangesPrompt` (which injected a
  // "Commit N files… review the diff, then run the commit" prompt at the
  // agent) has been removed. Committing is now a real user-driven flow
  // via GitCommitControls (gitSnapshot → gitStage → gitCommit) in the
  // composer above-bar's diff-action menu, so the model is no longer
  // asked to drive git on the user's behalf.

  // Composer-unification (Phase J1): Gemini's standalone /stats, /help,
  // GEMINI.md, /restore, persistent-session and checkpoints buttons are
  // gone from the inline-pickers tail and live HERE in the palette. The
  // `action` field marks items that flip renderer state rather than
  // sending a slash command through the bridge.
  const geminiQuickToggleItems: CommandPaletteItem[] =
    currentProvider === 'gemini'
      ? [
          {
            id: 'gemini-quick-persistent-session',
            command: isPersistentSessionEnabled
              ? 'Disable persistent session'
              : 'Enable persistent session',
            label: persistentSessionLabel,
            description: persistentSessionNeedsRestart
              ? sessionRestartReason
              : 'Keep an interactive Gemini CLI session open across runs for slash commands.',
            group: 'Core',
            source: 'core',
            action: 'toggle-persistent-session'
          },
          {
            id: 'gemini-quick-checkpoints',
            command: geminiCheckpointingEnabled ? 'Disable checkpointing' : 'Enable checkpointing',
            label: geminiCheckpointingEnabled ? 'Checkpoints on' : 'Checkpoints off',
            description: geminiCheckpointingEnabled
              ? 'Disable Gemini CLI checkpointing for new runs.'
              : 'Enable Gemini CLI checkpointing for new runs.',
            group: 'Core',
            source: 'core',
            action: 'toggle-checkpoints'
          },
          {
            id: 'gemini-quick-memory-inspector',
            command: 'GEMINI.md',
            label: isMemoryInspectorOpen ? 'Close GEMINI.md inspector' : 'Open GEMINI.md inspector',
            description: 'Inspect the GEMINI.md memory files loaded by the Gemini CLI.',
            group: 'Memory',
            source: 'core',
            action: 'toggle-memory-inspector'
          },
          {
            id: 'gemini-quick-restore',
            command: '/restore',
            label: 'Restore checkpoint',
            description:
              'Open Gemini CLI /restore after confirmation. Checkpoint discovery is handled by Gemini.',
            group: 'Inspectors',
            source: 'core',
            action: 'restore-checkpoint'
          }
        ]
      : []
  const commandPaletteItems =
    currentProvider === 'codex'
      ? CODEX_COMMAND_PALETTE_CORE
      : currentProvider === 'claude' || currentProvider === 'kimi'
        ? CLI_PROVIDER_COMMAND_PALETTE_CORE
        : [...geminiQuickToggleItems, ...mergeCommandPaletteItems(discoveredCommands)]
  /**
   * Cross-provider TaskWraith actions promoted to first-class slash entries.
   * These don't have a CommandPaletteItem analog because they fire
   * renderer-side handlers directly — the slash picker is their only
   * surface today. Listed in the Custom group below the per-provider
   * palette-passthrough block.
   */
  const composerSlashExtraCommands: ComposerSlashCommand[] = [
    {
      kind: 'action',
      id: 'taskwraith-clear',
      command: '/clear',
      label: 'Clear conversation',
      description: 'Wipe this chat’s transcript + draft. Keeps the provider session id.',
      group: 'Custom',
      run: () => {
        const chat = currentChat
        if (!chat) return
        const confirmed = window.confirm(
          `Clear the conversation in "${chat.title}"?\n\n` +
            'This wipes the chat transcript and your composer draft. ' +
            'The chat record and provider session id stay intact so the ' +
            'next prompt continues with the same provider context.'
        )
        if (!confirmed) return
        setPrompt('')
        // Optimistic local clear, then persist via the IPC. We refresh
        // the chat list right after so the new (empty) transcript is the
        // source of truth across the renderer.
        const truncated: ChatRecord = {
          ...chat,
          messages: [],
          runs: [],
          updatedAt: Date.now()
        }
        chatByIdRef.current.set(chat.appChatId, truncated)
        setCurrentChat(truncated)
        setChats((prev) =>
          prev.map((entry) => (entry.appChatId === chat.appChatId ? truncated : entry))
        )
        void window.api.truncateChat(chat.appChatId).catch((err) => {
          console.error('[slash:/clear] truncateChat failed', err)
        })
      }
    },
    {
      kind: 'action',
      id: 'taskwraith-attach',
      command: '/attach',
      label: 'Attach an app window',
      description: 'Open the macOS picker so the AI can see what’s on screen.',
      group: 'Custom',
      run: () => {
        void handleAttachWindow()
      }
    },
    {
      kind: 'action',
      id: 'taskwraith-side',
      command: '/side',
      label: 'Open side chat',
      description: 'Open a parallel side pane for this chat.',
      group: 'Custom',
      run: () => {
        const sideSeedPrompt = promptWithoutCurrentSlashToken().trim()
        void ensureSideChatForCurrentChat(sideSeedPrompt, true, 'split')
      }
    },
    {
      kind: 'action',
      id: 'taskwraith-help',
      command: '/help',
      label: 'Open Help',
      description: 'Open the Settings panel — docs, shortcuts, and policy info.',
      group: 'Custom',
      run: () => {
        setShowSettings(true)
      }
    },
    {
      kind: 'action',
      id: 'taskwraith-feedback',
      command: '/feedback',
      label: 'Send feedback',
      description: 'Open the Settings panel and jump to the feedback section.',
      group: 'Custom',
      run: () => {
        setShowSettings(true)
      }
    },
    {
      kind: 'action',
      id: 'taskwraith-compact',
      command: '/compact',
      label: 'Compact context',
      description: 'Summarise the current chat to shrink prompt size on the next turn.',
      group: 'Custom',
      run: () => {
        // Context compaction lives on the main side at the
        // PromptComposition layer and runs automatically per turn — the
        // slash entry doesn’t have a direct surface today. Log a
        // friendly note so the user understands the picker fired
        // correctly but the manual compact handle is still pending.
        setRawLogs((prev) => [
          ...prev,
          {
            type: 'info',
            content:
              'Slash /compact: TaskWraith already runs compact-context per turn (see PromptComposition.ts). A manual on-demand recompact entry will land in a follow-up slice.'
          }
        ])
      }
    },
    /* Prompt-template seams. Drop a canned prompt at the slash position
     * and leave the caret where the user is most likely to start
     * typing extra context. Future skill-discovery (~/.claude/skills,
     * gemini /commands list) feeds the same channel — each discovered
     * skill becomes a prompt-template entry whose template comes from
     * the skill's frontmatter. Group=Custom so they sort below the
     * provider-native palette. */
    {
      kind: 'prompt-template',
      id: 'taskwraith-template-explain',
      command: '/explain',
      label: 'Explain',
      description: 'Insert an explain-this-code template.',
      group: 'Custom',
      template:
        'Explain what this code does, why it’s structured this way, and any non-obvious edge cases:\n\n'
    },
    {
      kind: 'prompt-template',
      id: 'taskwraith-template-test',
      command: '/test',
      label: 'Test',
      description: 'Insert a write-tests template.',
      group: 'Custom',
      template:
        'Write tests that cover the happy path and the most likely failure modes. Match the existing test style for this file:\n\n'
    },
    {
      kind: 'prompt-template',
      id: 'taskwraith-template-review-diff',
      command: '/review-diff',
      label: 'Review diff',
      description: 'Insert a review-the-current-diff template.',
      group: 'Custom',
      template:
        'Review the unstaged changes in this workspace. Flag anything that looks risky, inconsistent with surrounding code, or under-tested.\n\n'
    }
  ]

  // Slash-picker registry: per-provider palette items wrapped as
  // palette-passthrough ComposerSlashCommands, plus the cross-provider
  // TaskWraith actions and prompt templates. `capabilities` gates entries
  // the provider can't service (e.g. `/mcp` hides when MCP is offline).
  const composerSlashCommands: ComposerSlashCommand[] = buildComposerSlashCommandRegistry({
    provider: currentProvider,
    paletteItems: commandPaletteItems,
    extraCommands: composerSlashExtraCommands,
    capabilities: currentProviderCapabilities
  })
  const commandPaletteSearch = commandPaletteQuery.trim().toLowerCase()
  const visibleCommandPaletteItems = commandPaletteSearch
    ? commandPaletteItems.filter((item) =>
        `${item.command} ${item.label} ${item.description} ${item.group} ${item.sourcePath || ''}`
          .toLowerCase()
          .includes(commandPaletteSearch)
      )
    : commandPaletteItems
  const commandPaletteGroups: CommandPaletteGroup[] = [
    'Core',
    'Discovery',
    'Memory',
    'Inspectors',
    'Custom'
  ]
  const isLinkedChatPopout = Boolean(
    isChatPopoutWindow &&
      currentChat?.parentChatId &&
      (currentChat.parentChatRelation === 'sideChat' ||
        currentChat.parentChatRelation === 'subThread')
  )
  const chatPopoutParentChat =
    isLinkedChatPopout && currentChat?.parentChatId
      ? chatByIdRef.current.get(currentChat.parentChatId) ||
        chats.find((chat) => chat.appChatId === currentChat.parentChatId) ||
        null
      : null
  const chatPopoutKindLabel =
    currentChat?.parentChatRelation === 'subThread'
      ? 'Agent sub-thread'
      : currentChat?.chatKind === 'ensemble'
        ? 'Side ensemble'
        : 'Side chat'
  const isSideSplitOpen = Boolean(sideChat && !showSettings && !isChatPopoutWindow)
  const sidePanelLayoutClass = isSideSplitOpen
    ? `side-chat-open side-chat-layout-${sidePanelPresentation}`
    : ''
  const appMainStyle = showWorkspaceSidebar && !isChatPopoutWindow
    ? ({ '--sidebar-width': `${workspaceSidebarWidth}px` } as CSSProperties)
    : undefined
  const chatSplitStyle = isSideSplitOpen
    ? ({ '--side-chat-width': `${sideChatWidth}px` } as CSSProperties)
    : undefined
  const interfaceStyle = appearance.composerStyle
  const primaryModifierLabel = window.api.hostPlatform === 'darwin' ? '⌘' : 'Ctrl'
  const providerShellEnabled = interfaceStyle === 'codex' || interfaceStyle === 'claude'
  const providerShellClass = providerShellEnabled
    ? `provider-shell provider-shell-${interfaceStyle}`
    : 'provider-shell-default'
  // Phase K-followup — `providerShellCapabilityChips` removed
  // alongside its consumer (the `provider-shell-status-row` chips).
  // The chips presented as buttons but never carried interaction.
  // The information lives in: workspace-write mode → runtime profile
  // picker; provider identity → theme tokens + sidebar tile;
  // approvals → the approval-ledger panel; usage → welcome dashboard.

  return (
    <div
      className={`app-root ${fxBurstClass} ${appAgentAuraClass} ${providerShellClass} ${
        isChatPopoutWindow ? 'chat-popout-window' : ''
      }`}
    >
      <div className="window-drag-strip" aria-hidden />
      <div
        className={`app-main ${isChatExpanded ? 'chat-expanded' : ''} ${providerShellClass} ${
          isChatPopoutWindow ? 'chat-popout-main' : ''
        } ${isLinkedChatPopout ? 'chat-popout-linked-main' : ''} ${
          isSideSplitOpen ? 'side-chat-open' : ''
        }`}
        style={appMainStyle}
      >
        {showWorkspaceSidebar && !isChatPopoutWindow && (
          <>
            {/*
              Sidebar swap. In Settings full-app takeover layout
              (`showSettings === true`), the workspace `Sidebar`
              is replaced by `SettingsSidebar` — the latter carries
              the back-to-app button and the tab list. The resize
              handle stays so the main-pane width remains consistent
              when entering / leaving Settings.
            */}
            {showSettings ? (
              <SettingsSidebar
                activeTab={settingsActiveTab}
                onTabChange={setSettingsActiveTab}
                onBackToApp={() => setShowSettings(false)}
                appVersion={appVersion}
              />
            ) : (
              <Sidebar
                workspaces={workspaces}
                currentWorkspace={currentWorkspace}
                chats={chats}
                currentChat={currentChat}
                usageSummary={usageSummary}
                runningChatIds={runningChatIdsArray}
                showOnboardingHint={showOnboardingHint}
                onDismissOnboardingHint={handleDismissOnboardingHint}
                workspaceAddPointerActive={workspaceAddPointerActive}
                onSelectWorkspace={handleSelectExistingWorkspace}
                onRemoveWorkspace={handleRemoveWorkspace}
                onSelectWorkspaceDialog={handleSelectWorkspace}
                onNewChat={handleNewChat}
                onNewGlobalChat={handleNewGlobalChat}
                onNewEnsemble={handleNewEnsemble}
                ensembleModeEnabled={isEnsembleModeEnabled}
                onSelectChat={handleSelectChat}
                onOpenChatInSidePanel={(chat) =>
                  void handleOpenLinkedChatInSidePanelFromSidebar(chat)
                }
                onOpenSettings={() => setShowSettings(true)}
                updateSnapshot={updateStatus.snapshot}
                onOpenChangelog={handleOpenChangelogSheet}
                appearanceQuickSettings={{
                  composerStyle: appearance.composerStyle,
                  themeAccentStyle: appearance.themeAccentStyle,
                  themeAppearance: appearance.themeAppearance,
                  toolIconAccent: appearance.toolIconAccent
                }}
                onAppearanceQuickChange={handleSettingsChange}
                canOpenWorkspacePopout={canOpenWorkspacePopout}
                onOpenWorkspacePopout={openWorkspacePopoutWindow}
                onQuitApp={() => {
                  void window.api.quitApp?.()
                }}
                onCreateSubThread={(parent) => setSubThreadCreatorParent(parent)}
                onTogglePinChat={handleTogglePinChat}
                onTogglePinWorkspace={handleTogglePinWorkspace}
                onToggleArchiveChat={handleToggleArchiveChat}
                onDeleteChat={handleDeleteChat}
                onRenameChat={handleRenameChat}
                onInspectRun={(runId, chatId) => {
                  // Navigate to the chat first (handleSelectChat fires via
                  // ActiveRunsSection.onSelectChat above), then open the
                  // Inspector. The chat-switch reset effect won't clobber
                  // this because it's gated on "does the new chat own this
                  // runId?" — see effect below.
                  if (chatId) {
                    const chat = chats.find((c) => c.appChatId === chatId)
                    if (chat) handleSelectChat(chat)
                  }
                  setInspectingRunId(runId)
                }}
                onShowPairingSheet={
                  IOS_REMOTE_ENABLED
                    ? () => {
                        setSettingsActiveTab('pairing')
                        setShowSettings(true)
                      }
                    : undefined
                }
              />
            )}
            <div
              className="workspace-sidebar-resize-handle"
              role="separator"
              tabIndex={0}
              aria-orientation="vertical"
              aria-label="Resize workspace sidebar"
              aria-valuemin={MIN_WORKSPACE_SIDEBAR_WIDTH}
              aria-valuemax={MAX_WORKSPACE_SIDEBAR_WIDTH}
              aria-valuenow={workspaceSidebarWidth}
              onMouseDown={startWorkspaceSidebarResize}
              onKeyDown={handleWorkspaceSidebarResizeKeyDown}
              title="Resize workspace sidebar"
            />
          </>
        )}

        {/*
          Settings full-app takeover pane. When `showSettings` is true,
          this sibling renders the SettingsPanel inline in the main pane
          slot — paired with the SettingsSidebar swap above. The
          adjacent `.app-transcript` element is hidden via the
          `transcript-hidden-for-settings` class (just `display: none`)
          so its ref stays valid and its state survives the round-trip
          back to the chat surface.
        */}
        {!isChatPopoutWindow && showSettings && (
          <div className="app-settings-pane" role="region" aria-label="Settings">
            <SettingsPanel
              layout="takeover"
              activeTab={settingsActiveTab}
              onTabChange={setSettingsActiveTab}
              mode={appearance.mode}
              visualEffectStyle={appearance.visualEffectStyle}
              themeAppearance={appearance.themeAppearance}
              themeCornerStyle={appearance.themeCornerStyle}
              themeAccentStyle={appearance.themeAccentStyle}
              toolIconAccent={appearance.toolIconAccent}
              userBubbleColor={appearance.userBubbleColor}
              promptSurfaceStyle={appearance.promptSurfaceStyle}
              composerStyle={appearance.composerStyle}
              transcriptFontFamily={appearance.transcriptFontFamily}
              composerFontFamily={appearance.composerFontFamily}
              keyCommandBindings={settings?.keyCommandBindings}
              reduceTransparency={appearance.reduceTransparency}
              reduceMotion={appearance.reduceMotion}
              compactDensity={appearance.compactDensity}
              sidebarOpacity={appearance.sidebarOpacity}
              mainPaneOpacity={appearance.mainPaneOpacity}
              geminiCheckpointingEnabled={geminiCheckpointingEnabled}
              geminiApiRuntime={geminiApiRuntime}
              chatContextTurns={chatContextTurns}
              currency={displayCurrency}
              currencyOverestimatePercent={overestimatePercent}
              dashboardStatPrefs={settings?.dashboardStatPrefs}
              welcomeHeatmapPrefs={settings?.welcomeHeatmapPrefs}
              kimiSanitiserEnabled={settings?.kimiSanitiserEnabled ?? false}
              kimiSanitiserCustomKeywords={settings?.kimiSanitiserCustomKeywords ?? ''}
              claudeBinaryPath={claudeBinaryPath}
              kimiBinaryPath={kimiBinaryPath}
              agenticServices={agenticServices}
              nativeSubAgentRequests={settings?.nativeSubAgentRequests ?? 'ask'}
              autoResumeParentOnSubThreadCompletion={autoResumeParentOnSubThreadCompletion}
              agenticWorkspaceGrantCount={agenticWorkspaceGrantCount}
              agenticWorkspaceGrants={agenticWorkspaceGrants}
              activeProvider={currentProvider}
              providerCapabilities={currentProviderCapabilities}
              providerCapabilitiesByProvider={providerCapabilitiesByProvider}
              mcpStatusByProvider={{
                codex: codexMcpStatus,
                gemini: agentMcpStatusByProvider.gemini,
                claude: agentMcpStatusByProvider.claude,
                kimi: agentMcpStatusByProvider.kimi
              }}
              geminiMcpBridgeEnabled={geminiMcpBridgeEnabled}
              geminiMcpBridgeStatus={geminiMcpBridgeStatus}
              codexSandboxFallback={codexSandboxFallback}
              funFxEnabled={appearance.funFxEnabled}
              funFxMode={appearance.funFxMode}
              advancedFx={appearance.advancedFx}
              updateChannel={updateChannel}
              approvalTimeouts={approvalTimeouts}
              productOperationsStatus={productOperationsStatus}
              geminiAuthStatus={geminiAuthStatus}
              geminiAuthProfiles={geminiAuthProfiles}
              codexStatus={codexStatus}
              claudeAuthStatus={claudeAuthStatus}
              kimiAuthStatus={kimiAuthStatus}
              cursorProviderAvailable={cursorProviderAvailable}
              grokProviderAvailable={grokProviderAvailable}
              claudeLoginState={claudeLoginState}
              onImportCodexUsageCredential={() => void handleImportCodexUsageCredential()}
              onClearCodexUsageCredential={() => void handleClearCodexUsageCredential()}
              onTriggerClaudeLogin={() => void handleTriggerClaudeLogin()}
              onStoreClaudeApiKey={(key) => void handleStoreClaudeApiKey(key)}
              onClearClaudeApiKey={() => void handleClearClaudeApiKey()}
              onStoreKimiApiKey={(key) => void handleStoreKimiApiKey(key)}
              onClearKimiApiKey={() => void handleClearKimiApiKey()}
              onSaveGeminiAuthProfile={(profile) => void handleSaveGeminiAuthProfile(profile)}
              onStartGeminiOAuthLogin={(input) => void handleStartGeminiOAuthLogin(input)}
              onCancelGeminiOAuthLogin={(profileId) => void handleCancelGeminiOAuthLogin(profileId)}
              onProviderLogin={(provider) => {
                void window.api.openProviderLoginTerminal(provider).then((r) => {
                  if (!r?.ok) console.warn('[provider sign-in] could not open Terminal:', r?.error)
                })
              }}
              onProviderLogout={(provider) => {
                void window.api.openProviderLogoutTerminal(provider).then((r) => {
                  if (!r?.ok) console.warn('[provider sign-out] could not open Terminal:', r?.error)
                })
              }}
              onSetDefaultGeminiAuthProfile={(profileId) =>
                void handleSetDefaultGeminiAuthProfile(profileId)
              }
              onDeleteGeminiAuthProfile={(profileId) =>
                void handleDeleteGeminiAuthProfile(profileId)
              }
              onRemoveAgenticWorkspaceGrant={(provider, workspacePath, service) =>
                void handleRemoveAgenticWorkspaceGrant(provider, workspacePath, service)
              }
              onInstallGeminiMcpBridge={() => void installGeminiMcpBridge()}
              onRefreshGeminiMcpBridgeStatus={() => void refreshGeminiMcpBridgeStatus()}
              onRefreshProviderMcpStatus={(provider) => void refreshProviderMetadata(provider)}
              onRefreshProductOperationsStatus={() => void refreshProductOperationsStatus()}
              onExportProductDiagnostics={() => void exportProductDiagnostics()}
              onRepairProductInstall={() => void repairProductInstall()}
              onChange={handleSettingsChange}
              onClose={() => setShowSettings(false)}
              workspaces={workspaces}
              currentWorkspace={currentWorkspace}
              onSelectWorkspace={handleSelectExistingWorkspace}
              onSelectWorkspaceDialog={handleSelectWorkspace}
              onRemoveWorkspace={(workspaceId) => {
                // SettingsPanel's Workspaces tab passes a bare id; the
                // host `handleRemoveWorkspace` expects an event for its
                // sidebar use case (to call stopPropagation on the row
                // click). Synthesize a stub event so the call shape
                // matches.
                const stubEvent = {
                  preventDefault: () => {},
                  stopPropagation: () => {}
                } as unknown as React.MouseEvent<HTMLButtonElement>
                handleRemoveWorkspace(workspaceId, stubEvent)
              }}
              onTogglePinWorkspace={handleTogglePinWorkspace}
              usageSummary={usageSummary}
            />
          </div>
        )}

        {isLinkedChatPopout && currentChat && (
          <div className="chat-popout-dock-toolbar" role="banner">
            <div className="chat-popout-dock-title">
              <span>{chatPopoutKindLabel}</span>
              <strong title={currentChat.title}>{currentChat.title}</strong>
              <small title={chatPopoutParentChat?.title || undefined}>
                Parent: {chatPopoutParentChat?.title || 'linked chat'}
              </small>
            </div>
            <div className="chat-popout-dock-actions">
              <button
                type="button"
                className="side-chat-header-btn"
                onClick={() => dockChatPopoutWindow('split')}
                title="Dock this linked chat into the main pane split"
              >
                Dock split
              </button>
              <button
                type="button"
                className="side-chat-header-btn"
                onClick={() => dockChatPopoutWindow('drawer')}
                title="Dock this linked chat into the side drawer"
              >
                Dock drawer
              </button>
            </div>
          </div>
        )}

        <div
          ref={chatSplitRegionRef}
          className={`chat-split-region ${sidePanelLayoutClass} ${
            showSettings ? 'chat-split-hidden-for-settings' : ''
          }`}
          style={chatSplitStyle}
        >
          <div className="chat-split-main">
            <div
              ref={appTranscriptRef}
              className={`app-transcript provider-${currentProvider} interface-${interfaceStyle} ${isCurrentEnsembleChat ? 'chat-kind-ensemble' : ''} ${isWelcomeChat ? 'welcome-mode' : ''} ${showGeminiTerminal && currentProvider === 'gemini' ? 'gemini-terminal-open' : ''} ${isAdvancedFxActive ? `fx-labs-active fx-intensity-${advancedFxIntensity}` : ''} ${showSettings ? 'transcript-hidden-for-settings' : ''}`}
              style={transcriptStyle}
            >
          {chatContextNotice && (
            <div className="chat-context-application-pill" role="status">
              <span>{chatContextNotice.message}</span>
            </div>
          )}
          {!isChatPopoutWindow && (
            <div
              className={`chat-corner-controls chat-corner-controls-left ${showWorkspaceSidebar ? '' : 'chat-corner-controls-workspace-hidden'}`}
            >
              <button
                className="chat-corner-btn"
                type="button"
                onClick={() => setShowWorkspaceSidebar((current) => !current)}
                title={`${showWorkspaceSidebar ? 'Hide' : 'Show'} workspace sidebar`}
                aria-label="Toggle workspace sidebar"
              >
                <SidebarCornerIcon direction="left" isOpen={showWorkspaceSidebar} />
              </button>
            <button
              className={`chat-corner-btn ${shouldShowSkyVisualFxInFxMode ? 'active' : ''}`}
              type="button"
              onClick={() => setShowSkyVisualFx((current) => !current)}
              title={`${shouldShowSkyVisualFxInFxMode ? 'Hide' : isFxEnabled ? 'Show' : 'Enable Epic FX'} sky weather effects${hostWeather?.description ? ` · ${hostWeather.description}` : ''}`}
              aria-label="Toggle sky weather effects"
              aria-pressed={shouldShowSkyVisualFxInFxMode}
              disabled={!isFxEnabled}
            >
              <SkyWeatherIcon />
            </button>
            <button
              className={`chat-corner-btn ${shouldShowGhostCompanion ? 'active' : ''}`}
              type="button"
              onClick={() => setShowGhostCompanion((current) => !current)}
              title={`${shouldShowGhostCompanion ? 'Hide' : isFxEnabled ? 'Show' : 'Enable Epic FX'} ghost companion`}
              aria-label="Toggle ghost companion"
              aria-pressed={shouldShowGhostCompanion}
              disabled={!isFxEnabled}
            >
              <GhostCompanionIcon />
            </button>
            <button
              className={`chat-corner-btn chat-corner-btn-changelog ${showChangelogSheet ? 'active' : ''}`}
              type="button"
              onClick={handleOpenChangelogSheet}
              title={showChangelogSheet ? 'Hide changelog sheet' : 'Open changelog sheet'}
              aria-label="Toggle changelog sheet"
              aria-pressed={showChangelogSheet}
            >
              <span className="chat-corner-symbol">i</span>
            </button>
            {/*
              First-launch onboarding sheet re-opener. The sheet
              auto-shows on a fresh install and stays available
              from this button so existing users / testers can
              flip it back on at any time. Toggles purely the
              visibility state — does NOT touch the persisted
              dismissal flag, so closing the sheet again doesn't
              cause it to auto-show next launch.
            */}
            <button
              className={`chat-corner-btn ${showFirstLaunchSheet ? 'active' : ''}`}
              type="button"
              onClick={() => setShowFirstLaunchSheet((current) => !current)}
              title={showFirstLaunchSheet ? 'Hide onboarding sheet' : 'Open onboarding sheet'}
              aria-label="Toggle onboarding sheet"
              aria-pressed={showFirstLaunchSheet}
            >
              <span className="chat-corner-symbol">?</span>
            </button>
            {/*
              Bug-report sheet trigger. Mirrors the `?` button's shape
              but uses a subtle amber "!" glyph that reads as "report
              a bug" without being alarming red. Lets a tester type a
              one-liner + description inline as he hits issues during
              the 1.0.1 test session — the main process appends the
              report to `<userData>/TaskWraith/bug-reports.md` for review.
            */}
            <button
              className={`chat-corner-btn chat-corner-btn-bug-report ${showBugReportSheet ? 'active' : ''}`}
              type="button"
              onClick={() => setShowBugReportSheet((current) => !current)}
              title="Report a bug or issue"
              aria-label="Report a bug or issue"
              aria-pressed={showBugReportSheet}
            >
              <span className="chat-corner-symbol">!</span>
            </button>
            </div>
          )}

          {!isChatPopoutWindow && (
            <div className="chat-corner-controls chat-corner-controls-center">
            <button
              className="chat-corner-btn"
              type="button"
              onClick={() => openWorkspacePopoutWindow('file-editor')}
              title="Open file editor in new window"
              aria-label="Open file editor in new window"
              disabled={!canOpenWorkspacePopout}
            >
              <span className="chat-corner-symbol">↗</span>
            </button>
            <button
              className="chat-corner-btn"
              type="button"
              onClick={() => openWorkspacePopoutWindow('diff-studio')}
              title="Open Diff Studio in new window"
              aria-label="Open Diff Studio in new window"
              disabled={!canOpenWorkspacePopout}
            >
              <span className="chat-corner-symbol">Δ</span>
            </button>
            <button
              className="chat-corner-btn"
              type="button"
              onClick={openChatPopoutWindow}
              title="Pop out chat window"
              aria-label="Pop out chat window"
              disabled={!currentChat}
            >
              <ChatPopoutIcon />
            </button>
            <div className="side-chat-menu-wrap" ref={sideChatMenuRef}>
              <button
                className={`chat-corner-btn side-chat-primary-btn ${isSideSplitOpen ? 'active' : ''}`}
                type="button"
                onClick={() => {
                  setSideChatMenuOpen(false)
                  if (isSideSplitOpen) {
                    hideSideChatPane()
                    return
                  }
                  void openCurrentSideChatPresentation('split')
                }}
                title={isSideSplitOpen ? 'Hide side chat pane' : 'Open side split'}
                aria-label={isSideSplitOpen ? 'Hide side chat pane' : 'Open side split'}
                disabled={!currentChat}
              >
                <SplitChatIcon />
              </button>
              <button
                className={`chat-corner-btn side-chat-menu-trigger ${sideChatMenuOpen ? 'active' : ''}`}
                type="button"
                onClick={() => setSideChatMenuOpen((open) => !open)}
                title="Choose side chat layout"
                aria-label="Choose side chat layout"
                aria-haspopup="menu"
                aria-expanded={sideChatMenuOpen}
                disabled={!currentChat}
              >
                <span className="side-chat-menu-chevron" aria-hidden>
                  ▾
                </span>
              </button>
              {sideChatMenuOpen && (
                <div className="side-chat-layout-menu" role="menu" aria-label="Side chat layouts">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void openCurrentSideChatPresentation('split')}
                  >
                    <span>Open side split</span>
                    <small>Main pane divider</small>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void openCurrentSideChatPresentation('drawer')}
                  >
                    <span>Open side drawer</span>
                    <small>Right overlay</small>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void openCurrentSideChatPresentation('popout')}
                  >
                    <span>Pop out side chat</span>
                    <small>Separate chat window</small>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void openCurrentSideChatPresentation('main')}
                  >
                    <span>Open as main chat</span>
                    <small>Navigate to linked chat</small>
                  </button>
                  {isCurrentEnsembleChat && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() =>
                          void openCurrentSideChatPresentation('split', 'ensembleClone')
                        }
                      >
                        <span>Side ensemble clone</span>
                        <small>Same participants</small>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() =>
                          void openCurrentSideChatPresentation('split', 'singleProvider')
                        }
                      >
                        <span>Single participant chat</span>
                        <small>
                          {selectedParticipant
                            ? selectedParticipant.role ||
                              getProviderLabel(selectedParticipant.provider)
                            : 'Selected provider'}
                        </small>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => void openCurrentSideChatPresentation('split', 'fanOut')}
                      >
                        <span>Fan-out side chat</span>
                        <small>Parallel read-only round</small>
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleOpenSideChatFromSelectedMessage}
                    disabled={!selectedSideChatSeedMessage}
                  >
                    <span>Open from selected message</span>
                    <small>
                      {selectedSideChatSeedMessage
                        ? `${selectedSideChatSeedMessage.role} message`
                        : 'Hover or focus a message'}
                    </small>
                  </button>
                </div>
              )}
            </div>
            </div>
          )}

          {!isChatPopoutWindow && (
            <div className="chat-corner-controls chat-corner-controls-right">
            <button
              className={`chat-corner-btn ${showCockpit ? 'active' : ''}`}
              type="button"
              onClick={() => setShowCockpit(true)}
              title="Open multi-agent cockpit"
              aria-label="Open multi-agent cockpit"
              aria-pressed={showCockpit}
            >
              <span className="chat-corner-symbol">CP</span>
            </button>
            <button
              className={`chat-corner-btn ${isChatMediaPanelOpen ? 'active' : ''}`}
              type="button"
              onClick={() => setIsChatMediaPanelOpen((open) => !open)}
              title="Show chat uploads and paths"
              aria-label="Show chat uploads and paths"
              aria-pressed={isChatMediaPanelOpen}
            >
              <ChatMediaIcon />
              {currentChatMediaRefs.length > 0 && (
                <span className="chat-corner-count">
                  {currentChatMediaRefs.length > 99 ? '99+' : currentChatMediaRefs.length}
                </span>
              )}
            </button>
            {currentProvider === 'gemini' && hasWorkspaceContext && (
              <button
                className={`chat-corner-btn ${showGeminiTerminal ? 'active' : ''}`}
                type="button"
                onClick={() => setShowGeminiTerminal((current) => !current)}
                title={`${showGeminiTerminal ? 'Hide' : 'Show'} Gemini terminal`}
                aria-label="Toggle Gemini terminal"
                aria-pressed={showGeminiTerminal}
              >
                <AppleTerminalIcon />
              </button>
            )}
            <button
              className={`chat-corner-btn ${showFileEditor ? 'active' : ''}`}
              type="button"
              onClick={() => {
                if (!hasWorkspaceContext) return
                const nextShowFileEditor = !showFileEditor
                setShowFileEditor(nextShowFileEditor)
                if (nextShowFileEditor && window.innerWidth <= 1180 && appearance.showInspector) {
                  appearance.update({ showInspector: false })
                }
              }}
              title={`${showFileEditor ? 'Hide' : 'Show'} file editor`}
              aria-label="Toggle file editor"
              disabled={!hasWorkspaceContext}
            >
              <FileMenuSelectionIcon />
            </button>
            {/* Pop-out buttons (file editor ↗ / Diff Studio Δ / pop-out chat)
              live in the top-center pill now — see chat-corner-controls-center. */}
              <button
                className="chat-corner-btn"
                type="button"
                onClick={() => {
                  const nextShowInspector = !appearance.showInspector
                  if (nextShowInspector && window.innerWidth <= 1180 && showFileEditor) {
                    setShowFileEditor(false)
                  }
                  appearance.update({ showInspector: nextShowInspector })
                }}
                title={`${appearance.showInspector ? 'Hide' : 'Show'} inspector`}
                aria-label="Toggle inspector"
              >
                <SidebarCornerIcon direction="right" isOpen={appearance.showInspector} />
              </button>
            </div>
          )}

          {/*
            1.0.4 — "↓ N new messages" jump-to-latest pill (Slack/
            Discord/YouTube pattern). The 1.0.4 race-window fix
            (commit ce130ed) stopped auto-scroll from fighting the
            user mid-read, so the user could scroll up freely while
            messages were streaming — but they had no visible signal
            that new content was arriving below. The pill makes that
            *absence* of auto-scroll visible.

            Visibility predicate lives in
            `lib/TranscriptScroll.shouldShowJumpToLatestPill` so the
            gating logic stays unit-testable alongside the engage /
            disengage thresholds. We read `autoFollowRef.current`
            directly rather than mirroring it onto state — the scroll
            listener already mutates that ref synchronously, and a
            mirror would just add a frame of lag plus a re-render
            churn during streaming.

            Click + `End`-key share `handleJumpToLatest` (defined
            with the scroll-state block higher in the component) so
            the smooth-scroll, autoFollow re-engage, and count clear
            stay in lockstep regardless of entry point.
          */}
          {shouldShowJumpToLatestPill({
            autoFollow: autoFollowRef.current,
            unreadCount: unreadFromBottomCount
          }) && (
            <button
              type="button"
              className={`transcript-jump-to-latest-pill provider-${currentProvider}`}
              onClick={handleJumpToLatest}
              aria-label={`Jump to latest — ${unreadFromBottomCount} new ${unreadFromBottomCount === 1 ? 'message' : 'messages'}`}
              title={`Jump to latest (End)\n${unreadFromBottomCount} new ${unreadFromBottomCount === 1 ? 'message' : 'messages'}`}
            >
              <span aria-hidden="true" className="transcript-jump-to-latest-arrow">
                ↓
              </span>
              <span className="transcript-jump-to-latest-text">
                {unreadFromBottomCount} new {unreadFromBottomCount === 1 ? 'message' : 'messages'}
              </span>
            </button>
          )}

          <ChatMediaFloatingPanel
            open={isChatMediaPanelOpen}
            refs={currentChatMediaRefs}
            workspacePath={currentWorkspace?.path}
            onClose={() => setIsChatMediaPanelOpen(false)}
          />

          <ChatMediaPreviewOverlay
            mediaRef={previewChatMediaRef}
            workspacePath={currentWorkspace?.path}
            onClose={() => setPreviewChatMediaRef(null)}
          />

          {showLivingWorkspaceFx && (
            <LivingWorkspaceLayer weather={hostWeather} intensity={advancedFxIntensity} />
          )}
          {showAgentAuraFx && (
            <AgentAuraLayer
              provider={currentProvider}
              status={runFxStatus}
              intensity={advancedFxIntensity}
              hasHandoff={hasCurrentHandoffDraft}
            />
          )}
          {showRunDataVizFx && (
            <RunDataVizLayer
              provider={currentProvider}
              intensity={advancedFxIntensity}
              queueCount={queuedRunQueueCount}
              rawEventCount={rawLogs.length}
              approvalWaiting={Boolean(pendingAgentApproval)}
              status={runFxStatus}
            />
          )}
          {shouldShowSkyVisualFxInFxMode && <SkyWeatherVisual weather={hostWeather} />}

          {currentProvider === 'gemini' && isOldVersion && (
            <div className="version-warning">
              <strong>Warning:</strong> Gemini CLI version ({geminiVersion}) appears to be older
              than 0.39.1. Headless workspace-trust behavior had recent security hardening. Please
              upgrade Gemini CLI before using this app on real repositories.
            </div>
          )}

          <LinkedChatsStrip
            currentChat={currentChat}
            chats={chats}
            runningChatIds={runningChatIdsArray}
            onOpenBeside={handleOpenLinkedChatInSidePanelById}
            onOpenMain={handleOpenCockpitThread}
          />

          {/*
           * Keying the transcript on the current chat id guarantees a
           * full unmount + remount when the user switches chats. Without
           * the key, React would reconcile the existing
           * `<TranscriptPanel>` instance: messages from the previous
           * chat could remain in the DOM for a frame while React diffed
           * the children, and absolute-positioned welcome / composer
           * layers would render on top of the stale transcript. The
           * remount tears the previous chat's DOM tree down
           * synchronously so the welcome surface paints over a clean
           * transcript region every time.
           */}
          {inspectingRunId ? (
            <RunInspector
              key={`inspector-${inspectingRunId}`}
              runId={inspectingRunId}
              onClose={() => setInspectingRunId(null)}
              onJumpToSubThread={(subThreadId) => {
                // Switch chats to the sub-thread; the chat-switch effect
                // resets `inspectingRunId` automatically.
                const subThread = chats.find((c) => c.appChatId === subThreadId)
                if (subThread) handleOpenCockpitThread(subThread.appChatId)
              }}
            />
          ) : (
            <>
              {/*
                EnsembleParticipantStrip retired in 1.0.3 — its
                contents (per-participant status pills) merged into
                the new EnsembleParticipantsAboveRow that sits in
                the composer above-row stack, alongside the chip
                flyout that replaced the EnsembleSetupSheet modal.
              */}
              <TranscriptPanel
                key={currentChat?.appChatId || 'no-chat'}
                scrollRef={transcriptScrollRef}
                contentRef={transcriptContentRef}
                endRef={logsEndRef}
                messages={transcriptMessages}
                isWelcomeChat={isWelcomeChat}
                isThinking={effectiveIsThinking}
                showFallbackUX={showFallbackUX}
                pendingPlanChoice={pendingPlanChoice}
                pendingAgentQuestion={pendingAgentQuestion}
                onAgentQuestionSubmit={handleAgentQuestionSubmit}
                onAgentQuestionDismiss={handleAgentQuestionDismiss}
                runCompleteNotice={runCompleteNotice}
                runCompleteDurationText={runCompleteDurationText}
                currentChat={currentChat}
                currentRun={currentRun}
                currentWorkspacePath={currentWorkspace?.path}
                currentProviderLabel={currentProviderLabel}
                currentProvider={currentProvider}
                thinkingProviderLabel={thinkingProviderLabel}
                thinkingProvider={thinkingProvider}
                thinkingModelBadge={thinkingModelBadge}
                displayFileChangeSummaries={displayFileChangeSummaries}
                fileChangeSummaryText={fileChangeSummaryText}
                fileChangeShouldShowStats={fileChangeShouldShowStats}
                fileChangeDisplayAdds={fileChangeDisplayAdds}
                fileChangeDisplayDels={fileChangeDisplayDels}
                chats={chats}
                runningChatIds={runningChatIdsArray}
                onPlanChoiceSubmit={handlePlanChoiceSubmit}
                onRunFallback={handleRunFallback}
                onOpenSubThread={handleOpenCockpitThread}
                onOpenSubThreadInSidePanel={handleOpenLinkedChatInSidePanelById}
                onInspectRun={(runId) => setInspectingRunId(runId)}
                onOpenSideChatFromRun={
                  currentChat?.parentChatId ? undefined : handleOpenSideChatFromRunResult
                }
                compactDensity={appearance.compactDensity}
                pendingQueuedAppRunIds={pendingQueuedAppRunIds}
                onCopyMessage={handleCopyMessage}
                onDeleteMessage={handleDeleteMessage}
                onMessageSelectionCandidate={handleMessageSelectionCandidate}
                onPreviewImage={setPreviewChatMediaRef}
                onOpenSideChatFromMessage={handleOpenSideChatFromMessage}
                copiedId={copiedId}
                copy={copy}
                autoFollowRef={autoFollowRef}
                currency={displayCurrency}
                currencyOverestimatePercent={overestimatePercent}
                providerRates={providerRates}
              />
            </>
          )}

          {showGeminiTerminal && currentProvider === 'gemini' && hasWorkspaceContext && (
            <>
              <div
                className="gemini-terminal-resize-divider"
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize Gemini terminal split"
                tabIndex={0}
                onMouseDown={startGeminiTerminalResize}
                onKeyDown={handleGeminiTerminalResizeKeyDown}
              />
              <div
                className="gemini-terminal-split"
                role="region"
                aria-label="Gemini terminal output"
              >
                <div className="gemini-terminal-header">
                  <div className="gemini-terminal-title">
                    <AppleTerminalIcon />
                    <span>Gemini Terminal</span>
                    <span className="gemini-terminal-status">{geminiTerminalStatusLabel}</span>
                  </div>
                  <div className="gemini-terminal-actions">
                    <button
                      type="button"
                      className="gemini-terminal-action"
                      onClick={() =>
                        setThreadRawLogs(currentChat?.appChatId || currentChatIdRef.current, [])
                      }
                      title="Clear Gemini terminal output"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      className="gemini-terminal-action"
                      onClick={() => setShowGeminiTerminal(false)}
                      title="Close Gemini terminal"
                    >
                      Close
                    </button>
                  </div>
                </div>
                <div className="gemini-terminal-body">
                  {visibleGeminiTerminalLogs.length > 0 ? (
                    visibleGeminiTerminalLogs.map((entry, index) => (
                      <div
                        key={`${index}-${entry.type}`}
                        className={`gemini-terminal-line terminal-${entry.type}`}
                      >
                        <span className="gemini-terminal-prefix">{entry.type}</span>
                        <span className="gemini-terminal-text">{entry.content}</span>
                      </div>
                    ))
                  ) : (
                    <div className="gemini-terminal-empty">Awaiting Gemini terminal output.</div>
                  )}
                  <div ref={geminiTerminalEndRef} />
                </div>
                <form className="gemini-terminal-input-row" onSubmit={handleGeminiTerminalSubmit}>
                  <span className="gemini-terminal-prompt">$</span>
                  <input
                    value={geminiTerminalInput}
                    onChange={(event) => setGeminiTerminalInput(event.target.value)}
                    placeholder="Type input for the active Gemini run/session..."
                    spellCheck={false}
                  />
                  <button type="submit" disabled={!geminiTerminalInput.trim()}>
                    Send
                  </button>
                </form>
              </div>
            </>
          )}

          {shouldShowWelcomeUsageDashboard && welcomeDashboardCardEnabled && (
            <div className={`welcome-usage-region welcome-usage-region-${welcomeDashboardSize}`}>
              <WelcomeUsageDashboard
                data={welcomeUsageDashboardData}
                tab={welcomeUsageTab}
                onTabChange={setWelcomeUsageTab}
                /*
                  1.0.5-EW49 — Thread the user's currency + EW34
                  overestimate bias + EW49 per-stat visibility map
                  into the dashboard so the Total cost chip
                  formats correctly and hidden chips drop from
                  the dense grid. The global reset timestamp is
                  applied earlier (passed to
                  buildWelcomeUsageDashboardData above).
                */
                displayCurrency={displayCurrency}
                overestimatePercent={overestimatePercent}
                dashboardStatVisibility={settings?.dashboardStatPrefs?.visibility}
                /*
                  1.0.5-EW51 — Workspaces tab on/off + max card
                  count. Both come from
                  AppSettings.dashboardStatPrefs.
                */
                workspacesTabEnabled={settings?.dashboardStatPrefs?.workspacesTabEnabled}
                workspacesShown={settings?.dashboardStatPrefs?.workspacesShown}
                /*
                  1.0.5-EW52 — Providers tab on/off + auto-cycle
                  cadence (seconds; 0 disables). Both come from
                  AppSettings.dashboardStatPrefs. The dashboard
                  rotates through enabled tabs only while a
                  welcome screen is mounted — the setInterval
                  lives inside <WelcomeUsageDashboard>, so it
                  unmounts automatically when the welcome region
                  disappears.
                */
                providersTabEnabled={settings?.dashboardStatPrefs?.providersTabEnabled}
                autoCycleSeconds={settings?.dashboardStatPrefs?.autoCycleSeconds}
              />
            </div>
          )}

          <div className={`composer-area interface-${interfaceStyle}`} ref={composerAreaRef}>
            {shouldShowGhostCompanion && <GhostCompanion />}
            {/*
              Phase K-followup — Removed `provider-shell-status-row`.
              The row presented Native-session / Workspace-write /
              TaskWraith-approvals / TaskWraith-audit / Usage-metered as
              pill-shaped chips, but none were interactive. The visual
              language read like clickable buttons; in practice the
              row was pure decoration that crowded the composer. The
              still-useful pieces (workspace write mode, provider
              identity, usage state) are surfaced elsewhere — in the
              composer's runtime profile picker, in the sidebar's
              chat-tile metadata, and in the welcome dashboard.
              providerShellCapabilityChips computation kept for any
              future use but the row no longer mounts in any shell.
            */}
            {/*
                Composer-unification (Phase J1): welcome-state satellite
                slot for the cross-provider External Path + Worktree
                controls. Replaces the Codex-only header row that
                previously floated the External Path picker above the
                composer. The same component re-mounts inside the
                above-bar once the chat has activity (see below).
              */}
            {isWelcomeChat && !isCurrentGlobalChat && currentWorkspace && (
              <WorkspaceAccessControls
                variant="satellite"
                provider={currentProvider}
                currentWorkspace={currentWorkspace}
                isCurrentGlobalChat={isCurrentGlobalChat}
                isCurrentComposerLocked={isCurrentComposerLocked}
                hasWorkspaceContext={hasWorkspaceContext}
                currentGeminiWorktree={currentGeminiWorktree}
                onGeminiWorktreeToggle={onGeminiWorktreeToggleProp}
                worktreeToggleLabel={worktreeToggleLabel}
                worktreeDiffUnavailable={currentWorktreeDiffUnavailable}
              />
            )}
            {isWelcomeChat &&
              isCurrentEnsembleChat &&
              (() => {
                /*
                Ensemble welcome hero (1.0.3 Slice F follow-up). Replaces
                the solo-provider "New Codex thread for ..." copy with
                an ensemble-aware heading + a chevron-arrow chain
                showing the orchestration order. Disabled participants
                are skipped — the chain reflects the speaking sequence,
                not the full roster. The user can still drag the chip
                strip below to reorder.

                Per the maintainer's ship-night call: no starter cards on the
                ensemble welcome. Just hierarchy + textarea + the
                editable chip strip in the composer above-row.

                1.0.3 polish — provider-theme-aware shell. The
                ordered-enabled participant list drives the orchestration
                chain and the shared `--ensemble-provider-1..4` blend
                variables. The title glow intentionally uses that blend
                too; ensemble chats should not inherit a single provider's
                theme from the chat-level fallback provider.
              */
                const orderedEnabled = ensembleEnabledParticipantsForCurrent
                const ensembleIsContinuous =
                  currentChat?.ensemble?.orchestrationMode === 'continuous'
                const ensembleContinuationLimit = currentChat?.ensemble?.maxContinuationHops || 6
                const shellClassName = [
                  'welcome-hero',
                  'welcome-hero-ensemble',
                  `welcome-ensemble-shell`,
                  `welcome-ensemble-shell-count-${Math.min(orderedEnabled.length, 4)}`
                ]
                  .filter(Boolean)
                  .join(' ')
                const workspaceNameClass = 'workspace-name-glow workspace-name-glow-ensemble'
                return (
                  <div className={shellClassName} style={ensembleBlendStyle}>
                    <h1>
                      {isCurrentGlobalChat ? (
                        <>
                          <span>New Ensemble chat in </span>
                          <strong className={workspaceNameClass}>Global Chat</strong>
                          <span>.</span>
                        </>
                      ) : (
                        <>
                          <span>New Ensemble chat in </span>
                          <strong className={workspaceNameClass}>
                            {currentWorkspace?.displayName || 'TaskWraith'}
                          </strong>
                          <span> Workspace.</span>
                        </>
                      )}
                    </h1>
                    {orderedEnabled.length === 0 ? (
                      <p className="welcome-hero-ensemble-empty">
                        No providers enabled yet. Open any chip below to turn one back on, then
                        describe the task.
                      </p>
                    ) : (
                      <>
                        <p>
                          {orderedEnabled.length}{' '}
                          {orderedEnabled.length === 1 ? 'provider' : 'providers'} will work through
                          this in order.{' '}
                          {ensembleIsContinuous ? (
                            <>
                              Continuous mode lets them hand work back and forth with{' '}
                              <code>@mentions</code> or <code>ensemble_yield(target:&nbsp;…)</code>,
                              capped at {ensembleContinuationLimit} extra handoffs.
                            </>
                          ) : (
                            <>
                              Each speaks once unless you switch the chip strip to Continuous mode.
                            </>
                          )}
                        </p>
                        <div
                          className="ensemble-hierarchy-chain"
                          role="list"
                          aria-label="Ensemble orchestration order"
                        >
                          {orderedEnabled.map((participant, idx) => (
                            <div key={participant.id} className="ensemble-hierarchy-chain-step">
                              <div
                                className={`ensemble-hierarchy-tile provider-${participant.provider}`}
                                role="listitem"
                                title={`${participant.role || participant.provider} — speaks at position ${idx + 1}`}
                              >
                                <ProviderBadgeIcon provider={participant.provider} />
                                <div className="ensemble-hierarchy-tile-text">
                                  <span className="ensemble-hierarchy-tile-role">
                                    {participant.role || participant.provider}
                                  </span>
                                  <span className="ensemble-hierarchy-tile-provider">
                                    {participant.provider}
                                  </span>
                                </div>
                              </div>
                              {idx < orderedEnabled.length - 1 && (
                                <span className="ensemble-hierarchy-arrow" aria-hidden>
                                  →
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {/* Workspace picker on the ensemble welcome too —
                      same affordance as the solo welcome surface above,
                      because the ensemble path lands here just as
                      often after a "New Chat" click and needs the
                      same one-click workspace swap. */}
                    <WelcomeWorkspacePicker
                      workspaces={workspaces}
                      currentWorkspace={currentWorkspace}
                      isGlobalChat={isCurrentGlobalChat}
                      onPickExisting={handleSelectWelcomeWorkspace}
                      onAddNewWorkspace={handleSelectWelcomeWorkspaceDialog}
                      onSelectNoWorkspace={handleNewGlobalChat}
                    />
                  </div>
                )
              })()}
            {isWelcomeChat && !isCurrentEnsembleChat && (
              <div className="welcome-hero">
                <h1>
                  <span>{welcomeCopy.heading.beforeWorkspace}</span>
                  <strong className={`workspace-name-glow provider-${currentProvider}`}>
                    {welcomeCopy.heading.workspaceName}
                  </strong>
                  <span>{welcomeCopy.heading.afterWorkspace}</span>
                </h1>
                <p>{welcomeCopy.subheading}</p>
                {/*
                  Welcome workspace picker (1.0.3). The sidebar already has a
                  workspace list, but landing on the welcome screen of a new
                  chat — especially the global-chat fall-through — leaves the
                  user staring at "Workspace: <something>" with no way to change
                  it without first re-finding the sidebar. This row gives them
                  a one-click affordance: recent workspaces as quick chips,
                  plus a "Browse…" button to open the system folder picker.
                  Workspaces show their displayName + folder basename when
                  different.
                */}
                <WelcomeWorkspacePicker
                  workspaces={workspaces}
                  currentWorkspace={currentWorkspace}
                  isGlobalChat={isCurrentGlobalChat}
                  onPickExisting={handleSelectExistingWorkspace}
                  onAddNewWorkspace={handleSelectWorkspace}
                  onSelectNoWorkspace={handleNewGlobalChat}
                />
              </div>
            )}
            {/*
                Composer-unification (Phase J1): one above-bar shape for
                every composerStyle. Previously codex-style had a file-count
                summary + Review-changes button; claude/default had branch +
                add/del + Create PR. Both branches collapsed into one row
                that shows whatever data is available. The bottom-row
                review icon is the canonical "review changes" entry point
                across all providers, so we drop the codex-style duplicate
                button and keep Create PR as the above-bar action.
              */}
            {/*
              Slice F follow-up (1.0.3) — the stack renders not only
              when there's diff/file/external-path context (the
              original `!isWelcomeChat` rule) but also whenever the
              chat is an ensemble, so the participant chip strip is
              visible BEFORE the user sends their first prompt.
              Configure-before-send is the entire point of the strip;
              hiding it on welcome state defeated the rework.
              Inner sections still gate on `!isWelcomeChat` so the
              files / Create PR / external-path rows don't render
              with empty data on a fresh ensemble chat.
            */}
            {/* 1.0.4-AQ5 — also let GLOBAL ensemble chats into this
              stack so the participant chip strip renders. Before:
              `!isCurrentGlobalChat && currentWorkspace && ...` blocked
              global ensemble chats entirely, leaving them with no
              way to edit roster / orchestration mode / Work Session.
              Now: workspace-bound chats keep their existing rules
              (the inner sections still gate on `!isWelcomeChat` so
              Create PR / file-changes / external-path rows don't
              render with empty data), AND global ensemble chats
              get in for the participants strip via the explicit
              second branch. */}
            {((!isCurrentGlobalChat &&
              currentWorkspace &&
              (!isWelcomeChat || isCurrentEnsembleChat)) ||
              (isCurrentGlobalChat && isCurrentEnsembleChat)) && (
              <div className="composer-above-bar-stack">
                {/* 1.0.4-AQ5 — file-changes / Create-PR / external-path
                  rows are workspace-only by construction. Guard with
                  `currentWorkspace` so the new global-ensemble-chat
                  branch above doesn't drag them into render with
                  null workspace data. */}
                {!isWelcomeChat && currentWorkspace && (
                  <>
                    <div className="composer-above-bar style-unified">
                      <span className="composer-above-bar-branch">
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <circle cx="4" cy="3.5" r="1.6" />
                          <circle cx="4" cy="12.5" r="1.6" />
                          <circle cx="12" cy="7" r="1.6" />
                          <path d="M4 5.1v5.8M5.6 7c2 0 4.8 0 4.8-1.5" />
                        </svg>
                        {/*
                    `displayName · branch` mirrors the secondary rows
                    (`basename · branch` in ExternalPathAboveRow) so
                    the stack reads as one consistent label family
                    when a chat is touching multiple repos. Workspace
                    name is the primary identifier (plain weight);
                    branch is secondary (italic-stripped <em> with
                    `.composer-above-bar-secondary-branch` opacity so
                    it reads as metadata). The "·" lives outside both
                    spans so it copy-pastes cleanly.
                  */}
                        <span>
                          {currentWorkspace.displayName}
                          {' · '}
                          {/* Phase Git-U1 — prefer the LIVE branch from
                            gitSnapshot (populated once the diff-action menu
                            has been opened); fall back to the workspace
                            record's cached branch before the first read. A
                            detached snapshot reads "detached HEAD". */}
                          <em
                            className={`composer-above-bar-secondary-branch git-tone-${branchTone(
                              primaryGitSnapshot?.detached
                                ? undefined
                                : (primaryGitSnapshot?.branch ?? currentWorkspace?.branch),
                              primaryGitSnapshot?.detached ?? false
                            )}`}
                          >
                            {primaryGitSnapshot
                              ? primaryGitSnapshot.detached
                                ? 'detached HEAD'
                                : primaryGitSnapshot.branch || 'detached'
                              : currentWorkspace?.branch || 'detached'}
                          </em>
                        </span>
                      </span>
                      {primaryGitSnapshot && <GitMergeBadge snapshot={primaryGitSnapshot} />}
                      {/*
                  Phase K-followup — files-changed pill is now
                  always rendered (with "0 files changed" when no
                  diff yet). Fills the real-estate freed by removing
                  the non-interactive "Worktree: managed by X" pill
                  and gives the diff row a stable, predictable shape
                  regardless of run state.

                  Wrapped in `.composer-above-bar-files-cluster` so
                  the Codex shell can place files+diff as ONE grid
                  cell and centre it cleanly. Other shells get
                  `display: contents` on the wrapper (declared in
                  main.css) so files + stats still behave as direct
                  flex children of `.composer-above-bar` — no
                  layout regression in the TaskWraith / Claude /
                  Gemini / Kimi shells.
                */}
                      <span className="composer-above-bar-files-cluster">
                        {/*
                    Order: files-changed pill FIRST, then the diff
                    stats (`+N -M`). Matches the user's stated
                    preference ("X files changed | +diff"). The
                    non-Codex shells (cluster has `display: contents`)
                    inherit this order too since the children
                    participate directly in the parent flex.
                  */}
                        <span
                          className="composer-above-bar-files"
                          title={
                            workspaceDiffStats.filesChanged > 0
                              ? `${workspaceDiffStats.filesChanged} uncommitted ${workspaceDiffStats.filesChanged === 1 ? 'file' : 'files'} in the working tree`
                              : 'Working tree clean — nothing to commit'
                          }
                        >
                          <strong>{workspaceDiffStats.filesChanged}</strong>{' '}
                          {workspaceDiffStats.filesChanged === 1 ? 'file changed' : 'files changed'}
                        </span>
                        {(workspaceDiffStats.additions > 0 || workspaceDiffStats.deletions > 0) && (
                          <span className="composer-above-bar-stats">
                            <span className="composer-diff-add">
                              +{workspaceDiffStats.additions}
                            </span>
                            <span className="composer-diff-del">
                              -{workspaceDiffStats.deletions}
                            </span>
                          </span>
                        )}
                      </span>
                      {/* Phase Git-U1 — live git-state pill driven by
                        gitSnapshot (populated once the diff-action menu has
                        been opened). Surfaces staged/unstaged state and
                        push/PR readiness right in the header so the user can
                        see what the Review/Commit/Create-PR menu will act on
                        without opening it. Rendered only once a snapshot is
                        in hand so the header stays stable pre-read. */}
                      {primaryGitSnapshot && <GitSyncChip snapshot={primaryGitSnapshot} />}
                      <GitCiChip pr={primaryPr} />
                      {/*
                    Composer-unification (Phase J1): once the chat has
                    activity, External Path + Worktree migrate from the
                    welcome-state satellite slot into the above-bar so
                    they sit alongside the workspace summary band the
                    user is already looking at.
                  */}
                      <WorkspaceAccessControls
                        variant="inline"
                        provider={currentProvider}
                        currentWorkspace={currentWorkspace}
                        isCurrentGlobalChat={isCurrentGlobalChat}
                        isCurrentComposerLocked={isCurrentComposerLocked}
                        hasWorkspaceContext={hasWorkspaceContext}
                        currentGeminiWorktree={currentGeminiWorktree}
                        onGeminiWorktreeToggle={onGeminiWorktreeToggleProp}
                        worktreeToggleLabel={worktreeToggleLabel}
                        worktreeDiffUnavailable={currentWorktreeDiffUnavailable}
                      />
                      {(() => {
                        const hasReviewableDiff = workspaceDiffStats.filesChanged > 0
                        // 1.0.6-EW66-1d — primary workspace's PR state is now
                        // read from the per-path map keyed by its own path.
                        const primaryPrState = getCreatePrState(currentWorkspace?.path)
                        // Phase Git-U1 — the trigger button keeps "Review
                        // changes" as the FIRST/primary action whenever there's
                        // a diff (the canonical safety entry point); it falls
                        // back to the PR label otherwise. The menu it opens is
                        // now the real user-driven GitCommitControls (status +
                        // review + stage/commit + gated PR) — no more agent
                        // prompt-injection for committing.
                        const createPrLabel =
                          primaryPrState.status === 'pending'
                            ? 'Creating…'
                            : primaryPrState.status === 'success'
                              ? 'PR opened'
                              : primaryPrState.status === 'error'
                                ? 'Retry PR'
                                : 'Create PR'
                        // Phase Git-U5 — context-aware primary action: Review
                        // (working-tree changes) → Push (clean but unpushed) →
                        // Create PR (pushed). Mirrors the menu's
                        // Review → Commit → Push → PR flow so the headline names
                        // the real next git step (Codex/Claude-desktop style).
                        const needsPush = Boolean(
                          primaryGitSnapshot &&
                            !primaryGitSnapshot.detached &&
                            primaryGitSnapshot.branch &&
                            primaryGitSnapshot.remoteUrl &&
                            (!primaryGitSnapshot.upstream ||
                              (primaryGitSnapshot.ahead ?? 0) > 0)
                        )
                        const primaryLabel = hasReviewableDiff
                          ? 'Review changes'
                          : needsPush
                            ? primaryGitSnapshot && !primaryGitSnapshot.upstream
                              ? 'Publish branch'
                              : 'Push'
                            : createPrLabel
                        const actionClassName = `composer-above-bar-action ${primaryPrState.status === 'pending' ? 'is-pending' : ''} ${primaryPrState.status === 'error' ? 'is-error' : ''} ${primaryPrState.status === 'success' ? 'is-success' : ''}`
                        return (
                          <span className="composer-diff-action-menu-wrap">
                            <button
                              type="button"
                              className={actionClassName}
                              onClick={() => setDiffActionMenuOpen((open) => !open)}
                              disabled={primaryPrState.status === 'pending'}
                              aria-haspopup="menu"
                              aria-expanded={diffActionMenuOpen}
                              title={
                                primaryPrState.message ||
                                'Review, commit, push, or open a PR for the current workspace'
                              }
                            >
                              {primaryLabel}
                            </button>
                            {diffActionMenuOpen && (
                              <div className="composer-diff-action-menu" role="menu">
                                <GitCommitControls
                                  workspacePath={currentWorkspace?.path}
                                  open={diffActionMenuOpen}
                                  hasReviewableDiff={hasReviewableDiff}
                                  onReviewChanges={() => setRightTab('diff')}
                                  onClose={() => setDiffActionMenuOpen(false)}
                                  onCreatePr={() =>
                                    void handleCreateGithubPr(currentWorkspace?.path)
                                  }
                                  prState={primaryPrState}
                                  onSnapshot={setPrimaryGitSnapshot}
                                />
                              </div>
                            )}
                          </span>
                        )
                      })()}
                    </div>
                    {/* Slice 3 of the external-path-redesign arc. One stacked
                  row per external-path grant. Per-grant repo metadata
                  decides whether the row shows branch+repo-name or a
                  bare basename.

                  1.0.6-EW66-1d — WRITE grants now also get a per-path
                  Create-PR action (matching the primary workspace row).
                  PR state is keyed by `grant.path`, so an ensemble's
                  several same-path write grants share one repo's PR
                  progress. READ grants keep the reference-only banner. */}
                    {externalWorkspaceGroups.map((group) => (
                      <ExternalPathAboveRow
                        key={group.path}
                        grant={group.representative}
                        access={group.access}
                        providers={group.providers}
                        repoMetadata={externalPathRepoMetadata[group.representative.id] || null}
                        snapshot={externalGitSnapshots[group.path] ?? null}
                        diffStats={(() => {
                          const snap = externalGitSnapshots[group.path]
                          return snap
                            ? {
                                filesChanged: snap.counts?.changed ?? 0,
                                additions: snap.lineStats?.additions ?? 0,
                                deletions: snap.lineStats?.deletions ?? 0
                              }
                            : undefined
                        })()}
                        onRevoke={() => handleRemoveExternalPathGrantsByPath(group.path)}
                        createPrState={getCreatePrState(group.path)}
                        onCreatePr={() => handleCreateGithubPr(group.path)}
                        onReviewChanges={() =>
                          void window.api.openWorkspacePopout({
                            kind: 'diff-studio',
                            workspacePath: group.path
                          })
                        }
                      />
                    ))}
                  </>
                )}
                {/*
                  Slice F (1.0.3) — ensemble participants live in the
                  composer above-row stack now. Sits below the unified
                  branch / files-changed / Create PR row and any
                  external-path rows, but stays above the composer
                  textarea so the diff/PR signals read first. Returns
                  null for non-ensemble chats so single-provider chats
                  don't see an empty cell.

                  Renders on welcome state too (no `!isWelcomeChat`
                  gate) so the user can configure participants BEFORE
                  the first prompt — configure-before-send is the
                  entire point of the strip.
                */}
                {currentChat?.chatKind === 'ensemble' && (
                  <EnsembleParticipantsAboveRow
                    chat={currentChat}
                    selectedParticipantId={effectiveSelectedParticipantId}
                    onSelectParticipant={handleSelectParticipant}
                    onChatChange={(updatedChat) => {
                      chatByIdRef.current.set(updatedChat.appChatId, updatedChat)
                      setCurrentChat((prev) =>
                        prev?.appChatId === updatedChat.appChatId ? updatedChat : prev
                      )
                      setChats((prev) =>
                        prev.map((c) => (c.appChatId === updatedChat.appChatId ? updatedChat : c))
                      )
                      void window.api.saveChat(updatedChat)
                    }}
                    onSkipActive={() => {
                      // Skip only the currently-speaking participant.
                      // The composer's existing Stop button (wired to
                      // `handleCancel` → `cancelEnsembleRound`) keeps
                      // its role as the full-round abort affordance.
                      if (!currentChat) return
                      void window.api.skipEnsembleParticipant(currentChat.appChatId)
                    }}
                    onStopWorkSession={() => void handleStopWorkSession()}
                    onRetryParticipant={(participantId) => {
                      // 1.0.4-AT7 — re-dispatch the named participant
                      // as a DM with the chat's last user prompt.
                      // The orchestrator already supports DM scoping
                      // (`runEnsembleRound({ dmTargetParticipantId })`)
                      // so this fires a brand-new round limited to
                      // the failed participant — they get one more
                      // try without rerunning the whole panel.
                      // Fall back to a quiet info log when there's
                      // no prior user prompt to retry against.
                      if (!currentChat) return
                      const lastUserMessage = [...(currentChat.messages || [])]
                        .reverse()
                        .find((m) => m.role === 'user')
                      const retryPrompt = lastUserMessage?.content?.trim()
                      if (!retryPrompt) {
                        setRawLogs((prev) => [
                          ...prev,
                          {
                            type: 'info',
                            content: 'Retry: no prior user prompt on this chat to re-dispatch with.'
                          }
                        ])
                        return
                      }
                      void window.api.runEnsembleRound({
                        chatId: currentChat.appChatId,
                        prompt: retryPrompt,
                        mode: 'normal',
                        concurrentMode: false,
                        dmTargetParticipantId: participantId
                      })
                    }}
                    onWakeNowParticipant={(wakeupId) => {
                      // 1.0.5-N7 — Fire the wakeup immediately. The
                      // orchestrator's handleWakeupFired path runs
                      // the same code the timer would; the participant
                      // resumes with the [Scheduled wakeup] prompt
                      // block as if the wake time had arrived.
                      void window.api.wakeEnsembleParticipantNow(wakeupId)
                    }}
                    onCancelWakeupParticipant={(wakeupId) => {
                      // 1.0.5-N7 — Cancel the pending wakeup. The
                      // participant exits sleeping state; the round
                      // continues with other participants. Falls
                      // back to a persisted-record cancel if there's
                      // no in-memory runtime (e.g. post-restart).
                      void window.api.cancelEnsembleParticipantWakeup(wakeupId)
                    }}
                  />
                )}
                {/*
                  Queued-messages above-row. Renders the chat's pending
                  run-queue jobs as a stack of bubbles with per-row
                  Edit / Delete / Steer actions, drag-to-reorder, and
                  scroll past 5 entries. Returns null when empty so
                  it adds nothing to the stack for chats without
                  queued work. See `QueuedMessagesAboveRow.tsx`.
                */}
                <QueuedMessagesAboveRow
                  chat={currentChat}
                  entries={queuedMessagesAboveRowEntries}
                  onEdit={handleEditQueuedMessage}
                  onDelete={handleDeleteQueuedMessage}
                  onSteer={handleSteerToQueuedMessage}
                  onReorder={handleReorderQueuedMessages}
                />
              </div>
            )}
            <div
              className={`composer-surface ${isComposerDragOver ? 'is-drag-over' : ''} ${composerAgentAuraClass}`}
              onDragEnter={handleComposerDragEnter}
              onDragOver={handleComposerDragOver}
              onDragLeave={handleComposerDragLeave}
              onDrop={handleComposerDrop}
            >
              {showComposerChips && (
                <div className="composer-chips">
                  {currentProvider === 'gemini' && currentWorktreeDiffUnavailable && (
                    <span className="composer-chip warning">Worktree diff disabled</span>
                  )}
                  {currentProvider === 'gemini' && persistentSessionNeedsRestart && (
                    <span className="composer-chip warning">{sessionRestartReason}</span>
                  )}
                  {currentProviderCapabilityWarning && (
                    <span
                      className="composer-chip warning"
                      title={currentProviderCapabilityWarning.message}
                    >
                      {currentProviderCapabilityWarning.title}
                    </span>
                  )}
                  {queuedRunQueueCount > 0 && (
                    <span
                      className="composer-chip"
                      title="Durable queued tasks are persisted by TaskWraith."
                    >
                      {queuedRunQueueCount} queued
                    </span>
                  )}
                </div>
              )}
              {/*
                Composer-unification (Phase J1): one uniform top-toggles row
                for every provider. Gemini's persistent-session + checkpoints
                toggles moved into the command palette popover (see
                `geminiQuickToggleItems` below) so the visible top row is
                identical across providers: session indicator + permission
                indicator + schedule + runtime profile. Worktree, External
                Path, and Trust are surfaced as cross-provider satellite
                / above-bar pills via WorkspaceAccessControls. Provider
                identity is expressed through theme tokens only.
              */}
              {/*
                Phase K-followup — Removed the informational "New X
                thread" + permission-mode chips from the top-toggles
                row. They were styled identically to the actual
                interactive controls (composer-picker-command) so the
                row read as four clickable buttons when really only
                two were actionable. The thread/session state is
                already visible in the sidebar's chat tile + active
                tab indicator; permission mode is set via the
                runtime-profile picker that stays in this row.
                Schedule + runtime-profile controls remain — those
                are genuinely actionable.
              */}
              {!isCurrentEnsembleChat && (scheduleControls || runtimeProfileControl) && (
                <div className="composer-top-toggles">
                  {scheduleControls}
                  {runtimeProfileControl}
                </div>
              )}

              {imageAttachments.length > 0 && (
                <div
                  className="composer-image-strip composer-attachment-tray"
                  aria-label="Composer attachments"
                >
                  {composerImageAttachments.map((image) => (
                    <div
                      key={image.id}
                      className="composer-image-item composer-image-tile is-image"
                      title={image.path}
                      aria-label={`Image attachment ${image.name}`}
                    >
                      <img
                        src={getImagePreviewSrc(image.path)}
                        alt={image.name}
                        className="composer-image-thumb"
                        draggable={false}
                      />
                      <button
                        className="composer-image-remove"
                        type="button"
                        onClick={() => handleRemoveImageAttachment(image.id)}
                        disabled={isCurrentComposerLocked}
                        title="Remove attachment"
                        aria-label={`Remove ${image.name}`}
                      >
                        <XSymbolIcon />
                      </button>
                    </div>
                  ))}
                  {composerFileAttachments.map((file) => (
                    <div
                      key={file.id}
                      className="composer-image-item composer-file-card"
                      title={file.path}
                    >
                      <span className="composer-attachment-icon" title={file.name}>
                        <FileTypeIcon
                          path={file.path}
                          size={18}
                          className="composer-attachment-icon-inner"
                          workspacePath={currentWorkspace?.path}
                        />
                      </span>
                      <span className="composer-image-name" title={file.path}>
                        {file.name}
                      </span>
                      <button
                        className="composer-image-remove"
                        type="button"
                        onClick={() => handleRemoveImageAttachment(file.id)}
                        disabled={isCurrentComposerLocked}
                        title="Remove attachment"
                        aria-label={`Remove ${file.name}`}
                      >
                        <XSymbolIcon />
                      </button>
                    </div>
                  ))}
                  <span className="composer-image-count">{`${imageAttachments.length}/${MAX_IMAGE_ATTACHMENTS}`}</span>
                </div>
              )}

              {/*
                Console redesign — INNER MODULE. The textarea + the
                two bottom-control rows are the actual *input*, so they
                live on a normal theme-tone surface (`.composer-inner-
                module`) that stays perfectly readable. The OUTER
                `.composer-surface` is restyled (shard 07/03) into a
                translucent CONTRAST glass (light glass on dark themes,
                dark glass on light themes) that shows only as the FRAME
                around this module via the surface's existing padding;
                the provider rim carries onto BOTH rims. `.composer-
                chips` + `.composer-top-toggles` (+ attachment tray)
                stay above, as children of the outer frame.
                NOTE: `.composer-bottom-controls` keeps its `display:
                contents` (native shell) so its control-footer +
                telemetry rows remain *effective* children of the input
                container — now this inner module — exactly as the
                "two rows" contract (below) documents.
              */}
              <div className="composer-inner-module">
                {(() => {
                  // Gate the overlay activation: render the highlight
                  // layer only when the prompt contains at least one
                  // RESOLVED `@Token`. Without this, the textarea's
                  // `color: transparent` zeros out the text in shells
                  // where the overlay's font/padding drifts from the
                  // textarea (Claude / Codex / Kimi etc. each override
                  // base padding). the maintainer hit this on the ensemble
                  // welcome screen — text invisible in Claude shell,
                  // vertical sync issues in others.
                  // 1.0.4 — drop the `isCurrentEnsembleChat` precondition.
                  // `hasResolvedMention` already self-guards on
                  // `participants.length === 0`, so non-ensemble chats
                  // are excluded naturally. The extra gate caused a
                  // regression on the ensemble welcome screen where
                  // `chatKind === 'ensemble'` evaluated false during
                  // some welcome-surface render passes — leaving typed
                  // tags as plain white text instead of bold +
                  // provider-tinted (the maintainer's "tags not lighting up"
                  // report). Now: anywhere participants ARE configured
                  // and a mention resolves, the overlay activates.
                  const composerHasMention = hasResolvedMention(
                    prompt,
                    currentChat?.ensemble?.participants || []
                  )
                  // 1.0.4 — sync epoch for the overlay's auto-metric
                  // mirror. Any change in the inputs below can shift
                  // the textarea's computed font / padding / border,
                  // so we encode them into a single string the
                  // overlay watches as a useLayoutEffect dep. The
                  // ResizeObserver inside the overlay handles every
                  // size-changing variation that happens between
                  // these explicit triggers.
                  const composerOverlaySyncEpoch = `${appearance.composerStyle}|${appearance.themeAppearance}|${isWelcomeChat ? 'welcome' : 'active'}`
                  return (
                    <div className="composer-textarea-wrap">
                      {composerHasMention && (
                        <ComposerHighlightOverlay
                          value={prompt}
                          participants={currentChat?.ensemble?.participants}
                          textareaRef={composerTextareaRef}
                          syncEpoch={composerOverlaySyncEpoch}
                        />
                      )}
                      <textarea
                        className={`composer-textarea${composerHasMention ? ' has-mention-overlay' : ''}`}
                        ref={composerTextareaRef}
                        value={prompt}
                        onChange={(e) => {
                          const nextValue = e.target.value
                          // 1.0.4-AQ3 — snapshot the caret position from
                          // the change event BEFORE React reconciles. The
                          // restoration layout effect below reads this ref
                          // and re-applies the caret after the className
                          // flip + overlay mount that can land mid-keystroke
                          // when an `@token` resolves.
                          composerSelectionRef.current = {
                            start: e.target.selectionStart ?? nextValue.length,
                            end: e.target.selectionEnd ?? nextValue.length
                          }
                          composerCaretRestoreEpochRef.current += 1
                          setPrompt(nextValue)
                          // Composer popover coordinator: scan the text before the
                          // caret for a leading `/<query>` token (start-of-line or
                          // after whitespace), then for an `@<query>` mention token.
                          // Whichever matches wins; the other is force-closed. Only
                          // one popover open at a time.
                          const caret = e.target.selectionStart ?? nextValue.length
                          const before = nextValue.slice(0, caret)
                          const slashMatch = before.match(/(?:^|\s)\/([\w-]*)$/)
                          const mentionTrigger = !slashMatch
                            ? parseComposerMentionTrigger(nextValue, caret)
                            : null
                          if (slashMatch) {
                            // The `/` itself sits at `caret - slashQueryLen - 1`.
                            const queryLen = slashMatch[1].length
                            slashAnchorIndexRef.current = caret - queryLen - 1
                            setSlashQuery(slashMatch[1] || '')
                            setSlashMenuOpen(true)
                            if (mentionMenuOpen) {
                              setMentionMenuOpen(false)
                              setMentionQuery('')
                              mentionAnchorIndexRef.current = null
                            }
                          } else if (mentionTrigger) {
                            mentionAnchorIndexRef.current = mentionTrigger.anchorIndex
                            mentionTriggerLengthRef.current = mentionTrigger.triggerLength
                            setMentionTriggerKind(mentionTrigger.kind)
                            setMentionQuery(mentionTrigger.query)
                            setMentionMenuOpen(true)
                            if (slashMenuOpen) {
                              setSlashMenuOpen(false)
                              setSlashQuery('')
                              slashAnchorIndexRef.current = null
                            }
                          } else {
                            if (mentionMenuOpen) {
                              setMentionMenuOpen(false)
                              setMentionQuery('')
                              mentionAnchorIndexRef.current = null
                            }
                            if (slashMenuOpen) {
                              setSlashMenuOpen(false)
                              setSlashQuery('')
                              slashAnchorIndexRef.current = null
                            }
                          }
                        }}
                        placeholder={composerPlaceholder}
                        aria-label={composerAriaLabel}
                        rows={1}
                        disabled={!currentChat || (!isCurrentGlobalChat && !currentWorkspace)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault()
                            if (tryHandleSideSlashSubmit()) {
                              return
                            }
                            triggerSendConfirmation()
                            // DM target resolution order (first match wins):
                            //   1. An explicit `@participant` mention in the
                            //      prompt body (`ensemble-dm://` markdown link
                            //      inserted by the mention picker).
                            //   2. Legacy Cmd/Ctrl+Enter on a selected chip
                            //      (A2 from 1.0.3 — kept so muscle memory
                            //      still works).
                            // Plain Enter with no mention + no modifier
                            // dispatches the full round.
                            const dmFromMention = isCurrentEnsembleChat
                              ? extractFirstEnsembleDmTarget(
                                  prompt,
                                  currentChat?.ensemble?.participants
                                )
                              : null
                            const dmTarget =
                              dmFromMention ||
                              (isCurrentEnsembleChat &&
                              effectiveSelectedParticipantId &&
                              (e.metaKey || e.ctrlKey)
                                ? effectiveSelectedParticipantId
                                : undefined)
                            handleRun(undefined, undefined, dmTarget || undefined)
                          }
                        }}
                      />
                    </div>
                  )
                })()}
                <ComposerSlashMenu
                  open={slashMenuOpen}
                  anchorRef={composerTextareaRef}
                  query={slashQuery}
                  commands={composerSlashCommands}
                  composerStyle={appearance.composerStyle}
                  onDismiss={() => {
                    setSlashMenuOpen(false)
                    setSlashQuery('')
                    slashAnchorIndexRef.current = null
                  }}
                  onPick={(command) => handleComposerSlash(command)}
                />
                <AgentMentionMenu
                  chat={currentChat || undefined}
                  provider={currentProvider}
                  composerStyle={appearance.composerStyle}
                  workspacePath={currentWorkspace?.path}
                  externalPathGrants={externalPathGrants}
                  /*
                    1.0.5-EW53 — Dropped `prompt={prompt}` from this
                    spread. The prop was never declared on
                    AgentMentionMenuProps (the destructure doesn't
                    pick it up), so the menu never read it — but
                    passing it down made every keystroke flow a
                    fresh string into JSX reconciliation. Once the
                    menu is wrapped in memo (TODO), removing the
                    unused prop keeps the prop diff clean.
                  */
                  open={mentionMenuOpen}
                  anchorRef={composerTextareaRef}
                  query={mentionQuery}
                  triggerKind={mentionTriggerKind}
                  ensembleParticipants={
                    isCurrentEnsembleChat ? currentChat?.ensemble?.participants : undefined
                  }
                  onDismiss={() => {
                    setMentionMenuOpen(false)
                    setMentionQuery('')
                    mentionAnchorIndexRef.current = null
                  }}
                  onPick={(mention) => {
                    const anchor = mentionAnchorIndexRef.current
                    if (anchor === null) {
                      setMentionMenuOpen(false)
                      setMentionQuery('')
                      return
                    }
                    // The trigger characters (`@` or `-@`) + the live
                    // query string need to be stripped — replace them
                    // wholesale with the chosen mention's insertion.
                    const triggerLen = mentionTriggerLengthRef.current
                    const before = prompt.slice(0, anchor)
                    const afterQuery = prompt.slice(anchor + triggerLen + mentionQuery.length)
                    const insertion = (() => {
                      if (mention.kind === 'agent' && mention.agentId) {
                        return `[@${mention.name}](agent://${mention.agentId}) `
                      }
                      if (mention.kind === 'participant' && mention.participantId) {
                        // Ensemble DM mention. Insert PLAIN `@Role`
                        // (no markdown link) so the composer textarea
                        // shows a clean readable token instead of the
                        // raw markdown URL. On send,
                        // `extractFirstEnsembleDmTarget` resolves the
                        // `@Role` against the chat's participants by
                        // role (case-insensitive) → provider name and
                        // produces the right `dmTargetParticipantId`.
                        // This also means free-typed `@Gemini` or
                        // `@Worker` works the same as a picker click.
                        return `@${mention.name} `
                      }
                      return formatComposerPathMention(mention.path || mention.name)
                    })()
                    const next = `${before}${insertion}${afterQuery}`
                    setPrompt(next)
                    setMentionMenuOpen(false)
                    setMentionQuery('')
                    mentionAnchorIndexRef.current = null
                    // Restore caret after the inserted mention/path.
                    requestAnimationFrame(() => {
                      const ta = composerTextareaRef.current
                      if (!ta) return
                      const newCaret = before.length + insertion.length
                      ta.focus()
                      ta.setSelectionRange(newCaret, newCaret)
                    })
                  }}
                />
                {/*
                  1.0.6-EW68 — Two-container composer split (Obsidian +
                  Alabaster only). The control-footer (send row + Row A:
                  Turn/Continuous/Work-Session + provider + model +
                  approval) and the telemetry-row (Row B: timecode +
                  workspace + token tally) are wrapped here so those two
                  shells can render them as a SECOND lit rect below the
                  textarea rect. For the other nine shells this wrapper is
                  `display: contents`, so it vanishes from layout and the
                  two rows stay effective children of `.composer-surface`
                  exactly as before.
                */}
                <div className="composer-bottom-controls">
                  <div className="composer-control-footer">
                    {currentProvider === 'codex' &&
                      !isCurrentGlobalChat &&
                      externalPathGrants.length > 0 && (
                        <div className="composer-image-strip composer-external-grant-strip">
                          {externalPathGrants.map((grant) => (
                            <div
                              key={grant.id}
                              className={`composer-image-item external-grant access-${grant.access}`}
                            >
                              <PermissionSymbolIcon />
                              <span className="composer-image-name" title={grant.path}>
                                {grant.access === 'write' ? 'Edit' : 'Read'} {grant.kind}:{' '}
                                {grant.path}
                              </span>
                              <button
                                className="composer-image-remove"
                                type="button"
                                onClick={() => handleRemoveExternalPathGrant(grant.id)}
                                disabled={isCurrentComposerLocked}
                                title="Revoke external path grant"
                              >
                                <XSymbolIcon />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    {permissionRequestPaths.length > 0 && (
                      <div className="composer-permission-card">
                        <div className="composer-permission-title">
                          <span>{permissionRequestTitle}</span>
                          {permissionRequestSource && (
                            <span className="composer-permission-source">
                              {permissionRequestSource}
                            </span>
                          )}
                        </div>
                        {permissionRequestMessage && (
                          <div className="composer-permission-message">
                            {permissionRequestMessage}
                          </div>
                        )}
                        <div className="composer-permission-paths">
                          {permissionRequestPaths.map((path) => (
                            <span key={path} className="composer-permission-path">
                              {path}
                            </span>
                          ))}
                        </div>
                        <div className="composer-permission-actions">
                          <button
                            className="btn btn-sm"
                            type="button"
                            onClick={handlePermissionRetry}
                          >
                            Add paths and rerun
                          </button>
                          <button
                            className="btn btn-sm btn-ghost"
                            type="button"
                            onClick={clearImagePermissions}
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    )}
                    {/* Phase J3: session-scoped YOLO indicator. Visible when the
                      user has clicked "Trust this session" — every subsequent
                      approval auto-allows. Includes a one-click disable.
                      Slice A: dismissible via the inline ✕ button; the
                      collapsed state is represented by `.composer-yolo-chip`
                      in the action row below. */}
                    {sessionYoloMode.enabled && !yoloBannerDismissed && (
                      <div
                        className="composer-permission-card provider-yolo"
                        style={{
                          background: 'rgba(244, 162, 97, 0.12)',
                          borderColor: 'rgba(244, 162, 97, 0.5)'
                        }}
                      >
                        <div className="composer-permission-title">
                          <span>Trust mode active — every approval auto-allowed</span>
                          <span className="composer-permission-source">YOLO</span>
                        </div>
                        <div className="composer-permission-message">
                          Approval modals will be skipped for the rest of this app session. Global
                          Deny policies still apply. Restart the app to revert, or disable here.
                        </div>
                        <div className="composer-permission-actions">
                          <button
                            className="btn btn-sm btn-ghost"
                            type="button"
                            onClick={async () => {
                              try {
                                await window.api.agenticYoloSet(false)
                              } catch (error) {
                                console.error('Failed to disable YOLO session mode', error)
                              }
                            }}
                          >
                            Disable trust mode
                          </button>
                          <button
                            className="btn btn-sm btn-ghost composer-yolo-banner-dismiss"
                            type="button"
                            onClick={() => setYoloBannerDismissed(true)}
                            title="Hide this banner (trust mode stays on)"
                            aria-label="Dismiss trust mode banner"
                          >
                            ✕ Dismiss
                          </button>
                        </div>
                      </div>
                    )}
                    {pendingAgentApproval && (
                      <div
                        className={`composer-permission-card provider-${pendingAgentApproval.provider}`}
                      >
                        <div className="composer-permission-title">
                          <span>{pendingAgentApproval.title}</span>
                          <span className="composer-permission-source">
                            {getProviderLabel(pendingAgentApproval.provider)}
                            {/* 1.0.4-AK4 — surface the queue depth so the
                              user knows other approvals are waiting on
                              this same chat. Common case (single
                              approval at a time) shows nothing extra. */}
                            {(() => {
                              const queue = currentComposerChatId
                                ? pendingApprovalQueueByChatId[currentComposerChatId] || []
                                : []
                              if (queue.length === 0) return null
                              return (
                                <span
                                  className="composer-permission-queue-badge"
                                  title={`${queue.length} more approval${
                                    queue.length === 1 ? '' : 's'
                                  } queued behind this one — they appear in order as you respond.`}
                                >
                                  +{queue.length} more
                                </span>
                              )
                            })()}
                          </span>
                        </div>
                        {pendingAgentApproval.body && (
                          <div className="composer-permission-message">
                            {pendingAgentApproval.body}
                          </div>
                        )}
                        {/* Slice 4 of the external-path-redesign arc.
                          When the runtime detector emits an external-path
                          approval, it stashes the detected path under
                          `preview.externalPathDetection`. Render it
                          prominently so the user knows WHICH path they're
                          granting before clicking the action button. */}
                        {pendingAgentApproval.preview?.externalPathDetection?.path && (
                          <div className="composer-permission-external-path">
                            <span className="composer-permission-external-path-label">Path</span>
                            <code className="composer-permission-external-path-value">
                              {pendingAgentApproval.preview.externalPathDetection.path}
                            </code>
                          </div>
                        )}
                        {renderAgentApprovalPreview(pendingAgentApproval.preview)}
                        {/* Order-4 — optional one-line intent note. Always
                          optional: it never blocks approve/deny. The text
                          is captured at click time in
                          `handleAgentApprovalAction` and persisted onto
                          the approval-ledger row's metadata as
                          `intentNote` (no schema migration). */}
                        <input
                          type="text"
                          className="composer-permission-note"
                          value={intentNote}
                          onChange={(e) => setIntentNote(e.target.value)}
                          placeholder="why? (optional)"
                          aria-label="Optional note explaining this approval decision"
                          maxLength={280}
                        />
                        <div className="composer-permission-actions">
                          {(pendingAgentApproval.actions || ['accept']).includes('accept') && (
                            <button
                              className="btn btn-sm"
                              type="button"
                              onClick={() =>
                                void handleAgentApprovalAction(pendingAgentApproval.id, 'accept')
                              }
                            >
                              {pendingAgentApproval.method === 'hostCommand/rerun'
                                ? 'Rerun outside sandbox'
                                : 'Allow once'}
                            </button>
                          )}
                          {(pendingAgentApproval.actions || []).includes('useProviderNative') && (
                            <button
                              className="btn btn-sm"
                              type="button"
                              onClick={() =>
                                void handleAgentApprovalAction(
                                  pendingAgentApproval.id,
                                  'useProviderNative'
                                )
                              }
                            >
                              Use Provider Native
                            </button>
                          )}
                          {(pendingAgentApproval.actions || []).includes('useTaskWraithSubthread') && (
                            <button
                              className="btn btn-sm btn-ghost"
                              type="button"
                              onClick={() =>
                                void handleAgentApprovalAction(
                                  pendingAgentApproval.id,
                                  'useTaskWraithSubthread'
                                )
                              }
                            >
                              Use TaskWraith Sub-thread
                            </button>
                          )}
                          {(pendingAgentApproval.actions || []).includes('acceptForWorkspace') && (
                            <button
                              className="btn btn-sm btn-ghost"
                              type="button"
                              onClick={() =>
                                void handleAgentApprovalAction(
                                  pendingAgentApproval.id,
                                  'acceptForWorkspace'
                                )
                              }
                            >
                              Allow in workspace
                            </button>
                          )}
                          {(pendingAgentApproval.actions || ['acceptForSession']).includes(
                            'acceptForSession'
                          ) && (
                            <button
                              className="btn btn-sm btn-ghost"
                              type="button"
                              onClick={() =>
                                void handleAgentApprovalAction(
                                  pendingAgentApproval.id,
                                  'acceptForSession'
                                )
                              }
                            >
                              Allow for session
                            </button>
                          )}
                          {/* Phase J3: "Trust this run" — accept the current modal AND enable
                            session-wide YOLO so every subsequent approval auto-allows for
                            the rest of the process lifetime. Never persisted to disk.
                            Global `deny` policies still win. */}
                          {!isNativeSubAgentPreferenceApproval(pendingAgentApproval) && (
                            <button
                              className="btn btn-sm btn-ghost"
                              type="button"
                              title="Auto-allow every approval prompt for the rest of this session. Restart the app to revert. Doesn't override globally-denied services."
                              onClick={async () => {
                                try {
                                  await window.api.agenticYoloSet(true)
                                } catch (error) {
                                  console.error('Failed to enable YOLO session mode', error)
                                }
                                await handleAgentApprovalAction(
                                  pendingAgentApproval.id,
                                  'acceptForSession'
                                )
                              }}
                            >
                              Trust this session
                            </button>
                          )}
                          {(pendingAgentApproval.actions || ['decline']).includes('decline') && (
                            <button
                              className="btn btn-sm btn-ghost"
                              type="button"
                              onClick={() =>
                                void handleAgentApprovalAction(pendingAgentApproval.id, 'decline')
                              }
                            >
                              Deny
                            </button>
                          )}
                          {(pendingAgentApproval.actions || ['cancel']).includes('cancel') && (
                            <button
                              className="btn btn-sm btn-ghost"
                              type="button"
                              onClick={() =>
                                void handleAgentApprovalAction(pendingAgentApproval.id, 'cancel')
                              }
                            >
                              Cancel run
                            </button>
                          )}
                          {/* Slice 4 external-path actions — only render when
                            the runtime detector emitted the new action
                            triplet. The generic accept/decline buttons
                            above won't match those approvals' action list,
                            so only these three appear for external-path
                            prompts. */}
                          {(pendingAgentApproval.actions || []).includes(
                            'grantExternalPathRead'
                          ) && (
                            <button
                              className="btn btn-sm btn-primary"
                              type="button"
                              onClick={() =>
                                void handleAgentApprovalAction(
                                  pendingAgentApproval.id,
                                  'grantExternalPathRead'
                                )
                              }
                            >
                              Grant read access
                            </button>
                          )}
                          {(pendingAgentApproval.actions || []).includes(
                            'grantExternalPathEdit'
                          ) && (
                            <button
                              className="btn btn-sm"
                              type="button"
                              onClick={() =>
                                void handleAgentApprovalAction(
                                  pendingAgentApproval.id,
                                  'grantExternalPathEdit'
                                )
                              }
                            >
                              Grant edit access
                            </button>
                          )}
                          {(pendingAgentApproval.actions || []).includes('declineExternalPath') && (
                            <button
                              className="btn btn-sm btn-ghost"
                              type="button"
                              onClick={() =>
                                void handleAgentApprovalAction(
                                  pendingAgentApproval.id,
                                  'declineExternalPath'
                                )
                              }
                            >
                              Deny once
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    {isCommandPaletteOpen && (
                      <div className="composer-discovery-card command-palette-card">
                        <div className="composer-discovery-header">
                          <div>
                            <strong>
                              {currentProvider === 'gemini'
                                ? 'Slash command palette'
                                : `${currentProviderLabel} command palette`}
                            </strong>
                            <span>
                              {currentProvider === 'gemini'
                                ? commandDiscoveryStatus
                                : `App-native ${currentProviderLabel} commands and provider controls.`}
                            </span>
                          </div>
                          <div className="composer-discovery-actions">
                            {currentProvider === 'gemini' ? (
                              <button
                                className="btn btn-sm btn-ghost"
                                type="button"
                                onClick={() => void refreshCommandDiscovery()}
                                disabled={!currentWorkspace}
                              >
                                Refresh
                              </button>
                            ) : currentProvider === 'codex' ? (
                              <button
                                className="btn btn-sm btn-ghost"
                                type="button"
                                onClick={() => void refreshCodexThreads()}
                                disabled={!currentWorkspace}
                              >
                                Refresh threads
                              </button>
                            ) : (
                              <button
                                className="btn btn-sm btn-ghost"
                                type="button"
                                onClick={() => void refreshProviderMetadata(currentProvider)}
                                disabled={!currentWorkspace}
                              >
                                Refresh status
                              </button>
                            )}
                            <button
                              className="btn btn-sm btn-ghost"
                              type="button"
                              onClick={() => {
                                setIsCommandPaletteOpen(false)
                                setCommandPaletteQuery('')
                              }}
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                        <input
                          className="command-palette-search"
                          type="search"
                          aria-label={`Filter ${currentProviderLabel} commands`}
                          value={commandPaletteQuery}
                          onChange={(event) => setCommandPaletteQuery(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              setIsCommandPaletteOpen(false)
                              setCommandPaletteQuery('')
                            }
                          }}
                          placeholder={
                            currentProvider === 'gemini'
                              ? 'Filter commands, memory, hooks...'
                              : `Filter ${currentProviderLabel} commands...`
                          }
                          autoFocus
                        />
                        <div className="command-palette-list">
                          {commandPaletteGroups.map((group) => {
                            const groupItems = visibleCommandPaletteItems.filter(
                              (item) => item.group === group
                            )
                            if (groupItems.length === 0) return null
                            return (
                              <div key={group} className="command-palette-group">
                                <div className="command-palette-group-title">{group}</div>
                                {groupItems.map((item) => (
                                  <button
                                    key={item.id}
                                    className="command-palette-item"
                                    type="button"
                                    onClick={() => handlePaletteCommand(item)}
                                    disabled={!currentWorkspace || !currentChat}
                                    title={
                                      currentProvider === 'gemini'
                                        ? `Send ${item.command} to Gemini CLI`
                                        : `Run ${item.command}`
                                    }
                                  >
                                    <span className="command-palette-command">{item.command}</span>
                                    <span className="command-palette-copy">
                                      <strong>{item.label}</strong>
                                      <span>{item.description}</span>
                                      {item.sourcePath && <small>{item.sourcePath}</small>}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )
                          })}
                          {visibleCommandPaletteItems.length === 0 && (
                            <div className="command-palette-empty">
                              No commands match this filter.
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {currentProvider === 'gemini' && isMemoryInspectorOpen && (
                      <div className="composer-discovery-card memory-inspector-card">
                        <div className="composer-discovery-header">
                          <div>
                            <strong>GEMINI.md memory</strong>
                            <span>{geminiMemoryStatus}</span>
                          </div>
                          <button
                            className="btn btn-sm btn-ghost"
                            type="button"
                            onClick={() => void refreshGeminiMemory()}
                            disabled={!currentWorkspace}
                          >
                            Refresh
                          </button>
                        </div>
                        <div className="memory-inspector-actions">
                          {COMMAND_PALETTE_CORE.filter((item) => item.group === 'Memory').map(
                            (item) => (
                              <button
                                key={item.id}
                                className="composer-picker-command"
                                type="button"
                                onClick={() => void handleBridgeCommand(item.command)}
                                disabled={!currentWorkspace || !currentChat}
                              >
                                <span className="composer-picker-command-slash">
                                  {item.command}
                                </span>
                              </button>
                            )
                          )}
                        </div>
                        <div className="memory-file-list">
                          {geminiMemoryFiles.map((file) => (
                            <details key={file.id} className="memory-file-card">
                              <summary>
                                <span className={`memory-file-scope scope-${file.scope}`}>
                                  {file.scope}
                                </span>
                                <span className="memory-file-path">{file.displayPath}</span>
                                {file.sizeBytes !== undefined && (
                                  <span className="memory-file-size">
                                    {formatBytes(file.sizeBytes)}
                                  </span>
                                )}
                              </summary>
                              <pre
                                className={`memory-file-content ${file.error ? 'memory-file-error' : ''}`}
                              >
                                {getMemoryPreviewText(file)}
                              </pre>
                            </details>
                          ))}
                          {geminiMemoryFiles.length === 0 && (
                            <div className="memory-file-empty">
                              No GEMINI.md files discovered yet.
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="composer-inline-pickers">
                      <div className="composer-inline-pickers-left">
                        {(() => {
                          const workspaceActionDisabled = !currentWorkspace || !currentChat
                          const plusSections: ComposerPlusPickerSection[] = [
                            {
                              id: 'add',
                              title: 'Add',
                              items: [
                                {
                                  id: 'attachment',
                                  label: 'Attachment',
                                  description: 'Add files or images',
                                  icon: <PlusSymbolIcon />,
                                  disabled: isCurrentComposerLocked,
                                  onSelect: handlePickImages
                                },
                                {
                                  id: 'attached-window',
                                  label: attachedWindow ? 'Detach app' : 'Attach app',
                                  description: attachedWindow
                                    ? attachedWindow.streaming
                                      ? 'Stop live capture and detach'
                                      : 'Detach the picked window'
                                    : screenWatchUnavailableReason
                                      ? screenWatchUnavailableReason
                                      : 'Pick a running app window',
                                  icon: <CommandSymbolIcon />,
                                  disabled:
                                    isCurrentComposerLocked ||
                                    Boolean(screenWatchUnavailableReason) ||
                                    (!attachedWindow && isAttachingWindow),
                                  onSelect: attachedWindow ? handleDetachWindow : handleAttachWindow
                                }
                              ]
                            },
                            {
                              id: 'workspace',
                              title: 'Workspace',
                              items: isCurrentGlobalChat
                                ? []
                                : [
                                    {
                                      id: 'safety',
                                      label: 'Status',
                                      description: `${currentProviderLabel} safety and setup`,
                                      icon: <TrustSymbolIcon />,
                                      disabled: workspaceActionDisabled,
                                      onSelect: () => setRightTab('safety')
                                    },
                                    {
                                      id: 'diff',
                                      label: 'Diff Studio',
                                      description: `${currentProviderLabel} workspace changes`,
                                      icon: <FileMenuSelectionIcon />,
                                      disabled: workspaceActionDisabled,
                                      onSelect: () => setRightTab('diff')
                                    },
                                    {
                                      id: 'capabilities',
                                      label: 'Models',
                                      description: `${currentProviderLabel} capability state`,
                                      icon: <ModelSymbolIcon />,
                                      disabled: workspaceActionDisabled,
                                      onSelect: () => setRightTab('capabilities')
                                    }
                                  ]
                            },
                            {
                              id: 'commands',
                              title: 'Commands',
                              items: isCurrentGlobalChat
                                ? []
                                : [
                                    {
                                      id: 'palette',
                                      label:
                                        currentProvider === 'gemini'
                                          ? 'Slash commands'
                                          : 'Command palette',
                                      description:
                                        currentProvider === 'gemini'
                                          ? 'Gemini slash command palette'
                                          : `${currentProviderLabel} command palette`,
                                      icon: <CommandSymbolIcon />,
                                      active: isCommandPaletteOpen,
                                      disabled: workspaceActionDisabled,
                                      onSelect: () => setIsCommandPaletteOpen((current) => !current)
                                    },
                                    {
                                      id: 'review',
                                      label: isPreparingDiffReview
                                        ? 'Preparing review'
                                        : 'Review diff',
                                      description: 'Read-only plan-mode review',
                                      icon: <ReviewSymbolIcon />,
                                      disabled: workspaceActionDisabled || isPreparingDiffReview,
                                      onSelect: () => void handleReviewCurrentDiff()
                                    }
                                  ]
                            }
                          ]
                          return (
                            <ComposerPlusPicker
                              provider={currentProvider}
                              composerStyle={appearance.composerStyle}
                              sections={plusSections}
                              disabled={isCurrentComposerLocked}
                              triggerIcon={<PlusSymbolIcon />}
                            />
                          )
                        })()}
                        {/* 1.0.4-AS3 — the old name-pill (Application × ) is gone;
                        the attached-window affordance now lives in the
                        composer telemetry row as a Screen Watch icon
                        button (see further down). Removing it from this
                        action-row position avoids visually competing with
                        the model picker / send button. */}
                        {isCurrentEnsembleChat && currentChat?.ensemble && (
                          <span
                            className="composer-ensemble-mode"
                            role="group"
                            aria-label="Ensemble orchestration mode"
                            title={
                              isCurrentEnsembleRoundRunning
                                ? `Current round: ${activeEnsembleOrchestrationMode === 'continuous' ? 'Continuous' : 'Turn-bound'}${activeEnsembleConcurrentMode ? ' + Parallel fan-out' : ''}`
                                : 'Choose whether agents speak once per round or can hand work back and forth.'
                            }
                            data-composer-control="ensemble-mode"
                          >
                            {/* 1.0.x — Turn / Continuous / Work Session now live
                              in a hierarchical picker (matching the Model /
                              Permissions pickers) instead of a segmented toggle.
                              Fan-out stays a separate composable toggle below. */}
                            <EnsembleModePicker
                              mode={
                                currentEnsembleOrchestrationMode === 'continuous'
                                  ? 'continuous'
                                  : 'turn_bound'
                              }
                              workSessionActive={
                                currentChat?.ensemble?.workSession?.status === 'active' ||
                                currentChat?.ensemble?.workSession?.status === 'paused'
                              }
                              composerStyle={appearance.composerStyle}
                              onSelectMode={(nextMode) =>
                                updateCurrentEnsembleOrchestrationMode(nextMode)
                              }
                              onOpenWorkSession={() => setShowWorkSessionSheet(true)}
                              contextChars={currentChat?.ensemble?.ensembleContextChars}
                              onContextCharsChange={updateCurrentEnsembleContextChars}
                            />
                            <button
                              type="button"
                              className={`composer-ensemble-mode-button ${
                                currentEnsembleConcurrentMode ? 'is-active' : ''
                              }`}
                              onClick={() =>
                                updateCurrentEnsembleConcurrentMode(!currentEnsembleConcurrentMode)
                              }
                              title="Fan out read-only participants in parallel before any writer-capable participants run. Locked writer lanes require their separate feature flag."
                            >
                              Fan-out
                            </button>
                            {activeEnsembleOrchestrationMode === 'continuous' && (
                              <ContinuousHopsLimitChip
                                hops={currentEnsembleContinuationHops}
                                maxHops={currentEnsembleMaxContinuationHops}
                                onSave={updateCurrentEnsembleMaxContinuationHops}
                              />
                            )}
                          </span>
                        )}
                        {/* Provider picker. In solo chats this remains the
                          chat-level provider switch. In Ensemble chats it
                          retargets to the selected participant so users can
                          build same-provider panels without leaving the
                          composer. */}
                        {(() => {
                          const ensembleBinding =
                            isCurrentEnsembleChat && selectedParticipant
                              ? selectedParticipant
                              : null
                          const pickerProvider = ensembleBinding?.provider ?? currentProvider
                          const handleComposerProviderChange = (provider: ProviderId): void => {
                            if (ensembleBinding) {
                              const defaults = getDefaultEnsembleParticipantConfig(provider)
                              updateSelectedParticipant({
                                provider,
                                model: defaults.model,
                                runtimeProfileId: undefined,
                                geminiAuthProfileId: provider === 'gemini' ? null : undefined,
                                permissionPresetId: defaults.permissionPresetId,
                                reasoningEffort: defaults.reasoningEffort,
                                fastModeEnabled: defaults.fastModeEnabled,
                                thinkingEnabled: defaults.thinkingEnabled,
                                serviceTier: defaults.serviceTier,
                                linkedProviderSessionId: null
                              })
                              return
                            }
                            void handleProviderChange(provider)
                          }
                          // Rich popover provider picker (1.0.6-CRUX24).
                          // Replaces the old native <select> with the same
                          // body-portaled `composer-combined-picker-popover`
                          // pattern the model / permission / "+" pickers use.
                          // All prior behaviour is preserved verbatim:
                          //   - `pickerProvider` (chat-level OR the bound
                          //     ensemble participant's provider) drives the
                          //     trigger + the active checkmark,
                          //   - `handleComposerProviderChange` is the same
                          //     handler the <select>'s onChange called, so
                          //     the ensemble retarget vs solo provider-switch
                          //     side effects are unchanged,
                          //   - the disabled expression + the gated grok /
                          //     cursor visibility + the title text are passed
                          //     through identically,
                          //   - `shell-${composerStyle}` (inside the
                          //     component) makes the popover theme per shell
                          //     with no per-shell branches here.
                          return (
                            <ComposerProviderPicker
                              provider={pickerProvider}
                              composerStyle={appearance.composerStyle}
                              grokAvailable={grokProviderAvailable}
                              cursorAvailable={cursorProviderAvailable}
                              onSelect={handleComposerProviderChange}
                              disabled={
                                isCurrentComposerLocked ||
                                (!ensembleBinding && isCurrentChatProviderLocked) ||
                                Boolean(ensembleBinding && isCurrentEnsembleRoundRunning)
                              }
                              triggerIcon={<LinkCircleSymbolIcon />}
                              title={ensembleBinding ? 'Selected participant provider' : 'Provider'}
                            />
                          )
                        })()}
                        {/* 1.0.5-AR12c — Workspace switcher previously
                         lived here in the top inline-pickers row but
                         crowded the approval / provider / model
                         controls on dense windows. Moved to the
                         composer's bottom telemetry row (below) where
                         it sits spaced between the timecodes / Screen
                         Watch cluster on the left and the token tally
                         on the right. See the
                         `data-composer-control="workspace"` mount
                         inside `.composer-telemetry-row` below for
                         the new placement; the underlying
                         `ComposerWorkspaceSwitcher` component is
                         unchanged. */}
                        {(() => {
                          // CombinedModelPicker — replaces the per-provider
                          // native <select> chain that used to live here
                          // (Model + Codex reasoning + Codex speed + Kimi
                          // thinking + Claude reasoning) with one chip + a
                          // two-column popover (Model | Reasoning).
                          //
                          // Slice F v2 (1.0.3) — when this is an ensemble
                          // chat AND a participant chip is selected in the
                          // strip above the composer, this picker rebinds
                          // to that participant: it reads the participant's
                          // model / reasoning / fast-mode and writes via
                          // updateSelectedParticipant() instead of the
                          // chat-level rememberCurrentChatComposerSelection.
                          // `effective*` values below resolve to either the
                          // chat-level hooks (solo chat) or the participant
                          // (ensemble + selected chip).
                          const ensembleBinding =
                            isCurrentEnsembleChat && selectedParticipant
                              ? selectedParticipant
                              : null
                          // Resolve the participant's effective settings via the
                          // centralized helper so the per-provider fallbacks
                          // (`'medium'` reasoning, fast-mode→serviceTier inference,
                          // thinking off, etc.) live in one module. See
                          // `src/renderer/src/lib/ensembleProviderDefaults.ts`.
                          const ensembleResolved = ensembleBinding
                            ? resolveEnsembleParticipantSettings(ensembleBinding)
                            : null
                          const effectiveProvider: ProviderId =
                            ensembleBinding?.provider ?? currentProvider
                          const effectiveModelOptionsRaw = ensembleBinding
                            ? getProviderModelOptions(ensembleBinding.provider)
                            : currentProviderModelOptions
                          const effectiveSelectedModel = ensembleResolved
                            ? ensembleResolved.model
                            : selectedComposerModelType
                          const effectiveCodexReasoning =
                            ensembleResolved?.provider === 'codex'
                              ? ensembleResolved.reasoningEffort
                              : codexReasoningEffort
                          const effectiveClaudeReasoning =
                            ensembleResolved?.provider === 'claude'
                              ? ensembleResolved.reasoningEffort
                              : claudeReasoningEffort
                          const effectiveKimiThinking =
                            ensembleResolved?.provider === 'kimi'
                              ? ensembleResolved.thinkingEnabled
                              : kimiThinkingEnabled
                          const effectiveCodexServiceTier =
                            ensembleResolved?.provider === 'codex'
                              ? ensembleResolved.serviceTier
                              : codexServiceTier
                          const effectiveClaudeFastMode =
                            ensembleResolved?.provider === 'claude'
                              ? ensembleResolved.fastModeEnabled
                              : claudeFastMode

                          const combinedModelOptions: CombinedModelPickerModelOption[] = [
                            ...effectiveModelOptionsRaw.map((model) => {
                              // 1.0.7-mini — forward the optional retiresAt only
                              // when it's actually a string. Non-Codex provider
                              // model shapes don't carry the field; the cast
                              // narrows safely via the runtime typeof guard so
                              // bad data can't leak into the picker.
                              const retiresAtRaw = (model as { retiresAt?: unknown }).retiresAt
                              const retiresAt =
                                typeof retiresAtRaw === 'string' ? retiresAtRaw : undefined
                              return {
                                id: model.id,
                                label: model.label || model.id,
                                ...(retiresAt ? { retiresAt } : {})
                              }
                            }),
                            ...(effectiveProvider !== 'kimi'
                              ? [{ id: 'custom', label: 'Custom…' }]
                              : [])
                          ]

                          let combinedReasoningOptions: CombinedModelPickerReasoningOption[] = []
                          let combinedSelectedReasoning = ''
                          if (effectiveProvider === 'codex') {
                            // For ensemble binding we use a stable default
                            // reasoning list (medium/high/xhigh) because the
                            // participant doesn't carry per-model reasoning
                            // sets the way `codexReasoningOptions` does for
                            // the chat-level state.
                            const sourceOptions = ensembleBinding
                              ? [
                                  { reasoningEffort: 'medium' },
                                  { reasoningEffort: 'high' },
                                  { reasoningEffort: 'xhigh' }
                                ]
                              : codexReasoningOptions
                            combinedReasoningOptions = sourceOptions.map((option) => ({
                              value: option.reasoningEffort,
                              label:
                                option.reasoningEffort === 'xhigh'
                                  ? 'Extra High'
                                  : option.reasoningEffort.charAt(0).toUpperCase() +
                                    option.reasoningEffort.slice(1)
                            }))
                            combinedSelectedReasoning = effectiveCodexReasoning
                          } else if (effectiveProvider === 'claude') {
                            const sourceOptions = ensembleBinding
                              ? CLAUDE_THINKING_EFFORTS
                              : claudeReasoningOptions
                            combinedReasoningOptions = sourceOptions.map((option) => ({
                              value: option.reasoningEffort,
                              label:
                                option.reasoningEffort === 'off'
                                  ? 'Thinking off'
                                  : option.reasoningEffort === 'high'
                                    ? 'Max'
                                    : option.reasoningEffort.charAt(0).toUpperCase() +
                                      option.reasoningEffort.slice(1)
                            }))
                            combinedSelectedReasoning = effectiveClaudeReasoning
                          } else if (effectiveProvider === 'kimi') {
                            combinedReasoningOptions = [
                              { value: 'on', label: 'Thinking on' },
                              { value: 'off', label: 'Thinking off' }
                            ]
                            combinedSelectedReasoning = effectiveKimiThinking ? 'on' : 'off'
                          }

                          const handleCombinedModelChange = (nextModel: string) => {
                            if (ensembleBinding) {
                              const patch: Partial<EnsembleParticipant> = { model: nextModel }
                              // Drop fast-mode if the new model can't support
                              // it, mirroring the chat-level handler below.
                              if (effectiveProvider === 'codex') {
                                const modelOption = codexModels.find((m) => m.id === nextModel)
                                if (modelOption?.defaultReasoningEffort) {
                                  patch.reasoningEffort = modelOption.defaultReasoningEffort
                                }
                                if (!modelOption?.additionalSpeedTiers?.includes('fast')) {
                                  patch.fastModeEnabled = false
                                  patch.serviceTier = ''
                                }
                              }
                              if (effectiveProvider === 'claude') {
                                const claudeModelOption = (
                                  agentModelsByProvider.claude || CLAUDE_DEFAULT_MODELS
                                ).find((m) => m.id === nextModel)
                                if (!claudeModelOption?.additionalSpeedTiers?.includes('fast')) {
                                  patch.fastModeEnabled = false
                                }
                              }
                              updateSelectedParticipant(patch)
                              return
                            }
                            if (nextModel !== 'custom') {
                              setLastNonCustomModelType(nextModel)
                            }
                            setSelectedModelType(nextModel)
                            const metadataPatch: Record<string, unknown> = {
                              selectedModelType: nextModel
                            }
                            if (currentProvider === 'codex') {
                              const modelOption = codexModels.find(
                                (model) => model.id === nextModel
                              )
                              if (modelOption?.defaultReasoningEffort) {
                                setCodexReasoningEffort(modelOption.defaultReasoningEffort)
                                metadataPatch.codexReasoningEffort =
                                  modelOption.defaultReasoningEffort
                              }
                              if (!modelOption?.additionalSpeedTiers?.includes('fast')) {
                                setCodexServiceTier('')
                                metadataPatch.codexServiceTier = ''
                              }
                            }
                            if (currentProvider === 'claude') {
                              // Symmetric to Codex above: clear Fast when
                              // switching to a non-capable Claude model so
                              // the persisted flag doesn't outlive its
                              // applicability.
                              const claudeModelOption = (
                                agentModelsByProvider.claude || CLAUDE_DEFAULT_MODELS
                              ).find((model) => model.id === nextModel)
                              if (!claudeModelOption?.additionalSpeedTiers?.includes('fast')) {
                                setClaudeFastMode(false)
                                metadataPatch.claudeFastMode = false
                              }
                            }
                            if (currentProvider === 'gemini') {
                              syncPersistentModelSelection(nextModel)
                            }
                            rememberCurrentChatComposerSelection(metadataPatch)
                          }

                          /*
                           * Fast Mode toggle inside the picker. Replaces
                           * the standalone Codex-only speed `<select>`
                           * that previously sat next to the chip — same
                           * underlying state, just surfaced inside the
                           * Model+Reasoning popover so the user finds it
                           * where they're already adjusting reasoning.
                           */
                          const fastModeCapableModelIds = (() => {
                            if (effectiveProvider === 'codex') {
                              return new Set(
                                codexModels
                                  .filter((model) => model.additionalSpeedTiers?.includes('fast'))
                                  .map((model) => model.id)
                              )
                            }
                            if (effectiveProvider === 'claude') {
                              return new Set(
                                (agentModelsByProvider.claude || CLAUDE_DEFAULT_MODELS)
                                  .filter((model) => model.additionalSpeedTiers?.includes('fast'))
                                  .map((model) => model.id)
                              )
                            }
                            if (effectiveProvider === 'cursor') {
                              // Cursor's "fast" is a distinct model id
                              // (composer-2.5-fast) rather than a tier flag, so the
                              // toggle swaps between the two Composer 2.5 ids. Both
                              // are "capable" so the bolt is always live for Cursor.
                              return new Set(['composer-2.5', 'composer-2.5-fast'])
                            }
                            // Gemini + Kimi: no Fast tier — hide the toggle
                            // by passing an empty set (CombinedModelPicker
                            // skips rendering the row in that case).
                            return new Set<string>()
                          })()
                          const fastModeEnabledForProvider =
                            effectiveProvider === 'codex'
                              ? effectiveCodexServiceTier === 'fast'
                              : effectiveProvider === 'claude'
                                ? effectiveClaudeFastMode
                                : effectiveProvider === 'cursor'
                                  ? effectiveSelectedModel === 'composer-2.5-fast'
                                  : false
                          const handleToggleFastMode =
                            effectiveProvider === 'codex'
                              ? () => {
                                  const nextTier =
                                    effectiveCodexServiceTier === 'fast' ? '' : 'fast'
                                  if (ensembleBinding) {
                                    updateSelectedParticipant({
                                      serviceTier: nextTier,
                                      fastModeEnabled: nextTier === 'fast'
                                    })
                                    return
                                  }
                                  setCodexServiceTier(nextTier)
                                  rememberCurrentChatComposerSelection({
                                    codexServiceTier: nextTier
                                  })
                                }
                              : effectiveProvider === 'claude'
                                ? () => {
                                    const nextFast = !effectiveClaudeFastMode
                                    if (ensembleBinding) {
                                      updateSelectedParticipant({ fastModeEnabled: nextFast })
                                      return
                                    }
                                    setClaudeFastMode(nextFast)
                                    rememberCurrentChatComposerSelection({
                                      claudeFastMode: nextFast
                                    })
                                  }
                                : effectiveProvider === 'cursor'
                                  ? () => {
                                      // Cursor fast = the composer-2.5-fast model id;
                                      // swap the selected model (handleCombinedModelChange
                                      // handles both chat-level + ensemble-participant
                                      // persistence). No separate fast flag needed.
                                      const nextModel =
                                        effectiveSelectedModel === 'composer-2.5-fast'
                                          ? 'composer-2.5'
                                          : 'composer-2.5-fast'
                                      handleCombinedModelChange(nextModel)
                                    }
                                  : undefined

                          const handleCombinedReasoningChange = (value: string) => {
                            if (ensembleBinding) {
                              if (ensembleBinding.provider === 'kimi') {
                                updateSelectedParticipant({ thinkingEnabled: value !== 'off' })
                              } else {
                                updateSelectedParticipant({ reasoningEffort: value })
                              }
                              return
                            }
                            if (currentProvider === 'codex') {
                              setCodexReasoningEffort(value)
                              rememberCurrentChatComposerSelection({
                                codexReasoningEffort: value
                              })
                            } else if (currentProvider === 'claude') {
                              setClaudeReasoningEffort(value)
                              rememberCurrentChatComposerSelection({
                                claudeReasoningEffort: value
                              })
                            } else if (currentProvider === 'kimi') {
                              const enabled = value !== 'off'
                              setKimiThinkingEnabled(enabled)
                              rememberCurrentChatComposerSelection({
                                kimiThinkingEnabled: enabled
                              })
                            }
                          }

                          return (
                            <>
                              <CombinedModelPicker
                                provider={effectiveProvider}
                                composerStyle={appearance.composerStyle}
                                modelOptions={combinedModelOptions}
                                selectedModelId={effectiveSelectedModel}
                                onSelectModel={handleCombinedModelChange}
                                reasoningOptions={combinedReasoningOptions}
                                selectedReasoning={combinedSelectedReasoning}
                                onSelectReasoning={handleCombinedReasoningChange}
                                codexReasoningEffort={effectiveCodexReasoning}
                                claudeReasoningEffort={effectiveClaudeReasoning}
                                kimiThinkingEnabled={effectiveKimiThinking}
                                fastModeCapableModelIds={fastModeCapableModelIds}
                                fastModeEnabled={fastModeEnabledForProvider}
                                onToggleFastMode={handleToggleFastMode}
                                disabled={isCurrentComposerLocked}
                              />
                              {!ensembleBinding &&
                                selectedModelType === 'custom' &&
                                currentProvider !== 'kimi' && (
                                  <span className="composer-inline-custom-model">
                                    <input
                                      className="composer-inline-input"
                                      type="text"
                                      value={customModel}
                                      onChange={(e) => {
                                        setCustomModel(e.target.value)
                                        rememberCurrentChatComposerSelection({
                                          customModel: e.target.value
                                        })
                                        if (currentProvider === 'gemini') {
                                          markPersistentSessionRestartNeeded(
                                            'Gemini custom model changed. Restart the persistent session to apply the new model.'
                                          )
                                        }
                                      }}
                                      placeholder="Model ID"
                                      disabled={isCurrentComposerLocked}
                                    />
                                    <button
                                      className="composer-inline-clear"
                                      type="button"
                                      onClick={() => {
                                        setCustomModel('')
                                        setSelectedModelType(lastNonCustomModelType)
                                        rememberCurrentChatComposerSelection({
                                          customModel: '',
                                          selectedModelType: lastNonCustomModelType
                                        })
                                        if (currentProvider === 'gemini') {
                                          syncPersistentModelSelection(lastNonCustomModelType)
                                        }
                                      }}
                                      disabled={isCurrentComposerLocked}
                                      title="Cancel custom model"
                                      aria-label="Cancel custom model"
                                    >
                                      <XSymbolIcon />
                                    </button>
                                  </span>
                                )}
                            </>
                          )
                        })()}

                        {/*
                        Codex speed-tier `<select>` removed — Fast mode
                        now lives inside CombinedModelPicker as a toggle
                        beneath the Reasoning column, gated by each
                        model's `additionalSpeedTiers`. Same underlying
                        `codexServiceTier` state, surfaced in the same
                        popover the user already opens to tweak
                        reasoning effort.
                      */}

                        {(() => {
                          // CombinedPermissionsPicker — replaces the
                          // native <select> permission picker AND
                          // absorbs the old "Tool Grants" pill from the
                          // above-bar. Single chip, two-column popover
                          // (Permissions | Tool Grants).
                          //
                          // Slice F v2 (1.0.3) — when ensemble + a
                          // participant chip is selected, the picker
                          // reads/writes the participant's
                          // `permissionPresetId` instead of the chat's
                          // `approvalMode`. The user-facing 3-mode UI
                          // stays the same (Plan / Default / Full
                          // Workspace Access) but we translate
                          // bidirectionally to the preset vocabulary
                          // (`read_only` / `default` / `workspace_write`).
                          // Slice A3 — in Ensemble Mode, Tool Grants are
                          // participant-scoped overrides. Solo chats keep
                          // using provider+workspace grants.
                          const ensembleBinding =
                            isCurrentEnsembleChat && selectedParticipant
                              ? selectedParticipant
                              : null
                          const effectiveProvider: ProviderId =
                            ensembleBinding?.provider ?? currentProvider
                          const presetToMode = (preset: string | undefined): string => {
                            if (preset === 'read_only') return 'plan'
                            if (preset === 'workspace_write') return 'auto_edit'
                            if (preset === 'full_access') return 'auto_edit'
                            return 'default'
                          }
                          const modeToPreset = (mode: string): PermissionPresetId => {
                            if (mode === 'plan') return 'read_only'
                            if (mode === 'auto_edit') return 'workspace_write'
                            return 'default'
                          }
                          const effectiveSelectedPermission = ensembleBinding
                            ? presetToMode(ensembleBinding.permissionPresetId)
                            : approvalMode
                          const permissionPickerOptions: PermissionOption[] = [
                            { value: 'plan', label: 'Plan / Read-only' },
                            { value: 'default', label: 'Default Approval' },
                            { value: 'auto_edit', label: 'Full Workspace Access' }
                          ]
                          const normalizedWorkspacePath = (currentWorkspace?.path || '').replace(
                            /\/+$/,
                            ''
                          )
                          const enabledGrantIds = ensembleBinding
                            ? getParticipantToolGrantIds(ensembleBinding)
                            : new Set(
                                agenticWorkspaceGrants
                                  .filter((grant) => {
                                    if (
                                      !grant ||
                                      grant.provider !== effectiveProvider ||
                                      !grant.workspacePath
                                    )
                                      return false
                                    return (
                                      grant.workspacePath.replace(/\/+$/, '') ===
                                      normalizedWorkspacePath
                                    )
                                  })
                                  .map((grant) => grant.service)
                              )
                          // Hide the Tool-Grants column when there's no
                          // workspace path to scope grants to (global
                          // chats or pre-workspace state).
                          const grantServicesForPicker =
                            currentWorkspace && !isCurrentGlobalChat
                              ? WORKSPACE_POLICY_SERVICES
                              : []
                          return (
                            <CombinedPermissionsPicker
                              provider={effectiveProvider}
                              composerStyle={appearance.composerStyle}
                              permissionOptions={permissionPickerOptions}
                              selectedPermission={effectiveSelectedPermission}
                              onSelectPermission={(nextApprovalMode) => {
                                if (ensembleBinding) {
                                  updateSelectedParticipant({
                                    permissionPresetId: modeToPreset(nextApprovalMode)
                                  })
                                  return
                                }
                                setApprovalMode(nextApprovalMode)
                                rememberCurrentChatComposerSelection({
                                  approvalMode: nextApprovalMode
                                })
                                if (
                                  currentProvider === 'gemini' &&
                                  nextApprovalMode !== approvalMode
                                ) {
                                  markPersistentSessionRestartNeeded(
                                    'Gemini approval mode changed. Restart the persistent session to apply the correct tool permissions.'
                                  )
                                }
                              }}
                              grantServices={grantServicesForPicker}
                              enabledGrantIds={enabledGrantIds}
                              agenticServices={agenticServices}
                              onToggleGrant={(service, enabled) => {
                                if (ensembleBinding) {
                                  updateSelectedParticipant(
                                    buildParticipantToolGrantPatch(
                                      ensembleBinding,
                                      service,
                                      enabled
                                    )
                                  )
                                  return
                                }
                                void handleSetAgenticWorkspaceGrant(
                                  service,
                                  enabled,
                                  effectiveProvider
                                )
                              }}
                              grantScopeLabel={ensembleBinding ? 'participant' : 'workspace'}
                              disabled={
                                isCurrentComposerLocked ||
                                (effectiveProvider === 'gemini' && !geminiWorkspaceTrustReady)
                              }
                            />
                          )
                        })()}

                        {/* Slice A: collapsed-state chip for the dismissed
                          YOLO banner. Sits adjacent to the permissions
                          picker because YOLO is conceptually a permission
                          override. Clicking re-summons the full banner. */}
                        {sessionYoloMode.enabled && yoloBannerDismissed && (
                          <button
                            type="button"
                            className="composer-yolo-chip"
                            onClick={() => setYoloBannerDismissed(false)}
                            title="Trust mode is active — every approval auto-allowed. Click to show details."
                            aria-label="Trust mode active — show details"
                          >
                            <span className="composer-yolo-chip-icon" aria-hidden>
                              ⚠
                            </span>
                            <span className="composer-yolo-chip-label">YOLO</span>
                          </button>
                        )}

                        {currentProvider === 'gemini' && !isCurrentGlobalChat && (
                          <label className="composer-picker-label" title="Workspace trust">
                            <TrustSymbolIcon />
                            <select
                              className="composer-inline-picker"
                              aria-label="Workspace trust"
                              value={trustSelectValue}
                              onChange={(e) => {
                                const nextValue = e.target.value
                                if (
                                  nextValue === 'trusted' &&
                                  !sessionTrust &&
                                  trustResult?.status !== 'trusted' &&
                                  trustResult?.status !== 'inherited'
                                ) {
                                  setSessionTrust(true)
                                  void handleBridgeCommand('/permissions trust')
                                } else if (nextValue === 'untrusted') {
                                  setSessionTrust(false)
                                  markPersistentSessionRestartNeeded(
                                    'Gemini workspace trust changed. Restart the persistent session to apply the trust setting.'
                                  )
                                }
                              }}
                              disabled={isCurrentComposerLocked}
                              title="Workspace trust"
                            >
                              <option value="trusted">Trusted</option>
                              <option value="untrusted">Untrusted</option>
                            </select>
                          </label>
                        )}
                      </div>
                      <div className="composer-inline-actions">
                        <ContextWheel percent={contextUsedPercent} label={contextLabel} />
                        {steerIndicatorMessage && (
                          <span
                            className="composer-steer-indicator"
                            role="status"
                            aria-live="polite"
                          >
                            <span className="composer-steer-indicator-dot" aria-hidden />
                            <span>{steerIndicatorMessage}</span>
                          </span>
                        )}
                        {/*
                        1.0.6-EW70 — the run/queue/steer/stop buttons are
                        wrapped in `.composer-send-cluster` (display:contents
                        by default, so the nine other shells are unchanged).
                        Obsidian/Alabaster lift this cluster up into the
                        textarea rect's bottom-right corner; the ContextWheel
                        ("context") stays here at the right of the control row.
                      */}
                        <span className="composer-send-cluster">
                          {isCurrentChatRunning ? (
                            <>
                              <button
                                className={`composer-action-btn run-btn queue ${isSendConfirming ? 'send-confirming' : ''}`}
                                onClick={() => {
                                  if (tryHandleSideSlashSubmit()) {
                                    return
                                  }
                                  triggerSendConfirmation()
                                  handleRun()
                                }}
                                disabled={
                                  !currentChat ||
                                  (!isCurrentGlobalChat && !currentWorkspace) ||
                                  !prompt.trim() ||
                                  (currentProvider === 'gemini' && !geminiWorkspaceTrustReady) ||
                                  isSteerBusyForCurrentChat
                                }
                                title="Queue next run"
                                aria-label="Queue next run"
                                type="button"
                              >
                                <QueueSymbolIcon />
                              </button>
                              {/* Phase J3 (steer): sit Steer between Queue and Stop
                               *   - Queue waits passively for the chat's run to finish.
                               *   - Steer interrupts and dispatches immediately.
                               *   - Stop only interrupts (no follow-up dispatch).
                               * Only render when THIS chat is busy (per-chat busy
                               * predicate), so multi-chat parallel runs don't get a
                               * misleading Steer button in idle chats. */}
                              {isCurrentChatBusyForSteer && (
                                <button
                                  className={`composer-action-btn steer-btn ${isSteerBusyForCurrentChat ? 'is-busy' : ''}`}
                                  onClick={() => void handleSteer()}
                                  disabled={
                                    !currentChat ||
                                    (!isCurrentGlobalChat && !currentWorkspace) ||
                                    !prompt.trim() ||
                                    (currentProvider === 'gemini' && !geminiWorkspaceTrustReady) ||
                                    isSteerBusyForCurrentChat
                                  }
                                  title="Interrupt the active turn and dispatch this prompt immediately."
                                  aria-label="Steer: interrupt and dispatch this prompt"
                                  type="button"
                                >
                                  <SteerSymbolIcon />
                                </button>
                              )}
                              {isCurrentChatRunning && (
                                <button
                                  className="composer-action-btn stop-btn"
                                  onClick={handleCancel}
                                  title="Stop run"
                                  aria-label="Stop run"
                                  type="button"
                                  disabled={isSteerBusyForCurrentChat}
                                >
                                  <StopSymbolIcon />
                                </button>
                              )}
                            </>
                          ) : (
                            <button
                              className={`composer-action-btn run-btn ${isSendConfirming ? 'send-confirming' : ''}`}
                              onClick={(event) => {
                                if (tryHandleSideSlashSubmit()) {
                                  return
                                }
                                triggerSendConfirmation()
                                // DM target resolution (same precedence as
                                // the Enter handler above): explicit
                                // `@participant` mention wins; falls back
                                // to legacy Cmd/Ctrl-click on a selected
                                // chip; plain click = full round.
                                const dmFromMention = isCurrentEnsembleChat
                                  ? extractFirstEnsembleDmTarget(
                                      prompt,
                                      currentChat?.ensemble?.participants
                                    )
                                  : null
                                const dmTarget =
                                  dmFromMention ||
                                  (isCurrentEnsembleChat &&
                                  effectiveSelectedParticipantId &&
                                  (event.metaKey || event.ctrlKey)
                                    ? effectiveSelectedParticipantId
                                    : undefined)
                                handleRun(undefined, undefined, dmTarget || undefined)
                              }}
                              disabled={
                                !currentChat ||
                                (!isCurrentGlobalChat && !currentWorkspace) ||
                                !prompt.trim() ||
                                (currentProvider === 'gemini' && !geminiWorkspaceTrustReady)
                              }
                              title={
                                !currentChat
                                  ? 'Open or start a chat first'
                                  : !isCurrentGlobalChat && !currentWorkspace
                                    ? 'Pick a workspace folder first'
                                    : !prompt.trim()
                                      ? 'Type a prompt first'
                                        : currentProvider === 'gemini' && !geminiWorkspaceTrustReady
                                          ? 'Trust this workspace for Gemini first'
                                        : isCurrentEnsembleChat && effectiveSelectedParticipantId
                                          ? `Run full ensemble round  ·  ${primaryModifierLabel} click = DM the selected chip`
                                          : 'Run'
                              }
                              aria-label="Run prompt"
                              aria-keyshortcuts="Enter Meta+Enter Control+Enter"
                              type="button"
                            >
                              {appearance.composerStyle === 'claude' ? (
                                <ClaudeReturnSymbolIcon />
                              ) : appearance.composerStyle === 'codex' ||
                                appearance.composerStyle === 'gemini' ||
                                appearance.composerStyle === 'cursor' ||
                                appearance.composerStyle === 'grok' ||
                                appearance.composerStyle === 'kimi' ? (
                                <ArrowUpSendIcon />
                              ) : (
                                <RunSymbolIcon />
                              )}
                            </button>
                          )}
                        </span>
                      </div>
                    </div>
                    {currentProvider === 'gemini' && !geminiWorkspaceTrustReady && (
                      <div
                        className="composer-inline-warning"
                        style={{
                          fontSize: 'var(--font-size-xs)',
                          color: 'var(--warning)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          flexWrap: 'wrap'
                        }}
                      >
                        <span>
                          Workspace trust is not established.
                          {geminiTrustWriteError ? ` ${geminiTrustWriteError}` : ''}
                        </span>
                        {currentWorkspace?.path &&
                          typeof window.api.trustWorkspace === 'function' && (
                            <button
                              type="button"
                              onClick={() => void handleTrustWorkspaceClick()}
                              disabled={geminiTrustWriteBusy || isCurrentComposerLocked}
                              title={`Trust ${currentWorkspace.path} for Gemini — writes ~/.gemini/trustedFolders.json`}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                padding: '3px 9px',
                                fontSize: 'var(--font-size-xs)',
                                fontWeight: 600,
                                color: 'var(--text-primary)',
                                background: 'color-mix(in srgb, var(--warning) 18%, transparent)',
                                border:
                                  '1px solid color-mix(in srgb, var(--warning) 45%, transparent)',
                                borderRadius: '6px',
                                cursor: geminiTrustWriteBusy ? 'default' : 'pointer',
                                opacity: geminiTrustWriteBusy ? 0.7 : 1
                              }}
                            >
                              <TrustSymbolIcon />
                              {geminiTrustWriteBusy ? 'Trusting…' : 'Trust this folder'}
                            </button>
                          )}
                        <span style={{ opacity: 0.75 }}>or enable session trust above.</span>
                      </div>
                    )}
                  </div>
                  {/* 1.0.6-EW68 — close .composer-bottom-controls */}
                </div>
              </div>
              {/* Console redesign — close .composer-inner-module (the readable input/controls surface) */}
              <div
                className="composer-telemetry-row"
                data-has-token-tally={threadTokenTallyHasValue ? 'true' : 'false'}
              >
                <ComposerRunTimecode
                  running={isCurrentChatRunning}
                  startedAt={composerRunTimecodeStartedAt}
                />
                <ComposerCumulativeTimecode
                  running={isCurrentChatRunning}
                  startedAt={composerRunTimecodeStartedAt}
                  cumulativeBaseMs={cumulativeRunBaseMs}
                />
                {/* 1.0.4-AS3 — Screen Watch (Appwatch/Appshots) button.
                    Pre-AS3 the attached-window UX was an inline pill in the
                    action row that took ~120px and showed the app name +
                    title + close glyph. the maintainer asked for a single themed
                    SVG icon button here in the telemetry row instead,
                    with the picker behind a click rather than a visible
                    name pill. Click toggles attach/detach; the tooltip
                    surfaces the attached app name; a small pulse dot
                    signals an active SCStream (kept the at-a-glance
                    "live capture" cue from the old pill). */}
                <button
                  type="button"
                  className={`composer-screen-watch-button${attachedWindow ? ' is-attached' : ''}${attachedWindow?.streaming ? ' is-streaming' : ''}${!attachedWindow && resumeAppWatchSnapshot ? ' is-resumable' : ''}`}
                  onClick={() => {
                    if (screenWatchUnavailableReason) return
                    // M11 — both "attach fresh" and "resume" route through the
                    // picker (macOS requires a gesture to re-grant a window);
                    // handleAttachWindow clears the stash on success.
                    if (attachedWindow) void handleDetachWindow()
                    else void handleAttachWindow()
                  }}
                  title={
                    attachedWindow
                      ? attachedWindow.streaming
                        ? `Watching ${attachedWindow.windowMeta.applicationName || 'window'} · live capture · click to detach`
                        : `Watching ${attachedWindow.windowMeta.applicationName || 'window'}${attachedWindow.windowMeta.title ? ` — ${attachedWindow.windowMeta.title}` : ''} · click to detach`
                      : resumeAppWatchSnapshot
                        ? `Resume watching ${resumeAppWatchSnapshot.windowMeta.applicationName || 'window'}${resumeAppWatchSnapshot.windowMeta.title ? ` — ${resumeAppWatchSnapshot.windowMeta.title}` : ''} · click to re-pick`
                        : screenWatchUnavailableReason
                          ? screenWatchUnavailableReason
                          : 'Screen Watch — click to pick a window for the AI to see'
                  }
                  aria-label={
                    attachedWindow
                      ? `Detach ${attachedWindow.windowMeta.applicationName || 'window'}`
                      : resumeAppWatchSnapshot
                        ? `Resume watching ${resumeAppWatchSnapshot.windowMeta.applicationName || 'window'}`
                        : screenWatchUnavailableReason
                          ? 'Screen Watch unavailable'
                          : 'Open Screen Watch picker'
                  }
                  disabled={Boolean(screenWatchUnavailableReason)}
                  data-streaming={attachedWindow?.streaming ? 'true' : 'false'}
                  data-resumable={!attachedWindow && resumeAppWatchSnapshot ? 'true' : 'false'}
                >
                  <ScreenWatchSymbolIcon />
                  {attachedWindow?.streaming && (
                    <span className="composer-screen-watch-button-dot" aria-hidden="true" />
                  )}
                  {!attachedWindow && resumeAppWatchSnapshot && (
                    <span
                      className="composer-screen-watch-button-dot composer-screen-watch-button-dot--resume"
                      aria-hidden="true"
                    />
                  )}
                </button>
                {/* 1.0.5-AR12c — Workspace switcher in its new home.
                     Sits between the timecodes / Screen Watch cluster
                     on the left and the token tally on the right. The
                     `composer-workspace-button` class gets a
                     telemetry-row scoped CSS override (`margin-left:
                     auto`) so the two auto-margins (this + the tally)
                     split the free space. Hidden in global chats —
                     same gating as the previous top-row mount. */}
                {!isCurrentGlobalChat && (
                  <ComposerWorkspaceSwitcher
                    workspaces={workspaces}
                    currentWorkspace={currentWorkspace}
                    onPickExisting={handleSelectExistingWorkspace}
                    onAddNewWorkspace={handleSelectWorkspace}
                    onSelectNoWorkspace={handleNewGlobalChat}
                    /*
                        1.0.6-EW66 — multi-workspace manager. The
                        additional-workspace grants + their repo
                        metadata drive the "Current workspaces" list;
                        reorder / remove / add-folder are only wired
                        when the chat has a saved record to attach
                        grants to (welcome-state chats get the picker
                        without those affordances).
                      */
                    additionalGrants={externalPathGrants}
                    repoMetadata={externalPathRepoMetadata}
                    composerStyle={appearance.composerStyle}
                    onReorderWorkspaces={
                      currentChat?.appChatId ? handleReorderExternalPathGrants : undefined
                    }
                    onRemoveWorkspacePath={
                      currentChat?.appChatId ? handleRemoveExternalPathGrantsByPath : undefined
                    }
                    onAddFolder={currentChat?.appChatId ? handleAddWorkspaceFolder : undefined}
                    onAddKnownWorkspace={
                      currentChat?.appChatId ? handleAddKnownWorkspaceAsSecondary : undefined
                    }
                  />
                )}
                {threadTokenTallyHasValue && (
                  <LiveThreadTokenTally
                    baseTally={chatTokenTally}
                    currency={displayCurrency}
                    model={contextModelId}
                    overestimatePercent={overestimatePercent}
                    provider={currentProvider}
                    providerRates={providerRates}
                    running={isCurrentChatRunning}
                    liveOutputTokens={liveRunOutputTokens}
                    title={threadTokenTallyTooltip}
                  />
                )}
              </div>
              {/*
                Composer-unification (Phase J1): removed the codex-style
                decorative footer chip strip. It mirrored info already in
                the top-toggles row (workspace), the above-bar (branch),
                and the provider picker (provider). Codex's visual brand
                persists via the surface's colour, border, and glow tokens.
              */}
              {/* Claude composer: previously rendered a satellite "footer" row below
               * the textarea with workspace + provider + branch chips. Removed —
               * native Claude doesn't have one, and the chips now live inline in
               * the composer's action row (workspace info is in the above-bar's
               * branch indicator, and the Provider picker sits in the gap between
               * `+` and the model picker via the data-composer-control="provider"
               * marker, unhidden in claude mode by main.css). */}
              {visibleScheduledTasks.length > 0 && (
                <div className="scheduled-task-strip">
                  {visibleScheduledTasks.map((task) => (
                    <div key={task.id} className={`scheduled-task-pill status-${task.status}`}>
                      <ClockSymbolIcon />
                      <span className="scheduled-task-copy" title={task.prompt}>
                        {getProviderLabel(task.provider)} · {formatScheduledRunTime(task.runAt)}
                      </span>
                      <span className="scheduled-task-status">{task.status}</span>
                      {(task.status === 'pending' || task.status === 'due') && (
                        <button
                          type="button"
                          className="scheduled-task-cancel"
                          title="Cancel scheduled task"
                          aria-label="Cancel scheduled task"
                          onClick={async () => {
                            await window.api.updateScheduledTask(task.id, { status: 'cancelled' })
                            setScheduledTasks(
                              await window.api.getScheduledTasks(currentWorkspace?.id)
                            )
                          }}
                        >
                          <XSymbolIcon />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {isWelcomeChat && !isCurrentEnsembleChat && (
              /*
                Solo-provider starter cards. Hidden on ensemble chats
                per the maintainer's 1.0.3 ship-night call: the hierarchy chain
                in the ensemble welcome hero teaches the orchestration
                model, and the user types their own prompt rather than
                picking from solo-shaped templates.
              */
              <div className="welcome-suggestions">
                {welcomeCopy.starters.map((starter) => (
                  <button
                    key={starter.id}
                    className="welcome-suggestion-btn"
                    type="button"
                    data-intent={starter.intent}
                    aria-label={`${starter.label}: ${starter.description}`}
                    onClick={() => handleWelcomeSuggestion(starter.prompt)}
                  >
                    <span className="welcome-suggestion-label">{starter.label}</span>
                    <span className="welcome-suggestion-description">{starter.description}</span>
                  </button>
                ))}
              </div>
            )}
            {shouldShowWelcomeStandaloneHeatmaps && (
              <WelcomeHeatmaps slots={welcomeHeatmapSlots} layout={welcomeHeatmapLayout} />
            )}
          </div>
            </div>
          </div>

          {sideChat && isSideSplitOpen && (
            <>
              <div
                className="side-chat-resize-handle"
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-label="Resize side chat split"
                aria-valuemin={MIN_SIDE_CHAT_WIDTH}
                aria-valuemax={getSideChatMaxWidth()}
                aria-valuenow={sideChatWidth}
                onMouseDown={startSideChatResize}
                onKeyDown={handleSideChatResizeKeyDown}
                title="Resize side chat split"
              />
              <aside
                className={`side-chat-pane app-transcript provider-${sideProvider} interface-${interfaceStyle} ${
                  sideChat.chatKind === 'ensemble' ? 'chat-kind-ensemble' : ''
                }`}
                aria-label="Side chat"
              >
            <div className="side-chat-header">
              <div className="side-chat-title-wrap">
                <span className="side-chat-kicker">
                  <ProviderBadgeIcon provider={sideProvider} />
                  <span>{sidePanelKindLabel}</span>
                </span>
                <span className="side-chat-parent-link">
                  Parent: {sidePanelParentChat?.title || 'current chat'}
                </span>
                <strong title={sideChat.title}>{sideChat.title}</strong>
                <span className="side-chat-context-chip">{sidePanelContextLabel}</span>
              </div>
              <div className="side-chat-actions">
                {sidePanelParentChat && (
                  <button
                    type="button"
                    className="side-chat-header-btn"
                    onClick={() => void handleSelectChat(sidePanelParentChat)}
                    title="Back to parent chat"
                  >
                    Back
                  </button>
                )}
                <button
                  type="button"
                  className="side-chat-header-btn"
                  onClick={() => popOutLinkedChat(sideChat)}
                  title="Pop out this linked chat"
                >
                  Pop out
                </button>
                <button
                  type="button"
                  className="side-chat-header-btn"
                  onClick={() => void handleSelectChat(sideChat)}
                  title="Open side chat as the main thread"
                >
                  Open main
                </button>
                {sidePanelRelation === 'sideChat' && (
                  <button
                    type="button"
                    className="side-chat-header-btn side-chat-header-btn-danger"
                    onClick={() => void handleTerminateSideChat()}
                    title="End this ephemeral side chat, cancel queued work, and archive it"
                  >
                    End
                  </button>
                )}
                <button
                  type="button"
                  className="side-chat-icon-btn"
                  onClick={hideSideChatPane}
                  title="Close side view; linked chat keeps running"
                  aria-label="Close side view"
                >
                  <XSymbolIcon />
                </button>
              </div>
            </div>
            {sideChatIsWelcome && (
              <div className="side-chat-welcome" aria-label="Side chat welcome">
                <span className="side-chat-welcome-kicker">{sidePanelKindLabel}</span>
                <h2>
                  {sidePanelRelation === 'subThread'
                    ? 'Agent sub-thread'
                    : sideChat.chatKind === 'ensemble'
                      ? 'Side ensemble'
                      : 'Side chat'}
                </h2>
                <p>{sidePanelParentChat?.title || 'Parent chat'}</p>
                {sideChat.chatKind === 'ensemble' && sideChat.ensemble?.participants?.length ? (
                  <div className="side-chat-welcome-chain" aria-label="Ensemble participants">
                    {[...(sideChat.ensemble.participants || [])]
                      .filter((participant) => participant.enabled)
                      .sort((a, b) => a.order - b.order)
                      .slice(0, 6)
                      .map((participant, index, enabledParticipants) => (
                        <span key={participant.id} className="side-chat-welcome-chain-step">
                          <span className={`side-chat-welcome-participant provider-${participant.provider}`}>
                            <ProviderBadgeIcon provider={participant.provider} />
                            <span>{participant.role || getProviderLabel(participant.provider)}</span>
                          </span>
                          {index < enabledParticipants.length - 1 && (
                            <span className="side-chat-welcome-arrow" aria-hidden>
                              →
                            </span>
                          )}
                        </span>
                      ))}
                  </div>
                ) : null}
              </div>
            )}
            <TranscriptPanel
              key={`side-${sideChat.appChatId}`}
              scrollRef={sideTranscriptScrollRef}
              contentRef={sideTranscriptContentRef}
              endRef={sideLogsEndRef}
              messages={sideChat.messages || EMPTY_CHAT_MESSAGES}
              isWelcomeChat={sideChatIsWelcome}
              isThinking={isSideChatRunning}
              showFallbackUX={false}
              pendingPlanChoice={null}
              pendingAgentQuestion={null}
              onAgentQuestionSubmit={() => {}}
              onAgentQuestionDismiss={() => {}}
              runCompleteNotice={sideRunCompleteNotice}
              runCompleteDurationText={null}
              currentChat={sideChat}
              currentRun={sideRun}
              currentWorkspacePath={sideWorkspace?.path}
              currentProviderLabel={getProviderLabel(sideProvider)}
              currentProvider={sideProvider}
              thinkingProviderLabel={sideThinkingProviderLabel}
              thinkingProvider={sideThinkingProvider}
              thinkingModelBadge={null}
              displayFileChangeSummaries={[]}
              fileChangeSummaryText=""
              fileChangeShouldShowStats={false}
              fileChangeDisplayAdds={0}
              fileChangeDisplayDels={0}
              chats={chats}
              runningChatIds={runningChatIdsArray}
              onPlanChoiceSubmit={() => {}}
              onRunFallback={() => {}}
              onOpenSubThread={handleOpenCockpitThread}
              onOpenSubThreadInSidePanel={handleOpenLinkedChatInSidePanelById}
              onInspectRun={(runId) => {
                void handleSelectChat(sideChat)
                setInspectingRunId(runId)
              }}
              compactDensity={appearance.compactDensity}
              pendingQueuedAppRunIds={pendingQueuedAppRunIds}
              onCopyMessage={handleCopyMessage}
              onDeleteMessage={(messageId) => deleteMessageFromChat(sideChat, messageId)}
              onPreviewImage={setPreviewChatMediaRef}
              copiedId={copiedId}
              copy={copy}
              autoFollowRef={sideAutoFollowRef}
              currency={displayCurrency}
              currencyOverestimatePercent={overestimatePercent}
              providerRates={providerRates}
            />
            <form
              className={`side-chat-composer composer-surface side-chat-compact-composer interface-${interfaceStyle}`}
              onSubmit={(event) => {
                event.preventDefault()
                handleSideRun()
              }}
            >
              <div className="composer-inner-module side-chat-inner-module">
                <div className="composer-textarea-wrap side-chat-textarea-wrap">
                  {sideComposerHasMention && (
                    <ComposerHighlightOverlay
                      value={sidePrompt}
                      participants={sideChat.ensemble?.participants}
                      textareaRef={sideComposerTextareaRef}
                      syncEpoch={`${appearance.composerStyle}|side|${sideChat.appChatId}`}
                    />
                  )}
                  <textarea
                    ref={sideComposerTextareaRef}
                    className={`composer-textarea side-chat-textarea${
                      sideComposerHasMention ? ' has-mention-overlay' : ''
                    }`}
                    value={sidePrompt}
                    onChange={(event) => setChatPromptDraft(sideChat.appChatId, event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Enter' &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault()
                        handleSideRun()
                      }
                    }}
                    placeholder={`Ask ${sidePanelKindLabel.toLowerCase()}`}
                    aria-label="Side chat prompt"
                    rows={2}
                    disabled={!sideCanRun}
                  />
                </div>
                <div className="composer-bottom-controls side-chat-bottom-controls">
                  <div className="composer-control-footer side-chat-control-footer">
                    <div className="composer-inline-pickers side-chat-inline-pickers">
                      <div className="composer-inline-pickers-left">
                        <ComposerProviderPicker
                          provider={sideComposerProvider}
                          composerStyle={appearance.composerStyle}
                          grokAvailable={grokProviderAvailable}
                          cursorAvailable={cursorProviderAvailable}
                          onSelect={handleSideProviderChange}
                          disabled={
                            isSideComposerLocked ||
                            isSideChatProviderLocked ||
                            sideChat.chatKind === 'ensemble'
                          }
                          triggerIcon={<LinkCircleSymbolIcon />}
                          title={
                            sideChat.chatKind === 'ensemble'
                              ? 'Side ensemble provider is configured by participants'
                              : sidePanelRelation === 'subThread'
                                ? 'Sub-thread provider'
                                : 'Side chat provider'
                          }
                        />
                        <CombinedModelPicker
                          provider={sideComposerProvider}
                          composerStyle={appearance.composerStyle}
                          modelOptions={sideComposerModelOptions}
                          selectedModelId={sideComposerSelectedModel}
                          onSelectModel={handleSideModelChange}
                          reasoningOptions={sideComposerReasoningOptions}
                          selectedReasoning={sideComposerSelectedReasoning}
                          onSelectReasoning={handleSideReasoningChange}
                          codexReasoningEffort={sideCodexReasoning}
                          claudeReasoningEffort={sideClaudeReasoning}
                          kimiThinkingEnabled={sideKimiThinking}
                          fastModeCapableModelIds={sideFastModeCapableModelIds}
                          fastModeEnabled={sideFastModeEnabled}
                          onToggleFastMode={handleSideToggleFastMode}
                          disabled={isSideComposerLocked}
                        />
                        {sideComposerSelectedModel === 'custom' &&
                          sideComposerProvider !== 'kimi' && (
                            <span className="composer-inline-custom-model side-chat-custom-model">
                              <input
                                className="composer-inline-input"
                                type="text"
                                value={sideComposerSelection?.customModel || ''}
                                onChange={(event) =>
                                  rememberSideChatComposerSelection({
                                    customModel: event.target.value
                                  })
                                }
                                placeholder="Model ID"
                                disabled={isSideComposerLocked}
                              />
                              <button
                                className="composer-inline-clear"
                                type="button"
                                onClick={() =>
                                  rememberSideChatComposerSelection({
                                    customModel: '',
                                    selectedModelType: getDefaultModelForProvider(sideComposerProvider)
                                  })
                                }
                                disabled={isSideComposerLocked}
                                title="Cancel custom model"
                                aria-label="Cancel custom model"
                              >
                                <XSymbolIcon />
                              </button>
                            </span>
                          )}
                        <CombinedPermissionsPicker
                          provider={sideComposerProvider}
                          composerStyle={appearance.composerStyle}
                          permissionOptions={sidePermissionOptions}
                          selectedPermission={sideSelectedPermission}
                          onSelectPermission={(nextApprovalMode) =>
                            rememberSideChatComposerSelection({ approvalMode: nextApprovalMode })
                          }
                          grantServices={sideGrantServices}
                          enabledGrantIds={sideEnabledGrantIds}
                          agenticServices={agenticServices}
                          onToggleGrant={(service, enabled) =>
                            void handleSetSideAgenticWorkspaceGrant(service, enabled)
                          }
                          disabled={isSideComposerLocked}
                        />
                      </div>
                      <div className="composer-inline-actions side-chat-inline-actions">
                        <span className="side-chat-status" aria-live="polite">
                          {isSideChatRunning ? 'Running' : 'Ready'}
                        </span>
                        <span className="composer-send-cluster side-chat-send-cluster">
                          {isSideChatRunning && (
                            <button
                              type="button"
                              className="composer-action-btn stop-btn"
                              onClick={() => void handleSideCancel()}
                              title="Stop side chat run"
                              aria-label="Stop side chat run"
                            >
                              <StopSymbolIcon />
                            </button>
                          )}
                          <button
                            type="submit"
                            className={`composer-action-btn run-btn${
                              isSideChatRunning ? ' queue' : ''
                            }`}
                            disabled={!sideCanRun || !sidePrompt.trim()}
                            title={
                              sideCanRun
                                ? isSideChatRunning
                                  ? 'Queue side chat prompt'
                                  : 'Run side chat prompt'
                                : 'Side chat workspace is unavailable'
                            }
                            aria-label={
                              isSideChatRunning ? 'Queue side chat prompt' : 'Run side chat prompt'
                            }
                          >
                            {isSideChatRunning ? (
                              <QueueSymbolIcon />
                            ) : appearance.composerStyle === 'claude' ? (
                              <ClaudeReturnSymbolIcon />
                            ) : appearance.composerStyle === 'codex' ||
                              appearance.composerStyle === 'gemini' ||
                              appearance.composerStyle === 'cursor' ||
                              appearance.composerStyle === 'grok' ||
                              appearance.composerStyle === 'kimi' ? (
                              <ArrowUpSendIcon />
                            ) : (
                              <RunSymbolIcon />
                            )}
                          </button>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </form>
              </aside>
            </>
          )}
        </div>

        {!isChatPopoutWindow && showFileEditor && hasWorkspaceContext && (
          <>
            <div
              className="panel-resize-handle"
              role="separator"
              tabIndex={0}
              aria-orientation="vertical"
              aria-label="Resize file editor"
              aria-valuemin={MIN_RIGHT_PANEL_WIDTH}
              aria-valuemax={MAX_RIGHT_PANEL_WIDTH}
              aria-valuenow={fileEditorWidth}
              onMouseDown={(event) => startRightPanelResize('fileEditor', event)}
              onKeyDown={(event) => handleRightPanelResizeKeyDown('fileEditor', event)}
              title="Resize file editor"
            />
            <FileEditorPanel workspacePath={currentWorkspace?.path} width={fileEditorWidth} />
          </>
        )}

        {!isChatPopoutWindow && appearance.showInspector && (
          <>
            <div
              className="panel-resize-handle"
              role="separator"
              tabIndex={0}
              aria-orientation="vertical"
              aria-label="Resize inspector"
              aria-valuemin={MIN_RIGHT_PANEL_WIDTH}
              aria-valuemax={MAX_RIGHT_PANEL_WIDTH}
              aria-valuenow={appearance.inspectorWidth}
              onMouseDown={(event) => startRightPanelResize('inspector', event)}
              onKeyDown={(event) => handleRightPanelResizeKeyDown('inspector', event)}
              title="Resize inspector"
            />
            <Inspector
              rightTab={rightTab}
              setRightTab={setRightTab}
              activeDiff={activeDiff}
              refreshDiff={refreshDiff}
              currentWorkspace={currentWorkspace}
              diffView={diffView}
              setDiffView={setDiffView}
              runDiff={runDiff}
              workspaceRunDiffByPath={currentRun?.runDiffByPath}
              diffRefreshStatus={diffRefreshStatus}
              rawLogs={rawLogs}
              rawFilter={rawFilter}
              setRawFilter={setRawFilter}
              setRawLogs={(logs) =>
                setThreadRawLogs(
                  currentChat?.appChatId || currentChatIdRef.current,
                  logs as RawLogEntry[]
                )
              }
              rawLogsEndRef={rawLogsEndRef}
              geminiVersion={geminiVersion}
              isOldVersion={isOldVersion}
              trustResult={trustResult}
              sessionTrust={sessionTrust}
              setSessionTrust={setSessionTrust}
              showTerminal={showTerminal}
              setShowTerminal={setShowTerminal}
              workspacePath={currentGeminiWorktree?.effectivePath || currentWorkspace?.path}
              provider={currentProvider}
              approvalMode={approvalMode}
              codexStatus={currentAgentStatus}
              codexModels={currentProvider === 'codex' ? codexModels : currentProviderModelOptions}
              codexMcpStatus={currentAgentMcpStatus}
              providerCapabilities={currentProviderCapabilities}
              providerCapabilitiesByProvider={providerCapabilitiesByProvider}
              codexThreads={codexThreads}
              externalPathGrants={externalPathGrants}
              geminiMcpBridgeEnabled={geminiMcpBridgeEnabled}
              geminiMcpBridgeStatus={geminiMcpBridgeStatus}
              onRefreshCodexThreads={refreshCodexThreads}
              onResumeCodexThread={handleResumeCodexThread}
              onForkCodexThread={handleForkCodexThread}
              onRollbackCodexThread={handleRollbackCodexThread}
              onImportCodexUsageCredential={handleImportCodexUsageCredential}
              onClearCodexUsageCredential={handleClearCodexUsageCredential}
              onInstallGeminiMcpBridge={() => void installGeminiMcpBridge()}
              onRefreshGeminiMcpBridgeStatus={() => void refreshGeminiMcpBridgeStatus()}
              currentChat={currentChat}
              chats={chats}
              runningChatIds={runningChatIdsArray}
              onOpenSubThread={handleOpenCockpitThread}
            />
          </>
        )}
      </div>

      {!isChatPopoutWindow && showCockpit && (
        <CockpitPanel
          lanes={runLanes}
          handoffCards={handoffCards}
          onClose={() => setShowCockpit(false)}
          onOpenThread={handleOpenCockpitThread}
          onCancelRun={handleCancelRunLane}
          onRetryRun={handleRetryRunLane}
          onDuplicateRun={handleDuplicateRunLane}
          onCreateHandoff={handleCreateHandoffFromLane}
          onDispatchHandoff={handleDispatchHandoff}
          onArchiveHandoff={handleArchiveHandoff}
        />
      )}

      {/*
        Settings now renders as a full-app takeover — workspace
        sidebar swaps to `<SettingsSidebar />` and the main pane
        slot renders `<SettingsPanel layout="takeover" />`. Both
        swaps live inside `.app-main` above. The legacy modal-sheet
        mount that lived here was removed; "← Back to app" + Escape
        return the user to the chat surface.
      */}
      {IOS_REMOTE_ENABLED && <IncomingPairingPrompt />}
      {/* PairingSheet modal mount retired — Pairing now renders as a
          Settings tab (`activeTab === 'pairing'`) when the iOS remote
          feature flag is enabled. */}
      {/* FirstLaunchSheet — auto-shows on fresh installs and stays
        re-openable from the `?` corner control. Mounted at app root
        so it overlays all surfaces; its own z-index (9100) sits
        between SubThreadCreator (9000) and CreativeActionApprovalModal
        (10000) so it always wins focus on a new install while still
        deferring to genuine approval prompts. */}
      <FirstLaunchSheet
        open={!isChatPopoutWindow && showFirstLaunchSheet}
        onDismiss={handleDismissFirstLaunchSheet}
        onOpenSettings={() => {
          // Closing the sheet AND opening settings in a single click
          // keeps the affordance discoverable: the user lands on the
          // Settings panel with the sheet out of the way, finishes
          // sign-in, and can re-open the sheet later from the `?`
          // corner control to verify the status pill flipped green.
          setShowFirstLaunchSheet(false)
          setShowSettings(true)
        }}
        onProviderLogin={(provider) => {
          void window.api.openProviderLoginTerminal(provider).then((r) => {
            if (!r?.ok) console.warn('[provider sign-in] could not open Terminal:', r?.error)
          })
        }}
        onProviderLogout={(provider) => {
          void window.api.openProviderLogoutTerminal(provider).then((r) => {
            if (!r?.ok) console.warn('[provider sign-out] could not open Terminal:', r?.error)
          })
        }}
        onGeminiLogout={(profileId) => void handleDeleteGeminiAuthProfile(profileId)}
        codexStatus={codexStatus}
        claudeAuthStatus={claudeAuthStatus}
        kimiAuthStatus={kimiAuthStatus}
        geminiAuthStatus={geminiAuthStatus}
        cursorProviderAvailable={cursorProviderAvailable}
        grokProviderAvailable={grokProviderAvailable}
        usageSummary={usageSummary}
        themeAppearance={appearance.themeAppearance || 'system'}
        composerStyle={appearance.composerStyle || 'default'}
        userBubbleColor={appearance.userBubbleColor || 'system'}
        onAppearancePreviewChange={handleSettingsChange}
      />
      {/* BugReportSheet — inline issue capture for testers. z-index
          (9120) sits above the FirstLaunchSheet (9100) so the bug-report
          wins when both happen to be open, and stays below the
          creative-action approval modal (10000). */}
      <BugReportSheet
        open={!isChatPopoutWindow && showBugReportSheet}
        onDismiss={() => setShowBugReportSheet(false)}
        onSubmit={handleSubmitBugReport}
        appVersion={appVersion}
        currentProvider={currentProvider}
        currentWorkspacePath={currentWorkspace?.path ?? null}
        composerShell={appearance.composerStyle || 'default'}
        initialSurface={bugReportInitialSurface}
        chatKind={currentChat?.chatKind || 'chat'}
        settingsTab={showSettings ? settingsActiveTab : ''}
        inspectorTab={appearance.showInspector ? rightTab : ''}
        theme={appearance.themeAppearance || 'system'}
        promptBubble={appearance.userBubbleColor || 'system'}
        ensembleSummary={bugReportEnsembleSummary}
      />
      <ChangelogSheet
        open={!isChatPopoutWindow && showChangelogSheet}
        onDismiss={handleDismissChangelogSheet}
        changelogSnapshot={changelogSnapshot}
        updateSnapshot={updateStatus.snapshot}
        busy={updateStatus.busy}
        onCheckForUpdates={updateStatus.checkForUpdates}
        onDownloadUpdate={updateStatus.downloadUpdate}
        onInstallUpdateNow={updateStatus.installUpdateNow}
      />
      {/* 1.0.4-AK2 — Work Session setup sheet. z-index 9130 sits
          above BugReportSheet (9120) since opening a Work Session
          is a deliberate intent action and shouldn't be obscured
          by a tester's bug-report draft. Below the approval modal
          (10000) so an in-flight approval still wins focus. */}
      {isCurrentEnsembleChat && currentChat?.ensemble && (
        <WorkSessionSetupSheet
          isOpen={showWorkSessionSheet}
          participants={currentChat.ensemble.participants}
          providerLabel={getProviderLabel}
          initial={
            currentChat.ensemble.workSession
              ? {
                  ...currentChat.ensemble.workSession,
                  initialPrompt: ''
                }
              : undefined
          }
          initialRoundMode={currentChat.ensemble.roundMode || 'roundtable'}
          initialSynthesizerParticipantId={currentChat.ensemble.synthesizerParticipantId}
          onConfirm={handleConfirmWorkSession}
          onCancel={() => setShowWorkSessionSheet(false)}
        />
      )}
      {subThreadCreatorParent && (
        <SubThreadCreator
          parentChat={subThreadCreatorParent}
          onCreated={(subThread, delegationPrompt) => {
            void handleSubThreadCreated(subThread, delegationPrompt)
          }}
          onCancel={() => setSubThreadCreatorParent(null)}
        />
      )}
      {/*
        Slice F (1.0.3) — EnsembleSetupSheet retired. The bottom-pinned
        modal had a z-index race with the picker popovers (popovers
        rendered under the modal so clicks fell through to the sheet
        rows). All per-participant configuration now lives inline in
        the EnsembleParticipantsAboveRow chip flyouts, rendered up in
        the composer above-row stack.
      */}
      {/* Phase K3 — creative-action approval modal. Mounts at app root
        so it overlays any view. Subscribes to main-process broadcasts
        the first time it mounts; renders the queue of pending
        approvals (K3 FCP import, K4 AppleScript, K5 Blender). */}
      <CreativeActionApprovalModal
        onSubscribe={(handler) => {
          const unsubscribe = window.api.onCreativeActionRequest((payload) =>
            handler(payload as Parameters<typeof handler>[0])
          )
          return unsubscribe
        }}
        onDecide={(requestId, approved, rememberForSession) =>
          window.api.decideCreativeAction(requestId, approved, rememberForSession)
        }
      />
    </div>
  )
}

export default App
