import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProviderBadgeIcon } from './Sidebar'

describe('ProviderBadgeIcon', () => {
  it('renders a distinct Cursor glyph instead of falling through to Kimi', () => {
    const cursor = renderToStaticMarkup(<ProviderBadgeIcon provider="cursor" />)
    const kimi = renderToStaticMarkup(<ProviderBadgeIcon provider="kimi" />)

    expect(cursor).toContain('provider-cursor')
    expect(kimi).toContain('provider-kimi')
    expect(cursor).toContain('provider-glyph-cursor')
    expect(kimi).toContain('provider-glyph-kimi')
    expect(cursor).toContain('M5.7 3.8 18.8 12l-6.1 1.3-2.7 5.8Z')
    expect(cursor).not.toContain('M15.6 4.7a7.9 7.9')
    expect(cursor).not.toEqual(kimi)
  })
})
