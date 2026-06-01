# AGBench

AGBench is a local-first desktop workbench for running and reviewing AI coding
agents against developer workspaces. It provides a macOS-focused Electron UI for
provider CLIs and SDK-backed workflows while keeping execution, history, and
workspace state on the user's machine.


<img width="1525" height="2160" alt="Screenshot 2026-06-01 at 21 09 25" src="https://github.com/user-attachments/assets/95b09f35-2636-4d2e-8643-1981f2e9a080" />
<img width="1525" height="2160" alt="Screenshot 2026-06-01 at 20 54 50" src="https://github.com/user-attachments/assets/17ccc7cb-d98c-4333-954b-90a3bab38ea9" />



## Features

- **Workspace Safety**: Workspace selection, trust-state visibility, approval
  modes, and run-scoped safety state before agents operate on local files.
- **Provider Runs**: Integrated run surfaces for supported coding-agent
  providers, with provider names used only to describe compatible integrations.
- **Activity Review**: Compact timelines for tool calls, command output,
  status, durations, and raw event inspection.
- **Diff Studio**: File-list and diff-detail review for run-scoped changes and
  current workspace changes, including previews for newly created text files.
- **Local History and Usage**: Local-only chat, run, and usage state for repeat
  work without a hosted backend.
- **Release Tooling**: Security, dependency, packaging, and signing hooks for
  reproducible local release work.

## Public Source Boundary

AGBench source code is licensed under Apache-2.0. Provider product names are
used nominatively to describe interoperability with user-installed tools and
accounts. The repository does not intentionally bundle provider logos,
trademarks, API credentials, signing material, or proprietary provider fonts.

Users are responsible for installing and authenticating the provider CLIs, SDKs,
or accounts they choose to use. AGBench does not bypass provider authentication,
quotas, rate limits, approval flows, or terms of service.

## Development Setup

1. Install Node.js 20 or newer.
2. Install any provider CLI you intend to use separately.
3. Run `npm ci`.
4. Run `npm run dev`.

Use `npm ci` for clean installs so npm follows the committed lockfile exactly.
Run `npm run security:deps` before release work or after dependency changes.

## Useful Commands

```sh
npm run security:deps
npm run typecheck
npm run test
npm run build
```

## Project Layout

- `src/main`: Electron main process, provider orchestration, persistence, and
  workspace safety services.
- `src/preload`: Narrow IPC bridge exposed to the renderer.
- `src/renderer`: React UI, provider review surfaces, settings, and visual
  system.
- `swift`: macOS bridge daemon sources used by local release builds.
- `scripts`: Build, security, validation, signing, and packaging utilities.

See `CHANGELOG.md` for release history, and `ARCHITECTURE.md`, `SAFETY.md`,
`SECURITY.md`, and `TERMS_NOTES.md` for more detail.
