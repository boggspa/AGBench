# Changelog

Notable changes to TaskWraith, the local-first macOS desktop workbench for running
and reviewing AI coding agents. Entries are user-facing highlights; execution,
history, and workspace state stay on your machine throughout.

## 1.2.0 — 2026-06-07

### Added
- **iMessage bridge (Messages.app).** Bind an iMessage conversation to a TaskWraith
  chat: inbound messages route to the agent (with trigger-prefix rules and duplicate
  suppression) and replies are sent back through Messages.app. Includes a Messages
  settings panel (bindings, conversation browser, audit log, test send, polling), a
  permission-helper popout for the macOS Automation grant, and an append-only audit
  log. Messages are read locally (read-only) and sent via Messages.app automation —
  no Apple credentials or private protocols.
- **First-class side chats.** Side chats are now durable and flexible — pop one out
  into its own window, dock it back, or promote it to a top-level chat, with draft
  text, scroll position, and presentation preserved across the move.
- **Approval-mode elevation failsafe.** Raising a chat's permission mode now asks
  first: a one-time notice per workspace when you enable Default Approval, and a
  sterner "only on disposable VMs or recoverable devices" confirm each time you
  enable Full Workspace Access. The acknowledgement is recorded in the approval ledger.
- **Smarter ensemble defaults.** A new ensemble seeds one participant per provider
  you actually have set up, instead of all six.
- **Windows testing installer.** Unsigned x64 + arm64 Windows installers are now
  produced on demand and attached to releases — a testing channel ahead of signed builds.

### Changed
- **Clearer MCP surface.** Settings → MCP no longer mislabels working providers:
  Cursor shows its TaskWraith web bridge (web_fetch + web_search) and Grok shows
  provider-managed status, replacing the misleading "unsupported / not installed" tags.
- **Tidier README.** Screenshots are now a grid instead of a long stack.

### Fixed
- **Grok no longer dead-ends.** A write/Default-mode Grok turn that reached for a
  shell command (e.g. `mkdir`) could cancel with no output; Grok is now steered to the
  Write/Edit tools and to adapt rather than end the turn when a tool is refused.
- **Windows CI launch smoke** now passes on the windows-latest runner.
- Side-chat composer, above-row, and presentation-lifecycle fixes.

### Security
- **Untrusted-input hardening.** External iMessage content is wrapped and replayed to
  the model as untrusted; IPC validation, shell-open policy, and prompt-composition
  sanitizers were extended for the new message surface.

## 1.1.0 — 2026-06-06

### Added
- **First-class workspace rows.** Every connected workspace row (primary and
  additional) now carries the full action set — Review changes → Push → Create PR
  + commit — scoped to that folder, with a compact read/edit access icon.
- **Adjustable ensemble history.** A shared-history budget slider (5K–500K
  characters) in the ensemble Turn picker controls how much recent panel context
  each agent sees.
- **Ensemble mode picker.** Turn / Continuous / Work Session moved into a
  hierarchical picker (matching the model picker); Fan-out (parallel read-only
  lanes) stays a separate toggle beside it.
- **Resizable side chat.** The side-chat split view resizes by drag or keyboard,
  with per-chat width persistence.
- **Top-center pop-out controls.** Diff Studio / File Editor / pop-out chat sit
  in their own glass pill row; the corner control pills are larger (1.6×) with a
  blurred backdrop.

### Changed
- **Provider-tinted composer pills.** Gemini (blue) and Kimi (olive) controls now
  carry the provider highlight; the native and other shells drop the redundant
  outer pill chrome for a cleaner row.
- **More transcript breathing room.** The clearance below the last message scales
  with the live composer height, so dense ensemble / multi-workspace composers
  never overlap the most recent message.

### Fixed
- **Grok no longer stalls.** A write-enabled Grok turn that ran a shell command
  was cancelling with no output; write mode now allows Bash, and read-only turns
  get a steer so they answer directly instead of dead-ending.
- **Ensemble context.** The shared transcript now keeps the most-recent messages
  when it has to truncate, and the default turn count is consistent.
- **Live usage meters.** Sidebar and settings usage totals refresh the moment a
  run finishes instead of going stale.
- **Kimi light mode + changelog rendering polish.**

## 1.0.75 — 2026-06-05

### Fixed
- **No more runaway background processes.** Fixed a loop where leftover Gemini
  MCP bridge registrations from before the rename could relaunch the app
  repeatedly in the background. Bridge detection is now rename-proof, and stale
  registrations are cleaned up automatically on launch.

## 1.0.74 — 2026-06-05

### Changed
- **AGBench is now TaskWraith.** The app is renamed end to end — name, icon,
  bundle ID, updater, MCP services, and docs. Your existing data carries over
  automatically on first launch: chats, settings, usage history, and saved state
  are migrated from the previous install.
- **Git-grounded workspace status.** The composer's "N files changed / +A −B"
  now reflects the real working tree via Git instead of tallying a thread's tool
  activity — so it drops to 0 the moment you commit, the way Codex/Claude desktop
  apps behave. Applies to the primary workspace and every additional workspace.
- **One clean row per additional workspace.** Adding a secondary/tertiary folder
  now shows a single native row per folder (with a combined read/edit access
  pill) instead of one row per participating provider, and revoking removes the
  whole folder in a click.

### Added
- **Push from the composer.** The Review changes menu now has a Push step
  between commit and Create PR — publish a new branch (sets its upstream) or push
  ahead commits in a click — and the primary action button names the real next
  step (Review changes → Push → Create PR) from live Git state.
- **Branch state at a glance.** The composer branch chip shows a
  merge / rebase / cherry-pick badge and a conflict count when the tree is
  mid-operation, and the CI check rollup is now clickable (opens the PR or the
  failing run).

