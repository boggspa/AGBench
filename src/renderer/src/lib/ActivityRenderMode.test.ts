import { describe, it, expect } from 'vitest'
import {
  hasSubstantivePreview,
  hasCardContent,
  shouldRenderAsCard,
  hasExpandableDetail
} from './ActivityRenderMode'

describe('ActivityRenderMode', () => {
  describe('hasSubstantivePreview', () => {
    it('returns false for an empty previews array', () => {
      expect(hasSubstantivePreview([])).toBe(false)
    })

    it('returns false for short single-line previews', () => {
      expect(hasSubstantivePreview([{ content: 'ok' }])).toBe(false)
      expect(hasSubstantivePreview([{ content: 'short summary' }])).toBe(false)
    })

    it('returns true when a preview contains a newline', () => {
      expect(hasSubstantivePreview([{ content: 'line one\nline two' }])).toBe(true)
    })

    it('returns true when a preview is at least 120 chars on a single line', () => {
      const long = 'x'.repeat(120)
      expect(hasSubstantivePreview([{ content: long }])).toBe(true)
    })

    it('returns false just below the threshold and single-line', () => {
      const justUnder = 'x'.repeat(119)
      expect(hasSubstantivePreview([{ content: justUnder }])).toBe(false)
    })

    it('ignores malformed preview entries', () => {
      // Defensive guard: hostile callers can feed garbage shapes from upstream
      // adapters; the helper must not throw.
      const previews = [
        { content: '' },
        { content: null as unknown as string },
        {} as { content: string }
      ]
      expect(hasSubstantivePreview(previews)).toBe(false)
    })
  })

  describe('hasCardContent', () => {
    it('forces card content when raw event must be surfaced', () => {
      expect(hasCardContent({ previews: [], diffFileCount: 0, shouldShowRawEvent: true })).toBe(
        true
      )
    })

    it('returns true when diff files are attached', () => {
      expect(hasCardContent({ previews: [], diffFileCount: 1, shouldShowRawEvent: false })).toBe(
        true
      )
    })

    it('returns true when a custom structured detail widget is attached', () => {
      expect(
        hasCardContent({
          previews: [],
          diffFileCount: 0,
          customDetailCount: 1,
          shouldShowRawEvent: false
        })
      ).toBe(true)
    })

    it('returns true when a preview is substantive', () => {
      expect(
        hasCardContent({
          previews: [{ content: 'multi\nline output' }],
          diffFileCount: 0,
          shouldShowRawEvent: false
        })
      ).toBe(true)
    })

    it('returns false when there is nothing substantive', () => {
      expect(
        hasCardContent({
          previews: [{ content: 'ok' }],
          diffFileCount: 0,
          shouldShowRawEvent: false
        })
      ).toBe(false)
    })
  })

  describe('shouldRenderAsCard', () => {
    const baseInputs = {
      detailRowCount: 0,
      previews: [],
      diffFileCount: 0,
      shouldShowRawEvent: false
    }

    it('stays inline when collapsed regardless of content', () => {
      expect(
        shouldRenderAsCard({
          ...baseInputs,
          expanded: false,
          previews: [{ content: 'line one\nline two' }],
          diffFileCount: 5
        })
      ).toBe(false)
    })

    it('stays inline when expanded but there is no body to show', () => {
      expect(shouldRenderAsCard({ ...baseInputs, expanded: true })).toBe(false)
    })

    it('promotes to card when expanded with a multi-line preview', () => {
      expect(
        shouldRenderAsCard({
          ...baseInputs,
          expanded: true,
          previews: [{ content: 'a\nb' }]
        })
      ).toBe(true)
    })

    it('promotes to card when expanded with diff files', () => {
      expect(shouldRenderAsCard({ ...baseInputs, expanded: true, diffFileCount: 2 })).toBe(true)
    })

    it('forces card when the raw event must be displayed (even collapsed)', () => {
      expect(shouldRenderAsCard({ ...baseInputs, expanded: false, shouldShowRawEvent: true })).toBe(
        true
      )
    })
  })

  describe('hasExpandableDetail', () => {
    const baseInputs = {
      detailRowCount: 0,
      previews: [],
      diffFileCount: 0,
      shouldShowRawEvent: false
    }

    it('is false when there is no detail at all', () => {
      expect(hasExpandableDetail({}, baseInputs)).toBe(false)
    })

    it('is false when only single-line detail rows are present (nothing extra to reveal)', () => {
      expect(hasExpandableDetail({}, { ...baseInputs, detailRowCount: 2 })).toBe(false)
    })

    it('is true when diff files are attached', () => {
      expect(hasExpandableDetail({}, { ...baseInputs, diffFileCount: 1 })).toBe(true)
    })

    it('is true when custom structured detail is attached', () => {
      expect(hasExpandableDetail({}, { ...baseInputs, customDetailCount: 1 })).toBe(true)
    })

    it('is true when a substantive preview is present', () => {
      expect(hasExpandableDetail({}, { ...baseInputs, previews: [{ content: 'a\nb' }] })).toBe(true)
    })

    it('respects shouldShowRawEvent only when there is a raw payload to render', () => {
      expect(hasExpandableDetail({}, { ...baseInputs, shouldShowRawEvent: true })).toBe(false)
      expect(
        hasExpandableDetail(
          { rawUseEvent: { foo: 'bar' } },
          { ...baseInputs, shouldShowRawEvent: true }
        )
      ).toBe(true)
    })
  })
})
