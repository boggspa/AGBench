/**
 * Pure helper that shortens a file path for inline display in activity rows.
 *
 * The full absolute path produced by tool adapters (e.g.
 * `/Users/alice/Documents/Dungeons of Darkness/Sources/DungeonsEngine/SoundSynth.swift`)
 * is verbose and visually collides with right-edge metadata such as
 * `+24 -11 · 75ms`. Activity rows still want to surface enough of the path
 * for the user to identify the file at a glance — typically the
 * workspace-relative segments — while the full path is preserved on hover
 * via the surrounding `title` attribute.
 *
 * Strategy (in priority order):
 *   1. When `workspacePath` is set AND `filePath` lives under it
 *      (segment-aware prefix match), strip the prefix + leading separator.
 *      A path that equals the workspace root collapses to `.`.
 *   2. Otherwise, when the path starts with the macOS/Linux home directory
 *      (`/Users/<user>/`) collapse the home portion to `~/...`. This is a
 *      polish fallback for files outside the workspace — most often docs or
 *      libraries the agent visits during a task.
 *   3. Otherwise return the original path unchanged.
 *
 * Comparison is case-sensitive by default. macOS volumes are typically
 * case-insensitive, but Linux and Windows are not — defaulting to
 * case-sensitive matches what cross-platform code would expect from a
 * deterministic helper. Callers that need looser semantics can normalise
 * before invoking.
 */

const SEPARATOR_RE = /[\\/]+$/
const HOME_PREFIX_RE = /^\/Users\/[^/]+\//

function stripTrailingSeparator(value: string): string {
  return value.replace(SEPARATOR_RE, '')
}

function startsWithSegment(haystack: string, prefix: string): boolean {
  if (haystack === prefix) return true
  if (!haystack.startsWith(prefix)) return false
  const nextChar = haystack.charAt(prefix.length)
  return nextChar === '/' || nextChar === '\\'
}

/**
 * Returns a display-friendly path:
 *   - workspace-relative when the file lives under `workspacePath`
 *   - `~/...` form when the file lives under the macOS home directory
 *   - the original path otherwise
 *
 * Empty / nullish inputs are returned as the empty string so callers can
 * substitute their own fallback label without a runtime crash.
 */
export function displayPathRelativeToWorkspace(
  filePath: string | undefined | null,
  workspacePath: string | undefined | null
): string {
  if (!filePath || typeof filePath !== 'string') return ''
  const trimmedPath = filePath.trim()
  if (!trimmedPath) return ''

  if (workspacePath && typeof workspacePath === 'string') {
    const trimmedWorkspace = stripTrailingSeparator(workspacePath.trim())
    if (trimmedWorkspace) {
      if (trimmedPath === trimmedWorkspace) return '.'
      if (startsWithSegment(trimmedPath, trimmedWorkspace)) {
        // +1 to drop the separator character that follows the prefix match.
        const relative = trimmedPath.slice(trimmedWorkspace.length + 1)
        return relative || '.'
      }
    }
  }

  const homeMatch = trimmedPath.match(HOME_PREFIX_RE)
  if (homeMatch) {
    return `~/${trimmedPath.slice(homeMatch[0].length)}`
  }

  return trimmedPath
}
