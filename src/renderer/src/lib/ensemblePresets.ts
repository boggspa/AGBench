import type { PermissionPresetId } from '../../../main/store/types'

/**
 * 1.0.4-AT9 — Work Session preset registry.
 *
 * Closing the AT sprint: instead of asking the user to tune
 * objective + acceptance criteria + budget + permission preset
 * + fan-out toggle every time they open a Work Session, the
 * setup sheet now offers a small set of named presets that
 * configure those fields together for the most common shapes
 * the panel review identified as valuable:
 *
 *   - One-shot review
 *   - Architecture panel
 *   - Parallel fan-out
 *   - Implementation review
 *   - Long-running work session
 *
 * Each preset specifies field overrides — the user can still
 * tweak everything afterwards; the preset is just a fast path to
 * "I want THIS kind of session". The Long-running preset
 * specifically requires the AT8 synthesizer hint + budget caps
 * because those are the controls that keep multi-day work from
 * drifting (per the AT spec's "long-running work session
 * requires X" list).
 */

export interface EnsemblePresetDescriptor {
  id: string
  label: string
  description: string
  /** Field overrides applied to the setup-sheet state when this
   * preset is selected. All fields are optional; the sheet keeps
   * its current value for anything the preset doesn't touch. */
  overrides: {
    permissionPresetId?: PermissionPresetId
    maxRoundsPerProvider?: number
    maxDurationMs?: number
    enableScoutPass?: boolean
    /** Default value to seed the acceptance-criteria textarea when
     * the user picks the preset. Empty / undefined leaves the
     * existing input untouched. */
    acceptanceCriteriaHint?: string
    /** Suggested synthesizer behavior. `'required'` means the
     * Long-running preset assumes a synthesizer is configured;
     * the setup sheet's submit handler can guard on this and
     * surface a warning if no synthesizer is set. */
    synthesizerRequirement?: 'required' | 'optional'
  }
}

const HOUR_MS = 60 * 60 * 1000

export const ENSEMBLE_PRESETS: EnsemblePresetDescriptor[] = [
  {
    id: 'one-shot-review',
    label: 'One-shot review',
    description:
      'A single quick round where the panel reviews a change set or document. Read-only by default, tight budget.',
    overrides: {
      permissionPresetId: 'read_only',
      maxRoundsPerProvider: 1,
      maxDurationMs: 30 * 60 * 1000,
      enableScoutPass: false,
      acceptanceCriteriaHint: 'The panel has reviewed the diff and surfaced any concerns.',
      synthesizerRequirement: 'optional'
    }
  },
  {
    id: 'architecture-panel',
    label: 'Architecture panel',
    description:
      'Deep architectural discussion with multiple perspectives. Read-only, longer budget, parallel fan-out on.',
    overrides: {
      permissionPresetId: 'read_only',
      maxRoundsPerProvider: 4,
      maxDurationMs: 2 * HOUR_MS,
      enableScoutPass: true,
      acceptanceCriteriaHint:
        'The panel has converged on a recommended architecture with trade-offs documented.',
      synthesizerRequirement: 'optional'
    }
  },
  {
    id: 'scout-pass',
    label: 'Parallel fan-out',
    description:
      'Read-only fan-out — every participant inspects the workspace in parallel and emits a brief, then one writer synthesises.',
    overrides: {
      permissionPresetId: 'read_only',
      maxRoundsPerProvider: 2,
      maxDurationMs: HOUR_MS,
      enableScoutPass: true,
      acceptanceCriteriaHint:
        'Each scout has emitted a brief and the writer has produced a consolidated recommendation.',
      synthesizerRequirement: 'optional'
    }
  },
  {
    id: 'implementation-review',
    label: 'Implementation review',
    description:
      'Review-and-iterate flow. Workspace-write so the writer can apply suggested fixes; medium budget.',
    overrides: {
      permissionPresetId: 'workspace_write',
      maxRoundsPerProvider: 6,
      maxDurationMs: 2 * HOUR_MS,
      enableScoutPass: false,
      acceptanceCriteriaHint:
        'The panel has reviewed the implementation and any suggested fixes have been applied + verified.',
      synthesizerRequirement: 'optional'
    }
  },
  {
    id: 'long-running-work-session',
    label: 'Long-running work session',
    description:
      'Aggressive multi-round autonomy for sustained work. Requires a synthesizer for coherence; full 6h budget.',
    overrides: {
      permissionPresetId: 'workspace_write',
      maxRoundsPerProvider: 38,
      maxDurationMs: 6 * HOUR_MS,
      enableScoutPass: false,
      acceptanceCriteriaHint:
        'All sub-objectives are complete, the test suite is green, and the synthesizer has summarised the final state.',
      synthesizerRequirement: 'required'
    }
  }
]

export function findEnsemblePreset(id: string | undefined): EnsemblePresetDescriptor | undefined {
  if (!id) return undefined
  return ENSEMBLE_PRESETS.find((preset) => preset.id === id)
}
