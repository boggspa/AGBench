# Architecture

**Core Stack**: Electron + React + TypeScript.

## Main Process (`src/main/`)
Responsible for system-level operations:
- Displaying native directory pickers.
- Spawning the `gemini` CLI subprocess.
- Executing `git diff` on the selected workspace.
- Enforcing safety rules (denylists, workspace confinement).

## Renderer Process (`src/renderer/`)
Responsible for the UI:
- React components using Tailwind CSS / basic CSS.
- Communicates exclusively via `window.electron` IPC APIs defined in preload.
- Stream parsing (listening to IPC events and appending tokens to UI).

## Data Flow (Gemini CLI)
1. User clicks "Run" -> Renderer sends `run-gemini` IPC with prompt.
2. Main process verifies workspace safety and spawns `gemini -p <prompt> --cwd <workspace> --output-format stream-json`.
3. Main process reads `stdout` using a line-delimited JSON stream parser.
4. Main process sends parsed events via IPC to Renderer (`gemini-token`, `gemini-event`, `gemini-end`).
5. Renderer updates state.

## Storage
- App settings are saved to the OS user data directory (e.g. `~/.config/gemini-local-workbench`).
- Secrets (if ever required) must use the OS keychain (not currently implemented).