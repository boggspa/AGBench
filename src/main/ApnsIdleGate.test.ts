import { describe, expect, it } from 'vitest'
import { DEFAULT_APNS_IDLE_THRESHOLD_S, isUserAtDesktop } from './ApnsIdleGate'

describe('isUserAtDesktop', () => {
  it('returns true when idle gate is disabled, regardless of other inputs', () => {
    // Gate=off acts as a full bypass for staging / fire-every-push debugging.
    expect(
      isUserAtDesktop({
        idleGateEnv: 'off',
        windowFocused: false,
        idleSec: 3600
      })
    ).toBe(true)
  })

  it('returns false when window is not focused', () => {
    expect(
      isUserAtDesktop({
        windowFocused: false,
        idleSec: 0
      })
    ).toBe(false)
  })

  it('returns false when window is focused but idle exceeds threshold', () => {
    // Common case: user left a foregrounded window and walked away.
    expect(
      isUserAtDesktop({
        windowFocused: true,
        idleSec: DEFAULT_APNS_IDLE_THRESHOLD_S + 1
      })
    ).toBe(false)
  })

  it('returns true when window is focused and idle is below threshold', () => {
    expect(
      isUserAtDesktop({
        windowFocused: true,
        idleSec: 5
      })
    ).toBe(true)
  })

  it('honors a custom threshold via env var', () => {
    // 10s threshold; 15s idle is "away" under that policy.
    expect(
      isUserAtDesktop({
        idleThresholdEnv: '10',
        windowFocused: true,
        idleSec: 15
      })
    ).toBe(false)
    expect(
      isUserAtDesktop({
        idleThresholdEnv: '10',
        windowFocused: true,
        idleSec: 5
      })
    ).toBe(true)
  })

  it('ignores a malformed threshold env var and falls back to the default', () => {
    // NaN / 0 / negative should not silently disable the gate.
    expect(
      isUserAtDesktop({
        idleThresholdEnv: 'nope',
        windowFocused: true,
        idleSec: DEFAULT_APNS_IDLE_THRESHOLD_S + 1
      })
    ).toBe(false)
    expect(
      isUserAtDesktop({
        idleThresholdEnv: '0',
        windowFocused: true,
        idleSec: DEFAULT_APNS_IDLE_THRESHOLD_S + 1
      })
    ).toBe(false)
    expect(
      isUserAtDesktop({
        idleThresholdEnv: '-5',
        windowFocused: true,
        idleSec: DEFAULT_APNS_IDLE_THRESHOLD_S + 1
      })
    ).toBe(false)
  })

  it('treats idle exactly at the threshold as "away"', () => {
    // Boundary condition: strict < means equal counts as idle.
    expect(
      isUserAtDesktop({
        windowFocused: true,
        idleSec: DEFAULT_APNS_IDLE_THRESHOLD_S
      })
    ).toBe(false)
  })

  it('uses the default threshold when no env override is given', () => {
    expect(DEFAULT_APNS_IDLE_THRESHOLD_S).toBe(60)
    expect(
      isUserAtDesktop({
        windowFocused: true,
        idleSec: 59
      })
    ).toBe(true)
    expect(
      isUserAtDesktop({
        windowFocused: true,
        idleSec: 60
      })
    ).toBe(false)
  })

  it('disabled-gate overrides an unfocused window', () => {
    // If gate is off, focus state is ignored entirely.
    expect(
      isUserAtDesktop({
        idleGateEnv: 'off',
        windowFocused: false,
        idleSec: 0
      })
    ).toBe(true)
  })
})
