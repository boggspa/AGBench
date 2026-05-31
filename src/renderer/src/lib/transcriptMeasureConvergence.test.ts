import { describe, expect, it } from 'vitest'
import {
  decideMeasurePass,
  MAX_MEASURE_REWRITE_PASSES,
  type MeasurePassInput
} from './transcriptMeasureConvergence'

function input(over: Partial<MeasurePassInput> = {}): MeasurePassInput {
  return {
    sawNewKey: false,
    sawRewrite: false,
    rewritePasses: 0,
    alreadyWarned: false,
    ...over
  }
}

describe('decideMeasurePass', () => {
  it('a fully-converged pass does not bump and resets the budget', () => {
    const d = decideMeasurePass(input({ rewritePasses: 5 }))
    expect(d.bump).toBe(false)
    expect(d.nextRewritePasses).toBe(0)
    expect(d.shouldWarn).toBe(false)
  })

  it('a new key always bumps and resets the budget (legit growth)', () => {
    const d = decideMeasurePass(input({ sawNewKey: true, rewritePasses: 99 }))
    expect(d.bump).toBe(true)
    expect(d.nextRewritePasses).toBe(0)
  })

  it('a new key wins even when a rewrite also happened in the same pass', () => {
    const d = decideMeasurePass(input({ sawNewKey: true, sawRewrite: true, rewritePasses: 7 }))
    expect(d.bump).toBe(true)
    expect(d.nextRewritePasses).toBe(0)
  })

  it('a rewrite under budget bumps and increments the counter', () => {
    const d = decideMeasurePass(input({ sawRewrite: true, rewritePasses: 3 }))
    expect(d.bump).toBe(true)
    expect(d.nextRewritePasses).toBe(4)
    expect(d.shouldWarn).toBe(false)
  })

  it('a rewrite AT the cap stops bumping and warns once', () => {
    const d = decideMeasurePass(
      input({ sawRewrite: true, rewritePasses: MAX_MEASURE_REWRITE_PASSES })
    )
    expect(d.bump).toBe(false)
    expect(d.shouldWarn).toBe(true)
    expect(d.nextAlreadyWarned).toBe(true)
    // Counter does not climb past the cap.
    expect(d.nextRewritePasses).toBe(MAX_MEASURE_REWRITE_PASSES)
  })

  it('does not warn twice in the same episode', () => {
    const d = decideMeasurePass(
      input({ sawRewrite: true, rewritePasses: MAX_MEASURE_REWRITE_PASSES, alreadyWarned: true })
    )
    expect(d.bump).toBe(false)
    expect(d.shouldWarn).toBe(false)
    expect(d.nextAlreadyWarned).toBe(true)
  })

  it('converging after the cap clears the warning latch (next episode can warn again)', () => {
    const capped = decideMeasurePass(
      input({ sawRewrite: true, rewritePasses: MAX_MEASURE_REWRITE_PASSES, alreadyWarned: true })
    )
    expect(capped.nextAlreadyWarned).toBe(true)
    const converged = decideMeasurePass(input({ alreadyWarned: capped.nextAlreadyWarned }))
    expect(converged.nextAlreadyWarned).toBe(false)
  })

  it('simulated oscillation terminates at the cap instead of bumping forever', () => {
    // Drive a flip-flopping key through the decision repeatedly; count bumps.
    let passes = 0
    let warned = false
    let bumps = 0
    for (let i = 0; i < 1000; i++) {
      const d = decideMeasurePass({
        sawNewKey: false,
        sawRewrite: true, // key never settles
        rewritePasses: passes,
        alreadyWarned: warned
      })
      passes = d.nextRewritePasses
      warned = d.nextAlreadyWarned
      if (d.bump) bumps++
    }
    // Bounded by the cap, NOT 1000 — the synchronous loop can't run away.
    expect(bumps).toBe(MAX_MEASURE_REWRITE_PASSES)
    expect(warned).toBe(true)
  })

  it('a legit settle (a few rewrites then convergence) stays well under the cap', () => {
    let passes = 0
    let bumps = 0
    // 2 settling passes, then converged.
    for (const sawRewrite of [true, true, false]) {
      const d = decideMeasurePass(input({ sawRewrite, rewritePasses: passes }))
      passes = d.nextRewritePasses
      if (d.bump) bumps++
    }
    expect(bumps).toBe(2)
    expect(passes).toBe(0) // reset on convergence
  })
})
