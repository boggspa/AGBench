import type {
  ChatMessage,
  ChatRecord,
  EnsembleConfig,
  EnsembleParticipant,
  ProviderId,
  ToolActivity
} from './store/types'

const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: 'Gemini',
  codex: 'Codex',
  claude: 'Claude',
  kimi: 'Kimi'
}

const MAX_MESSAGE_CHARS = 4000
const MAX_TRANSCRIPT_CHARS = 24000
import { formatScoutBriefsForPrompt, type ScoutBriefRecord } from './ScoutBrief'

// 1.0.4-AR2 — mirror of the renderer ceiling
// (`EnsembleParticipantsAboveRow.MAX_ENSEMBLE_PARTICIPANTS`). Keep
// these two constants in sync; a divergence would let the renderer
// add a participant the prompt builder then silently truncates,
// confusing the user about why a participant they enabled never
// spoke.
const MAX_ENSEMBLE_PARTICIPANTS = 8

export interface BuildEnsemblePromptInput {
  chat: ChatRecord
  config: EnsembleConfig
  participant: EnsembleParticipant
  currentPrompt: string
  roundId: string
  chatContextTurns?: number
  /**
   * 1.0.4-AK6 — structured briefs recorded by participants during
   * a just-completed parallel scout pass. When present, the
   * prompt builder injects a "Scout briefs from the parallel pass:"
   * block above the recent-transcript section so the writer has
   * a coherent picture of the panel's read-only findings.
   *
   * Empty array (or undefined) skips the section entirely. The
   * orchestrator clears scout briefs at round-end so a subsequent
   * serial round doesn't re-use stale briefs.
   */
  scoutBriefs?: ScoutBriefRecord[]
}

export function getOrderedEnsembleParticipants(
  config: EnsembleConfig,
  currentPrompt = ''
): EnsembleParticipant[] {
  // 1.0.4-AR2 — clamp the per-chat cap into [2, MAX_ENSEMBLE_PARTICIPANTS].
  // Pre-AR2 the floor was `> 4` (i.e. anything ≤4 fell back to the global
  // cap), which broke users who deliberately tightened their panel to 3.
  // Now a numeric config value wins as long as it's a reasonable size;
  // garbage values (NaN / 0 / negative) fall back to the global cap.
  const rawMax = Math.floor(Number(config.maxParticipants))
  const maxParticipants = Number.isFinite(rawMax) && rawMax >= 2
    ? Math.min(MAX_ENSEMBLE_PARTICIPANTS, rawMax)
    : MAX_ENSEMBLE_PARTICIPANTS
  const enabled = (config.participants || [])
    .filter((participant) => participant.enabled)
    .sort((a, b) => a.order - b.order || providerLabel(a.provider).localeCompare(providerLabel(b.provider)))
    .slice(0, Math.max(1, maxParticipants))
  if (!currentPrompt || /@all\b/i.test(currentPrompt)) {
    return applyChairSummaryOrder(enabled, config)
  }

  const prompt = currentPrompt.toLowerCase()
  const mentioned = new Set<string>()
  for (const participant of enabled) {
    const provider = participant.provider.toLowerCase()
    const label = providerLabel(participant.provider).toLowerCase()
    const role = String(participant.role || '').toLowerCase()
    if (
      prompt.includes(`@${provider}`) ||
      prompt.includes(`@${label}`) ||
      (role && prompt.includes(`@${role.replace(/\s+/g, '')}`))
    ) {
      mentioned.add(participant.id)
    }
  }
  if (mentioned.size === 0) return applyChairSummaryOrder(enabled, config)
  return applyChairSummaryOrder([
    ...enabled.filter((participant) => mentioned.has(participant.id)),
    ...enabled.filter((participant) => !mentioned.has(participant.id))
  ], config)
}

function applyChairSummaryOrder(
  participants: EnsembleParticipant[],
  config: EnsembleConfig
): EnsembleParticipant[] {
  if (config.roundMode !== 'chair-summary' || !config.synthesizerParticipantId) {
    return participants
  }
  const idx = participants.findIndex(
    (participant) => participant.id === config.synthesizerParticipantId
  )
  if (idx < 0 || idx === participants.length - 1) return participants
  const next = [...participants]
  const [synthesizer] = next.splice(idx, 1)
  next.push(synthesizer)
  return next
}

