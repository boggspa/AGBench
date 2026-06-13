# Security Development Baseline

TaskWraith is a local Electron app that can run coding agents and CLIs against
user workspaces. Treat dependency updates, IPC bridges, shell execution, and
release signing as security-sensitive changes.

## Dependency Installs

- Use `npm ci` for clean installs. Avoid casual `npm install` or broad
  `npm update` during active npm incident windows.
- Run `npm run security:deps` after dependency changes and before releases.
  This checks the lockfile, registry signatures, critical production audit
  findings, known incident package names, suspicious persistence indicators,
  and the allowlist of packages with install lifecycle scripts.
- Review every `package-lock.json` diff. New install lifecycle scripts should
  be treated like code execution on developer and CI machines.

## Electron Runtime

- Keep renderer privileges low: `contextIsolation: true`,
  `nodeIntegration: false`, and renderer sandboxing on for app windows.
- Expose new main-process capabilities only through preload APIs backed by
  explicit IPC validation.
- Route external links and file paths through the safe shell-open policy; do
  not call `shell.openExternal` directly for untrusted renderer input.

## Secrets and Release

- Release signing, notarization, npm, GitHub, Apple, and provider API tokens
  should be scoped and available only to the jobs or local shells that need
  them.
- Apple notarization credentials should live in the macOS keychain as a named
  notarytool profile, not in shell history or repository files. Local release
  commands may reference the profile name, but must not print or commit the
  underlying Apple ID password.
- macOS public artifacts should be Developer ID signed, notarized, stapled, and
  validated with Gatekeeper/update-feed checks before release upload.
- Unsigned Windows and Linux artifacts should be produced by explicit GitHub
  Actions workflows and labelled as unsigned in release notes.
- CI release jobs should run dependency security checks before packaging or
  notarization.
- If a supply-chain incident may have affected a machine or CI run, pause
  releases, inspect lockfile/package names and lifecycle scripts, review CI
  logs, rotate exposed tokens, and rebuild from a clean checkout plus lockfile.
