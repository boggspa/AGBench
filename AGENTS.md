# AGENTS.md — environment notes for coding agents working inside AGBench

This file documents the AGBench (GUIGemini) runtime environment for any
agent — Gemini, Codex, Claude, Kimi, or otherwise — operating inside a
chat thread. It's meant to be read by the LLM at the start of a session
(via a system-prompt injection or MCP context exchange) so the agent
understands what affordances it has and how to use them.

If you're a human, this is also a useful map of the product surface.

---

## Environment summary

AGBench is an Electron desktop app that runs coding agents in isolated
chat threads against workspaces. Each thread:

- Is bound to a single provider (gemini / codex / claude / kimi).
- Targets a single workspace (or runs in "global" scope without one).
- Has its own provider session, message history, run state, and
  approval policy.
- Lives under a workspace in the sidebar topology.

The desktop hosts the runtime; an iPhone / iPad companion app can pair
to it and remote-control approvals + start new turns when the user is
away.

### Gemini runtime (Phase M1)

Gemini chats run via one of two runtimes:

- **API path (in-process)** via `@google/genai` — preferred. Streams
  text, supports the full AGBench MCP tool surface via Gemini function
  calling, replays prior turns for multi-turn continuity, attaches
  images as `inlineData` (≤20MB) or via `files.upload` (larger). Runs
  entirely inside the Electron main process; no child CLI is spawned.
- **CLI path** via the `gemini` binary — legacy fallback. Stays
  available for OAuth-only profiles until a follow-up phase wires
  OAuth into the API path. The `gemini` CLI is on a ~30-day
  deprecation track (replaced by vendor-locked Antigravity that drops
  MCP/ACP), so users with an API key configured should let the API
  path become the default.

Selection is controlled by `settings.geminiApiRuntime`:
- `auto` (default) — use API when an api-key profile is selected, else CLI
- `always` — force API (run fails without an API key)
- `never` — force CLI

Approval gates, audit events, durable run events, and `recordUsage`
quota tracking all work identically across both runtimes — the API
path calls into the same `executeGeminiMcpTool` host that the CLI's
MCP bridge subprocess calls back into.

---

## Sub-Threads (Phase F1) — multi-provider delegation

AGBench supports **sub-threads**: a thread can spawn child threads
that run on a *different* provider while remaining topologically linked
under the parent in the workspace tree.

The intent is cross-provider orchestration. Common patterns:

- A long-context **Claude** thread hands the noisy CLI work off to a
  **Codex** sub-thread, then continues planning while Codex runs.
- A **Gemini** project-aware thread delegates a careful diff edit to
  a **Claude** sub-thread.
- A **Codex** runtime delegates "research this codebase" reading work
  to a **Gemini** sub-thread (large context window).

### How it appears in the UI

1. The user (or, in future revs, the parent agent itself) opens a
   chat and clicks the **↪ delegate** affordance on a parent thread
   in the sidebar.
2. A modal asks: provider, delegation prompt, "return result on
   completion?" toggle.
3. On confirm, AGBench creates a new sub-thread:
   - Inherits the parent's workspace.
   - Records `parentChatId` + `delegationContext` (parent provider,
     delegation prompt, return-result flag, timestamps).
   - Navigates the user to the new sub-thread with the composer
     pre-filled by the delegation prompt.
4. The sidebar renders the sub-thread indented under the parent with
   a `↳` glyph.

### How it appears in the data model

`ChatRecord` gains two optional fields:

```typescript
parentChatId?: string;          // present on sub-threads only
delegationContext?: {
  createdAt: number;
  parentProvider: ProviderId;
  delegationPrompt: string;
  returnResultToParent: boolean;
  resultReturnedAt?: number;    // set when F2+ propagates back
};
```

Sub-threads do **not** share context with their parent — each is its
own isolated provider session. The delegation prompt is the only thing
that bridges across; everything beyond that is what the user (or the
sub-thread's agent) types in.

### Phase F1 invariants (still in force)

- **Max depth = 1.** A sub-thread cannot itself spawn a sub-thread.
  The UI affordance is hidden and the store rejects attempts. Future
  revs will lift this with ladder semantics.
- **Workspace inheritance.** Sub-threads default to the parent's
  workspace. Users can override per-spawn (future UI), but the data
  model already supports it via the optional `workspaceId` /
  `workspacePath` overrides on `AppStore.createSubThread`.

### Phase F2 — auto-propagation of sub-thread results

When `returnResultToParent: true` was selected at spawn time AND the
sub-thread's run completes successfully, the sub-thread's final
assistant message is automatically appended to the parent transcript
as a synthetic `role: 'system'` ChatMessage with:

```
↩ Result from <Provider> sub-thread (<title>):

<final assistant message content>
```

The synthetic message carries `metadata.kind = 'subThreadReturn'`
and a back-pointer (`subThreadId`, `subThreadProvider`,
`subThreadTitle`) so a future renderer can show a "view sub-thread"
affordance. Propagation is idempotent — `delegationContext.resultReturnedAt`
is set on the sub-thread record and the helper short-circuits on
re-invocation.

The trigger is the run-completion event from `RunManager.onChange`.
Failed or cancelled sub-thread runs don't propagate (the parent
agent should infer "no answer came back" and respond accordingly).

