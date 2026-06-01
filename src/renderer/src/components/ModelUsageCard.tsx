/*
 * ModelUsageCard — Phase L6 slice 1 extraction.
 *
 * The "Model Usage" card that lives in the AGBench sidebar
 * (provider stack with per-window progress bars and reset times).
 * Extracted from `Sidebar.tsx`'s inline JSX so the redesign work
 * (L6 slices 2-6) lands here without growing the already-large
 * Sidebar file further.
 *
 * Slice 1 deliberately keeps the EXISTING visual treatment — same
 * markup, same classes, same gradient — so this is a pure refactor.
 * Slices 2-6 then redesign in this component without churning
 * Sidebar.
 *
 * Data contract: same `ModelUsageAggregate[]` the sidebar consumes
 * today, populated by `App.tsx#refreshUsageSummary`. We filter to
 * the `model === 'usage limits'` entries (the per-provider quota
 * summaries) and sort by the canonical provider order for stable
 * visual ordering.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type { ProviderId } from '../../../main/store/types'
import type { ModelUsageAggregate, UsageWindowAggregate } from '../App'
import { computeQuotaPace } from '../lib/QuotaPace'
import { formatResetShort } from '../lib/UsageFormat'
import { getProviderName } from './Sidebar'
import { GrokCreditsMeter } from './GrokCreditsMeter'
import { ProviderLogoTile } from './ProviderLogoTile'
import { QuotaProgressBar } from './QuotaProgressBar'
import { UsageHeatmap } from './UsageHeatmap'
import './ModelUsageCard.css'

interface ModelUsageCardProps {
  usageSummary: ModelUsageAggregate[]
  variant?: 'card' | 'sidebar'
}

const PROVIDER_ORDER: ProviderId[] = ['gemini', 'codex', 'claude', 'kimi']
const SIDEBAR_USAGE_HEIGHT_STORAGE_KEY = 'agbench-sidebar-model-usage-height'
const SIDEBAR_USAGE_DEFAULT_HEIGHT = 520
const SIDEBAR_USAGE_MIN_HEIGHT = 220
// Six providers (gemini/codex/claude/kimi/cursor/grok) make the meter list
// much taller, so the drag cap was raised 1080 → 1400 (the rendered height is
// still bounded by `calc(100vh - 56px)` in ModelUsageCard.css so it can't
// overflow the viewport / push the Activity heatmap fully off-screen).
const SIDEBAR_USAGE_MAX_HEIGHT = 1400
const SIDEBAR_USAGE_RESIZE_STEP = 24

function clampSidebarUsageHeight(height: number, maxHeight = SIDEBAR_USAGE_MAX_HEIGHT): number {
  return Math.max(SIDEBAR_USAGE_MIN_HEIGHT, Math.min(maxHeight, height))
}

function readSidebarUsageHeight(): number | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage?.getItem(SIDEBAR_USAGE_HEIGHT_STORAGE_KEY)
  if (!raw) return null
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return null
  return clampSidebarUsageHeight(parsed)
}

function persistSidebarUsageHeight(height: number): void {
  if (typeof window === 'undefined') return
  window.localStorage?.setItem(SIDEBAR_USAGE_HEIGHT_STORAGE_KEY, String(Math.round(height)))
}

function sortByProvider(entries: ModelUsageAggregate[]): ModelUsageAggregate[] {
  return [...entries].sort((a, b) => {
    const aIdx = PROVIDER_ORDER.indexOf(a.provider)
    const bIdx = PROVIDER_ORDER.indexOf(b.provider)
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx)
  })
}

function ProviderLabel({
  provider,
  planName
}: {
  provider: ProviderId | undefined
  planName?: string
}) {
  const providerName = provider || 'gemini'
  return (
    <span className={`sidebar-provider-label provider-${providerName}`}>
      <ProviderLogoTile provider={provider} />
      <span className="model-usage-provider-name">{getProviderName(provider)}</span>
      {planName && planName.trim() && (
        <span className="model-usage-tier-badge">{planName.trim()}</span>
      )}
    </span>
  )
}

/**
 * Derive the [0, 1] USED fraction the QuotaProgressBar expects from
 * the aggregator's percent fields. As of the Phase L6 follow-up,
 * `UsageWindowAggregate.usedPercent` is HONEST — actually USED
 * percent — and `remainingPercent` is its complement. We prefer
 * `usedPercent` when set, derive from `remainingPercent` otherwise.
 */