export function buildEnsembleParticipantPrompt(input: BuildEnsemblePromptInput): string {
  const orderedParticipants = getOrderedEnsembleParticipants(input.config, input.currentPrompt)
  const participantLabel = `${providerLabel(input.participant.provider)} / ${input.participant.role || 'Participant'}`
  const orchestrationMode =
    input.config.orchestrationMode === 'continuous' ? 'continuous' : 'turn_bound'
  const maxContinuationHops = input.config.maxContinuationHops || 6
  const continuationHops = input.config.activeRound?.continuationHops || 0
  // 1.0.4 — speaker-position awareness. First + last participants
  // in a multi-participant turn-bound round get extra nudges so the
  // panel doesn't lopside: the opener scopes rather than executing
  // through (1.0.4-Y), and the closer knows there's nobody left to
  // yield to so they should address `@user` rather than reach for
  // ensemble_yield(target) and bounce the round off the end of the
  // rotation (1.0.4-AJ).
  //
  // Continuous-mode rounds don't have a fixed "last" speaker —
  // continuationHops budget keeps the round open until someone
  // explicitly returns to user — so the last-speaker marker is
  // skipped there. The continuous-mode rule line already nudges
  // toward "only request another handoff when more agent work is
  // genuinely useful" which covers that orchestration mode.
  const isMultiParticipantRound = orderedParticipants.length >= 2
  const selfIndex = orderedParticipants.findIndex(
    (participant) => participant.id === input.participant.id
  )
  const totalParticipants = orderedParticipants.length
  const positionOneIndexed = selfIndex >= 0 ? selfIndex + 1 : 0
  const isFirstSpeaker =
    isMultiParticipantRound && orderedParticipants[0]?.id === input.participant.id
  const isLastSpeaker =
    isMultiParticipantRound &&
    orchestrationMode === 'turn_bound' &&
    selfIndex === totalParticipants - 1
  // 1.0.4-AJ — continuous-mode hop-budget awareness. When the round
  // is in continuous mode and the running hop count is at-or-near
  // the cap, the closer can choose to close even though there's no
  // fixed final turn. Surface "X hops remaining" so the speaker can
  // weigh another yield vs. closing to user.
  const continuousHopsRemaining =
    orchestrationMode === 'continuous'
      ? Math.max(0, maxContinuationHops - continuationHops)
      : null
  const isContinuousNearCap =
    continuousHopsRemaining !== null && continuousHopsRemaining <= 1
  const roster = orderedParticipants
    .map((participant) => {
      const isSelf = participant.id === input.participant.id
      const isFirstInList = participant.id === orderedParticipants[0]?.id
      const isLastInList = participant.id === orderedParticipants[totalParticipants - 1]?.id
      // Position marker accompanies the "(you)" tag. First/last
      // markers give the model a contextual cue beyond the rule
      // lines further down — useful even when the participant
      // hasn't read the rules section closely. Middle slots in a
      // 3+ participant round get a bare position count.
      let marker = ''
      if (isSelf) {
        if (isFirstSpeaker && isFirstInList) {
          marker = ' (you — first speaker)'
        } else if (isLastSpeaker && isLastInList) {
          marker = ` (you — last speaker, position ${positionOneIndexed} of ${totalParticipants})`
        } else if (
          isMultiParticipantRound &&
          positionOneIndexed > 0 &&
          totalParticipants >= 3
        ) {
          marker = ` (you — position ${positionOneIndexed} of ${totalParticipants})`
        } else {
          marker = ' (you)'
        }
      }
      return `${participant.order}. ${providerLabel(participant.provider)} / ${participant.role || 'Participant'}${marker}`
    })
    .join('\n')
  const disambigNote = formatSameProviderDisambiguationNote(orderedParticipants)
  const selfReflective = Boolean(input.config.selfReflective)
  const workspaceStanza = formatWorkspaceStanza(input.chat, selfReflective)
  // 1.0.4-AR8 — when the workspace stanza is suspended (null), the
  // dependent deictic rule that references "Round subject:" is also
  // skipped. Either both ship together or neither does.
  const hasWorkspaceStanza = workspaceStanza !== null
  const sessionEventsStanza = formatSessionEventsStanza(input.config)
  const transcript = buildTaggedTranscript(input.chat.messages || [], input.chatContextTurns || 8)

  return [
    'AGBench Ensemble Mode',
    '',
    `You are ${participantLabel} in a serial moderated panel. One participant speaks at a time.`,
    `Round id: ${input.roundId}`,
    `Round policy: ${
      orchestrationMode === 'continuous'
        ? `Continuous. You may hand work to another participant with @mentions or ensemble_yield(target), capped at ${continuationHops}/${maxContinuationHops} extra handoffs this round.`
        : 'Turn-bound. Each participant speaks at most once; @mentions and ensemble_yield(target) only reorder participants who have not spoken yet.'
    }`,
    ...(workspaceStanza ? [workspaceStanza] : []),
    ...(sessionEventsStanza ? [sessionEventsStanza] : []),
    '',
    'Participant roster:',
    roster || '- No other enabled participants.',
    ...(disambigNote ? ['', disambigNote] : []),
    '',
    'Your role instructions:',
    sanitizeText(input.participant.instructions || 'Contribute a concise, useful response for your role.'),
    '',
    'Rules:',
    '- Everyone sees the same tagged transcript. @mentions are routing hints, not private messages.',
    '- If another participant should handle this turn, call ensemble_yield with a short reason and optional target.',
    '- In Continuous mode, only request another handoff when more agent work is genuinely useful; otherwise return control to the user.',
    '- Respect your permission preset. Read-only roles should not attempt file or shell mutations.',
    '- Respond as yourself only. Do not impersonate other participants.',
    // 1.0.4-AF — Plan/Ensemble precedence note. Ensemble Mode is an
    // orchestration mode; Plan Mode is a per-participant permission
    // posture. The two compose: if the user invokes Plan Mode for
    // this run, this participant must produce a plan rather than
    // execute, even though the surrounding ensemble round may include
    // other participants operating at their own permission presets.
    // Without this note, panelists were confused about whether a Plan
    // Mode invocation gates the entire round or only the speaker.
    '- Plan Mode and Ensemble Mode compose: Plan Mode is a per-participant permission posture (this run only); Ensemble Mode is the orchestration mode. If your approval mode is `plan`, respect the read-only posture even within an ensemble round — produce a plan, do not execute. Other participants may still operate at their default permission preset; their posture is not yours.',
    // 1.0.4-AF / AR8 — deictic-resolution rule. Three branches:
    //
    //  - Self-reflective (`/discuss` / `/meta`): orientation flips
    //    to AGBench itself; deictic phrases resolve to the harness.
    //    Workspace files stay readable but the conversation is
    //    meta-level. Rule always emitted.
    //  - Workspace-bound non-self-reflective: deictic phrases anchor
    //    to the bound workspace's Round subject. Always emitted.
    //  - No workspace + non-self-reflective (AR8 suspension): rule
    //    omitted entirely. Pre-AR8 we shipped a hybrid version with
    //    "ask the user which project they mean before assuming" that
    //    felt out-of-place in a conversational global chat. The
    //    participant can still naturally ask for context when they
    //    need it.
    ...(selfReflective
      ? [
          '- Deictic references ("this app", "this repo", "this project", "the codebase") refer to AGBench / the harness / this ensemble — the panel is in self-reflective mode (the user opened the round with `/discuss` or `/meta`). The bound workspace is incidental context; the conversation is about AGBench itself.'
        ]
      : hasWorkspaceStanza
        ? [
            '- Deictic references ("this app", "this repo", "this project", "the codebase") refer to the active workspace named in `Round subject:` above, NOT to AGBench / the harness / the ensemble itself. Discuss AGBench only when the user explicitly references it by name.'
          ]
        : []),
    // 1.0.4 — explicit `@user` handoff. Ends the round immediately
    // when the orchestrator sees it; bypasses participant
    // auto-promotion. Use when the speaker genuinely needs human
    // input vs. handing off to another panelist.
    '- To hand control back to the human and end the round, write `@user` (or `@human` / `@you`) inline. The orchestrator closes the round; no further participants speak this turn. Use this instead of `ensemble_yield()` when you want the conversation to wait on the user rather than progress through more agent turns.',
    // 1.0.4 — first-speaker scoping rule. Emitted ONLY when the
    // current speaker is opening a multi-participant round.
    // Addresses Chris's "agents dive in and leave nothing for the
    // panel" report: Codex / Claude tend to treat any prompt as
    // "execute through to completion" on turn 1, which forecloses
    // alternatives the other panelists might raise. Asking for
    // scope + direction before heavy execution gives the panel
    // breathing room. Skipped for solo-participant rounds and
    // for non-first speakers (who SHOULD execute once direction
    // is set).
    ...(isFirstSpeaker
      ? [
          '- You are SPEAKING FIRST in a multi-participant round. Scope the problem and propose a direction before doing heavy file editing or destructive operations. Later participants need room to weigh in with alternatives before execution lands. Reading + analysis is fine; large multi-file edits + deletes should wait for a follow-up turn unless the user explicitly asked for immediate action.'
        ]
      : []),
    // 1.0.4-AJ — last-speaker scoping rule. Mirror of the first-
    // speaker rule, addressing the "Gemini tries to yield to Codex
    // on its final turn and the yield fails → bounces back to user"
    // failure mode. Without this rule the final speaker had no way
    // to know they were last: they'd reach for `ensemble_yield(target:
    // ...)` thinking they were passing the baton, but in turn_bound
    // mode there's nobody after them in the rotation and the
    // orchestrator routes the failed yield back to the user. Now
    // the closer knows: no more participants are scheduled — either
    // close cleanly (final summary / observation / no extra agent
    // work needed) or use `@user` to ask a follow-up question. Risk
    // noted: agents could theoretically abuse turn-position
    // awareness to manipulate flow (e.g. always extending). User
    // will monitor over time; trust-but-verify.
    ...(isLastSpeaker
      ? [
          `- You are SPEAKING LAST in this turn-bound round (position ${positionOneIndexed} of ${totalParticipants}). No further participants are scheduled — \`ensemble_yield(target: ...)\` cannot route to another panelist this round. Either close with a final observation / summary / decision OR write \`@user\` if you have a question the user should answer next. Avoid attempting a participant yield that has nowhere to land.`
        ]
      : []),
    // 1.0.4-AJ — continuous-mode hop-budget awareness. When the
    // hop counter is near the cap, surface the remaining-hops count
    // so the speaker can decide whether to close gracefully vs.
    // hand off again. Skipped in turn_bound (rotation already
    // bounds the round) and skipped when there's plenty of budget
    // left (no signal needed yet).
    ...(isContinuousNearCap
      ? [
          `- Continuation-hop budget is nearly exhausted: ${continuousHopsRemaining} extra handoff${
            continuousHopsRemaining === 1 ? '' : 's'
          } remain before this round must return to user. Prefer closing cleanly to chaining another \`ensemble_yield()\` unless the work genuinely needs another agent turn.`
        ]
      : []),
    // 1.0.4-AK6 — scout briefs from a just-completed parallel pass
    // are surfaced above the recent transcript so the serial writer
    // can synthesise findings before responding. Skipped when no
    // briefs are available (non-Work-Session rounds, no scout pass,
    // empty pass with no briefs emitted).
    ...(input.scoutBriefs && input.scoutBriefs.length > 0
      ? ['', formatScoutBriefsForPrompt(input.scoutBriefs)]
      : []),
    // 1.0.4-AT8 — designated synthesizer instruction. When the
    // ensemble config names this participant as the synthesizer,
    // append a structured "summarise this round" suffix asking
    // for decisions / open risks / corrections / next action.
    // Lands once per participant per round; non-synthesizer
    // participants don't see this rule.
    ...(input.config.synthesizerParticipantId === input.participant.id
      ? [
          '',
          '- You are the designated SYNTHESIZER for this ensemble. After your normal response, append a structured summary block titled "Round summary:" containing four short lines: `Decisions:` (what was decided this round), `Corrections:` (any earlier panel claims this round needed to correct), `Open risks:` (unresolved concerns the user should know about), `Next action:` (what the panel recommends next). Keep each line under ~120 chars; this summary propagates to every participant in the following round.'
        ]
      : []),
    // 1.0.4-AR13 — round-mode instructions. `roundtable` is the
    // default and adds no extra rule (every participant speaks
    // normally). `targeted` is handled at the orchestrator level
    // (DM routing); we don't add a participant-side rule since
    // only the target is dispatched. `chair-summary` tells the
    // designated synthesizer to wait for all prior turns + then
    // recap, and tells the others to wrap up cleanly so the
    // chair has a coherent set to summarise. `rebuttal` asks
    // each participant to respond to the prior participant's
    // last paragraph rather than re-answer the user.
    ...formatRoundModeInstructions(input.config, input.participant.id),
    // 1.0.4-AT8 — prior round summary block. When the config has a
    // non-empty `lastRoundSummary` from the previous round's
    // synthesizer, prepend it so every participant sees the same
    // canonical picture of what already happened. Skipped on the
    // first round (no prior summary) and when the synthesizer is
    // unconfigured.
    ...(input.config.lastRoundSummary && input.config.lastRoundSummary.trim().length > 0
      ? [
          '',
          'Prior round summary (from the panel synthesizer):',
          sanitizeText(input.config.lastRoundSummary).slice(0, 2000)
        ]
      : []),
    '',
    'Recent tagged transcript:',
    transcript || '[No prior transcript]',
    '',
    'Current user request:',
    sanitizeText(input.currentPrompt),
    '',
    `Respond now as [${participantLabel}].`
  ].join('\n')
}

