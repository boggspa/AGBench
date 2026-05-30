import { beforeEach, describe, expect, it } from 'vitest'

import { ApprovalBudgetTracker, decideApproval } from './ApprovalBudgetTracker'

describe('ApprovalBudgetTracker', () => {
  let tracker: ApprovalBudgetTracker

  beforeEach(() => {
    tracker = new ApprovalBudgetTracker()
  })

  describe('tryConsume', () => {
    it("returns 'allowed' when no budget is set", () => {
      expect(tracker.tryConsume('env-1', undefined)).toBe('allowed')
      // 100 consecutive calls all allowed (no cap)
      for (let i = 0; i < 100; i++) {
        expect(tracker.tryConsume('env-1', undefined)).toBe('allowed')
      }
    })

    it("returns 'allowed' for an empty envelopeId (top-level approvals)", () => {
      expect(tracker.tryConsume('', 5)).toBe('allowed')
    })

    it('allows up to the budget then exhausts', () => {
      expect(tracker.tryConsume('env-1', 3)).toBe('allowed')
      expect(tracker.tryConsume('env-1', 3)).toBe('allowed')
      expect(tracker.tryConsume('env-1', 3)).toBe('allowed')
      expect(tracker.tryConsume('env-1', 3)).toBe('exhausted')
      // Further attempts stay exhausted.
      expect(tracker.tryConsume('env-1', 3)).toBe('exhausted')
    })

    it('treats budget=0 as always exhausted (zero approvals permitted)', () => {
      expect(tracker.tryConsume('env-1', 0)).toBe('exhausted')
      expect(tracker.getConsumed('env-1')).toBe(0) // never incremented
    })

    it('treats negative budgets as 0 (fail-closed)', () => {
      expect(tracker.tryConsume('env-1', -5)).toBe('exhausted')
    })

    it('treats NaN / Infinity as 0 (fail-closed)', () => {
      expect(tracker.tryConsume('env-1', Number.NaN)).toBe('exhausted')
      expect(tracker.tryConsume('env-1', Number.POSITIVE_INFINITY)).toBe('exhausted')
    })

    it('floors fractional budgets', () => {
      // 2.7 → 2 allowed
      expect(tracker.tryConsume('env-1', 2.7)).toBe('allowed')
      expect(tracker.tryConsume('env-1', 2.7)).toBe('allowed')
      expect(tracker.tryConsume('env-1', 2.7)).toBe('exhausted')
    })

    it('tracks separate envelopes independently', () => {
      expect(tracker.tryConsume('env-a', 1)).toBe('allowed')
      expect(tracker.tryConsume('env-a', 1)).toBe('exhausted')
      expect(tracker.tryConsume('env-b', 1)).toBe('allowed') // separate counter
    })
  })

  describe('getConsumed', () => {
    it('returns 0 for an envelope that has never registered', () => {
      expect(tracker.getConsumed('env-never')).toBe(0)
    })

    it('returns the count after consumption', () => {
      tracker.tryConsume('env-1', 5)
      tracker.tryConsume('env-1', 5)
      expect(tracker.getConsumed('env-1')).toBe(2)
    })

    it('does not increment on exhausted attempts', () => {
      tracker.tryConsume('env-1', 1)
      tracker.tryConsume('env-1', 1) // exhausted, no increment
      tracker.tryConsume('env-1', 1) // exhausted, no increment
      expect(tracker.getConsumed('env-1')).toBe(1)
    })
  })

  describe('getRemaining', () => {
    it('returns Infinity when no budget is set', () => {
      expect(tracker.getRemaining('env-1', undefined)).toBe(Number.POSITIVE_INFINITY)
    })

    it('returns the cap when nothing consumed', () => {
      expect(tracker.getRemaining('env-1', 5)).toBe(5)
    })

    it('decreases as consumption proceeds', () => {
      tracker.tryConsume('env-1', 5)
      tracker.tryConsume('env-1', 5)
      expect(tracker.getRemaining('env-1', 5)).toBe(3)
    })

    it('clamps at 0 — never negative', () => {
      tracker.tryConsume('env-1', 1)
      tracker.tryConsume('env-1', 1) // exhausted; consumed stays at 1
      expect(tracker.getRemaining('env-1', 1)).toBe(0)
      // Even when caller asks with a smaller budget than what was historically consumed.
      tracker.tryConsume('env-1', 1) // still exhausted
      expect(tracker.getRemaining('env-1', 0)).toBe(0)
    })
  })

  describe('releaseOne', () => {
    it('decrements the counter', () => {
      tracker.tryConsume('env-1', 5)
      tracker.tryConsume('env-1', 5)
      expect(tracker.releaseOne('env-1')).toBe(1)
      expect(tracker.getConsumed('env-1')).toBe(1)
    })

    it('clamps at 0', () => {
      tracker.releaseOne('env-never')
      expect(tracker.getConsumed('env-never')).toBe(0)
    })

    it('removes the envelope entirely when the count reaches 0', () => {
      tracker.tryConsume('env-1', 5)
      tracker.releaseOne('env-1')
      expect(tracker.snapshot()).toEqual([])
    })

    it('does nothing for an empty envelopeId', () => {
      expect(tracker.releaseOne('')).toBe(0)
    })
  })

  describe('reset', () => {
    it('returns prior count and clears', () => {
      tracker.tryConsume('env-1', 5)
      tracker.tryConsume('env-1', 5)
      expect(tracker.reset('env-1')).toBe(2)
      expect(tracker.getConsumed('env-1')).toBe(0)
    })

    it('returns 0 for an envelope that was never registered', () => {
      expect(tracker.reset('env-never')).toBe(0)
    })

    it('does nothing for an empty envelopeId', () => {
      expect(tracker.reset('')).toBe(0)
    })

    it('allows the next consume after reset to succeed under the same cap', () => {
      tracker.tryConsume('env-1', 1)
      tracker.tryConsume('env-1', 1) // exhausted
      tracker.reset('env-1')
      expect(tracker.tryConsume('env-1', 1)).toBe('allowed')
    })
  })

  describe('snapshot', () => {
    it('returns empty array when no envelopes consumed', () => {
      expect(tracker.snapshot()).toEqual([])
    })

    it('returns each consumed envelope with its count', () => {
      tracker.tryConsume('env-a', 5)
      tracker.tryConsume('env-a', 5)
      tracker.tryConsume('env-b', 3)
      const snap = tracker.snapshot()
      expect(snap).toHaveLength(2)
      const byId = Object.fromEntries(snap.map((s) => [s.envelopeId, s.consumed]))
      expect(byId['env-a']).toBe(2)
      expect(byId['env-b']).toBe(1)
    })

    it('omits envelopes that were fully released', () => {
      tracker.tryConsume('env-1', 5)
      tracker.releaseOne('env-1')
      expect(tracker.snapshot()).toEqual([])
    })
  })
})

