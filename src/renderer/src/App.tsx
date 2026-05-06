import { useState, useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { GeminiStreamAdapter, NormalizedEvent } from './lib/GeminiAdapter'
import { classifyError, redactLog } from './lib/ErrorClassifier'
import { AppSettings, WorkspaceRecord, ChatRecord, ChatMessage, ChatRun, RunWarning, DiffFileSummary, UsageRecord, ToolActivity, RunDiffResult, GeminiWorktreeConfig, ProviderId, ExternalPathGrant, ScheduledTask, AgenticServicesSettings, GeminiMcpBridgeStatus, CodexSandboxFallbackMode } from '../../main/store/types'
import { createToolActivity, pairToolResult, isToolUseEvent, isToolResultEvent, estimateLineChanges } from './lib/ToolParser'
import { parseGeminiPermissionRequest } from './lib/GeminiPermissionParser'
import type { GeminiPermissionRequest } from './lib/GeminiPermissionParser'
import { useAppearance } from './hooks/useAppearance'
import { Sidebar } from './components/Sidebar'
import { Inspector } from './components/Inspector'
import { SettingsPanel } from './components/SettingsPanel'
import { ActivityStack } from './components/ActivityStack'
import { FileTypeIcon } from './components/FileTypeIcon'
import { FileEditorPanel } from './components/FileEditorPanel'
import { HighlightedCodeBlock } from './components/HighlightedCodeBlock'

type SkyWeatherKind = 'clear' | 'partly_cloudy' | 'cloudy' | 'overcast' | 'rain' | 'heavy_rain' | 'snow' | 'mist' | 'fog' | 'storm' | 'unknown'

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

function SidebarCornerIcon({ direction, isOpen }: { direction: 'left' | 'right'; isOpen: boolean }) {
  const symbolColor = 'var(--text-primary)'
  const panelFill = 'transparent'
  return (
    <span className="chat-corner-symbol">
      <svg viewBox="0 0 16 16" fill="none" stroke={symbolColor} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
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
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
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
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.2" y="3" width="11.6" height="10" rx="1.4" />
        <path d="M4.4 6.2 6.3 8 4.4 9.8" />
        <path d="M7.4 10h3.5" />
      </svg>
    </span>
  )
}

function GhostCompanionIcon() {
  return (
    <span className="chat-corner-symbol">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
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
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
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
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
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

function SkyWeatherVisual({ weather }: { weather: HostWeatherVisualState | null }) {
  const localHour = new Date().getHours()
  const isNight = weather ? !weather.isDay : localHour < 7 || localHour >= 19
  const skyKind = weather?.kind || 'unknown'

  return (
    <div className={`sky-visual-fx sky-${skyKind} ${isNight ? 'sky-night' : 'sky-day'}`} aria-hidden>
      <div className="sky-glow" />
      <div className="sky-orb" />
      {isNight && (
        <>
          <span className="sky-star sky-star-1" />
          <span className="sky-star sky-star-2" />
          <span className="sky-star sky-star-3" />
          <span className="sky-star sky-star-4" />
        </>
      )}
      <span className="sky-cloud sky-cloud-1" />
      <span className="sky-cloud sky-cloud-2" />
      <span className="sky-cloud sky-cloud-3" />
      <div className="sky-rainfall">
        <span />
        <span />
        <span />
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
          <span className="ghost-cap ghost-cap-top" />
          <span className="ghost-cap ghost-cap-crown" />
          <span className="ghost-cap ghost-cap-brim" />
          <span className="ghost-face ghost-face-left" />
          <span className="ghost-face ghost-face-right" />
          <span className="ghost-eye ghost-eye-left" />
          <span className="ghost-eye ghost-eye-right" />
          <span className="ghost-moustache ghost-moustache-left" />
          <span className="ghost-moustache ghost-moustache-right" />
          <span className="ghost-cheek ghost-cheek-left" />
          <span className="ghost-cheek ghost-cheek-right" />
          <span className="ghost-pixel ghost-pixel-left" />
          <span className="ghost-pixel ghost-pixel-mid" />
          <span className="ghost-pixel ghost-pixel-right" />
        </div>
      </div>
    </div>
  )
}

function RunSymbolIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6.1 4v8l4.8-4-4.8-4z" />
      </svg>
    </span>
  )
}

function StopSymbolIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4.3" y="4.3" width="7.4" height="7.4" rx="1" />
      </svg>
    </span>
  )
}

function QueueSymbolIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.6" y="1.6" width="4.8" height="12.8" rx="0.8" />
        <path d="M9.2 4.2h4.3M11.3 2.4v3.6M11.3 9.8v3.6" />
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
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 3.5v9M3.5 8h9" />
      </svg>
    </span>
  )
}

function ChartBarSymbolIcon() {
  return (
    <span className="sf-symbol-icon composer-control-icon" aria-hidden>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.8 13.2h10.4" />
        <path d="M4.1 10.6V7.4" />
        <path d="M8 10.6V4.2" />
        <path d="M11.9 10.6V6" />
      </svg>
    </span>
  )
}

function CommandSymbolIcon() {
  return (
    <span className="sf-symbol-icon composer-control-icon" aria-hidden>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
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
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
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
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="5.7" />
        <path d="M8 4.8V8l2.2 1.4" />
      </svg>
    </span>
  )
}

function QuestionmarkCircleSymbolIcon() {
  return (
    <span className="sf-symbol-icon composer-control-icon" aria-hidden>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
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
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
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
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
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
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 2.2 12.2 4v3.3c0 2.7-1.6 5-4.2 6.5-2.6-1.5-4.2-3.8-4.2-6.5V4z" />
        <path d="m5.8 7.8 1.4 1.4 3-3" />
      </svg>
    </span>
  )
}

function LinkCircleSymbolIcon() {
  return (
    <span className="sf-symbol-icon composer-control-icon" aria-hidden>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="5.7" />
        <path d="M6.9 9.1 9.1 6.9" />
        <path d="M6.2 7.5 5.6 8.1a1.6 1.6 0 0 0 2.3 2.3l.6-.6" />
        <path d="m9.8 8.5.6-.6a1.6 1.6 0 0 0-2.3-2.3l-.6.6" />
      </svg>
    </span>
  )
}

function CheckpointSymbolIcon() {
  return (
    <span className="sf-symbol-icon composer-control-icon" aria-hidden>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.7 7.2a4.7 4.7 0 1 0-1.3 4.1" />
        <path d="M12.7 4.9v2.3h-2.3" />
        <path d="M8 5.4V8l1.7 1" />
      </svg>
    </span>
  )
}

function WorktreeSymbolIcon() {
  return (
    <span className="sf-symbol-icon composer-control-icon" aria-hidden>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.2 3.2v6.1a2.5 2.5 0 0 0 2.5 2.5h5.1" />
        <path d="M4.2 5.6h3.6a2.5 2.5 0 0 0 2.5-2.5" />
        <circle cx="4.2" cy="3.2" r="1.2" />
        <circle cx="11.8" cy="11.8" r="1.2" />
        <circle cx="10.3" cy="3.1" r="1.2" />
      </svg>
    </span>
  )
}

function XSymbolIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    </span>
  )
}

interface ModelUsageAggregate {
  provider: ProviderId
  model: string
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

interface UsageWindowAggregate {
  id: string
  label: string
  runs: number
  totalTokens: number
  runLimitMax?: number
  limitLabel: string
  resetAt?: string
  trackingOnly?: boolean
  usedPercent?: number
}

type RawLogEntry = { type: 'stdout' | 'stderr' | 'tool' | 'info'; content: string }

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

type PersistentSessionStatus = 'idle' | 'starting' | 'active' | 'stopping' | 'exited' | 'unavailable' | 'error'
type CommandPaletteSource = 'core' | 'workspace' | 'global'
type CommandPaletteGroup = 'Core' | 'Discovery' | 'Memory' | 'Inspectors' | 'Custom'

type CommandPaletteItem = {
  id: string
  command: string
  label: string
  description: string
  group: CommandPaletteGroup
  source: CommandPaletteSource
  sourcePath?: string
}

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
const DEFAULT_CONTEXT_TURNS = 6
const MAX_CONTEXT_TURNS = 20
const MAX_CONTEXT_CHARS_PER_TURN = 420
const MAX_CONTEXT_BLOCK_CHARS = 6000
const DEFAULT_FILE_EDITOR_WIDTH = 390
const MIN_RIGHT_PANEL_WIDTH = 300
const MAX_RIGHT_PANEL_WIDTH = 720
const DEFAULT_WORKSPACE_SIDEBAR_WIDTH = 260
const MIN_WORKSPACE_SIDEBAR_WIDTH = 220
const MAX_WORKSPACE_SIDEBAR_WIDTH = 440
const GHOST_COMPANION_STORAGE_KEY = 'guiGemini.ghostCompanionEnabled'
const RUN_WRITE_TOOLS = ['replace', 'write_file', 'create_file', 'edit_file']
const COMMAND_PALETTE_CORE: CommandPaletteItem[] = [
  {
    id: 'core-help',
    command: '/help',
    label: 'Help',
    description: 'Show Gemini CLI slash command help.',
    group: 'Core',
    source: 'core'
  },
  {
    id: 'core-stats',
    command: '/stats',
    label: 'Stats',
    description: 'Show current Gemini session usage and stats.',
    group: 'Core',
    source: 'core'
  },
  {
    id: 'core-commands-list',
    command: '/commands list',
    label: 'List commands',
    description: 'Ask Gemini CLI to list built-in and custom commands.',
    group: 'Discovery',
    source: 'core'
  },
  {
    id: 'core-commands-reload',
    command: '/commands reload',
    label: 'Reload commands',
    description: 'Reload Gemini CLI custom command definitions.',
    group: 'Discovery',
    source: 'core'
  },
  {
    id: 'core-memory-list',
    command: '/memory list',
    label: 'List memory',
    description: 'Ask Gemini CLI which memory files are loaded.',
    group: 'Memory',
    source: 'core'
  },
  {
    id: 'core-memory-show',
    command: '/memory show',
    label: 'Show memory',
    description: 'Ask Gemini CLI to print active memory contents.',
    group: 'Memory',
    source: 'core'
  },
  {
    id: 'core-memory-refresh',
    command: '/memory refresh',
    label: 'Refresh memory',
    description: 'Reload memory from GEMINI.md files without editing them.',
    group: 'Memory',
    source: 'core'
  },
  {
    id: 'core-mcp',
    command: '/mcp',
    label: 'MCP',
    description: 'Open Gemini CLI MCP server status.',
    group: 'Inspectors',
    source: 'core'
  },
  {
    id: 'core-extensions',
    command: '/extensions',
    label: 'Extensions',
    description: 'Open Gemini CLI extension status.',
    group: 'Inspectors',
    source: 'core'
  },
  {
    id: 'core-hooks',
    command: '/hooks',
    label: 'Hooks',
    description: 'Open Gemini CLI hook status.',
    group: 'Inspectors',
    source: 'core'
  },
]
const CODEX_COMMAND_PALETTE_CORE: CommandPaletteItem[] = [
  {
    id: 'codex-status',
    command: '/status',
    label: 'Status',
    description: 'Show Codex auth, sandbox, approval policy, and rate-limit state.',
    group: 'Core',
    source: 'core'
  },
  {
    id: 'codex-model',
    command: '/model',
    label: 'Model',
    description: 'Show Codex model, reasoning effort, and speed tier options.',
    group: 'Core',
    source: 'core'
  },
  {
    id: 'codex-fast',
    command: '/fast',
    label: 'Fast mode',
    description: 'Toggle Codex Fast mode when the selected model supports it.',
    group: 'Core',
    source: 'core'
  },
  {
    id: 'codex-diff',
    command: '/diff',
    label: 'Diff',
    description: 'Open Diff Studio for current workspace changes.',
    group: 'Inspectors',
    source: 'core'
  },
  {
    id: 'codex-mcp',
    command: '/mcp',
    label: 'MCP',
    description: 'Show Codex MCP server and tool status.',
    group: 'Inspectors',
    source: 'core'
  },
  {
    id: 'codex-review',
    command: '/review',
    label: 'Review diff',
    description: 'Prepare a read-only review of current workspace changes.',
    group: 'Inspectors',
    source: 'core'
  },
  {
    id: 'codex-resume',
    command: '/resume',
    label: 'Resume thread',
    description: 'Open the Codex thread browser to link a persisted thread.',
    group: 'Discovery',
    source: 'core'
  },
  {
    id: 'codex-fork',
    command: '/fork',
    label: 'Fork thread',
    description: 'Fork the linked Codex thread and link this chat to the fork.',
    group: 'Discovery',
    source: 'core'
  },
  {
    id: 'codex-permissions',
    command: '/permissions',
    label: 'Permissions',
    description: 'Show Codex sandbox and approval controls.',
    group: 'Core',
    source: 'core'
  },
]
const CLI_PROVIDER_COMMAND_PALETTE_CORE: CommandPaletteItem[] = [
  {
    id: 'cli-provider-status',
    command: '/status',
    label: 'Status',
    description: 'Show provider binary, auth, and setup state.',
    group: 'Core',
    source: 'core'
  },
  {
    id: 'cli-provider-model',
    command: '/model',
    label: 'Model',
    description: 'Show model and provider capability state.',
    group: 'Core',
    source: 'core'
  },
  {
    id: 'cli-provider-diff',
    command: '/diff',
    label: 'Diff',
    description: 'Open Diff Studio for current workspace changes.',
    group: 'Inspectors',
    source: 'core'
  },
  {
    id: 'cli-provider-review',
    command: '/review',
    label: 'Review diff',
    description: 'Prepare a read-only review of current workspace changes.',
    group: 'Inspectors',
    source: 'core'
  },
  {
    id: 'cli-provider-permissions',
    command: '/permissions',
    label: 'Permissions',
    description: 'Show provider permission and approval mode controls.',
    group: 'Core',
    source: 'core'
  },
]
const WELCOME_SUGGESTIONS = [
  'Inspect this workspace and suggest the highest-impact next improvement.',
  'Explain the project structure and where I should start.',
  'Review recent file changes for risk and missing tests.',
]
const WELCOME_USER_NAME = 'Chris'
type WelcomeHeadingCopy = {
  beforeWorkspace: string
  workspaceName: string
  afterWorkspace: string
}
type WelcomeHeadingTemplate = (welcomeGreeting: string, dayName: string, workspaceName: string) => WelcomeHeadingCopy
type WelcomeGreetingTemplate = (timeGreeting: string, userName: string) => string
type WelcomeHeadingTone = 'standard' | 'edge'

const WELCOME_GREETINGS: Record<WelcomeHeadingTone, WelcomeGreetingTemplate[]> = {
  standard: [
    (timeGreeting, userName) => `${timeGreeting}, ${userName}.`,
    (_timeGreeting, userName) => `Ready when you are, ${userName}.`,
    (_timeGreeting, userName) => `Back at it, ${userName}.`,
    (_timeGreeting, userName) => `Fresh slate, ${userName}.`,
    (_timeGreeting, userName) => `All set, ${userName}.`,
    (_timeGreeting, userName) => `Let's focus, ${userName}.`,
    (_timeGreeting, userName) => `Clear desk, ${userName}.`,
    (_timeGreeting, userName) => `Steady start, ${userName}.`,
    (_timeGreeting, userName) => `Quick reset, ${userName}.`,
    (_timeGreeting, userName) => `Good to see you, ${userName}.`,
  ],
  edge: [
    (_timeGreeting, userName) => `Let's be direct, ${userName}.`,
    (_timeGreeting, userName) => `One sharp move, ${userName}.`,
    (_timeGreeting, userName) => `Keep it tight, ${userName}.`,
    (_timeGreeting, userName) => `No drift today, ${userName}.`,
    (_timeGreeting, userName) => `Straight to it, ${userName}.`,
    (_timeGreeting, userName) => `Make it count, ${userName}.`,
    (_timeGreeting, userName) => `Clean pass first, ${userName}.`,
    (_timeGreeting, userName) => `Less noise, ${userName}.`,
    (_timeGreeting, userName) => `Narrow target, ${userName}.`,
    (_timeGreeting, userName) => `Decisive mode, ${userName}.`,
  ],
}

const WELCOME_HEADING_TEMPLATES: Record<'standard' | 'edge', WelcomeHeadingTemplate[]> = {
  standard: [
    (welcomeGreeting: string, _dayName: string, workspaceName: string) => ({
      beforeWorkspace: `${welcomeGreeting} Start in `,
      workspaceName,
      afterWorkspace: ' with one clear task.',
    }),
    (welcomeGreeting: string, _dayName: string, workspaceName: string) => ({
      beforeWorkspace: `${welcomeGreeting} Focus `,
      workspaceName,
      afterWorkspace: ' on one useful change.',
    }),
    (welcomeGreeting: string, _dayName: string, workspaceName: string) => ({
      beforeWorkspace: `${welcomeGreeting} Use `,
      workspaceName,
      afterWorkspace: ' for a quick, practical win.',
    }),
    (welcomeGreeting: string, _dayName: string, workspaceName: string) => ({
      beforeWorkspace: `${welcomeGreeting} Open `,
      workspaceName,
      afterWorkspace: ' and pick the next step.',
    }),
    (welcomeGreeting: string, _dayName: string, workspaceName: string) => ({
      beforeWorkspace: `${welcomeGreeting} Keep `,
      workspaceName,
      afterWorkspace: ' narrow and measurable.',
    }),
    (welcomeGreeting: string, _dayName: string, workspaceName: string) => ({
      beforeWorkspace: `${welcomeGreeting} Make progress in `,
      workspaceName,
      afterWorkspace: ' one check at a time.',
    }),
    (welcomeGreeting: string, _dayName: string, workspaceName: string) => ({
      beforeWorkspace: `${welcomeGreeting} Triage `,
      workspaceName,
      afterWorkspace: ', then act on the clearest signal.',
    }),
    (welcomeGreeting: string, _dayName: string, workspaceName: string) => ({
      beforeWorkspace: `${welcomeGreeting} Start small in `,
      workspaceName,
      afterWorkspace: ' and keep it reviewable.',
    }),
    (welcomeGreeting: string, _dayName: string, workspaceName: string) => ({
      beforeWorkspace: `${welcomeGreeting} Let `,
      workspaceName,
      afterWorkspace: ' show the next obvious move.',
    }),
    (welcomeGreeting: string, _dayName: string, workspaceName: string) => ({
      beforeWorkspace: `${welcomeGreeting} Take one clean pass through `,
      workspaceName,
      afterWorkspace: '.',
    }),
  ],
  edge: [
    (welcomeGreeting: string, _dayName: string, workspaceName: string) => ({
      beforeWorkspace: `${welcomeGreeting} Make `,
      workspaceName,
      afterWorkspace: ' less vague.',
    }),
    (welcomeGreeting: string, _dayName: string, workspaceName: string) => ({
      beforeWorkspace: `${welcomeGreeting} Find the sharpest edge in `,
      workspaceName,
      afterWorkspace: '.',
    }),
    (welcomeGreeting: string, _dayName: string, workspaceName: string) => ({
      beforeWorkspace: `${welcomeGreeting} Keep `,
      workspaceName,
      afterWorkspace: ' honest with one check.',
    }),
    (welcomeGreeting: string, _dayName: string, workspaceName: string) => ({
      beforeWorkspace: `${welcomeGreeting} Skip ceremony in `,
      workspaceName,
      afterWorkspace: ' and pick a real task.',
    }),
    (welcomeGreeting: string, _dayName: string, workspaceName: string) => ({
      beforeWorkspace: `${welcomeGreeting} Tighten `,
      workspaceName,
      afterWorkspace: ' until the next move is obvious.',
    }),
    (welcomeGreeting: string, _dayName: string, workspaceName: string) => ({
      beforeWorkspace: `${welcomeGreeting} Turn `,
      workspaceName,
      afterWorkspace: ' into one clean decision.',
    }),
    (welcomeGreeting: string, _dayName: string, workspaceName: string) => ({
      beforeWorkspace: `${welcomeGreeting} Start with risk in `,
      workspaceName,
      afterWorkspace: ', then move.',
    }),
    (welcomeGreeting: string, _dayName: string, workspaceName: string) => ({
      beforeWorkspace: `${welcomeGreeting} Give `,
      workspaceName,
      afterWorkspace: ' one focused pass.',
    }),
    (welcomeGreeting: string, _dayName: string, workspaceName: string) => ({
      beforeWorkspace: `${welcomeGreeting} Cut the noise in `,
      workspaceName,
      afterWorkspace: '.',
    }),
    (welcomeGreeting: string, _dayName: string, workspaceName: string) => ({
      beforeWorkspace: `${welcomeGreeting} Make `,
      workspaceName,
      afterWorkspace: ' easy to reason about.',
    }),
    (welcomeGreeting: string, _dayName: string, workspaceName: string) => ({
      beforeWorkspace: `${welcomeGreeting} Put `,
      workspaceName,
      afterWorkspace: ' on rails with one clear check.',
    }),
  ],
}

const WELCOME_TONE_WEIGHTS: Record<WelcomeHeadingTone, number> = {
  standard: 60,
  edge: 40,
}
const WELCOME_HEADING_POOL_SIZE = WELCOME_HEADING_TEMPLATES.standard.length + WELCOME_HEADING_TEMPLATES.edge.length

const pickWelcomeTone = (seed: number): WelcomeHeadingTone => {
  const totalWeight = Object.values(WELCOME_TONE_WEIGHTS).reduce((sum, value) => sum + value, 0)
  const bucket = seed % totalWeight
  if (bucket < WELCOME_TONE_WEIGHTS.standard) return 'standard'
  return 'edge'
}
const WELCOME_SUBHEADING_TEMPLATES: Record<WelcomeHeadingTone, string[]> = {
  standard: [
    'Start a Gemini CLI task, inspect the workspace, or ask for a practical plan for the next step.',
    'Pick a starter, ask a question, or point Gemini at the next file to improve.',
    'Use the prompt below for planning, editing, review, or workspace exploration.',
    'Drop in the next task and I will route it through the workspace-aware flow.',
    'Ask for a quick risk scan and then narrow to one concrete fix.',
    'Request a test-focused validation order before changing code.',
    'Ask for the highest-impact file in this workspace and proceed carefully.',
  ],
  edge: [
    'Need a focused audit, a cleanup lane, or a direct diff-risk recommendation? Start with that.',
    'Use one sentence to define your target, then ask for a scoped implementation plan.',
    'Pick the noisiest file and ask for the smallest safe first edit.',
    'Say “prove the riskiest assumption” and I’ll open a narrow verification path.',
    'Ask for a before/after plan with explicit acceptance checks.',
    'Point at a pain point and request a concrete fix-and-verify sequence.',
    'Ask for a tactical plan: one edit, one check, one follow-up.',
  ],
}
const FILE_DIFF_STATUSES = new Set<DiffFileSummary['status']>([
  'created',
  'modified',
  'deleted',
  'renamed',
  'untracked',
  'binary',
  'too_large',
  'hidden_sensitive',
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

const hashWelcomeSeed = (value: string): number => {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

const getTimeGreeting = (date: Date): string => {
  const hour = date.getHours()
  if (hour < 5) return 'Still up'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  if (hour < 22) return 'Good evening'
  return 'Good evening'
}

const formatWelcomeGreeting = (timeGreeting: string, tone: WelcomeHeadingTone, seed: number): string => {
  const templates = WELCOME_GREETINGS[tone]
  const greeting = templates[seed % templates.length]

  return greeting(timeGreeting, WELCOME_USER_NAME)
}

const buildWelcomeCopy = (workspaceName: string, chatId?: string): { heading: WelcomeHeadingCopy; subheading: string } => {
  const now = new Date()
  const dayName = now.toLocaleDateString([], { weekday: 'long' })
  const dateKey = now.toISOString().slice(0, 10)
  const seed = hashWelcomeSeed(`${dateKey}:${workspaceName}:${chatId || ''}`)
  const tone = pickWelcomeTone(seed)
  const headingTemplates = WELCOME_HEADING_TEMPLATES[tone]
  const greeting = formatWelcomeGreeting(getTimeGreeting(now), tone, seed)
  const headingTemplate = headingTemplates[seed % headingTemplates.length]
  const subheadingPool = WELCOME_SUBHEADING_TEMPLATES[tone]
  const subheading = subheadingPool[Math.floor(seed / WELCOME_HEADING_POOL_SIZE) % subheadingPool.length]

  return {
    heading: headingTemplate(greeting, dayName, workspaceName),
    subheading
  }
}

const sanitizeImagePath = (value: string): string => value.trim().replace(/^\s*["'`]|["'`]\s*$/g, '')

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

const getImageName = (value: string): string => {
  return value.split(/[/\\]/).filter(Boolean).pop() || value
}

const isImageAttachmentPath = (path: string): boolean => IMAGE_EXT.test(path)

const attachmentPromptAppendix = (attachments: ImageAttachment[]): string => {
  if (attachments.length === 0) {
    return ''
  }
  const lines = attachments.map((image, index) => `${index + 1}. "${image.path.replace(/"/g, '\\"')}"`)
  return `\n\nAttachment references for this request:\n${lines.join('\n')}`
}

const externalPathGrantPromptAppendix = (grants: ExternalPathGrant[] = []): string => {
  if (grants.length === 0) {
    return ''
  }
  const lines = grants.map((grant, index) => {
    const access = grant.access === 'write' ? 'view and edit' : 'view'
    return `${index + 1}. ${access} ${grant.kind}: "${grant.path.replace(/"/g, '\\"')}"`
  })
  return `\n\nUser-approved external path grants for this Codex request:\n${lines.join('\n')}\nUse only these paths outside the workspace.`
}

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
      } catch (error) {
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
    const match = trimmed.match(/^(?:[-*+•]?\s*)?(?:\(?([A-Za-z]|\d+)\)?[\.\)])\s+(.+)$/)
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

  const uniqueOptions = [...new Set(options
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  )]

  if (uniqueOptions.length < 2) {
    return null
  }

  const question = questionLines.filter(Boolean).join(' ').trim()
  const likelyChoicePrompt = /(\bchoose\b|\bselect\b|\bpick\b|\bwhich\b|\boption\b|\boptions?\b|\bdecide\b)/i.test(question)
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
  return /^[A-Za-z]:\//.test(normalized) ? `file:///${normalized}` : `file://${normalized.startsWith('/') ? '' : '/'}${normalized}`
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

const mergeImageAttachments = (current: ImageAttachment[], additions: ImageAttachment[]): ImageAttachment[] => {
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
        description: typeof item.description === 'string' && item.description.trim()
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
  return target && /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,511}$/.test(target) ? target : undefined
}

const sanitizeContextText = (value: string, maxLength: number): string => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`
}

type RenderedMessagePart = {
  kind: 'text' | 'code'
  content: string
  language?: string
}

const parseFenceLanguage = (line: string): string | undefined => {
  const match = line.trim().match(/^```+\s*([^\s`{]+)/)
  return match?.[1]
}

const extractFullyQuotedLine = (line: string): string | null => {
  const match = line.match(/^\s*([`"'])([\s\S]*?)\1\s*$/)
  if (!match) return null
  const inner = match[2]
  if (!inner.trim()) return null
  return inner
}

const parseGeminiDisplayContent = (text: string): RenderedMessagePart[] => {
  const lines = text.split('\n')
  const parts: RenderedMessagePart[] = []
  const textBuffer: string[] = []
  const quotedBuffer: string[] = []
  const quotedRawBuffer: string[] = []
  let inCodeFence = false
  let openFenceLine = ''
  let codeFenceLanguage: string | undefined
  const codeBuffer: string[] = []

  const flushTextBuffer = () => {
    if (textBuffer.length === 0) return
    parts.push({ kind: 'text', content: textBuffer.join('\n') })
    textBuffer.length = 0
  }

  const flushQuotedBuffer = () => {
    if (quotedBuffer.length === 0) return

    if (quotedBuffer.length >= 2) {
      parts.push({ kind: 'code', content: quotedBuffer.join('\n') })
    } else {
      textBuffer.push(...quotedRawBuffer)
    }
    quotedBuffer.length = 0
    quotedRawBuffer.length = 0
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (inCodeFence) {
      if (trimmed.startsWith('```')) {
        parts.push({ kind: 'code', content: codeBuffer.join('\n'), language: codeFenceLanguage })
        codeBuffer.length = 0
        inCodeFence = false
        openFenceLine = ''
        codeFenceLanguage = undefined
      } else {
        codeBuffer.push(line)
      }
      continue
    }

    if (trimmed.startsWith('```')) {
      flushQuotedBuffer()
      flushTextBuffer()
      inCodeFence = true
      openFenceLine = line
      codeFenceLanguage = parseFenceLanguage(line)
      continue
    }

    const quoted = extractFullyQuotedLine(line)
    if (quoted) {
      quotedBuffer.push(quoted)
      quotedRawBuffer.push(line)
      continue
    }

    flushQuotedBuffer()
    textBuffer.push(line)
  }

  if (inCodeFence) {
    textBuffer.push(openFenceLine, ...codeBuffer)
  } else {
    flushQuotedBuffer()
  }

  flushTextBuffer()

  return parts
}

const copyCodeBlock = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Best effort; keep behavior silent to avoid noisy UI side-effects for read-only copy actions.
  }
}

const renderGeminiMessage = (text: string): React.JSX.Element => {
  const parts = parseGeminiDisplayContent(text)

  if (parts.length === 0) {
    return <></>
  }

  if (parts.length === 1 && parts[0].kind === 'text') {
    return <>{parts[0].content}</>
  }

  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === 'code') {
          return (
            <div key={`message-code-${index}`} className="message-code-block-wrapper">
              <button
                type="button"
                className="message-code-copy-btn"
                onClick={() => void copyCodeBlock(part.content)}
                title="Copy code block"
                aria-label="Copy code block"
              >
                <CopyResponseIcon />
              </button>
              <div className="message-code-block">
                <HighlightedCodeBlock content={part.content} language={part.language} />
              </div>
            </div>
          )
        }

        return <span key={`message-text-${index}`}>{part.content}</span>
      })}
    </>
  )
}

