import { memo, useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react'
import type { CSSProperties } from 'react'
import { GeminiStreamAdapter, NormalizedEvent } from './lib/GeminiAdapter'
import { classifyError, redactLog } from './lib/ErrorClassifier'
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
  ChatScope,
  RuntimeProfile,
  HandoffCard
} from '../../main/store/types'
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
  CommandPaletteSource,
  ComposerSlashCommand
} from './lib/ComposerSlashCommands'
import {
  GEMINI_PALETTE_CORE as COMMAND_PALETTE_CORE,
  CODEX_PALETTE_CORE as CODEX_COMMAND_PALETTE_CORE,
  CLI_PROVIDER_PALETTE_CORE as CLI_PROVIDER_COMMAND_PALETTE_CORE,
  buildComposerSlashCommandRegistry
} from './lib/ComposerSlashCommands'
import { ComposerSlashMenu } from './components/ComposerSlashMenu'
import { useAppearance } from './hooks/useAppearance'
import { Sidebar } from './components/Sidebar'
import { Inspector } from './components/Inspector'
import { SettingsPanel } from './components/SettingsPanel'
import { SubThreadCreator } from './components/SubThreadCreator'
import { IncomingPairingPrompt } from './components/IncomingPairingPrompt'
import { ActivityStack } from './components/ActivityStack'
import { FileTypeIcon } from './components/FileTypeIcon'
import { FileEditorPanel } from './components/FileEditorPanel'
import { MarkdownMessage } from './components/MarkdownMessage'
import { RunCard } from './components/RunCard'
import { RunInspector } from './components/RunInspector'
import { PairingSheet } from './components/PairingSheet'
import { SubThreadReturnCard } from './components/SubThreadReturnCard'
import { isSubThreadReturnMessage } from './components/SubThreadReturnCardModel'
import { WorkspaceAccessControls } from './components/WorkspaceAccessControls'
import { SubThreadDelegationCard } from './components/SubThreadDelegationCard'
import { isSubThreadDelegationMessage } from './components/SubThreadDelegationCardModel'
import { SubThreadStatusTicker } from './components/SubThreadStatusTicker'
import { AgentMentionMenu } from './components/AgentMentionMenu'
import { applyStateAction, usePerChatState } from './hooks/usePerChatState'
import { DEFAULT_CONTEXT_TURNS, clampContextTurns } from '../../main/PromptComposition'
import { resolveRuntimeProfileIdForChat } from '../../main/RuntimeProfileResolution'
import {
  buildRunLanes,
  compactPromptPreview,
  extractRunTouchedFiles,
  type RunLane
} from './lib/RunLanes'
import { resolveContextWindow, formatContextTokens } from './lib/contextWindows'
import { rawLogFromRunEvent, type RawLogEntry } from './lib/rawLogEntry'
import { findNextRunnableQueueIndex } from './lib/runQueueScheduling'
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
  CODE_BLOCK_RESIZE_EVENT
} from './lib/TranscriptScroll'
import { shouldRunUsageRefresh } from './lib/usageRefresh'
import { shouldRenderWelcome } from './lib/welcomeState'
import { shouldCollapseUserMessage, truncateUserMessagePreview } from './lib/UserMessageCollapse'
import {
  HEATMAP_DAY_COUNT,
  buildWelcomeUsageDashboardData,
  formatCompactUsageNumber,
  mixProviderColors,
  type WelcomeUsageDayCell,
  type WelcomeUsageDashboardData,
  type WelcomeUsageHourCell,
  type WelcomeUsageTab
} from './lib/welcomeUsageDashboard'

type SkyWeatherKind =
  | 'clear'
  | 'partly_cloudy'
  | 'cloudy'
  | 'overcast'
  | 'rain'
  | 'heavy_rain'
  | 'snow'
  | 'mist'
  | 'fog'
  | 'storm'
  | 'unknown'

interface HostWeatherVisualState {
  kind: SkyWeatherKind
  description: string
  temperatureC?: number
  location?: string
  isDay: boolean
  updatedAt: string
  source: 'wttr' | 'fallback'
  error?: string
}

function SidebarCornerIcon({
  direction,
  isOpen
}: {
  direction: 'left' | 'right'
  isOpen: boolean
}) {
  const symbolColor = 'var(--text-primary)'
  const panelFill = 'transparent'
  return (
    <span className="chat-corner-symbol">
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke={symbolColor}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {direction === 'left' ? (
          <>
            <rect x="2.4" y="2.2" width="8.8" height="11.4" rx="1.2" fill={panelFill} />
            <path d="M5 4.5h4.4M5 8h4.4M5 11.5h4.4" />
            {isOpen ? (
              <>
                <path d="M10.4 7.7 8.9 9.2M10.4 7.7 11.9 9.2M10.4 7.7h-3.3" />
              </>
            ) : (
              <>
                <path d="M7.3 7.7 8.8 9.2M7.3 7.7 5.8 9.2M7.3 7.7h3.3" />
              </>
            )}
          </>
        ) : (
          <>
            <rect x="4.9" y="2.2" width="8.8" height="11.4" rx="1.2" fill={panelFill} />
            <path d="M11 4.5H6.6M11 8H6.6M11 11.5H6.6" />
            {isOpen ? (
              <>
                <path d="M5.6 7.7 7.1 9.2M5.6 7.7 4.1 9.2M5.6 7.7h3.3" />
              </>
            ) : (
              <>
                <path d="M8.7 7.7 7.2 9.2M8.7 7.7 10.2 9.2M8.7 7.7h-3.3" />
              </>
            )}
          </>
        )}
      </svg>
    </span>
  )
}

function FileMenuSelectionIcon() {
  return (
    <span className="chat-corner-symbol">
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 2.4h5.4l2.8 2.8v8.4H3z" />
        <path d="M8.4 2.4v3h2.8" />
        <path d="M5 7.3h6" />
        <path d="M5 9.6h3.8" />
        <path d="M5 11.9h2.8" />
        <path d="M10.4 10.2l2.3 2.3" />
        <path d="M12.7 10.2l-2.3 2.3" />
      </svg>
    </span>
  )
}

function AppleTerminalIcon() {
  return (
    <span className="chat-corner-symbol">
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2.2" y="3" width="11.6" height="10" rx="1.4" />
        <path d="M4.4 6.2 6.3 8 4.4 9.8" />
        <path d="M7.4 10h3.5" />
      </svg>
    </span>
  )
}

function ChatMediaIcon() {
  return (
    <span className="chat-corner-symbol">
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2.4" y="3" width="11.2" height="10" rx="1.5" />
        <path d="M4.4 10.9 6.6 8.7l1.7 1.5 1.7-2.2 1.7 2.9" />
        <circle cx="5.7" cy="5.8" r="0.85" />
      </svg>
    </span>
  )
}

type ChatMediaSource = 'upload' | 'external_path'
type ChatMediaKind = 'image' | 'file' | 'folder'

interface ChatMediaRef {
  id: string
  kind: ChatMediaKind
  source: ChatMediaSource
  name: string
  path: string
  access?: ExternalPathGrant['access']
}

type MediaAttachmentLike = {
  id?: string
  path?: string
  name?: string
}

function isChatMediaImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|heif|svg)$/i.test(path)
}

function chatMediaNameFromPath(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, '')
  if (!trimmed) return 'Untitled'
  return trimmed.split('/').pop() || trimmed
}

function chatMediaPreviewSrc(path: string): string {
  if (/^(file|https?):\/\//i.test(path)) return path
  if (!path.startsWith('/')) return ''
  return `file://${encodeURI(path)}`
}

function formatChatMediaLocation(path: string, workspacePath?: string): string {
  if (workspacePath && path.startsWith(`${workspacePath}/`)) {
    return path.slice(workspacePath.length + 1)
  }
  return path
}

function collectChatMediaRefs(
  chat: ChatRecord | null,
  pendingImages: MediaAttachmentLike[],
  currentExternalPathGrants: ExternalPathGrant[]
): ChatMediaRef[] {
  const refs: ChatMediaRef[] = []
  const seen = new Set<string>()

  const addRef = (ref: ChatMediaRef) => {
    if (!ref.path) return
    const key = `${ref.source}:${ref.path}:${ref.access || ''}`
    if (seen.has(key)) return
    seen.add(key)
    refs.push(ref)
  }

  const addAttachment = (
    attachment: MediaAttachmentLike | null | undefined,
    source: ChatMediaSource = 'upload'
  ) => {
    const path = typeof attachment?.path === 'string' ? attachment.path.trim() : ''
    if (!path) return
    addRef({
      id: attachment?.id || `${source}:${path}`,
      kind: isChatMediaImagePath(path) ? 'image' : 'file',
      source,
      name: attachment?.name || chatMediaNameFromPath(path),
      path
    })
  }

  const addGrant = (grant: Partial<ExternalPathGrant> | null | undefined) => {
    const path = typeof grant?.path === 'string' ? grant.path.trim() : ''
    if (!path) return
    const grantKind = grant?.kind
    const grantAccess = grant?.access
    const kind =
      grantKind === 'directory' ? 'folder' : isChatMediaImagePath(path) ? 'image' : 'file'
    addRef({
      id: grant?.id || `external_path:${path}:${grantAccess || 'read'}`,
      kind,
      source: 'external_path',
      name: chatMediaNameFromPath(path),
      path,
      access: grantAccess
    })
  }

  pendingImages.forEach((attachment) => addAttachment(attachment))
  currentExternalPathGrants.forEach((grant) => addGrant(grant))

  const chatAny = chat as any
  const providerMetadata = chatAny?.providerMetadata || {}
  ;[
    providerMetadata.codexExternalPathGrants,
    providerMetadata.externalPathGrants,
    providerMetadata.claudeExternalPathGrants,
    providerMetadata.geminiExternalPathGrants,
    providerMetadata.kimiExternalPathGrants
  ].forEach((candidate) => {
    if (Array.isArray(candidate)) {
      candidate.forEach((grant) => addGrant(grant))
    }
  })

  const messages = Array.isArray(chatAny?.messages) ? chatAny.messages : []
  messages.forEach((message: any) => {
    const metadata = message?.metadata || {}
    ;[metadata.imageAttachments, metadata.attachments, metadata.mediaRefs].forEach((candidate) => {
      if (Array.isArray(candidate)) {
        candidate.forEach((attachment) => addAttachment(attachment))
      }
    })
  })

  const runs = Array.isArray(chatAny?.runs) ? chatAny.runs : []
  runs.forEach((run: any) => {
    ;[
      run,
      run?.request,
      run?.snapshot,
      run?.requestSnapshot,
      run?.runRequest,
      run?.payload
    ].forEach((candidate) => {
      if (!candidate) return
      if (Array.isArray(candidate.imageAttachments)) {
        candidate.imageAttachments.forEach((attachment: MediaAttachmentLike) =>
          addAttachment(attachment)
        )
      }
      if (Array.isArray(candidate.attachments)) {
        candidate.attachments.forEach((attachment: MediaAttachmentLike) =>
          addAttachment(attachment)
        )
      }
      if (Array.isArray(candidate.externalPathGrants)) {
        candidate.externalPathGrants.forEach((grant: Partial<ExternalPathGrant>) => addGrant(grant))
      }
    })
  })

  return refs.sort((a, b) => {
    const rank = (ref: ChatMediaRef) => (ref.kind === 'image' ? 0 : ref.kind === 'folder' ? 1 : 2)
    return rank(a) - rank(b) || a.name.localeCompare(b.name)
  })
}

function ChatMediaFloatingPanel({
  open,
  refs,
  workspacePath,
  onClose
}: {
  open: boolean
  refs: ChatMediaRef[]
  workspacePath?: string
  onClose: () => void
}) {
  if (!open) return null

  const imageRefs = refs.filter((ref) => ref.kind === 'image')
  const fileRefs = refs.filter((ref) => ref.kind !== 'image')

  return (
    <section className="chat-media-panel" aria-label="Chat media and files">
      <header className="chat-media-panel-header">
        <div>
          <div className="chat-media-panel-kicker">Chat media</div>
          <h2>Uploads and paths</h2>
        </div>
        <button
          className="chat-media-panel-close"
          type="button"
          onClick={onClose}
          aria-label="Close chat media panel"
        >
          <XSymbolIcon />
        </button>
      </header>

      {refs.length === 0 ? (
        <div className="chat-media-empty">
          Explicitly uploaded images and granted file paths for this chat will appear here.
        </div>
      ) : (
        <>
          {imageRefs.length > 0 && (
            <div className="chat-media-section">
              <div className="chat-media-section-title">Images</div>
              <div className="chat-media-image-grid">
                {imageRefs.map((ref) => {
                  const previewSrc = chatMediaPreviewSrc(ref.path)
                  return (
                    <button
                      key={ref.id}
                      className="chat-media-image-card"
                      type="button"
                      title={ref.path}
                      onClick={() => void navigator.clipboard?.writeText(ref.path)}
                    >
                      {previewSrc ? (
                        <img src={previewSrc} alt={ref.name} />
                      ) : (
                        <span className="chat-media-file-fallback">
                          <FileTypeIcon path={ref.path} size={22} workspacePath={workspacePath} />
                        </span>
                      )}
                      <span>{ref.name}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {fileRefs.length > 0 && (
            <div className="chat-media-section">
              <div className="chat-media-section-title">Files and paths</div>
              <div className="chat-media-file-list">
                {fileRefs.map((ref) => (
                  <button
                    key={ref.id}
                    className="chat-media-file-row"
                    type="button"
                    title="Copy path"
                    onClick={() => void navigator.clipboard?.writeText(ref.path)}
                  >
                    <span className="chat-media-file-icon">
                      <FileTypeIcon path={ref.path} size={18} workspacePath={workspacePath} />
                    </span>
                    <span className="chat-media-file-copy">
                      <span className="chat-media-file-name">{ref.name}</span>
                      <span className="chat-media-file-path">
                        {formatChatMediaLocation(ref.path, workspacePath)}
                      </span>
                    </span>
                    <span className={`chat-media-source source-${ref.source}`}>
                      {ref.source === 'external_path' ? ref.access || 'path' : 'upload'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function GhostCompanionIcon() {
  return (
    <span className="chat-corner-symbol">
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3.2 13.2V6.5a4.8 4.8 0 0 1 9.6 0v6.7l-1.7-1.1-1.6 1.1-1.5-1.1-1.5 1.1-1.6-1.1-1.7 1.1z" />
        <path d="M5.8 6.4h.1M10.1 6.4h.1" />
        <path d="M6.5 9.2c.8.5 2.2.5 3 0" />
      </svg>
    </span>
  )
}

function SkyWeatherIcon() {
  return (
    <span className="chat-corner-symbol">
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5.2 5.1a3.2 3.2 0 1 1 5.6 2.1" />
        <path d="M8.4 1.7v1.2M8.4 10.6v1.2M3.2 6.7H2M14.8 6.7h-1.2M4.8 3.1l-.8-.8M12.8 3.1l.8-.8" />
        <path d="M4.3 12.5h6.8a2.2 2.2 0 0 0 0-4.4 3.2 3.2 0 0 0-6.1-.8 2.6 2.6 0 0 0-.7 5.2z" />
      </svg>
    </span>
  )
}

function CopyResponseIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="4.9" y="2.1" width="7.5" height="11.1" rx="1.2" />
        <path d="M5.8 4h5.7" />
        <path d="M5.8 5.7h5.7" />
        <path d="M5.8 7.5h4.2" />
        <rect x="2.7" y="4.2" width="7.2" height="9.7" rx="0.8" />
        <path d="M4 2.8h2.3a0.8 0.8 0 0 1 0.8 0.8V4.2" />
        <path d="M6.7 2.2h3.1" />
      </svg>
    </span>
  )
}

type SkyTimePhase = 'dawn' | 'day' | 'evening' | 'night'

function SkyWeatherVisual({ weather }: { weather: HostWeatherVisualState | null }) {
  const localHour = new Date().getHours()
  const skyKind = weather?.kind || 'unknown'

  // Keep the backend daylight signal for core assets like stars vs sun/day state.
  const isNightBase = weather ? !weather.isDay : localHour < 7 || localHour >= 19

  let timePhase: SkyTimePhase = isNightBase ? 'night' : 'day'
  if (localHour >= 5 && localHour < 8) {
    timePhase = 'dawn'
  } else if (localHour >= 17 && localHour < 20) {
    timePhase = 'evening'
  }

  return (
    <div
      className={`sky-visual-fx sky-${skyKind} ${isNightBase ? 'sky-night' : 'sky-day'} sky-phase-${timePhase}`}
      aria-hidden
    >
      <div className="sky-glow" />
      <div className="sky-orb" />
      {isNightBase && (
        <>
          <span className="sky-star sky-star-1" />
          <span className="sky-star sky-star-2" />
          <span className="sky-star sky-star-3" />
          <span className="sky-star sky-star-4" />
          <span className="sky-star sky-star-5" />
        </>
      )}
      <span className="sky-cloud sky-cloud-1" />
      <span className="sky-cloud sky-cloud-2" />
      <span className="sky-cloud sky-cloud-3" />
      <span className="sky-cloud sky-cloud-4" />
      <span className="sky-cloud sky-cloud-5" />
      <div className="sky-rainfall">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="sky-snowfall">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
    </div>
  )
}

function GhostCompanion() {
  return (
    <div className="ghost-companion" aria-hidden>
      <div className="ghost-avatar">
        <div className="ghost-shadow" />
        <div className="ghost-body">
          <span className="ghost-eye ghost-eye-left" />
          <span className="ghost-eye ghost-eye-right" />
          <span className="ghost-face ghost-face-left" />
          <span className="ghost-face ghost-face-right" />
          <span className="ghost-pixel ghost-pixel-left" />
          <span className="ghost-pixel ghost-pixel-mid" />
          <span className="ghost-pixel ghost-pixel-right" />
        </div>
      </div>
    </div>
  )
}

type AdvancedFxIntensity = AppSettings['advancedFx']['intensity']
type AgentAuraStatus =
  | 'idle'
  | 'running'
  | 'queued'
  | 'approval'
  | 'failed'
  | 'complete'
  | 'handoff'

function AgentAuraLayer({
  provider,
  status,
  intensity,
  hasHandoff
}: {
  provider: ProviderId
  status: AgentAuraStatus
  intensity: AdvancedFxIntensity
  hasHandoff: boolean
}) {
  return (
    <div
      className={`agent-aura-layer fx-provider-${provider} fx-status-${status} fx-intensity-${intensity} ${hasHandoff ? 'fx-handoff' : ''}`}
      aria-hidden
    >
      <div className="agent-aura-edge agent-aura-edge-left" />
      <div className="agent-aura-edge agent-aura-edge-right" />
      <div className="agent-aura-run-burst" />
    </div>
  )
}

function LivingWorkspaceLayer({
  weather,
  intensity
}: {
  weather: HostWeatherVisualState | null
  intensity: AdvancedFxIntensity
}) {
  const localHour = new Date().getHours()
  const isNight = weather ? !weather.isDay : localHour < 7 || localHour >= 19
  const phase: SkyTimePhase =
    localHour >= 5 && localHour < 8
      ? 'dawn'
      : localHour >= 17 && localHour < 20
        ? 'evening'
        : isNight
          ? 'night'
          : 'day'
  const kind = weather?.kind || 'unknown'
  const moteCount = intensity === 'epic' ? 18 : intensity === 'cinematic' ? 12 : 7
  const weatherParticleCount = intensity === 'epic' ? 16 : intensity === 'cinematic' ? 10 : 5

  return (
    <div
      className={`living-workspace-layer living-${kind} living-phase-${phase} fx-intensity-${intensity}`}
      aria-hidden
    >
      <div className="living-depth living-depth-back" />
      <div className="living-depth living-depth-mid" />
      <div className="living-room-light" />
      <div className="living-motes">
        {Array.from({ length: moteCount }).map((_, index) => (
          <span key={`mote-${index}`} style={{ '--mote-index': index } as CSSProperties} />
        ))}
      </div>
      <div className="living-weather-particles">
        {Array.from({ length: weatherParticleCount }).map((_, index) => (
          <span key={`weather-${index}`} style={{ '--particle-index': index } as CSSProperties} />
        ))}
      </div>
    </div>
  )
}

function RunDataVizLayer({
  provider,
  intensity,
  queueCount,
  rawEventCount,
  approvalWaiting,
  status
}: {
  provider: ProviderId
  intensity: AdvancedFxIntensity
  queueCount: number
  rawEventCount: number
  approvalWaiting: boolean
  status: AgentAuraStatus
}) {
  const queueLaneCount = Math.max(1, Math.min(queueCount || 1, intensity === 'epic' ? 5 : 3))
  const eventLevel = Math.min(100, Math.max(8, rawEventCount * 2))

  return (
    <div
      className={`run-data-viz-layer fx-provider-${provider} fx-status-${status} fx-intensity-${intensity} ${approvalWaiting ? 'approval-waiting' : ''}`}
      aria-hidden
    >
      <svg className="run-data-viz-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path
          className="run-data-viz-flow run-data-viz-flow-a"
          d="M4 78 C 24 56, 42 62, 60 42 S 86 24, 96 16"
        />
        <path
          className="run-data-viz-flow run-data-viz-flow-b"
          d="M2 34 C 24 26, 38 42, 58 34 S 82 12, 98 28"
        />
        <path className="run-data-viz-progress" d={`M8 92 H ${Math.min(94, 8 + eventLevel)}`} />
      </svg>
      <div className="run-data-viz-queue">
        {Array.from({ length: queueLaneCount }).map((_, index) => (
          <span key={`queue-${index}`} style={{ '--queue-index': index } as CSSProperties} />
        ))}
      </div>
    </div>
  )
}

function RunSymbolIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6.1 4v8l4.8-4-4.8-4z" />
      </svg>
    </span>
  )
}

// Claude-style send: the native Claude composer uses a "return" arrow glyph
// (↵) inside the send button instead of a play triangle. Used when
// appearance.composerStyle === 'claude' so the send/stop pair reads native.
function ClaudeReturnSymbolIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12.5 4v2.5a2 2 0 0 1-2 2H4" />
        <path d="M6.5 6.5 4 8.5l2.5 2" />
      </svg>
    </span>
  )
}

// Up-arrow send glyph — used by Codex/Gemini/Kimi composers whose native
// send buttons all feature a filled circular `↑`. The button background +
// shape come from each composer-style's CSS; this just supplies the glyph.
function ArrowUpSendIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 12.5V3.5" />
        <path d="M4 7l4-3.5 4 3.5" />
      </svg>
    </span>
  )
}

function StopSymbolIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="4.3" y="4.3" width="7.4" height="7.4" rx="1" />
      </svg>
    </span>
  )
}

function QueueSymbolIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2.6" y="1.6" width="4.8" height="12.8" rx="0.8" />
        <path d="M9.2 4.2h4.3M11.3 2.4v3.6M11.3 9.8v3.6" />
      </svg>
    </span>
  )
}

// Steer glyph: a forward-pointing arrow piercing a small circle (the
// active turn), conveying "redirect / pierce-through". Used by the
// composer's Steer button — sibling of Queue (passive wait) and Stop
// (interrupt only). Visible while the current chat has an in-flight
// run.
function SteerSymbolIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="5.4" cy="8" r="2.6" />
        <path d="M8.4 8h5.2" />
        <path d="M11.6 5.6 13.6 8l-2 2.4" />
      </svg>
    </span>
  )
}

function ThinkingIndicator() {
  return (
    <div className="message-bubble assistant message-thinking">
      <span>Thinking</span>
      <span className="thinking-dots" aria-hidden>
        <span className="thinking-dot" />
        <span className="thinking-dot" />
        <span className="thinking-dot" />
      </span>
    </div>
  )
}

function PlusSymbolIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 3.5v9M3.5 8h9" />
      </svg>
    </span>
  )
}

// Composer-unification (Phase J1): ChartBarSymbolIcon was only used by
// the Gemini-only `/stats` button which moved into the command palette.
// The dead icon component is removed; if a future surface needs a
// chart-bar glyph we can re-add it then.

function CommandSymbolIcon() {
  return (
    <span className="sf-symbol-icon composer-control-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2.8" y="2.2" width="10.4" height="11.6" rx="2" />
        <path d="M4.9 4.5h6.2" />
        <path d="M4.9 7.5h4.6" />
        <path d="M4.9 10.5h5.2" />
        <circle cx="4.2" cy="4.5" r="0.8" />
        <circle cx="4.2" cy="7.5" r="0.8" />
        <circle cx="4.2" cy="10.5" r="0.8" />
      </svg>
    </span>
  )
}

function ReviewSymbolIcon() {
  return (
    <span className="sf-symbol-icon composer-control-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="2.1" width="8" height="10.4" rx="1.2" />
        <path d="M4.2 4.8h5.6" />
        <path d="M4.2 7h5" />
        <path d="M4.2 9.2h3.2" />
        <circle cx="11" cy="11.2" r="2.2" />
        <path d="M12.8 13 14.3 14.5" />
      </svg>
    </span>
  )
}

function ClockSymbolIcon() {
  return (
    <span className="sf-symbol-icon composer-control-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="8" cy="8" r="5.7" />
        <path d="M8 4.8V8l2.2 1.4" />
      </svg>
    </span>
  )
}

function QuestionmarkCircleSymbolIcon() {
  return (
    <span className="sf-symbol-icon composer-control-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="8" cy="8" r="5.7" />
        <path d="M6.4 6.2A1.8 1.8 0 0 1 8.1 5c1 0 1.8.6 1.8 1.5 0 .8-.5 1.2-1.2 1.6-.5.3-.8.7-.8 1.3" />
        <path d="M8 11.2h.01" />
      </svg>
    </span>
  )
}

function ModelSymbolIcon() {
  return (
    <span className="sf-symbol-icon composer-control-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="4.1" y="4.1" width="7.8" height="7.8" rx="1.4" />
        <path d="M6.1 1.9v2.2M8 1.9v2.2M9.9 1.9v2.2M6.1 11.9v2.2M8 11.9v2.2M9.9 11.9v2.2M1.9 6.1h2.2M1.9 8h2.2M1.9 9.9h2.2M11.9 6.1h2.2M11.9 8h2.2M11.9 9.9h2.2" />
        <path d="M6.5 8h3" />
      </svg>
    </span>
  )
}

function PermissionSymbolIcon() {
  return (
    <span className="sf-symbol-icon composer-control-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5.1 7.8V4.2a.8.8 0 0 1 1.6 0v3" />
        <path d="M6.7 7.2V3.5a.8.8 0 0 1 1.6 0v3.7" />
        <path d="M8.3 7.2V4a.8.8 0 0 1 1.6 0v4" />
        <path d="M9.9 8V5.3a.8.8 0 0 1 1.6 0v4.4c0 2.1-1.4 3.7-3.4 3.7H7.3c-1.2 0-2.1-.5-2.8-1.4L3 9.9a.9.9 0 0 1 1.4-1.1l1 1.1" />
      </svg>
    </span>
  )
}

function TrustSymbolIcon() {
  return (
    <span className="sf-symbol-icon composer-control-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 2.2 12.2 4v3.3c0 2.7-1.6 5-4.2 6.5-2.6-1.5-4.2-3.8-4.2-6.5V4z" />
        <path d="m5.8 7.8 1.4 1.4 3-3" />
      </svg>
    </span>
  )
}

function LinkCircleSymbolIcon() {
  return (
    <span className="sf-symbol-icon composer-control-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="8" cy="8" r="5.7" />
        <path d="M6.9 9.1 9.1 6.9" />
        <path d="M6.2 7.5 5.6 8.1a1.6 1.6 0 0 0 2.3 2.3l.6-.6" />
        <path d="m9.8 8.5.6-.6a1.6 1.6 0 0 0-2.3-2.3l-.6.6" />
      </svg>
    </span>
  )
}

// Composer-unification (Phase J1): CheckpointSymbolIcon was only used
// by the Gemini-only Checkpoints toggle button which moved into the
// command palette (and the palette uses text labels, not glyphs, for
// the toggle items). Dead icon removed.

// Composer-unification (Phase J1): the previous WorktreeSymbolIcon was
// consumed only by the Gemini-only worktree button in the top-toggles
// row. That control now lives inside WorkspaceAccessControls, which
// renders its own scoped worktree glyph. Dead icon removed.

function XSymbolIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    </span>
  )
}

