/**
 * ApnsIdleGate — pure helper that decides whether the user is currently
 * "at the desktop" and therefore doesn't need an APNs wake-push.
 *
 * Lives in its own file so it's testable without mocking Electron's
 * `BrowserWindow` and `powerMonitor` directly: the caller in
 * `src/main/index.ts` reads those values, this module decides.
 *
 * Decision policy:
 *   1. If `idleGateEnv === 'off'`, the gate is disabled — return true
 *      (treat as "at desktop") so the caller suppresses no pushes.
 *      Useful for staging tests and "fire every push" debugging.
 *   2. If the main window isn't focused, return false. A backgrounded
 *      app means the user is somewhere else (other window, locked
 *      screen, away).
 *   3. If the window IS focused but the system has been idle longer
 *      than the threshold, return false. The user might have a
 *      foregrounded window from lunch-ago; the idle reading is the
 *      better signal than focus.
 *   4. Otherwise return true.
 *
 * Threshold default: 60 seconds. Override via `TASKWRAITH_APNS_IDLE_THRESHOLD_S`.
 *
 * Fail-open philosophy: the caller in `index.ts` wraps the live
 * version in a try/catch and returns false on throw, so a flaky
 * power-monitor reading never blocks an approval push. The pure
 * helper itself never throws.
 */

export const DEFAULT_APNS_IDLE_THRESHOLD_S = 60

export interface ApnsIdleGateInputs {
  /** `process.env.TASKWRAITH_APNS_IDLE_GATE` value, or undefined. */
  idleGateEnv?: string
  /** `process.env.TASKWRAITH_APNS_IDLE_THRESHOLD_S` value, or undefined. */
  idleThresholdEnv?: string
  /** Whether the TaskWraith main window currently has OS focus. */
  windowFocused: boolean
  /** Seconds since last user input, from Electron's powerMonitor. */
  idleSec: number
}

export function isUserAtDesktop(inputs: ApnsIdleGateInputs): boolean {
  if (inputs.idleGateEnv === 'off') return true
  if (!inputs.windowFocused) return false
  const thresholdRaw = Number(inputs.idleThresholdEnv)
  const threshold =
    Number.isFinite(thresholdRaw) && thresholdRaw > 0 ? thresholdRaw : DEFAULT_APNS_IDLE_THRESHOLD_S
  return inputs.idleSec < threshold
}
