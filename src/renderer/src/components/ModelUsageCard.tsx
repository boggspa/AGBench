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
import { useId, useState } from 'react'
import type { ProviderId } from '../../../main/store/types'
import type { ModelUsageAggregate, UsageWindowAggregate } from '../App'
import { computeQuotaPace } from '../lib/QuotaPace'
import { formatResetShort } from '../lib/UsageFormat'
import { getProviderName } from './Sidebar'
import { ProviderLogoTile } from './ProviderLogoTile'
import { QuotaProgressBar } from './QuotaProgressBar'
import { UsageHeatmap } from './UsageHeatmap'
import './ModelUsageCard.css'

interface ModelUsageCardProps {
  usageSummary: ModelUsageAggregate[]
  variant?: 'card' | 'sidebar'
}

const PROVIDER_ORDER: ProviderId[] = ['gemini', 'codex', 'claude', 'kimi']

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
  const [sidebarExpanded, setSidebarExpanded] = useState(true)
  if (usageSummary.length === 0) return null
  const quotaEntries = sortByProvider(usageSummary).filter(
    (entry) => entry.model === 'usage limits' && (entry.windows?.length || 0) > 0
  )
  if (quotaEntries.length === 0) return null

  const isSidebarVariant = variant === 'sidebar'
  const showQuotaEntries = !isSidebarVariant || sidebarExpanded
  const title = sidebarExpanded ? 'Collapse provider usage' : 'Expand provider usage'
  const rootClassName = [
    'run-summary',
    'model-usage-summary',
    isSidebarVariant ? 'model-usage-summary--sidebar' : '',
    isSidebarVariant && !sidebarExpanded ? 'is-collapsed' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={rootClassName}>
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
