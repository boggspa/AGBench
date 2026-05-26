import type { RefObject } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EnsembleParticipant } from '../../../main/store/types'
import {
  ComposerHighlightOverlay,
  composerHighlightScrollTransform
} from './ComposerHighlightOverlay'

const textareaRef = { current: null } as RefObject<HTMLTextAreaElement | null>

function participant(overrides: Partial<EnsembleParticipant> = {}): EnsembleParticipant {
  return {
    id: 'ensemble-reviewer',
    provider: 'claude',
    enabled: true,
    role: 'Reviewer',
    instructions: '',
    order: 1,
    model: 'claude-opus-4-7',
    permissionPresetId: 'read_only',
    ...overrides
  }
}

describe('ComposerHighlightOverlay', () => {
  it('mirrors textarea scroll offsets with negative inner-content translation', () => {
    expect(composerHighlightScrollTransform(12, 96)).toBe('translate3d(-12px, -96px, 0)')
    expect(composerHighlightScrollTransform(0, 0)).toBe('translate3d(0px, 0px, 0)')
  })

  it('renders a clipping shell and translated content layer for mention text', () => {
    const html = renderToStaticMarkup(
      <ComposerHighlightOverlay
        value="Please ask @Reviewer for a second pass."
        participants={[participant()]}
        textareaRef={textareaRef}
        syncEpoch="test"
      />
    )

    expect(html).toContain('composer-textarea-highlight')
    expect(html).toContain('composer-textarea-highlight-content')
    expect(html).toContain('composer-mention-token')
    expect(html).toContain('@Reviewer')
  })
})
