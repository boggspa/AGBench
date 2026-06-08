import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProviderLogoTile } from './ProviderLogoTile'

describe('ProviderLogoTile', () => {
  it('renders original SVG glyphs for all seven first-class providers', () => {
    for (const provider of [
      'gemini',
      'codex',
      'claude',
      'kimi',
      'grok',
      'cursor',
      'ollama'
    ] as const) {
      const html = renderToStaticMarkup(<ProviderLogoTile provider={provider} />)
      expect(html).toContain(`provider-logo-tile provider-${provider}`)
      expect(html).toContain(`provider-glyph-${provider}`)
      expect(html).not.toContain('<img')
      expect(html).not.toContain('sidebar-provider-icon')
    }
  })

  it('falls back to the generic prompt glyph for unknown future providers', () => {
    const html = renderToStaticMarkup(<ProviderLogoTile provider={'future' as never} />)
    expect(html).toContain('provider-logo-tile provider-future')
    expect(html).toContain('provider-glyph-future')
  })
})