### Fixed
- **Delegation cards read as one agent.** Sub-agent cards and the inspector
  timeline are tinted with each agent's identity colour as a full rim, replacing
  the left-edge accent sliver.
- **Composer above-rows.** The Git-status row stacks correctly in every composer
  shell (including Codex's tucked-tab layout), and a transcript render crash from
  a missing snapshot field is fixed.

## 1.0.73 — 2026-06-04

### Added
- **Commit & open PRs from the composer** — the Review changes menu now drives a
  real Git flow: see your branch and changed files, write a message and Stage all
  & Commit, then Create PR once the branch is pushed and ready (gated on a live
  readiness check).
- **Clearer Ensemble cost & escalation** — each round shows real vs. estimated
  spend (a latency line + an "API-equivalent" badge on estimates), and the
  orchestrator's escalation signals surface inline, so a multi-seat panel's value
  is visible rather than guessed.
- **Optional "why?" on approvals** — attach a short intent note when you allow or
  deny an agent action; it's recorded in the approval ledger.

### Changed
- **Refined native composer** — the TaskWraith shell is now a cohesive console: the
  input sits in a framed module (solid black/white outer frame, theme-tone inner
  panel + provider rim, full-bleed and squared), the Ensemble / Create-PR / Steer
  rows match the same solid frame, and the permission picker sits up front beside
  the + button. Onboarding and Settings → Appearance previews reflect the new look.
- **Deleting a chat tidies up after itself** — removing a chat now also clears
  that chat's own run-forensic artifacts (and only those).

### Fixed
- **Kimi tool calls** — repeated calls coalesce into a single inline card that
  updates in place (instead of stacking) and now show the target filename,
  matching the other providers.
- **Bug Report Refinement** — tidied how the in-app reporter shows your workspace
  (now a friendly `~/…` label).
- Onboarding, empty states, the welcome dashboard, provider accent colours, and
  the Diff Studio / File Editor light themes all got polish + readability fixes.

## 1.0.72 — 2026-06-04

### Security
- **Read-only means read-only** — choosing "Plan / read-only" for a run is now a
  hard floor that nothing downstream can quietly loosen: full-auto can't override
  it, delegated sub-agents inherit it, and uncategorised tools fail closed. The
  posture is enforced identically across Gemini, Claude, Kimi, Codex, and Grok.
- **Grok joins the read-only contract** — Grok now runs under read-only through a
  scoped, fail-closed tool bridge that exposes only non-mutating (read / list /
  search) tools, with the host denying any write the agent attempts.

### Added
- **Read-only that's still useful** — read-only agents keep full read parity
  (list / read / search) without prompts, and the run surface explains what a
  read-only seat can and can't do, by tool class.
- **Welcome dashboard controls** — a compact dashboard mode plus Settings →
  Appearance controls for heatmap layout, with swipeable heatmap cycles and
  animated transitions.
- **Clearer onboarding** — consistent provider hover states, all six usage
  meters, and a one-line role flow.
- **Bug reports as pre-filled GitHub issues** — the in-app reporter now opens a
  ready-to-file issue.

### Changed
- **Denied writes stay honest** — a blocked or rejected edit is no longer counted
  or shown as an applied file change; it reads "attempted (not applied)", and a
  read-only agent is told its posture up front so a refused write doesn't
  dead-end the turn.
- **Steadier transcript** — the Ensemble transcript no longer fights your
  scroll-up, agent questions resolve exactly once, and a message that anchors an
  open prompt can't be deleted out from under it.
- **Sturdier Codex** — a bad `config.toml` is surfaced clearly, a newer Codex CLI
  warns instead of breaking silently, and resuming no longer trips on a
  non-standard thread id; retired models were removed from the picker.
- **Settings & sidebar persistence** — general settings and sidebar section
  collapse now persist across launches.

### Fixed
- Ensemble: the "interrupted checkpoint" prompt no longer re-fires on every
  message, and stale checkpoint cards were removed from the composer.
- The MCP tool broker is confirmed up before a Claude run starts, with start
  failures surfaced instead of silently degrading.

## 1.0.71 — 2026-06-02

### Added
- **Onboarding clarity** — the first-launch sheet now shows copyable official
  install commands for each provider CLI, a sign-in primer (terminal-login vs
  in-app OAuth vs API key), a status-dot legend, and new "You stay in control"
  and "Track your usage & spend" sections. The Ensemble preview shows all six
  providers.
- **"Out of usage" provider state** — a provider that's signed in but at 100% of
  its quota now says so (with the reset time) instead of looking broken, in both
  onboarding and Settings.

### Changed
- **Confirmations** — deleting a chat or removing a workspace now asks first.
- **Failed runs explain themselves** — the completion card shows the exit code
  and last error instead of a bare "check Raw Events"; cancelled runs read "Run
  cancelled" rather than "code 130".
- **Consistent copy feedback** — copy buttons across the transcript, diffs,
  inspector, and media paths now confirm with "Copied".
- **Clearer states** — empty states for the Raw Events tab and the model picker,
  a loading state for the Gemini MCP test, and a mention popover that no longer
  runs off-screen.
- **Truer copy & numbers** — corrected file-mention syntax (`-@`), a shell-aware
  permission-colour hint, humanised byte sizes, pluralised counts, and clearer
  Gemini profile labels.
- **Ensemble** — Work Session presets show which is active, completed sessions
  reopen as "Restart" instead of silently restarting, finished strips no longer
  say "0s left", and failed participants offer an inline retry.

### Accessibility
- Search is focusable with ⌘F; sidebar menus support arrow-key navigation; the
  onboarding sheet now traps focus and focuses its first control on open.

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