function formatSessionEventsStanza(config: EnsembleConfig): string {
  const events = (config.sessionActivityLedger || []).slice(-8)
  if (events.length === 0) return ''
  return [
    'Session events:',
    ...events.map((event) => {
      const time = formatSessionEventTime(event.timestamp)
      const actor = titleCase(event.changedBy)
      const target = event.target ? `${sanitizeText(event.target)}: ` : ''
      const transition =
        event.oldValue !== undefined || event.newValue !== undefined
          ? `${formatSessionValue(event.oldValue)} -> ${formatSessionValue(event.newValue)}`
          : ''
      const reason = event.reason ? ` (${sanitizeText(event.reason)})` : ''
      return `  ${time} - ${actor} ${target}${transition}${reason}`.trimEnd()
    })
  ].join('\n')
}

function formatSessionEventTime(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return 'time unknown'
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function formatSessionValue(value: string | null | undefined): string {
  const text = sanitizeText(value)
  return text || 'unset'
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * 1.0.4-AR7 — compact tool-trace summary line for the tagged
 * transcript context. Pre-AR7 the prompt builder dropped tool
 * messages entirely AND ignored each assistant message's
 * `toolActivities` array, so downstream participants saw only
 * the prose output of upstream turns and had to guess whether a
 * file was read, edited, or searched. That made it harder for the
 * panel to coordinate on multi-turn work.
 *
 * Format (one line, prepended to the message body):
 *
 *   (tools: read_file × 3 · edit × 2 · search × 1)
 *
 * - Aggregated by `toolName` so repeated calls collapse into a
 *   single entry with a count.
 * - Ordered by descending count, then alphabetically — most-used
 *   tools surface first.
 * - Capped at the first 6 distinct tool names; an "…(+N more)"
 *   suffix indicates truncation so the line stays a single visual
 *   row even on heavy tool-call turns.
 *
 * Exported for unit-testing in isolation; the trip through
 * `buildTaggedTranscript` is covered by the prompt-builder tests.
 */
export function formatToolTraceSummary(activities: readonly ToolActivity[] | undefined): string {
  if (!activities || activities.length === 0) return ''
  const counts = new Map<string, number>()
  for (const activity of activities) {
    // Skip truly unnamed activities — better to omit them entirely
    // than to inject a synthetic `tool` placeholder that confuses
    // the trace summary.
    const name = ((activity.toolName || activity.displayName || '') as string).trim()
    if (!name) continue
    counts.set(name, (counts.get(name) || 0) + 1)
  }
  if (counts.size === 0) return ''
  const ordered = Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    return a[0].localeCompare(b[0])
  })
  const HEAD = 6
  const head = ordered.slice(0, HEAD)
  const tail = ordered.length - head.length
  const segments = head.map(([name, count]) => (count > 1 ? `${name} × ${count}` : name))
  const suffix = tail > 0 ? ` · …(+${tail} more)` : ''
  return `(tools: ${segments.join(' · ')}${suffix})`
}

