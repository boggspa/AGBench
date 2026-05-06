# Architecture

**Core Stack**: Electron + React + TypeScript.

## Main Process (`src/main/`)
Responsible for system-level operations:
- Displaying native directory pickers.
- Spawning the `gemini` CLI subprocess.
- **Trust Management**: `TrustStatusService` safely parses official Gemini CLI trust files to determine workspace status.
- **Integrated Terminal**: Uses `node-pty` to provide an interactive terminal for the Trust Assistant flow.
- Executing `git diff` on the selected workspace.
- Enforcing safety rules (denylists, workspace confinement).

## Renderer Process (`src/renderer/`)
Responsible for the UI:
- React components (standard CSS, with specialized components like `ActivityStack` and `DiffViewer`).
- **Terminal UI**: Uses `xterm.js` for the embedded Trust Assistant terminal.
- Communicates exclusively via `window.electron` IPC APIs defined in preload.
- Stream parsing (GeminiStreamAdapter matches `tool_use`/`tool_result` events into `ToolActivity` objects).

## Data Flow (Gemini CLI)
1. User clicks "Run" -> Renderer sends `run-gemini` IPC with prompt.
2. Main process verifies workspace safety and spawns `gemini -p <prompt> --cwd <workspace> --output-format stream-json`.
3. Main process reads `stdout` using a line-delimited JSON stream parser.
4. Main process sends parsed events via IPC to Renderer (`gemini-token`, `gemini-event`, `gemini-end`).
5. Renderer updates state.

## Visual Architecture

### Appearance System
- **Theme tokens**: CSS custom properties in `src/renderer/src/styles/theme.css` define colors, spacing, typography, and surfaces.
- **Appearance modes**:
  - `solid` — fully opaque surfaces for maximum readability.
  - `soft_glass` — CSS `backdrop-filter` blur on sidebar and inspector panels.
  - `native_glass` — macOS `BrowserWindow` vibrancy (`sidebar`) + transparent background. Falls back to CSS soft glass on unsupported platforms.
- **Accessibility**: `prefers-reduced-motion`, `prefers-contrast`, and app-level `reduceTransparency` / `reduceMotion` settings are respected.
- **Settings storage**: Appearance settings live in `AppSettings` and persist to the OS user data directory.

### Layout
- **Header**: draggable chrome area with workspace/chat title and run status indicator.
- **Sidebar** (`src/renderer/src/components/Sidebar.tsx`): glass navigation surface with workspaces, recent chats, run summary, and settings access.
- **Transcript** (`src/renderer/src/components/` via `App.tsx`): central scrollable content column with message bubbles, floating composer, and status chips.
- **Inspector** (`src/renderer/src/components/Inspector.tsx`): right-side panel with tabs for Diff Studio, Raw Events, and Safety.

### Components
- **ActivityStack** (`src/renderer/src/components/ActivityStack.tsx`): compact timeline rows for tool calls with status icons, labels, file paths, durations, and expandable raw events.
- **DiffViewer** (`src/renderer/src/components/DiffViewer.tsx`): Diff Studio with selectable file list, status badges, and unified diff detail view with syntax-highlighted additions/deletions.
- **SettingsPanel** (`src/renderer/src/components/SettingsPanel.tsx`): modal for appearance mode, transparency, motion, density, and inspector visibility.

## Storage
- App settings are saved to the OS user data directory (e.g. `~/.config/gemini-local-workbench`).
- Secrets (if ever required) must use the OS keychain (not currently implemented).