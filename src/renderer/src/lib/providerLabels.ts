import type { ProviderId } from '../../../main/store/types'

const providerModelColorClass = (provider: ProviderId): string => `provider-${provider}`

const getProviderLabel = (provider: ProviderId): string => {
  if (provider === 'codex') return 'Codex'
  if (provider === 'claude') return 'Claude'
  if (provider === 'kimi') return 'Kimi'
  if (provider === 'grok') return 'Grok'
  if (provider === 'cursor') return 'Cursor'
  if (provider === 'ollama') return 'Ollama'
  return 'Gemini'
}

export { getProviderLabel, providerModelColorClass }