function ContextWheel({ percent, label }: { percent: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, percent))
  const radius = 5.5
  const circumference = 2 * Math.PI * radius
  const dash = (clamped / 100) * circumference
  const remainingDash = circumference - dash
  return (
    <span
      className="context-wheel"
      title={label}
      aria-label={`Context ${Math.round(clamped)}% used (${label})`}
    >
      <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
        <circle
          cx="7"
          cy="7"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          opacity="0.22"
        />
        <circle
          cx="7"
          cy="7"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${remainingDash}`}
          strokeDashoffset={circumference / 4}
          transform="rotate(-90 7 7)"
        />
      </svg>
    </span>
  )
}

// Phase L6 slice 1 — exported so `ModelUsageCard` (and the related
// per-provider block + heatmap) can type their props off the same
// shapes that App.tsx already produces in `refreshUsageSummary`.
// No data-shape changes; just visibility for sibling components.
//
// Phase L6 slice 2 — `planName` added as an optional tier-badge
// string (e.g. "Pro", "Max x5", "Moderato", "Google Account"). The
// `refreshUsageSummary` codepath leaves it `undefined` for now;
// per-provider subscription detection lands in a follow-up. The
// ModelUsageCard renders the badge pill only when this field is
// present + non-empty, so undefined values are visually inert.
export interface ModelUsageAggregate {
  provider: ProviderId
  model: string
  planName?: string
  runs: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  durationMs: number
  inputTokenLimit?: number
  outputTokenLimit?: number
  totalTokenLimit?: number
  resetAt?: string
  resetText?: string
  windows?: UsageWindowAggregate[]
}

export interface UsageWindowAggregate {
  id: string
  label: string
  runs: number
  totalTokens: number
  runLimitMax?: number
  limitLabel: string
  resetAt?: string
  trackingOnly?: boolean
  usedPercent?: number
  remainingPercent?: number
}

interface CodexModelOption {
  id: string
  label?: string
  description?: string
  isDefault?: boolean
  supportedReasoningEfforts?: Array<{ reasoningEffort: string; description?: string }>
  defaultReasoningEffort?: string | null
  additionalSpeedTiers?: string[]
}

type UsageModelEntry = {
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  inputTokenLimit?: number
  outputTokenLimit?: number
  totalTokenLimit?: number
  resetAt?: string
  resetText?: string
  durationMs?: number
}

type ImageAttachment = {
  id: string
  path: string
  name: string
}

type RunCompleteNotice = {
  timestamp: string
  exitCode: number
  startedAt?: string
}

type PersistentSessionStatus =
  | 'idle'
  | 'starting'
  | 'active'
  | 'stopping'
  | 'exited'
  | 'unavailable'
  | 'error'
// Composer-unification (Phase J1 → slash-picker): the legacy
// CommandPaletteItem / Action / Group / Source types and the per-provider
// CORE constants live in src/renderer/src/lib/ComposerSlashCommands.ts
// so the Cmd-K palette AND the new slash picker consume the same data
// without drift. Imported here to keep their historical names in scope
// for the rest of App.tsx.
//
// Imports below the const block — see top-of-file `import` group.

type GeminiMemoryFile = {
  id: string
  scope: 'workspace' | 'global'
  path: string
  displayPath: string
  content?: string
  sizeBytes?: number
  error?: string
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|heic|avif|tiff|tif|svg|jfif)(\?.*)?$/i
const MAX_IMAGE_ATTACHMENTS = 5
const MEMORY_PREVIEW_CHARS = 6000
// DEFAULT_CONTEXT_TURNS, MAX_CONTEXT_TURNS moved to src/main/PromptComposition.ts.
// MAX_CONTEXT_CHARS_PER_TURN, MAX_CONTEXT_BLOCK_CHARS moved to src/main/PromptComposition.ts.
const DEFAULT_FILE_EDITOR_WIDTH = 390
const MIN_RIGHT_PANEL_WIDTH = 300
const MAX_RIGHT_PANEL_WIDTH = 720
const DEFAULT_WORKSPACE_SIDEBAR_WIDTH = 260
const MIN_WORKSPACE_SIDEBAR_WIDTH = 220
const MAX_WORKSPACE_SIDEBAR_WIDTH = 440
const FX_BURST_DURATION_MS = 1150
const GHOST_COMPANION_STORAGE_KEY = 'guiGemini.ghostCompanionEnabled'
const RUN_WRITE_TOOLS = ['replace', 'write_file', 'create_file', 'edit_file']
// Per-provider palette CORE constants moved to
// src/renderer/src/lib/ComposerSlashCommands.ts. Imported under the
// historical names (COMMAND_PALETTE_CORE / CODEX_COMMAND_PALETTE_CORE /
// CLI_PROVIDER_COMMAND_PALETTE_CORE) via the top-of-file import block,
// so existing usages downstream remain unchanged.

type WelcomeHeadingCopy = {
  beforeWorkspace: string
  workspaceName: string
  afterWorkspace: string
}

type WelcomeStarterIntent =
  | 'explore'
  | 'review'
  | 'plan'
  | 'implement'
  | 'debug'
  | 'test'
  | 'schedule'
  | 'global'
type WelcomeStarter = {
  id: string
  label: string
  description: string
  prompt: string
  intent: WelcomeStarterIntent
}
type WelcomeCopy = {
  heading: WelcomeHeadingCopy
  subheading: string
  starters: WelcomeStarter[]
}
type WelcomeCopyContext = {
  workspaceName: string
  providerLabel: string
  permissionModeLabel: string
  isGlobalChat: boolean
  hasDiff: boolean
  diffCount: number
  scheduledTaskCount: number
  lastRunStatus?: string
}

const pluralize = (count: number, singular: string, plural: string = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : plural}`

const welcomeContextLine = (context: WelcomeCopyContext): string =>
  `Current GUI context: ${context.providerLabel}, ${context.permissionModeLabel}.`

const buildWorkspaceOrientationPrompt = (context: WelcomeCopyContext): string =>
  [
    `Inspect the ${context.workspaceName} workspace and give me a concise orientation.`,
    welcomeContextLine(context),
    '',
    'Cover:',
    '- what this app appears to do',
    '- the main frontend, backend, and process boundaries',
    '- the files or directories I should understand first',
    '- the riskiest or most complex areas',
    '- the best first task to improve it',
    '',
    'Do not edit files yet.'
  ].join('\n')

const buildDiffReviewPrompt = (context: WelcomeCopyContext): string =>
  [
    `Review the current uncommitted changes in ${context.workspaceName}.`,
    welcomeContextLine(context),
    '',
    'Use read-only inspection first. Check git status, staged and unstaged diffs, and nearby code when needed.',
    '',
    'Return findings first, ordered by severity. For each finding include file/location, issue, impact, and a concrete suggested fix. If there are no findings, say so explicitly and mention residual risks or missing tests.',
    '',
    'Do not edit files, stage files, commit files, or run formatters.'
  ].join('\n')

const buildImplementationPlanPrompt = (context: WelcomeCopyContext): string =>
  [
    `Make a scoped implementation plan for the next useful change in ${context.workspaceName}.`,
    welcomeContextLine(context),
    '',
    'First inspect only enough code to understand the path. Then give:',
    '- the smallest valuable target',
    '- the files likely involved',
    '- the risks and assumptions',
    '- the acceptance checks',
    '- the exact first edit you would make',
    '',
    'Do not edit files until the plan is clear.'
  ].join('\n')

const buildFocusedImplementationPrompt = (context: WelcomeCopyContext): string =>
  [
    `Find and implement the smallest high-impact improvement in ${context.workspaceName}.`,
    welcomeContextLine(context),
    '',
    'Before editing, state the target and why it is the right size. Keep changes tightly scoped, follow existing code patterns, and avoid unrelated refactors.',
    '',
    'After editing, run the narrowest relevant validation and summarize what changed, what was checked, and any remaining risk.'
  ].join('\n')

const buildTestGapPrompt = (context: WelcomeCopyContext): string =>
  [
    `Find the narrowest useful test or validation gap in ${context.workspaceName}.`,
    welcomeContextLine(context),
    '',
    'Inspect existing tests and recent code paths. Recommend one focused check, then either add it or explain why a different validation is more appropriate.',
    '',
    'Keep the change small and run the relevant test command if available.'
  ].join('\n')

const buildFailureDebugPrompt = (context: WelcomeCopyContext): string =>
  [
    `Investigate the last failed ${context.providerLabel} run in this thread.`,
    welcomeContextLine(context),
    '',
    'Use the available transcript, raw logs, and workspace state to identify the failing path. Then give:',
    '- the likely root cause',
    '- the smallest safe fix',
    '- the validation command or manual check',
    '- any risk before editing',
    '',
    'Do not edit files until the failure path is clear.'
  ].join('\n')

const buildContinueSafelyPrompt = (context: WelcomeCopyContext): string =>
  [
    `Continue work in ${context.workspaceName} without losing the current state.`,
    welcomeContextLine(context),
    '',
    'Start by checking the current diff and recent run context. Then propose the next single edit, the reason for it, and the validation check that should follow.',
    '',
    'Do not make broad cleanup changes.'
  ].join('\n')

const buildScheduledWorkPrompt = (context: WelcomeCopyContext): string =>
  [
    `Review the pending scheduled work for ${context.workspaceName}.`,
    welcomeContextLine(context),
    '',
    'Summarize what appears queued or due, identify any conflicts or stale assumptions, and recommend the next action. If a scheduled run should be adjusted, explain the change before making it.'
  ].join('\n')

const buildGlobalPlanningPrompt = (context: WelcomeCopyContext): string =>
  [
    'Help me plan across my coding work from this global chat.',
    welcomeContextLine(context),
    '',
    'Ask for missing context only if necessary. Otherwise, help me choose one concrete next action, the workspace it belongs in, and the first check that would prove progress.'
  ].join('\n')

const buildProviderSetupPrompt = (context: WelcomeCopyContext): string =>
  [
    `Check whether the current ${context.providerLabel} setup is ready for productive work.`,
    welcomeContextLine(context),
    '',
    'Look for obvious provider, model, permission, or workspace trust issues visible from this app state. Recommend the smallest setup fix before suggesting any coding task.'
  ].join('\n')

const buildGlobalTaskPlanPrompt = (context: WelcomeCopyContext): string =>
  [
    'Help me turn a broad coding goal into a workspace-specific implementation plan.',
    welcomeContextLine(context),
    '',
    'Start by identifying the missing context you need. Then produce:',
    '- the workspace or repo this should happen in',
    '- the smallest useful target',
    '- likely files or systems involved',
    '- risks and assumptions',
    '- acceptance checks before implementation starts'
  ].join('\n')

const buildWelcomeStarters = (context: WelcomeCopyContext): WelcomeStarter[] => {
  if (context.isGlobalChat) {
    return [
      {
        id: 'global-plan',
        label: 'Choose next action',
        description: 'Turn broad context into one concrete coding step.',
        prompt: buildGlobalPlanningPrompt(context),
        intent: 'global'
      },
      {
        id: 'provider-setup',
        label: 'Check setup',
        description: 'Review provider, model, permission, and trust readiness.',
        prompt: buildProviderSetupPrompt(context),
        intent: 'global'
      },
      {
        id: 'implementation-plan',
        label: 'Plan workspace task',
        description: 'Turn a broad goal into a scoped repo plan.',
        prompt: buildGlobalTaskPlanPrompt(context),
        intent: 'plan'
      }
    ]
  }

  if (context.lastRunStatus === 'failed') {
    return [
      {
        id: 'debug-failure',
        label: 'Debug failure',
        description: 'Find the failing path before touching files.',
        prompt: buildFailureDebugPrompt(context),
        intent: 'debug'
      },
      {
        id: 'review-changes',
        label: 'Review changes',
        description: 'Read-only diff review with findings first.',
        prompt: buildDiffReviewPrompt(context),
        intent: 'review'
      },
      {
        id: 'continue-safely',
        label: 'Continue safely',
        description: 'Pick one next edit and one validation check.',
        prompt: buildContinueSafelyPrompt(context),
        intent: 'plan'
      }
    ]
  }

  if (context.hasDiff) {
    return [
      {
        id: 'review-changes',
        label: 'Review changes',
        description: `Audit ${context.diffCount > 0 ? pluralize(context.diffCount, 'changed file') : 'the current diff'} before editing.`,
        prompt: buildDiffReviewPrompt(context),
        intent: 'review'
      },
      {
        id: 'continue-safely',
        label: 'Continue safely',
        description: 'Use the current diff to choose the next single edit.',
        prompt: buildContinueSafelyPrompt(context),
        intent: 'plan'
      },
      {
        id: 'test-gap',
        label: 'Find test gap',
        description: 'Add or recommend the narrowest useful validation.',
        prompt: buildTestGapPrompt(context),
        intent: 'test'
      }
    ]
  }

  if (context.scheduledTaskCount > 0) {
    return [
      {
        id: 'scheduled-work',
        label: 'Review schedule',
        description: `Check ${pluralize(context.scheduledTaskCount, 'pending run')} for stale assumptions.`,
        prompt: buildScheduledWorkPrompt(context),
        intent: 'schedule'
      },
      {
        id: 'implementation-plan',
        label: 'Plan a change',
        description: 'Define target, files, risks, and acceptance checks.',
        prompt: buildImplementationPlanPrompt(context),
        intent: 'plan'
      },
      {
        id: 'map-project',
        label: 'Map project',
        description: 'Orient around structure, risk, and best starting point.',
        prompt: buildWorkspaceOrientationPrompt(context),
        intent: 'explore'
      }
    ]
  }

  return [
    {
      id: 'map-project',
      label: 'Map project',
      description: 'Orient around structure, risk, and best starting point.',
      prompt: buildWorkspaceOrientationPrompt(context),
      intent: 'explore'
    },
    {
      id: 'implementation-plan',
      label: 'Plan a change',
      description: 'Define target, files, risks, and acceptance checks.',
      prompt: buildImplementationPlanPrompt(context),
      intent: 'plan'
    },
    {
      id: 'focused-implementation',
      label: 'Make improvement',
      description: 'Find one small valuable edit and verify it.',
      prompt: buildFocusedImplementationPrompt(context),
      intent: 'implement'
    }
  ]
}
const FILE_DIFF_STATUSES = new Set<DiffFileSummary['status']>([
  'created',
  'modified',
  'deleted',
  'renamed',
  'untracked',
  'binary',
  'too_large',
  'hidden_sensitive'
])

const formatWorkDuration = (startedAt?: string, completedAt?: string): string | null => {
  if (!startedAt || !completedAt) {
    return null
  }

  const started = new Date(startedAt).getTime()
  const completed = new Date(completedAt).getTime()
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) {
    return null
  }

  let remainingSeconds = Math.max(1, Math.round((completed - started) / 1000))
  const hours = Math.floor(remainingSeconds / 3600)
  remainingSeconds -= hours * 3600
  const minutes = Math.floor(remainingSeconds / 60)
  const seconds = remainingSeconds - minutes * 60
  const parts: string[] = []

  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`)
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`)
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} second${seconds === 1 ? '' : 's'}`)

  return `Worked for ${parts.slice(0, 2).join(' ')}`
}

const buildWelcomeCopy = (context: WelcomeCopyContext): WelcomeCopy => {
  const heading: WelcomeHeadingCopy = context.isGlobalChat
    ? {
        beforeWorkspace: `New ${context.providerLabel} `,
        workspaceName: 'global chat',
        afterWorkspace: '.'
      }
    : {
        beforeWorkspace: `New ${context.providerLabel} thread for `,
        workspaceName: context.workspaceName,
        afterWorkspace:
          context.lastRunStatus === 'failed'
            ? ' after a failed run.'
            : context.hasDiff
              ? context.diffCount > 0
                ? ` with ${pluralize(context.diffCount, 'changed file')} ready.`
                : ' with current changes ready.'
              : '.'
      }

  const subheading = context.isGlobalChat
    ? 'Use system scope for broad planning, setup checks, or choosing the right workspace.'
    : context.lastRunStatus === 'failed'
      ? 'Start by narrowing the failure path, then make one fix and verify it.'
      : context.hasDiff
        ? 'Review the current state or choose the next safe edit before adding more changes.'
        : context.scheduledTaskCount > 0
          ? 'Pending scheduled work exists. Check assumptions before starting a new run.'
          : `Pick a starter to place a complete ${context.providerLabel} prompt in the composer.`

  return {
    heading,
    subheading,
    starters: buildWelcomeStarters(context)
  }
}

const sanitizeImagePath = (value: string): string =>
  value.trim().replace(/^\s*["'`]|["'`]\s*$/g, '')

const toDateTimeLocalValue = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const formatScheduledRunTime = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'unscheduled'
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const WELCOME_USAGE_TABS: Array<{ value: WelcomeUsageTab; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'models', label: 'Models' }
]

const providerModelColorClass = (provider: ProviderId): string => `provider-${provider}`

/**
 * Provider palette used by the dense activity grid. Kept in TS so we can mix
 * colours at runtime via {@link mixProviderColors}. The matching CSS variables
 * live in main.css under :root for consistency with the rest of the UI.
 */
const PROVIDER_GRID_COLORS: Record<ProviderId, string> = {
  gemini: '#2563EB',
  codex: '#756AF4',
  claude: '#D97706',
  kimi: '#84A33B'
}

const HEATMAP_LEVEL_OPACITY: Record<number, number> = {
  0: 0,
  1: 0.38,
  2: 0.58,
  3: 0.78,
  4: 1
}

/**
 * Renders a contribution-style activity grid: weekdays run vertically and weeks
 * advance horizontally. Daily intensity comes from the daily heatmap while the
 * fill color still uses provider totals folded up from the hourly buckets.
 */
function ActivityContributionGrid({
  days,
  hourlyCells
}: {
  days: WelcomeUsageDayCell[]
  hourlyCells: WelcomeUsageHourCell[]
}) {
  const firstDay = days[0]
  const firstDate = firstDay ? new Date(`${firstDay.dayKey}T00:00:00`) : null
  const firstWeekday = firstDate && Number.isFinite(firstDate.getTime()) ? firstDate.getDay() : 0
  const weekCount = Math.max(1, Math.ceil((firstWeekday + days.length) / 7))
  const dailyProviderTotals = useMemo(() => {
    const totals = new Map<string, Record<ProviderId, number>>()
    for (const cell of hourlyCells) {
      if (cell.totalTokens <= 0) continue
      const existing = totals.get(cell.dayKey) || { gemini: 0, codex: 0, claude: 0, kimi: 0 }
      existing.gemini += cell.providerTotals.gemini || 0
      existing.codex += cell.providerTotals.codex || 0
      existing.claude += cell.providerTotals.claude || 0
      existing.kimi += cell.providerTotals.kimi || 0
      totals.set(cell.dayKey, existing)
    }
    return totals
  }, [hourlyCells])

  return (
    <div
      className="welcome-usage-activity-grid"
      role="img"
      aria-label={`Daily activity contribution grid for the last ${days.length || HEATMAP_DAY_COUNT} days`}
      style={{
        gridTemplateColumns: `repeat(${weekCount}, var(--activity-cell-size))`,
        gridTemplateRows: 'repeat(7, var(--activity-cell-size))'
      }}
    >
      {days.map((day, index) => {
        const slot = firstWeekday + index
        const providerTotals = dailyProviderTotals.get(day.dayKey)
        const mixedColor = providerTotals
          ? mixProviderColors(providerTotals, PROVIDER_GRID_COLORS)
          : ''
        const color =
          day.level > 0 ? mixedColor || 'var(--activity-heatmap-color, var(--accent))' : ''
        const opacity = HEATMAP_LEVEL_OPACITY[day.level] ?? 0
        const style: CSSProperties = color
          ? {
              backgroundColor: color,
              opacity,
              gridColumn: Math.floor(slot / 7) + 1,
              gridRow: (slot % 7) + 1
            }
          : { gridColumn: Math.floor(slot / 7) + 1, gridRow: (slot % 7) + 1 }
        const tokenSummary =
          day.value > 0 ? `${formatCompactUsageNumber(day.value)} tokens` : 'no activity'
        return (
          <span
            key={day.dayKey}
            className={`welcome-usage-day-cell level-${day.level} ${day.isToday ? 'today' : ''}`}
            style={style}
            title={`${day.label} - ${tokenSummary}`}
          />
        )
      })}
    </div>
  )
}

