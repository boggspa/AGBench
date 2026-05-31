/*
 * ProviderLogoTile — Phase L6 slice 4 (+ follow-up).
 *
 * Renders an original AGBench provider mnemonic glyph inside a tinted
 * rounded-rect container. Provider labels still name the real products;
 * the glyphs are deliberately simplified visual hints, not official logos.
 */
import type { ReactElement } from 'react'
import type { ProviderId } from '../../../main/store/types'
import { ProviderGlyph } from './icons/ProviderGlyph'

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
      <ProviderGlyph provider={providerKey} />
    </span>
  )
}
