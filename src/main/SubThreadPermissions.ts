import type { EffectiveRunPermissions } from './store/types'

/**
 * The resolved permissions a delegated sub-thread should run under.
 *
 * A sub-thread must never be MORE permissive than its delegator, so it inherits
 * the parent run's effective posture verbatim — notably read_only's
 * shellCommands / fileChanges denies. When the parent has no explicit posture
 * (undefined), the sub-thread falls back to global settings, unchanged from the
 * pre-fix behaviour for non-posture runs.
 *
 * SECURITY: without this inheritance a read-only participant could delegate a
 * write. The delegated sub-thread session would carry no effectivePermissions,
 * so the host gate (requestAgenticServiceApproval) resolves the call against
 * GLOBAL settings (default 'ask' / 'allow') instead of the parent's read_only
 * denies — a real read-only escape on the delegating seat.
 */
export function inheritedSubThreadPermissions(parent: {
  effectivePermissions?: EffectiveRunPermissions
}): EffectiveRunPermissions | undefined {
  return parent.effectivePermissions
}