function WelcomeUsageDashboard({
  data,
  tab,
  onTabChange
}: {
  data: WelcomeUsageDashboardData
  tab: WelcomeUsageTab
  onTabChange: (tab: WelcomeUsageTab) => void
}) {
  const topModels = data.modelBreakdown.slice(0, 4)
  const statItems = [
    { label: 'Sessions', value: formatCompactUsageNumber(data.sessions) },
    { label: 'Messages', value: formatCompactUsageNumber(data.messages) },
    { label: 'Total tokens', value: formatCompactUsageNumber(data.totalTokens) },
    { label: 'Active days', value: formatCompactUsageNumber(data.activeDays) },
    { label: 'Current streak', value: `${data.currentStreak || 0}d` },
    { label: 'Longest streak', value: `${data.longestStreak || 0}d` },
    { label: 'Peak hour', value: data.peakHour },
    { label: 'Favorite model', value: data.favoriteModel }
  ]

  return (
    <section className="welcome-usage-dashboard" aria-label="Provider usage overview">
      <div className="welcome-usage-dashboard-header">
        <div className="welcome-usage-tabs" role="tablist" aria-label="Usage view">
          {WELCOME_USAGE_TABS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`welcome-usage-tab ${tab === option.value ? 'active' : ''}`}
              onClick={() => onTabChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' ? (
        <>
          <div className="welcome-usage-stat-grid">
            {statItems.map((item) => (
              <div key={item.label} className="welcome-usage-stat">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          <ActivityContributionGrid days={data.heatmap} hourlyCells={data.hourlyHeatmap} />
          <p className="welcome-usage-footnote">{data.comparisonText}</p>
        </>
      ) : (
        <>
          <div className="welcome-usage-chart" aria-label="Model usage by day">
            <div className="welcome-usage-y-axis">
              {[1, 0.75, 0.5, 0.25, 0].map((fraction) => (
                <span key={fraction}>
                  {formatCompactUsageNumber(data.maxChartTotal * fraction)}
                </span>
              ))}
            </div>
            <div className="welcome-usage-bars">
              {data.chartDays.map((day) => (
                <div key={day.dayKey} className="welcome-usage-bar-column">
                  <div className="welcome-usage-bar-track">
                    {topModels.map((model) => {
                      const value = model.dailyTotals.get(day.dayKey) || 0
                      if (value <= 0) return null
                      return (
                        <span
                          key={model.id}
                          className={`welcome-usage-bar-segment ${providerModelColorClass(model.provider)}`}
                          style={{ height: `${Math.max(4, (value / data.maxChartTotal) * 100)}%` }}
                          title={`${model.label}: ${formatCompactUsageNumber(value)} tokens`}
                        />
                      )
                    })}
                  </div>
                  <span className="welcome-usage-bar-label">{day.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="welcome-usage-model-list">
            {topModels.length > 0 ? (
              topModels.map((model) => (
                <div key={model.id} className="welcome-usage-model-row">
                  <span
                    className={`welcome-usage-model-dot ${providerModelColorClass(model.provider)}`}
                  />
                  <span className="welcome-usage-model-name">{model.label}</span>
                  <span className="welcome-usage-model-tokens">
                    {formatCompactUsageNumber(model.inputTokens)} in ·{' '}
                    {formatCompactUsageNumber(model.outputTokens)} out
                  </span>
                  <strong>{model.percent.toFixed(model.percent >= 10 ? 1 : 1)}%</strong>
                </div>
              ))
            ) : (
              <div className="welcome-usage-empty">No model-level usage has been tracked yet.</div>
            )}
          </div>
        </>
      )}
    </section>
  )
}

const getImageName = (value: string): string => {
  return value.split(/[/\\]/).filter(Boolean).pop() || value
}

const isImageAttachmentPath = (path: string): boolean => IMAGE_EXT.test(path)

const dedupePaths = (values: string[]): string[] => {
  const seen = new Set<string>()
  const next: string[] = []
  for (const item of values) {
    const normalized = sanitizeImagePath(item)
    if (!normalized || seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    next.push(normalized)
  }
  return next
}

const collectDroppedAttachmentPaths = (dataTransfer?: DataTransfer | null): string[] => {
  if (!dataTransfer) {
    return []
  }
  const paths: string[] = []

  const fileList = dataTransfer.files
  for (let i = 0; i < fileList.length; i += 1) {
    const file = fileList.item(i)
    if (!file) continue
    const asFile = file as File & { path?: string }
    const candidate = sanitizeImagePath(asFile.path || file.name)
    if (candidate) {
      paths.push(candidate)
    }
  }

  if (paths.length > 0) {
    return dedupePaths(paths)
  }

  const uriList = dataTransfer.getData('text/uri-list')
  if (!uriList) {
    return []
  }

  const uriCandidates = uriList
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.startsWith('file://'))
    .map((line) => {
      try {
        return sanitizeImagePath(decodeURIComponent(line.replace(/^file:\/\//, '')))
      } catch {
        return sanitizeImagePath(line.replace(/^file:\/\//, ''))
      }
    })
    .filter(Boolean)

  return dedupePaths(uriCandidates)
}

type PlanChoiceState = {
  messageId: string
  question: string
  options: string[]
}

const parsePlanModeChoice = (text: string): { question: string; options: string[] } | null => {
  const lines = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\r/g, '')
    .split('\n')
  const questionLines: string[] = []
  const options: string[] = []
  let isCollectingOptions = false
  let currentOptionLine = ''

  const optionMatch = (value: string): string | null => {
    const trimmed = value.trim()
    const match = trimmed.match(/^(?:[-*+•]?\s*)?(?:\(?([A-Za-z]|\d+)\)?[.)])\s+(.+)$/)
    if (!match) return null
    return match[2]?.trim()
  }

  for (const line of lines) {
    const parsedOption = optionMatch(line)
    if (parsedOption) {
      isCollectingOptions = true
      currentOptionLine = parsedOption
      options.push(currentOptionLine)
      continue
    }

    if (!isCollectingOptions) {
      if (line.trim()) {
        questionLines.push(line.trim())
      }
      continue
    }

    if (currentOptionLine && line.trim()) {
      currentOptionLine = `${currentOptionLine} ${line.trim()}`
      options[options.length - 1] = currentOptionLine
    }
  }

  if (options.length < 2) {
    return null
  }

  const uniqueOptions = [
    ...new Set(options.map((value) => value.replace(/\s+/g, ' ').trim()).filter(Boolean))
  ]

  if (uniqueOptions.length < 2) {
    return null
  }

  const question = questionLines.filter(Boolean).join(' ').trim()
  const likelyChoicePrompt =
    /(\bchoose\b|\bselect\b|\bpick\b|\bwhich\b|\boption\b|\boptions?\b|\bdecide\b)/i.test(question)
  const looksLikeQuestion = /\?\s*$/.test(question)
  if (!question || (!likelyChoicePrompt && !looksLikeQuestion)) {
    return null
  }

  return {
    question: question || 'Please choose one option to continue.',
    options: uniqueOptions
  }
}

const getImagePreviewSrc = (imagePath: string): string => {
  const normalized = sanitizeImagePath(imagePath).replace(/\\/g, '/')
  return /^[A-Za-z]:\//.test(normalized)
    ? `file:///${normalized}`
    : `file://${normalized.startsWith('/') ? '' : '/'}${normalized}`
}

const dedupeAttachments = (incoming: ImageAttachment[]): ImageAttachment[] => {
  const seen = new Set<string>()
  const next: ImageAttachment[] = []
  for (const item of incoming) {
    const key = sanitizeImagePath(item.path)
    if (!seen.has(key)) {
      seen.add(key)
      next.push(item)
    }
  }
  return next
}

const mergeImageAttachments = (
  current: ImageAttachment[],
  additions: ImageAttachment[]
): ImageAttachment[] => {
  return dedupeAttachments([...current, ...additions]).slice(-MAX_IMAGE_ATTACHMENTS)
}

const normalizeExternalPathGrants = (value: unknown): ExternalPathGrant[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const grants: ExternalPathGrant[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const grant = item as Partial<ExternalPathGrant>
    if (grant.provider !== 'codex' || typeof grant.path !== 'string' || !grant.path.trim()) continue
    if (grant.issuedBy !== 'main' || typeof grant.signature !== 'string' || !grant.signature)
      continue
    const access = grant.access === 'write' ? 'write' : 'read'
    const key = `${access}:${grant.path.trim()}`
    if (seen.has(key)) continue
    seen.add(key)
    grants.push({
      id: grant.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      provider: 'codex',
      workspaceId: grant.workspaceId,
      chatId: grant.chatId,
      path: grant.path.trim(),
      kind: grant.kind === 'directory' ? 'directory' : 'file',
      access,
      duration: grant.duration || 'thisThread',
      securityScopedBookmark: grant.securityScopedBookmark,
      issuedBy: 'main',
      signature: grant.signature,
      createdAt: grant.createdAt || new Date().toISOString()
    })
  }
  return grants
}

const mergeCommandPaletteItems = (customItems: CommandPaletteItem[]): CommandPaletteItem[] => {
  const seen = new Set<string>()
  const next: CommandPaletteItem[] = []

  for (const item of [...COMMAND_PALETTE_CORE, ...customItems]) {
    const key = item.command.trim().toLowerCase()
    if (!key || seen.has(key)) {
      continue
    }
    seen.add(key)
    next.push(item)
  }

  return next
}

const normalizeDiscoveredCommandItems = (items: any[]): CommandPaletteItem[] => {
  if (!Array.isArray(items)) {
    return []
  }

  return items
    .map((item, index): CommandPaletteItem | null => {
      const command = typeof item?.command === 'string' ? item.command.trim() : ''
      if (!command.startsWith('/')) {
        return null
      }

      const source: CommandPaletteSource = item.scope === 'global' ? 'global' : 'workspace'
      return {
        id: `custom-${source}-${command}-${index}`,
        command,
        label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : command,
        description:
          typeof item.description === 'string' && item.description.trim()
            ? item.description.trim()
            : `Custom Gemini command discovered from ${source} command files.`,
        group: 'Custom' as CommandPaletteGroup,
        source,
        sourcePath: typeof item.sourcePath === 'string' ? item.sourcePath : undefined
      }
    })
    .filter((item): item is CommandPaletteItem => Boolean(item))
}

const getMemoryPreviewText = (file: GeminiMemoryFile): string => {
  const content = file.error || file.content || '(empty GEMINI.md)'
  if (content.length <= MEMORY_PREVIEW_CHARS) {
    return content
  }
  return `${content.slice(0, MEMORY_PREVIEW_CHARS)}\n\n[truncated ${content.length - MEMORY_PREVIEW_CHARS} characters]`
}

const normalizeModelName = (model: string): string => {
  const lowered = (model || 'unknown').trim().toLowerCase()
  const compacted = lowered.replace(/[\s_-]+/g, '')
  if (compacted.includes('flashlite')) return 'Flash Lite'
  if (lowered.includes('flash')) return 'Flash'
  if (lowered.includes('pro')) return 'Pro'
  if (lowered.includes('2.0')) return model.trim() || 'unknown'
  return model.trim() || 'unknown'
}

const normalizeGeminiResumeTarget = (value?: string): string | undefined => {
  const target = value?.trim()
  if (!target || target.toLowerCase() === 'unknown') return undefined
  return target && /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,511}$/.test(target) ? target : undefined
}

// sanitizeContextText moved to `src/main/PromptComposition.ts` and re-exported below.

// (Previously: `renderGeminiMessage(text)` returned `<MarkdownMessage content={text} />`.
// Removed — the transcript now calls `<MarkdownMessage content chat>` directly so
// the chat is available for `[@Name](agent://uuid)` chip lookups.)

const formatApprovalChangePreview = (changes: any): string => {
  if (!Array.isArray(changes) || changes.length === 0) return ''
  return changes
    .map((change) => {
      const kind = String(change?.kind || change?.type || change?.operation || 'update')
      const filePath = String(
        change?.path || change?.filePath || change?.file_path || change?.target || ''
      )
      const additions = Number(change?.additions || change?.added || 0)
      const deletions = Number(change?.deletions || change?.deleted || 0)
      const stats = additions || deletions ? ' (+' + additions + ' -' + deletions + ')' : ''
      return (kind + (filePath ? ' ' + filePath : '') + stats).trim()
    })
    .filter(Boolean)
    .join('\\n')
}

const renderAgentApprovalPreview = (preview: any): React.JSX.Element | null => {
  if (!preview || typeof preview !== 'object') return null
  const command = typeof preview.command === 'string' ? preview.command : ''
  const cwd = typeof preview.cwd === 'string' ? preview.cwd : ''
  const toolName = typeof preview.toolName === 'string' ? preview.toolName : ''
  const patchPreview =
    typeof preview.patchPreview === 'string'
      ? preview.patchPreview
      : typeof preview.diff === 'string'
        ? preview.diff
        : typeof preview.patch === 'string'
          ? preview.patch
          : ''
  const changesPreview = formatApprovalChangePreview(preview.changes)
  const kind = typeof preview.kind === 'string' ? preview.kind : 'approval'
  const hasDetails = command || cwd || toolName || patchPreview || changesPreview
  if (!hasDetails) return null

  return (
    <div className="agent-approval-preview">
      <div className="agent-approval-preview-header">{kind}</div>
      {toolName && (
        <div className="agent-approval-preview-row">
          <span>Tool</span>
          <code>{toolName}</code>
        </div>
      )}
      {cwd && (
        <div className="agent-approval-preview-row">
          <span>Cwd</span>
          <code>{cwd}</code>
        </div>
      )}
      {command && (
        <div className="agent-approval-preview-block">
          <span>Command</span>
          <pre>{command}</pre>
        </div>
      )}
      {changesPreview && (
        <div className="agent-approval-preview-block">
          <span>Files</span>
          <pre>{changesPreview}</pre>
        </div>
      )}
      {patchPreview && (
        <div className="agent-approval-preview-block">
          <span>Diff preview</span>
          <pre>{patchPreview}</pre>
        </div>
      )}
    </div>
  )
}

const NON_EXECUTION_TOOL_EVENT_NAMES = new Set([
  'provider_warning',
  'update_topic',
  'summary',
  'intent',
  'progress',
  'tool_progress',
  'codex_reasoning',
  'codex_plan'
])

const isProviderExecutionToolEvent = (event: NormalizedEvent): boolean => {
  if (event.type !== 'tool_event') return false
  const name = String(
    event.name || event.data?.tool_name || event.data?.toolName || event.data?.type || ''
  ).toLowerCase()
  if (NON_EXECUTION_TOOL_EVENT_NAMES.has(name)) return false
  return (
    event.isUse || event.isResult || isToolUseEvent(event.data) || isToolResultEvent(event.data)
  )
}

const extractNumeric = (value: unknown): number | undefined => {
  const parsed = typeof value === 'string' ? Number(value.trim()) : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return Math.trunc(parsed)
}

const extractNestedNumber = (obj: any, paths: Array<string | string[]>): number | undefined => {
  for (const path of paths) {
    const keys = Array.isArray(path) ? path : [path]
    let cursor: any = obj
    let found = true
    for (const key of keys) {
      if (!cursor || typeof cursor !== 'object' || !(key in cursor)) {
        found = false
        break
      }
      cursor = cursor[key]
    }
    if (found) {
      const parsed = extractNumeric(cursor)
      if (parsed !== undefined && parsed > 0) {
        return parsed
      }
    }
  }

  return undefined
}

const extractNestedValue = (obj: any, paths: Array<string | string[]>): unknown => {
  for (const path of paths) {
    const keys = Array.isArray(path) ? path : [path]
    let cursor: any = obj
    let found = true
    for (const key of keys) {
      if (!cursor || typeof cursor !== 'object' || !(key in cursor)) {
        found = false
        break
      }
      cursor = cursor[key]
    }
    if (found && cursor !== undefined && cursor !== null && cursor !== '') {
      return cursor
    }
  }

  return undefined
}

const normalizeResetValue = (value: unknown): { resetAt?: string; resetText?: string } => {
  if (value === undefined || value === null || value === '') {
    return {}
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestampMs = value > 1_000_000_000_000 ? value : value * 1000
    return { resetAt: new Date(timestampMs).toISOString() }
  }

  const text = String(value).trim()
  if (!text) {
    return {}
  }

  const timeOnlyMatch = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i)
  if (timeOnlyMatch) {
    let hours = Number(timeOnlyMatch[1])
    const minutes = Number(timeOnlyMatch[2])
    const meridiem = timeOnlyMatch[3]?.toLowerCase()
    if (meridiem === 'pm' && hours < 12) hours += 12
    if (meridiem === 'am' && hours === 12) hours = 0

    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
      const parsed = new Date()
      parsed.setHours(hours, minutes, 0, 0)
      if (parsed.getTime() < Date.now() - 60_000) {
        parsed.setDate(parsed.getDate() + 1)
      }
      return { resetAt: parsed.toISOString(), resetText: text }
    }
  }

  const monthNames: Record<string, number> = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11
  }
  const dayMonthMatch = text.match(/^(\d{1,2})\s+([a-z]{3,9})(?:\s+(\d{4}))?$/i)
  if (dayMonthMatch) {
    const day = Number(dayMonthMatch[1])
    const month = monthNames[dayMonthMatch[2].toLowerCase()]
    const explicitYear = dayMonthMatch[3] ? Number(dayMonthMatch[3]) : undefined
    if (day >= 1 && day <= 31 && month !== undefined) {
      const now = new Date()
      let year = explicitYear || now.getFullYear()
      let parsed = new Date(year, month, day, 0, 0, 0, 0)
      if (
        !explicitYear &&
        parsed.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      ) {
        year += 1
        parsed = new Date(year, month, day, 0, 0, 0, 0)
      }
      return { resetAt: parsed.toISOString(), resetText: text }
    }
  }

  const parsed = Date.parse(text)
  if (Number.isFinite(parsed)) {
    return { resetAt: new Date(parsed).toISOString(), resetText: text }
  }

  return { resetText: text }
}

const extractUsageReset = (stats: any): { resetAt?: string; resetText?: string } => {
  if (!stats || typeof stats !== 'object') {
    return {}
  }

  return normalizeResetValue(
    extractNestedValue(stats, [
      ['reset_at'],
      ['resetAt'],
      ['resets_at'],
      ['resetsAt'],
      ['reset_time'],
      ['resetTime'],
      ['next_reset'],
      ['nextReset'],
      ['next_reset_at'],
      ['nextResetAt'],
      ['quota', 'reset_at'],
      ['quota', 'resetAt'],
      ['quota', 'next_reset'],
      ['usage', 'reset_at'],
      ['usage', 'resetAt'],
      ['limits', 'reset_at'],
      ['limits', 'resetAt'],
      ['usageLimits', 'reset_at'],
      ['usageLimits', 'resetAt']
    ])
  )
}

const mergeUsageReset = (
  current: { resetAt?: string; resetText?: string },
  incoming: { resetAt?: string; resetText?: string }
): { resetAt?: string; resetText?: string } => {
  if (!incoming.resetAt && !incoming.resetText) {
    return current
  }
  if (!current.resetAt && !current.resetText) {
    return incoming
  }
  if (incoming.resetAt && current.resetAt) {
    return new Date(incoming.resetAt).getTime() >= new Date(current.resetAt).getTime()
      ? incoming
      : current
  }
  return incoming.resetAt ? incoming : current
}

const extractResetHintsFromText = (
  text: string
): Array<{ model: string; resetAt?: string; resetText?: string }> => {
  const hints: Array<{ model: string; resetAt?: string; resetText?: string }> = []
  const lines = text.replace(/\r/g, '').split('\n')
  const modelPattern =
    /(flash[-\s]?lite|flash|pro|gemini[-\w.]*flash[-\w.]*lite|gemini[-\w.]*flash|gemini[-\w.]*pro)/i

  for (const line of lines) {
    if (!/reset|resets|refresh|renews|available/i.test(line)) {
      continue
    }
    const modelMatch = line.match(modelPattern)
    if (!modelMatch) {
      continue
    }
    const resetMatch = line.match(
      /(?:reset|resets|refresh(?:es)?|renews|available again)\s*(?:at|on|in|:)?\s*([^|,;]+)/i
    )
    const reset = normalizeResetValue(resetMatch?.[1] || line.trim())
    hints.push({
      model: normalizeModelName(modelMatch[1]),
      ...reset
    })
  }

  return hints
}

const extractUsageLimits = (
  stats: any
): { inputTokenLimit?: number; outputTokenLimit?: number; totalTokenLimit?: number } => {
  if (!stats || typeof stats !== 'object') {
    return {}
  }

  const inputTokenLimit = extractNestedNumber(stats, [
    ['inputTokensLimit'],
    ['input_tokens_limit'],
    ['input_limit_tokens'],
    ['tokenLimits', 'input'],
    ['token_limits', 'input'],
    ['usageLimits', 'input_tokens'],
    ['limits', 'input_tokens'],
    'inputTokenLimit',
    'inputLimit',
    'input_limit'
  ])

  const outputTokenLimit = extractNestedNumber(stats, [
    ['outputTokensLimit'],
    ['output_tokens_limit'],
    ['output_limit_tokens'],
    ['tokenLimits', 'output'],
    ['token_limits', 'output'],
    ['usageLimits', 'output_tokens'],
    ['limits', 'output_tokens'],
    'outputTokenLimit',
    'outputLimit',
    'output_limit'
  ])

  const totalTokenLimit = extractNestedNumber(stats, [
    ['totalTokensLimit'],
    ['total_tokens_limit'],
    ['total_limit_tokens'],
    ['tokenLimits', 'total'],
    ['token_limits', 'total'],
    ['usageLimits', 'total_tokens'],
    ['limits', 'total_tokens'],
    ['limits', 'total'],
    'totalTokenLimit',
    'totalLimit',
    'total_limit'
  ])

  return {
    inputTokenLimit,
    outputTokenLimit,
    totalTokenLimit
  }
}

const extractUsageCount = (stats: any, keys: Array<string | string[]>): number => {
  return extractNestedNumber(stats, keys) || 0
}

const sumUsageCounts = (stats: any, keys: Array<string | string[]>): number => {
  return keys.reduce((total, key) => total + extractUsageCount(stats, [key]), 0)
}

const extractUsageCountsFromCandidate = (
  stats: any
): { inputTokens: number; outputTokens: number; totalTokens: number } => {
  const inputBaseTokens = extractUsageCount(stats, [
    ['input_tokens'],
    ['inputTokens'],
    ['prompt_tokens'],
    ['promptTokens'],
    ['input'],
    ['prompt'],
    ['counts', 'input'],
    ['counts', 'prompt'],
    ['tokenCounts', 'input'],
    ['token_counts', 'input']
  ])
  const cacheInputTokens = stats?._agentbench_input_includes_cache
    ? 0
    : sumUsageCounts(stats, [
        ['cache_creation_input_tokens'],
        ['cache_read_input_tokens'],
        ['cached_input_tokens'],
        ['input_cache_creation'],
        ['input_cache_read']
      ])
  const inputAudioTokens = stats?._agentbench_input_includes_cache
    ? 0
    : sumUsageCounts(stats, [['input_audio_tokens']])
  const inputTokens = inputBaseTokens + cacheInputTokens + inputAudioTokens

  const outputBaseTokens = extractUsageCount(stats, [
    ['output_tokens'],
    ['outputTokens'],
    ['completion_tokens'],
    ['completionTokens'],
    ['output'],
    ['counts', 'output'],
    ['counts', 'completion'],
    ['tokenCounts', 'output'],
    ['token_counts', 'output']
  ])
  const outputTokens = outputBaseTokens + sumUsageCounts(stats, [['output_audio_tokens']])

  const explicitTotalTokens = extractUsageCount(stats, [
    ['total_tokens'],
    ['totalTokens'],
    ['all_tokens'],
    ['total'],
    ['tokens', 'total'],
    ['tokenCounts', 'total'],
    ['token_counts', 'total']
  ])
  const totalTokens = explicitTotalTokens > 0 ? explicitTotalTokens : inputTokens + outputTokens

  return {
    inputTokens: Math.trunc(Math.max(0, inputTokens)),
    outputTokens: Math.trunc(Math.max(0, outputTokens)),
    totalTokens: Math.trunc(Math.max(0, totalTokens))
  }
}

const isNonEmptyObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const buildUsageModelEntry = (
  modelName: string,
  candidate: any,
  fallbackModel: string
): UsageModelEntry | null => {
  if (!isNonEmptyObject(candidate)) {
    return null
  }

  const resolvedModel = modelName?.trim() || fallbackModel || 'unknown'
  const counts = extractUsageCountsFromCandidate(candidate)
  const limits = extractUsageLimits(candidate)
  const reset = extractUsageReset(candidate)
  const durationMs = extractUsageCount(candidate, [['duration_ms'], ['durationMs']])

  const hasAnyCount = counts.inputTokens > 0 || counts.outputTokens > 0 || counts.totalTokens > 0
  const hasAnyLimit = Boolean(
    limits.inputTokenLimit || limits.outputTokenLimit || limits.totalTokenLimit
  )
  const hasAnyReset = Boolean(reset.resetAt || reset.resetText)
  const hasAnyDuration = durationMs > 0

  if (!hasAnyCount && !hasAnyLimit && !hasAnyReset && !hasAnyDuration) {
    return null
  }

  return {
    model: resolvedModel,
    ...counts,
    ...limits,
    ...reset,
    ...(hasAnyDuration ? { durationMs } : {})
  }
}

const extractModelUsageEntriesFromStats = (
  stats: any,
  fallbackModel: string
): UsageModelEntry[] => {
  if (!isNonEmptyObject(stats)) {
    return [
      {
        model: fallbackModel || 'unknown',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        durationMs: 0
      }
    ]
  }

  const entries: UsageModelEntry[] = []
  const modelStats = stats.models

  if (Array.isArray(modelStats) && modelStats.length > 0) {
    for (const item of modelStats) {
      if (isNonEmptyObject(item)) {
        const next = buildUsageModelEntry(
          (item.model || item.name || item.id || '').toString(),
          item,
          fallbackModel
        )
        if (next) entries.push(next)
      } else if (typeof item === 'string' && item.trim()) {
        entries.push({
          model: item.trim(),
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          durationMs: 0
        })
      }
    }
  } else if (isNonEmptyObject(modelStats)) {
    for (const [modelName, item] of Object.entries(modelStats)) {
      const next = buildUsageModelEntry(modelName, item, fallbackModel)
      if (next) {
        entries.push(next)
      }
    }
  }

  if (entries.length > 0) {
    return entries
  }

  const fallback = buildUsageModelEntry(fallbackModel, stats, fallbackModel)
  if (fallback) {
    return [fallback]
  }

  return [
    {
      model: fallbackModel || 'unknown',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      durationMs: 0
    }
  ]
}

// clampContextTurns moved to `src/main/PromptComposition.ts` and re-exported below.

const clampPanelWidth = (value: number): number => {
  return Math.max(MIN_RIGHT_PANEL_WIDTH, Math.min(MAX_RIGHT_PANEL_WIDTH, Math.round(value)))
}

const clampWorkspaceSidebarWidth = (value: number): number => {
  return Math.max(
    MIN_WORKSPACE_SIDEBAR_WIDTH,
    Math.min(MAX_WORKSPACE_SIDEBAR_WIDTH, Math.round(value))
  )
}

const getStoredFileEditorWidth = (): number => {
  try {
    const stored = window.localStorage.getItem('guiGemini.fileEditorWidth')
    const parsed = stored ? Number(stored) : DEFAULT_FILE_EDITOR_WIDTH
    return Number.isFinite(parsed) ? clampPanelWidth(parsed) : DEFAULT_FILE_EDITOR_WIDTH
  } catch {
    return DEFAULT_FILE_EDITOR_WIDTH
  }
}

const getStoredWorkspaceSidebarWidth = (): number => {
  try {
    const stored = window.localStorage.getItem('guiGemini.workspaceSidebarWidth')
    const parsed = stored ? Number(stored) : DEFAULT_WORKSPACE_SIDEBAR_WIDTH
    return Number.isFinite(parsed)
      ? clampWorkspaceSidebarWidth(parsed)
      : DEFAULT_WORKSPACE_SIDEBAR_WIDTH
  } catch {
    return DEFAULT_WORKSPACE_SIDEBAR_WIDTH
  }
}

const getStoredGhostCompanionEnabled = (): boolean => {
  try {
    return window.localStorage.getItem(GHOST_COMPANION_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

const SKY_VISUAL_FX_STORAGE_KEY = 'guiGemini.skyVisualFxEnabled'
const SKY_WEATHER_REFRESH_MS = 30 * 60 * 1000
const MIN_GEMINI_TERMINAL_HEIGHT = 150
const DEFAULT_GEMINI_TERMINAL_HEIGHT = 260
const MAX_GEMINI_TERMINAL_HEIGHT_RATIO = 0.55

const getStoredSkyVisualFxEnabled = (): boolean => {
  try {
    return window.localStorage.getItem(SKY_VISUAL_FX_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

const isFunFxMode = (value: unknown): value is AppSettings['funFxMode'] =>
  value === 'off' || value === 'subtle' || value === 'cinematic' || value === 'epic'

const getLegacyFunFxSettingsFromLocalStorage = (): Pick<
  AppSettings,
  'funFxEnabled' | 'funFxMode'
> => {
  const skyEnabled = getStoredSkyVisualFxEnabled()
  const ghostEnabled = getStoredGhostCompanionEnabled()
  if (!skyEnabled && !ghostEnabled) {
    return { funFxEnabled: false, funFxMode: 'off' }
  }

  if (skyEnabled && ghostEnabled) {
    return { funFxEnabled: true, funFxMode: 'cinematic' }
  }

  return { funFxEnabled: true, funFxMode: 'subtle' }
}

const clampGeminiTerminalHeight = (value: number): number => {
  const maxHeight = Math.max(
    MIN_GEMINI_TERMINAL_HEIGHT,
    Math.floor(window.innerHeight * MAX_GEMINI_TERMINAL_HEIGHT_RATIO)
  )
  return Math.max(MIN_GEMINI_TERMINAL_HEIGHT, Math.min(maxHeight, Math.round(value)))
}

// Prompt-composition helpers moved to `src/main/PromptComposition.ts` (Phase B3 step 1).
// Re-exported below from the canonical module so existing call sites keep working
// without an import-statement migration; future call sites should import directly.

const MAX_REVIEW_DIFF_CHARS = 90000

const summarizeReviewDiffFile = (summary: DiffFileSummary): string => {
  const details: string[] = [summary.status]

  if (typeof summary.additions === 'number' || typeof summary.deletions === 'number') {
    details.push(`+${summary.additions || 0}/-${summary.deletions || 0}`)
  }
  if (summary.isSensitive) {
    details.push('sensitive content omitted')
  }
  if (summary.isBinary) {
    details.push('binary')
  }
  if (summary.isNoise) {
    details.push('noise')
  }
  if (summary.previewKind && summary.previewKind !== 'none') {
    details.push(`preview: ${summary.previewKind}`)
  }

  return `- ${summary.path} (${details.join(', ')})`
}

const collectReviewDiffText = (diffObj: any): string => {
  const chunks: string[] = []
  const seen = new Set<string>()

  const appendChunk = (value: unknown) => {
    if (typeof value !== 'string') return
    const text = value.trim()
    if (!text || seen.has(text)) return
    seen.add(text)
    chunks.push(text)
  }

  appendChunk(diffObj?.diffText)

  if (Array.isArray(diffObj?.summaries)) {
    diffObj.summaries.forEach((summary: DiffFileSummary) => appendChunk(summary.diffText))
  }

  return chunks.join('\n\n')
}

const buildReviewCurrentDiffPrompt = (diffObj: any): string => {
  const summaries = Array.isArray(diffObj?.summaries)
    ? diffObj.summaries.filter((summary: DiffFileSummary) => summary?.path)
    : []
  const summaryText =
    summaries.length > 0
      ? summaries.map(summarizeReviewDiffFile).join('\n')
      : diffObj?.statusText
        ? `Git status:\n${diffObj.statusText}`
        : diffObj?.text || 'No file-level summary was available.'

  const fullDiffText = collectReviewDiffText(diffObj)
  const diffText =
    fullDiffText.length > MAX_REVIEW_DIFF_CHARS
      ? `${fullDiffText.slice(0, MAX_REVIEW_DIFF_CHARS)}\n[Diff truncated by GUIGemini before sending to Gemini. Inspect the workspace with read-only commands if needed.]`
      : fullDiffText

  const diffBlock = diffText
    ? `Current diff text:\n~~~diff\n${diffText}\n~~~`
    : 'No inline diff text was available. Inspect current changes with read-only commands if needed.'

  return [
    'You are performing a read-only code review of the current workspace diff, equivalent to Codex /review.',
    'Review only the current uncommitted workspace changes. Do not edit files, apply patches, stage files, commit files, run formatters, or make any workspace changes.',
    'If the included diff is incomplete, inspect the workspace using read-only commands such as git status --short, git diff --cached, git diff, and file reads.',
    'Return findings first, ordered by severity. For each finding include severity, file/location, issue, impact, and a concrete suggested fix. If there are no findings, say so explicitly and mention residual risks or testing gaps.',
    `Diff source status: ${diffObj?.type || 'unknown'}.`,
    `Current diff summary:\n${summaryText}`,
    diffBlock
  ].join('\n\n')
}

interface QueuedRunRequest {
  appRunId?: string
  scope?: ChatScope
  provider: ProviderId
  prompt: string
  displayPrompt?: string
  overrideModel?: string
  existingPrompt?: string
  selectedModelType: string
  customModel: string
  approvalMode: string
  sessionTrust: boolean
  imageAttachments: ImageAttachment[]
  externalPathGrants?: ExternalPathGrant[]
  geminiWorktree?: GeminiWorktreeConfig
  codexNativeReview?: boolean
  codexReasoningEffort?: string | null
  codexServiceTier?: string | null
  claudeReasoningEffort?: string | null
  kimiThinkingEnabled?: boolean
  scheduledTaskId?: string
  workspaceRecord?: WorkspaceRecord
  chatRecord?: ChatRecord
  preserveComposer?: boolean
  runtimeProfileId?: string
  geminiAuthProfileId?: string | null
  handoffSourceRunId?: string
}

interface ComposerPermissionState {
  paths: string[]
  message: string
  kind: GeminiPermissionRequest['kind'] | null
  source: GeminiPermissionRequest['source'] | null
}

interface RunRouteEventPayload {
  provider?: ProviderId
  appRunId?: string
  appChatId?: string
  data?: string
  error?: string
  code?: number | null
}

interface ActiveRunContext {
  runId: string
  chatId: string
  provider: ProviderId
  adapter: GeminiStreamAdapter
  warnings: RunWarning[]
  usageResetHints: Map<string, { resetAt?: string; resetText?: string }>
  errorCount: number
  capacityFallbackShown?: boolean
  toolCallsCount: number
  preSnapshot: any
  baseWorkspacePath: string | null
  workspacePath: string | null
  workspaceId?: string
  worktree?: GeminiWorktreeConfig
  checkpointingEnabled?: boolean
  startedAt: string | null
  diffUnavailable: boolean
  scheduledTaskId: string | null
}

type AgentApprovalAction =
  | 'accept'
  | 'acceptForSession'
  | 'acceptForWorkspace'
  | 'decline'
  | 'cancel'

interface AgentApprovalRequest {
  id: string
  provider: ProviderId
  appRunId?: string
  appChatId?: string
  method: string
  title: string
  body: string
  preview?: any
  actions: AgentApprovalAction[]
}

const WORKTREE_DIFF_UNAVAILABLE_TEXT =
  'Gemini worktree mode is active, but the effective worktree path is not known. Diff Studio is disabled so it does not show changes from the original workspace.'
const CODEX_DEFAULT_MODELS = [
  {
    id: 'gpt-5.5',
    label: 'GPT-5.5',
    supportedReasoningEfforts: [
      { reasoningEffort: 'medium' },
      { reasoningEffort: 'high' },
      { reasoningEffort: 'xhigh' }
    ],
    defaultReasoningEffort: 'medium',
    additionalSpeedTiers: ['fast']
  },
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    supportedReasoningEfforts: [
      { reasoningEffort: 'medium' },
      { reasoningEffort: 'high' },
      { reasoningEffort: 'xhigh' }
    ],
    defaultReasoningEffort: 'medium',
    additionalSpeedTiers: ['fast']
  },
  {
    id: 'gpt-5.3-codex',
    label: 'GPT-5.3 Codex',
    supportedReasoningEfforts: [
      { reasoningEffort: 'medium' },
      { reasoningEffort: 'high' },
      { reasoningEffort: 'xhigh' }
    ],
    defaultReasoningEffort: 'medium',
    additionalSpeedTiers: ['fast']
  },
  {
    id: 'gpt-5.3-codex-spark',
    label: 'GPT-5.3 Codex Spark',
    supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }],
    defaultReasoningEffort: 'low',
    additionalSpeedTiers: ['fast']
  }
] satisfies CodexModelOption[]
const CODEX_DEFAULT_MODEL = CODEX_DEFAULT_MODELS[0].id
const DEFAULT_AGENTIC_SERVICES: AgenticServicesSettings = {
  shellCommands: 'workspace',
  fileChanges: 'ask',
  mcpTools: 'ask',
  subThreadDelegation: 'ask',
  networkAccess: 'allow'
}
const CLAUDE_THINKING_EFFORTS = [
  { reasoningEffort: 'off' },
  { reasoningEffort: 'low' },
  { reasoningEffort: 'medium' },
  { reasoningEffort: 'high' }
]
const CLAUDE_DEFAULT_MODELS = [
  {
    id: 'default',
    label: 'Default',
    description: 'Claude Code configured default',
    isDefault: true,
    supportedReasoningEfforts: CLAUDE_THINKING_EFFORTS
  },
  {
    id: 'claude-opus-4-7',
    label: 'Claude Opus 4.7',
    description: 'Most capable — extended thinking',
    supportedReasoningEfforts: CLAUDE_THINKING_EFFORTS
  },
  {
    id: 'claude-opus-4-7-1m',
    label: 'Claude Opus 4.7 1M',
    description: '1M context window — extended thinking',
    supportedReasoningEfforts: CLAUDE_THINKING_EFFORTS
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    description: 'Balanced — extended thinking',
    supportedReasoningEfforts: CLAUDE_THINKING_EFFORTS
  },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', description: 'Fast & efficient' },
  {
    id: 'claude-opus-4-6',
    label: 'Claude Opus 4.6 Legacy',
    description: 'Previous Opus generation',
    supportedReasoningEfforts: CLAUDE_THINKING_EFFORTS
  }
] satisfies CodexModelOption[]
const KIMI_DEFAULT_MODELS = [
  { id: 'kimi-k2.6', label: 'Kimi K2.6', description: 'Kimi Code CLI model', isDefault: true }
] satisfies CodexModelOption[]
const KIMI_DEFAULT_MODEL = KIMI_DEFAULT_MODELS[0].id
// Single source of truth for Gemini's composer model list. Mirrors the
// claude/kimi constants above so `getProviderModelOptions` returns the
// same `CodexModelOption[]` shape for every provider and the composer's
// `<option>` rendering no longer needs a Gemini-only inline branch.
const GEMINI_DEFAULT_MODELS = [
  { id: 'cli-default', label: 'CLI Default', isDefault: true },
  { id: 'auto', label: 'Auto' },
  { id: 'pro', label: 'Pro' },
  { id: 'flash', label: 'Flash' },
  { id: 'flash-lite', label: 'Flash Lite' }
] satisfies CodexModelOption[]
const GEMINI_MODEL_IDS = new Set(['cli-default', 'auto', 'pro', 'flash', 'flash-lite', 'custom'])
const CLAUDE_MODEL_IDS = new Set([
  'default',
  'sonnet',
  'opus',
  'haiku',
  'custom',
  'claude-opus-4-7',
  'claude-opus-4-7-1m',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'claude-opus-4-6'
])
const KIMI_MODEL_IDS = new Set(KIMI_DEFAULT_MODELS.map((model) => model.id))
const CLAUDE_AGENT_SDK_CREDIT_NOTICE =
  'Claude runs inside AGBench use Agent SDK or claude -p programmatic paths. From 2026-06-15 Anthropic says these use separate Agent SDK credit, not normal interactive Claude Code subscription limits.'
const CLAUDE_API_KEY_PAYG_NOTICE =
  'Claude runs inside AGBench use the saved Anthropic API key when configured, so usage is API/PAYG rather than normal interactive Claude Code subscription limits.'
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const GLOBAL_USAGE_WORKSPACE_ID = '__agentbench_global_chats__'

const getChatProvider = (chat?: ChatRecord | null): ProviderId => chat?.provider || 'gemini'
const getChatScope = (chat?: Pick<ChatRecord, 'scope'> | null): ChatScope =>
  chat?.scope === 'global' ? 'global' : 'workspace'
const isGlobalChat = (chat?: Pick<ChatRecord, 'scope'> | null): boolean =>
  getChatScope(chat) === 'global'
const getUsageWorkspaceIdForChat = (chat?: ChatRecord | null): string | undefined =>
  isGlobalChat(chat) ? GLOBAL_USAGE_WORKSPACE_ID : chat?.workspaceId
const getProviderLabel = (provider: ProviderId): string => {
  if (provider === 'codex') return 'Codex'
  if (provider === 'claude') return 'Claude'
  if (provider === 'kimi') return 'Kimi'
  return 'Gemini'
}
const isGeminiModelId = (modelId: string): boolean => GEMINI_MODEL_IDS.has(modelId)
const isCodexModelId = (modelId: string): boolean =>
  modelId.startsWith('gpt-') || modelId.includes('codex')
const isClaudeModelId = (modelId: string): boolean =>
  CLAUDE_MODEL_IDS.has(modelId) || modelId.includes('claude')
const isKimiModelId = (modelId: string): boolean => KIMI_MODEL_IDS.has(modelId)
const normalizeProviderModelKey = (model?: string | null): string =>
  String(model || '')
    .trim()
    .toLowerCase()

const EMPTY_PERMISSION_STATE: ComposerPermissionState = {
  paths: [],
  message: '',
  kind: null,
  source: null
}
const EMPTY_CHAT_MESSAGES: ChatMessage[] = []
const EMPTY_IMAGE_ATTACHMENTS: ImageAttachment[] = []

function CockpitPanel({
  lanes,
  handoffCards,
  onClose,
  onOpenThread,
  onCancelRun,
  onRetryRun,
  onDuplicateRun,
  onCreateHandoff,
  onDispatchHandoff,
  onArchiveHandoff
}: {
  lanes: RunLane[]
  handoffCards: HandoffCard[]
  onClose: () => void
  onOpenThread: (chatId?: string) => void
  onCancelRun: (lane: RunLane) => void
  onRetryRun: (lane: RunLane) => void
  onDuplicateRun: (lane: RunLane) => void
  onCreateHandoff: (lane: RunLane) => void
  onDispatchHandoff: (card: HandoffCard) => void
  onArchiveHandoff: (card: HandoffCard) => void
}) {
  const providerIds: ProviderId[] = ['gemini', 'codex', 'claude', 'kimi']
  const activeCount = lanes.filter((lane) => lane.phase === 'active').length
  const waitingCount = lanes.filter(
    (lane) => lane.phase === 'queued' || lane.phase === 'scheduled' || lane.phase === 'paused'
  ).length
  const failedCount = lanes.filter((lane) => lane.phase === 'failed').length
  const openHandoffs = handoffCards.filter((card) => card.status === 'draft')

  return (
    <div className="cockpit-overlay" role="dialog" aria-modal="true" aria-label="Agent cockpit">
      <div className="cockpit-panel">
        <div className="cockpit-header">
          <div>
            <span className="cockpit-kicker">AGBench cockpit</span>
            <h2>Run lanes</h2>
            <p>Global queue, profile, handoff, and workspace collision supervision.</p>
          </div>
          <button className="cockpit-close-btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="cockpit-metrics">
          <span>
            <strong>{activeCount}</strong> active
          </span>
          <span>
            <strong>{waitingCount}</strong> waiting
          </span>
          <span>
            <strong>{failedCount}</strong> failed
          </span>
          <span>
            <strong>{openHandoffs.length}</strong> handoffs
          </span>
        </div>
        <div className="cockpit-body">
          <div className="cockpit-lanes">
            {providerIds.map((provider) => {
              const providerLanes = lanes.filter((lane) => lane.provider === provider)
              return (
                <section key={provider} className={`cockpit-provider provider-${provider}`}>
                  <div className="cockpit-provider-header">
                    <strong>{getProviderLabel(provider)}</strong>
                    <span>
                      {providerLanes.filter((lane) => lane.phase === 'active').length}/1 running
                    </span>
                  </div>
                  {providerLanes.length === 0 ? (
                    <div className="cockpit-empty">No lanes.</div>
                  ) : (
                    providerLanes.map((lane) => (
                      <article key={lane.id} className={`cockpit-lane phase-${lane.phase}`}>
                        <div className="cockpit-lane-main">
                          <span className="cockpit-lane-phase">{lane.phase}</span>
                          <strong>{lane.chatTitle || lane.chatId || 'Untitled chat'}</strong>
                          <p>{lane.promptPreview || 'No prompt preview available.'}</p>
                        </div>
                        <div className="cockpit-lane-meta">
                          <span>{lane.runtimeProfileName || 'Default runtime'}</span>
                          {lane.workspacePath && (
                            <span title={lane.workspacePath}>
                              {lane.workspacePath.split(/[\\/]/).pop() || lane.workspacePath}
                            </span>
                          )}
                          {lane.blockedReason && <span>{lane.blockedReason}</span>}
                          {lane.conflictSummary && (
                            <span className="cockpit-conflict">{lane.conflictSummary}</span>
                          )}
                        </div>
                        <div className="cockpit-lane-actions">
                          <button
                            type="button"
                            onClick={() => onOpenThread(lane.chatId)}
                            disabled={!lane.chatId}
                          >
                            Open
                          </button>
                          <button
                            type="button"
                            onClick={() => onCancelRun(lane)}
                            disabled={
                              !lane.runId ||
                              (lane.phase !== 'active' &&
                                lane.phase !== 'queued' &&
                                lane.phase !== 'paused')
                            }
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => onRetryRun(lane)}
                            disabled={!lane.runId}
                          >
                            Retry
                          </button>
                          <button
                            type="button"
                            onClick={() => onDuplicateRun(lane)}
                            disabled={!lane.chatId}
                          >
                            Duplicate
                          </button>
                          <button
                            type="button"
                            onClick={() => onCreateHandoff(lane)}
                            disabled={!lane.runId || !lane.chatId}
                          >
                            Handoff
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </section>
              )
            })}
          </div>
          <aside className="cockpit-handoffs">
            <div className="cockpit-provider-header">
              <strong>User-mediated handoffs</strong>
              <span>{openHandoffs.length} draft</span>
            </div>
            {openHandoffs.length === 0 ? (
              <div className="cockpit-empty">
                Create a handoff from any completed or active run.
              </div>
            ) : (
              openHandoffs.map((card) => (
                <article key={card.id} className="cockpit-handoff-card">
                  <strong>{getProviderLabel(card.sourceProvider)} handoff</strong>
                  <p>{compactPromptPreview(card.summary || card.finalPrompt)}</p>
                  {card.selectedFiles.length > 0 && (
                    <span>{card.selectedFiles.length} file refs</span>
                  )}
                  <div className="cockpit-lane-actions">
                    <button type="button" onClick={() => onOpenThread(card.sourceChatId)}>
                      Source
                    </button>
                    <button type="button" onClick={() => onDispatchHandoff(card)}>
                      Dispatch
                    </button>
                    <button type="button" onClick={() => onArchiveHandoff(card)}>
                      Archive
                    </button>
                  </div>
                </article>
              ))
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

const getGeminiWorktreeResumeKey = (worktree?: GeminiWorktreeConfig | null): string => {
  if (!worktree?.enabled) {
    return 'disabled'
  }
  return ['enabled', worktree.name || '', worktree.effectivePath || ''].join('\u0000')
}

const getLastGeminiRunForResume = (chat: ChatRecord): ChatRun | undefined => {
  const runs = [...(chat.runs || [])].reverse()
  return runs.find((candidate) => (candidate.provider || getChatProvider(chat)) === 'gemini')
}

const resolveGeminiResumeForRun = (
  chat: ChatRecord,
  requestedModel: string | undefined,
  approvalMode: string,
  worktree?: GeminiWorktreeConfig | null,
  geminiAuthProfileId?: string | null
): { sessionId?: string; skippedReason?: string } => {
  const sessionId = normalizeGeminiResumeTarget(chat.linkedGeminiSessionId)
  if (!sessionId) {
    return {}
  }

  if (approvalMode !== 'plan') {
    return {
      skippedReason:
        'Starting a fresh Gemini session because write-capable Gemini runs cannot safely resume CLI sessions; Gemini can persist plan-mode tool limits inside a resumed session.'
    }
  }

  const lastRun = getLastGeminiRunForResume(chat)
  if (!lastRun) {
    return { sessionId }
  }

  const previousAuthProfileId =
    typeof lastRun.geminiAuthProfileId === 'string' ? lastRun.geminiAuthProfileId : null
  const nextAuthProfileId = geminiAuthProfileId || null
  if (previousAuthProfileId !== nextAuthProfileId) {
    return {
      skippedReason:
        'Starting a fresh Gemini session because the selected Gemini auth profile changed.'
    }
  }

  const previousApprovalMode = lastRun.approvalMode || 'default'
  if (previousApprovalMode !== approvalMode) {
    return {
      skippedReason: `Starting a fresh Gemini session because approval mode changed from ${previousApprovalMode} to ${approvalMode}.`
    }
  }

  const previousModel = lastRun.requestedModel || lastRun.actualModel
  const previousModelKey = normalizeProviderModelKey(previousModel)
  const nextModelKey = normalizeProviderModelKey(requestedModel)
  if (previousModelKey && nextModelKey && previousModelKey !== nextModelKey) {
    return {
      skippedReason: `Starting a fresh Gemini session because model changed from ${previousModel} to ${requestedModel}.`
    }
  }

  const previousWorktreeKey = getGeminiWorktreeResumeKey(lastRun.geminiWorktree)
  const nextWorktreeKey = getGeminiWorktreeResumeKey(worktree)
  if (previousWorktreeKey !== nextWorktreeKey) {
    return {
      skippedReason: 'Starting a fresh Gemini session because the Gemini worktree setting changed.'
    }
  }

  return { sessionId }
}

const getCodexFiveHourLimit = (model: string): { max?: number; label: string } => {
  const normalized = model.toLowerCase()
  if (normalized.includes('spark')) return { label: 'separate dynamic limit' }
  if (normalized.includes('5.3') && normalized.includes('codex'))
    return { max: 3000, label: '30-3000 msgs / 5h' }
  if (normalized.includes('5.4-mini') || normalized.includes('mini'))
    return { max: 7000, label: '60-7000 msgs / 5h' }
  if (normalized.includes('5.4')) return { max: 2000, label: '20-2000 msgs / 5h' }
  if (normalized.includes('5.5')) return { max: 1600, label: '15-1600 msgs / 5h' }
  return { label: 'plan-dependent / 5h' }
}

const labelCodexRateLimitBucket = (snapshot: any, model: string): string => {
  const duration = Number(snapshot?.primary?.windowDurationMins || 0)
  const rawName = String(snapshot?.limitName || snapshot?.limitId || '').trim()
  const isSpark = /spark/i.test(rawName) || model.toLowerCase().includes('spark')

  if (duration >= 295 && duration <= 305) return isSpark ? 'Spark 5h' : '5h'
  if (duration >= 10020 && duration <= 10140) return isSpark ? 'Spark weekly' : 'Weekly'
  if (duration > 0 && duration < 120) return rawName || `${duration}m`
  return rawName || 'Codex quota'
}

const shouldShowCodexSparkWindows = (codexStatus?: any): boolean => {
  const planType = String(codexStatus?.codexUsage?.planType || codexStatus?.planType || '')
    .trim()
    .toLowerCase()
  if (!planType) return true
  return !/(^|[^a-z])(plus|go|free)([^a-z]|$)/.test(planType)
}

const isCodexSparkQuotaLabel = (label: string): boolean => /spark|gpt-5\.3-codex-spark/i.test(label)

const codexQuotaIdentityLabel = (label: string): string => {
  const normalized = label.toLowerCase()
  const spark = isCodexSparkQuotaLabel(label)
  const weekly = normalized.includes('weekly') || normalized.includes('7-day')
  if (spark && weekly) return 'spark-weekly'
  if (spark) return 'spark-5h'
  if (weekly) return 'weekly'
  return '5h'
}

const codexQuotaDisplayLabel = (label: string): string => {
  const identity = codexQuotaIdentityLabel(label)
  if (identity === 'spark-weekly') return 'Spark weekly'
  if (identity === 'spark-5h') return 'Spark 5h'
  if (identity === 'weekly') return 'Weekly'
  return '5h'
}

const codexQuotaDisplayOrder = (label: string): number => {
  const identity = codexQuotaIdentityLabel(label)
  if (identity === 'spark-weekly') return 3
  if (identity === 'spark-5h') return 2
  if (identity === 'weekly') return 1
  return 0
}

const dedupeCodexQuotaWindows = (windows: UsageWindowAggregate[]): UsageWindowAggregate[] => {
  const seen = new Set<string>()
  return windows.filter((windowEntry) => {
    const key = [
      codexQuotaIdentityLabel(windowEntry.label),
      windowEntry.resetAt || '',
      Math.round(Number(windowEntry.usedPercent || 0))
    ].join(':')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const buildRateLimitWindow = (
  id: string,
  label: string,
  snapshot: any
): UsageWindowAggregate | null => {
  const primary = snapshot?.primary
  if (!primary) return null
  const usedPercent = Math.max(0, Math.min(100, Number(primary.usedPercent || 0)))
  const remainingPercent = Math.max(0, Math.min(100, 100 - usedPercent))
  return {
    id,
    label,
    runs: 0,
    totalTokens: 0,
    limitLabel: `${Math.round(remainingPercent)}% remaining`,
    resetAt: primary.resetsAt ? new Date(primary.resetsAt * 1000).toISOString() : undefined,
    trackingOnly: true,
    // Honest names: usedPercent = USED, remainingPercent = REMAINING.
    // (Earlier this code stored `remainingPercent` in `usedPercent`
    // because the bar visualised "available capacity"; the L6
    // follow-up flips the bar to fill with USAGE and updates the
    // naming to match.)
    usedPercent,
    remainingPercent
  }
}

const buildCodexUsageWindows = (
  records: UsageRecord[],
  model: string,
  now: number,
  codexStatus?: any,
  showAuthoritativeWindows = true
): UsageWindowAggregate[] => {
  const authoritativeWindows = Array.isArray(codexStatus?.codexUsage?.windows)
    ? codexStatus.codexUsage.windows
    : []
  if (authoritativeWindows.length > 0) {
    if (!showAuthoritativeWindows) {
      return []
    }
    return dedupeCodexQuotaWindows(
      authoritativeWindows
        .map((windowEntry: any, index: number) => {
          const label = codexQuotaDisplayLabel(String(windowEntry.label || 'Codex quota'))
          const remainingPercent = Math.max(
            0,
            Math.min(
              100,
              Number(windowEntry.remainingPercent ?? 100 - Number(windowEntry.usedPercent || 0))
            )
          )
          const usedPercent = Math.max(0, Math.min(100, 100 - remainingPercent))
          return {
            id: `codex-account-${windowEntry.id || index}`,
            label,
            runs: 0,
            totalTokens: 0,
            limitLabel: windowEntry.limitLabel || `${Math.round(remainingPercent)}% remaining`,
            resetAt: windowEntry.resetAt,
            trackingOnly: false,
            // Honest names: usedPercent = USED, remainingPercent = REMAINING.
            usedPercent,
            remainingPercent
          }
        })
        .filter(
          (windowEntry) =>
            shouldShowCodexSparkWindows(codexStatus) || !isCodexSparkQuotaLabel(windowEntry.label)
        )
    ).sort((a, b) => {
      return codexQuotaDisplayOrder(a.label) - codexQuotaDisplayOrder(b.label)
    })
  }

  const rateLimitBuckets = [
    ...(codexStatus?.rateLimits ? [codexStatus.rateLimits] : []),
    ...(codexStatus?.rateLimitsByLimitId && typeof codexStatus.rateLimitsByLimitId === 'object'
      ? Object.values(codexStatus.rateLimitsByLimitId)
      : [])
  ]
  const realRateLimitWindows = dedupeCodexQuotaWindows(
    rateLimitBuckets
      .flatMap((bucket: any, index: number) => {
        const id = bucket?.limitId || bucket?.limitName || index
        const windows: Array<UsageWindowAggregate | null> = [
          buildRateLimitWindow(
            `account-${id}-primary`,
            labelCodexRateLimitBucket(bucket, model),
            bucket
          )
        ]
        if (bucket?.secondary) {
          const secondaryBucket = { ...bucket, primary: bucket.secondary }
          windows.push(
            buildRateLimitWindow(
              `account-${id}-secondary`,
              labelCodexRateLimitBucket(secondaryBucket, model),
              secondaryBucket
            )
          )
        }
        return windows
      })
      .filter(Boolean)
      .map((windowEntry: any) => ({
        ...windowEntry,
        label: codexQuotaDisplayLabel(windowEntry.label)
      }))
      .filter(
        (windowEntry: any) =>
          shouldShowCodexSparkWindows(codexStatus) || !isCodexSparkQuotaLabel(windowEntry.label)
      ) as UsageWindowAggregate[]
  )

  if (realRateLimitWindows.length > 0) {
    return realRateLimitWindows.sort((a, b) => {
      return codexQuotaDisplayOrder(a.label) - codexQuotaDisplayOrder(b.label)
    })
  }

  const fiveHourLimit = getCodexFiveHourLimit(model)
  const fiveHourRecords = records.filter(
    (record) => now - record.timestamp <= FIVE_HOURS_MS && record.usageKind !== 'reset_hint'
  )
  const weeklyRecords = records.filter(
    (record) => now - record.timestamp <= WEEK_MS && record.usageKind !== 'reset_hint'
  )
  const fiveHourReset =
    fiveHourRecords.length > 0
      ? new Date(
          Math.min(...fiveHourRecords.map((record) => record.timestamp + FIVE_HOURS_MS))
        ).toISOString()
      : undefined
  const weeklyReset =
    weeklyRecords.length > 0
      ? new Date(
          Math.min(...weeklyRecords.map((record) => record.timestamp + WEEK_MS))
        ).toISOString()
      : undefined

  return [
    ...realRateLimitWindows,
    {
      id: '5h',
      label: model.toLowerCase().includes('spark') ? 'Spark 5h' : '5h',
      runs: fiveHourRecords.length,
      totalTokens: fiveHourRecords.reduce((total, record) => total + (record.totalTokens || 0), 0),
      runLimitMax: fiveHourLimit.max,
      limitLabel: fiveHourLimit.label,
      resetAt: fiveHourReset,
      trackingOnly: !fiveHourLimit.max
    },
    {
      id: 'weekly',
      label: model.toLowerCase().includes('spark') ? 'Spark weekly' : 'Weekly',
      runs: weeklyRecords.length,
      totalTokens: weeklyRecords.reduce((total, record) => total + (record.totalTokens || 0), 0),
      limitLabel: model.toLowerCase().includes('spark')
        ? 'separate dynamic weekly cap'
        : 'weekly cap may apply',
      resetAt: weeklyReset,
      trackingOnly: true
    }
  ]
}

const createWorktreeDiffUnavailable = () => ({
  type: 'error',
  text: WORKTREE_DIFF_UNAVAILABLE_TEXT
})

const resolveGeminiWorktreeConfig = (
  workspace?: WorkspaceRecord | null
): GeminiWorktreeConfig | undefined => {
  const worktree = workspace?.geminiWorktree
  if (!worktree?.enabled) {
    return undefined
  }

  const name = typeof worktree.name === 'string' ? worktree.name.trim() : undefined
  const effectivePath =
    typeof worktree.effectivePath === 'string' ? worktree.effectivePath.trim() : undefined
  return {
    enabled: true,
    ...(name ? { name } : {}),
    ...(effectivePath ? { effectivePath } : {})
  }
}

const isGeminiWorktreeDiffUnavailable = (worktree?: GeminiWorktreeConfig | null): boolean =>
  Boolean(worktree?.enabled && !worktree.effectivePath)

const getDiffWorkspacePath = (
  workspace: WorkspaceRecord,
  worktree?: GeminiWorktreeConfig | null
): string => (worktree?.enabled && worktree.effectivePath ? worktree.effectivePath : workspace.path)

const createAppRunId = (): string => `${Date.now()}-${Math.random().toString(36).slice(2)}`

const isTerminalRunQueueStatus = (status?: RunQueueJobStatus): boolean =>
  status === 'completed' || status === 'failed' || status === 'cancelled'

type TranscriptPanelProps = {
  scrollRef: React.RefObject<HTMLDivElement | null>
  /**
   * Ref pinned to the SINGLE inner content div (`.transcript-inner`)
   * inside the scroll container. The App-level scroll effect attaches
   * one `ResizeObserver` to this node so ANY late-mount layout growth
   * (CodeMirror code blocks, `ActivityStack` rows revealing
   * tool-result output, shell-command stdout measuring, future
   * content types) triggers a coalesced rAF re-pin via the shared
   * `shouldRepinAfterTranscriptResize` gate. This is the
   * follow-up to a12f913 — that fix observed individual code blocks,
   * which missed Codex transcripts heavy with `Ran /bin/zsh -lc '...'`
   * activity rows. One observer on the content div catches them all
   * without per-component plumbing.
   */
  contentRef: React.RefObject<HTMLDivElement | null>
  endRef: React.RefObject<HTMLDivElement | null>
  messages: ChatMessage[]
  isWelcomeChat: boolean
  isThinking: boolean
  showFallbackUX: boolean
  pendingPlanChoice: PlanChoiceState | null
  runCompleteNotice: RunCompleteNotice | null
  runCompleteDurationText: string | null
  currentChat: ChatRecord | null
  currentWorkspacePath?: string
  currentProviderLabel: string
  displayFileChangeSummaries: DiffFileSummary[]
  fileChangeSummaryText: string
  fileChangeShouldShowStats: boolean
  fileChangeDisplayAdds: number
  fileChangeDisplayDels: number
  /** Phase I3.2 — all chats, so the inline delegation card can look up
   * the live sub-thread record by id and reflect its status. */
  chats: ChatRecord[]
  /** Phase I3.2 — chat ids currently running on the run-queue so the
   * delegation card and the chat-header ticker can show live state. */
  runningChatIds: string[]
  onPlanChoiceSubmit: (messageId: string, option: string) => void
  onRunFallback: (model: string) => void
  onOpenSubThread: (chatId: string) => void
  /** Phase K1B: when set, RunCard's "Inspect →" affordance enters Run
   * mode for the clicked run. Plumbed from App.tsx down. */
  onInspectRun?: (runId: string) => void
  /** Phase L3 slice 6 — `settings.compactDensity` plumbed through so
   * every `ActivityStack` inside the transcript renders in the same
   * density as the rest of the chat. */
  compactDensity: boolean
}

const TranscriptPanel = memo(
  function TranscriptPanel({
    scrollRef,
    contentRef,
    endRef,
    messages,
    isWelcomeChat,
    isThinking,
    showFallbackUX,
    pendingPlanChoice,
    runCompleteNotice,
    runCompleteDurationText,
    currentChat,
    currentWorkspacePath,
    currentProviderLabel,
    displayFileChangeSummaries,
    fileChangeSummaryText,
    fileChangeShouldShowStats,
    fileChangeDisplayAdds,
    fileChangeDisplayDels,
    chats,
    runningChatIds,
    onPlanChoiceSubmit,
    onRunFallback,
    onOpenSubThread,
    onInspectRun,
    compactDensity
  }: TranscriptPanelProps) {
    const visibleMessages = useMemo(
      () => (isWelcomeChat ? EMPTY_CHAT_MESSAGES : messages),
      [isWelcomeChat, messages]
    )
    const shouldShowRunCompleteNotice = Boolean(runCompleteNotice && !isWelcomeChat)
    const runBoundaryByMessageId = useMemo(() => {
      const runs = currentChat?.runs || []
      const runById = new Map<string, ChatRun>()
      const promptRunByMessageId = new Map<string, ChatRun>()
      for (const run of runs) {
        if (run.runId) runById.set(run.runId, run)
        if (run.promptMessageId) promptRunByMessageId.set(run.promptMessageId, run)
      }

      const boundaries = new Map<string, ChatRun>()
      let previousRunId: string | null = null
      for (const message of visibleMessages) {
        const run =
          (message.runId ? runById.get(message.runId) : undefined) ||
          promptRunByMessageId.get(message.id)
        if (!run?.runId) continue
        if (run.runId !== previousRunId) {
          boundaries.set(message.id, run)
        }
        previousRunId = run.runId
      }
      return boundaries
    }, [currentChat?.runs, visibleMessages])
    // Per-message expansion state for long user-message bubbles. Keyed by
    // message.id so toggling one brief does not collapse others. Default for
    // every long message is collapsed — see UserMessageCollapse for thresholds.
    const [expandedUserMessages, setExpandedUserMessages] = useState<Set<string>>(new Set())
    const toggleUserMessageExpanded = (id: string) => {
      setExpandedUserMessages((prev) => {
        const next = new Set(prev)
        if (next.has(id)) {
          next.delete(id)
        } else {
          next.add(id)
        }
        return next
      })
    }

    return (
      <div className="transcript-scroll" ref={scrollRef}>
        <div className="transcript-inner" ref={contentRef}>
          {visibleMessages.map((msg) => {
            const isDelegationCard = isSubThreadDelegationMessage(msg)
            const isReturnCard = isSubThreadReturnMessage(msg)
            const boundaryRun = runBoundaryByMessageId.get(msg.id)
            return (
              <div key={`message-block-${msg.id}`} className="transcript-message-block">
                {boundaryRun && (
                  <RunCard
                    run={boundaryRun}
                    fallbackProvider={getChatProvider(currentChat)}
                    onInspect={onInspectRun}
                  />
                )}
                {isDelegationCard || isReturnCard ? (
                  <div
                    key={msg.id}
                    className={`message-group ${
                      isReturnCard ? 'subthread-return-message' : ''
                    } ${isDelegationCard ? 'subthread-delegation-message' : ''}`}
                  >
                    {isDelegationCard ? (
                      <SubThreadDelegationCard
                        message={msg}
                        chats={chats}
                        runningChatIds={runningChatIds}
                        onOpenSubThread={onOpenSubThread}
                      />
                    ) : (
                      <SubThreadReturnCard
                        message={msg}
                        chat={currentChat || undefined}
                        onOpenSubThread={onOpenSubThread}
                      />
                    )}
                  </div>
                ) : msg.role === 'tool' ? (
                  <ActivityStack
                    key={msg.id}
                    activities={msg.toolActivities || []}
                    workspacePath={currentWorkspacePath}
                    provider={getChatProvider(currentChat)}
                    chatId={currentChat?.appChatId}
                    runId={msg.runId || boundaryRun?.runId}
                    chat={currentChat || undefined}
                    compactDensity={compactDensity}
                  />
                ) : (
                  <div
                    key={msg.id}
                    className={`message-group ${
                      isReturnCard ? 'subthread-return-message' : ''
                    } ${isDelegationCard ? 'subthread-delegation-message' : ''}`}
                  >
                    <div className="message-meta">
                      {msg.role === 'user'
                        ? 'You'
                        : msg.role === 'assistant'
                          ? currentProviderLabel
                          : msg.role === 'error'
                            ? 'Error'
                            : 'System'}
                    </div>
                    {msg.role === 'user' ? (
                      (() => {
                        // Long pasted briefs would otherwise dominate the scroll
                        // viewport. Collapse them by default and let the user
                        // expand inline with "Show more". Toggle state lives in
                        // `expandedUserMessages` so each bubble is independent.
                        const collapsible = shouldCollapseUserMessage(msg.content)
                        const isExpanded = expandedUserMessages.has(msg.id)
                        const showCollapsed = collapsible && !isExpanded
                        const preview = showCollapsed
                          ? truncateUserMessagePreview(msg.content)
                          : msg.content
                        return (
                          <div
                            className={`message-bubble user${
                              collapsible ? ' is-collapsible' : ''
                            }${showCollapsed ? ' is-collapsed' : ''}`}
                          >
                            <div className="user-message-content">{preview}</div>
                            {collapsible && (
                              <button
                                type="button"
                                className="user-message-toggle"
                                onClick={() => toggleUserMessageExpanded(msg.id)}
                                aria-expanded={isExpanded}
                                title={isExpanded ? 'Collapse message' : 'Show full message'}
                              >
                                {isExpanded ? 'Show less' : 'Show more'}
                              </button>
                            )}
                          </div>
                        )
                      })()
                    ) : (
                      <div className={`message-bubble ${msg.role}`}>
                        {msg.role === 'assistant' ? (
                          <MarkdownMessage content={msg.content} chat={currentChat || undefined} />
                        ) : (
                          msg.content
                        )}
                      </div>
                    )}
                    {pendingPlanChoice && pendingPlanChoice.messageId === msg.id && (
                      <div className="plan-choice-card">
                        <div className="plan-choice-question">{pendingPlanChoice.question}</div>
                        <div className="plan-choice-actions">
                          {pendingPlanChoice.options.map((option) => (
                            <button
                              key={option}
                              type="button"
                              className="plan-choice-action-btn"
                              onClick={() => onPlanChoiceSubmit(msg.id, option)}
                              title={`Continue with "${option}"`}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {isThinking && (
            <div key="thinking-indicator" className="message-group">
              <div className="message-meta">{currentProviderLabel}</div>
              <ThinkingIndicator />
            </div>
          )}
          {showFallbackUX && (
            <div className="fallback-card">
              <p>
                Gemini model capacity exhausted. The CLI was retrying. Try an alternative or wait.
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                <button className="btn btn-sm" onClick={() => onRunFallback('flash-lite')}>
                  Retry with Flash Lite
                </button>
                <button className="btn btn-sm" onClick={() => onRunFallback('flash')}>
                  Retry with Flash
                </button>
              </div>
            </div>
          )}
          {shouldShowRunCompleteNotice && runCompleteNotice && (
            <div className="run-complete-card">
              <div className="run-complete-main">
                <div className="run-complete-metadata">
                  <strong>
                    {runCompleteNotice.exitCode === 0
                      ? 'Task complete'
                      : `Task ended (code ${runCompleteNotice.exitCode})`}
                  </strong>
                  <span className="run-complete-time-row">
                    <span>
                      {new Date(runCompleteNotice.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                      })}
                    </span>
                    {runCompleteDurationText && <span>{runCompleteDurationText}</span>}
                  </span>
                  {runCompleteNotice.exitCode === 0 && <span>Awaiting your next prompt.</span>}
                </div>
                <button
                  className="btn btn-sm btn-ghost run-copy-btn"
                  onClick={() => {
                    const latestAssistantMessage = [...messages]
                      .slice()
                      .reverse()
                      .find((m) => m.role === 'assistant')
                    if (latestAssistantMessage?.content) {
                      navigator.clipboard.writeText(latestAssistantMessage.content)
                    }
                  }}
                  disabled={!messages.some((m) => m.role === 'assistant')}
                  title="Copy latest assistant response"
                >
                  <CopyResponseIcon />
                </button>
              </div>
              <div className="file-change-summary-card">
                <div className="file-change-summary-header">
                  <strong>File changes</strong>
                  <div className="file-change-summary-meta">
                    <span>{fileChangeSummaryText}</span>
                    {fileChangeShouldShowStats && (
                      <span className="file-change-summary-stats">
                        <span className="file-change-stat file-change-stat-add">
                          +{fileChangeDisplayAdds}
                        </span>
                        <span className="file-change-stat-divider">|</span>
                        <span className="file-change-stat file-change-stat-delete">
                          -{fileChangeDisplayDels}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="file-change-summary-list">
                  {displayFileChangeSummaries.length > 0 ? (
                    <>
                      {displayFileChangeSummaries.slice(0, 12).map((item) => (
                        <div
                          key={`${item.path}-${item.status}`}
                          className="file-change-summary-item"
                        >
                          <span className={`file-change-summary-status status-${item.status}`}>
                            {item.status === 'modified' ? 'edited' : item.status}
                          </span>
                          <FileTypeIcon
                            path={item.path}
                            size={14}
                            className="file-change-summary-type-icon"
                            workspacePath={currentWorkspacePath}
                          />
                          <span className="file-change-summary-path" title={item.path}>
                            {item.path}
                          </span>
                          {(item.additions !== undefined || item.deletions !== undefined) && (
                            <span className="file-change-summary-item-stats">
                              <span className="file-change-stat file-change-stat-add">
                                +{item.additions || 0}
                              </span>
                              <span className="file-change-stat-divider">|</span>
                              <span className="file-change-stat file-change-stat-delete">
                                -{item.deletions || 0}
                              </span>
                            </span>
                          )}
                        </div>
                      ))}
                      {displayFileChangeSummaries.length > 12 && (
                        <div className="file-change-summary-item file-change-summary-overflow">
                          +{displayFileChangeSummaries.length - 12} more files changed
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="file-change-summary-item file-change-summary-empty">
                      No file changes detected for this run.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>
    )
  },
  (previous, next) =>
    previous.scrollRef === next.scrollRef &&
    previous.contentRef === next.contentRef &&
    previous.endRef === next.endRef &&
    previous.messages === next.messages &&
    previous.isWelcomeChat === next.isWelcomeChat &&
    previous.isThinking === next.isThinking &&
    previous.showFallbackUX === next.showFallbackUX &&
    previous.pendingPlanChoice === next.pendingPlanChoice &&
    previous.runCompleteNotice === next.runCompleteNotice &&
    previous.runCompleteDurationText === next.runCompleteDurationText &&
    previous.currentChat === next.currentChat &&
    previous.currentWorkspacePath === next.currentWorkspacePath &&
    previous.currentProviderLabel === next.currentProviderLabel &&
    previous.displayFileChangeSummaries === next.displayFileChangeSummaries &&
    previous.fileChangeSummaryText === next.fileChangeSummaryText &&
    previous.fileChangeShouldShowStats === next.fileChangeShouldShowStats &&
    previous.fileChangeDisplayAdds === next.fileChangeDisplayAdds &&
    previous.fileChangeDisplayDels === next.fileChangeDisplayDels &&
    previous.chats === next.chats &&
    previous.runningChatIds === next.runningChatIds
)

type SettingsPanelUpdate = {
  mode?: AppSettings['appearanceMode']
  visualEffectStyle?: AppSettings['visualEffectStyle']
  themeAppearance?: AppSettings['themeAppearance']
  themeCornerStyle?: AppSettings['themeCornerStyle']
  themeAccentStyle?: AppSettings['themeAccentStyle']
  promptSurfaceStyle?: AppSettings['promptSurfaceStyle']
  composerStyle?: AppSettings['composerStyle']
  transcriptFontFamily?: AppSettings['transcriptFontFamily']
  composerFontFamily?: AppSettings['composerFontFamily']
  funFxEnabled?: boolean
  funFxMode?: AppSettings['funFxMode']
  advancedFx?: AppSettings['advancedFx']
  reduceTransparency?: boolean
  reduceMotion?: boolean
  compactDensity?: boolean
  geminiCheckpointingEnabled?: boolean
  // Phase M1 Step 6 — Gemini API vs CLI runtime selection. See
  // GeminiApiRuntimeMode in main/store/types.ts. Defaults to 'auto'.
  geminiApiRuntime?: GeminiApiRuntimeMode
  chatContextTurns?: number
  claudeBinaryPath?: string
  kimiBinaryPath?: string
  agenticServices?: AgenticServicesSettings
  autoResumeParentOnSubThreadCompletion?: boolean
  geminiMcpBridgeEnabled?: boolean
  codexSandboxFallback?: CodexSandboxFallbackMode
  updateChannel?: ProductUpdateChannel
  approvalTimeouts?: AppSettings['approvalTimeouts']
}

function App(): React.JSX.Element {
  const [, setSettings] = useState<AppSettings | null>(null)
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

  const [composerDraftsByChatId, setComposerDraftForChat] = usePerChatState('')
  const [isRunning, setIsRunning] = useState(false)
  const [queuedRuns, setQueuedRuns] = useState<QueuedRunRequest[]>([])
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
  const [updateChannel, setUpdateChannel] = useState<ProductUpdateChannel>('debug')
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
  const [showPairingSheet, setShowPairingSheet] = useState(false)
  // Phase F1: sub-thread creator modal state. Null when closed; holds
  // the parent chat when open so the modal knows what to delegate from.
  const [subThreadCreatorParent, setSubThreadCreatorParent] = useState<ChatRecord | null>(null)
  const [showWorkspaceSidebar, setShowWorkspaceSidebar] = useState(true)
  const [workspaceSidebarWidth, setWorkspaceSidebarWidth] = useState(getStoredWorkspaceSidebarWidth)
  const [showFileEditor, setShowFileEditor] = useState(false)
  const [showGeminiTerminal, setShowGeminiTerminal] = useState(false)
  const [geminiTerminalInputByChatId, setGeminiTerminalInputForChat] = usePerChatState('')
  const [geminiTerminalHeight, setGeminiTerminalHeight] = useState(DEFAULT_GEMINI_TERMINAL_HEIGHT)
  const [isChatMediaPanelOpen, setIsChatMediaPanelOpen] = useState(false)
  const [showGhostCompanion, setShowGhostCompanion] = useState(getStoredGhostCompanionEnabled)
  const [showSkyVisualFx, setShowSkyVisualFx] = useState(getStoredSkyVisualFxEnabled)
  const [hostWeather, setHostWeather] = useState<HostWeatherVisualState | null>(null)
  const [fxBurstClass, setFxBurstClass] = useState('')
  const [fileEditorWidth, setFileEditorWidth] = useState(getStoredFileEditorWidth)
  const [runCompleteNotice, setRunCompleteNotice] = useState<RunCompleteNotice | null>(null)
  const [chatContextNotice, setChatContextNotice] = useState<{
    id: string
    message: string
  } | null>(null)
  const [usageSummary, setUsageSummary] = useState<ModelUsageAggregate[]>([])
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([])
  const [welcomeUsageTab, setWelcomeUsageTab] = useState<WelcomeUsageTab>('overview')
  const saveChatTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const lastUsageWindowsByProviderRef = useRef<Record<ProviderId, UsageWindowAggregate[]>>({
    gemini: [],
    codex: [],
    claude: [],
    kimi: []
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
  const [isSendConfirming, setIsSendConfirming] = useState(false)
  const [createPrState, setCreatePrState] = useState<{
    status: 'idle' | 'pending' | 'success' | 'error'
    message?: string
  }>({ status: 'idle' })
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
  }
  const [attachedWindow, setAttachedWindow] = useState<AttachedWindowSnapshot | null>(null)
  const [isAttachingWindow, setIsAttachingWindow] = useState(false)
  const [pendingPlanChoiceByChatId, setPendingPlanChoiceForChat] =
    usePerChatState<PlanChoiceState | null>(null)
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
  const appTranscriptRef = useRef<HTMLDivElement>(null)
  const transcriptScrollRef = useRef<HTMLDivElement>(null)
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
  // Tracks whether the user has initiated a real upward scroll (wheel,
  // touchmove, page-up/arrow-up) since the last paint. The post-frame
  // re-pin in the messages-update layoutEffect is suppressed when this is
  // true, so a deliberate scroll-away is never fought by the rAF callback.
  // Cleared at the start of each layoutEffect pass.
  const userScrolledAwayInFrameRef = useRef(false)
  // Holds the rAF id for the pending post-frame re-pin so consecutive
  // streaming updates can coalesce into a single re-pin write per frame.
  const repinRafIdRef = useRef<number | null>(null)
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
  // Composer textarea + @-mention popover state. AgentMentionMenu reads the
  // anchor + query and inserts `[@Name](agent://uuid)` at the caret on select.
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  // Caret position of the `@` that opened the menu (so we know what to replace).
  const mentionAnchorIndexRef = useRef<number | null>(null)
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
  const hasWorkspaceContext = Boolean(currentWorkspace && currentChat && !isCurrentGlobalChat)
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
  const codexExternalPathGrants = useMemo(
    () =>
      currentProvider === 'codex' && !isCurrentGlobalChat
        ? normalizeExternalPathGrants(currentChat?.providerMetadata?.codexExternalPathGrants)
        : [],
    [currentChat?.providerMetadata?.codexExternalPathGrants, currentProvider, isCurrentGlobalChat]
  )
  const currentComposerChatId = currentChat?.appChatId || null
  const prompt = currentComposerChatId ? composerDraftsByChatId[currentComposerChatId] || '' : ''
  const imageAttachments = useMemo(
    () =>
      currentComposerChatId
        ? imageAttachmentsByChatId[currentComposerChatId] || EMPTY_IMAGE_ATTACHMENTS
        : EMPTY_IMAGE_ATTACHMENTS,
    [currentComposerChatId, imageAttachmentsByChatId]
  )
  const currentChatMediaRefs = useMemo(
    () => collectChatMediaRefs(currentChat, imageAttachments, codexExternalPathGrants),
    [currentChat, imageAttachments, codexExternalPathGrants]
  )
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
  const selectedRuntimeProfileId = currentComposerChatId
    ? selectedRuntimeProfileByChatId[currentComposerChatId] ||
      defaultRuntimeProfileIdForProvider(currentProvider)
    : defaultRuntimeProfileIdForProvider(currentProvider)
  const currentProviderRuntimeProfiles = runtimeProfiles.filter(
    (profile) => profile.provider === currentProvider
  )
  const setChatPromptDraft = (chatId: string | null | undefined, value: string) => {
    setComposerDraftForChat(chatId, value)
  }
  const setPrompt = (value: string) => {
    setChatPromptDraft(currentChatIdRef.current || currentComposerChatId, value)
  }
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

  const updateChatById = (
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
  }

  const getProviderModelOptions = (provider: ProviderId): CodexModelOption[] => {
    if (provider === 'codex') return codexModels
    if (provider === 'claude') return agentModelsByProvider.claude || CLAUDE_DEFAULT_MODELS
    if (provider === 'kimi') return KIMI_DEFAULT_MODELS
    if (provider === 'gemini') return GEMINI_DEFAULT_MODELS
    return []
  }

  const getDefaultModelForProvider = (provider: ProviderId): string => {
    if (provider === 'codex') return codexModels[0]?.id || CODEX_DEFAULT_MODEL
    if (provider === 'claude') return 'default'
    if (provider === 'kimi') return KIMI_DEFAULT_MODEL
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
    setUpdateChannel(s.updateChannel || 'debug')
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
            '[AGBench] Failed to create initial global chat for workspace-less first launch:',
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

  const handleSetAgenticWorkspaceGrant = async (service: AgenticServiceId, enabled: boolean) => {
    if (!currentWorkspace?.path || isCurrentGlobalChat) return
    const nextSettings = enabled
      ? await window.api.upsertAgenticWorkspaceGrant(
          currentProvider,
          currentWorkspace.path,
          service
        )
      : await window.api.removeAgenticWorkspaceGrant(
          currentProvider,
          currentWorkspace.path,
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

  const handleGeminiWorktreeToggle = async () => {
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
  }

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
    const updatedChat: ChatRecord = {
      ...currentChat,
      provider: 'codex',
      linkedProviderSessionId: threadId
    }
    setCurrentChat(updatedChat)
    setChats((prev) =>
      prev.map((chat) => (chat.appChatId === updatedChat.appChatId ? updatedChat : chat))
    )
    await window.api.saveChat(updatedChat)
    setRawLogs((prev) => [...prev, { type: 'info', content: `Linked Codex thread: ${threadId}` }])
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

  const refreshUsageSummary = async (
    _workspaceId?: string,
    _providerHint?: ProviderId,
    codexStatusHint?: any
  ) => {
    const now = Date.now()
    const effectiveCodexStatus = codexStatusHint ?? codexStatus

    const [geminiSnap, claudeSnap, kimiSnap, allUsageRecords] = await Promise.all([
      window.api.getAgentRateLimits('gemini').catch(() => null),
      window.api.getAgentRateLimits('claude').catch(() => null),
      window.api.getAgentRateLimits('kimi').catch(() => null),
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
        remainingPercent
      }
    }

    const buildQuotaAggregate = (
      provider: ProviderId,
      windows: UsageWindowAggregate[]
    ): ModelUsageAggregate => ({
      provider,
      model: 'usage limits',
      runs: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      durationMs: 0,
      windows
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
    if (geminiWindows.length > 0) {
      ordered.push(buildQuotaAggregate('gemini', geminiWindows))
    }

    // Codex — 5H + weekly + (Pro only) GPT-5.3-Codex-Spark windows, real quotas only
    const codexWindowsRaw = buildCodexUsageWindows(
      [],
      'usage limits',
      now,
      effectiveCodexStatus,
      true
    )
    const codexFresh = codexWindowsRaw.filter((w) => w.usedPercent !== undefined)
    const codexWindows = resolveWithCache('codex', codexFresh)
    if (codexWindows.length > 0) {
      ordered.push(buildQuotaAggregate('codex', codexWindows))
    }

    // Claude — 5H (Session), Weekly, (Max-gated) Sonnet Weekly, (Max20x) Opus Weekly
    const claudeFresh = (Array.isArray(claudeSnap?.windows) ? claudeSnap.windows : [])
      .map((w: any, i: number) => normalizeQuotaWindow('claude', w, `claude-quota-${i}`))
      .filter((w): w is UsageWindowAggregate => Boolean(w))
    const claudeWindows = resolveWithCache('claude', claudeFresh)
    if (claudeWindows.length > 0) {
      ordered.push(buildQuotaAggregate('claude', claudeWindows))
    }

    // Kimi — only 5H and Weekly
    const kimiAllowed = new Set(['5H', 'Weekly'])
    const kimiFresh = (Array.isArray(kimiSnap?.windows) ? kimiSnap.windows : [])
      .filter((w: any) => kimiAllowed.has(String(w?.label || '').trim()))
      .map((w: any, i: number) => normalizeQuotaWindow('kimi', w, `kimi-quota-${i}`))
      .filter((w): w is UsageWindowAggregate => Boolean(w))
    const kimiWindows = resolveWithCache('kimi', kimiFresh)
    if (kimiWindows.length > 0) {
      ordered.push(buildQuotaAggregate('kimi', kimiWindows))
    }

    const nextUsageSignature = JSON.stringify(
      ordered.map((entry) => ({
        provider: entry.provider,
        model: entry.model,
        windows: (entry.windows || []).map((windowEntry) => ({
          id: windowEntry.id,
          label: windowEntry.label,
          limitLabel: windowEntry.limitLabel,
          resetAt: windowEntry.resetAt || '',
          usedPercent: windowEntry.usedPercent ?? null,
          remainingPercent: windowEntry.remainingPercent ?? null
        }))
      }))
    )
    if (usageSummarySignatureRef.current !== nextUsageSignature) {
      usageSummarySignatureRef.current = nextUsageSignature
      setUsageSummary(ordered)
    }
  }

  // Keep a ref to the *latest* `refreshUsageSummary` closure so the
  // autonomous polling effect (below) doesn't need to depend on `codexStatus`
  // and tear the timer down on every status mutation.
  refreshUsageSummaryRef.current = refreshUsageSummary

  const handleSelectWorkspace = async () => {
    const ws = await window.api.selectWorkspace()
    if (ws) {
      setWorkspaces(await window.api.getWorkspaces())
      handleSelectExistingWorkspace(ws)
    }
  }

  const handleRemoveWorkspace = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
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
      ...source,
      archived: nextArchived
    }))
  }

  /**
   * Permanently delete a chat. Uses the existing `deleteChat` IPC; the
   * main store cascades sub-thread deletion. Drop the chat from our
   * local list immediately for snappy feedback, then refresh from
   * source-of-truth (if the IPC fails the next refresh restores it).
   */
  const handleDeleteChat = async (chatId: string) => {
    if (!chatId) return
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
    const newChat = await window.api.createGlobalChat()
    const allChats = await window.api.getChats()
    setChats(allChats)
    await selectGlobalChat(newChat)
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
    setImageAttachments([])
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
      }
    } finally {
      setIsAttachingWindow(false)
    }
  }

  const handleDetachWindow = async () => {
    setAttachedWindow(null)
    try {
      await window.api.attachWindowDetach()
    } catch {
      // Optimistic clear — main has already received the request, daemon
      // detach is best-effort.
    }
  }

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

  const updateCodexExternalPathGrants = (nextGrants: ExternalPathGrant[]) => {
    if (!currentChat) return
    const normalized = normalizeExternalPathGrants(nextGrants).map((grant) => ({
      ...grant,
      workspaceId: currentWorkspace?.id || grant.workspaceId,
      chatId: currentChat.appChatId
    }))
    const updatedChat = {
      ...currentChat,
      providerMetadata: {
        ...(currentChat.providerMetadata || {}),
        codexExternalPathGrants: normalized
      },
      updatedAt: Date.now()
    }
    setCurrentChat(updatedChat)
    setChats((prev) =>
      prev.map((chat) => (chat.appChatId === updatedChat.appChatId ? updatedChat : chat))
    )
    window.api.saveChat(updatedChat)
  }

  const handlePickExternalPathGrant = async (access: 'read' | 'write') => {
    // Composer-unification (Phase J1): the External Path picker is now
    // cross-provider. Codex still routes the grant through its existing
    // sandbox-policy translator; Gemini / Claude / Kimi route the same
    // grant into a `--add-dir <path>` CLI flag (see
    // `externalPathGrantsToCliAddDirArgs` in main). The picker no
    // longer hard-restricts to `currentProvider === 'codex'`.
    if (
      !currentChat ||
      !currentWorkspace ||
      typeof window.api.selectExternalPathGrant !== 'function'
    ) {
      return
    }
    const grant = await window.api.selectExternalPathGrant(access, currentProvider)
    if (!grant) return
    const nextGrant: ExternalPathGrant = {
      ...grant,
      workspaceId: currentWorkspace.id,
      chatId: currentChat.appChatId
    }
    updateCodexExternalPathGrants([...codexExternalPathGrants, nextGrant])
    setRawLogs((prev) => [
      ...prev,
      {
        type: 'info',
        content: `Granted ${currentProviderLabel} ${access} access to external ${nextGrant.kind}: ${nextGrant.path}`
      }
    ])
  }

  const handleRemoveExternalPathGrant = (id: string) => {
    updateCodexExternalPathGrants(codexExternalPathGrants.filter((grant) => grant.id !== id))
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
    setRunCompleteNotice(null)
    setRawLogs(rawLogsByChatIdRef.current.get(chat.appChatId) || [])
    hydrateThreadRawLogsFromEvents(chat.appChatId)
    setShowFallbackUX(false)
    setIsThinking(runningChatIds.has(chat.appChatId))
  }

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
  // Current design — no ResizeObservers in the transcript path:
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
  useEffect(() => {
    const scroller = transcriptScrollRef.current
    if (!scroller) return

    let rafId: number | null = null
    const evaluate = () => {
      rafId = null
      const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
      // Hysteresis: user must be essentially at the bottom to opt back
      // into auto-follow, but a single meaningful upward scroll
      // immediately disengages so a slow scroll-up from one stream tick
      // doesn't fight the user trying to read. Thresholds in
      // `lib/TranscriptScroll`.
      if (shouldEngageAutoFollow(distanceFromBottom)) {
        autoFollowRef.current = true
        // Once the user lands at the bottom again we forget any
        // previously-recorded scroll-away so the next stream tick can
        // re-pin without delay.
        userScrolledAwayInFrameRef.current = false
      } else if (shouldDisengageAutoFollow(distanceFromBottom)) {
        autoFollowRef.current = false
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
  }, [])

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
      const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
      // Only react when there's actually somewhere up to scroll. At the
      // very top (distance ≈ scrollHeight) the wheel event is a no-op
      // and should not change auto-follow state.
      if (distanceFromBottom > 0) {
        userScrolledAwayInFrameRef.current = true
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
  }, [])

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
  }, [])

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
  }, [])

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
    if (!autoFollowRef.current) return
    const scroller = transcriptScrollRef.current
    if (!scroller) return
    // Clear the per-frame scroll-away flag at the start of each pass.
    // Wheel/touch/key listeners may set it again before the rAF fires.
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
  }, [currentChat?.messages, runCompleteNotice, showFallbackUX])

  useEffect(() => {
    // When the active chat changes, snap to the bottom and re-arm auto-follow
    // so the user lands on the latest message in their new thread.
    const scroller = transcriptScrollRef.current
    if (!scroller) return
    autoFollowRef.current = true
    userScrolledAwayInFrameRef.current = false
    // Defer one frame so the new messages render before we measure.
    const rafId = requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight
    })
    return () => cancelAnimationFrame(rafId)
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
      for (const ctx of activeRunsRef.current.values()) {
        if (ctx.chatId === chatId) {
          preserve = true
          break
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
              id: Date.now().toString(),
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
        }
        updated.runs = runs

        const completedAt = new Date().toISOString()
        if (exitCode === 0) {
          if (isVisibleCompletedRun()) {
            setRunCompleteNotice({
              timestamp: completedAt,
              exitCode,
              startedAt: targetRun?.startedAt || completedRunStartedAt || undefined
            })
          }
        }
        if (exitCode !== 0) {
          const msgs = [
            ...updated.messages,
            {
              id: Date.now().toString(),
              role: 'system',
              content: 'Task ended before completing. Check Raw Events for details.',
              timestamp: completedAt
            }
          ] as ChatMessage[]
          updated.messages = msgs
        }
        return updated
      })

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
        handlers.setPendingAgentApprovalForChat(targetChatId, request)
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
        handlers.setPendingAgentApprovalByChatId((prev) => {
          let matched = false
          const next: Record<string, AgentApprovalRequest | null> = {}
          for (const [chatId, request] of Object.entries(prev)) {
            if (request && request.id === timeout.approvalId) {
              matched = true
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
          if (!matched) {
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
          if (
            mergedMessages.length !== chat.messages.length ||
            orphanedLiveAssistants.length > 0 ||
            mergedMessages.some((m, i) => m !== chat.messages[i])
          ) {
            merged = {
              ...chat,
              messages:
                orphanedLiveAssistants.length > 0
                  ? [...mergedMessages, ...orphanedLiveAssistants]
                  : mergedMessages
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

    return () => {
      window.api.removeListeners()
      yoloUnsubscribe?.()
    }
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
      ? ` A process with PID ${record.process.pid}${record.process.command ? ` (${record.process.command})` : ''} may still be running outside AGBench.`
      : record.process
        ? ` No live process was found for the recorded PID ${record.process.pid}.`
        : ''
    return `Recovered interrupted ${providerLabel} run after app restart. ${record.reason} AGBench marked the run as ${record.recoveredStatus}.${processText} ${record.resumeHint}`
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

  const buildRunRequest = (overrideModel?: string, existingPrompt?: string): QueuedRunRequest => {
    const selectedChat =
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
    const externalPathGrants =
      provider === 'codex' && scope !== 'global'
        ? normalizeExternalPathGrants(selectedChat?.providerMetadata?.codexExternalPathGrants)
        : []

    return {
      appRunId: createAppRunId(),
      scope,
      provider,
      prompt: existingPrompt || prompt,
      overrideModel,
      existingPrompt,
      selectedModelType: requestModel,
      customModel: requestCustomModel,
      approvalMode: requestApprovalMode,
      sessionTrust,
      imageAttachments,
      externalPathGrants,
      geminiWorktree:
        scope === 'global' ? undefined : resolveGeminiWorktreeConfig(selectedWorkspace),
      codexReasoningEffort: requestReasoningEffort,
      codexServiceTier: requestServiceTier,
      claudeReasoningEffort: requestClaudeReasoningEffort,
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
            id: `queued-${queuedRequest.appRunId || Date.now()}`,
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
      // Per-chat busy check: only queue when THIS chat has an active
      // run. Multiple chats can dispatch in parallel to the same
      // provider — the underlying runner (Codex app-server thread,
      // fresh CLI process for Gemini/Kimi, independent SDK call for
      // Claude) handles concurrency per-chat.
      if (isChatBusy(runChat.appChatId)) {
        queueRunRequest(
          request,
          `This ${getProviderLabel(runProvider)} chat already has an in-flight run; AGBench will dispatch this turn when the chat's previous turn finishes.`
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
              id: Date.now().toString(),
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
        const userMessage: ChatMessage = {
          id: Date.now().toString(),
          role: 'user',
          content: displayFinalPrompt,
          timestamp: runStartedAt
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
              setRunCompleteNotice({
                timestamp: new Date().toISOString(),
                exitCode,
                startedAt: runContext.startedAt || undefined
              })
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
            const last = updated.messages[updated.messages.length - 1]
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
              updated.messages = [
                ...updated.messages.slice(0, -1),
                {
                  ...last,
                  content: last.content + separator + event.content,
                  metadata: nextMetadata
                }
              ]
            } else {
              const metadata = incomingItemIdStr ? { codexItemId: incomingItemIdStr } : undefined
              updated.messages = [
                ...updated.messages,
                {
                  id: Date.now().toString(),
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
            const assistantMessageId = last && last.role === 'assistant' ? last.id : `${Date.now()}`

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

            const usageRecordPromises = runUsageEntries.map((usageEntry) => {
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
                  id: Date.now().toString(),
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
                id: Date.now().toString(),
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
              id: Date.now().toString(),
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
              id: Date.now().toString(),
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
          currentProvider === 'codex' && Boolean(currentChat?.linkedProviderSessionId),
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

  const handleRun = (overrideModel?: string, existingPrompt?: string) => {
    const request = buildRunRequest(overrideModel, existingPrompt)
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
              id: `steered-${request.appRunId || Date.now()}`,
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
      kimiThinkingEnabled: request.kimiThinkingEnabled,
      runtimeProfileId: request.runtimeProfileId,
      geminiAuthProfileId: request.geminiAuthProfileId,
      handoffSourceRunId: request.handoffSourceRunId,
      runAt: runAtDate.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
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
    const chat = lane.chatId
      ? chatByIdRef.current.get(lane.chatId) ||
        chats.find((item) => item.appChatId === lane.chatId) ||
        null
      : null
    const run = chat?.runs?.find((item) => item.runId === lane.runId) || null
    const prompt = run
      ? chat?.messages.find((message) => message.id === run.promptMessageId)?.content ||
        [...(chat?.messages || [])].reverse().find((message) => message.role === 'user')?.content ||
        lane.promptPreview ||
        ''
      : lane.promptPreview || ''
    return { chat, run, prompt }
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
        provider === 'codex'
          ? normalizeExternalPathGrants(chat.providerMetadata?.codexExternalPathGrants)
          : [],
      geminiWorktree:
        getChatScope(chat) === 'global'
          ? undefined
          : resolveGeminiWorktreeConfig(workspace || null),
      codexReasoningEffort: selection.codexReasoningEffort,
      codexServiceTier: selection.codexServiceTier,
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
      `Prior request: ${sourcePrompt}`,
      latestAssistantMessage?.content
        ? `Latest assistant summary:\n${latestAssistantMessage.content}`
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
      const chat = await window.api.getChat(task.chatId)
      if (!workspace || !chat) {
        await window.api.updateScheduledTask(task.id, {
          status: 'failed',
          lastError: 'Workspace or chat could not be loaded.'
        })
        setScheduledTasks(await window.api.getScheduledTasks(currentWorkspace?.id))
        return
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
          { id: `${Date.now()}-bridge-user`, role: 'user', content: commandText, timestamp },
          {
            id: `${Date.now()}-bridge-system`,
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
    if (currentProvider === 'codex') {
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
        if (codexSupportsFast) {
          const nextTier = codexServiceTier === 'fast' ? '' : 'fast'
          setCodexServiceTier(nextTier)
          rememberCurrentChatComposerSelection({ codexServiceTier: nextTier })
        }
      } else if (item.command === '/fork') {
        const threadId = currentChat?.linkedProviderSessionId
        if (threadId) {
          void handleForkCodexThread(threadId)
        } else {
          setRightTab('capabilities')
          void refreshCodexThreads()
        }
      }
      return
    }
    if (currentProvider === 'claude' || currentProvider === 'kimi') {
      if (item.command === '/status' || item.command === '/permissions') {
        void refreshProviderMetadata(currentProvider)
        setRightTab('safety')
      } else if (item.command === '/model') {
        void refreshProviderMetadata(currentProvider)
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
  const consumeSlashTokenFromPrompt = (): void => {
    const anchor = slashAnchorIndexRef.current
    if (anchor === null) return
    const tokenLength = 1 + slashQuery.length // `/` + query chars
    const before = prompt.slice(0, anchor)
    const after = prompt.slice(anchor + tokenLength)
    const next = `${before}${after}`
    setPrompt(next)
    requestAnimationFrame(() => {
      const ta = composerTextareaRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(before.length, before.length)
    })
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
          // eslint-disable-next-line no-case-declarations
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
          // eslint-disable-next-line no-case-declarations
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
      'Open Gemini /restore in the persistent session? This only opens Gemini CLI restore selection; restore is not executed by GUIGemini.'
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

  const handlePlanChoiceSubmit = (messageId: string, option: string) => {
    if (!currentWorkspace || !currentChat || !option.trim()) return

    setCurrentChat((prev) => {
      if (!prev) return prev
      const nextMessage: ChatMessage = {
        id: Date.now().toString(),
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
    try {
      await window.api.respondAgentApproval(requestId, action)
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
      setPendingAgentApproval((prev) => (prev?.id === requestId ? null : prev))
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
        statusReason: 'Dequeued by AGBench scheduler.'
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
      window.localStorage.setItem('guiGemini.fileEditorWidth', String(fileEditorWidth))
    } catch {
      // Local persistence is best-effort only.
    }
  }, [fileEditorWidth])

  useEffect(() => {
    try {
      window.localStorage.setItem('guiGemini.workspaceSidebarWidth', String(workspaceSidebarWidth))
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

  const keyboardActionsRef = useRef({
    clearImagePermissions,
    handleRun,
    rememberCurrentChatComposerSelection,
    setCommandPaletteQuery,
    setIsCommandPaletteOpen,
    syncPersistentModelSelection
  })
  keyboardActionsRef.current = {
    clearImagePermissions,
    handleRun,
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
      const hasModifier = event.metaKey || event.ctrlKey

      if (event.key === 'Escape') {
        if (isCommandPaletteOpen) {
          event.preventDefault()
          keyboardActions.setIsCommandPaletteOpen(false)
          keyboardActions.setCommandPaletteQuery('')
          return
        }
        if (showSettings) {
          event.preventDefault()
          setShowSettings(false)
          return
        }
        if (permissionRequestPaths.length > 0) {
          event.preventDefault()
          keyboardActions.clearImagePermissions()
          return
        }
        if (selectedModelType === 'custom') {
          event.preventDefault()
          setCustomModel('')
          setSelectedModelType(lastNonCustomModelType)
          keyboardActions.rememberCurrentChatComposerSelection({
            customModel: '',
            selectedModelType: lastNonCustomModelType
          })
          if (currentProvider === 'gemini') {
            keyboardActions.syncPersistentModelSelection(lastNonCustomModelType)
          }
          return
        }
      }

      if (hasModifier && event.key === 'Enter') {
        event.preventDefault()
        keyboardActions.handleRun()
        return
      }

      if (!hasModifier) {
        return
      }

      const shortcutKey = event.key.toLowerCase()
      if (shortcutKey === 'k') {
        event.preventDefault()
        keyboardActions.setIsCommandPaletteOpen(true)
        return
      }

      if (isEditableTarget) {
        return
      }

      if (shortcutKey === 'b') {
        event.preventDefault()
        setShowWorkspaceSidebar((current) => !current)
      } else if (shortcutKey === 'i') {
        event.preventDefault()
        const nextShowInspector = !appearance.showInspector
        if (nextShowInspector && window.innerWidth <= 1180) {
          setShowFileEditor(false)
        }
        appearance.update({ showInspector: nextShowInspector })
      } else if (shortcutKey === 'e') {
        event.preventDefault()
        setShowFileEditor((current) => {
          const nextShowFileEditor = !current
          if (nextShowFileEditor && window.innerWidth <= 1180 && appearance.showInspector) {
            appearance.update({ showInspector: false })
          }
          return nextShowFileEditor
        })
      }
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
    showSettings
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
  const runningChatIdsArray = useMemo(
    () =>
      visibleRunningChatIds(
        runningChatIds,
        pendingAgentApprovalByChatId,
        chatsByAppChatIdForRunning
      ),
    [runningChatIds, pendingAgentApprovalByChatId, chatsByAppChatIdForRunning]
  )
  const isCurrentChatRunning = Boolean(
    currentChat?.appChatId && runningChatIds.has(currentChat.appChatId)
  )
  const isCurrentComposerLocked = isCurrentChatRunning
  // Phase J3 (steer): the composer Steer button is visible while the
  // current chat has an in-flight run. `isChatBusy` is the per-chat
  // busy predicate already used by every queue-decision site.
  const isCurrentChatBusyForSteer = Boolean(
    currentChat?.appChatId && isChatBusy(currentChat.appChatId)
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
  const currentRun = currentChat?.runs?.[currentChat.runs.length - 1]
  const cumulativeChatTokens = (currentChat?.runs || []).reduce((sum, run) => {
    const counts = extractUsageCountsFromCandidate(run?.stats)
    return sum + (counts.totalTokens || 0)
  }, 0)
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
  const latestRunDiffStats = useMemo(() => {
    // Prefer a live aggregate from tool activities on the current run so the
    // above-composer bar updates mid-task rather than only after runDiff lands.
    const runId = currentRun?.runId
    if (currentChat && runId) {
      let liveAdditions = 0
      let liveDeletions = 0
      const liveFiles = new Set<string>()
      let hasAnyDiff = false
      for (const message of currentChat.messages || []) {
        if (message.runId && message.runId !== runId) continue
        for (const activity of message.toolActivities || []) {
          const diff = activity.diffSummary
          if (!diff) continue
          if (typeof diff.additions === 'number') liveAdditions += diff.additions
          if (typeof diff.deletions === 'number') liveDeletions += diff.deletions
          for (const file of diff.files || []) {
            if (file?.path) liveFiles.add(file.path)
          }
          hasAnyDiff = true
        }
      }
      if (hasAnyDiff) {
        return { additions: liveAdditions, deletions: liveDeletions, filesChanged: liveFiles.size }
      }
    }
    // Fallback: completed-run snapshot from main-process diff state
    const files: DiffFileSummary[] = Array.isArray(runDiff) ? runDiff : []
    let additions = 0
    let deletions = 0
    for (const file of files) {
      additions += Number(file?.additions || 0)
      deletions += Number(file?.deletions || 0)
    }
    return {
      additions,
      deletions,
      filesChanged: files.length
    }
  }, [currentChat, currentRun?.runId, runDiff])
  const currentProviderLabel = getProviderLabel(currentProvider)
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
  const appAgentAuraClass = showAgentAuraFx
    ? `fx-agent-aura-root fx-provider-${currentProvider} fx-status-${runFxStatus} fx-intensity-${advancedFxIntensity}`
    : ''
  const composerAgentAuraClass = showAgentAuraFx
    ? `fx-agent-aura fx-provider-${currentProvider} fx-status-${runFxStatus} fx-intensity-${advancedFxIntensity}`
    : ''
  const providerSessionLabel = currentChat?.linkedProviderSessionId
    ? `${currentProviderLabel} session linked`
    : currentProvider === 'codex'
      ? 'New Codex thread'
      : `New ${currentProviderLabel} session`
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
  const claudeUsesApiKey = Boolean(claudeAuthStatus?.apiKeyConfigured)
  const claudeRuntimeLabel = claudeUsesApiKey ? 'Claude API / PAYG' : 'Claude SDK credit'
  const claudeRuntimeNotice = claudeUsesApiKey
    ? CLAUDE_API_KEY_PAYG_NOTICE
    : CLAUDE_AGENT_SDK_CREDIT_NOTICE
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
  const welcomeUsageDashboardData = useMemo(
    () => buildWelcomeUsageDashboardData(usageRecords, chats, 'all'),
    [usageRecords, chats]
  )
  const shouldShowWelcomeUsageDashboard = isWelcomeChat && welcomeUsageDashboardData.hasActivity
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
    workspaceName: isCurrentGlobalChat ? 'Chats' : currentWorkspace?.displayName || 'GUIGemini',
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

  const handleCreateGithubPr = async () => {
    if (createPrState.status === 'pending') return
    const workspacePath = currentWorkspace?.path
    if (!workspacePath) {
      setCreatePrState({ status: 'error', message: 'Open a workspace to create a PR.' })
      window.setTimeout(() => setCreatePrState({ status: 'idle' }), 5000)
      return
    }
    if (typeof window.api.createGithubPr !== 'function') {
      setRightTab('diff')
      return
    }
    setCreatePrState({ status: 'pending' })
    try {
      const result = await window.api.createGithubPr({ workspacePath, openInBrowser: true })
      if (result?.ok) {
        setCreatePrState({
          status: 'success',
          message: result.url ? `Opened ${result.url}` : 'Pull request created.'
        })
      } else {
        setCreatePrState({
          status: 'error',
          message: result?.error || 'Failed to create pull request.'
        })
      }
    } catch (error) {
      setCreatePrState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to create pull request.'
      })
    }
    window.setTimeout(() => setCreatePrState({ status: 'idle' }), 6000)
  }

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
  // Slash-picker registry: same per-provider palette items the Cmd-K
  // palette consumes, wrapped as palette-passthrough ComposerSlashCommands
  // so the new picker's dispatch routes back through handlePaletteCommand.
  // L4+ layers will extend `extraCommands` with action / prompt-template /
  // gemini-pty entries that don't fit the legacy palette shape.
  const composerSlashCommands: ComposerSlashCommand[] = buildComposerSlashCommandRegistry({
    provider: currentProvider,
    paletteItems: commandPaletteItems
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
  const appMainStyle = showWorkspaceSidebar
    ? ({ '--sidebar-width': `${workspaceSidebarWidth}px` } as CSSProperties)
    : undefined
  const interfaceStyle = appearance.composerStyle
  const providerShellEnabled = interfaceStyle === 'codex' || interfaceStyle === 'claude'
  const providerShellClass = providerShellEnabled
    ? `provider-shell provider-shell-${interfaceStyle}`
    : 'provider-shell-default'
  const providerShellCapabilityChips = providerShellEnabled
    ? [
        {
          id: 'native-session',
          label: currentProvider === 'gemini' ? 'AGBench bridge' : 'Native session'
        },
        { id: 'workspace-write', label: permissionModeLabel },
        {
          id: 'approval-policy',
          label:
            currentProvider === 'claude'
              ? 'Provider approvals'
              : currentProvider === 'gemini'
                ? 'AGBench approvals'
                : 'AGBench approvals'
        },
        { id: 'audit', label: 'AGBench audit' },
        ...(usageSummary ? [{ id: 'usage', label: 'Usage metered' }] : [])
      ]
    : []

  return (
    <div className={`app-root ${fxBurstClass} ${appAgentAuraClass} ${providerShellClass}`}>
      <div className="window-drag-strip" aria-hidden />
      <div
        className={`app-main ${isChatExpanded ? 'chat-expanded' : ''} ${providerShellClass}`}
        style={appMainStyle}
      >
        {showWorkspaceSidebar && (
          <>
            <Sidebar
              workspaces={workspaces}
              currentWorkspace={currentWorkspace}
              chats={chats}
              currentChat={currentChat}
              currentRun={currentRun}
              usageSummary={usageSummary}
              runningChatIds={runningChatIdsArray}
              onSelectWorkspace={handleSelectExistingWorkspace}
              onRemoveWorkspace={handleRemoveWorkspace}
              onSelectWorkspaceDialog={handleSelectWorkspace}
              onNewChat={handleNewChat}
              onNewGlobalChat={handleNewGlobalChat}
              onSelectChat={handleSelectChat}
              onOpenSettings={() => setShowSettings(true)}
              onCreateSubThread={(parent) => setSubThreadCreatorParent(parent)}
              onTogglePinChat={handleTogglePinChat}
              onTogglePinWorkspace={handleTogglePinWorkspace}
              onToggleArchiveChat={handleToggleArchiveChat}
              onDeleteChat={handleDeleteChat}
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
              onShowPairingSheet={() => setShowPairingSheet(true)}
            />
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

        <div
          ref={appTranscriptRef}
          className={`app-transcript provider-${currentProvider} interface-${interfaceStyle} ${isWelcomeChat ? 'welcome-mode' : ''} ${showGeminiTerminal && currentProvider === 'gemini' ? 'gemini-terminal-open' : ''} ${isAdvancedFxActive ? `fx-labs-active fx-intensity-${advancedFxIntensity}` : ''}`}
          style={
            showGeminiTerminal && currentProvider === 'gemini'
              ? ({ '--gemini-terminal-height': `${geminiTerminalHeight}px` } as CSSProperties)
              : undefined
          }
        >
          {chatContextNotice && (
            <div className="chat-context-application-pill" role="status">
              <span>{chatContextNotice.message}</span>
            </div>
          )}
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
          </div>

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

          <ChatMediaFloatingPanel
            open={isChatMediaPanelOpen}
            refs={currentChatMediaRefs}
            workspacePath={currentWorkspace?.path}
            onClose={() => setIsChatMediaPanelOpen(false)}
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

          <SubThreadStatusTicker
            currentChat={currentChat}
            chats={chats}
            runningChatIds={runningChatIdsArray}
            onOpenSubThread={handleOpenCockpitThread}
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
            <TranscriptPanel
              key={currentChat?.appChatId || 'no-chat'}
              scrollRef={transcriptScrollRef}
              contentRef={transcriptContentRef}
              endRef={logsEndRef}
              messages={transcriptMessages}
              isWelcomeChat={isWelcomeChat}
              isThinking={isThinking}
              showFallbackUX={showFallbackUX}
              pendingPlanChoice={pendingPlanChoice}
              runCompleteNotice={runCompleteNotice}
              runCompleteDurationText={runCompleteDurationText}
              currentChat={currentChat}
              currentWorkspacePath={currentWorkspace?.path}
              currentProviderLabel={currentProviderLabel}
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
              onInspectRun={(runId) => setInspectingRunId(runId)}
              compactDensity={appearance.compactDensity}
            />
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

          {shouldShowWelcomeUsageDashboard && (
            <div className="welcome-usage-region">
              <WelcomeUsageDashboard
                data={welcomeUsageDashboardData}
                tab={welcomeUsageTab}
                onTabChange={setWelcomeUsageTab}
              />
            </div>
          )}

          <div className={`composer-area interface-${interfaceStyle}`} ref={composerAreaRef}>
            {shouldShowGhostCompanion && <GhostCompanion />}
            {providerShellEnabled && (
              <div
                className={`provider-shell-status-row style-${interfaceStyle}`}
                aria-label={`${currentProviderLabel} shell capabilities`}
              >
                <span className="provider-shell-status-provider">{currentProviderLabel}</span>
                {providerShellCapabilityChips.map((chip) => (
                  <span key={chip.id} className={`provider-shell-status-chip chip-${chip.id}`}>
                    {chip.label}
                  </span>
                ))}
              </div>
            )}
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
                externalPathGrants={codexExternalPathGrants}
                onPickExternalPathGrant={(access) => void handlePickExternalPathGrant(access)}
                agenticServices={agenticServices}
                agenticWorkspaceGrants={agenticWorkspaceGrants}
                onSetWorkspaceGrant={(service, enabled) =>
                  void handleSetAgenticWorkspaceGrant(service, enabled)
                }
                currentGeminiWorktree={currentGeminiWorktree}
                onGeminiWorktreeToggle={() => void handleGeminiWorktreeToggle()}
                worktreeToggleLabel={worktreeToggleLabel}
                worktreeDiffUnavailable={currentWorktreeDiffUnavailable}
              />
            )}
            {isWelcomeChat && (
              <div className="welcome-hero">
                <h1>
                  <span>{welcomeCopy.heading.beforeWorkspace}</span>
                  <strong>{welcomeCopy.heading.workspaceName}</strong>
                  <span>{welcomeCopy.heading.afterWorkspace}</span>
                </h1>
                <p>{welcomeCopy.subheading}</p>
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
            {!isWelcomeChat && !isCurrentGlobalChat && currentWorkspace && (
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
                  <span>{currentWorkspace?.branch || 'detached'}</span>
                </span>
                {latestRunDiffStats.filesChanged > 0 && (
                  <span className="composer-above-bar-files">
                    <strong>{latestRunDiffStats.filesChanged}</strong>{' '}
                    {latestRunDiffStats.filesChanged === 1 ? 'file' : 'files'}
                  </span>
                )}
                {(latestRunDiffStats.additions > 0 || latestRunDiffStats.deletions > 0) && (
                  <span className="composer-above-bar-stats">
                    <span className="composer-diff-add">+{latestRunDiffStats.additions}</span>
                    <span className="composer-diff-del">-{latestRunDiffStats.deletions}</span>
                  </span>
                )}
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
                  externalPathGrants={codexExternalPathGrants}
                  onPickExternalPathGrant={(access) => void handlePickExternalPathGrant(access)}
                  agenticServices={agenticServices}
                  agenticWorkspaceGrants={agenticWorkspaceGrants}
                  onSetWorkspaceGrant={(service, enabled) =>
                    void handleSetAgenticWorkspaceGrant(service, enabled)
                  }
                  currentGeminiWorktree={currentGeminiWorktree}
                  onGeminiWorktreeToggle={() => void handleGeminiWorktreeToggle()}
                  worktreeToggleLabel={worktreeToggleLabel}
                  worktreeDiffUnavailable={currentWorktreeDiffUnavailable}
                />
                <button
                  type="button"
                  className={`composer-above-bar-action ${createPrState.status === 'pending' ? 'is-pending' : ''} ${createPrState.status === 'error' ? 'is-error' : ''} ${createPrState.status === 'success' ? 'is-success' : ''}`}
                  onClick={handleCreateGithubPr}
                  disabled={createPrState.status === 'pending'}
                  title={
                    createPrState.message || 'Run `gh pr create --fill` against the current branch'
                  }
                >
                  {createPrState.status === 'pending'
                    ? 'Creating…'
                    : createPrState.status === 'success'
                      ? 'PR opened'
                      : createPrState.status === 'error'
                        ? 'Retry PR'
                        : 'Create PR'}
                </button>
              </div>
            )}
            <div
              className={`composer-surface ${isComposerDragOver ? 'is-drag-over' : ''} ${composerAgentAuraClass}`}
              onDragEnter={handleComposerDragEnter}
              onDragOver={handleComposerDragOver}
              onDragLeave={handleComposerDragLeave}
              onDrop={handleComposerDrop}
            >
              <div className="composer-chips">
                {currentWorkspace?.branch && (
                  <span className="composer-chip">Branch: {currentWorkspace.branch}</span>
                )}
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
                    title="Durable queued tasks are persisted by AGBench."
                  >
                    {queuedRunQueueCount} queued
                  </span>
                )}
              </div>
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
              <div className="composer-top-toggles">
                <span className="composer-picker-command persistent-session-toggle active">
                  <LinkCircleSymbolIcon />
                  <span className="composer-control-label-text">{providerSessionLabel}</span>
                </span>
                <span className="composer-picker-command persistent-session-toggle">
                  <PermissionSymbolIcon />
                  <span className="composer-control-label-text">{permissionModeLabel}</span>
                </span>
                {scheduleControls}
                {runtimeProfileControl}
              </div>

              <textarea
                className="composer-textarea"
                ref={composerTextareaRef}
                value={prompt}
                onChange={(e) => {
                  const nextValue = e.target.value
                  setPrompt(nextValue)
                  // Composer popover coordinator: scan the text before the
                  // caret for a leading `/<query>` token (start-of-line or
                  // after whitespace), then for an `@<query>` mention token.
                  // Whichever matches wins; the other is force-closed. Only
                  // one popover open at a time.
                  const caret = e.target.selectionStart ?? nextValue.length
                  const before = nextValue.slice(0, caret)
                  const slashMatch = before.match(/(?:^|\s)\/([\w-]*)$/)
                  const atMatch = !slashMatch ? before.match(/@([\w-]*)$/) : null
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
                  } else if (atMatch) {
                    mentionAnchorIndexRef.current = caret - atMatch[0].length
                    setMentionQuery(atMatch[1] || '')
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
                placeholder={
                  /*
                    Composer-unification (Phase J1): placeholder follows the
                    active PROVIDER, not the composer THEME. A user on the
                    "claude" theme who switches to Kimi gets the Kimi
                    placeholder, etc.
                  */
                  currentProvider === 'codex'
                    ? 'Ask Codex anything. @ to use plugins or mention files'
                    : currentProvider === 'claude'
                      ? 'Describe a task or ask a question'
                      : currentProvider === 'gemini'
                        ? 'Ask Gemini'
                        : currentProvider === 'kimi'
                          ? 'Type "/" to quickly access skills'
                          : `Enter prompt for ${currentProviderLabel}…`
                }
                aria-label={`Prompt for ${currentProviderLabel}`}
                rows={3}
                disabled={!currentChat || (!isCurrentGlobalChat && !currentWorkspace)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    triggerSendConfirmation()
                    handleRun()
                  }
                }}
              />
              <ComposerSlashMenu
                open={slashMenuOpen}
                anchorRef={composerTextareaRef}
                query={slashQuery}
                commands={composerSlashCommands}
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
                prompt={prompt}
                open={mentionMenuOpen}
                anchorRef={composerTextareaRef}
                query={mentionQuery}
                onDismiss={() => {
                  setMentionMenuOpen(false)
                  setMentionQuery('')
                  mentionAnchorIndexRef.current = null
                }}
                onPick={({ agentId, name }) => {
                  const anchor = mentionAnchorIndexRef.current
                  if (anchor === null) {
                    setMentionMenuOpen(false)
                    setMentionQuery('')
                    return
                  }
                  const before = prompt.slice(0, anchor)
                  const afterQuery = prompt.slice(anchor + 1 + mentionQuery.length)
                  const mentionMarkdown = `[@${name}](agent://${agentId}) `
                  const next = `${before}${mentionMarkdown}${afterQuery}`
                  setPrompt(next)
                  setMentionMenuOpen(false)
                  setMentionQuery('')
                  mentionAnchorIndexRef.current = null
                  // Restore caret after the inserted mention.
                  requestAnimationFrame(() => {
                    const ta = composerTextareaRef.current
                    if (!ta) return
                    const newCaret = before.length + mentionMarkdown.length
                    ta.focus()
                    ta.setSelectionRange(newCaret, newCaret)
                  })
                }}
              />
              <div className="composer-control-footer">
                {imageAttachments.length > 0 && (
                  <div className="composer-image-strip">
                    {imageAttachments.map((image) => (
                      <div key={image.id} className="composer-image-item">
                        {isImageAttachmentPath(image.path) ? (
                          <img
                            src={getImagePreviewSrc(image.path)}
                            alt={image.name}
                            className="composer-image-thumb"
                          />
                        ) : (
                          <span className="composer-attachment-icon" title={image.name}>
                            <FileTypeIcon
                              path={image.path}
                              size={14}
                              className="composer-attachment-icon-inner"
                              workspacePath={currentWorkspace?.path}
                            />
                          </span>
                        )}
                        <span className="composer-image-name" title={image.path}>
                          {image.name}
                        </span>
                        <button
                          className="composer-image-remove"
                          type="button"
                          onClick={() => handleRemoveImageAttachment(image.id)}
                          disabled={isCurrentComposerLocked}
                          title="Remove attachment"
                        >
                          <XSymbolIcon />
                        </button>
                      </div>
                    ))}
                    <span className="composer-image-count">{`${imageAttachments.length}/${MAX_IMAGE_ATTACHMENTS}`}</span>
                  </div>
                )}
                {currentProvider === 'codex' &&
                  !isCurrentGlobalChat &&
                  codexExternalPathGrants.length > 0 && (
                    <div className="composer-image-strip composer-external-grant-strip">
                      {codexExternalPathGrants.map((grant) => (
                        <div
                          key={grant.id}
                          className={`composer-image-item external-grant access-${grant.access}`}
                        >
                          <PermissionSymbolIcon />
                          <span className="composer-image-name" title={grant.path}>
                            {grant.access === 'write' ? 'Edit' : 'Read'} {grant.kind}: {grant.path}
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
                      <div className="composer-permission-message">{permissionRequestMessage}</div>
                    )}
                    <div className="composer-permission-paths">
                      {permissionRequestPaths.map((path) => (
                        <span key={path} className="composer-permission-path">
                          {path}
                        </span>
                      ))}
                    </div>
                    <div className="composer-permission-actions">
                      <button className="btn btn-sm" type="button" onClick={handlePermissionRetry}>
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
                    approval auto-allows. Includes a one-click disable. */}
                {sessionYoloMode.enabled && (
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
                      Approval modals will be skipped for the rest of this app session. Global Deny
                      policies still apply. Restart the app to revert, or disable here.
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
                      </span>
                    </div>
                    {pendingAgentApproval.body && (
                      <div className="composer-permission-message">{pendingAgentApproval.body}</div>
                    )}
                    {renderAgentApprovalPreview(pendingAgentApproval.preview)}
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
                        <div className="command-palette-empty">No commands match this filter.</div>
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
                            <span className="composer-picker-command-slash">{item.command}</span>
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
                              <span className="memory-file-size">{file.sizeBytes} bytes</span>
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
                        <div className="memory-file-empty">No GEMINI.md files discovered yet.</div>
                      )}
                    </div>
                  </div>
                )}
                <div className="composer-inline-pickers">
                  <div className="composer-inline-pickers-left">
                    <button
                      className="composer-image-picker-btn"
                      type="button"
                      title="Add attachment"
                      aria-label="Add attachment"
                      onClick={handlePickImages}
                      disabled={isCurrentComposerLocked}
                      data-composer-control="attach"
                    >
                      <PlusSymbolIcon />
                    </button>
                    {attachedWindow ? (
                      <button
                        className="composer-attached-window-pill"
                        type="button"
                        title={`Detach ${attachedWindow.windowMeta.applicationName || 'window'}: ${attachedWindow.windowMeta.title || '(untitled)'}`}
                        aria-label="Detach attached window"
                        onClick={handleDetachWindow}
                        data-composer-control="attached-window"
                      >
                        <span className="composer-attached-window-pill-app">
                          {attachedWindow.windowMeta.applicationName ||
                            attachedWindow.windowMeta.bundleID ||
                            'window'}
                        </span>
                        {attachedWindow.windowMeta.title && (
                          <span className="composer-attached-window-pill-title">
                            {attachedWindow.windowMeta.title}
                          </span>
                        )}
                        <span className="composer-attached-window-pill-x" aria-hidden="true">
                          ×
                        </span>
                      </button>
                    ) : (
                      <button
                        className="composer-image-picker-btn"
                        type="button"
                        title="Attach a running app (pick a window via the macOS picker)"
                        aria-label="Attach a running app"
                        onClick={handleAttachWindow}
                        disabled={isCurrentComposerLocked || isAttachingWindow}
                        data-composer-control="attach-window"
                      >
                        {isAttachingWindow ? '…' : '⌘'}
                      </button>
                    )}
                    <label
                      className="composer-picker-label"
                      title="Provider"
                      data-composer-control="provider"
                    >
                      <LinkCircleSymbolIcon />
                      <select
                        className="composer-inline-picker"
                        aria-label="Provider"
                        value={currentProvider}
                        onChange={(event) =>
                          void handleProviderChange(event.target.value as ProviderId)
                        }
                        disabled={isCurrentComposerLocked || isCurrentChatProviderLocked}
                      >
                        <option value="gemini">Gemini</option>
                        <option value="codex">Codex</option>
                        <option value="claude">Claude</option>
                        <option value="kimi">Kimi</option>
                      </select>
                    </label>
                    <label
                      className="composer-picker-label"
                      title="Model"
                      data-composer-control="model"
                    >
                      <ModelSymbolIcon />
                      <select
                        className="composer-inline-picker"
                        aria-label={`${currentProviderLabel} model`}
                        value={selectedComposerModelType}
                        onChange={(e) => {
                          const nextModel = e.target.value
                          if (nextModel !== 'custom') {
                            setLastNonCustomModelType(nextModel)
                          }
                          setSelectedModelType(nextModel)
                          const metadataPatch: Record<string, unknown> = {
                            selectedModelType: nextModel
                          }
                          if (currentProvider === 'codex') {
                            const modelOption = codexModels.find((model) => model.id === nextModel)
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
                          if (currentProvider === 'gemini') {
                            syncPersistentModelSelection(nextModel)
                          }
                          rememberCurrentChatComposerSelection(metadataPatch)
                        }}
                        disabled={isCurrentComposerLocked}
                      >
                        {currentProviderModelOptions.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.label || model.id}
                          </option>
                        ))}
                        {currentProvider !== 'kimi' && <option value="custom">Custom…</option>}
                      </select>
                      {selectedModelType === 'custom' && currentProvider !== 'kimi' && (
                        <span className="composer-inline-custom-model">
                          <input
                            className="composer-inline-input"
                            type="text"
                            value={customModel}
                            onChange={(e) => {
                              setCustomModel(e.target.value)
                              rememberCurrentChatComposerSelection({ customModel: e.target.value })
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
                    </label>

                    {currentProvider === 'codex' && (
                      <>
                        <label className="composer-picker-label" title="Reasoning effort">
                          <QuestionmarkCircleSymbolIcon />
                          <select
                            className="composer-inline-picker"
                            aria-label="Codex reasoning effort"
                            value={codexReasoningEffort}
                            onChange={(event) => {
                              setCodexReasoningEffort(event.target.value)
                              rememberCurrentChatComposerSelection({
                                codexReasoningEffort: event.target.value
                              })
                            }}
                            disabled={isCurrentComposerLocked}
                          >
                            {codexReasoningOptions.map((option) => (
                              <option key={option.reasoningEffort} value={option.reasoningEffort}>
                                {option.reasoningEffort}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label
                          className="composer-picker-label"
                          title={
                            codexSupportsFast
                              ? 'Codex speed tier'
                              : 'The selected Codex model only supports standard speed'
                          }
                        >
                          <ClockSymbolIcon />
                          <select
                            className="composer-inline-picker"
                            aria-label="Codex speed tier"
                            value={codexServiceTier === 'fast' ? 'fast' : ''}
                            onChange={(event) => {
                              const nextTier = event.target.value === 'fast' ? 'fast' : ''
                              setCodexServiceTier(nextTier)
                              rememberCurrentChatComposerSelection({ codexServiceTier: nextTier })
                            }}
                            disabled={isCurrentComposerLocked || !codexSupportsFast}
                          >
                            <option value="">Standard</option>
                            <option value="fast">Fast</option>
                          </select>
                        </label>
                      </>
                    )}

                    {currentProvider === 'kimi' && (
                      <label className="composer-picker-label" title="Kimi thinking mode">
                        <QuestionmarkCircleSymbolIcon />
                        <select
                          className="composer-inline-picker"
                          aria-label="Kimi thinking mode"
                          value={kimiThinkingEnabled ? 'on' : 'off'}
                          onChange={(event) => {
                            const nextThinking = event.target.value !== 'off'
                            setKimiThinkingEnabled(nextThinking)
                            rememberCurrentChatComposerSelection({
                              kimiThinkingEnabled: nextThinking
                            })
                          }}
                          disabled={isCurrentComposerLocked}
                        >
                          <option value="on">Thinking on</option>
                          <option value="off">Thinking off</option>
                        </select>
                      </label>
                    )}

                    {currentProvider === 'claude' &&
                      claudeReasoningOptions.some((o) => o.reasoningEffort !== 'off') && (
                        <label className="composer-picker-label" title="Extended thinking">
                          <QuestionmarkCircleSymbolIcon />
                          <select
                            className="composer-inline-picker"
                            aria-label="Claude thinking"
                            value={claudeReasoningEffort}
                            onChange={(event) => {
                              setClaudeReasoningEffort(event.target.value)
                              rememberCurrentChatComposerSelection({
                                claudeReasoningEffort: event.target.value
                              })
                            }}
                            disabled={isCurrentComposerLocked}
                          >
                            {claudeReasoningOptions.map((option) => (
                              <option key={option.reasoningEffort} value={option.reasoningEffort}>
                                {option.reasoningEffort === 'off'
                                  ? 'Thinking off'
                                  : `${option.reasoningEffort.charAt(0).toUpperCase() + option.reasoningEffort.slice(1)} thinking`}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}

                    {currentProvider === 'claude' && (
                      <span
                        className="composer-picker-label composer-claude-runtime-chip"
                        title={claudeRuntimeNotice}
                        data-composer-control="claude-runtime"
                      >
                        <span className="composer-control-label-text">{claudeRuntimeLabel}</span>
                      </span>
                    )}

                    <label
                      className="composer-picker-label"
                      title="Permissions"
                      data-composer-control="permission"
                    >
                      <PermissionSymbolIcon />
                      <select
                        className="composer-inline-picker"
                        aria-label="Permission mode"
                        value={approvalMode}
                        onChange={(e) => {
                          const nextApprovalMode = e.target.value
                          setApprovalMode(nextApprovalMode)
                          rememberCurrentChatComposerSelection({ approvalMode: nextApprovalMode })
                          if (currentProvider === 'gemini' && nextApprovalMode !== approvalMode) {
                            markPersistentSessionRestartNeeded(
                              'Gemini approval mode changed. Restart the persistent session to apply the correct tool permissions.'
                            )
                          }
                        }}
                        disabled={
                          isCurrentComposerLocked ||
                          (currentProvider === 'gemini' && !geminiWorkspaceTrustReady)
                        }
                      >
                        <option value="plan">Plan / Read-only</option>
                        <option value="default">Default approval</option>
                        <option value="auto_edit">Edit files (auto_edit)</option>
                      </select>
                    </label>

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
                    {/*
                      Composer-unification (Phase J1): the inline-pickers
                      tail is now identical across providers:
                        [safety] [diff] [models] [command-palette] [review]
                      Previously Gemini had its own bonanza of standalone
                      buttons (`/stats`, `/help`, `GEMINI.md`, `/restore`,
                      palette) and other providers had the safety/diff/
                      models/palette icons. Now everyone shares the same
                      five icons; Gemini's bespoke commands live INSIDE the
                      palette popover (see `geminiQuickToggleItems` in the
                      palette items derivation) so they're still one click
                      away but the row position stays predictable.
                    */}
                    {!isCurrentGlobalChat && (
                      <button
                        className="composer-picker-command composer-icon-command"
                        type="button"
                        onClick={() => setRightTab('safety')}
                        disabled={!currentWorkspace || !currentChat}
                        title={`Show ${currentProviderLabel} safety and setup state`}
                        aria-label={`Show ${currentProviderLabel} status`}
                      >
                        <TrustSymbolIcon />
                      </button>
                    )}
                    {!isCurrentGlobalChat && (
                      <button
                        className="composer-picker-command composer-icon-command"
                        type="button"
                        onClick={() => setRightTab('diff')}
                        disabled={!currentWorkspace || !currentChat}
                        title={`Open Diff Studio for ${currentProviderLabel} workspace changes`}
                        aria-label={`Open ${currentProviderLabel} diff`}
                      >
                        <FileMenuSelectionIcon />
                      </button>
                    )}
                    {!isCurrentGlobalChat && (
                      <button
                        className="composer-picker-command composer-icon-command"
                        type="button"
                        onClick={() => setRightTab('capabilities')}
                        disabled={!currentWorkspace || !currentChat}
                        title={`Show ${currentProviderLabel} models and capability state`}
                        aria-label={`Show ${currentProviderLabel} models`}
                      >
                        <ModelSymbolIcon />
                      </button>
                    )}
                    {!isCurrentGlobalChat && (
                      <button
                        className={`composer-picker-command composer-icon-command composer-command-palette-trigger ${isCommandPaletteOpen ? 'active' : ''}`}
                        type="button"
                        onClick={() => setIsCommandPaletteOpen((current) => !current)}
                        disabled={!currentWorkspace || !currentChat}
                        title={
                          currentProvider === 'gemini'
                            ? 'Open Gemini slash command palette'
                            : `Open ${currentProviderLabel} command palette`
                        }
                        aria-label={
                          currentProvider === 'gemini'
                            ? 'Open Gemini slash command palette'
                            : `Open ${currentProviderLabel} command palette`
                        }
                      >
                        <CommandSymbolIcon />
                      </button>
                    )}
                    {!isCurrentGlobalChat && (
                      <button
                        className="composer-picker-command composer-icon-command composer-review-command"
                        type="button"
                        onClick={() => void handleReviewCurrentDiff()}
                        disabled={!currentWorkspace || !currentChat || isPreparingDiffReview}
                        title={
                          isPreparingDiffReview
                            ? 'Preparing review...'
                            : 'Review the current workspace diff in read-only plan mode'
                        }
                        aria-label={
                          isPreparingDiffReview ? 'Preparing review' : 'Review current diff'
                        }
                      >
                        <ReviewSymbolIcon />
                      </button>
                    )}
                  </div>
                  <div className="composer-inline-actions">
                    <ContextWheel percent={contextUsedPercent} label={contextLabel} />
                    {steerIndicatorMessage && (
                      <span className="composer-steer-indicator" role="status" aria-live="polite">
                        <span className="composer-steer-indicator-dot" aria-hidden />
                        <span>{steerIndicatorMessage}</span>
                      </span>
                    )}
                    {isCurrentChatRunning ? (
                      <>
                        <button
                          className={`composer-action-btn run-btn queue ${isSendConfirming ? 'send-confirming' : ''}`}
                          onClick={() => {
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
                        onClick={() => {
                          triggerSendConfirmation()
                          handleRun()
                        }}
                        disabled={
                          !currentChat ||
                          (!isCurrentGlobalChat && !currentWorkspace) ||
                          !prompt.trim() ||
                          (currentProvider === 'gemini' && !geminiWorkspaceTrustReady)
                        }
                        title="Run"
                        aria-label="Run prompt"
                        aria-keyshortcuts="Meta+Enter Control+Enter"
                        type="button"
                      >
                        {appearance.composerStyle === 'claude' ? (
                          <ClaudeReturnSymbolIcon />
                        ) : appearance.composerStyle === 'codex' ||
                          appearance.composerStyle === 'gemini' ||
                          appearance.composerStyle === 'kimi' ? (
                          <ArrowUpSendIcon />
                        ) : (
                          <RunSymbolIcon />
                        )}
                      </button>
                    )}
                  </div>
                </div>
                {currentProvider === 'gemini' && !geminiWorkspaceTrustReady && (
                  <div
                    className="composer-inline-warning"
                    style={{ fontSize: 'var(--font-size-xs)', color: 'var(--warning)' }}
                  >
                    Workspace trust is not established. Enable session trust or use Trust Assistant.
                  </div>
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
            {isWelcomeChat && (
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
          </div>
        </div>

        {showFileEditor && hasWorkspaceContext && (
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

        {appearance.showInspector && (
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
              codexThreads={codexThreads}
              codexExternalPathGrants={codexExternalPathGrants}
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

      {showCockpit && (
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

      {showSettings && (
        <div
          className="settings-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowSettings(false)
            }
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.45)'
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            className="settings-floater"
            style={{
              width: 'min(1080px, calc(100vw - 64px))',
              height: 'min(640px, 70vh)',
              maxHeight: 'calc(100dvh - 48px)',
              background: 'var(--panel-bg-solid)',
              border: '1px solid var(--panel-border)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-lg)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <SettingsPanel
              mode={appearance.mode}
              visualEffectStyle={appearance.visualEffectStyle}
              themeAppearance={appearance.themeAppearance}
              themeCornerStyle={appearance.themeCornerStyle}
              themeAccentStyle={appearance.themeAccentStyle}
              promptSurfaceStyle={appearance.promptSurfaceStyle}
              composerStyle={appearance.composerStyle}
              transcriptFontFamily={appearance.transcriptFontFamily}
              composerFontFamily={appearance.composerFontFamily}
              reduceTransparency={appearance.reduceTransparency}
              reduceMotion={appearance.reduceMotion}
              compactDensity={appearance.compactDensity}
              geminiCheckpointingEnabled={geminiCheckpointingEnabled}
              geminiApiRuntime={geminiApiRuntime}
              chatContextTurns={chatContextTurns}
              claudeBinaryPath={claudeBinaryPath}
              kimiBinaryPath={kimiBinaryPath}
              agenticServices={agenticServices}
              autoResumeParentOnSubThreadCompletion={autoResumeParentOnSubThreadCompletion}
              agenticWorkspaceGrantCount={agenticWorkspaceGrantCount}
              activeProvider={currentProvider}
              providerCapabilities={currentProviderCapabilities}
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
              claudeAuthStatus={claudeAuthStatus}
              kimiAuthStatus={kimiAuthStatus}
              claudeLoginState={claudeLoginState}
              onTriggerClaudeLogin={() => void handleTriggerClaudeLogin()}
              onStoreClaudeApiKey={(key) => void handleStoreClaudeApiKey(key)}
              onClearClaudeApiKey={() => void handleClearClaudeApiKey()}
              onStoreKimiApiKey={(key) => void handleStoreKimiApiKey(key)}
              onClearKimiApiKey={() => void handleClearKimiApiKey()}
              onSaveGeminiAuthProfile={(profile) => void handleSaveGeminiAuthProfile(profile)}
              onStartGeminiOAuthLogin={(input) => void handleStartGeminiOAuthLogin(input)}
              onCancelGeminiOAuthLogin={(profileId) => void handleCancelGeminiOAuthLogin(profileId)}
              onSetDefaultGeminiAuthProfile={(profileId) =>
                void handleSetDefaultGeminiAuthProfile(profileId)
              }
              onDeleteGeminiAuthProfile={(profileId) =>
                void handleDeleteGeminiAuthProfile(profileId)
              }
              onInstallGeminiMcpBridge={() => void installGeminiMcpBridge()}
              onRefreshGeminiMcpBridgeStatus={() => void refreshGeminiMcpBridgeStatus()}
              onRefreshProductOperationsStatus={() => void refreshProductOperationsStatus()}
              onExportProductDiagnostics={() => void exportProductDiagnostics()}
              onRepairProductInstall={() => void repairProductInstall()}
              onChange={handleSettingsChange}
              onClose={() => setShowSettings(false)}
            />
          </div>
        </div>
      )}
      <IncomingPairingPrompt />
      {showPairingSheet && <PairingSheet onClose={() => setShowPairingSheet(false)} />}
      {subThreadCreatorParent && (
        <SubThreadCreator
          parentChat={subThreadCreatorParent}
          onCreated={(subThread, delegationPrompt) => {
            void handleSubThreadCreated(subThread, delegationPrompt)
          }}
          onCancel={() => setSubThreadCreatorParent(null)}
        />
      )}
    </div>
  )
}

export default App
