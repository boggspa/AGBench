# Gemini Local Workbench

A private, local-only desktop GUI companion for the Gemini CLI.

## Purpose
This application wraps the official `gemini` CLI tool in an Electron + React UI to provide a polished developer experience, maintaining local execution and keeping interactions within the boundaries of the official CLI access paths.

## Features
- **Workspace Trust Assistant**: Integrated PTY terminal to run the official Gemini CLI trust flow.
- **Activity Review**: Compact Activity Timeline for tool calls with status indicators, friendly labels, and expandable raw events.
- **Diff Studio**: File-list + diff-detail review surface with run-scoped "This run" vs "Workspace" toggle, synthetic new-file diffs, and noise filtering.
- **Session-only Trust**: Option to trust a workspace for a single run using official CLI environment variables.
- **Local History & Usage**: Private local-only storage for chats and token usage statistics.
- **Appearance System**: Three visual modes (Solid, Soft Glass, Native Glass) with platform-aware macOS vibrancy, plus accessibility settings for reduce transparency and reduce motion.

## Setup
1. Ensure Node.js (>= 18) and the `gemini` CLI are installed.
2. Clone or open this repository.
3. Run `npm ci`.
4. Run `npm run dev` to start the local development app.

Use `npm ci` for clean installs so npm follows the committed lockfile exactly.
Run `npm run security:deps` before release work or after dependency changes.

## Smoke Testing / Troubleshooting commands
If you encounter issues in the GUI, verify your setup using these direct commands in an external terminal:

1. **Version check:**
   `gemini --version` (Requires 0.39.1+ for secure headless trust features).
2. **Simple model test:**
   `gemini --model flash-lite --prompt "Reply with exactly OK." --output-format stream-json`
3. **Pro/default capacity test:**
   `gemini --prompt "Reply with exactly OK." --output-format stream-json`
4. **Workspace trust (interactive):**
   ```
   cd <workspace>
   gemini
   /permissions trust
   ```
5. **File edit test (throwaway folder only):**
   ```
   mkdir -p ~/Desktop/gemini-workbench-smoke-test
   cd ~/Desktop/gemini-workbench-smoke-test
   git init
   gemini --model flash-lite --sandbox --approval-mode auto_edit --prompt "Create hello-world.txt containing Hello World. Do not modify any other files." --output-format stream-json
   ```

## Troubleshooting

- **Untracked files in diff:** Normal `git diff` does not show untracked file contents. The app now generates synthetic previews for created text files so you can review new files without staging them.
- **"This run" vs "Workspace":** The Diff Review panel has two views. "This run" shows only files that changed during the selected agent run. "Workspace" shows all current uncommitted changes. Pre-existing dirty files are marked separately so they are not falsely attributed to Gemini.
- **Tool events:** Tool calls and results come from Gemini CLI `stream-json` output as `tool_use` and `tool_result` events. If tool names show as "unknown," inspect the Raw Events tab to see the exact event shape, and verify the CLI version is up to date.
- **Approval mode:** The effective approval mode used for each run is captured at the moment the run starts and stored on the run record. Changing the selector after a run starts does not retroactively alter the run's displayed mode.
- **Appearance:** You can change the visual mode in Settings. "Native Glass" uses macOS vibrancy and works best on Apple Silicon Macs. If text becomes hard to read, switch to "Solid" or enable "Reduce transparency".

## Development
This app uses Electron + React + TypeScript.
- `src/main`: Electron backend process.
- `src/preload`: IPC bridge.
- `src/renderer`: React frontend UI.
- `src/main/store`: App persistence layer.

See `ARCHITECTURE.md`, `SAFETY.md`, and `TERMS_NOTES.md` for more details.
