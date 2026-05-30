/*
 * ProviderLogoTile — Phase L6 slice 4 (+ follow-up).
 *
 * Renders a provider's app logo inside a tinted rounded-rect
 * container, matching another-project's `ProviderBrandIconView`
 * pattern (`Shared/Views/QuotaCardView.swift:8-85`). The tile
 * background takes the provider colour at low opacity so the
 * logo PNG (typically dark glyph on transparent) reads cleanly
 * across both light and dark themes.
 *
 * Asset coverage:
 *   - Codex   → extracted from `/Applications/Codex.app`'s icns
 *               (the real Codex app icon, NOT another-project's
 *               `ProviderCodexLogo.imageset` — that asset is the
 *               OpenAI spiral, byte-identical with the ChatGPT
 *               imageset, and was reading as "ChatGPT logo" in
 *               our card).
 *   - Claude  → from another-project's `Assets.xcassets`.
 *   - Gemini  → from another-project's `Assets.xcassets`.
 *   - Kimi    → extracted from `/Applications/Kimi.app`'s icns.
 *               another-project falls back to an SF symbol here;
 *               we have a real PNG so we wire it directly.
 *   - Grok    → transparent app logo supplied with the 1.0.6
 *               provider-onboarding pass.
 *   - Cursor  → extracted from `/Applications/Cursor.app`'s icns.
 *
 * The component is purely visual — no state, no IPC. The
 * provider→logo mapping is a static map kept here so future
 * additions (ChatGPT/Windsurf if AGBench ever drives them) are
 * a one-line edit.
 */
import type { ReactElement } from 'react'
import type { ProviderId } from '../../../main/store/types'
import { ProviderBadgeIcon } from './Sidebar'

import claudeLogo from '../assets/provider-logos/claude.png'
import codexLogo from '../assets/provider-logos/codex.png'
import cursorLogo from '../assets/provider-logos/cursor.png'
import geminiLogo from '../assets/provider-logos/gemini.png'
import grokLogo from '../assets/provider-logos/grok.png'
import kimiLogo from '../assets/provider-logos/kimi.png'

const PROVIDER_LOGO_SOURCES: Partial<Record<ProviderId, string>> = {
  claude: claudeLogo,
  codex: codexLogo,
  cursor: cursorLogo,
  gemini: geminiLogo,
  grok: grokLogo,
  kimi: kimiLogo
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
        // Any future provider without a bundled raster logo falls
        // back to AGBench's existing inline SVG. The outer tile still
        // provides the tinted rounded-rect container so the visual
        // rhythm matches the other rows.
        <ProviderBadgeIcon provider={provider} />
      )}
    </span>
  )
}
