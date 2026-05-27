import type { ChatMessage, ChatRecord, EnsembleConfig, EnsembleParticipant, ProviderId } from './store/types'

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
  if (!currentPrompt || /@all\b/i.test(currentPrompt)) return enabled

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
  if (mentioned.size === 0) return enabled
  return [
    ...enabled.filter((participant) => mentioned.has(participant.id)),
    ...enabled.filter((participant) => !mentioned.has(participant.id))
  ]
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
    workspaceStanza,
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
    selfReflective
      // 1.0.4-AF — self-reflective deictic rule. When the ensemble is
      // in `selfReflective: true` (`/discuss` or `/meta` composer
      // prefix), the orientation flips: the panel is discussing
      // AGBench itself, so "this app / this repo / this project"
      // should resolve to the harness. Workspace files are still
      // readable but the conversation is meta-level. This matches the
      // user's intent when they explicitly open a "talk about
      // AGBench" round.
      ? '- Deictic references ("this app", "this repo", "this project", "the codebase") refer to AGBench / the harness / this ensemble — the panel is in self-reflective mode (the user opened the round with `/discuss` or `/meta`). The bound workspace is incidental context; the conversation is about AGBench itself.'
      : '- Deictic references ("this app", "this repo", "this project", "the codebase") refer to the active workspace named in `Round subject:` above, NOT to AGBench / the harness / the ensemble itself. If `Round subject:` says no workspace is bound, ask the user which project they mean before assuming. Discuss AGBench only when the user explicitly references it by name.',
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

function buildTaggedTranscript(messages: ChatMessage[], contextTurns: number): string {
  const relevant = messages
    .filter((message) => message.role !== 'tool')
    .slice(-Math.max(1, contextTurns * 2))
  const lines: string[] = []
  let used = 0
  for (const message of relevant) {
    const tag = messageTag(message)
    const text = sanitizeText(message.content).slice(0, MAX_MESSAGE_CHARS)
    const line = `[${tag}]\n${text}`
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
function formatWorkspaceStanza(chat: ChatRecord, selfReflective = false): string {
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
    return 'Round subject: No workspace bound — system / global chat. If the user references "this app / this repo / this project", ask which project they mean before assuming AGBench.'
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
