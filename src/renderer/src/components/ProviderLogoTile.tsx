/*
 * ProviderLogoTile — Phase L6 slice 4.
 *
 * Renders a provider's app logo inside a tinted rounded-rect
 * container, matching another-project's `ProviderBrandIconView`
 * pattern (`Shared/Views/QuotaCardView.swift:8-85`). The tile
 * background takes the provider colour at low opacity so the
 * logo PNG (typically dark glyph on transparent) reads cleanly
 * across both light and dark themes.
 *
 * Asset coverage today (slice 4):
 *   - Codex / Claude / Gemini  → PNG logos copied from
 *     another-project's `Assets.xcassets`.
 *   - Kimi  → no bundled logo; falls back to AGBench's existing
 *     inline-SVG `ProviderBadgeIcon`. another-project has the same
 *     fallback (SF symbol) so this is a deliberate parity choice
 *     rather than a missing asset.
 *
 * The component is purely visual — no state, no IPC. The
 * provider→logo mapping is a static map kept here so future
 * additions (Kimi logo if one becomes available, ChatGPT/Windsurf
 * if AGBench ever drives them) are a one-line edit.
 */
import type { ReactElement } from 'react'
import type { ProviderId } from '../../../main/store/types'
import { ProviderBadgeIcon } from './Sidebar'

import claudeLogo from '../assets/provider-logos/claude.png'
import codexLogo from '../assets/provider-logos/codex.png'
import geminiLogo from '../assets/provider-logos/gemini.png'

const PROVIDER_LOGO_SOURCES: Partial<Record<ProviderId, string>> = {
  claude: claudeLogo,
  codex: codexLogo,
  gemini: geminiLogo
}

interface ProviderLogoTileProps {
  provider: ProviderId | undefined
  /** Tile edge in px. Defaults to 22 — sized to sit comfortably
   * next to a ~13px text label in the Model Usage Card header. */
  size?: number
  /** Optional className for layout overrides. */
  className?: string
}

export function ProviderLogoTile({
  provider,
  size = 22,
  className
}: ProviderLogoTileProps): ReactElement {
  const providerKey = provider || 'gemini'
  const src = PROVIDER_LOGO_SOURCES[providerKey]
  const tileStyle = {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: `${Math.max(4, size * 0.26)}px`
  }
  return (
    <span
      className={['provider-logo-tile', `provider-${providerKey}`, className]
        .filter(Boolean)
        .join(' ')}
      style={tileStyle}
      aria-hidden
    >
      {src ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          className="provider-logo-tile-image"
          draggable={false}
        />
      ) : (
        // Kimi (and any future provider without a bundled raster
        // logo) falls back to AGBench's existing inline SVG. The
        // outer tile still provides the tinted rounded-rect
        // container so the visual rhythm matches the other rows.
        <ProviderBadgeIcon provider={provider} />
      )}
    </span>
  )
}
