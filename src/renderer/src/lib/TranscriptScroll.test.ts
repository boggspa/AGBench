import { describe, it, expect } from 'vitest'
import {
  STICK_ENGAGE_PX,
  STICK_DISENGAGE_PX,
  shouldEngageAutoFollow,
  shouldDisengageAutoFollow,
  shouldRepinAfterFrame,
  shouldRepinAfterCodeBlockResize,
  buildCodeBlockResizeEventInit,
  CODE_BLOCK_RESIZE_EVENT
} from './TranscriptScroll'

describe('TranscriptScroll', () => {
  describe('shouldEngageAutoFollow', () => {
    it('engages when essentially at the bottom', () => {
      expect(shouldEngageAutoFollow(0)).toBe(true)
    })

    it('engages within the threshold band', () => {
      expect(shouldEngageAutoFollow(STICK_ENGAGE_PX - 1)).toBe(true)
      expect(shouldEngageAutoFollow(STICK_ENGAGE_PX)).toBe(true)
    })

    it('does not engage above the threshold', () => {
      expect(shouldEngageAutoFollow(STICK_ENGAGE_PX + 1)).toBe(false)
    })

    it('is wide enough to tolerate one-frame token jitter', () => {
      // Empirical token-stream height ticks observed during Kimi runs:
      // 20-40px per frame. Engage threshold must remain >= 40 to avoid
      // dropping out of sticky mode during normal streaming.
      expect(shouldEngageAutoFollow(40)).toBe(true)
    })

    it('rejects non-finite inputs defensively', () => {
      expect(shouldEngageAutoFollow(Number.NaN)).toBe(false)
      expect(shouldEngageAutoFollow(Number.POSITIVE_INFINITY)).toBe(false)
    })
  })

  describe('shouldDisengageAutoFollow', () => {
    it('does not disengage near the bottom', () => {
      expect(shouldDisengageAutoFollow(0)).toBe(false)
      expect(shouldDisengageAutoFollow(STICK_DISENGAGE_PX)).toBe(false)
    })

    it('disengages beyond the threshold', () => {
      expect(shouldDisengageAutoFollow(STICK_DISENGAGE_PX + 1)).toBe(true)
    })

    it('has the engage threshold strictly below the disengage threshold (hysteresis)', () => {
      // The hysteresis gap prevents a single scroll event from
      // toggling auto-follow on and off repeatedly when the user
      // hovers right on the boundary.
      expect(STICK_ENGAGE_PX).toBeLessThan(STICK_DISENGAGE_PX)
    })

    it('rejects non-finite inputs defensively', () => {
      expect(shouldDisengageAutoFollow(Number.NaN)).toBe(false)
      expect(shouldDisengageAutoFollow(Number.POSITIVE_INFINITY)).toBe(false)
    })
  })

  describe('shouldRepinAfterFrame', () => {
    it('re-pins when auto-follow is engaged and the user has not scrolled away', () => {
      expect(
        shouldRepinAfterFrame({
          autoFollow: true,
          userScrolledAwayInThisFrame: false
        })
      ).toBe(true)
    })

    it('skips the re-pin when auto-follow is already disengaged', () => {
      expect(
        shouldRepinAfterFrame({
          autoFollow: false,
          userScrolledAwayInThisFrame: false
        })
      ).toBe(false)
    })

    it('skips the re-pin when the user actively scrolled away in this frame', () => {
      // Critical: this guard prevents the rAF callback from fighting
      // a deliberate user scroll-up.
      expect(
        shouldRepinAfterFrame({
          autoFollow: true,
          userScrolledAwayInThisFrame: true
        })
      ).toBe(false)
    })
  })

  describe('shouldRepinAfterCodeBlockResize', () => {
    it('re-pins when auto-follow is engaged and the user has not scrolled away', () => {
      // The code-block resize path uses the same guards as the
      // frame-update path; this test pins the symmetry so the two
      // helpers cannot diverge by accident.
      expect(
        shouldRepinAfterCodeBlockResize({
          autoFollow: true,
          userScrolledAwayInThisFrame: false
        })
      ).toBe(true)
    })

    it('respects auto-follow disengagement', () => {
      expect(
        shouldRepinAfterCodeBlockResize({
          autoFollow: false,
          userScrolledAwayInThisFrame: false
        })
      ).toBe(false)
    })

    it('respects a user-initiated scroll-away in this frame', () => {
      expect(
        shouldRepinAfterCodeBlockResize({
          autoFollow: true,
          userScrolledAwayInThisFrame: true
        })
      ).toBe(false)
    })
  })

  describe('buildCodeBlockResizeEventInit', () => {
    it('exposes a stable event name constant', () => {
      // The renderer code path and the App.tsx listener look up this
      // name independently; locking the literal here means a typo on
      // either side trips a test rather than silently breaking
      // re-pin.
      expect(CODE_BLOCK_RESIZE_EVENT).toBe('agbench:code-block-resized')
    })

    it('produces a bubbling, composed CustomEventInit with the entry size', () => {
      const init = buildCodeBlockResizeEventInit({
        contentRect: { width: 120, height: 480 }
      })

      // bubbles = true is mandatory: the event has to reach the
      // transcript scroll container which is several DOM levels above
      // the code block element.
      expect(init.bubbles).toBe(true)
      expect(init.composed).toBe(true)
      expect(init.detail).toEqual({ width: 120, height: 480 })
    })

    it('defaults non-finite or missing dimensions to zero', () => {
      // jsdom and some embedded WebKit builds don't populate
      // contentRect on ResizeObserverEntry — the dispatcher should
      // still emit a usable event so listeners can react.
      expect(buildCodeBlockResizeEventInit(undefined).detail).toEqual({ width: 0, height: 0 })
      expect(buildCodeBlockResizeEventInit({}).detail).toEqual({ width: 0, height: 0 })
      expect(
        buildCodeBlockResizeEventInit({ contentRect: { width: Number.NaN, height: 12 } }).detail
      ).toEqual({ width: 0, height: 12 })
      expect(
        buildCodeBlockResizeEventInit({
          contentRect: { width: Number.POSITIVE_INFINITY, height: Number.NaN }
        }).detail
      ).toEqual({ width: 0, height: 0 })
    })
  })
})
