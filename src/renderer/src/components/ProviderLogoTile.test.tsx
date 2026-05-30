import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProviderLogoTile } from './ProviderLogoTile'

describe('ProviderLogoTile', () => {
  it('renders raster logos for all six first-class providers', () => {
    for (const provider of ['gemini', 'codex', 'claude', 'kimi', 'grok', 'cursor'] as const) {
      const html = renderToStaticMarkup(<ProviderLogoTile provider={provider} />)
      expect(html).toContain(`provider-logo-tile provider-${provider}`)
      expect(html).toContain('provider-logo-tile-image')
      expect(html).not.toContain('sidebar-provider-icon')
    }
  })

  it('falls back to the provider badge icon for unknown future providers', () => {
    const html = renderToStaticMarkup(<ProviderLogoTile provider={'future' as never} />)
    expect(html).toContain('provider-logo-tile provider-future')
    expect(html).toContain('sidebar-provider-icon')
  })
})
