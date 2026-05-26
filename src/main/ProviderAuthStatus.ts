import type {
  ProviderAuthState,
  ProviderAuthStatusV2,
  ProviderAuthServerState,
  ProviderAuthTransport,
  ProviderId
} from './store/types'

/** Inputs the pure builder needs. All Electron / IPC lookups happen
 * in the caller; this module stays test-friendly and side-effect free. */
export interface ProviderAuthStatusV2Input {
  provider: ProviderId
  available: boolean
  /** Raw `authState` from the upstream CLI / auth probe. */
  rawAuthState?: string | null
  /** True when a local API key is stored. */
  apiKeyConfigured?: boolean
  /** True when the Codex app-server JSON-RPC client is currently up. */
  codexClientStarted?: boolean
  /** Optional error string surfaced as `authReason` when unavailable. */
  errorReason?: string
}

const TRANSPORT_BY_PROVIDER: Record<ProviderId, ProviderAuthTransport> = {
  gemini: 'cli',
  codex: 'app-server',
  claude: 'sdk',
  kimi: 'cli'
}

const APPROVAL_SUPPORT_BY_PROVIDER: Record<ProviderId, boolean> = {
  gemini: true,
  codex: true,
  claude: false,
  kimi: true
}

const MCP_STATUS_SUPPORT_BY_PROVIDER: Record<ProviderId, boolean> = {
  gemini: false,
  codex: true,
  claude: false,
  kimi: false
}

export function buildProviderAuthStatusV2(
  input: ProviderAuthStatusV2Input
): ProviderAuthStatusV2 {
  const { provider } = input
  const available = input.available !== false
  const codexReachable = provider === 'codex' && (available || input.codexClientStarted === true)

  let serverState: ProviderAuthServerState
  if (provider === 'codex') {
    if (input.codexClientStarted) serverState = 'started'
    else if (available) serverState = 'lazy'
    else serverState = 'unavailable'
  } else if (!available) {
    serverState = 'unavailable'
  } else {
    serverState = 'lazy'
  }

  const transport: ProviderAuthTransport =
    available || codexReachable ? TRANSPORT_BY_PROVIDER[provider] : 'unavailable'

  const { authState, authReason } = deriveAuthState(input, available || codexReachable)

  return {
    provider,
    serverState,
    transport,
    approvalSupport: APPROVAL_SUPPORT_BY_PROVIDER[provider],
    mcpStatusSupport: MCP_STATUS_SUPPORT_BY_PROVIDER[provider],
    authState,
    ...(authReason ? { authReason } : {})
  }
}

function deriveAuthState(
  input: ProviderAuthStatusV2Input,
  available: boolean
): { authState: ProviderAuthState; authReason?: string } {
  const { provider, rawAuthState, apiKeyConfigured, errorReason } = input

  if (!available) {
    return {
      authState: 'missing',
      authReason: errorReason || `${provider} CLI not available`
    }
  }

  if (provider === 'codex') {
    return {
      authState: 'not-queried',
      authReason:
        'Codex auth lives in the app-server. Call account/read for live state.'
    }
  }

  if (provider === 'gemini') {
    if (apiKeyConfigured) return { authState: 'authenticated' }
    if (rawAuthState === 'oauth-login-required') {
      return { authState: 'missing', authReason: 'Gemini OAuth login required' }
    }
    if (rawAuthState === 'incomplete') {
      return { authState: 'missing', authReason: 'Gemini auth profile incomplete' }
    }
    if (
      rawAuthState === 'api-key' ||
      rawAuthState === 'google-oauth' ||
      rawAuthState === 'vertex-ai'
    ) {
      return { authState: 'authenticated' }
    }
    return { authState: 'not-queried' }
  }

  if (provider === 'claude') {
    if (apiKeyConfigured) return { authState: 'authenticated' }
    if (rawAuthState === 'authenticated' || rawAuthState === 'api-key') {
      return { authState: 'authenticated' }
    }
    if (rawAuthState === 'missing') {
      return { authState: 'missing', authReason: 'Claude CLI reports no credentials' }
    }
    return {
      authState: 'not-observable',
      authReason: 'Claude CLI did not return a known auth state'
    }
  }

  // kimi
  if (apiKeyConfigured) return { authState: 'authenticated' }
  return { authState: 'missing', authReason: 'No Kimi API key stored' }
}
