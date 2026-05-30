import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProviderBadgeIcon } from './Sidebar'

describe('ProviderBadgeIcon', () => {
  it('renders a distinct Cursor glyph instead of falling through to Kimi', () => {
    const cursor = renderToStaticMarkup(<ProviderBadgeIcon provider="cursor" />)
    const kimi = renderToStaticMarkup(<ProviderBadgeIcon provider="kimi" />)

    expect(cursor).toContain('provider-cursor')
    expect(kimi).toContain('provider-kimi')
    expect(cursor).toContain('M4.1 4.1 11.9 8 4.1 11.9 5.5 8 4.1 4.1Z')
    expect(cursor).not.toContain('M4.2 11.3 7.7 5 11.2 11.3')
    expect(cursor).not.toEqual(kimi)
  })
})
