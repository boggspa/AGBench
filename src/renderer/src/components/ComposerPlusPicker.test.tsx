import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ComposerPlusPicker } from './ComposerPlusPicker'

describe('ComposerPlusPicker', () => {
  it('renders the trigger as the composer attach control', () => {
    const html = renderToStaticMarkup(
      <ComposerPlusPicker
        provider="codex"
        composerStyle="default"
        triggerIcon={<span>+</span>}
        sections={[
          {
            id: 'add',
            title: 'Add',
            items: [
              {
                id: 'attachment',
                label: 'Attachment',
                onSelect: () => undefined
              }
            ]
          }
        ]}
      />
    )

    expect(html).toContain('composer-plus-picker-trigger')
    expect(html).toContain('data-composer-control="attach"')
    expect(html).toContain('aria-label="Composer tools"')
  })
})
