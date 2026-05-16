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

AGBench exposes a bundled MCP server (`agentbench`) that gives the
agent access to these tools when running in Gemini-CLI bridge mode:

- `run_shell_command` — workspace-scoped shell with approval gate.
- `write_file` — file write with approval gate + diff capture.
- `replace` — multi-edit semantics, approval gate.
- `read_file` — workspace-scoped read.
- `list_directory` — workspace-scoped tree listing.
- `delegate_to_subthread` — Phase F3, agent-driven sub-thread spawn.
  Inputs: `{ provider: 'gemini'|'codex'|'claude'|'kimi', prompt:
  string, returnResult?: boolean }`. Spawns a sub-thread under the
  current parent thread, fires a run on the chosen provider with the
  delegation prompt, returns immediately with the sub-thread id and a
  short status message. When `returnResult` is true (default), the
  sub-thread's final assistant message auto-appends to the parent
  transcript on completion (Phase F2 back-propagation).

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

  Typical agent use:

      Agent thinks: "This step needs sandbox-restricted CLI work that
      Codex handles best. Let me delegate."

      tools.delegate_to_subthread({
        provider: 'codex',
        prompt: 'Run `swift test` in this workspace and summarise the
                 first 5 failures, if any.',
        returnResult: true
      })

      → if approved: "Spawned codex sub-thread (id=...). Running in the
      background; its final result will append to this parent
      transcript on completion."

      → if declined: "Sub-thread delegation to Codex was declined by
      AGBench policy. Gemini continues without delegating; the user
      can change the policy in Settings → Behavior → Agentic Services
      → Sub-thread delegation."

      Agent then continues the parent turn with non-CLI work; the
      result auto-arrives later as a synthetic system message (only
      if the delegation was approved).

  v1 constraints:
    - Max depth 1 (sub-threads can't themselves delegate).
    - Workspace inherited from parent — no cross-workspace
      delegation in v1.
    - The sub-thread runs with `approvalMode: 'default'` and
      `model: 'cli-default'`. Future revs may expose the full
      composer surface as additional tool args.
    - **Phase I2: Codex agents now have access to the same MCP tool
      surface.** AGBench registers the `agentbench` MCP server with
      Codex CLI's `app-server` at spawn time via `-c
      mcp_servers.agentbench.*` config overrides, so Codex agents see
      `agentbench__delegate_to_subthread` (and the other 5 AGBench
      tools) in their tool list without any user setup. The bridge
      subprocess stamps `parentProvider='codex'` on every broker
      request (via `AGENTBENCH_PARENT_PROVIDER` env), so the approval
      modal reads "Codex wants to delegate to Claude" and the
      workspace grant applies to Codex specifically — Gemini's grant
      doesn't auto-allow Codex delegation in the same workspace.
    - **Phase I3 / I4 (deferred):** Claude / Kimi agents will get the
      same tool surface. The approval-gate + broker plumbing is
      already provider-agnostic; only the CLI-side MCP registration
      remains.

Future MCP additions:

- `read_subthread_result` — pull the latest assistant message from a
  named sub-thread (for explicit polling, complementing F2's auto-
  propagation).

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
documented:

- Sub-threads (Phase F1) — landed
- Approval flow + timeout policy (Phase E1)
- Approval ledger UX (Phase E2)
- Remote (iOS) state including iPad-full and Tailscale (Phase D2 + E3)
- MCP tool surface (existing + planned)

Sections deferred for future:

- Sub-thread MCP tool contract (Phase F2)
- Auto-orchestration / planner agent (Phase F3)
- Live Activities surface (separate phase)