function buildTaggedTranscript(messages: ChatMessage[], contextTurns: number): string {
  const relevant = messages
    .filter((message) => message.role !== 'tool')
    .slice(-Math.max(1, contextTurns * 2))
  const lines: string[] = []
  let used = 0
  for (const message of relevant) {
    const tag = messageTag(message)
    const text = sanitizeText(message.content).slice(0, MAX_MESSAGE_CHARS)
    // 1.0.4-AR7 — surface a compact tool-trace summary on every
    // message that has one, prepended to the content so downstream
    // participants can see at a glance what tools were used to
    // produce the response. Pure prose messages (no tools) skip
    // the line so the transcript stays lean.
    const trace = formatToolTraceSummary(message.toolActivities)
    const body = trace ? `${trace}\n${text}` : text
    const line = `[${tag}]\n${body}`
    used += line.length
    if (used > MAX_TRANSCRIPT_CHARS) {
      lines.push('[Transcript truncated to fit Ensemble V1 context budget.]')
      break
    }
    lines.push(line)
  }
  return lines.join('\n\n')
}

function messageTag(message: ChatMessage): string {
  if (message.role === 'user') return 'User'
  if (message.role === 'assistant') {
    const provider = message.metadata?.ensembleProvider as ProviderId | undefined
    const role = typeof message.metadata?.ensembleRole === 'string' ? message.metadata.ensembleRole : ''
    if (provider) return `${providerLabel(provider)}${role ? ` / ${role}` : ''}`
    return 'Assistant'
  }
  if (message.role === 'error') return 'Error'
  return 'System'
}

