import type { ChatMessage, ChatRecord, EnsembleConfig, EnsembleParticipant, ProviderId } from './store/types'

const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: 'Gemini',
  codex: 'Codex',
  claude: 'Claude',
  kimi: 'Kimi'
}

const MAX_MESSAGE_CHARS = 4000
const MAX_TRANSCRIPT_CHARS = 24000

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
  const enabled = (config.participants || [])
    .filter((participant) => participant.enabled)
    .slice(0, Math.max(1, config.maxParticipants || 4))
    .sort((a, b) => a.order - b.order || providerLabel(a.provider).localeCompare(providerLabel(b.provider)))
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
  const roster = orderedParticipants
    .map((participant) => {
      const marker = participant.id === input.participant.id ? ' (you)' : ''
      return `${participant.order}. ${providerLabel(participant.provider)} / ${participant.role || 'Participant'}${marker}`
    })
    .join('\n')
  const transcript = buildTaggedTranscript(input.chat.messages || [], input.chatContextTurns || 8)

  return [
    'AGBench Ensemble Mode',
    '',
    `You are ${participantLabel} in a serial moderated panel. One participant speaks at a time.`,
    `Round id: ${input.roundId}`,
    '',
    'Participant roster:',
    roster || '- No other enabled participants.',
    '',
    'Your role instructions:',
    sanitizeText(input.participant.instructions || 'Contribute a concise, useful response for your role.'),
    '',
    'Rules:',
    '- Everyone sees the same tagged transcript. @mentions are routing hints, not private messages.',
    '- If another participant should handle this turn, call ensemble_yield with a short reason.',
    '- Respect your permission preset. Read-only roles should not attempt file or shell mutations.',
    '- Respond as yourself only. Do not impersonate other participants.',
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

export function providerLabel(provider: ProviderId): string {
  return PROVIDER_LABELS[provider] || provider
}

function sanitizeText(value: unknown): string {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

