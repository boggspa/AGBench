/**
 * Phase L — Editor / IDE registry. Mirrors CreativeAppAdapters in
 * shape but covers text editors and IDEs instead of creative software.
 *
 * Used by the Phase L MCP tools (`open_in_ide`, `open_in_ide_at_position`,
 * `reveal_in_finder`, `ide_app_status`, `ide_app_capabilities`,
 * `list_running_ides`) to:
 *  1. Validate bundle ids the agent passes (prevent NSWorkspace.open()
 *     into TextEdit / Finder / anything outside the curated set).
 *  2. Look up each editor's CLI binary + positional syntax so a
 *     "go to line 42" handoff actually lands at the right cursor.
 *  3. Report install/running state per editor through the same
 *     bundle-id-agnostic daemon probe the creative tools use.
 *
 * Auto-allowed (no approval modal). Opening a file in your editor of
 * choice is a focus-change, not a state mutation — the gate machinery
 * stays reserved for the destructive transports (K3-K6).
 */

export type EditorId =
  | 'vscode'
  | 'vscode-insiders'
  | 'cursor'
  | 'zed'
  | 'sublime-text'
  | 'xcode'
  | 'bbedit'
  | 'nova'
  | 'textmate'
  | 'intellij-idea'
  | 'webstorm'
  | 'pycharm'
  | 'goland'
  | 'clion'
  | 'rustrover'
  | 'rider'
  | 'rubymine'
  | 'phpstorm'
  | 'datagrip'
  | 'android-studio'

export const EDITOR_IDS: Set<EditorId> = new Set<EditorId>([
  'vscode',
  'vscode-insiders',
  'cursor',
  'zed',
  'sublime-text',
  'xcode',
  'bbedit',
  'nova',
  'textmate',
  'intellij-idea',
  'webstorm',
  'pycharm',
  'goland',
  'clion',
  'rustrover',
  'rider',
  'rubymine',
  'phpstorm',
  'datagrip',
  'android-studio'
])

export function isEditorId(value: unknown): value is EditorId {
  return typeof value === 'string' && EDITOR_IDS.has(value as EditorId)
}

/**
 * How a given editor's CLI binary expects to be told "open this file
 * at line:col". Most editors converge on one of three shapes:
 *
 *  - `vscode-goto`: `<cli> -g <file>:<line>:<col>`  (VS Code, Cursor)
 *  - `sublime-position`: `<cli> <file>:<line>:<col>`  (Sublime)
 *  - `dash-l-positional`: `<cli> <file> -l <line>`  (BBEdit, TextMate
 *    -- column is dropped because their CLIs only accept a line.)
 *  - `xcode-xed`: `xed -l <line> <file>`  (Xcode)
 *  - `zed-positional`: `<cli> <file>:<line>:<col>`  (Zed)
 *  - `none`: no positional support; the position is dropped and the
 *    file is opened plain. Used by IDEs whose CLI shim doesn't accept
 *    a position (anything that needs scripting bridge work to go-to-
 *    line — JetBrains comes close, see below).
 *
 * JetBrains IDEs all use the same shape:
 *   `<cli> --line <line> --column <col> <file>`
 *   (e.g. `idea --line 42 --column 3 /path/to/file.kt`)
 *
 * Aliased here as `jetbrains-flags`.
 */
export type EditorPositionalSyntax =
  | 'vscode-goto'
  | 'sublime-position'
  | 'dash-l-positional'
  | 'xcode-xed'
  | 'zed-positional'
  | 'jetbrains-flags'
  | 'none'

export interface EditorAdapter {
  id: EditorId
  label: string
  bundleIds: string[]
  commonAppPaths: string[]
  /**
   * CLI binary name as expected on PATH. May not be installed (the
   * user typically has to opt in via Shell Command: Install 'code' in
   * PATH or similar). The probe at status time reports a real
   * cliAvailable flag.
   */
  cliCommand?: string
  positionalSyntax: EditorPositionalSyntax
  /**
   * Stable bundle-id keys for "this editor's most common variants".
   * Some editors ship multiple SKUs (VS Code vs Insiders, JetBrains
   * EAP builds); we just enumerate the ones we want to recognise.
   */
  notes?: string
}