const formatApprovalChangePreview = (changes: any): string => {
  if (!Array.isArray(changes) || changes.length === 0) return ''
  return changes
    .map((change) => {
      const kind = String(change?.kind || change?.type || change?.operation || 'update')
      const filePath = String(change?.path || change?.filePath || change?.file_path || change?.target || '')
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
  const patchPreview = typeof preview.patchPreview === 'string'
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
      {toolName && <div className="agent-approval-preview-row"><span>Tool</span><code>{toolName}</code></div>}
      {cwd && <div className="agent-approval-preview-row"><span>Cwd</span><code>{cwd}</code></div>}
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
      if (!explicitYear && parsed.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
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

  return normalizeResetValue(extractNestedValue(stats, [
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
  ]))
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

const extractResetHintsFromText = (text: string): Array<{ model: string; resetAt?: string; resetText?: string }> => {
  const hints: Array<{ model: string; resetAt?: string; resetText?: string }> = []
  const lines = text.replace(/\r/g, '').split('\n')
  const modelPattern = /(flash[-\s]?lite|flash|pro|gemini[-\w.]*flash[-\w.]*lite|gemini[-\w.]*flash|gemini[-\w.]*pro)/i

  for (const line of lines) {
    if (!/reset|resets|refresh|renews|available/i.test(line)) {
      continue
    }
    const modelMatch = line.match(modelPattern)
    if (!modelMatch) {
      continue
    }
    const resetMatch = line.match(/(?:reset|resets|refresh(?:es)?|renews|available again)\s*(?:at|on|in|:)?\s*([^|,;]+)/i)
    const reset = normalizeResetValue(resetMatch?.[1] || line.trim())
    hints.push({
      model: normalizeModelName(modelMatch[1]),
      ...reset
    })
  }

  return hints
}

const extractUsageLimits = (stats: any): { inputTokenLimit?: number; outputTokenLimit?: number; totalTokenLimit?: number } => {
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

const extractUsageCountsFromCandidate = (stats: any): { inputTokens: number; outputTokens: number; totalTokens: number } => {
  const inputTokens = extractUsageCount(stats, [
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

  const outputTokens = extractUsageCount(stats, [
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

  const totalTokens = extractUsageCount(stats, [
    ['total_tokens'],
    ['totalTokens'],
    ['all_tokens'],
    ['total'],
    ['tokens', 'total'],
    ['tokenCounts', 'total'],
    ['token_counts', 'total']
  ])

  return {
    inputTokens: Math.trunc(Math.max(0, inputTokens)),
    outputTokens: Math.trunc(Math.max(0, outputTokens)),
    totalTokens: Math.trunc(Math.max(0, totalTokens))
  }
}

const isNonEmptyObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
)

const buildUsageModelEntry = (modelName: string, candidate: any, fallbackModel: string): UsageModelEntry | null => {
  if (!isNonEmptyObject(candidate)) {
    return null
  }

  const resolvedModel = modelName?.trim() || fallbackModel || 'unknown'
  const counts = extractUsageCountsFromCandidate(candidate)
  const limits = extractUsageLimits(candidate)
  const reset = extractUsageReset(candidate)
  const durationMs = extractUsageCount(candidate, [['duration_ms'], ['durationMs']])

  const hasAnyCount = counts.inputTokens > 0 || counts.outputTokens > 0 || counts.totalTokens > 0
  const hasAnyLimit = Boolean(limits.inputTokenLimit || limits.outputTokenLimit || limits.totalTokenLimit)
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

const extractModelUsageEntriesFromStats = (stats: any, fallbackModel: string): UsageModelEntry[] => {
  if (!isNonEmptyObject(stats)) {
    return [{
      model: fallbackModel || 'unknown',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      durationMs: 0
    }]
  }

  const entries: UsageModelEntry[] = []
  const modelStats = stats.models

  if (Array.isArray(modelStats) && modelStats.length > 0) {
    for (const item of modelStats) {
      if (isNonEmptyObject(item)) {
        const next = buildUsageModelEntry((item.model || item.name || item.id || '').toString(), item, fallbackModel)
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

  return [{
    model: fallbackModel || 'unknown',
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    durationMs: 0
  }]
}

const clampContextTurns = (value: number | undefined | null): number => {
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

const clampPanelWidth = (value: number): number => {
  return Math.max(MIN_RIGHT_PANEL_WIDTH, Math.min(MAX_RIGHT_PANEL_WIDTH, Math.round(value)))
}

const clampWorkspaceSidebarWidth = (value: number): number => {
  return Math.max(MIN_WORKSPACE_SIDEBAR_WIDTH, Math.min(MAX_WORKSPACE_SIDEBAR_WIDTH, Math.round(value)))
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
    return Number.isFinite(parsed) ? clampWorkspaceSidebarWidth(parsed) : DEFAULT_WORKSPACE_SIDEBAR_WIDTH
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

const clampGeminiTerminalHeight = (value: number): number => {
  const maxHeight = Math.max(MIN_GEMINI_TERMINAL_HEIGHT, Math.floor(window.innerHeight * MAX_GEMINI_TERMINAL_HEIGHT_RATIO))
  return Math.max(MIN_GEMINI_TERMINAL_HEIGHT, Math.min(maxHeight, Math.round(value)))
}

const buildConversationContextBlock = (messages: ChatMessage[], maxTurns: number, latestPrompt: string): string => {
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

const appendConversationContext = (prompt: string, messages: ChatMessage[], maxTurns: number, latestPrompt: string): string => {
  const context = buildConversationContextBlock(messages, maxTurns, latestPrompt)
  if (!context) return prompt
  return `${context}\nCurrent user request:\n${prompt}`
}

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
  const summaryText = summaries.length > 0
    ? summaries.map(summarizeReviewDiffFile).join('\n')
    : diffObj?.statusText
      ? `Git status:\n${diffObj.statusText}`
      : diffObj?.text || 'No file-level summary was available.'

  const fullDiffText = collectReviewDiffText(diffObj)
  const diffText = fullDiffText.length > MAX_REVIEW_DIFF_CHARS
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
  scheduledTaskId?: string
  workspaceRecord?: WorkspaceRecord
  chatRecord?: ChatRecord
  preserveComposer?: boolean
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
  toolCallsCount: number
  preSnapshot: any
  workspacePath: string | null
  startedAt: string | null
  diffUnavailable: boolean
  scheduledTaskId: string | null
}

type AgentApprovalAction = 'accept' | 'acceptForSession' | 'acceptForWorkspace' | 'decline' | 'cancel'

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

const WORKTREE_DIFF_UNAVAILABLE_TEXT = 'Gemini worktree mode is active, but the effective worktree path is not known. Diff Studio is disabled so it does not show changes from the original workspace.'
const CODEX_DEFAULT_MODELS = [
  { id: 'gpt-5.5', label: 'GPT-5.5', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }, { reasoningEffort: 'xhigh' }], defaultReasoningEffort: 'medium', additionalSpeedTiers: ['fast'] },
  { id: 'gpt-5.4', label: 'GPT-5.4', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }, { reasoningEffort: 'xhigh' }], defaultReasoningEffort: 'medium', additionalSpeedTiers: ['fast'] },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }, { reasoningEffort: 'xhigh' }], defaultReasoningEffort: 'medium', additionalSpeedTiers: ['fast'] },
  { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }], defaultReasoningEffort: 'low', additionalSpeedTiers: ['fast'] },
] satisfies CodexModelOption[]
const CODEX_DEFAULT_MODEL = CODEX_DEFAULT_MODELS[0].id
const DEFAULT_AGENTIC_SERVICES: AgenticServicesSettings = {
  shellCommands: 'workspace',
  fileChanges: 'ask',
  mcpTools: 'ask',
  networkAccess: 'allow'
}
const CLAUDE_DEFAULT_MODELS = [
  { id: 'default', label: 'Default' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'opus', label: 'Opus' },
  { id: 'haiku', label: 'Haiku' },
  { id: 'best', label: 'Best available' },
] satisfies CodexModelOption[]
const KIMI_DEFAULT_MODELS = [
  { id: 'default', label: 'Default' },
  { id: 'kimi-k2', label: 'Kimi K2' },
  { id: 'kimi-k2-turbo', label: 'Kimi K2 Turbo' },
  { id: 'kimi-latest', label: 'Kimi Latest' },
] satisfies CodexModelOption[]
const GEMINI_MODEL_IDS = new Set(['cli-default', 'auto', 'pro', 'flash', 'flash-lite', 'custom'])
const CLAUDE_MODEL_IDS = new Set(['default', 'sonnet', 'opus', 'haiku', 'best', 'custom'])
const KIMI_MODEL_IDS = new Set(['default', 'kimi-k2', 'kimi-k2-turbo', 'kimi-latest', 'custom'])
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

const getChatProvider = (chat?: ChatRecord | null): ProviderId => chat?.provider || 'gemini'
const getProviderLabel = (provider: ProviderId): string => {
  if (provider === 'codex') return 'Codex'
  if (provider === 'claude') return 'Claude'
  if (provider === 'kimi') return 'Kimi'
  return 'Gemini'
}
const isGeminiModelId = (modelId: string): boolean => GEMINI_MODEL_IDS.has(modelId)
const isCodexModelId = (modelId: string): boolean => modelId.startsWith('gpt-') || modelId.includes('codex')
const isClaudeModelId = (modelId: string): boolean => CLAUDE_MODEL_IDS.has(modelId) || modelId.includes('claude')
const isKimiModelId = (modelId: string): boolean => KIMI_MODEL_IDS.has(modelId) || modelId.includes('kimi')
const normalizeProviderModelKey = (model?: string | null): string => String(model || '').trim().toLowerCase()
const isCompletedCodexRunStatus = (status?: string): boolean => status === 'success' || status === 'success_with_warnings'

const getLastCompletedCodexRunModel = (chat: ChatRecord): string | null => {
  const runs = [...(chat.runs || [])].reverse()
  const run = runs.find((candidate) => (candidate.provider || getChatProvider(chat)) === 'codex' && isCompletedCodexRunStatus(candidate.status))
  return run?.actualModel || run?.requestedModel || null
}

const getCodexModelContextAppliedKeys = (chat: ChatRecord): string[] => {
  const rawKeys = chat.providerMetadata?.codexModelContextAppliedKeys
  return Array.isArray(rawKeys) ? rawKeys.filter((value): value is string => typeof value === 'string') : []
}

const getCodexFiveHourLimit = (model: string): { max?: number; label: string } => {
  const normalized = model.toLowerCase()
  if (normalized.includes('spark')) return { label: 'separate dynamic limit' }
  if (normalized.includes('5.3') && normalized.includes('codex')) return { max: 3000, label: '30-3000 msgs / 5h' }
  if (normalized.includes('5.4-mini') || normalized.includes('mini')) return { max: 7000, label: '60-7000 msgs / 5h' }
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
  const planType = String(codexStatus?.codexUsage?.planType || codexStatus?.planType || '').trim().toLowerCase()
  if (!planType) return true
  return !/(^|[^a-z])(plus|go|free)([^a-z]|$)/.test(planType)
}

const isCodexSparkQuotaLabel = (label: string): boolean =>
  /spark|gpt-5\.3-codex-spark/i.test(label)

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

const buildRateLimitWindow = (id: string, label: string, snapshot: any): UsageWindowAggregate | null => {
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
    usedPercent: remainingPercent
  }
}

const buildCodexUsageWindows = (records: UsageRecord[], model: string, now: number, codexStatus?: any, showAuthoritativeWindows = true): UsageWindowAggregate[] => {
  const authoritativeWindows = Array.isArray(codexStatus?.codexUsage?.windows) ? codexStatus.codexUsage.windows : []
  if (authoritativeWindows.length > 0) {
    if (!showAuthoritativeWindows) {
      return []
    }
    return dedupeCodexQuotaWindows(authoritativeWindows
      .map((windowEntry: any, index: number) => {
        const label = codexQuotaDisplayLabel(String(windowEntry.label || 'Codex quota'))
        const remainingPercent = Math.max(0, Math.min(100, Number(windowEntry.remainingPercent ?? (100 - Number(windowEntry.usedPercent || 0)))))
        return {
          id: `codex-account-${windowEntry.id || index}`,
          label,
          runs: 0,
          totalTokens: 0,
          limitLabel: windowEntry.limitLabel || `${Math.round(remainingPercent)}% remaining`,
          resetAt: windowEntry.resetAt,
          trackingOnly: true,
          usedPercent: remainingPercent
        }
      })
      .filter((windowEntry) => shouldShowCodexSparkWindows(codexStatus) || !isCodexSparkQuotaLabel(windowEntry.label))
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
  const realRateLimitWindows = dedupeCodexQuotaWindows(rateLimitBuckets
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
        windows.push(buildRateLimitWindow(
          `account-${id}-secondary`,
          labelCodexRateLimitBucket(secondaryBucket, model),
          secondaryBucket
        ))
      }
      return windows
    })
    .filter(Boolean)
    .map((windowEntry: any) => ({ ...windowEntry, label: codexQuotaDisplayLabel(windowEntry.label) }))
    .filter((windowEntry: any) => shouldShowCodexSparkWindows(codexStatus) || !isCodexSparkQuotaLabel(windowEntry.label)) as UsageWindowAggregate[])

  if (realRateLimitWindows.length > 0) {
    return realRateLimitWindows.sort((a, b) => {
      return codexQuotaDisplayOrder(a.label) - codexQuotaDisplayOrder(b.label)
    })
  }

  const fiveHourLimit = getCodexFiveHourLimit(model)
  const fiveHourRecords = records.filter((record) => now - record.timestamp <= FIVE_HOURS_MS && record.usageKind !== 'reset_hint')
  const weeklyRecords = records.filter((record) => now - record.timestamp <= WEEK_MS && record.usageKind !== 'reset_hint')
  const fiveHourReset = fiveHourRecords.length > 0
    ? new Date(Math.min(...fiveHourRecords.map((record) => record.timestamp + FIVE_HOURS_MS))).toISOString()
    : undefined
  const weeklyReset = weeklyRecords.length > 0
    ? new Date(Math.min(...weeklyRecords.map((record) => record.timestamp + WEEK_MS))).toISOString()
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
      limitLabel: model.toLowerCase().includes('spark') ? 'separate dynamic weekly cap' : 'weekly cap may apply',
      resetAt: weeklyReset,
      trackingOnly: true
    }
  ]
}

const createWorktreeDiffUnavailable = () => ({
  type: 'error',
  text: WORKTREE_DIFF_UNAVAILABLE_TEXT
})

const resolveGeminiWorktreeConfig = (workspace?: WorkspaceRecord | null): GeminiWorktreeConfig | undefined => {
  const worktree = workspace?.geminiWorktree
  if (!worktree?.enabled) {
    return undefined
  }

  const name = typeof worktree.name === 'string' ? worktree.name.trim() : undefined
  const effectivePath = typeof worktree.effectivePath === 'string' ? worktree.effectivePath.trim() : undefined
  return {
    enabled: true,
    ...(name ? { name } : {}),
    ...(effectivePath ? { effectivePath } : {})
  }
}

const isGeminiWorktreeDiffUnavailable = (worktree?: GeminiWorktreeConfig | null): boolean =>
  Boolean(worktree?.enabled && !worktree.effectivePath)

const getDiffWorkspacePath = (workspace: WorkspaceRecord, worktree?: GeminiWorktreeConfig | null): string =>
  worktree?.enabled && worktree.effectivePath ? worktree.effectivePath : workspace.path

type SettingsPanelUpdate = {
  mode?: AppSettings['appearanceMode']
  visualEffectStyle?: AppSettings['visualEffectStyle']
  themeAppearance?: AppSettings['themeAppearance']
  themeCornerStyle?: AppSettings['themeCornerStyle']
  themeAccentStyle?: AppSettings['themeAccentStyle']
  promptSurfaceStyle?: AppSettings['promptSurfaceStyle']
  reduceTransparency?: boolean
  reduceMotion?: boolean
  compactDensity?: boolean
  geminiCheckpointingEnabled?: boolean
  chatContextTurns?: number
  claudeBinaryPath?: string
  kimiBinaryPath?: string
  agenticServices?: AgenticServicesSettings
  geminiMcpBridgeEnabled?: boolean
  codexSandboxFallback?: CodexSandboxFallbackMode
}

function App(): React.JSX.Element {
  const [, setSettings] = useState<AppSettings | null>(null)
  const [chatContextTurns, setChatContextTurns] = useState<number>(DEFAULT_CONTEXT_TURNS)
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([])
  const [currentWorkspace, setCurrentWorkspace] = useState<WorkspaceRecord | null>(null)
  
  const [chats, setChats] = useState<ChatRecord[]>([])
  const [currentChat, setCurrentChat] = useState<ChatRecord | null>(null)

  const [prompt, setPrompt] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [queuedRuns, setQueuedRuns] = useState<QueuedRunRequest[]>([])
  
  // Model & Mode Selectors
  const [activeProvider, setActiveProvider] = useState<ProviderId>('gemini')
  const [selectedModelType, setSelectedModelType] = useState<string>('flash-lite')
  const [lastNonCustomModelType, setLastNonCustomModelType] = useState<string>('flash-lite')
  const [customModel, setCustomModel] = useState('')
  const [codexModels, setCodexModels] = useState<CodexModelOption[]>(CODEX_DEFAULT_MODELS)
  const [codexStatus, setCodexStatus] = useState<any>(null)
  const [codexMcpStatus, setCodexMcpStatus] = useState<any>(null)
  const [codexThreads, setCodexThreads] = useState<any[]>([])
  const [agentStatusByProvider, setAgentStatusByProvider] = useState<Partial<Record<ProviderId, any>>>({})
  const [agentMcpStatusByProvider, setAgentMcpStatusByProvider] = useState<Partial<Record<ProviderId, any>>>({})
  const [agentModelsByProvider, setAgentModelsByProvider] = useState<Partial<Record<ProviderId, CodexModelOption[]>>>({})
  const [codexReasoningEffort, setCodexReasoningEffort] = useState<string>('medium')
  const [codexServiceTier, setCodexServiceTier] = useState<string>('')
  const [approvalMode, setApprovalMode] = useState<string>('default')
  const [claudeBinaryPath, setClaudeBinaryPath] = useState('')
  const [kimiBinaryPath, setKimiBinaryPath] = useState('')
  const [agenticServices, setAgenticServices] = useState<AgenticServicesSettings>(DEFAULT_AGENTIC_SERVICES)
  const [agenticWorkspaceGrantCount, setAgenticWorkspaceGrantCount] = useState(0)
  const [geminiMcpBridgeEnabled, setGeminiMcpBridgeEnabledState] = useState(false)
  const [geminiMcpBridgeStatus, setGeminiMcpBridgeStatus] = useState<GeminiMcpBridgeStatus | null>(null)
  const [codexSandboxFallback, setCodexSandboxFallback] = useState<CodexSandboxFallbackMode>('ask_rerun')
  
  // Trust & Session
  const [trustResult, setTrustResult] = useState<any>(null)
  const [sessionTrust, setSessionTrust] = useState(false)
  const [showTerminal, setShowTerminal] = useState(false)
  const [isPersistentSessionEnabled, setIsPersistentSessionEnabled] = useState(false)
  const [persistentSessionStatus, setPersistentSessionStatus] = useState<PersistentSessionStatus>('idle')
  const [persistentSessionNeedsRestart, setPersistentSessionNeedsRestart] = useState(false)
  const [geminiCheckpointingEnabled, setGeminiCheckpointingEnabled] = useState(false)

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
  const [rightTab, setRightTab] = useState<'diff' | 'raw' | 'safety' | 'capabilities'>('diff')
  
  // Version Preflight
  const [geminiVersion, setGeminiVersion] = useState<string>('unknown')

  // Appearance & Settings
  const appearance = useAppearance()
  const [showSettings, setShowSettings] = useState(false)
  const [showWorkspaceSidebar, setShowWorkspaceSidebar] = useState(true)
  const [workspaceSidebarWidth, setWorkspaceSidebarWidth] = useState(getStoredWorkspaceSidebarWidth)
  const [showFileEditor, setShowFileEditor] = useState(false)
  const [showGeminiTerminal, setShowGeminiTerminal] = useState(false)
  const [geminiTerminalInput, setGeminiTerminalInput] = useState('')
  const [geminiTerminalHeight, setGeminiTerminalHeight] = useState(DEFAULT_GEMINI_TERMINAL_HEIGHT)
  const [showGhostCompanion, setShowGhostCompanion] = useState(getStoredGhostCompanionEnabled)
  const [showSkyVisualFx, setShowSkyVisualFx] = useState(getStoredSkyVisualFxEnabled)
  const [hostWeather, setHostWeather] = useState<HostWeatherVisualState | null>(null)
  const [fileEditorWidth, setFileEditorWidth] = useState(getStoredFileEditorWidth)
  const [runCompleteNotice, setRunCompleteNotice] = useState<RunCompleteNotice | null>(null)
  const [chatContextNotice, setChatContextNotice] = useState<{ id: string; message: string } | null>(null)
  const [usageSummary, setUsageSummary] = useState<ModelUsageAggregate[]>([])
  const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>([])
  const [permissionRequestPaths, setPermissionRequestPaths] = useState<string[]>([])
  const [permissionRequestMessage, setPermissionRequestMessage] = useState('')
  const [permissionRequestKind, setPermissionRequestKind] = useState<GeminiPermissionRequest['kind'] | null>(null)
  const [permissionRequestSource, setPermissionRequestSource] = useState<GeminiPermissionRequest['source'] | null>(null)
  const [pendingAgentApproval, setPendingAgentApproval] = useState<AgentApprovalRequest | null>(null)
  const [isSendConfirming, setIsSendConfirming] = useState(false)
  const [isComposerDragOver, setIsComposerDragOver] = useState(false)
  const [pendingPlanChoice, setPendingPlanChoice] = useState<PlanChoiceState | null>(null)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('')
  const [discoveredCommands, setDiscoveredCommands] = useState<CommandPaletteItem[]>([])
  const [commandDiscoveryStatus, setCommandDiscoveryStatus] = useState('Static Gemini commands loaded.')
  const [isMemoryInspectorOpen, setIsMemoryInspectorOpen] = useState(false)
  const [geminiMemoryFiles, setGeminiMemoryFiles] = useState<GeminiMemoryFile[]>([])
  const [geminiMemoryStatus, setGeminiMemoryStatus] = useState('GEMINI.md memory has not been inspected yet.')
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([])
  const [scheduleRunAt, setScheduleRunAt] = useState('')
  const [dueScheduledTasks, setDueScheduledTasks] = useState<ScheduledTask[]>([])
  const [runningChatIds, setRunningChatIds] = useState<Set<string>>(new Set())
  const [runningProviders, setRunningProviders] = useState<Set<ProviderId>>(new Set())

  const imageDragCounterRef = useRef(0)
  const sendConfirmationTimeoutRef = useRef<number | null>(null)

  // Error handling & Fallback
  const [showFallbackUX, setShowFallbackUX] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const errorCountRef = useRef(0)
  const toolCallsCountRef = useRef(0)
  
  const logsEndRef = useRef<HTMLDivElement>(null)
  const rawLogsEndRef = useRef<HTMLDivElement>(null)
  const geminiTerminalEndRef = useRef<HTMLDivElement>(null)
  const appTranscriptRef = useRef<HTMLDivElement>(null)
  const composerAreaRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<GeminiStreamAdapter | null>(null)
  const activeRunsRef = useRef<Map<string, ActiveRunContext>>(new Map())
  const activeRunByProviderRef = useRef<Map<ProviderId, string>>(new Map())
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
  const activeRunUsageResetHintsRef = useRef<Map<string, { resetAt?: string; resetText?: string }>>(new Map())
  const latestRunRequestRef = useRef<QueuedRunRequest | null>(null)
  const runSchedulerBusyRef = useRef(false)
  const persistentSessionActiveRef = useRef(false)
  const activeScheduledTaskIdRef = useRef<string | null>(null)
  const currentProvider = currentChat ? getChatProvider(currentChat) : activeProvider
  const isCurrentProviderRunning = runningProviders.has(currentProvider)
  const isCurrentChatProviderLocked = Boolean(
    currentChat && (
      (currentChat.messages?.length || 0) > 0 ||
      (currentChat.runs?.length || 0) > 0 ||
      Boolean(currentChat.linkedGeminiSessionId) ||
      Boolean(currentChat.linkedProviderSessionId)
    )
  )
  const codexExternalPathGrants = currentProvider === 'codex'
    ? normalizeExternalPathGrants(currentChat?.providerMetadata?.codexExternalPathGrants)
    : []

  const triggerSendConfirmation = () => {
    if (!currentWorkspace || !currentChat || !prompt.trim()) return
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
      setRawLogs(prev => [...prev, log].slice(-1000))
      return
    }
    const previous = rawLogsByChatIdRef.current.get(chatId) || []
    setThreadRawLogs(chatId, [...previous, log])
  }

  const syncRunningState = () => {
    const activeRuns = activeRunsRef.current
    runSchedulerBusyRef.current = activeRuns.size > 0
    setIsRunning(activeRuns.size > 0)
    setRunningProviders(new Set(activeRunByProviderRef.current.keys()))
  }

  const isProviderBusy = (provider: ProviderId): boolean => activeRunByProviderRef.current.has(provider)

  const getRouteProvider = (value: unknown, fallback: ProviderId): ProviderId => {
    if (value && typeof value === 'object') {
      const provider = (value as RunRouteEventPayload).provider
      if (provider === 'gemini' || provider === 'codex' || provider === 'claude' || provider === 'kimi') {
        return provider
      }
    }
    return fallback
  }

  const getRouteRunId = (value: unknown): string | undefined =>
    value && typeof value === 'object' && typeof (value as RunRouteEventPayload).appRunId === 'string'
      ? (value as RunRouteEventPayload).appRunId
      : undefined

  const getRouteChatId = (value: unknown): string | undefined =>
    value && typeof value === 'object' && typeof (value as RunRouteEventPayload).appChatId === 'string'
      ? (value as RunRouteEventPayload).appChatId
      : undefined

  const resolveActiveRunContext = (provider: ProviderId, appRunId?: string, appChatId?: string): ActiveRunContext | null => {
    if (appRunId) {
      const byRunId = activeRunsRef.current.get(appRunId)
      if (byRunId) return byRunId
    }
    if (appChatId) {
      for (const context of activeRunsRef.current.values()) {
        if (context.chatId === appChatId && context.provider === provider) return context
      }
    }
    const providerRunId = activeRunByProviderRef.current.get(provider)
    return providerRunId ? activeRunsRef.current.get(providerRunId) || null : null
  }

  const clearActiveRunContext = (context: ActiveRunContext | null) => {
    if (!context) return
    activeRunsRef.current.delete(context.runId)
    const providerRunId = activeRunByProviderRef.current.get(context.provider)
    if (providerRunId === context.runId) {
      activeRunByProviderRef.current.delete(context.provider)
    }
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
    setRunningChatIds(prev => {
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

  const updateChatById = (chatId: string | null | undefined, updater: (chat: ChatRecord) => ChatRecord): ChatRecord | null => {
    if (!chatId) return null
    const base = chatByIdRef.current.get(chatId) ||
      (activeRunChatSnapshotRef.current?.appChatId === chatId ? activeRunChatSnapshotRef.current : null)
    if (!base) return null

    const updated = updater(base)
    chatByIdRef.current.set(chatId, updated)
    if (activeRunChatIdRef.current === chatId) {
      activeRunChatSnapshotRef.current = updated
    }
    setChats(prev => {
      const index = prev.findIndex(chat => chat.appChatId === chatId)
      if (index < 0) return [updated, ...prev]
      return prev.map(chat => chat.appChatId === chatId ? updated : chat)
    })
    setCurrentChat(prev => prev?.appChatId === chatId ? updated : prev)
    window.api.saveChat(updated).catch(() => {})
    return updated
  }

  const getProviderModelOptions = (provider: ProviderId): CodexModelOption[] => {
    if (provider === 'codex') return codexModels
    if (provider === 'claude') return agentModelsByProvider.claude || CLAUDE_DEFAULT_MODELS
    if (provider === 'kimi') return agentModelsByProvider.kimi || KIMI_DEFAULT_MODELS
    return []
  }

  const getDefaultModelForProvider = (provider: ProviderId): string => {
    if (provider === 'codex') return codexModels[0]?.id || CODEX_DEFAULT_MODEL
    if (provider === 'claude') return 'default'
    if (provider === 'kimi') return 'default'
    return 'flash-lite'
  }

  const isValidModelForProvider = (provider: ProviderId, modelId: string | undefined | null): modelId is string => {
    if (!modelId) return false
    if (modelId === 'custom') return true
    if (provider === 'codex') return isCodexModelId(modelId)
    if (provider === 'claude') return isClaudeModelId(modelId)
    if (provider === 'kimi') return isKimiModelId(modelId)
    return isGeminiModelId(modelId)
  }

  const getLastRequestedModelForProvider = (chat: ChatRecord, provider: ProviderId): string | undefined => {
    const runs = [...(chat.runs || [])].reverse()
    const run = runs.find((candidate) => (candidate.provider || getChatProvider(chat)) === provider)
    return run?.requestedModel || run?.actualModel || chat.requestedModel
  }

  const getChatComposerSelection = (chat: ChatRecord, providerOverride?: ProviderId) => {
    const provider = providerOverride || getChatProvider(chat)
    const metadata = chat.providerMetadata || {}
    const metadataModel = typeof metadata.selectedModelType === 'string' ? metadata.selectedModelType : undefined
    const runModel = getLastRequestedModelForProvider(chat, provider)
    const selected = isValidModelForProvider(provider, metadataModel)
      ? metadataModel
      : isValidModelForProvider(provider, runModel)
        ? runModel
        : getDefaultModelForProvider(provider)
    const modelOption = provider === 'codex' ? codexModels.find((model) => model.id === selected) : undefined
    return {
      provider,
      selectedModelType: selected,
      customModel: typeof metadata.customModel === 'string' ? metadata.customModel : '',
      approvalMode: typeof metadata.approvalMode === 'string'
        ? metadata.approvalMode
        : chat.settingsSnapshot?.approvalMode || approvalMode,
      codexReasoningEffort: typeof metadata.codexReasoningEffort === 'string'
        ? metadata.codexReasoningEffort
        : modelOption?.defaultReasoningEffort || 'medium',
      codexServiceTier: typeof metadata.codexServiceTier === 'string'
        ? metadata.codexServiceTier
        : ''
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
    if (currentWorkspace?.id === chat.workspaceId) return currentWorkspace
    const knownWorkspace = workspaces.find((workspace) => workspace.id === chat.workspaceId)
    if (knownWorkspace) return knownWorkspace
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

  const refreshProviderMetadata = async (provider: ProviderId) => {
    if (provider === 'gemini' || typeof window.api.getAgentStatus !== 'function') {
      return
    }
    if (typeof window.api.getAgentModels === 'function') {
      window.api.getAgentModels(provider)
        .then((models) => {
          const normalized = Array.isArray(models) && models.length > 0
            ? models.map((model) => ({ ...model, label: model.label || model.id }))
            : provider === 'claude' ? CLAUDE_DEFAULT_MODELS : provider === 'kimi' ? KIMI_DEFAULT_MODELS : CODEX_DEFAULT_MODELS
          if (provider === 'codex') {
            setCodexModels(normalized)
          } else {
            setAgentModelsByProvider(prev => ({ ...prev, [provider]: normalized }))
          }
        })
        .catch(() => {
          if (provider === 'codex') setCodexModels(CODEX_DEFAULT_MODELS)
          if (provider === 'claude') setAgentModelsByProvider(prev => ({ ...prev, claude: CLAUDE_DEFAULT_MODELS }))
          if (provider === 'kimi') setAgentModelsByProvider(prev => ({ ...prev, kimi: KIMI_DEFAULT_MODELS }))
        })
    }
    window.api.getAgentStatus(provider)
      .then((status) => {
        if (provider === 'codex') {
          setCodexStatus(status)
          if (currentWorkspaceIdRef.current) {
            void refreshUsageSummary(currentWorkspaceIdRef.current, 'codex', status)
          }
        } else {
          setAgentStatusByProvider(prev => ({ ...prev, [provider]: status }))
        }
      })
      .catch(() => {
        if (provider === 'codex') setCodexStatus(null)
        else setAgentStatusByProvider(prev => ({ ...prev, [provider]: null }))
      })
    if (typeof window.api.getAgentMcpStatus === 'function') {
      window.api.getAgentMcpStatus(provider)
        .then((status) => {
          if (provider === 'codex') setCodexMcpStatus(status)
          else setAgentMcpStatusByProvider(prev => ({ ...prev, [provider]: status }))
        })
        .catch(() => {
          if (provider === 'codex') setCodexMcpStatus(null)
          else setAgentMcpStatusByProvider(prev => ({ ...prev, [provider]: null }))
        })
    }
  }

  const normalizeDiffPath = (value: string, workspacePathOverride?: string | null): string => {
    const normalized = value.replace(/\\/g, '/')
    const workspacePath = (workspacePathOverride || activeRunWorkspacePathRef.current || '').replace(/\\/g, '/')
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

  const getRunFileDiffSummaries = (runDiffValue?: DiffFileSummary[] | RunDiffResult | null): DiffFileSummary[] => {
    if (!runDiffValue) {
      return []
    }
    const candidates = Array.isArray(runDiffValue)
      ? runDiffValue
      : [
          ...runDiffValue.createdFiles,
          ...runDiffValue.modifiedFiles,
          ...runDiffValue.deletedFiles,
        ]
    return candidates.filter(isFileSummaryRecord)
  }

  const summarizeWriteToolForDiff = (activity: ToolActivity, workspacePath?: string | null): { path: string; status: 'created' | 'modified' | 'deleted'; additions: number; deletions: number } | null => {
    const toolName = (activity.toolName || '').toLowerCase()
    const status: 'created' | 'modified' | 'deleted' | null =
      toolName === 'create_file' ? 'created'
        : toolName === 'delete_file' ? 'deleted'
          : RUN_WRITE_TOOLS.includes(toolName) ? 'modified' : null
    if (!status) return null

    const rawPath = typeof activity.parameters?.file_path === 'string' && activity.parameters.file_path.trim()
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

    setRunDiff(prev => {
      const next = [...(prev || [])]
      const existingIndex = next.findIndex(item => item.path === change.path)
      if (existingIndex >= 0) {
        const existing = next[existingIndex]
        const mergedStatus = existing.status === 'created' ? 'created'
          : change.status === 'created' ? 'created'
            : change.status === 'deleted' ? 'deleted'
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

  // Initialize
  useEffect(() => {
    loadInitialData()
    window.api.getGeminiVersion().then(v => setGeminiVersion(v))
  }, [])

  useEffect(() => {
    if (!chatContextNotice) return
    const timeout = window.setTimeout(() => {
      setChatContextNotice((current) => current?.id === chatContextNotice.id ? null : current)
    }, 4500)
    return () => window.clearTimeout(timeout)
  }, [chatContextNotice])

  const loadInitialData = async () => {
    const s = await window.api.getSettings()
    setSettings(s)
    setActiveProvider(s.activeProvider || 'gemini')
    setClaudeBinaryPath(s.claudeBinaryPath || '')
    setKimiBinaryPath(s.kimiBinaryPath || '')
    setAgenticServices({ ...DEFAULT_AGENTIC_SERVICES, ...(s.agenticServices || {}) })
    setAgenticWorkspaceGrantCount(Array.isArray(s.agenticWorkspaceGrants) ? s.agenticWorkspaceGrants.length : 0)
    setGeminiMcpBridgeEnabledState(Boolean(s.geminiMcpBridgeEnabled))
    setGeminiMcpBridgeStatus(s.geminiMcpBridgeLastStatus || null)
    setCodexSandboxFallback(s.codexSandboxFallback || 'ask_rerun')
    setChatContextTurns(clampContextTurns(s.chatContextTurns))
    setGeminiCheckpointingEnabled(Boolean(s.geminiCheckpointingEnabled))
    void refreshProviderMetadata(s.activeProvider || 'gemini')
    if (typeof window.api.getGeminiMcpBridgeStatus === 'function') {
      void window.api.getGeminiMcpBridgeStatus().then(setGeminiMcpBridgeStatus).catch(() => {})
    }
    const wsList = await window.api.getWorkspaces()
    setWorkspaces(wsList)
    if (wsList.length > 0) {
      // Sort by lastOpenedAt descending
      const sorted = [...wsList].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
      handleSelectExistingWorkspace(sorted[0])
    }
  }

  const handleSettingsChange = (next: SettingsPanelUpdate) => {
    const nextChatContextTurns =
      next.chatContextTurns === undefined
        ? undefined
        : clampContextTurns(next.chatContextTurns)

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
      } else if (next.visualEffectStyle === 'classic' || next.visualEffectStyle === 'liquid_glass') {
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
        setRawLogs(prev => [...prev, { type: 'info', content: 'Gemini checkpointing setting changed. Restart the persistent session to apply --checkpointing.' }])
      }
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
    }
    if (next.geminiMcpBridgeEnabled !== undefined) {
      const enabled = Boolean(next.geminiMcpBridgeEnabled)
      setGeminiMcpBridgeEnabledState(enabled)
      settingsPatch.geminiMcpBridgeEnabled = enabled
      if (typeof window.api.setGeminiMcpBridgeEnabled === 'function') {
        window.api.setGeminiMcpBridgeEnabled(enabled)
          .then((status) => setGeminiMcpBridgeStatus(status))
          .catch((error) => {
            setRawLogs(prev => [...prev, { type: 'stderr', content: `Failed to update Gemini MCP bridge: ${redactLog(String(error))}` }])
          })
      }
    }
    if (next.codexSandboxFallback !== undefined) {
      setCodexSandboxFallback(next.codexSandboxFallback)
      settingsPatch.codexSandboxFallback = next.codexSandboxFallback
    }

    if (Object.keys(settingsPatch).length > 0) {
      window.api.updateSettings(settingsPatch)
        .then(() => providersToRefresh.forEach((provider) => void refreshProviderMetadata(provider)))
        .catch(() => {})
      setSettings(prev => prev ? { ...prev, ...settingsPatch } : prev)
    }
  }

  const handleProviderChange = async (provider: ProviderId) => {
    if (currentChat && isCurrentChatProviderLocked && provider !== currentProvider) {
      setRawLogs(prev => [...prev, {
        type: 'info',
        content: 'Provider is locked for this chat (' + currentProvider + '). Create a new chat to use ' + provider + '.'
      }])
      return
    }
    const nextModel = getDefaultModelForProvider(provider)
    const nextMetadata = {
      selectedModelType: nextModel,
      customModel: '',
      approvalMode
    }
    setActiveProvider(provider)
    setSelectedModelType(nextModel)
    setLastNonCustomModelType(nextModel)
    setCustomModel('')
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
      setChats(prev => prev.map(chat => chat.appChatId === currentChat.appChatId ? updatedChat : chat))
      window.api.saveChat(updatedChat).catch(() => {})
    }
    setPendingAgentApproval(null)
    window.api.updateSettings({ activeProvider: provider }).catch(() => {})
    void refreshProviderMetadata(provider)
    if (currentWorkspaceIdRef.current) {
      void refreshUsageSummary(currentWorkspaceIdRef.current, provider)
    }
    if (provider === 'codex') {
      if (typeof window.api.listAgentThreads === 'function') {
        window.api.listAgentThreads('codex', { cwd: currentWorkspace?.path || null })
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

  const handleGeminiWorktreeToggle = async () => {
    if (!currentWorkspace || isRunning) {
      return
    }

    const isEnabled = Boolean(resolveGeminiWorktreeConfig(currentWorkspace)?.enabled)
    const geminiWorktree: GeminiWorktreeConfig = isEnabled
      ? { enabled: false }
      : { enabled: true }

    const updatedWorkspace = await window.api.addOrUpdateWorkspace(currentWorkspace.path, { geminiWorktree })
    setCurrentWorkspace(updatedWorkspace)
    setWorkspaces(prev => prev.map(workspace => workspace.id === updatedWorkspace.id ? updatedWorkspace : workspace))
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
      setRawLogs(prev => [...prev, { type: 'info', content: 'Gemini worktree setting changed. Restart the persistent session to apply --worktree.' }])
    }
  }

  const refreshCodexThreads = async () => {
    if (typeof window.api.listAgentThreads !== 'function') {
      setCodexThreads([])
      return
    }
    try {
      const response = await window.api.listAgentThreads('codex', { cwd: currentWorkspace?.path || null })
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
    setChats(prev => prev.map(chat => chat.appChatId === updatedChat.appChatId ? updatedChat : chat))
    await window.api.saveChat(updatedChat)
    setRawLogs(prev => [...prev, { type: 'info', content: `Linked Codex thread: ${threadId}` }])
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
      setRawLogs(prev => [...prev, { type: 'stderr', content: `Failed to fork Codex thread: ${redactLog(String(error))}` }])
    }
  }

  const handleSelectExistingWorkspace = async (ws: WorkspaceRecord) => {
    const geminiSessionApi = window.api as any
    if (persistentSessionActiveRef.current && typeof geminiSessionApi.stopGeminiSession === 'function') {
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
    setDiff(selectedProvider === 'gemini' && isGeminiWorktreeDiffUnavailable(resolveGeminiWorktreeConfig(ws)) ? createWorktreeDiffUnavailable() : null)
    void refreshProviderMetadata(selectedProvider)
    setRunDiff(null)
    setRunCompleteNotice(null)
    setRawLogs(rawLogsByChatIdRef.current.get(selectedChat.appChatId) || [])
    setShowFallbackUX(false)
    setImageAttachments([])
    clearImagePermissions()
    setSessionTrust(false)
    setPendingPlanChoice(null)
    setIsThinking(runningChatIds.has(selectedChat.appChatId))
    if (selectedProvider === 'codex' && typeof window.api.listAgentThreads === 'function') {
      window.api.listAgentThreads('codex', { cwd: ws.path })
        .then((response) => setCodexThreads(Array.isArray(response?.data) ? response.data : []))
        .catch(() => setCodexThreads([]))
    }
    
    // Check trust
    const tr = await window.api.checkTrust(ws.path)
    setTrustResult(tr)
  }

  const refreshUsageSummary = async (workspaceId?: string, providerHint?: ProviderId, codexStatusHint?: any) => {
    if (!workspaceId) {
      setUsageSummary([])
      return
    }

    const records: UsageRecord[] = await window.api.getUsage(workspaceId)
    const grouped = new Map<string, ModelUsageAggregate>()
    const groupedRecords = new Map<string, UsageRecord[]>()
    const now = Date.now()

    for (const record of records) {
      const provider = record.provider || 'gemini'
      const modelName = normalizeModelName(record.model || 'unknown')
      const groupKey = `${provider}:${modelName}`
      const existing = grouped.get(groupKey)
      const isResetHint = record.usageKind === 'reset_hint'
      groupedRecords.set(groupKey, [...(groupedRecords.get(groupKey) || []), record])

      if (existing) {
        if (!isResetHint) {
          existing.runs += 1
          existing.inputTokens += record.inputTokens || 0
          existing.outputTokens += record.outputTokens || 0
          existing.totalTokens += record.totalTokens || 0
          existing.durationMs += record.durationMs || 0
        }
        if (record.inputTokenLimit && !existing.inputTokenLimit) {
          existing.inputTokenLimit = record.inputTokenLimit
        } else if (record.inputTokenLimit && existing.inputTokenLimit) {
          existing.inputTokenLimit = Math.max(existing.inputTokenLimit, record.inputTokenLimit)
        }
        if (record.outputTokenLimit && !existing.outputTokenLimit) {
          existing.outputTokenLimit = record.outputTokenLimit
        } else if (record.outputTokenLimit && existing.outputTokenLimit) {
          existing.outputTokenLimit = Math.max(existing.outputTokenLimit, record.outputTokenLimit)
        }
        if (record.totalTokenLimit && !existing.totalTokenLimit) {
          existing.totalTokenLimit = record.totalTokenLimit
        } else if (record.totalTokenLimit && existing.totalTokenLimit) {
          existing.totalTokenLimit = Math.max(existing.totalTokenLimit, record.totalTokenLimit)
        }
        const mergedReset = mergeUsageReset(
          { resetAt: existing.resetAt, resetText: existing.resetText },
          { resetAt: record.resetAt, resetText: record.resetText }
        )
        existing.resetAt = mergedReset.resetAt
        existing.resetText = mergedReset.resetText
      } else {
        grouped.set(groupKey, {
          provider,
          model: modelName,
          runs: isResetHint ? 0 : 1,
          inputTokens: isResetHint ? 0 : record.inputTokens || 0,
          outputTokens: isResetHint ? 0 : record.outputTokens || 0,
          totalTokens: isResetHint ? 0 : record.totalTokens || 0,
          durationMs: isResetHint ? 0 : record.durationMs || 0,
          inputTokenLimit: record.inputTokenLimit || undefined,
          outputTokenLimit: record.outputTokenLimit || undefined,
          totalTokenLimit: record.totalTokenLimit || undefined,
          resetAt: record.resetAt || undefined,
          resetText: record.resetText || undefined
        })
      }
    }

    const effectiveCodexStatus = codexStatusHint ?? codexStatus
    const selectedChat = currentChatIdRef.current ? chatByIdRef.current.get(currentChatIdRef.current) : currentChat
    const effectiveProvider = providerHint || (selectedChat ? getChatProvider(selectedChat) : currentProvider)
    const hasAuthoritativeCodexWindows = Array.isArray(effectiveCodexStatus?.codexUsage?.windows) && effectiveCodexStatus.codexUsage.windows.length > 0
    const hasCodexRateLimitWindows = Boolean(effectiveCodexStatus?.rateLimits) || Boolean(
      effectiveCodexStatus?.rateLimitsByLimitId &&
      typeof effectiveCodexStatus.rateLimitsByLimitId === 'object' &&
      Object.keys(effectiveCodexStatus.rateLimitsByLimitId).length > 0
    )
    const hasCodexUsage = Array.from(grouped.values()).some((aggregate) => aggregate.provider === 'codex')

    const shouldUseCodexQuotaOnly = effectiveProvider === 'codex' || hasCodexUsage || hasAuthoritativeCodexWindows || hasCodexRateLimitWindows

    if (shouldUseCodexQuotaOnly) {
      for (const [groupKey, aggregate] of Array.from(grouped.entries())) {
        if (aggregate.provider === 'codex') {
          grouped.delete(groupKey)
          groupedRecords.delete(groupKey)
        }
      }

      const codexUsageGroupKey = 'codex:usage-limits'
      grouped.set(codexUsageGroupKey, {
        provider: 'codex',
        model: 'usage limits',
        runs: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        durationMs: 0,
        windows: buildCodexUsageWindows([], 'usage limits', now, effectiveCodexStatus, true)
      })
      groupedRecords.set(codexUsageGroupKey, [])
    } else {
      for (const [groupKey, aggregate] of grouped.entries()) {
        if (aggregate.provider === 'codex') {
          aggregate.windows = buildCodexUsageWindows(
            groupedRecords.get(groupKey) || [],
            aggregate.model,
            now,
            effectiveCodexStatus,
            true
          )
        }
      }
    }

    const visibleAggregates = Array.from(grouped.values()).filter((aggregate) => aggregate.provider === effectiveProvider)
    const sorted = visibleAggregates.sort((a, b) => {
      if (shouldUseCodexQuotaOnly) {
        const aIsCodexQuota = a.provider === 'codex' && a.model === 'usage limits'
        const bIsCodexQuota = b.provider === 'codex' && b.model === 'usage limits'
        if (aIsCodexQuota !== bIsCodexQuota) {
          return aIsCodexQuota ? -1 : 1
        }
      }
      if (b.totalTokens === a.totalTokens) {
        return b.runs - a.runs
      }
      return b.totalTokens - a.totalTokens
    })

    setUsageSummary(sorted)
  }

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
      setChats([])
      setUsageSummary([])
    }
  }

  const handleNewChat = async (wsId: string, wsPath: string) => {
    const newChat = await window.api.createChat(wsId, wsPath)
    const provider = getChatProvider(newChat)
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
    setImageAttachments([])
    clearImagePermissions()
    setPendingPlanChoice(null)
    setIsThinking(runningChatIds.has(newChat.appChatId))
  }

  const handleWelcomeSuggestion = (suggestion: string) => {
    setPrompt(suggestion)
  }

  const refreshCommandDiscovery = async (workspacePath: string | undefined = currentWorkspace?.path) => {
    const discoveryApi = window.api as any
    if (!workspacePath || typeof discoveryApi.discoverGeminiCommands !== 'function') {
      setDiscoveredCommands([])
      setCommandDiscoveryStatus('Static Gemini commands loaded. Custom command discovery is unavailable.')
      return
    }

    setCommandDiscoveryStatus('Discovering custom Gemini commands...')
    try {
      const commands = normalizeDiscoveredCommandItems(await discoveryApi.discoverGeminiCommands(workspacePath))
      setDiscoveredCommands(commands)
      setCommandDiscoveryStatus(commands.length > 0
        ? `Discovered ${commands.length} custom command${commands.length === 1 ? '' : 's'}.`
        : 'Static Gemini commands loaded. No custom command files found.')
    } catch (error) {
      setDiscoveredCommands([])
      setCommandDiscoveryStatus(`Static Gemini commands loaded. Discovery failed: ${redactLog(String(error))}`)
    }
  }

  const refreshGeminiMemory = async (workspacePath: string | undefined = currentWorkspace?.path) => {
    const memoryApi = window.api as any
    if (!workspacePath || typeof memoryApi.discoverGeminiMemory !== 'function') {
      setGeminiMemoryFiles([])
      setGeminiMemoryStatus('GEMINI.md discovery is unavailable.')
      return
    }

    setGeminiMemoryStatus('Inspecting GEMINI.md files...')
    try {
      const memoryFiles = await memoryApi.discoverGeminiMemory(workspacePath)
      const normalized = Array.isArray(memoryFiles) ? memoryFiles.filter((item) => item?.path && item?.displayPath) : []
      setGeminiMemoryFiles(normalized)
      setGeminiMemoryStatus(normalized.length > 0
        ? `Found ${normalized.length} GEMINI.md file${normalized.length === 1 ? '' : 's'}.`
        : 'No workspace or global GEMINI.md files found.')
    } catch (error) {
      setGeminiMemoryFiles([])
      setGeminiMemoryStatus(`GEMINI.md inspection failed: ${redactLog(String(error))}`)
    }
  }

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

    setPermissionRequestPaths(prev => {
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
    setPermissionRequestMessage(request.message.length > 240 ? `${request.message.slice(0, 240)}...` : request.message)
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
    setImageAttachments(prev => mergeImageAttachments(prev, parsed))
  }

  const handlePickImages = async () => {
    const selected = await window.api.selectImageFiles()
    if (!selected || selected.length === 0) return
    addImageAttachments(selected)
    if (imageAttachments.length + selected.length > MAX_IMAGE_ATTACHMENTS) {
      setRawLogs(prev => [...prev, { type: 'info', content: `Attachment limit reached (${MAX_IMAGE_ATTACHMENTS}); oldest files were removed.` }])
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
      setRawLogs(prev => [...prev, { type: 'info', content: `Attachment limit reached (${MAX_IMAGE_ATTACHMENTS}); oldest files were removed.` }])
    }
  }

  const handleRemoveImageAttachment = (id: string) => {
    setImageAttachments(prev => prev.filter(item => item.id !== id))
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
    setChats(prev => prev.map(chat => chat.appChatId === updatedChat.appChatId ? updatedChat : chat))
    window.api.saveChat(updatedChat)
  }

  const handlePickExternalPathGrant = async (access: 'read' | 'write') => {
    if (currentProvider !== 'codex' || !currentChat || !currentWorkspace || typeof window.api.selectExternalPathGrant !== 'function') {
      return
    }
    const grant = await window.api.selectExternalPathGrant(access)
    if (!grant) return
    const nextGrant: ExternalPathGrant = {
      ...grant,
      workspaceId: currentWorkspace.id,
      chatId: currentChat.appChatId,
      duration: 'thisThread'
    }
    updateCodexExternalPathGrants([...codexExternalPathGrants, nextGrant])
    setRawLogs(prev => [...prev, { type: 'info', content: `Granted Codex ${access} access to external ${nextGrant.kind}: ${nextGrant.path}` }])
  }

  const handleRemoveExternalPathGrant = (id: string) => {
    updateCodexExternalPathGrants(codexExternalPathGrants.filter((grant) => grant.id !== id))
  }

  const handleSelectChat = async (chat: ChatRecord) => {
    const provider = getChatProvider(chat)
    const workspaceForChat = getWorkspaceForChat(chat)
    if (workspaceForChat && currentWorkspace?.id !== workspaceForChat.id) {
      const geminiSessionApi = window.api as any
      if (persistentSessionActiveRef.current && typeof geminiSessionApi.stopGeminiSession === 'function') {
        geminiSessionApi.stopGeminiSession().catch(() => {})
      }
      persistentSessionActiveRef.current = false
      setIsPersistentSessionEnabled(false)
      setPersistentSessionStatus('idle')
      setPersistentSessionNeedsRestart(false)
      setCurrentWorkspace(workspaceForChat)
      currentWorkspaceIdRef.current = workspaceForChat.id
      window.api.checkTrust(workspaceForChat.path).then(setTrustResult).catch(() => {})
    } else {
      currentWorkspaceIdRef.current = chat.workspaceId
    }
    currentChatIdRef.current = chat.appChatId
    chatByIdRef.current.set(chat.appChatId, chat)
    setCurrentChat(chat)
    applyChatComposerSelection(chat, provider)
    if (provider === 'codex') {
      setShowGeminiTerminal(false)
    }
    void refreshUsageSummary(chat.workspaceId, provider)
    setRunDiff(null)
    setRunCompleteNotice(null)
    setRawLogs(rawLogsByChatIdRef.current.get(chat.appChatId) || [])
    setShowFallbackUX(false)
    setImageAttachments([])
    clearImagePermissions()
    setPendingPlanChoice(null)
    setIsThinking(runningChatIds.has(chat.appChatId))
  }

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentChat?.messages, runCompleteNotice, showFallbackUX])

  useEffect(() => {
    const transcript = appTranscriptRef.current
    const composerArea = composerAreaRef.current
    if (!transcript || !composerArea) {
      return
    }

    const updateComposerReservation = () => {
      const height = Math.ceil(composerArea.getBoundingClientRect().height)
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
  }, [
    currentProvider,
    showGeminiTerminal,
    geminiTerminalHeight,
    imageAttachments.length,
    codexExternalPathGrants.length,
    permissionRequestPaths.length,
    Boolean(pendingAgentApproval),
    isCommandPaletteOpen,
    isMemoryInspectorOpen,
    prompt
  ])

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

  useEffect(() => {
    currentChatIdRef.current = currentChat?.appChatId ?? null
    if (currentChat?.appChatId) {
      chatByIdRef.current.set(currentChat.appChatId, currentChat)
    }
  }, [currentChat])

  useEffect(() => {
    const next = new Map<string, ChatRecord>()
    chats.forEach((chat) => next.set(chat.appChatId, chat))
    if (currentChat?.appChatId) {
      next.set(currentChat.appChatId, currentChat)
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
    setDueScheduledTasks(prev => {
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
  }, [currentWorkspace?.path])

  useEffect(() => {
    if (rightTab === 'raw') {
      rawLogsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [rawLogs, rightTab])

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
      setGeminiTerminalHeight(current => clampGeminiTerminalHeight(current))
    }

    window.addEventListener('resize', clampTerminalOnResize)
    return () => window.removeEventListener('resize', clampTerminalOnResize)
  }, [showGeminiTerminal])

  useEffect(() => {
    const geminiSessionApi = window.api as any
    if (typeof geminiSessionApi.onGeminiSessionData !== 'function' && typeof geminiSessionApi.onGeminiSessionExit !== 'function') {
      return
    }

    if (typeof geminiSessionApi.onGeminiSessionData === 'function') {
      geminiSessionApi.onGeminiSessionData((data: string) => {
        setRawLogs(prev => [...prev, { type: 'stdout', content: redactLog(String(data)) }])
      })
    }

    if (typeof geminiSessionApi.onGeminiSessionExit === 'function') {
      geminiSessionApi.onGeminiSessionExit((code: number | null) => {
        persistentSessionActiveRef.current = false
        setPersistentSessionStatus('exited')
        setIsPersistentSessionEnabled(false)
        setRawLogs(prev => [...prev, { type: 'info', content: `Persistent Gemini session exited with code ${typeof code === 'number' ? code : 'unknown'}.` }])
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
    if (!isPersistentSessionEnabled || !persistentSessionActiveRef.current || typeof geminiSessionApi.resizeGeminiSession !== 'function') {
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

  // IPC Listeners
  useEffect(() => {
    const handleProviderOutput = (fallbackProvider: ProviderId, payload: unknown) => {
      const provider = getRouteProvider(payload, fallbackProvider)
      const text = extractStreamText(payload, 'data')
      if (!text) return
      const context = resolveActiveRunContext(provider, getRouteRunId(payload), getRouteChatId(payload))
      if (context) {
        context.adapter.appendChunk(text)
      } else {
        appendThreadRawLog(getRouteChatId(payload) || currentChatIdRef.current, { type: 'stdout', content: text })
      }
    }

    const handleProviderError = (fallbackProvider: ProviderId, payload: unknown) => {
      const provider = getRouteProvider(payload, fallbackProvider)
      const error = extractStreamText(payload, 'error')
      if (!error) return
      const context = resolveActiveRunContext(provider, getRouteRunId(payload), getRouteChatId(payload))
      const redacted = redactLog(error)
      const category = classifyError(error)
      const permissionRequest = parseGeminiPermissionRequest(error)
      const errorRunChatId = context?.chatId || getRouteChatId(payload) || currentChatIdRef.current
      const isVisibleErrorRun = !errorRunChatId || currentChatIdRef.current === errorRunChatId
      if (provider === 'gemini' && isVisibleErrorRun && permissionRequest && (category === 'permission_or_approval_required' || category === 'untrusted_workspace')) {
        showAttachmentPermissionRequest({ ...permissionRequest, message: redactLog(permissionRequest.message) })
      }

      if (provider === 'gemini' && context && category === 'model_capacity_exhausted') {
        context.warnings.push({ message: redacted, timestamp: new Date().toISOString() })
        context.errorCount += 1
        if (context.errorCount >= 3 && context.toolCallsCount === 0) {
          window.api.cancelGemini()
          if (isVisibleErrorRun) setShowFallbackUX(true)
          updateChatById(errorRunChatId, (source) => {
            const msgs = [...source.messages, { id: Date.now().toString(), role: 'system', content: `Run auto-stopped due to repeated model capacity exhaustion (${context.errorCount} retries).`, timestamp: new Date().toISOString() }] as ChatMessage[]
            return { ...source, messages: msgs }
          })
        }
      }

      appendThreadRawLog(errorRunChatId, { type: 'stderr', content: redacted })
    }

    const handleProviderExit = (fallbackProvider: ProviderId, payload: unknown) => {
      const provider = getRouteProvider(payload, fallbackProvider)
      const context = resolveActiveRunContext(provider, getRouteRunId(payload), getRouteChatId(payload))
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
      const completedWorkspacePath = completedRunDiffUnavailable ? null : context.workspacePath
      const completedRunStartedAt = context.startedAt
      const isVisibleCompletedRun = () => !completedRunChatId || currentChatIdRef.current === completedRunChatId
      if (isVisibleCompletedRun()) {
        setIsThinking(false)
      }

      updateChatById(completedRunChatId, (source) => {
        let updated = { ...source }

        const runs = [...(updated.runs || [])]
        const runIndex = runs.findIndex((run) => run.runId === completedRunId)
        const targetRun = runIndex >= 0 ? runs[runIndex] : undefined
        if (targetRun) {
          if (targetRun.status === 'success' && context.warnings.length > 0) {
            targetRun.status = 'success_with_warnings'
          } else if (!targetRun.status) {
            targetRun.status = exitCode === 0 ? (context.warnings.length > 0 ? 'success_with_warnings' : 'success') : 'failed'
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
          const msgs = [...updated.messages, { id: Date.now().toString(), role: 'system', content: 'Task ended before completing. Check Raw Events for details.', timestamp: completedAt }] as ChatMessage[]
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
      } else if (completedWorkspacePath && completedRunId && context.preSnapshot) {
        const completedPreSnapshot = context.preSnapshot
        window.api.captureSnapshot(completedWorkspacePath).then(postSnapshot => {
          window.api.computeRunDiff(completedRunId, completedPreSnapshot, postSnapshot).then(runDiffResult => {
            updateChatById(completedRunChatId, (source) => {
              const runs = [...(source.runs || [])]
              const targetIndex = runs.findIndex((run) => run.runId === completedRunId)
              if (targetIndex >= 0) {
                runs[targetIndex].preSnapshot = completedPreSnapshot
                runs[targetIndex].postSnapshot = postSnapshot
                runs[targetIndex].runDiff = runDiffResult
              }
              return { ...source, runs }
            })
            const allRunChanges = [
              ...runDiffResult.createdFiles,
              ...runDiffResult.modifiedFiles,
              ...runDiffResult.deletedFiles,
            ]
            if (isVisibleCompletedRun()) {
              setRunDiff(getRunFileDiffSummaries(allRunChanges))
              setDiffView('this_run')
            }
          }).catch(() => {
            if (isVisibleCompletedRun()) setDiffView('workspace')
          })
        }).catch(() => {
          if (isVisibleCompletedRun()) setDiffView('workspace')
        })
      } else if (isVisibleCompletedRun()) {
        setDiffView('this_run')
      }

      if (isVisibleCompletedRun() && !completedRunDiffUnavailable) {
        refreshDiff().then(() => {
          if (hasToolCalls || exitCode === 0) {
            setDiffRefreshStatus('Diff refreshed after run.')
          }
        })
      }

      clearActiveRunContext(context)

      if (completedScheduledTaskId) {
        void window.api.updateScheduledTask(completedScheduledTaskId, {
          status: exitCode === 0 ? 'completed' : 'failed',
          completedAt: new Date().toISOString(),
          lastError: exitCode === 0 ? undefined : `Run exited with code ${exitCode}`
        }).then(() => window.api.getScheduledTasks(currentWorkspaceIdRef.current || undefined).then(setScheduledTasks))
      }

      if (currentWorkspaceIdRef.current) {
        void refreshUsageSummary(currentWorkspaceIdRef.current)
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
        setPendingAgentApproval(request)
        const context = resolveActiveRunContext(request.provider, request.appRunId, request.appChatId)
        appendThreadRawLog(context?.chatId || request.appChatId || currentChatIdRef.current, { type: 'info', content: `${getProviderLabel(request.provider)} approval requested: ${request.title}\n${request.body}` })
      })
    }

    if (typeof window.api.onScheduledTaskDue === 'function') {
      window.api.onScheduledTaskDue((task) => {
        setDueScheduledTasks(prev => prev.some((item) => item.id === task.id) ? prev : [...prev, task])
      })
    }

    if (typeof window.api.onScheduledTasksChanged === 'function') {
      window.api.onScheduledTasksChanged((tasks) => {
        setScheduledTasks(tasks)
      })
    }

    return () => {
      window.api.removeListeners()
    }
  }, [])

  const refreshDiff = async () => {
    if (currentWorkspace) {
      const worktree = currentProvider === 'gemini' ? resolveGeminiWorktreeConfig(currentWorkspace) : undefined
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
  
  const currentGeminiWorktree = currentProvider === 'gemini' ? resolveGeminiWorktreeConfig(currentWorkspace) : undefined
  const activeDiff = isGeminiWorktreeDiffUnavailable(currentGeminiWorktree)
    ? createWorktreeDiffUnavailable()
    : diffView === 'this_run' && runDiff
    ? { type: 'changes', summaries: runDiff }
    : diff;

  const buildRunRequest = (overrideModel?: string, existingPrompt?: string): QueuedRunRequest => {
    const selectedChat = (currentChatIdRef.current ? chatByIdRef.current.get(currentChatIdRef.current) : null) || currentChat
    const selectedWorkspace = getWorkspaceForChat(selectedChat) || currentWorkspace
    const provider = selectedChat ? getChatProvider(selectedChat) : currentProvider
    const composerSelection = selectedChat ? getChatComposerSelection(selectedChat, provider) : null
    const requestModel = overrideModel
      ? selectedModelType
      : composerSelection?.selectedModelType || selectedModelType
    const requestCustomModel = composerSelection?.customModel ?? customModel
    const requestApprovalMode = composerSelection?.approvalMode || approvalMode
    const requestReasoningEffort = provider === 'codex'
      ? (composerSelection?.codexReasoningEffort || codexReasoningEffort)
      : codexReasoningEffort
    const requestServiceTier = provider === 'codex'
      ? (composerSelection?.codexServiceTier || codexServiceTier)
      : codexServiceTier
    const externalPathGrants = provider === 'codex'
      ? normalizeExternalPathGrants(selectedChat?.providerMetadata?.codexExternalPathGrants)
      : []

    return {
      appRunId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
      geminiWorktree: resolveGeminiWorktreeConfig(selectedWorkspace),
      codexReasoningEffort: requestReasoningEffort,
      codexServiceTier: requestServiceTier,
      workspaceRecord: selectedWorkspace || undefined,
      chatRecord: selectedChat || undefined
    }
  }

  const queueRunRequest = (request: QueuedRunRequest, reason = 'Another task is currently active.') => {
    const queuedAt = new Date().toISOString()
    const targetChatId = request.chatRecord?.appChatId
    const targetProvider = request.provider
    const queuePosition = queuedRuns.length + 1
    setQueuedRuns(prev => [...prev, request])
    appendThreadRawLog(targetChatId, {
      type: 'info',
      content: `${getProviderLabel(targetProvider)} run queued (${queuePosition} waiting). ${reason}`
    })
    if (targetChatId) {
      updateChatById(targetChatId, (source) => ({
        ...source,
        messages: [
          ...source.messages,
          {
            id: `queued-${Date.now()}`,
            role: 'system',
            content: `Queued behind the active task. This ${getProviderLabel(targetProvider)} run will start automatically when the scheduler is free.`,
            timestamp: queuedAt
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
      ? { ...lastRequest, imageAttachments: mergeImageAttachments(lastRequest.imageAttachments, permissionAttachments) }
      : buildRunRequest()

    clearImagePermissions()

    if (isProviderBusy(request.provider)) {
      queueRunRequest(request, `Permission retry is waiting for the active ${getProviderLabel(request.provider)} task to exit.`)
      return
    }

    void executeRun(request)
  }

  const executeRun = async (runRequest?: QueuedRunRequest) => {
    const request = runRequest ?? buildRunRequest()
    const finalPrompt = `${request.prompt}${attachmentPromptAppendix(request.imageAttachments)}${request.provider === 'codex' ? externalPathGrantPromptAppendix(request.externalPathGrants || []) : ''}`
    const displayFinalPrompt = request.displayPrompt
      ? request.displayPrompt
      : finalPrompt
    const runWorkspace = request.workspaceRecord || currentWorkspace
    const runChat = request.chatRecord || currentChat
    if (!runWorkspace || !runChat || !finalPrompt.trim()) return
    const runProvider = request.provider || currentProvider
    if (isProviderBusy(runProvider)) {
      queueRunRequest(request, `${getProviderLabel(runProvider)} is already running; AgentBench will start this thread when that provider is free.`)
      return
    }

    runSchedulerBusyRef.current = true

    errorCountRef.current = 0
    toolCallsCountRef.current = 0
    activeRunUsageResetHintsRef.current = new Map()
    currentRunWarningsRef.current = []
    setShowFallbackUX(false)
    clearImagePermissions()
    latestRunRequestRef.current = request

    const modelToPass = request.overrideModel || (request.selectedModelType === 'custom' ? request.customModel.trim() : request.selectedModelType)
    const modeToPass = request.approvalMode
    const runWorktree = runProvider === 'gemini' ? request.geminiWorktree : undefined
    const runDiffUnavailable = isGeminiWorktreeDiffUnavailable(runWorktree)
    const runDiffWorkspacePath = runDiffUnavailable ? undefined : getDiffWorkspacePath(runWorkspace, runWorktree)
    
    activeScheduledTaskIdRef.current = request.scheduledTaskId || null
    let chatToUpdate = { ...runChat, provider: runProvider }
    const resumeSessionId = runProvider !== 'gemini'
      ? normalizeGeminiResumeTarget(chatToUpdate.linkedProviderSessionId)
      : normalizeGeminiResumeTarget(chatToUpdate.linkedGeminiSessionId)
    const selectedChatIdAtRunStart = currentChatIdRef.current || currentChat?.appChatId || null
    const isRunVisibleAtStart = selectedChatIdAtRunStart === chatToUpdate.appChatId
    if (isRunVisibleAtStart) {
      setRunCompleteNotice(null)
      setRunDiff(null)
      setPendingPlanChoice(null)
      setIsThinking(true)
    }
    
    if (chatToUpdate.messages.length === 0) {
      chatToUpdate.title = displayFinalPrompt.length > 30 ? displayFinalPrompt.substring(0, 30) + '...' : displayFinalPrompt;
    }

    let runStartedAt = new Date().toISOString()
    if (!request.existingPrompt) {
      const userMessage: ChatMessage = { id: Date.now().toString(), role: 'user', content: displayFinalPrompt, timestamp: runStartedAt }
      chatToUpdate.messages = [...chatToUpdate.messages, userMessage]
    } else {
      const lastUserMessage = [...chatToUpdate.messages].reverse().find((message) => message.role === 'user')
      runStartedAt = lastUserMessage?.timestamp || runStartedAt
    }
    const currentRunId = request.appRunId || Date.now().toString()
    activeRunByProviderRef.current.set(runProvider, currentRunId)
    setRunningProviders(new Set(activeRunByProviderRef.current.keys()))
    activeRunChatIdRef.current = chatToUpdate.appChatId
    activeRunIdRef.current = currentRunId
    activeRunWorkspacePathRef.current = runDiffWorkspacePath || null
    activeRunStartedAtRef.current = runStartedAt
    activeRunDiffUnavailableRef.current = runDiffUnavailable
    const newRun: ChatRun = {
      runId: currentRunId,
      provider: runProvider,
      startedAt: runStartedAt,
      requestedModel: modelToPass,
      approvalMode: modeToPass,
      ...(runProvider !== 'gemini' && resumeSessionId ? { providerThreadId: resumeSessionId } : {}),
      ...(runWorktree ? { geminiWorktree: runWorktree } : {}),
      ...(runDiffWorkspacePath ? { effectiveWorkspacePath: runDiffWorkspacePath } : {}),
      ...(runDiffUnavailable ? { diffUnavailableReason: WORKTREE_DIFF_UNAVAILABLE_TEXT } : {})
    }
    chatToUpdate.runs = [...(chatToUpdate.runs || []), newRun]
    let contextTurnsForRun = runProvider !== 'gemini' || resumeSessionId ? 0 : clampContextTurns(chatContextTurns)
    let contextualPrompt = runProvider !== 'gemini' || resumeSessionId
      ? finalPrompt
      : appendConversationContext(finalPrompt, chatToUpdate.messages, contextTurnsForRun, finalPrompt)
    let contextApplicationLog = runProvider !== 'gemini'
      ? `Context turns: 0 (${getProviderLabel(runProvider)} provider/session history is authoritative when available)`
      : resumeSessionId
        ? 'Context turns: 0 (resuming Gemini CLI session context)'
        : `Context turns: ${contextTurnsForRun} (sending compact context + current request)`

    if (runProvider === 'codex') {
      const lastCompletedModel = getLastCompletedCodexRunModel(runChat)
      const previousModelKey = normalizeProviderModelKey(lastCompletedModel)
      const nextModelKey = normalizeProviderModelKey(modelToPass)
      const hasCompletedWork = Boolean(lastCompletedModel)
      const modelChangedAfterWork = hasCompletedWork && previousModelKey && nextModelKey && previousModelKey !== nextModelKey
      const handoffKey = `${previousModelKey}->${nextModelKey}`
      const appliedKeys = getCodexModelContextAppliedKeys(runChat)

      if (modelChangedAfterWork && !appliedKeys.includes(handoffKey)) {
        contextTurnsForRun = clampContextTurns(chatContextTurns)
        contextualPrompt = appendConversationContext(finalPrompt, chatToUpdate.messages, contextTurnsForRun, finalPrompt)
        contextApplicationLog = `Context turns: ${contextTurnsForRun} (Codex model changed from ${lastCompletedModel} to ${modelToPass}; applying chat context once)`
        chatToUpdate.providerMetadata = {
          ...(chatToUpdate.providerMetadata || {}),
          codexModelContextAppliedKeys: [...appliedKeys, handoffKey],
          lastCodexModelContextHandoffAt: new Date().toISOString()
        }
        setChatContextNotice({
          id: `${Date.now()}-${handoffKey}`,
          message: `Chat context is being applied once for the Codex model change: ${lastCompletedModel} -> ${modelToPass}.`
        })
      }
    }
    
    const runChatId = chatToUpdate.appChatId
    activeRunChatSnapshotRef.current = chatToUpdate
    chatByIdRef.current.set(runChatId, chatToUpdate)
    setRunningChatIds(prev => {
      const next = new Set(prev)
      next.add(runChatId)
      return next
    })
    if (isRunVisibleAtStart) {
      setCurrentChat(chatToUpdate)
    }
    setChats(prev => {
      const index = prev.findIndex(chat => chat.appChatId === runChatId)
      if (index < 0) return [chatToUpdate, ...prev]
      return prev.map(chat => chat.appChatId === runChatId ? chatToUpdate : chat)
    })
    window.api.saveChat(chatToUpdate)

    const initialRawLogs: RawLogEntry[] = [
      { type: 'info', content: contextApplicationLog },
      { type: 'info', content: `Exact prompt being sent: ${contextualPrompt}` },
      { type: 'info', content: `Requested model: ${modelToPass}` },
      { type: 'info', content: `Approval Mode: ${modeToPass}` },
      ...(resumeSessionId ? [{ type: 'info' as const, content: `Resuming ${getProviderLabel(runProvider)} session: ${resumeSessionId}` }] : []),
      ...(runWorktree?.enabled
        ? [{ type: 'info' as const, content: `Gemini worktree: ${runWorktree.name || 'enabled'}${runDiffWorkspacePath ? ` (diff path: ${runDiffWorkspacePath})` : ' (effective path unknown; Diff Studio disabled)'}` }]
        : [])
    ]
    setThreadRawLogs(runChatId, initialRawLogs)
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
    let runContext: ActiveRunContext
    const adapter = new GeminiStreamAdapter((event: NormalizedEvent) => {
      if (event.type === 'raw_event') {
        const redacted = redactLog(JSON.stringify(event.data, null, 2))
        const permissionRequest = parseGeminiPermissionRequest(event.data)
        if (permissionRequest && isVisibleRunChat()) {
          showAttachmentPermissionRequest({ ...permissionRequest, message: redactLog(permissionRequest.message) })
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
        const isTool = event.data.type === 'tool_use' ||
          event.data.type === 'tool_result' ||
          ['update_topic', 'invoke_agent', 'summary', 'intent', 'progress', 'tool_progress'].includes(String(event.data.type || ''))
        appendThreadRawLog(runChatId, { type: isTool ? 'tool' : 'stdout', content: redacted })
        return
      }
      if (event.type === 'malformed_json') {
        appendThreadRawLog(runChatId, { type: 'stdout', content: redactLog(event.text) })
        return
      }

      updateChatById(runChatId, (source) => {
        let updated = { ...source }
        
        if (event.type === 'user_message') {
          // Handled manually before run
        } else if (event.type === 'assistant_message_delta') {
          if (isVisibleRunChat()) setIsThinking(false)
          const last = updated.messages[updated.messages.length - 1]
          if (last && last.role === 'assistant') {
            updated.messages = [...updated.messages.slice(0, -1), { ...last, content: last.content + event.content }]
          } else {
            updated.messages = [...updated.messages, { id: Date.now().toString(), role: 'assistant', content: event.content, timestamp: new Date().toISOString() }]
          }
        } else if (event.type === 'assistant_message_complete') {
          if (isVisibleRunChat()) setIsThinking(false)
          const isPlanMode = updated.runs?.[updated.runs.length - 1]?.approvalMode === 'plan'
          const parsedChoice = parsePlanModeChoice(event.content)
          const last = updated.messages[updated.messages.length - 1]
          const assistantMessageId = last && last.role === 'assistant'
            ? last.id
            : `${Date.now()}`

          if (last && last.role === 'assistant') {
            updated.messages = [...updated.messages.slice(0, -1), { ...last, content: event.content }]
          } else {
            updated.messages = [...updated.messages, { id: assistantMessageId, role: 'assistant', content: event.content, timestamp: new Date().toISOString() }]
          }
          const resetHints = extractResetHintsFromText(event.content)
          for (const hint of resetHints) {
            const key = normalizeModelName(hint.model)
            const existing = runContext.usageResetHints.get(key) || {}
            runContext.usageResetHints.set(key, mergeUsageReset(existing, hint))
          }
          if (resetHints.length > 0) {
            Promise.all(resetHints.map((hint) => window.api.recordUsage({
              provider: runProvider,
              workspaceId: updated.workspaceId,
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
            }))).then(() => {
              if (updated.workspaceId && currentWorkspaceIdRef.current === updated.workspaceId) {
                void refreshUsageSummary(updated.workspaceId)
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
          if (sessionId && !event.fallback) {
            if (runProvider !== 'gemini') {
              updated.linkedProviderSessionId = sessionId
            } else {
              updated.linkedGeminiSessionId = sessionId
            }
          }
          const runs = [...(updated.runs || [])]
          if (runs.length > 0) {
            runs[runs.length - 1].actualModel = event.model
            if (runProvider !== 'gemini' && !event.fallback) {
              runs[runs.length - 1].providerThreadId = sessionId || runs[runs.length - 1].providerThreadId
            }
          }
          updated.runs = runs
        } else if (event.type === 'run_finished') {
          if (isVisibleRunChat()) setIsThinking(false)
          const runs = [...(updated.runs || [])]
          const resolvedRunModel = runs.length > 0 ? (runs[runs.length - 1].actualModel || runs[runs.length - 1].requestedModel || 'unknown') : 'unknown'
          const runUsageEntries = extractModelUsageEntriesFromStats(event.stats || {}, resolvedRunModel)

          if (runs.length > 0) {
            runs[runs.length - 1].status = event.status
            runs[runs.length - 1].stats = event.stats
            runs[runs.length - 1].endedAt = new Date().toISOString()
          }
          updated.runs = runs

          const runDurationMs = Math.max(0, extractUsageCount(event.stats, [['duration_ms'], ['durationMs']]))

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
              workspaceId: updated.workspaceId,
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
              responseText: updated.messages[updated.messages.length - 1]?.role === 'assistant' ? updated.messages[updated.messages.length - 1].content : undefined
            })
          })

          Promise.all(usageRecordPromises).then(() => {
            if (updated.workspaceId && currentWorkspaceIdRef.current === updated.workspaceId) {
              void refreshUsageSummary(updated.workspaceId)
            }
          })
        } else if (event.type === 'tool_event') {
          runContext.toolCallsCount += 1

          if (updated.messages.length === 0 || updated.messages[updated.messages.length - 1].role !== 'tool') {
             updated.messages = [...updated.messages, { id: Date.now().toString(), role: 'tool', content: '', timestamp: new Date().toISOString(), toolActivities: [] }]
          }
          
          const lastMsgIndex = updated.messages.length - 1
          const lastMsg = updated.messages[lastMsgIndex]
          let acts = [...(lastMsg.toolActivities || [])]
          
          const tData = event.data
          const isUse = event.isUse || isToolUseEvent(tData)
          const isResult = event.isResult || isToolResultEvent(tData)
          const tId = event.data?.tool_id || event.data?.toolId || event.data?.id || event.data?.call_id || `unknown-${Date.now()}`
          let latestToolActivity: ToolActivity | null = null

          if (isUse) {
            const newActivity = createToolActivity(tData)
            acts.push(newActivity)
            latestToolActivity = newActivity
          } else if (isResult) {
            const idx = acts.findIndex(a => a.id === tId)
            if (idx >= 0) {
              acts[idx] = pairToolResult(acts[idx], tData)
              latestToolActivity = acts[idx]
            } else {
              // Orphan result: create a minimal activity for it
              const orphan = createToolActivity({ type: 'tool_use', tool_id: tId, tool_name: event.name || 'unknown' })
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

          if (isVisibleRunChat() && !runContext.diffUnavailable && latestToolActivity && isResult) {
            upsertRunDiffFromTool(latestToolActivity, runContext.workspacePath)
          }

          updated.messages = [
            ...updated.messages.slice(0, lastMsgIndex),
            { ...lastMsg, toolActivities: acts }
          ]
        } else if (event.type === 'error') {
          updated.messages = [...updated.messages, { id: Date.now().toString(), role: 'error', content: event.message, timestamp: new Date().toISOString() }]
        }
        
        return updated
      })
    })
    runContext = {
      runId: currentRunId,
      chatId: runChatId,
      provider: runProvider,
      adapter,
      warnings: currentRunWarningsRef.current,
      usageResetHints: activeRunUsageResetHintsRef.current,
      errorCount: errorCountRef.current,
      toolCallsCount: toolCallsCountRef.current,
      preSnapshot,
      workspacePath: runDiffWorkspacePath || null,
      startedAt: runStartedAt,
      diffUnavailable: runDiffUnavailable,
      scheduledTaskId: request.scheduledTaskId || null
    }
    activeRunsRef.current.set(currentRunId, runContext)
    activeRunByProviderRef.current.set(runProvider, currentRunId)
    adapterRef.current = adapter
    syncRunningState()

    if (!request.existingPrompt && !request.preserveComposer) {
      setPrompt('')
      clearComposerAttachmentsForSubmittedRequest(request)
    }
    if (runProvider !== 'gemini') {
      try {
        if (runProvider === 'codex' && request.codexNativeReview && resumeSessionId && typeof window.api.startAgentReview === 'function') {
          await window.api.startAgentReview('codex', resumeSessionId, {
            model: modelToPass,
            target: { type: 'uncommittedChanges' },
            delivery: 'inline'
          })
        } else {
          await window.api.runAgent({
            provider: runProvider,
            workspace: runWorkspace.path,
            prompt: contextualPrompt,
            appRunId: currentRunId,
            appChatId: runChatId,
            model: modelToPass,
            reasoningEffort: runProvider === 'codex' ? ((request.codexReasoningEffort ?? codexReasoningEffort) || null) : null,
            serviceTier: runProvider === 'codex' ? ((request.codexServiceTier ?? codexServiceTier) || null) : null,
            approvalMode: modeToPass,
            imagePaths: request.imageAttachments.map(item => item.path),
            providerSessionId: resumeSessionId,
            externalPathGrants: runProvider === 'codex' ? request.externalPathGrants || [] : []
          })
        }
      } catch (error) {
        clearActiveRunContext(runContext)
        const message = `Failed to start ${getProviderLabel(runProvider)}: ${redactLog(String(error))}`
        appendThreadRawLog(runChatId, { type: 'stderr', content: message })
        updateChatById(runChatId, (source) => ({
          ...source,
          messages: [...source.messages, { id: Date.now().toString(), role: 'error', content: message, timestamp: new Date().toISOString() }],
          runs: source.runs.map((run) => run.runId === currentRunId ? { ...run, status: 'failed', endedAt: new Date().toISOString() } : run)
        }))
      }
    } else {
      try {
        await window.api.runGemini(
          runWorkspace.path,
          contextualPrompt,
          modelToPass,
          modeToPass,
          request.sessionTrust,
          request.imageAttachments.map(item => item.path),
          resumeSessionId,
          request.geminiWorktree,
          { appRunId: currentRunId, appChatId: runChatId }
        )
      } catch (error) {
        clearActiveRunContext(runContext)
        const message = `Failed to start Gemini: ${redactLog(String(error))}`
        appendThreadRawLog(runChatId, { type: 'stderr', content: message })
        updateChatById(runChatId, (source) => ({
          ...source,
          messages: [...source.messages, { id: Date.now().toString(), role: 'error', content: message, timestamp: new Date().toISOString() }],
          runs: source.runs.map((run) => run.runId === currentRunId ? { ...run, status: 'failed', endedAt: new Date().toISOString() } : run)
        }))
      }
    }
    setChats(await window.api.getChats())
  }

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
        codexNativeReview: currentProvider === 'codex' && Boolean(currentChat?.linkedProviderSessionId),
        workspaceRecord: currentWorkspace,
        chatRecord: currentChat
      }

      if (isProviderBusy(reviewRequest.provider)) {
        queueRunRequest(reviewRequest, `Diff review is waiting for the active ${getProviderLabel(reviewRequest.provider)} task to exit.`)
        setDiffRefreshStatus('Diff review queued.')
        return
      }

      void executeRun(reviewRequest)
    } catch (error) {
      setDiffRefreshStatus('Diff review failed to prepare.')
      setRawLogs(prev => [...prev, { type: 'info', content: `Failed to prepare diff review: ${redactLog(String(error))}` }])
    } finally {
      setIsPreparingDiffReview(false)
    }
  }

  const handleRun = (overrideModel?: string, existingPrompt?: string) => {
    const request = buildRunRequest(overrideModel, existingPrompt)
    if (!request.prompt.trim()) {
      return
    }

    if (isProviderBusy(request.provider)) {
      queueRunRequest(request)
      clearComposerAttachmentsForSubmittedRequest(request)
      if (!request.existingPrompt) {
        setPrompt('')
      }
      return
    }

    void executeRun(request)
  }

  const handleScheduleRun = async () => {
    if (!currentWorkspace || !currentChat) return
    const request = buildRunRequest()
    if (!request.prompt.trim() || !scheduleRunAt) return
    const runAtDate = new Date(scheduleRunAt)
    if (Number.isNaN(runAtDate.getTime())) {
      setRawLogs(prev => [...prev, { type: 'info', content: 'Scheduled run time is invalid.' }])
      return
    }
    if (runAtDate.getTime() <= Date.now()) {
      setRawLogs(prev => [...prev, { type: 'info', content: 'Choose a future time for scheduled runs.' }])
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
      runAt: runAtDate.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
    })
    setScheduledTasks(await window.api.getScheduledTasks(currentWorkspace.id))
    setScheduleRunAt('')
    setRawLogs(prev => [...prev, { type: 'info', content: `Scheduled ${getProviderLabel(saved.provider)} run for ${formatScheduledRunTime(saved.runAt)}.` }])
  }

  const dispatchScheduledTask = async (task: ScheduledTask) => {
    try {
      const workspace = workspaces.find((item) => item.id === task.workspaceId) ||
        await window.api.addOrUpdateWorkspace(task.workspacePath, { id: task.workspaceId })
      const chat = await window.api.getChat(task.chatId)
      if (!workspace || !chat) {
        await window.api.updateScheduledTask(task.id, { status: 'failed', lastError: 'Workspace or chat could not be loaded.' })
        setScheduledTasks(await window.api.getScheduledTasks(currentWorkspace?.id))
        return
      }

      setCurrentWorkspace(workspace)
      currentWorkspaceIdRef.current = workspace.id
      currentChatIdRef.current = chat.appChatId
      chatByIdRef.current.set(chat.appChatId, chat)
      setCurrentChat(chat)
      applyChatComposerSelection(chat, task.provider)
      setSelectedModelType(task.selectedModelType)
      setCustomModel(task.customModel)
      setApprovalMode(task.approvalMode)
      setSessionTrust(task.sessionTrust)
      if (task.provider === 'codex') {
        setCodexReasoningEffort(task.codexReasoningEffort || 'medium')
        setCodexServiceTier(task.codexServiceTier || '')
      }

      await window.api.updateScheduledTask(task.id, { status: 'running', firedAt: task.firedAt || new Date().toISOString() })
      setScheduledTasks(await window.api.getScheduledTasks(currentWorkspace?.id))

      void executeRun({
        provider: task.provider,
        prompt: task.prompt,
        displayPrompt: task.displayPrompt || `[scheduled ${formatScheduledRunTime(task.runAt)}] ${task.prompt}`,
        selectedModelType: task.selectedModelType,
        customModel: task.customModel,
        approvalMode: task.approvalMode,
        sessionTrust: task.sessionTrust,
        imageAttachments: task.imageAttachments,
        externalPathGrants: task.externalPathGrants,
        geminiWorktree: task.geminiWorktree,
        codexReasoningEffort: task.codexReasoningEffort,
        codexServiceTier: task.codexServiceTier,
        scheduledTaskId: task.id,
        workspaceRecord: workspace,
        chatRecord: chat,
        preserveComposer: true
      }).catch(async (error) => {
        await window.api.updateScheduledTask(task.id, { status: 'failed', lastError: String(error) })
        setScheduledTasks(await window.api.getScheduledTasks(currentWorkspace?.id))
      })
    } catch (error) {
      await window.api.updateScheduledTask(task.id, { status: 'failed', lastError: String(error) })
      setScheduledTasks(await window.api.getScheduledTasks(currentWorkspace?.id))
    }
  }

  useEffect(() => {
    if (dueScheduledTasks.length === 0) {
      return
    }
    const nextIndex = dueScheduledTasks.findIndex((task) => !isProviderBusy(task.provider))
    if (nextIndex < 0) return
    const nextTask = dueScheduledTasks[nextIndex]
    const remainingTasks = dueScheduledTasks.filter((_, index) => index !== nextIndex)
    setDueScheduledTasks(remainingTasks)
    void dispatchScheduledTask(nextTask)
  }, [dueScheduledTasks, runningProviders])

  const appendBridgeFallback = (commandText: string, reason: string) => {
    const timestamp = new Date().toISOString()
    setRawLogs(prev => [...prev, { type: 'info', content: `Queued Gemini command bridge text (${reason}): ${commandText}` }])
    setCurrentChat(prev => {
      if (!prev) return prev
      const updated = {
        ...prev,
        messages: [
          ...prev.messages,
          { id: `${Date.now()}-bridge-user`, role: 'user', content: commandText, timestamp },
          { id: `${Date.now()}-bridge-system`, role: 'system', content: `Command bridge queued because persistent Gemini session is ${reason}.`, timestamp: new Date().toISOString() }
        ] as ChatMessage[]
      }
      window.api.saveChat(updated)
      return updated
    })
  }

  const startPersistentGeminiSession = async (): Promise<boolean> => {
    const geminiSessionApi = window.api as any

    if (persistentSessionActiveRef.current) {
      setIsPersistentSessionEnabled(true)
      setPersistentSessionStatus('active')
      return true
    }

    if (!currentWorkspace || typeof geminiSessionApi.startGeminiSession !== 'function') {
      setPersistentSessionStatus('unavailable')
      setRawLogs(prev => [...prev, { type: 'info', content: 'Persistent Gemini session API is unavailable; command bridge will queue text in chat/raw logs.' }])
      return false
    }

    const modelToPass = selectedModelType === 'custom' ? customModel.trim() : selectedModelType
    const resumeSessionId = normalizeGeminiResumeTarget(currentChat?.linkedGeminiSessionId)
    const worktree = resolveGeminiWorktreeConfig(currentWorkspace)
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
      setRawLogs(prev => [...prev, { type: 'info', content: `Persistent Gemini session ${resumeSessionId ? `resumed from ${resumeSessionId}` : 'started'}${modelToPass ? ` with ${modelToPass}` : ''}${worktree?.enabled ? ` in worktree ${worktree.name || 'enabled'}` : ''}.` }])
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
      setRawLogs(prev => [...prev, { type: 'info', content: `Failed to start persistent Gemini session: ${redactLog(String(error))}` }])
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

    geminiSessionApi.writeGeminiSession(`${commandText}\n`).catch(() => appendBridgeFallback(commandText, 'write-unavailable'))
    setRightTab('raw')
    setRawLogs(prev => [...prev, { type: 'info', content: `Sent Gemini command: ${commandText}` }])
  }

  const handlePaletteCommand = (item: CommandPaletteItem) => {
    setIsCommandPaletteOpen(false)
    setCommandPaletteQuery('')
    if (currentProvider === 'codex') {
      if (item.command === '/status' || item.command === '/permissions') {
        setRightTab('safety')
      } else if (item.command === '/model' || item.command === '/mcp' || item.command === '/resume') {
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
          setCodexServiceTier(current => current === 'fast' ? '' : 'fast')
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

  const handleRestoreCheckpoint = async () => {
    const confirmed = window.confirm('Open Gemini /restore in the persistent session? This only opens Gemini CLI restore selection; restore is not executed by GUIGemini.')
    if (!confirmed) {
      return
    }

    await handleBridgeCommand('/restore')
  }

  const syncPersistentModelSelection = (nextModel: string) => {
    if (!persistentSessionActiveRef.current || nextModel === 'custom' || nextModel === 'cli-default') {
      return
    }
    void handleBridgeCommand(`/model ${nextModel}`)
  }

  const handlePersistentSessionToggle = async () => {
    const geminiSessionApi = window.api as any

    if (isPersistentSessionEnabled || persistentSessionActiveRef.current) {
      if (typeof geminiSessionApi.stopGeminiSession !== 'function') {
        persistentSessionActiveRef.current = false
        setIsPersistentSessionEnabled(false)
        setPersistentSessionStatus('unavailable')
        setPersistentSessionNeedsRestart(false)
        return
      }
      setPersistentSessionStatus('stopping')
      try {
        await geminiSessionApi.stopGeminiSession()
        persistentSessionActiveRef.current = false
        setIsPersistentSessionEnabled(false)
        setPersistentSessionStatus('idle')
        setPersistentSessionNeedsRestart(false)
        setRawLogs(prev => [...prev, { type: 'info', content: 'Persistent Gemini session stopped.' }])
      } catch (error) {
        setPersistentSessionStatus('error')
        setRawLogs(prev => [...prev, { type: 'info', content: `Failed to stop persistent Gemini session: ${redactLog(String(error))}` }])
      }
      return
    }

    await startPersistentGeminiSession()
  }

  const handlePlanChoiceSubmit = (messageId: string, option: string) => {
    if (!currentWorkspace || !currentChat || !option.trim()) return

    setCurrentChat(prev => {
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

  const handleRunFallback = (fallbackModel: string) => {
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
      setRawLogs(prev => [...prev, { type: 'info', content: `${getProviderLabel(pendingAgentApproval?.provider || currentProvider)} approval response sent: ${action}` }])
      if (action === 'acceptForWorkspace') {
        const settings = await window.api.getSettings()
        setAgenticWorkspaceGrantCount(Array.isArray(settings.agenticWorkspaceGrants) ? settings.agenticWorkspaceGrants.length : 0)
      }
    } catch (error) {
      setRawLogs(prev => [...prev, { type: 'stderr', content: `Failed to send approval response: ${redactLog(String(error))}` }])
    } finally {
      setPendingAgentApproval(prev => prev?.id === requestId ? null : prev)
    }
  }

  const refreshGeminiMcpBridgeStatus = async () => {
    if (typeof window.api.getGeminiMcpBridgeStatus !== 'function') return
    try {
      const status = await window.api.getGeminiMcpBridgeStatus()
      setGeminiMcpBridgeStatus(status)
    } catch (error) {
      setRawLogs(prev => [...prev, { type: 'stderr', content: `Gemini MCP bridge status failed: ${redactLog(String(error))}` }])
    }
  }

  const installGeminiMcpBridge = async () => {
    if (typeof window.api.installGeminiMcpBridge !== 'function') return
    try {
      const status = await window.api.installGeminiMcpBridge()
      setGeminiMcpBridgeEnabledState(true)
      setGeminiMcpBridgeStatus(status)
      setSettings(prev => prev ? { ...prev, geminiMcpBridgeEnabled: true, geminiMcpBridgeLastStatus: status } : prev)
      setRawLogs(prev => [...prev, { type: 'info', content: status.message || 'Gemini MCP bridge installed.' }])
    } catch (error) {
      setRawLogs(prev => [...prev, { type: 'stderr', content: `Gemini MCP bridge install failed: ${redactLog(String(error))}` }])
    }
  }

  const handleCancel = async () => {
    if (currentProvider !== 'gemini' && typeof window.api.cancelAgentRun === 'function') {
      await window.api.cancelAgentRun(currentProvider)
    } else {
      await window.api.cancelGemini()
    }
    syncRunningState()
  }

  const handleGeminiTerminalSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const input = geminiTerminalInput
    if (!input.trim()) {
      return
    }

    setGeminiTerminalInput('')
    setRawLogs(prev => [...prev, { type: 'info', content: `> ${input}` }])

    try {
      const didWrite = await window.api.writeGeminiInput(`${input}\n`)
      if (!didWrite) {
        setRawLogs(prev => [...prev, { type: 'info', content: 'No active Gemini process/session is currently accepting terminal input.' }])
      }
    } catch (error) {
      setRawLogs(prev => [...prev, { type: 'stderr', content: `Failed to write Gemini terminal input: ${redactLog(String(error))}` }])
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
      setGeminiTerminalHeight(current => clampGeminiTerminalHeight(current + step))
    } else if (event.key === 'ArrowDown') {
      setGeminiTerminalHeight(current => clampGeminiTerminalHeight(current - step))
    } else if (event.key === 'Home') {
      setGeminiTerminalHeight(MIN_GEMINI_TERMINAL_HEIGHT)
    } else if (event.key === 'End') {
      setGeminiTerminalHeight(clampGeminiTerminalHeight(window.innerHeight))
    }
  }

  useEffect(() => {
    if (queuedRuns.length === 0) return

    const nextIndex = queuedRuns.findIndex((run) => !isProviderBusy(run.provider))
    if (nextIndex < 0) return

    const nextRun = queuedRuns[nextIndex]
    const remainingRuns = queuedRuns.filter((_, index) => index !== nextIndex)
    setQueuedRuns(remainingRuns)
    appendThreadRawLog(nextRun.chatRecord?.appChatId, {
      type: 'info',
      content: `Starting queued ${getProviderLabel(nextRun.provider)} run. ${remainingRuns.length} queued task${remainingRuns.length === 1 ? '' : 's'} remain.`
    })
    void executeRun(nextRun)
  }, [queuedRuns, runningProviders, currentWorkspace, currentChat, executeRun])

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

  const startRightPanelResize = (panel: 'fileEditor' | 'inspector', event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = panel === 'fileEditor' ? fileEditorWidth : appearance.inspectorWidth
    const maxWidth = Math.min(MAX_RIGHT_PANEL_WIDTH, Math.max(MIN_RIGHT_PANEL_WIDTH, Math.floor(window.innerWidth * 0.58)))

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.max(MIN_RIGHT_PANEL_WIDTH, Math.min(maxWidth, startWidth - (moveEvent.clientX - startX)))
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
    const maxWidth = Math.min(MAX_WORKSPACE_SIDEBAR_WIDTH, Math.max(MIN_WORKSPACE_SIDEBAR_WIDTH, Math.floor(window.innerWidth * 0.42)))

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.max(MIN_WORKSPACE_SIDEBAR_WIDTH, Math.min(maxWidth, startWidth + (moveEvent.clientX - startX)))
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
    const maxWidth = Math.min(MAX_WORKSPACE_SIDEBAR_WIDTH, Math.max(MIN_WORKSPACE_SIDEBAR_WIDTH, Math.floor(window.innerWidth * 0.42)))
    const step = event.shiftKey ? 40 : 16
    let nextWidth = workspaceSidebarWidth

    if (event.key === 'ArrowLeft') nextWidth = workspaceSidebarWidth - step
    if (event.key === 'ArrowRight') nextWidth = workspaceSidebarWidth + step
    if (event.key === 'Home') nextWidth = MIN_WORKSPACE_SIDEBAR_WIDTH
    if (event.key === 'End') nextWidth = maxWidth

    setWorkspaceSidebarWidth(clampWorkspaceSidebarWidth(Math.max(MIN_WORKSPACE_SIDEBAR_WIDTH, Math.min(maxWidth, nextWidth))))
  }

  const handleRightPanelResizeKeyDown = (panel: 'fileEditor' | 'inspector', event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return
    }

    event.preventDefault()
    const maxWidth = Math.min(MAX_RIGHT_PANEL_WIDTH, Math.max(MIN_RIGHT_PANEL_WIDTH, Math.floor(window.innerWidth * 0.58)))
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

  useEffect(() => {
    const handleAppKeyDown = (event: KeyboardEvent) => {
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
          setIsCommandPaletteOpen(false)
          setCommandPaletteQuery('')
          return
        }
        if (showSettings) {
          event.preventDefault()
          setShowSettings(false)
          return
        }
        if (permissionRequestPaths.length > 0) {
          event.preventDefault()
          clearImagePermissions()
          return
        }
        if (selectedModelType === 'custom') {
          event.preventDefault()
          setCustomModel('')
          setSelectedModelType(lastNonCustomModelType)
          rememberCurrentChatComposerSelection({
            customModel: '',
            selectedModelType: lastNonCustomModelType
          })
          if (currentProvider === 'gemini') {
            syncPersistentModelSelection(lastNonCustomModelType)
          }
          return
        }
      }

      if (hasModifier && event.key === 'Enter') {
        event.preventDefault()
        handleRun()
        return
      }

      if (!hasModifier) {
        return
      }

      const shortcutKey = event.key.toLowerCase()
      if (shortcutKey === 'k') {
        event.preventDefault()
        setIsCommandPaletteOpen(true)
        return
      }

      if (isEditableTarget) {
        return
      }

      if (shortcutKey === 'b') {
        event.preventDefault()
        setShowWorkspaceSidebar(current => !current)
      } else if (shortcutKey === 'i') {
        event.preventDefault()
        const nextShowInspector = !appearance.showInspector
        if (nextShowInspector && window.innerWidth <= 1180) {
          setShowFileEditor(false)
        }
        appearance.update({ showInspector: nextShowInspector })
      } else if (shortcutKey === 'e') {
        event.preventDefault()
        setShowFileEditor(current => {
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
    clearImagePermissions,
    currentProvider,
    handleRun,
    isCommandPaletteOpen,
    lastNonCustomModelType,
    permissionRequestPaths.length,
    selectedModelType,
    showSettings,
    syncPersistentModelSelection
  ])

  const isOldVersion = geminiVersion !== 'unknown' && geminiVersion < '0.39.1'
  const isCurrentChatRunning = Boolean(currentChat?.appChatId && runningChatIds.has(currentChat.appChatId))
  const currentRun = currentChat?.runs?.[currentChat.runs.length - 1]
  const currentProviderLabel = getProviderLabel(currentProvider)
  const currentProviderModelOptions = getProviderModelOptions(currentProvider)
  const currentAgentStatus = currentProvider === 'codex' ? codexStatus : agentStatusByProvider[currentProvider]
  const currentAgentMcpStatus = currentProvider === 'codex' ? codexMcpStatus : agentMcpStatusByProvider[currentProvider]
  const providerSessionLabel = currentChat?.linkedProviderSessionId
    ? `${currentProviderLabel} session linked`
    : currentProvider === 'codex'
      ? 'New Codex thread'
      : `New ${currentProviderLabel} session`
  const currentCodexModelOption = codexModels.find((model) => model.id === selectedModelType)
  const codexReasoningOptions = currentCodexModelOption?.supportedReasoningEfforts?.length
    ? currentCodexModelOption.supportedReasoningEfforts
    : [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }, { reasoningEffort: 'high' }, { reasoningEffort: 'xhigh' }]
  const codexSupportsFast = Boolean(currentCodexModelOption?.additionalSpeedTiers?.includes('fast'))
  const hasAgenticApprovalGate =
    agenticServices.shellCommands !== 'allow' ||
    agenticServices.fileChanges !== 'allow' ||
    agenticServices.mcpTools !== 'allow'
  const permissionModeLabel = approvalMode === 'plan'
    ? 'Read-only sandbox'
    : approvalMode === 'auto_edit'
      ? hasAgenticApprovalGate ? 'Workspace write, gated' : 'Workspace write, no prompts'
      : 'Workspace write, prompts'
  const trustSelectValue = trustResult?.status === 'trusted' || trustResult?.status === 'inherited' || sessionTrust ? 'trusted' : 'untrusted'
  const persistentSessionLabel = persistentSessionStatus === 'active'
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
  const permissionRequestTitle = permissionRequestKind === 'workspace_trust'
    ? 'Workspace trust requested'
    : permissionRequestKind === 'tool_permission'
      ? 'Tool permission requested'
      : 'Attachment access requested'
  const currentRunDiff = currentRun?.runDiff
  const fileChangeSummaries = getRunFileDiffSummaries(runDiff || currentRunDiff || null)
  const displayFileChangeSummaries = fileChangeSummaries.filter((item) => !item.isNoise)
  const createdChangeCount = displayFileChangeSummaries.filter((item) => item.status === 'created').length
  const modifiedChangeCount = displayFileChangeSummaries.filter((item) => item.status === 'modified').length
  const deletedChangeCount = displayFileChangeSummaries.filter((item) => item.status === 'deleted').length
  const fileChangeSummaryText = displayFileChangeSummaries.length > 0
    ? `Created ${createdChangeCount} · Edited ${modifiedChangeCount} · Deleted ${deletedChangeCount}`
    : 'No file changes detected.'
  const fileChangeAdds = displayFileChangeSummaries.reduce((total, item) => total + (item.additions || 0), 0)
  const fileChangeDels = displayFileChangeSummaries.reduce((total, item) => total + (item.deletions || 0), 0)
  const fileChangeHasLineStats = displayFileChangeSummaries.some((item) => item.additions !== undefined || item.deletions !== undefined)
  const fileChangeDisplayAdds = fileChangeHasLineStats ? fileChangeAdds : createdChangeCount + modifiedChangeCount
  const fileChangeDisplayDels = fileChangeHasLineStats ? fileChangeDels : deletedChangeCount
  const fileChangeShouldShowStats = fileChangeHasLineStats || displayFileChangeSummaries.length > 0
  const transcriptMessages = currentChat?.messages || []
  const hasConversationContent = transcriptMessages.some((message) =>
    message.role === 'user' ||
    message.role === 'assistant' ||
    message.role === 'tool' ||
    message.role === 'error'
  )
  const isWelcomeChat = Boolean(
    currentChat &&
    !hasConversationContent &&
    !isCurrentChatRunning &&
    !showFallbackUX
  )
  const visibleTranscriptMessages = isWelcomeChat ? [] : transcriptMessages
  const shouldShowRunCompleteNotice = Boolean(runCompleteNotice && !isWelcomeChat)
  const runCompleteDurationText = shouldShowRunCompleteNotice && runCompleteNotice
    ? formatWorkDuration(runCompleteNotice.startedAt, runCompleteNotice.timestamp)
    : null
  const isChatExpanded = !showWorkspaceSidebar || (!appearance.showInspector && !showFileEditor)
  const welcomeCopy = buildWelcomeCopy(currentWorkspace?.displayName || 'GUIGemini', currentChat?.appChatId)
  const visibleScheduledTasks = scheduledTasks
    .filter((task) => !currentWorkspace || task.workspaceId === currentWorkspace.id)
    .filter((task) => task.status === 'pending' || task.status === 'due' || task.status === 'running')
    .slice(0, 4)
  const scheduleControls = (
    <span className="composer-scheduler-controls">
      <label className="composer-schedule-label" title="Schedule this prompt">
        <ClockSymbolIcon />
        <input
          className="composer-schedule-input"
          type="datetime-local"
          value={scheduleRunAt}
          min={toDateTimeLocalValue(new Date(Date.now() + 60_000))}
          onChange={(event) => setScheduleRunAt(event.target.value)}
          disabled={!currentWorkspace || !currentChat || isCurrentProviderRunning}
          aria-label="Scheduled run time"
        />
      </label>
      <button
        className="composer-picker-command composer-icon-command"
        type="button"
        onClick={() => void handleScheduleRun()}
        disabled={!currentWorkspace || !currentChat || !prompt.trim() || !scheduleRunAt || isCurrentProviderRunning}
        title="Schedule prompt"
        aria-label="Schedule prompt"
      >
        <ClockSymbolIcon />
      </button>
    </span>
  )

  const handleRollbackCodexThread = async (threadId: string) => {
    if (!threadId || typeof window.api.rollbackAgentThread !== 'function') return
    const confirmed = window.confirm('Rollback Codex thread history by one turn? This changes the Codex conversation thread only and does not revert workspace files. Use Diff Studio or git to revert files separately.')
    if (!confirmed) return
    try {
      const result = await window.api.rollbackAgentThread('codex', threadId, 1)
      const nextThreadId = result?.result?.thread?.id || result?.result?.threadId || result?.thread?.id || result?.threadId || threadId
      setRawLogs(prev => [...prev, {
        type: 'info',
        content: nextThreadId && nextThreadId !== threadId
          ? 'Codex thread rolled back. New thread id: ' + nextThreadId + '. Files were not reverted.'
          : 'Codex thread rollback requested. Files were not reverted.'
      }])
      if (currentWorkspace && currentChat && currentChat.linkedProviderSessionId === threadId && nextThreadId && nextThreadId !== threadId) {
        const updatedChat = { ...currentChat, linkedProviderSessionId: nextThreadId }
        await window.api.saveChat(updatedChat)
        setCurrentChat(updatedChat)
        setChats(prev => prev.map(chat => chat.appChatId === currentChat.appChatId ? updatedChat : chat))
      }
      await refreshCodexThreads()
    } catch (error) {
      setRawLogs(prev => [...prev, { type: 'stderr', content: error instanceof Error ? error.message : String(error) }])
    }
  }

  const handleImportCodexUsageCredential = async () => {
    if (typeof window.api.importCodexUsageCredential !== 'function') return
    try {
      const result = await window.api.importCodexUsageCredential()
      if (result?.cancelled) {
        return
      }
      setRawLogs(prev => [...prev, {
        type: 'info',
        content: result?.imported
          ? `Imported Codex usage session for account ${result.accountId || 'unknown'}.`
          : 'Codex usage session was not imported.'
      }])
      void refreshProviderMetadata('codex')
    } catch (error) {
      setRawLogs(prev => [...prev, { type: 'stderr', content: `Failed to import Codex usage session: ${redactLog(String(error))}` }])
    }
  }

  const handleClearCodexUsageCredential = async () => {
    if (typeof window.api.clearCodexUsageCredential !== 'function') return
    try {
      await window.api.clearCodexUsageCredential()
      setCodexStatus((prev: any) => prev ? { ...prev, codexUsage: { configured: false, error: 'Codex usage import is not configured.' } } : prev)
      if (currentWorkspaceIdRef.current) {
        void refreshUsageSummary(currentWorkspaceIdRef.current)
      }
      setRawLogs(prev => [...prev, { type: 'info', content: 'Cleared imported Codex usage session.' }])
    } catch (error) {
      setRawLogs(prev => [...prev, { type: 'stderr', content: `Failed to clear Codex usage session: ${redactLog(String(error))}` }])
    }
  }

  const commandPaletteItems = currentProvider === 'codex'
    ? CODEX_COMMAND_PALETTE_CORE
    : currentProvider === 'claude' || currentProvider === 'kimi'
      ? CLI_PROVIDER_COMMAND_PALETTE_CORE
    : mergeCommandPaletteItems(discoveredCommands)
  const commandPaletteSearch = commandPaletteQuery.trim().toLowerCase()
  const visibleCommandPaletteItems = commandPaletteSearch
    ? commandPaletteItems.filter((item) =>
        `${item.command} ${item.label} ${item.description} ${item.group} ${item.sourcePath || ''}`
          .toLowerCase()
          .includes(commandPaletteSearch)
      )
    : commandPaletteItems
  const commandPaletteGroups: CommandPaletteGroup[] = ['Core', 'Discovery', 'Memory', 'Inspectors', 'Custom']
  const appMainStyle = showWorkspaceSidebar ? ({ '--sidebar-width': `${workspaceSidebarWidth}px` } as CSSProperties) : undefined

  return (
    <div className="app-root">
      <div className="window-drag-strip" aria-hidden />
      <div className={`app-main ${isChatExpanded ? 'chat-expanded' : ''}`} style={appMainStyle}>
        {showWorkspaceSidebar && (
          <>
            <Sidebar
              workspaces={workspaces}
              currentWorkspace={currentWorkspace}
              chats={chats}
              currentChat={currentChat}
              currentRun={currentRun}
              usageSummary={usageSummary}
              runningChatIds={[...runningChatIds]}
              onSelectWorkspace={handleSelectExistingWorkspace}
              onRemoveWorkspace={handleRemoveWorkspace}
              onSelectWorkspaceDialog={handleSelectWorkspace}
              onNewChat={handleNewChat}
              onSelectChat={handleSelectChat}
              onOpenSettings={() => setShowSettings(true)}
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
          className={`app-transcript provider-${currentProvider} ${isWelcomeChat ? 'welcome-mode' : ''} ${showGeminiTerminal && currentProvider === 'gemini' ? 'gemini-terminal-open' : ''}`}
          style={showGeminiTerminal && currentProvider === 'gemini' ? ({ '--gemini-terminal-height': `${geminiTerminalHeight}px` } as CSSProperties) : undefined}
        >
          {chatContextNotice && (
            <div className="chat-context-application-pill" role="status">
              <span>{chatContextNotice.message}</span>
            </div>
          )}
          <div className={`chat-corner-controls chat-corner-controls-left ${showWorkspaceSidebar ? '' : 'chat-corner-controls-workspace-hidden'}`}>
            <button
              className="chat-corner-btn"
              type="button"
              onClick={() => setShowWorkspaceSidebar(current => !current)}
              title={`${showWorkspaceSidebar ? 'Hide' : 'Show'} workspace sidebar`}
              aria-label="Toggle workspace sidebar"
            >
              <SidebarCornerIcon direction="left" isOpen={showWorkspaceSidebar} />
            </button>
            <button
              className={`chat-corner-btn ${showSkyVisualFx ? 'active' : ''}`}
              type="button"
              onClick={() => setShowSkyVisualFx(current => !current)}
              title={`${showSkyVisualFx ? 'Hide' : 'Show'} sky weather effects${hostWeather?.description ? ` · ${hostWeather.description}` : ''}`}
              aria-label="Toggle sky weather effects"
              aria-pressed={showSkyVisualFx}
            >
              <SkyWeatherIcon />
            </button>
            <button
              className={`chat-corner-btn ${showGhostCompanion ? 'active' : ''}`}
              type="button"
              onClick={() => setShowGhostCompanion(current => !current)}
              title={`${showGhostCompanion ? 'Hide' : 'Show'} ghost companion`}
              aria-label="Toggle ghost companion"
            >
              <GhostCompanionIcon />
            </button>
          </div>

          <div className="chat-corner-controls chat-corner-controls-right">
              {currentProvider === 'gemini' && (
                <button
                  className={`chat-corner-btn ${showGeminiTerminal ? 'active' : ''}`}
                  type="button"
                  onClick={() => setShowGeminiTerminal(current => !current)}
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
                  const nextShowFileEditor = !showFileEditor
                  setShowFileEditor(nextShowFileEditor)
                  if (nextShowFileEditor && window.innerWidth <= 1180 && appearance.showInspector) {
                    appearance.update({ showInspector: false })
                  }
                }}
                title={`${showFileEditor ? 'Hide' : 'Show'} file editor`}
                aria-label="Toggle file editor"
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

          {showSkyVisualFx && <SkyWeatherVisual weather={hostWeather} />}

          {currentProvider === 'gemini' && isOldVersion && (
            <div className="version-warning">
              <strong>Warning:</strong> Gemini CLI version ({geminiVersion}) appears to be older than 0.39.1. Headless workspace-trust behavior had recent security hardening. Please upgrade Gemini CLI before using this app on real repositories.
            </div>
          )}

          <div className="transcript-scroll">
            <div className="transcript-inner">
              {visibleTranscriptMessages.map((msg) => (
                msg.role === 'tool' ? (
                  <ActivityStack key={msg.id} activities={msg.toolActivities || []} workspacePath={currentWorkspace?.path} />
                ) : (
                <div key={msg.id} className={`message-group`}>
                    <div className="message-meta">
                      {msg.role === 'user' ? 'You' : msg.role === 'assistant' ? currentProviderLabel : msg.role === 'error' ? 'Error' : 'System'}
                    </div>
                    <div className={`message-bubble ${msg.role}`}>
                      {msg.role === 'assistant' ? renderGeminiMessage(msg.content) : msg.content}
                    </div>
                    {pendingPlanChoice && pendingPlanChoice.messageId === msg.id && (
                      <div className="plan-choice-card">
                        <div className="plan-choice-question">{pendingPlanChoice.question}</div>
                        <div className="plan-choice-actions">
                          {pendingPlanChoice.options.map((option) => (
                            <button
                              key={option}
                              type="button"
                              className="plan-choice-action-btn"
                              onClick={() => handlePlanChoiceSubmit(msg.id, option)}
                              title={`Continue with "${option}"`}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              ))}
              {isThinking && (
                <div key="thinking-indicator" className="message-group">
                  <div className="message-meta">{currentProviderLabel}</div>
                  <ThinkingIndicator />
                </div>
              )}
              {showFallbackUX && (
                <div className="fallback-card">
                  <p>Gemini model capacity exhausted. The CLI was retrying. Try an alternative or wait.</p>
                  <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                    <button className="btn btn-sm" onClick={() => handleRunFallback('flash-lite')}>Retry with Flash Lite</button>
                    <button className="btn btn-sm" onClick={() => handleRunFallback('flash')}>Retry with Flash</button>
                  </div>
                </div>
              )}
              {shouldShowRunCompleteNotice && runCompleteNotice && (
                <div className="run-complete-card">
                  <div className="run-complete-main">
                    <div className="run-complete-metadata">
                      <strong>{runCompleteNotice.exitCode === 0 ? 'Task complete' : `Task ended (code ${runCompleteNotice.exitCode})`}</strong>
                      <span className="run-complete-time-row">
                        <span>{new Date(runCompleteNotice.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                        {runCompleteDurationText && <span>{runCompleteDurationText}</span>}
                      </span>
                      {runCompleteNotice.exitCode === 0 && <span>Awaiting your next prompt.</span>}
                    </div>
                    <button
                      className="btn btn-sm btn-ghost run-copy-btn"
                      onClick={() => {
                        const latestAssistantMessage = [...(currentChat?.messages || [])]
                          .slice()
                          .reverse()
                          .find((m) => m.role === 'assistant')
                        if (latestAssistantMessage?.content) {
                          navigator.clipboard.writeText(latestAssistantMessage.content)
                        }
                      }}
                      disabled={!currentChat?.messages.some((m) => m.role === 'assistant')}
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
                            <span className="file-change-stat file-change-stat-add">+{fileChangeDisplayAdds}</span>
                            <span className="file-change-stat-divider">|</span>
                            <span className="file-change-stat file-change-stat-delete">-{fileChangeDisplayDels}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="file-change-summary-list">
                      {displayFileChangeSummaries.length > 0 ? (
                        <>
                          {displayFileChangeSummaries.slice(0, 12).map((item) => (
                            <div key={`${item.path}-${item.status}`} className="file-change-summary-item">
                              <span className={`file-change-summary-status status-${item.status}`}>
                                {item.status === 'modified' ? 'edited' : item.status}
                              </span>
                              <FileTypeIcon path={item.path} size={14} className="file-change-summary-type-icon" workspacePath={currentWorkspace?.path} />
                              <span className="file-change-summary-path" title={item.path}>
                                {item.path}
                              </span>
                              {(item.additions !== undefined || item.deletions !== undefined) && (
                                <span className="file-change-summary-item-stats">
                                  <span className="file-change-stat file-change-stat-add">+{item.additions || 0}</span>
                                  <span className="file-change-stat-divider">|</span>
                                  <span className="file-change-stat file-change-stat-delete">-{item.deletions || 0}</span>
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
              <div ref={logsEndRef} />
            </div>
          </div>

          {showGeminiTerminal && currentProvider === 'gemini' && (
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
              <div className="gemini-terminal-split" role="region" aria-label="Gemini terminal output">
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
                    onClick={() => setThreadRawLogs(currentChat?.appChatId || currentChatIdRef.current, [])}
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
                    <div key={`${index}-${entry.type}`} className={`gemini-terminal-line terminal-${entry.type}`}>
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

          <div className="composer-area" ref={composerAreaRef}>
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
              {showGhostCompanion && <GhostCompanion />}
              <div
                className={`composer-surface ${isComposerDragOver ? 'is-drag-over' : ''}`}
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
                {isCurrentChatProviderLocked && (
                  <span className="composer-chip composer-chat-lock-chip">{currentProviderLabel} chat locked</span>
                )}
              </div>
              {currentProvider === 'gemini' ? (
                <div className="composer-top-toggles">
                  <button
                    className={`composer-picker-command persistent-session-toggle ${isPersistentSessionEnabled ? 'active' : ''} ${persistentSessionStatus === 'error' || persistentSessionStatus === 'unavailable' || persistentSessionNeedsRestart ? 'warning' : ''}`}
                    type="button"
                    onClick={() => void handlePersistentSessionToggle()}
                    disabled={!currentWorkspace || persistentSessionStatus === 'starting' || persistentSessionStatus === 'stopping'}
                    title={persistentSessionNeedsRestart ? sessionRestartReason : 'Keep an interactive Gemini CLI session open for slash commands'}
                  >
                    <LinkCircleSymbolIcon />
                    <span className="composer-control-label-text">{persistentSessionNeedsRestart ? 'Restart session' : persistentSessionLabel}</span>
                  </button>
                  <button
                    className={`composer-picker-command persistent-session-toggle checkpoint-toggle ${geminiCheckpointingEnabled ? 'active' : ''}`}
                    type="button"
                    onClick={() => handleSettingsChange({ geminiCheckpointingEnabled: !geminiCheckpointingEnabled })}
                    disabled={!currentWorkspace || isCurrentProviderRunning}
                    title={geminiCheckpointingEnabled ? 'Disable Gemini CLI checkpointing for new runs' : 'Enable Gemini CLI checkpointing for new runs'}
                  >
                    <CheckpointSymbolIcon />
                    <span className="composer-control-label-text">{geminiCheckpointingEnabled ? 'Checkpoints on' : 'Checkpoints off'}</span>
                  </button>
                  <button
                    className={`composer-picker-command persistent-session-toggle worktree-toggle ${currentGeminiWorktree?.enabled ? 'active' : ''} ${currentWorktreeDiffUnavailable ? 'warning' : ''}`}
                    type="button"
                    onClick={() => void handleGeminiWorktreeToggle()}
                    disabled={!currentWorkspace || isCurrentProviderRunning}
                    title={currentGeminiWorktree?.enabled ? 'Disable Gemini CLI worktree mode for this workspace' : 'Run Gemini in an auto-created CLI worktree for this workspace'}
                  >
                    <WorktreeSymbolIcon />
                    <span className="composer-control-label-text">{worktreeToggleLabel}</span>
                  </button>
                  {scheduleControls}
                </div>
              ) : (
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
                </div>
              )}

              <textarea
                className="composer-textarea"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder={`Enter prompt for ${currentProviderLabel}…`}
                aria-label={`Prompt for ${currentProviderLabel}`}
                rows={3}
                disabled={!currentWorkspace || !currentChat}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    triggerSendConfirmation()
                    handleRun()
                  }
                }}
              />
              <div className="composer-control-footer">
                {imageAttachments.length > 0 && (
                  <div className="composer-image-strip">
                    {imageAttachments.map((image) => (
                      <div key={image.id} className="composer-image-item">
                        {isImageAttachmentPath(image.path) ? (
                          <img src={getImagePreviewSrc(image.path)} alt={image.name} className="composer-image-thumb" />
                        ) : (
                          <span className="composer-attachment-icon" title={image.name}>
                            <FileTypeIcon path={image.path} size={14} className="composer-attachment-icon-inner" workspacePath={currentWorkspace?.path} />
                          </span>
                        )}
                        <span className="composer-image-name" title={image.path}>{image.name}</span>
                        <button
                          className="composer-image-remove"
                          type="button"
                          onClick={() => handleRemoveImageAttachment(image.id)}
                          disabled={isCurrentProviderRunning}
                          title="Remove attachment"
                        >
                          <XSymbolIcon />
                        </button>
                      </div>
                    ))}
                    <span className="composer-image-count">{`${imageAttachments.length}/${MAX_IMAGE_ATTACHMENTS}`}</span>
                  </div>
                )}
                {currentProvider === 'codex' && codexExternalPathGrants.length > 0 && (
                  <div className="composer-image-strip composer-external-grant-strip">
                    {codexExternalPathGrants.map((grant) => (
                      <div key={grant.id} className={`composer-image-item external-grant access-${grant.access}`}>
                        <PermissionSymbolIcon />
                        <span className="composer-image-name" title={grant.path}>
                          {grant.access === 'write' ? 'Edit' : 'Read'} {grant.kind}: {grant.path}
                        </span>
                        <button
                          className="composer-image-remove"
                          type="button"
                          onClick={() => handleRemoveExternalPathGrant(grant.id)}
                          disabled={isCurrentProviderRunning}
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
                        <span className="composer-permission-source">{permissionRequestSource}</span>
                      )}
                    </div>
                    {permissionRequestMessage && (
                      <div className="composer-permission-message">{permissionRequestMessage}</div>
                    )}
                    <div className="composer-permission-paths">
                      {permissionRequestPaths.map((path) => (
                        <span key={path} className="composer-permission-path">{path}</span>
                      ))}
                    </div>
                    <div className="composer-permission-actions">
                      <button className="btn btn-sm" type="button" onClick={handlePermissionRetry}>
                        Add paths and rerun
                      </button>
                      <button className="btn btn-sm btn-ghost" type="button" onClick={clearImagePermissions}>
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
                {pendingAgentApproval && (
                  <div className={`composer-permission-card provider-${pendingAgentApproval.provider}`}>
                    <div className="composer-permission-title">
                      <span>{pendingAgentApproval.title}</span>
                      <span className="composer-permission-source">{getProviderLabel(pendingAgentApproval.provider)}</span>
                    </div>
                    {pendingAgentApproval.body && (
                      <div className="composer-permission-message">{pendingAgentApproval.body}</div>
                    )}
                    {renderAgentApprovalPreview(pendingAgentApproval.preview)}
                    <div className="composer-permission-actions">
                      {(pendingAgentApproval.actions || ['accept']).includes('accept') && (
                        <button className="btn btn-sm" type="button" onClick={() => void handleAgentApprovalAction(pendingAgentApproval.id, 'accept')}>
                          {pendingAgentApproval.method === 'hostCommand/rerun' ? 'Rerun outside sandbox' : 'Allow once'}
                        </button>
                      )}
                      {(pendingAgentApproval.actions || []).includes('acceptForWorkspace') && (
                        <button className="btn btn-sm btn-ghost" type="button" onClick={() => void handleAgentApprovalAction(pendingAgentApproval.id, 'acceptForWorkspace')}>
                          Allow in workspace
                        </button>
                      )}
                      {(pendingAgentApproval.actions || ['acceptForSession']).includes('acceptForSession') && (
                        <button className="btn btn-sm btn-ghost" type="button" onClick={() => void handleAgentApprovalAction(pendingAgentApproval.id, 'acceptForSession')}>
                          Allow for session
                        </button>
                      )}
                      {(pendingAgentApproval.actions || ['decline']).includes('decline') && (
                        <button className="btn btn-sm btn-ghost" type="button" onClick={() => void handleAgentApprovalAction(pendingAgentApproval.id, 'decline')}>
                          Deny
                        </button>
                      )}
                      {(pendingAgentApproval.actions || ['cancel']).includes('cancel') && (
                        <button className="btn btn-sm btn-ghost" type="button" onClick={() => void handleAgentApprovalAction(pendingAgentApproval.id, 'cancel')}>
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
                        <strong>{currentProvider === 'gemini' ? 'Slash command palette' : `${currentProviderLabel} command palette`}</strong>
                        <span>{currentProvider === 'gemini' ? commandDiscoveryStatus : `App-native ${currentProviderLabel} commands and provider controls.`}</span>
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
                      placeholder={currentProvider === 'gemini' ? 'Filter commands, memory, hooks...' : `Filter ${currentProviderLabel} commands...`}
                      autoFocus
                    />
                    <div className="command-palette-list">
                      {commandPaletteGroups.map((group) => {
                        const groupItems = visibleCommandPaletteItems.filter((item) => item.group === group)
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
                                title={currentProvider === 'gemini' ? `Send ${item.command} to Gemini CLI` : `Run ${item.command}`}
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
                      {COMMAND_PALETTE_CORE.filter((item) => item.group === 'Memory').map((item) => (
                        <button
                          key={item.id}
                          className="composer-picker-command"
                          type="button"
                          onClick={() => void handleBridgeCommand(item.command)}
                          disabled={!currentWorkspace || !currentChat}
                        >
                          <span className="composer-picker-command-slash">{item.command}</span>
                        </button>
                      ))}
                    </div>
                    <div className="memory-file-list">
                      {geminiMemoryFiles.map((file) => (
                        <details key={file.id} className="memory-file-card">
                          <summary>
                            <span className={`memory-file-scope scope-${file.scope}`}>{file.scope}</span>
                            <span className="memory-file-path">{file.displayPath}</span>
                            {file.sizeBytes !== undefined && <span className="memory-file-size">{file.sizeBytes} bytes</span>}
                          </summary>
                          <pre className={`memory-file-content ${file.error ? 'memory-file-error' : ''}`}>{getMemoryPreviewText(file)}</pre>
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
                      disabled={isCurrentProviderRunning}
                    >
                      <PlusSymbolIcon />
                    </button>
                    {currentProvider === 'codex' && (
                      <label className="composer-picker-label" title="Grant Codex access to a file or folder outside this workspace">
                        <PermissionSymbolIcon />
                        <select
                          className="composer-inline-picker"
                          aria-label="Grant external path access"
                          value=""
                          disabled={isCurrentProviderRunning || !currentWorkspace || !currentChat}
                          onChange={(event) => {
                            const access = event.target.value as 'read' | 'write'
                            if (access === 'read' || access === 'write') {
                              void handlePickExternalPathGrant(access)
                            }
                          }}
                        >
                          <option value="">External path</option>
                          <option value="read">Grant read...</option>
                          <option value="write">Grant edit...</option>
                        </select>
                      </label>
                    )}
                    <label className="composer-picker-label" title="Provider">
                      <LinkCircleSymbolIcon />
                      <select
                        className="composer-inline-picker"
                        aria-label="Provider"
                        value={currentProvider}
                        onChange={(event) => void handleProviderChange(event.target.value as ProviderId)}
                        disabled={isCurrentProviderRunning || isCurrentChatProviderLocked}
                      >
                        <option value="gemini">Gemini</option>
                        <option value="codex">Codex</option>
                        <option value="claude">Claude</option>
                        <option value="kimi">Kimi</option>
                      </select>
                    </label>
                    <label className="composer-picker-label" title="Model">
                      <ModelSymbolIcon />
                      <select
                        className="composer-inline-picker"
                        aria-label={`${currentProviderLabel} model`}
                        value={selectedModelType}
                        onChange={e => {
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
                              metadataPatch.codexReasoningEffort = modelOption.defaultReasoningEffort
                            }
                            if (!modelOption?.additionalSpeedTiers?.includes('fast')) {
                              setCodexServiceTier('')
                              metadataPatch.codexServiceTier = ''
                            }
                          }
                          if (currentProvider === 'gemini' && nextModel !== 'custom') {
                            syncPersistentModelSelection(nextModel)
                          }
                          rememberCurrentChatComposerSelection(metadataPatch)
                        }}
                        disabled={isCurrentProviderRunning}
                      >
                        {currentProvider === 'gemini' ? (
                          <>
                            <option value="cli-default">CLI Default</option>
                            <option value="auto">Auto</option>
                            <option value="pro">Pro</option>
                            <option value="flash">Flash</option>
                            <option value="flash-lite">Flash Lite</option>
                            <option value="custom">Custom…</option>
                          </>
                        ) : (
                          <>
                            {currentProviderModelOptions.map((model) => (
                              <option key={model.id} value={model.id}>{model.label || model.id}</option>
                            ))}
                            <option value="custom">Custom…</option>
                          </>
                        )}
                      </select>
                      {selectedModelType === 'custom' && (
                        <span className="composer-inline-custom-model">
                          <input
                            className="composer-inline-input"
                            type="text"
                            value={customModel}
                            onChange={e => {
                              setCustomModel(e.target.value)
                              rememberCurrentChatComposerSelection({ customModel: e.target.value })
                            }}
                            placeholder="Model ID"
                            disabled={isCurrentProviderRunning}
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
                            disabled={isCurrentProviderRunning}
                            title="Cancel custom model"
                            aria-label="Cancel custom model"
                          >
                            <XSymbolIcon />
                          </button>
                        </span>
                      )}
                    </label>

                    {currentProvider === 'codex' && (
                    <label className="composer-picker-label" title="Reasoning effort">
                      <QuestionmarkCircleSymbolIcon />
                      <select
                        className="composer-inline-picker"
                        aria-label="Codex reasoning effort"
                        value={codexReasoningEffort}
                        onChange={(event) => {
                          setCodexReasoningEffort(event.target.value)
                          rememberCurrentChatComposerSelection({ codexReasoningEffort: event.target.value })
                        }}
                        disabled={isCurrentProviderRunning}
                      >
                        {codexReasoningOptions.map((option) => (
                          <option key={option.reasoningEffort} value={option.reasoningEffort}>
                            {option.reasoningEffort}
                          </option>
                        ))}
                      </select>
                    </label>
                    )}

                    <label className="composer-picker-label" title="Permissions">
                      <PermissionSymbolIcon />
                      <select
                        className="composer-inline-picker"
                        aria-label="Permission mode"
                        value={approvalMode}
                        onChange={e => {
                          setApprovalMode(e.target.value)
                          rememberCurrentChatComposerSelection({ approvalMode: e.target.value })
                        }}
                        disabled={isCurrentProviderRunning || (currentProvider === 'gemini' && trustResult?.status === 'untrusted' && !sessionTrust)}
                      >
                        <option value="plan">Plan / Read-only</option>
                        <option value="default">Default approval</option>
                        <option value="auto_edit">Edit files (auto_edit)</option>
                      </select>
                    </label>

                    {currentProvider === 'gemini' && (
                    <label className="composer-picker-label" title="Workspace trust">
                      <TrustSymbolIcon />
                      <select
                        className="composer-inline-picker"
                        aria-label="Workspace trust"
                        value={trustSelectValue}
                        onChange={(e) => {
                          const nextValue = e.target.value
                          if (nextValue === 'trusted' && !sessionTrust && trustResult?.status !== 'trusted' && trustResult?.status !== 'inherited') {
                            setSessionTrust(true)
                            void handleBridgeCommand('/permissions trust')
                          } else if (nextValue === 'untrusted') {
                            setSessionTrust(false)
                          }
                        }}
                        disabled={isCurrentProviderRunning}
                        title="Workspace trust"
                      >
                        <option value="trusted">Trusted</option>
                        <option value="untrusted">Untrusted</option>
                      </select>
                    </label>
                    )}
                    {currentProvider === 'gemini' && (
                    <button
                      className="composer-picker-command composer-icon-command"
                      type="button"
                      onClick={() => void handleBridgeCommand('/stats')}
                      disabled={!currentWorkspace || !currentChat}
                      title="Show Gemini CLI stats (/stats)"
                      aria-label="Show Gemini CLI stats"
                    >
                      <ChartBarSymbolIcon />
                    </button>
                    )}
                    {currentProvider === 'gemini' && (
                    <button
                      className="composer-picker-command composer-icon-command"
                      type="button"
                      onClick={() => void handleBridgeCommand('/help')}
                      disabled={!currentWorkspace || !currentChat}
                      title="Show Gemini CLI help (/help)"
                      aria-label="Show Gemini CLI help"
                    >
                      <QuestionmarkCircleSymbolIcon />
                    </button>
                    )}
                    {currentProvider === 'gemini' && (
                    <button
                      className={`composer-picker-command composer-icon-command composer-command-palette-trigger ${isCommandPaletteOpen ? 'active' : ''}`}
                      type="button"
                      onClick={() => setIsCommandPaletteOpen((current) => !current)}
                      disabled={!currentWorkspace || !currentChat}
                      title="Open Gemini slash command palette"
                      aria-label="Open Gemini slash command palette"
                    >
                      <CommandSymbolIcon />
                    </button>
                    )}
                    {currentProvider === 'gemini' && (
                    <button
                      className={`composer-picker-command composer-secondary-command ${isMemoryInspectorOpen ? 'active' : ''}`}
                      type="button"
                      onClick={() => setIsMemoryInspectorOpen((current) => !current)}
                      disabled={!currentWorkspace}
                      title="Inspect GEMINI.md memory files"
                    >
                      <span className="composer-picker-command-slash">GEMINI.md</span>
                    </button>
                    )}
                    {currentProvider !== 'gemini' && (
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
                    {currentProvider !== 'gemini' && (
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
                    {currentProvider !== 'gemini' && (
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
                    {currentProvider !== 'gemini' && (
                    <button
                      className={`composer-picker-command composer-icon-command composer-command-palette-trigger ${isCommandPaletteOpen ? 'active' : ''}`}
                      type="button"
                      onClick={() => setIsCommandPaletteOpen((current) => !current)}
                      disabled={!currentWorkspace || !currentChat}
                      title={`Open ${currentProviderLabel} command palette`}
                      aria-label={`Open ${currentProviderLabel} command palette`}
                    >
                      <CommandSymbolIcon />
                    </button>
                    )}
                    <button
                      className="composer-picker-command composer-icon-command composer-review-command"
                      type="button"
                      onClick={() => void handleReviewCurrentDiff()}
                      disabled={!currentWorkspace || !currentChat || isPreparingDiffReview}
                      title={isPreparingDiffReview ? 'Preparing review...' : 'Review the current workspace diff in read-only plan mode'}
                      aria-label={isPreparingDiffReview ? 'Preparing review' : 'Review current diff'}
                    >
                      <ReviewSymbolIcon />
                    </button>
                    {currentProvider === 'gemini' && (
                    <button
                      className="composer-picker-command composer-secondary-command"
                      type="button"
                      onClick={() => void handleRestoreCheckpoint()}
                      disabled={!currentWorkspace || !currentChat}
                      title="Open Gemini CLI /restore after confirmation. Checkpoint file discovery is left to Gemini because project hash derivation is not verified."
                    >
                      <span className="composer-picker-command-slash">/restore</span>
                    </button>
                    )}
                  </div>
                  <div className="composer-inline-actions">
                    {isCurrentProviderRunning ? (
                      <>
                      <button
                          className={`composer-action-btn run-btn queue ${isSendConfirming ? 'send-confirming' : ''}`}
                          onClick={() => {
                            triggerSendConfirmation()
                            handleRun()
                          }}
                          disabled={!currentWorkspace || !currentChat || !prompt.trim()}
                          title="Queue next run"
                          aria-label="Queue next run"
                          type="button"
                      >
                        <QueueSymbolIcon />
                      </button>
                        <button
                          className="composer-action-btn stop-btn"
                          onClick={handleCancel}
                          title="Stop run"
                          aria-label="Stop run"
                          type="button"
                        >
                          <StopSymbolIcon />
                        </button>
                      </>
                    ) : (
                      <button
                        className={`composer-action-btn run-btn ${isSendConfirming ? 'send-confirming' : ''}`}
                        onClick={() => {
                          triggerSendConfirmation()
                          handleRun()
                        }}
                        disabled={!currentWorkspace || !currentChat || !prompt.trim()}
                        title="Run"
                        aria-label="Run prompt"
                        aria-keyshortcuts="Meta+Enter Control+Enter"
                        type="button"
                      >
                        <RunSymbolIcon />
                      </button>
                    )}
                  </div>
                </div>
                {currentProvider === 'gemini' && trustResult?.status === 'untrusted' && !sessionTrust && (
                  <div className="composer-inline-warning" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--warning)' }}>Workspace untrusted. Auto-edit disabled. Enable session trust or use Trust Assistant.</div>
                )}
              </div>
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
                            setScheduledTasks(await window.api.getScheduledTasks(currentWorkspace?.id))
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
                {WELCOME_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    className="welcome-suggestion-btn"
                    type="button"
                    onClick={() => handleWelcomeSuggestion(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {showFileEditor && (
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
              setRawLogs={(logs) => setThreadRawLogs(currentChat?.appChatId || currentChatIdRef.current, logs as RawLogEntry[])}
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
            />
          </>
        )}
      </div>

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
          position: 'fixed', inset: 0, zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.45)'
        }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            style={{
            width: 'min(420px, calc(100vw - 32px))', maxHeight: 'calc(100dvh - 32px)',
            background: 'var(--panel-bg-solid)',
            border: '1px solid var(--panel-border)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-lg)',
            overflow: 'hidden',
            display: 'flex', flexDirection: 'column'
          }}>
            <SettingsPanel
              mode={appearance.mode}
              visualEffectStyle={appearance.visualEffectStyle}
              themeAppearance={appearance.themeAppearance}
              themeCornerStyle={appearance.themeCornerStyle}
              themeAccentStyle={appearance.themeAccentStyle}
              promptSurfaceStyle={appearance.promptSurfaceStyle}
              reduceTransparency={appearance.reduceTransparency}
              reduceMotion={appearance.reduceMotion}
              compactDensity={appearance.compactDensity}
              geminiCheckpointingEnabled={geminiCheckpointingEnabled}
              chatContextTurns={chatContextTurns}
              claudeBinaryPath={claudeBinaryPath}
              kimiBinaryPath={kimiBinaryPath}
              agenticServices={agenticServices}
              agenticWorkspaceGrantCount={agenticWorkspaceGrantCount}
              geminiMcpBridgeEnabled={geminiMcpBridgeEnabled}
              geminiMcpBridgeStatus={geminiMcpBridgeStatus}
              codexSandboxFallback={codexSandboxFallback}
              onInstallGeminiMcpBridge={() => void installGeminiMcpBridge()}
              onRefreshGeminiMcpBridgeStatus={() => void refreshGeminiMcpBridgeStatus()}
              onChange={handleSettingsChange}
              onClose={() => setShowSettings(false)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default App