function fillFractionForWindow(window: UsageWindowAggregate): number {
  if (Number.isFinite(window.usedPercent)) {
    return Math.max(0, Math.min(1, (window.usedPercent as number) / 100))
  }
  if (Number.isFinite(window.remainingPercent)) {
    return Math.max(0, Math.min(1, 1 - (window.remainingPercent as number) / 100))
  }
  return 0
}

function UsageWindowRow({
  provider,
  windowEntry
}: {
  provider: ProviderId
  windowEntry: UsageWindowAggregate
}) {
  const fraction = fillFractionForWindow(windowEntry)
  const percentText = `${Math.round(fraction * 100)}%`
  const windowReset = formatResetShort({ resetAt: windowEntry.resetAt })
  const title = `${windowEntry.label}: ${windowEntry.limitLabel}${
    windowReset ? ` · resets ${windowReset}` : ''
  }`
  // Phase L6 slice 2 — accent picks up the provider colour token so
  // each provider's bars read in their own brand colour. The CSS
  // variable name matches the token set defined in theme.css.
  const accent = `var(--provider-${provider}-color)`
  return (
    <div key={`${provider}-${windowEntry.id}`} className="model-usage-window" title={title}>
      <div className="model-usage-window-row">
        <span className="model-usage-window-label">{windowEntry.label}</span>
        {windowReset && <span className="model-usage-window-reset">resets {windowReset}</span>}
        <span className="model-usage-window-percent">{percentText}</span>
      </div>
      <QuotaProgressBar
        fraction={fraction}
        accent={accent}
        /* Phase L6 slice 3 — pace tick. `computeQuotaPace` returns
         * `null` for on-track / unmeasurable windows and the bar
         * paints no tick in that case. */
        pace={computeQuotaPace(windowEntry)}
      />
      <div className="model-usage-window-meta">
        <span>{windowEntry.limitLabel}</span>
      </div>
    </div>
  )
}

function ProviderUsageBlock({ entry }: { entry: ModelUsageAggregate }) {
  return (
    <div
      key={`${entry.provider}-${entry.model}`}
      className={`model-usage-item provider-${entry.provider} quota-only`}
    >
      <div className="model-usage-provider-heading">
        <ProviderLabel provider={entry.provider} planName={entry.planName} />
      </div>
      <div className="model-usage-window-list">
        {entry.windows!.map((windowEntry) => (
          <UsageWindowRow
            key={`${entry.provider}-${windowEntry.id}`}
            provider={entry.provider}
            windowEntry={windowEntry}
          />
        ))}
      </div>
    </div>
  )
}

function ModelUsageDisclosureIcon({ isExpanded }: { isExpanded: boolean }) {
  return (
    <span className={`model-usage-toggle-icon ${isExpanded ? 'is-expanded' : ''}`} aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6.2 4.7 10 8.1 6.2 11.5" />
      </svg>
    </span>
  )
}