/**
 * 1.0.4 — `Round subject:` stanza injected just below `Round policy:`
 * in the participant system prompt. Gives every participant a
 * grounded deictic antecedent for "this app / this repo / this
 * project" — without it, Claude (and likely other models with
 * heavy AGBench tool-schema context loaded) tend to resolve "this"
 * to the surrounding harness rather than the user's actual
 * workspace.
 *
 * The line takes one of three shapes:
 *
 *   - Workspace bound (the common case):
 *       `Round subject: <basename> (<path>)`
 *
 *   - No workspace bound (system / global chat):
 *       `Round subject: No workspace bound — ask the user to name
 *       the project before assuming.`
 *
 *   - Per-chat scope override (sub-thread inheriting a workspace
 *     but emitting `scope: 'global'`): still emits the bound form
 *     so the agent has the directory context.
 *
 * Origin: Claude/Explorer's introspective feedback after picking up
 * AGBench-meta context instead of the bound workspace in an
 * ensemble round. The user asked Claude for prompting-surface
 * suggestions and got back a four-point list — this implements its
 * top "highest ROI" recommendation. Round subject as a single
 * anchor line every participant reads identically.
 */
/**
 * 1.0.4-AR8 — meta-round suspension for non-workspace cases.
 *
 * `formatWorkspaceStanza` now returns `null` when there is no
 * workspace bound AND the round isn't self-reflective. The
 * `Round subject:` stanza is meta-round overhead that only earns
 * its keep when there's a project to anchor deictic references to;
 * in a genuine global / conversational chat ("what's the best
 * way to do X") it just injects noise + a "ask the user which
 * project they mean" rule that contradicts the conversational
 * intent.
 *
 * Caller logic: when this returns null, skip both the stanza
 * itself AND the dependent deictic rule. Self-reflective mode
 * is unaffected (always emits an AGBench-harness stanza), and
 * any workspace-bound case is unaffected.
 */