const EDITOR_ADAPTERS: EditorAdapter[] = [
  {
    id: 'vscode',
    label: 'Visual Studio Code',
    bundleIds: ['com.microsoft.VSCode'],
    commonAppPaths: ['/Applications/Visual Studio Code.app'],
    cliCommand: 'code',
    positionalSyntax: 'vscode-goto'
  },
  {
    id: 'vscode-insiders',
    label: 'Visual Studio Code — Insiders',
    bundleIds: ['com.microsoft.VSCodeInsiders'],
    commonAppPaths: ['/Applications/Visual Studio Code - Insiders.app'],
    cliCommand: 'code-insiders',
    positionalSyntax: 'vscode-goto'
  },
  {
    id: 'cursor',
    label: 'Cursor',
    bundleIds: ['com.todesktop.230313mzl4w4u92'],
    commonAppPaths: ['/Applications/Cursor.app'],
    cliCommand: 'cursor',
    positionalSyntax: 'vscode-goto',
    notes:
      'Cursor inherits VS Code\'s CLI surface and accepts `cursor -g file:line:col` for positional opens.'
  },
  {
    id: 'zed',
    label: 'Zed',
    bundleIds: ['dev.zed.Zed', 'dev.zed.Zed-Preview'],
    commonAppPaths: ['/Applications/Zed.app', '/Applications/Zed Preview.app'],
    cliCommand: 'zed',
    positionalSyntax: 'zed-positional'
  },
  {
    id: 'sublime-text',
    label: 'Sublime Text',
    bundleIds: ['com.sublimetext.4', 'com.sublimetext.3'],
    commonAppPaths: ['/Applications/Sublime Text.app'],
    cliCommand: 'subl',
    positionalSyntax: 'sublime-position'
  },
  {
    id: 'xcode',
    label: 'Xcode',
    bundleIds: ['com.apple.dt.Xcode'],
    commonAppPaths: ['/Applications/Xcode.app'],
    cliCommand: 'xed',
    positionalSyntax: 'xcode-xed',
    notes: 'xed takes -l <line> BEFORE the file argument. No column flag.'
  },
  {
    id: 'bbedit',
    label: 'BBEdit',
    bundleIds: ['com.barebones.bbedit'],
    commonAppPaths: ['/Applications/BBEdit.app'],
    cliCommand: 'bbedit',
    positionalSyntax: 'dash-l-positional',
    notes:
      'Use `bbedit +<line> <file>` for position; we normalise that via the dispatcher.'
  },
  {
    id: 'nova',
    label: 'Nova',
    bundleIds: ['com.panic.Nova'],
    commonAppPaths: ['/Applications/Nova.app'],
    // Nova's CLI is `nova` but doesn't expose a stable line-flag,
    // so position is dropped on open.
    cliCommand: 'nova',
    positionalSyntax: 'none'
  },
  {
    id: 'textmate',
    label: 'TextMate',
    bundleIds: ['com.macromates.TextMate'],
    commonAppPaths: ['/Applications/TextMate.app'],
    cliCommand: 'mate',
    positionalSyntax: 'dash-l-positional'
  },
  {
    id: 'intellij-idea',
    label: 'IntelliJ IDEA',
    bundleIds: ['com.jetbrains.intellij', 'com.jetbrains.intellij.ce'],
    commonAppPaths: [
      '/Applications/IntelliJ IDEA.app',
      '/Applications/IntelliJ IDEA Community Edition.app'
    ],
    cliCommand: 'idea',
    positionalSyntax: 'jetbrains-flags'
  },
  {
    id: 'webstorm',
    label: 'WebStorm',
    bundleIds: ['com.jetbrains.WebStorm'],
    commonAppPaths: ['/Applications/WebStorm.app'],
    cliCommand: 'webstorm',
    positionalSyntax: 'jetbrains-flags'
  },
  {
    id: 'pycharm',
    label: 'PyCharm',
    bundleIds: ['com.jetbrains.pycharm', 'com.jetbrains.pycharm.ce'],
    commonAppPaths: [
      '/Applications/PyCharm.app',
      '/Applications/PyCharm Professional Edition.app',
      '/Applications/PyCharm CE.app'
    ],
    cliCommand: 'pycharm',
    positionalSyntax: 'jetbrains-flags'
  },
  {
    id: 'goland',
    label: 'GoLand',
    bundleIds: ['com.jetbrains.goland'],
    commonAppPaths: ['/Applications/GoLand.app'],
    cliCommand: 'goland',
    positionalSyntax: 'jetbrains-flags'
  },
  {
    id: 'clion',
    label: 'CLion',
    bundleIds: ['com.jetbrains.CLion'],
    commonAppPaths: ['/Applications/CLion.app'],
    cliCommand: 'clion',
    positionalSyntax: 'jetbrains-flags'
  },
  {
    id: 'rustrover',
    label: 'RustRover',
    bundleIds: ['com.jetbrains.rustrover'],
    commonAppPaths: ['/Applications/RustRover.app'],
    cliCommand: 'rustrover',
    positionalSyntax: 'jetbrains-flags'
  },
  {
    id: 'rider',
    label: 'Rider',
    bundleIds: ['com.jetbrains.rider'],
    commonAppPaths: ['/Applications/Rider.app'],
    cliCommand: 'rider',
    positionalSyntax: 'jetbrains-flags'
  },
  {
    id: 'rubymine',
    label: 'RubyMine',
    bundleIds: ['com.jetbrains.rubymine'],
    commonAppPaths: ['/Applications/RubyMine.app'],
    cliCommand: 'mine',
    positionalSyntax: 'jetbrains-flags'
  },
  {
    id: 'phpstorm',
    label: 'PhpStorm',
    bundleIds: ['com.jetbrains.PhpStorm'],
    commonAppPaths: ['/Applications/PhpStorm.app'],
    cliCommand: 'phpstorm',
    positionalSyntax: 'jetbrains-flags'
  },
  {
    id: 'datagrip',
    label: 'DataGrip',
    bundleIds: ['com.jetbrains.datagrip'],
    commonAppPaths: ['/Applications/DataGrip.app'],
    cliCommand: 'datagrip',
    positionalSyntax: 'jetbrains-flags'
  },
  {
    id: 'android-studio',
    label: 'Android Studio',
    bundleIds: ['com.google.android.studio'],
    commonAppPaths: ['/Applications/Android Studio.app'],
    cliCommand: 'studio',
    positionalSyntax: 'jetbrains-flags'
  }
]