describe('decideApproval (pure pre-flight)', () => {
  it("returns 'allowed' when no budget", () => {
    expect(decideApproval({ budget: undefined, consumed: 999 })).toBe('allowed')
  })

  it("returns 'allowed' when consumed < budget", () => {
    expect(decideApproval({ budget: 5, consumed: 4 })).toBe('allowed')
    expect(decideApproval({ budget: 5, consumed: 0 })).toBe('allowed')
  })

  it("returns 'exhausted' when consumed >= budget", () => {
    expect(decideApproval({ budget: 5, consumed: 5 })).toBe('exhausted')
    expect(decideApproval({ budget: 5, consumed: 100 })).toBe('exhausted')
  })

  it('treats negative / NaN / Infinity budgets as 0', () => {
    expect(decideApproval({ budget: -1, consumed: 0 })).toBe('exhausted')
    expect(decideApproval({ budget: Number.NaN, consumed: 0 })).toBe('exhausted')
    expect(decideApproval({ budget: Number.POSITIVE_INFINITY, consumed: 0 })).toBe('exhausted')
  })

  it('does not mutate any state (pure function)', () => {
    const before = decideApproval({ budget: 5, consumed: 2 })
    const after = decideApproval({ budget: 5, consumed: 2 })
    expect(before).toBe(after)
  })
})
