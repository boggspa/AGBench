import type { ChatMessage, ChatRecord, EnsembleConfig, EnsembleParticipant, ProviderId } from './store/types'

const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: 'Gemini',
  codex: 'Codex',
  claude: 'Claude',
  kimi: 'Kimi'
}

const MAX_MESSAGE_CHARS = 4000
const MAX_TRANSCRIPT_CHARS = 24000
const MAX_ENSEMBLE_PARTICIPANTS = 6

export interface BuildEnsemblePromptInput {
  chat: ChatRecord
  config: EnsembleConfig
  participant: EnsembleParticipant
  currentPrompt: string
  roundId: string
  chatContextTurns?: number
}

export function getOrderedEnsembleParticipants(
  config: EnsembleConfig,
  currentPrompt = ''
): EnsembleParticipant[] {
  const maxParticipants =
    Number(config.maxParticipants || 0) > 4
      ? Math.min(MAX_ENSEMBLE_PARTICIPANTS, Math.floor(Number(config.maxParticipants)))
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
  // 1.0.4 — speaker-position awareness. The first participant in
  // a multi-participant round gets two extra nudges (roster
  // marker + scoping rule) so they're more likely to lay out an
  // approach rather than executing through to completion alone.
  // Solo-participant rounds skip both (no panel to consult with).
  const isMultiParticipantRound = orderedParticipants.length >= 2
  const isFirstSpeaker =
    isMultiParticipantRound && orderedParticipants[0]?.id === input.participant.id
  const roster = orderedParticipants
    .map((participant) => {
      const isSelf = participant.id === input.participant.id
      const isFirstInList = participant.id === orderedParticipants[0]?.id
      // Position marker accompanies the "(you)" tag when the
      // participant is also speaking first — gives the model a
      // contextual cue beyond the rule line further down.
      let marker = ''
      if (isSelf) {
        marker = isFirstSpeaker && isFirstInList ? ' (you — first speaker)' : ' (you)'
      }
      return `${participant.order}. ${providerLabel(participant.provider)} / ${participant.role || 'Participant'}${marker}`
    })
    .join('\n')
  const disambigNote = formatSameProviderDisambiguationNote(orderedParticipants)
  const workspaceStanza = formatWorkspaceStanza(input.chat)
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
    '- Deictic references ("this app", "this repo", "this project", "the codebase") refer to the active workspace named in `Round subject:` above, NOT to AGBench / the harness / the ensemble itself. If `Round subject:` says no workspace is bound, ask the user which project they mean before assuming. Discuss AGBench only when the user explicitly references it by name.',
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
function formatWorkspaceStanza(chat: ChatRecord): string {
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
