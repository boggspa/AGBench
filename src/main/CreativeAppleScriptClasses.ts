/**
 * Phase K4 — Named AppleScript class library.
 *
 * Each entry is a parameterised script template the agent can dispatch
 * by class name (e.g. `fcp.open-project`) without authoring AppleScript
 * source directly. Two benefits:
 *
 *  1. **Session-class approval cache works as intended.** The user's
 *     "Approve & remember for session" choice on `fcp.open-project`
 *     applies to every subsequent `fcp.open-project` call regardless
 *     of which project path the agent passes. If the agent could
 *     ship raw source, "remember" would either be unsafe (one approval
 *     blesses everything) or useless (no two scripts identical).
 *  2. **The agent doesn't need to know AppleScript syntax.** Each
 *     class is named after the task it accomplishes; the agent
 *     supplies typed params and the template handles escaping +
 *     wiring.
 *
 * Raw-script execution lives at the separate `applescript.raw` class
 * which intentionally never caches (every call prompts) — there is no
 * way to reuse a "remember" approval to ship arbitrary source.
 */

export interface AppleScriptParamSpec {
  name: string
  /**
   * Human-readable description shown in the approval modal alongside
   * the substituted value.
   */
  description: string
  /**
   * Optional validator. Return `null` on success, an error string on
   * failure. Tool refuses dispatch when any param fails validation
   * BEFORE the gate sees the request — saves the user a useless
   * approval prompt for a script that would have errored at compile.
   */
  validate?: (value: string) => string | null
}

export interface AppleScriptClassEntry {
  /**
   * Public-facing class name. Becomes the className used by the
   * session-class approval cache: `applescript:fcp.open-project`.
   * The `applescript:` prefix keeps creative-app classes namespaced
   * separately from K5 (blender:...) and K6 (midi:...) classes.
   */
  id: string
  label: string
  description: string
  /**
   * Target app's bundle id. Surfaced in the approval modal so the
   * user can verify they're approving for the right app.
   */
  targetBundleId: string
  params: AppleScriptParamSpec[]
  /**
   * Build the script source. `params` is keyed by `params[i].name`.
   * Implementations are responsible for any AppleScript-level escaping
   * needed for the values — typically wrapping in `quoted form of`
   * or doubling backslashes inside string literals.
   */
  build: (params: Record<string, string>) => string
}

/**
 * AppleScript helper: escape a string for embedding inside an
 * AppleScript double-quoted literal. AppleScript's only escape inside
 * `"..."` is `\"` and `\\`. Backticks, quotes-of-other-types, and
 * newlines pass through unchanged.
 */
export function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * The class library. Keep entries small + transport-focused — anything
 * that needs >3 AppleScript statements probably wants its own dedicated
 * MCP tool, not a class entry here.
 */
export const APPLESCRIPT_CLASSES: AppleScriptClassEntry[] = [
  {
    id: 'fcp.open-project',
    label: 'Open Final Cut Pro project',
    description: 'Tell Final Cut Pro to open the project file at the given path.',
    targetBundleId: 'com.apple.FinalCut',
    params: [
      {
        name: 'projectPath',
        description: 'Absolute path to the .fcpx project file',
        validate: (value) =>
          value.startsWith('/') ? null : 'projectPath must be an absolute path starting with /'
      }
    ],
    build: ({ projectPath }) => {
      const escaped = escapeAppleScriptString(projectPath)
      return `
        tell application "Final Cut Pro"
          activate
          open POSIX file "${escaped}"
        end tell
      `.trim()
    }
  },
  {
    id: 'fcp.set-playhead',
    label: 'Move Final Cut Pro playhead',
    description:
      'Move the active Final Cut Pro timeline playhead to a specific timecode (HH:MM:SS:FF format).',
    targetBundleId: 'com.apple.FinalCut',
    params: [
      {
        name: 'timecode',
        description: 'Target timecode (e.g. 00:01:23:15)',
        validate: (value) =>
          /^\d{2}:\d{2}:\d{2}:\d{2}$/.test(value) ? null : 'timecode must be in HH:MM:SS:FF format'
      }
    ],
    build: ({ timecode }) => {
      // FCP does not expose direct playhead set via AppleScript dictionary;
      // we go via System Events keystroke into the timecode display.
      // First brings FCP forward, then presses Cmd-= (open timecode entry),
      // types the timecode, presses Return.
      const escaped = escapeAppleScriptString(timecode)
      return `
        tell application "Final Cut Pro" to activate
        tell application "System Events"
          tell process "Final Cut Pro"
            keystroke "=" using {command down}
            delay 0.15
            keystroke "${escaped}"
            keystroke return
          end tell
        end tell
      `.trim()
    }
  },
  {
    id: 'fcp.export-current',
    label: 'Export current Final Cut Pro project',
    description:
      "Trigger Final Cut Pro's File → Share → Master File menu to start an export of the active project.",
    targetBundleId: 'com.apple.FinalCut',
    params: [],
    build: () => {
      return `
        tell application "Final Cut Pro" to activate
        tell application "System Events"
          tell process "Final Cut Pro"
            click menu item "Master File…" of menu "Share" of menu item "Share" of menu "File" of menu bar 1
          end tell
        end tell
      `.trim()
    }
  },
  {
    id: 'logic.open-project',
    label: 'Open Logic Pro project',
    description: 'Tell Logic Pro to open the project file at the given path.',
    targetBundleId: 'com.apple.logic10',
    params: [
      {
        name: 'projectPath',
        description: 'Absolute path to the .logicx package',
        validate: (value) =>
          value.startsWith('/') ? null : 'projectPath must be an absolute path starting with /'
      }
    ],
    build: ({ projectPath }) => {
      const escaped = escapeAppleScriptString(projectPath)
      return `
        tell application "Logic Pro"
          activate
          open POSIX file "${escaped}"
        end tell
      `.trim()
    }
  },
  {
    id: 'logic.set-tempo',
    label: 'Set Logic Pro tempo',
    description:
      "Open Logic Pro's tempo display and type a new BPM value. Affects the project's global tempo.",
    targetBundleId: 'com.apple.logic10',
    params: [
      {
        name: 'bpm',
        description: 'Target BPM (1-999)',
        validate: (value) => {
          const n = Number(value)
          if (!Number.isFinite(n) || n < 1 || n > 999)
            return 'bpm must be a number between 1 and 999'
          return null
        }
      }
    ],
    build: ({ bpm }) => {
      const escaped = escapeAppleScriptString(bpm)
      // Logic's tempo display is reachable via the LCD display group.
      // GUI scripting click chain — fragile but the dictionary doesn't
      // expose tempo directly.
      return `
        tell application "Logic Pro" to activate
        tell application "System Events"
          tell process "Logic Pro"
            keystroke "${escaped}" using {control down, option down, command down}
          end tell
        end tell
      `.trim()
    }
  }
]

/**
 * Lookup helper. Returns undefined for unknown class ids; caller is
 * responsible for surfacing a clean error.
 */
export function findAppleScriptClass(id: string): AppleScriptClassEntry | undefined {
  return APPLESCRIPT_CLASSES.find((entry) => entry.id === id)
}

/**
 * Format a className for the session-class approval cache. Used by
 * both the named-class path and the raw path (raw uses
 * `applescript:raw` which intentionally never caches).
 */
export function formatAppleScriptClassName(id: string): string {
  return `applescript:${id}`
}