function formatWorkspaceStanza(chat: ChatRecord, selfReflective = false): string | null {
  if (selfReflective) {
    // 1.0.4-AF — self-reflective round. The panel is explicitly
    // discussing AGBench itself, so the workspace stanza calls that
    // out. The bound workspace (if any) is still mentioned for
    // context — agents may still cite paths from it — but the topic
    // anchor flips from "the user's project" to "the AGBench harness
    // / this ensemble surface".
    const path = (chat.workspacePath || '').trim()
    if (!path) {
      return 'Round subject: AGBench harness (self-reflective mode — `/discuss`). The panel is discussing AGBench itself. No external workspace is bound.'
    }
    const basename = path.replace(/\/+$/, '').split('/').pop() || path
    const home = process.env.HOME || ''
    const displayPath = home && path.startsWith(home) ? `~${path.slice(home.length)}` : path
    return `Round subject: AGBench harness (self-reflective mode — \`/discuss\`). The panel is discussing AGBench itself. Bound workspace (incidental context): ${basename} (${displayPath}).`
  }
  const path = (chat.workspacePath || '').trim()
  if (!path) {
    // 1.0.4-AR8 — suspended. No workspace + non-self-reflective =
    // conversational global chat, no project deictic anchor to
    // enforce. Caller skips the stanza and the dependent rule.
    return null
  }
  // Last path segment is the project name. `path.split('/').pop()`
  // would break on trailing slashes; use the regex form so a path
  // like `/Users/x/Documents/another-project/` still yields
  // `another-project`.
  const basename = path.replace(/\/+$/, '').split('/').pop() || path
  // Replace user home with `~` for compactness — doesn't reveal
  // the actual username in the prompt and matches the way the chat
  // sidebar displays workspace paths.
  const home = process.env.HOME || ''
  const displayPath = home && path.startsWith(home) ? `~${path.slice(home.length)}` : path
  return `Round subject: ${basename} (${displayPath})`
}

