import { describe, expect, it } from 'vitest'
import {
  VIEWPORT_STICK_PX,
  distanceFromBottom,
  edgeFadeState,
  nextAutoFollow,
  shouldShowViewportJump
} from './LiveActivityViewport'

describe('distanceFromBottom', () => {
  it('computes remaining scroll distance to the bottom edge', () => {
    expect(distanceFromBottom({ scrollHeight: 500, scrollTop: 300, clientHeight: 200 })).toBe(0)
    expect(distanceFromBottom({ scrollHeight: 500, scrollTop: 250, clientHeight: 200 })).toBe(50)
  })
})

describe('nextAutoFollow', () => {
  it('follows when within the stick threshold and releases past it', () => {
    expect(nextAutoFollow(0, true)).toBe(true)
    expect(nextAutoFollow(VIEWPORT_STICK_PX, false)).toBe(true)
    expect(nextAutoFollow(VIEWPORT_STICK_PX + 1, true)).toBe(false)
  })

  it('re-engages when the user scrolls back near the bottom', () => {
    expect(nextAutoFollow(10, false)).toBe(true)
  })

  it('preserves current state for non-finite metrics', () => {
    expect(nextAutoFollow(Number.NaN, true)).toBe(true)
    expect(nextAutoFollow(Number.POSITIVE_INFINITY, false)).toBe(false)
  })
})

describe('shouldShowViewportJump', () => {
  it('only shows when collapsed and not following', () => {
    expect(shouldShowViewportJump({ expanded: false, following: false })).toBe(true)
    expect(shouldShowViewportJump({ expanded: false, following: true })).toBe(false)
    expect(shouldShowViewportJump({ expanded: true, following: false })).toBe(false)
  })
})

describe('edgeFadeState', () => {
  it('hides both fades when content fits without overflow', () => {
    expect(edgeFadeState({ scrollHeight: 120, clientHeight: 120, scrollTop: 0 })).toEqual({
      top: false,
      bottom: false
    })
  })

  it('shows bottom fade when scrolled away from the live edge', () => {
    expect(edgeFadeState({ scrollHeight: 300, clientHeight: 120, scrollTop: 0 })).toEqual({
      top: false,
      bottom: true
    })
  })

  it('shows top fade when scrolled up through overflow', () => {
    expect(edgeFadeState({ scrollHeight: 300, clientHeight: 120, scrollTop: 80 })).toEqual({
      top: true,
      bottom: true
    })
  })

  it('hides bottom fade when pinned to the live edge', () => {
    expect(edgeFadeState({ scrollHeight: 300, clientHeight: 120, scrollTop: 180 })).toEqual({
      top: true,
      bottom: false
    })
  })

  it('returns no fades for non-finite metrics', () => {
    expect(edgeFadeState({ scrollHeight: Number.NaN, clientHeight: 120, scrollTop: 0 })).toEqual({
      top: false,
      bottom: false
    })
  })
})