export function ModelUsageCard({ usageSummary, variant = 'card' }: ModelUsageCardProps) {
  const quotaContentId = useId()
  const summaryRef = useRef<HTMLDivElement | null>(null)
  const resizeStartRef = useRef<{
    height: number
    maxHeight: number
    pointerId: number
    y: number
  } | null>(null)
  const [sidebarHeightPx, setSidebarHeightPx] = useState<number | null>(() =>
    readSidebarUsageHeight()
  )
  const sidebarHeightRef = useRef<number | null>(sidebarHeightPx)
  const [sidebarExpanded, setSidebarExpanded] = useState(true)
  const [sidebarResizing, setSidebarResizing] = useState(false)
  // Grok subscription-credit meter gate. Grok is NOT part of the token/cost
  // `usageSummary` (its credit pool comes from a separate on-demand PTY probe),
  // so we surface it only when the gated Grok provider adapter is registered.
  const [grokAvailable, setGrokAvailable] = useState(false)
  useEffect(() => {
    let active = true
    if (typeof window === 'undefined' || typeof window.api?.getProviderAdapters !== 'function') {
      return
    }
    void window.api
      .getProviderAdapters()
      .then((adapters) => {
        if (!active) return
        const ids = Array.isArray(adapters)
          ? adapters.map((adapter) => (adapter as { provider?: string } | null)?.provider)
          : []
        setGrokAvailable(ids.includes('grok'))
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  const quotaEntries = sortByProvider(usageSummary).filter(
    (entry) => entry.model === 'usage limits' && (entry.windows?.length || 0) > 0
  )
  // Render when there's a token/quota meter OR a gated Grok credit meter to show.
  if (quotaEntries.length === 0 && !grokAvailable) return null

  const isSidebarVariant = variant === 'sidebar'
  const showQuotaEntries = !isSidebarVariant || sidebarExpanded
  const title = sidebarExpanded ? 'Collapse provider usage' : 'Expand provider usage'
  const ariaHeight = Math.round(sidebarHeightPx ?? SIDEBAR_USAGE_DEFAULT_HEIGHT)
  const rootClassName = [
    'run-summary',
    'model-usage-summary',
    isSidebarVariant ? 'model-usage-summary--sidebar' : '',
    isSidebarVariant && sidebarExpanded ? 'is-resizable' : '',
    isSidebarVariant && !sidebarExpanded ? 'is-collapsed' : '',
    sidebarResizing ? 'is-resizing' : ''
  ]
    .filter(Boolean)
    .join(' ')
  const rootStyle =
    isSidebarVariant && sidebarExpanded && sidebarHeightPx
      ? ({ '--model-usage-sidebar-height': `${sidebarHeightPx}px` } as CSSProperties)
      : undefined

  const getSidebarResizeMaxHeight = (): number => {
    if (typeof window === 'undefined') return SIDEBAR_USAGE_MAX_HEIGHT
    const parentHeight = summaryRef.current?.parentElement?.getBoundingClientRect().height
    const viewportMax = window.innerHeight - 56
    const parentMax = parentHeight ? parentHeight - 24 : SIDEBAR_USAGE_MAX_HEIGHT
    return Math.max(
      SIDEBAR_USAGE_MIN_HEIGHT,
      Math.min(SIDEBAR_USAGE_MAX_HEIGHT, viewportMax, parentMax)
    )
  }

  const updateSidebarHeight = (height: number, maxHeight = getSidebarResizeMaxHeight()): number => {
    const nextHeight = clampSidebarUsageHeight(height, maxHeight)
    sidebarHeightRef.current = nextHeight
    setSidebarHeightPx(nextHeight)
    return nextHeight
  }

  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isSidebarVariant || !sidebarExpanded || event.button !== 0) return
    const currentHeight =
      sidebarHeightRef.current ?? summaryRef.current?.getBoundingClientRect().height ?? 0
    const maxHeight = getSidebarResizeMaxHeight()
    resizeStartRef.current = {
      height: clampSidebarUsageHeight(currentHeight || SIDEBAR_USAGE_DEFAULT_HEIGHT, maxHeight),
      maxHeight,
      pointerId: event.pointerId,
      y: event.clientY
    }
    setSidebarResizing(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const moveSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = resizeStartRef.current
    if (!start || start.pointerId !== event.pointerId) return
    const delta = start.y - event.clientY
    updateSidebarHeight(start.height + delta, start.maxHeight)
  }

  const endSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = resizeStartRef.current
    if (!start || start.pointerId !== event.pointerId) return
    resizeStartRef.current = null
    setSidebarResizing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const finalHeight = sidebarHeightRef.current
    if (finalHeight) persistSidebarUsageHeight(finalHeight)
  }

  const resizeSidebarWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isSidebarVariant || !sidebarExpanded) return
    const maxHeight = getSidebarResizeMaxHeight()
    const currentHeight =
      sidebarHeightRef.current ??
      summaryRef.current?.getBoundingClientRect().height ??
      SIDEBAR_USAGE_DEFAULT_HEIGHT
    const step = event.shiftKey ? SIDEBAR_USAGE_RESIZE_STEP * 2 : SIDEBAR_USAGE_RESIZE_STEP
    let nextHeight: number | null = null

    if (event.key === 'ArrowUp') nextHeight = currentHeight + step
    if (event.key === 'ArrowDown') nextHeight = currentHeight - step
    if (event.key === 'Home') nextHeight = SIDEBAR_USAGE_MIN_HEIGHT
    if (event.key === 'End') nextHeight = maxHeight
    if (nextHeight === null) return

    event.preventDefault()
    persistSidebarUsageHeight(updateSidebarHeight(nextHeight, maxHeight))
  }

  return (
    <div ref={summaryRef} className={rootClassName} style={rootStyle}>
      {isSidebarVariant && sidebarExpanded && (
        <div
          role="separator"
          tabIndex={0}
          className="model-usage-resize-handle"
          aria-label="Resize model usage panel"
          aria-orientation="horizontal"
          aria-valuemin={SIDEBAR_USAGE_MIN_HEIGHT}
          aria-valuemax={SIDEBAR_USAGE_MAX_HEIGHT}
          aria-valuenow={ariaHeight}
          aria-valuetext={`${ariaHeight}px tall`}
          title="Drag to resize Model Usage"
          onPointerDown={startSidebarResize}
          onPointerMove={moveSidebarResize}
          onPointerUp={endSidebarResize}
          onPointerCancel={endSidebarResize}
          onKeyDown={resizeSidebarWithKeyboard}
        />
      )}
      <div className="model-usage-summary-header">
        <div className="run-summary-title">Model Usage</div>
        {isSidebarVariant && (
          <button
            type="button"
            className="model-usage-toggle"
            onClick={() => setSidebarExpanded((current) => !current)}
            aria-expanded={sidebarExpanded}
            aria-controls={quotaContentId}
            aria-label={title}
            title={title}
          >
            <ModelUsageDisclosureIcon isExpanded={sidebarExpanded} />
          </button>
        )}
      </div>
      <div id={quotaContentId} className="model-usage-collapsible" aria-hidden={!showQuotaEntries}>
        <div className="model-usage-collapsible-inner">
          <div className="model-usage-list">
            {quotaEntries.map((entry) => (
              <ProviderUsageBlock key={`${entry.provider}-${entry.model}`} entry={entry} />
            ))}
            {/* 1.0.6-GU — Grok subscription credits (separate data model from
             * the token/cost meters above; manual-refresh PTY probe). Only
             * mounts when the gated Grok provider adapter is registered. Kept
             * inside the list so the `.model-usage-item + .model-usage-item`
             * divider lands between Kimi and Grok. */}
            {grokAvailable ? <GrokCreditsMeter /> : null}
          </div>
        </div>
      </div>
      {/* Phase L6 slice 5 — activity heatmap. Renders the last 30
       * days of usage as a 30×12 grid (12 × 2h buckets per day),
       * coloured by the dominant provider in each bucket. Pulls
       * records via the existing `getUsage` IPC; sits at the foot
       * of the card so the bars stay the primary read. */}
      <UsageHeatmap />
    </div>
  )
}