export function providerLabel(provider: ProviderId): string {
  return PROVIDER_LABELS[provider] || provider
}

/**
 * 1.0.4 same-provider disambiguation note injected just below the
 * participant roster.
 *
 * Real-world repro: an ensemble with "Codex / Brodex" and
 * "Codex / Chodex #2" both present. Kimi writes `@codex / Brodex —
 * you had the best view…` because that's the natural way to address
 * a Codex peer. The orchestrator's resolver picks ONE of the two
 * deterministically (ensemble order), but the model didn't know
 * that — it thought `@codex` was unambiguous. The user can't see
 * the routing choice until the wrong participant speaks.
 *
 * The fix: tell the dispatched agent up-front that same-provider
 * peers exist, list them, and suggest the explicit forms the
 * resolver supports (`@<role>` or `@<short-model>`). This shifts
 * the disambiguation burden from the user-facing transcript
 * (where the orchestrator can only emit a warning after the fact)
 * to the agent's prompt context (where the agent can pick the
 * explicit form on the first try).
 *
 * Returns `''` when no provider has 2+ enabled participants — the
 * single-provider-per-role ensembles (the 1.0.3 common case) see
 * no extra prompt overhead.
 */
export function formatSameProviderDisambiguationNote(
  participants: EnsembleParticipant[]
): string {
  const groups = new Map<ProviderId, EnsembleParticipant[]>()
  for (const p of participants) {
    const existing = groups.get(p.provider)
    if (existing) existing.push(p)
    else groups.set(p.provider, [p])
  }
  const dupGroups: { provider: ProviderId; participants: EnsembleParticipant[] }[] = []
  for (const [provider, list] of groups.entries()) {
    if (list.length >= 2) dupGroups.push({ provider, participants: list })
  }
  if (dupGroups.length === 0) return ''

  const lines: string[] = [
    'Note: this ensemble contains multiple participants from the same provider:'
  ]
  for (const { provider, participants: group } of dupGroups) {
    for (const p of group) {
      const role = (p.role || 'Participant').trim()
      const model = shortModelLabel(provider, p.model)
      const suffix = model ? ` (model: ${model})` : ''
      lines.push(`- ${providerLabel(provider)} / ${role}${suffix}`)
    }
  }
  // Build the suggestion line from the first duplicated group. Two
  // worked examples — role-name and model-id — match the alias forms
  // the resolver actually supports (see `EnsembleMentionAlias.ts`'s
  // `getParticipantAliases` for the canonical list).
  const first = dupGroups[0]
  const sample = first.participants[0]
  const sampleRole = (sample.role || '').trim()
  const sampleModel = shortModelLabel(first.provider, sample.model)
  const roleHint = sampleRole ? `\`@${sampleRole}\`` : ''
  const modelHint = sampleModel ? `\`@${sampleModel}\`` : ''
  const hints = [roleHint, modelHint].filter(Boolean).join(' or ')
  const providerName = first.provider
  lines.push('')
  lines.push(
    hints
      ? `When addressing a specific participant, use their role name or model identifier (e.g. ${hints}). Plain \`@${providerName}\` resolves to a single participant but the choice is non-deterministic across same-provider peers.`
      : `When addressing a specific participant, use an explicit identifier. Plain \`@${providerName}\` resolves to a single participant but the choice is non-deterministic across same-provider peers.`
  )
  return lines.join('\n')
}

