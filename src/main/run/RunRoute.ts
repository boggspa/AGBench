import type { ProviderId } from '../store/types'
import type { AgentRunRoute } from './AgentRunTypes'
export function normalizeRunRoute(route?: AgentRunRoute | null): AgentRunRoute {
  return {
    ...(route?.appRunId ? { appRunId: String(route.appRunId) } : {}),
    ...(route?.appChatId ? { appChatId: String(route.appChatId) } : {})
  }
}

export function createFallbackRunId(provider: ProviderId): string {
  return `${provider}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function routeWithRunId(provider: ProviderId, route?: AgentRunRoute | null): AgentRunRoute {
  const normalized = normalizeRunRoute(route)
  return {
    ...normalized,
    appRunId: normalized.appRunId || createFallbackRunId(provider)
  }
}
