import type { CSSProperties, ReactElement } from 'react'
import type { ProviderId } from '../../../../main/store/types'

type ProviderGlyphId = ProviderId | string | undefined

interface ProviderGlyphProps {
  provider?: ProviderGlyphId
  className?: string
}

function providerClass(provider?: ProviderGlyphId): string {
  const raw = typeof provider === 'string' ? provider.trim().toLowerCase() : ''
  const normalized = raw
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return normalized || 'gemini'
}

function glyphBody(provider: string): ReactElement {
  switch (provider) {
    case 'gemini':
      return (
        <>
          <path
            className="provider-glyph-accent"
            d="M12 3.6l1.7 4.6 4.7 1.7-4.7 1.7L12 16.4l-1.7-4.8-4.7-1.7 4.7-1.7Z"
          />
          <path
            className="provider-glyph-line"
            d="M4.4 18.2l1.1 2.6 2.6 1-2.6 1-1.1 2.6-1-2.6-2.7-1 2.7-1Z"
            transform="translate(1 -3)"
          />
          <path className="provider-glyph-line provider-glyph-fine" d="M17.8 4.7h2.8" />
          <path className="provider-glyph-line provider-glyph-fine" d="M19.2 3.3v2.8" />
        </>
      )
    case 'codex':
      return (
        <>
          <path className="provider-glyph-line" d="M4.6 6.2h14.8v11.6H4.6Z" />
          <path className="provider-glyph-accent" d="m8.1 9.3 2.7 2.7-2.7 2.7" />
          <path className="provider-glyph-line provider-glyph-fine" d="M12.2 14.7h4" />
          <path className="provider-glyph-line provider-glyph-fine" d="M6.7 4.4 4.6 6.2" />
          <path className="provider-glyph-line provider-glyph-fine" d="M17.3 19.6l2.1-1.8" />
        </>
      )
    case 'claude':
      return (
        <>
          <circle className="provider-glyph-soft" cx="12" cy="12" r="4.2" />
          <path className="provider-glyph-accent" d="M12 4.2v3" />
          <path className="provider-glyph-accent" d="M12 16.8v3" />
          <path className="provider-glyph-accent" d="M4.2 12h3" />
          <path className="provider-glyph-accent" d="M16.8 12h3" />
          <path className="provider-glyph-line" d="m6.4 6.4 2.2 2.2" />
          <path className="provider-glyph-line" d="m15.4 15.4 2.2 2.2" />
          <path className="provider-glyph-line" d="m17.3 6.7-2.1 2.1" />
          <path className="provider-glyph-line" d="m8.7 15.3-2 2" />
          <circle className="provider-glyph-dot" cx="12" cy="12" r="1.6" />
        </>
      )
    case 'kimi':
      return (
        <>
          <path
            className="provider-glyph-line"
            d="M15.6 4.7a7.9 7.9 0 1 0 0 14.6 6.1 6.1 0 1 1 0-14.6Z"
          />
          <path className="provider-glyph-accent" d="M8 7.4v9.2" />
          <path className="provider-glyph-accent" d="m16 7.4-5.1 4.5 5.1 4.7" />
          <path className="provider-glyph-line provider-glyph-fine" d="M6.6 12h6.2" />
          <circle className="provider-glyph-dot" cx="18.5" cy="5.8" r="1.2" />
        </>
      )
    case 'cursor':
      return (
        <>
          <path className="provider-glyph-line" d="M5.7 3.8 18.8 12l-6.1 1.3-2.7 5.8Z" />
          <path className="provider-glyph-accent" d="m12.7 13.3 4.2 4.1" />
          <path className="provider-glyph-line provider-glyph-fine" d="M19.1 5.8v5.1" />
          <path className="provider-glyph-line provider-glyph-fine" d="M16.6 5.8h5" />
          <circle className="provider-glyph-dot" cx="7.7" cy="6.2" r="1.1" />
        </>
      )
    case 'grok':
      return (
        <>
          <circle className="provider-glyph-line" cx="12" cy="12" r="6.4" />
          <path className="provider-glyph-line provider-glyph-fine" d="M12 3.8v3" />
          <path className="provider-glyph-line provider-glyph-fine" d="M12 17.2v3" />
          <path className="provider-glyph-line provider-glyph-fine" d="M3.8 12h3" />
          <path className="provider-glyph-line provider-glyph-fine" d="M17.2 12h3" />
          <path className="provider-glyph-accent" d="M8.7 15.3 15.3 8.7" />
          <circle className="provider-glyph-dot" cx="8.4" cy="15.6" r="1" />
          <circle className="provider-glyph-dot" cx="15.6" cy="8.4" r="1" />
        </>
      )
    default:
      return (
        <>
          <path className="provider-glyph-line" d="M4.6 6.2h14.8v11.6H4.6Z" />
          <path className="provider-glyph-accent" d="m8.1 9.3 2.7 2.7-2.7 2.7" />
          <path className="provider-glyph-line provider-glyph-fine" d="M12.2 14.7h4" />
        </>
      )
  }
}

export function ProviderGlyph({ provider, className }: ProviderGlyphProps): ReactElement {
  const providerKey = providerClass(provider)
  const style = {
    '--provider-accent': `var(--provider-${providerKey}-color, currentColor)`
  } as CSSProperties
  return (
    <svg
      viewBox="0 0 24 24"
      className={['provider-glyph', `provider-glyph-${providerKey}`, className]
        .filter(Boolean)
        .join(' ')}
      style={style}
      aria-hidden="true"
    >
      {glyphBody(providerKey)}
    </svg>
  )
}