export function listEditorAdapters(): EditorAdapter[] {
  return EDITOR_ADAPTERS.map((adapter) => ({
    ...adapter,
    bundleIds: [...adapter.bundleIds],
    commonAppPaths: [...adapter.commonAppPaths]
  }))
}

export function findEditorById(id: EditorId): EditorAdapter | undefined {
  const found = EDITOR_ADAPTERS.find((adapter) => adapter.id === id)
  if (!found) return undefined
  return {
    ...found,
    bundleIds: [...found.bundleIds],
    commonAppPaths: [...found.commonAppPaths]
  }
}

/**
 * Flat de-duped list of every bundle id this registry tracks. Mirror of
 * `listCreativeAppBundleIds()` — the daemon's running-process probe
 * can take both lists in one shot.
 */
export function listEditorBundleIds(): string[] {
  const set = new Set<string>()
  for (const adapter of EDITOR_ADAPTERS) {
    for (const bundleId of adapter.bundleIds) set.add(bundleId)
  }
  return [...set]
}

/**
 * Find an editor by bundle id. Useful when the daemon hands back a
 * running-process answer and the caller needs to know which adapter
 * to surface. Returns undefined if the bundle isn't in our registry
 * (which is the only safe thing — agent can't NSWorkspace into
 * surprises).
 */
export function findEditorByBundleId(bundleId: string): EditorAdapter | undefined {
  const found = EDITOR_ADAPTERS.find((adapter) => adapter.bundleIds.includes(bundleId))
  if (!found) return undefined
  return {
    ...found,
    bundleIds: [...found.bundleIds],
    commonAppPaths: [...found.commonAppPaths]
  }
}

/**
 * Build the arg list for invoking the editor's CLI at a specific
 * position. Caller is responsible for resolving the actual CLI path
 * (the Swift side does a PATH lookup) and shell-escaping the file
 * argument. This function just produces the array of args in the
 * order the editor expects.
 *
 * Returns `null` when the editor has no positional support; caller
 * should fall back to NSWorkspace.open() instead.
 */
export function buildEditorPositionalArgs(
  adapter: EditorAdapter,
  filePath: string,
  line: number,
  column?: number
): string[] | null {
  if (!adapter.cliCommand) return null
  const col = column && column > 0 ? column : 1
  switch (adapter.positionalSyntax) {
    case 'vscode-goto':
      return ['-g', `${filePath}:${line}:${col}`]
    case 'zed-positional':
    case 'sublime-position':
      return [`${filePath}:${line}:${col}`]
    case 'xcode-xed':
      return ['-l', String(line), filePath]
    case 'jetbrains-flags':
      return ['--line', String(line), '--column', String(col), filePath]
    case 'dash-l-positional':
      // BBEdit / TextMate accept `+<line>` as a positional prefix arg.
      // Column is dropped.
      return [`+${line}`, filePath]
    case 'none':
      return null
  }
}