A `subthread_returned` durable run-event is written under the
**parent** chat for audit.

### How a parent-thread agent should think about delegation

For now, the parent agent doesn't trigger delegation directly — the
user clicks the button. But the parent agent **can** suggest delegation
in its response, e.g.:

> "This step requires running `swift build` repeatedly. I'd recommend
> delegating it to a **Codex** sub-thread so the CLI work doesn't burn
> through this thread's context window. Click the ↪ delegate button on
> this chat to spawn it."

In Phase F2 the parent agent will be able to invoke delegation via an
MCP tool call: `agbench__delegate_to_subthread({ provider, prompt,
returnResult })`. When that ships, this section will document the tool
contract; for now, it's UI-only.

### Audit trail

Each spawn writes a `subthread_spawned` durable run event under the
parent chat with `{ subThreadId, provider, delegationPrompt,
returnResultToParent }`. Each future result-propagation will write a
matching `subthread_returned` event. The Approval Ledger panel doesn't
surface these — they go to the run-event store, which is the
broader-scope audit log.

---

## Ensemble mode (1.0.3) — multi-provider in a single thread

Ensemble chats put multiple providers in the **same** thread (vs
sub-threads which are isolated). Each chat has up to 6 named
participants with their own provider + model + permission preset +
role. Participants take turns speaking in `order` ascending; each
participant sees the full transcript so far (their own messages +
every other participant's messages + user prompts).

If you're an agent operating inside an Ensemble chat, this affects
you in three concrete ways:

### 1. You're not the only voice in this thread

The transcript includes other participants' messages stamped with
`metadata.ensembleProvider` / `ensembleRole` / `ensembleModel`.
Treat them as peers, not as the user. They may disagree with you,
build on your work, or yield back to you.

### 2. You can hand off the turn deliberately

Call `ensemble_yield({ reason?, target? })` when you want to pass
the current turn to another participant. Three ways to pick a
target:

- **By role** (recommended): `ensemble_yield({ target: 'Planner',
  reason: 'Need a high-level plan before I implement.' })`.
- **By provider**: `ensemble_yield({ target: 'codex' })`.
- **By model alias** (1.0.3): `ensemble_yield({ target: 'GPT 5.5' })`
  / `{ target: 'Sonnet 4.7' }` / `{ target: 'Flash Lite' }` /
  `{ target: 'Kimi K2.6' }`. Multi-word model names are supported —
  the resolver matches across spaced + hyphenated forms.

If `target` doesn't resolve, the round falls through to default
ordering. `reason` is included in the audit trail.

### 3. You can call another participant in-line via @-mention

If your assistant message contains `@Role` / `@provider` /
`@ModelName` (matching the same alias resolver as `ensemble_yield`),
AGBench's orchestrator promotes that participant to speak next OR
appends them an extra turn if they've already spoken this round.
First match wins; subsequent `@-mentions` in the same message are
ignored. Self-mentions are filtered (you can narrate "I, Codex,
think…" without looping yourself back to the front).

```
"@Reviewer can you sanity-check this diff before I commit?"
→ Reviewer participant gets the next turn.
```

This is the lower-friction way to invite collaboration — yield is
explicit, mention is conversational.

### Turn-bound vs Continuous mode

Each ensemble has a `orchestrationMode`:

- **Turn-bound** (default) — each enabled participant speaks ONCE
  per round. After everyone speaks, the round ends and the user
  is prompted for the next user turn.
- **Continuous** — participants can keep handing off (via yield or
  @-mention) until either someone explicitly "returns to user"
  (replies without a yield + without an @-mention) or the
  `maxContinuationHops` budget is exhausted (default 6).

The user picks the mode via the composer's Turn / Continuous chip.
If the round is currently running, the toggle reflects the active
round's mode (not editable mid-round).

### Same-provider participants (1.0.3+)

Ensembles can include MULTIPLE participants of the same provider
running DIFFERENT models — e.g. one `claude-sonnet-4-7` + one
`claude-opus-4-7` working alongside each other. Each has a stable
participant id, so the orchestrator can dispatch them independently.
This is why the model-name @-tagging (above) matters: `@Sonnet 4.7`
disambiguates from `@Opus 4.7` even though both are Claude.

### Asking the user mid-round

Use `ask_user_question` (see MCP section below) when you need a
decision before continuing. The modal appears, the round PAUSES on
your turn (other participants don't get bumped forward), and the
answer comes back as your tool result. If the user dismisses, treat
it as "skip" and continue rather than retrying.

---

## Approval flow

When an agent attempts a tool call that AGBench's permission policy
flags as needing approval (e.g. `run_shell_command`, file edits
outside the workspace, MCP elicitations):

1. The runtime pauses the turn and emits an approval request to the
   desktop UI + any paired iOS device (via APNs push, gated by an
   idle detector — pushes only fire when the user is away from the
   desktop).
2. An auto-deny timer arms in parallel (per-provider defaults: Codex
   30s, Claude/Gemini 120s, Kimi 60s; user-tunable in Settings →
   Behavior).
3. The first responder wins — desktop modal, iOS reply, or timer.
4. A decision is written to the durable Approval Ledger (Settings →
   Approval Ledger) including `decisionSource` (`'user'` vs
   `'system'` for timer auto-deny) and timestamp metadata.

Agents should expect timeouts as a normal outcome. If a tool call
pauses for approval and you receive a denial / cancellation a moment
later, the user may simply have been away when the timer fired — surface
the situation gracefully and offer to retry once the user is back.

---

## Remote (iOS) state

A paired iPhone or iPad can:

- **iPhone (minimal):** view the active transcript, approve/deny
  pending tool calls, send a new prompt to an existing thread,
  start a new thread from a small set of templated prompts.
- **iPad (desktop-parity):** everything iPhone does, plus a full
  three-pane shell with sidebar / transcript / approvals inspector
  and a read-only diff inspector.

When you're running on a thread that may be observed by an iOS device,
nothing changes from the agent's perspective — the bridge is transparent.
But if the user explicitly says "I'm on my phone, keep responses short"
or similar, that's a real signal and the agent should adapt.

The iOS connection can be over LAN (when both devices share Wi-Fi) or
over Tailscale (when off-LAN). The Mac advertises both endpoints at
pairing time.

---

## MCP

AGBench exposes a bundled MCP server (`AGBench`) that gives every
provider's agent (Gemini / Codex / Claude / Kimi as of 1.0.3) access
to the same tool surface. The canonical list lives in
`src/main/AgentbenchMcpTools.ts` (`AGENTBENCH_MCP_TOOLS`); the most
relevant tools an agent reaches for during day-to-day work:

**Workspace I/O (workspace-scoped, approval-gated when policy
demands):**

- `run_shell_command` — workspace-scoped shell.
- `write_file` — file write with diff capture.
- `replace` — multi-edit semantics.
- `read_file` — workspace-scoped read.
- `list_directory` — workspace-scoped tree listing.
- `workspace_search` — grep across the workspace tree.
- `workspace_symbols` — language-aware symbol lookup.
- `apply_patch` — diff/patch application.
- `git_status` / `git_diff` / `git_stage` / `git_commit` — git
  surface routed through the same approval gate as `run_shell_command`
  so the user sees the staged hunks before they land.

**Delegation + orchestration (1.0.3 expansion):**

- `delegate_to_subthread` — Phase F3 agent-driven sub-thread spawn,
  with **Phase J2 recall mode**.
  Inputs: `{ provider: 'gemini'|'codex'|'claude'|'kimi', prompt:
  string, returnResult?: boolean, subThreadId?: string }`. By default
  (when `subThreadId` is omitted) the call spawns a fresh
  context-isolated sub-thread under the current parent. The
  tool_result includes the sub-thread id; pass that id as
  `subThreadId` on subsequent calls to **continue the same
  sub-thread** instead of spawning a new one — useful when you want
  back-and-forth conversation with a single delegated agent across
  multiple turns.

  Recall validates strictly: the id must belong to a sub-thread of
  THIS parent AND match the requested `provider` AND not be archived.
  Mismatches return a structured error tool_result and dispatch
  nothing. When recall succeeds, AGBench injects the sub-thread's
  linked provider session id into the dispatched run so the target
  provider's native session resumes (Codex `thread/resume`, Claude
  SDK `resume:` / CLI `--resume`, Kimi `--resume`, Gemini `--resume`).
  If the recalled sub-thread hasn't completed its first turn yet, the
  transcript still continues at the AGBench chat level but the
  provider runtime starts a fresh session — the tool_result includes
  a `Note:` line so you know.

  When `returnResult` is true (default), the sub-thread's final
  assistant message auto-appends to the parent transcript on
  completion (Phase F2 back-propagation) — works for both spawn and
  recall paths.

  **Approval gate (Phase I1):** every call routes through AGBench's
  `subThreadDelegation` agentic-service policy before any sub-thread
  is created. The user's workspace policy decides:

    - `'ask'` (default) → user sees a modal showing parent provider +
      target provider + the delegation prompt preview, then clicks
      Accept / Allow for session / Allow for workspace / Decline.
      Nothing spawns until the user clicks.
    - `'workspace'` → first call prompts; subsequent calls in the
      same workspace auto-approve until the workspace grant is
      revoked.
    - `'allow'` → silent auto-approve for all delegations in the
      workspace.
    - `'deny'` → silent auto-decline; tool_result returns an error.

  **What this means for the agent:** treat the tool call as something
  that might be DECLINED. Always check the tool_result for
  `isError: true`; if declined, surface the decline gracefully to
  the user (don't loop / retry) and continue the parent turn without
  delegating. The decline text explains how the user can adjust
  policy if they want.

  Typical agent use — first call (spawn):

      Agent thinks: "This step needs sandbox-restricted CLI work that
      Codex handles best. Let me delegate."

      tools.delegate_to_subthread({
        provider: 'codex',
        prompt: 'Run `swift test` in this workspace and summarise the
                 first 5 failures, if any.',
        returnResult: true
      })

      → if approved: "Spawned codex sub-thread (id=abc-123). Running
      in the background; its final result will append to this parent
      transcript on completion.
      Reuse this id by passing subThreadId="abc-123" on the next
      delegate_to_subthread call if you want to continue the
      conversation with this same sub-agent."

      → if declined: "Sub-thread delegation to Codex was declined by
      AGBench policy. Gemini continues without delegating; the user
      can change the policy in Settings → Behavior → Agentic Services
      → Sub-thread delegation."

      Agent then continues the parent turn with non-CLI work; the
      result auto-arrives later as a synthetic system message (only
      if the delegation was approved).

  Recall — second call (continue the SAME sub-thread):

      Agent thinks: "The Codex sub-thread reported 2 failing tests.
      I want to ask it for the full stack of the second failure
      without losing its context."

      tools.delegate_to_subthread({
        provider: 'codex',
        subThreadId: 'abc-123',
        prompt: 'Show me the full stack trace and the failing
                 assertion line for failure #2.',
        returnResult: true
      })

      → "Continued codex sub-thread (id=abc-123). Sent your prompt as
      a follow-up turn; the next assistant message will append to this
      parent transcript on completion."

  Use spawn when you want a fresh context-isolated sub-agent (e.g.
  parallel tasks where each sub-thread should focus on one thing).
  Use recall when you're conversing back-and-forth with one delegated
  sub-agent across multiple turns (e.g. asking a clarifying question
  about a previous result).

  v1 constraints:
    - Max depth 1 (sub-threads can't themselves delegate).
    - Workspace inherited from parent — no cross-workspace
      delegation in v1.
    - The sub-thread runs with `approvalMode: 'default'` and
      `model: 'cli-default'`. Future revs may expose the full
      composer surface as additional tool args.
    - **Phase I2-I4 (landed by 1.0.3): all four providers have the
      same MCP tool surface.** AGBench registers the `AGBench` MCP
      server with each provider's runtime at spawn time:
        - **Gemini** — via the AGBench MCP bridge (CLI) or function
          calling (API path).
        - **Codex** — via `-c mcp_servers.AGBench.*` overrides on
          the `app-server` invocation.
        - **Claude** — via the Claude Agent SDK's `mcpServers`
          option (SDK path) or `--mcp-config <path>` (CLI fallback).
          1.0.3 sets `alwaysLoad: true` on the server entry so the
          SDK doesn't gate tools behind a `ToolSearch` round-trip
          on first use (critical for plan-mode latency).
        - **Kimi** — via Kimi Wire's MCP bridge subprocess.
      Each bridge subprocess stamps `AGENTBENCH_PARENT_PROVIDER` on
      its env so the approval modal reads "Claude wants to delegate
      to Codex" and workspace grants apply per-provider — Gemini's
      grant doesn't auto-allow Codex delegation in the same workspace.

- `ensemble_yield(reason?, target?)` — used inside Ensemble chats
  (multi-provider single-thread, see "Ensemble mode" section below)
  to explicitly pass the current participant's turn to the next
  participant. `target` names a participant by id / provider /
  role / model alias. Round continues; user input is not required.
  Universal MCP tool — every provider has access.

- `ask_user_question(question, options?, context?)` — **1.0.3
  critical surface.** Pauses the agent's turn and surfaces a modal
  card to the user with the question + button options (or free-text
  fallback). Returns the user's answer as the tool result so the
  agent can continue. Use this whenever you need a decision from
  the user before proceeding — for plan-mode clarifications, design
  choices, any branch point that depends on user intent.
  STRONGLY preferable to emitting the question as inline prose
  because the user gets a focused, dismissable modal with buttons
  instead of having to type a free-text reply. If the user dismisses,
  the tool returns `cancelled: true`; treat that as "skip this step"
  and continue rather than looping.

- `read_subthread_result` / `list_subthreads` / `cancel_subthread` —
  inspect + cancel sub-threads spawned via `delegate_to_subthread`.

- `agent_delegation_role`, `create_handoff_card`,
  `switch_auth_profile`, `approval_status`, `provider_auth_status`,
  `run_timeline`, `raw_provider_events`, `open_workspace_file`,
  `open_in_ide`, `open_in_ide_at_position`, `reveal_in_finder`,
  `ide_app_status`, `ide_app_capabilities`, `list_running_ides` —
  meta / introspection / editor-handoff tools (Phase L).

- `attached_window_capture`, `attached_window_status`,
  `appwatch_start`, `appwatch_stop`, `appwatch_status`,
  `appwatch_latest_frame`, `appwatch_frames` — Phase M attached-
  window screen capture for GUI-driven debug + design work.

- `creative_app_status`, `creative_app_capabilities`,
  `creative_project_snapshot`, `creative_timeline_validate`,
  `creative_timeline_ir`, `creative_timeline_diff`,
  `creative_timeline_import`, `creative_applescript_dispatch`,
  `creative_blender_python`, `creative_midi_dispatch` — Phase K
  creative app tools (Final Cut Pro / Logic Pro / Blender).

---

## What an agent should know but can't directly see

- **Approvals are per-action, not per-session.** A grant given for one
  command doesn't carry to the next unless the user explicitly chose
  "Allow for session" or "Allow for workspace".
- **The workspace allowlist gates iOS-initiated runs.** A turn started
  from an iPhone against a workspace not on the allowlist is rejected
  by the bridge router regardless of the agent's intent.
- **The runtime profile** (binary path, env, MCP profile) is per-thread
  state set at thread creation. If a user wants to change runtime, they
  spawn a new thread or sub-thread.
- **Durable storage is on.** Settings → Behavior controls whether chat
  history is persisted to disk; if it is, the run events, approval
  ledger, and chats survive restarts.

---

## Versioning

This document is updated as features ship. Sections currently
documented (as of **1.0.3**):

- Sub-threads (Phase F1 + F2 back-propagation + F3 agent-driven
  delegation + J2 recall mode) — landed
- **Ensemble mode (1.0.3)** — multi-provider single-thread, with
  ensemble_yield + @-mention auto-promotion + same-provider
  participants + turn/continuous modes
- Approval flow + timeout policy (Phase E1)
- Approval ledger UX (Phase E2)
- Remote (iOS) state including iPad-full and Tailscale (Phase D2 + E3)
- **MCP tool surface** — full canonical list in
  `src/main/AgentbenchMcpTools.ts`; key tools documented above
  (including the 1.0.3 additions `ensemble_yield` +
  `ask_user_question`).
- All four providers (Gemini / Codex / Claude / Kimi) now share the
  same MCP tool surface (Phase I2-I4 landed at 1.0.3)

Sections deferred for future (1.0.4+):

- **Phase N — async / sleeping orchestration** (see
  `docs/PHASE-N-ASYNC-ORCHESTRATION.md`): `schedule_wakeup` MCP
  tool, `sleeping` participant status, WakeupTimerService.
- **Parallel / concurrent ensemble execution** — Phase N+1; the
  natural follow-on to async. Spec axis: turn-bound → @-tag
  promoted → wake-driven async → concurrent parallel.
- **PO1 / PO2 — File Editor + Diff Studio popout windows** — see
  `docs/1.0.3-SHIP-HANDOFF.md` for scope.
- Live Activities surface (separate phase).