/**
 * Best-effort short model label for the same-provider disambiguation
 * note. Mirrors the renderer's `composerChipFormat.shortModelName`
 * shape so the suggested explicit identifier matches what the user
 * sees in chip strips and per-message badges. Pure function with no
 * cross-process imports so the main side can call it freely.
 *
 *   - Codex (`gpt-5.5`, `gpt-5.4-mini`)       → `5.5`, `5.4 Mini`
 *   - Claude (`claude-opus-4-7-thinking`)     → `Opus 4.7`
 *   - Kimi (`kimi-k2.6`, `kimi-k2.6-thinking`) → `K2.6`
 *   - Gemini (`gemini-2.5-flash-lite`)        → `2.5 Flash Lite`
 *
 * Falls back to the raw model id when no per-provider pattern fits,
 * and to '' when the model is missing or the cli-default sentinel
 * (since "CLI Default" isn't a useful @-mention target).
 */
function shortModelLabel(provider: ProviderId, model: string | undefined): string {
  if (!model || model === 'cli-default') return ''
  const id = model.toLowerCase()
  if (provider === 'codex') {
    const match = id.match(/^gpt-([\d.]+)(.*)$/)
    if (match) {
      const version = match[1]
      const suffix = match[2]
        .replace(/^-/, '')
        .split('-')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
      return suffix ? `${version} ${suffix}` : version
    }
  }
  if (provider === 'claude') {
    const match = id.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/)
    if (match) {
      const family = match[1].charAt(0).toUpperCase() + match[1].slice(1)
      return `${family} ${match[2]}.${match[3]}`
    }
  }
  if (provider === 'kimi') {
    const match = id.match(/^kimi-(k[\d.]+)/)
    if (match) return match[1].toUpperCase()
  }
  if (provider === 'gemini') {
    const match = id.match(/^gemini-(.+)$/)
    if (match) {
      return match[1]
        .split('-')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
    }
  }
  return model
}

function sanitizeText(value: unknown): string {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

/**
 * 1.0.4-AR13 — round-mode instruction builder.
 *
 * Returns an array of zero or more rule lines describing the
 * current round's structure for the calling participant. The
 * caller spreads the return into the larger rules array so the
 * default (`'roundtable'`) and unknown modes contribute
 * nothing and the prompt stays lean.
 *
 * Exported so the prompt-builder unit tests can pin the lines
 * each mode produces in isolation.
 */
export function formatRoundModeInstructions(
  config: EnsembleConfig,
  currentParticipantId: string
): string[] {
  const mode = config.roundMode || 'roundtable'
  if (mode === 'roundtable' || mode === 'targeted') {
    // `roundtable` is the implicit default — no extra rule.
    // `targeted` is enforced at the orchestrator level (only
    // the named participant gets dispatched), so a
    // participant-side rule would just be noise.
    return []
  }
  if (mode === 'chair-summary') {
    const isSynthesizer = config.synthesizerParticipantId === currentParticipantId
    if (isSynthesizer) {
      return [
        '',
        '- Round mode: CHAIR-SUMMARY. You speak last as the chair. Wait until every other participant has spoken; then recap their conclusions, surface disagreements, and propose the consensus path. Do NOT introduce new tool calls of your own beyond what is needed to reconcile the prior turns.'
      ]
    }
    return [
      '',
      '- Round mode: CHAIR-SUMMARY. Another participant (the designated chair / synthesizer) will speak last and recap. Wrap your turn cleanly so the chair has a coherent block to summarise — close with a one-line takeaway rather than an open question.'
    ]
  }
  if (mode === 'rebuttal') {
    return [
      '',
      "- Round mode: REBUTTAL. Respond to the IMMEDIATELY-PRIOR participant's contribution rather than re-answering the user's original prompt from scratch. Surface what you agree with, what you'd correct, and what's missing. The user's prompt is the topic; the prior turn is the artifact you're critiquing."
    ]
  }
  return []
}
