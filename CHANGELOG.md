# Changelog

Notable changes to AGBench, the local-first macOS desktop workbench for running
and reviewing AI coding agents. Entries are user-facing highlights; execution,
history, and workspace state stay on your machine throughout.

## 1.0.7 — 2026-06-01

### Added
- **Ensemble shared blackboard** — a compact, scoped scratchpad of agreed facts,
  decisions, open risks, and do-not-repeat notes that panel participants consume
  instead of re-deriving context every round.
- **Session checkpoints** — long-running ensemble sessions snapshot their state
  and offer a transparent, timestamped resume after a crash or restart (it asks,
  it never silently auto-resumes).
- **Sticky screen-watch attachments** — a chat remembers the window it was
  watching and offers one-tap "Resume watching" when you return to it.
- **Solo scratchpad recall** — solo chats carry forward a recap of the last
  substantive turn and its tool trace across pause/resume.

### Changed
- **Long-transcript performance** — the transcript is virtualized, so dense
  ensemble threads stay smooth as they grow.
- **Usage & cost tracking** — ensemble runs now count toward the cumulative
  wall-clock and the activity heatmaps, and ensemble chats appear in Recents.
- **Ensemble coordination** — heuristics detect stuck / looping / disagreement
  patterns and *recommend* extending a round or synthesizing (never autonomous).
- More robust content-filter retries and provider rate-refresh fallbacks.

### Accessibility
- Status and indicator animations honour the in-app reduce-motion setting; the
  keyboard focus ring on message actions was restored.

### Security
- Signed and notarized macOS build.

## 1.0.6 — 2026-05-31

### Added
- **Two new first-class providers** — Grok (xAI agent CLI) and Cursor
  (Composer 2.5 CLI) — wired through composer shells, model pickers, sign-in
  flows, usage meters, and sub-thread inference alongside the existing lineup.
- **Scheduled pause / resume** — participants (and solo chats) can pause
  mid-run and resume later, with state surviving an app restart.
- **Workspace popout windows** — Diff Studio and the file editor in their own
  native windows with live refresh.
- **Currency layer** — display-currency picker, live FX refresh, and
  per-provider rate handling for cost estimates.
- Activity heatmaps (workspace / app / external), sub-agent identicons,
  provider glyphs, and an app-shell stats toolbar.

### Changed
- Welcome, dashboard, and composer polish; light-mode contrast fixes; a
  consolidated participant-health header for ensemble panels.

> 1.0.5 was an internal development milestone whose work rolled into 1.0.6.

## 1.0.4 — 2026-05-27

### Added
- **Ensemble mode** — run several coding agents as a panel with a chair /
  synthesizer, structured rounds, and per-participant review.
- **Work sessions** — grouped, resumable units of agent work.

## 1.0.3

### Added
- Local-first desktop workbench for running and reviewing coding-agent CLIs
  across multiple providers: workspace trust state, approval modes, activity
  timelines, command-output and status review, and run-scoped diff review.

---

See [`README.md`](README.md) for setup and [`SAFETY.md`](SAFETY.md) /
[`SECURITY.md`](SECURITY.md) for the safety and security boundaries.
