import { describe, expect, it } from 'vitest'
import { ENSEMBLE_PRESETS, findEnsemblePreset } from './ensemblePresets'

describe('ENSEMBLE_PRESETS (AT9)', () => {
  it('exposes all five preset shapes from the AT spec', () => {
    const ids = ENSEMBLE_PRESETS.map((p) => p.id).sort()
    expect(ids).toEqual(
      [
        'one-shot-review',
        'architecture-panel',
        'scout-pass',
        'implementation-review',
        'long-running-work-session'
      ].sort()
    )
  })

  it('all presets have unique ids', () => {
    const ids = ENSEMBLE_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all presets have a label, description, and overrides block', () => {
    for (const preset of ENSEMBLE_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0)
      expect(preset.description.length).toBeGreaterThan(0)
      expect(preset.overrides).toBeDefined()
    }
  })

  it('Long-running preset requires a synthesizer (only preset that does)', () => {
    const longRunning = findEnsemblePreset('long-running-work-session')!
    expect(longRunning.overrides.synthesizerRequirement).toBe('required')

    const others = ENSEMBLE_PRESETS.filter((p) => p.id !== 'long-running-work-session')
    for (const preset of others) {
      // 'optional' or undefined — never 'required'.
      expect(preset.overrides.synthesizerRequirement === 'required').toBe(false)
    }
  })

  it('budget escalates monotonically with session ambition', () => {
    // One-shot < Fan-out < Architecture/Implementation < Long-running
    const oneShot = findEnsemblePreset('one-shot-review')!.overrides
    const scout = findEnsemblePreset('scout-pass')!.overrides
    const arch = findEnsemblePreset('architecture-panel')!.overrides
    const impl = findEnsemblePreset('implementation-review')!.overrides
    const long = findEnsemblePreset('long-running-work-session')!.overrides

    expect(oneShot.maxDurationMs!).toBeLessThan(scout.maxDurationMs!)
    expect(scout.maxDurationMs!).toBeLessThanOrEqual(arch.maxDurationMs!)
    expect(arch.maxDurationMs!).toBeLessThanOrEqual(impl.maxDurationMs!)
    expect(impl.maxDurationMs!).toBeLessThan(long.maxDurationMs!)

    expect(oneShot.maxRoundsPerProvider!).toBeLessThan(long.maxRoundsPerProvider!)
  })

  it('read-only presets do not enable workspace_write', () => {
    const readOnlyIds = ['one-shot-review', 'architecture-panel', 'scout-pass']
    for (const id of readOnlyIds) {
      expect(findEnsemblePreset(id)!.overrides.permissionPresetId).toBe('read_only')
    }
  })

  it('Parallel fan-out + Architecture-panel enable fan-out; others do not', () => {
    expect(findEnsemblePreset('scout-pass')!.overrides.enableScoutPass).toBe(true)
    expect(findEnsemblePreset('architecture-panel')!.overrides.enableScoutPass).toBe(true)
    expect(findEnsemblePreset('one-shot-review')!.overrides.enableScoutPass).toBe(false)
    expect(findEnsemblePreset('implementation-review')!.overrides.enableScoutPass).toBe(false)
    expect(findEnsemblePreset('long-running-work-session')!.overrides.enableScoutPass).toBe(false)
  })

  it('findEnsemblePreset returns undefined for unknown / missing ids', () => {
    expect(findEnsemblePreset('not-a-real-preset')).toBeUndefined()
    expect(findEnsemblePreset(undefined)).toBeUndefined()
    expect(findEnsemblePreset('')).toBeUndefined()
  })
})
