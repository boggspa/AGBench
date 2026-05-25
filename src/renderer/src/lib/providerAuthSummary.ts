import type { GeminiAuthStatus, ProviderApiKeyStatus } from '../../../main/store/types'

export type ProviderAuthVariant = 'signed-in' | 'partial' | 'not-signed-in' | 'not-available'

export interface ProviderAuthSummary {
  variant: ProviderAuthVariant
  statusText: string
  hint: string
}

/** Maps a Claude/Kimi auth status to the shared onboarding/settings summary. */
export function summariseProviderApiKeyStatus(
  status: ProviderApiKeyStatus | null,
  providerLabel: string
): ProviderAuthSummary {
  if (!status) {
    return {
      variant: 'not-signed-in',
      statusText: 'Not checked yet',
      hint: `Open Settings → ${providerLabel} to authenticate.`
    }
  }
  if (!status.available) {
    return {
      variant: 'not-available',
      statusText: 'CLI not found',
      hint: `Install the ${providerLabel} CLI first, then return here.`
    }
  }
  if (status.apiKeyConfigured) {
    return {
      variant: 'signed-in',
      statusText: 'API key saved',
      hint: 'You can launch runs against this provider.'
    }
  }
  const authState = (status.authState || '').toLowerCase()
  const looksAuthed =
    authState &&
    !['not logged in', 'not authenticated', 'unauthenticated', 'error'].some((p) =>
      authState.includes(p)
    )
  if (looksAuthed) {
    return {
      variant: 'signed-in',
      statusText: 'Signed in',
      hint: 'You can launch runs against this provider.'
    }
  }
  return {
    variant: 'not-signed-in',
    statusText: 'Not authenticated',
    hint: `Open Settings → ${providerLabel} to sign in or paste an API key.`
  }
}

export function summariseGeminiStatus(status: GeminiAuthStatus | null): ProviderAuthSummary {
  if (!status) {
    return {
      variant: 'not-signed-in',
      statusText: 'Not checked yet',
      hint: 'Open Settings → Gemini to add an OAuth profile or API key.'
    }
  }
  if (!status.available) {
    return {
      variant: 'not-available',
      statusText: 'Gemini CLI not found',
      hint: 'Install the Gemini CLI first, then return here.'
    }
  }
  if (status.activeProfileId) {
    return {
      variant: 'signed-in',
      statusText: status.activeProfileLabel
        ? `Active profile: ${status.activeProfileLabel}`
        : 'Profile active',
      hint: 'You can launch runs against Gemini.'
    }
  }
  return {
    variant: 'not-signed-in',
    statusText: 'No active profile',
    hint: 'Open Settings → Gemini to authenticate via Google OAuth or paste an API key.'
  }
}

export function summariseCodexStatus(status: any): ProviderAuthSummary {
  if (!status || typeof status !== 'object') {
    return {
      variant: 'not-signed-in',
      statusText: 'Status not loaded yet',
      hint: 'Make sure the codex CLI is installed and run `codex login` in your shell.'
    }
  }
  if (status.available === false) {
    return {
      variant: 'not-available',
      statusText: 'Codex CLI not found',
      hint: 'Install Codex first (`brew install openai/codex/codex` or upstream installer).'
    }
  }
  const usage = status.codexUsage
  if (usage && (usage.planType || usage.userId)) {
    const plan = String(usage.planType || '').toLowerCase()
    if (plan) {
      return {
        variant: 'signed-in',
        statusText: `Signed in (${plan})`,
        hint: 'You can launch Codex runs.'
      }
    }
    return {
      variant: 'signed-in',
      statusText: 'Signed in',
      hint: 'You can launch Codex runs.'
    }
  }
  if (usage && usage.error) {
    return {
      variant: 'partial',
      statusText: 'Usage credential missing',
      hint: 'Run `codex login` in your shell to authenticate the OS-level Codex CLI.'
    }
  }
  return {
    variant: 'not-signed-in',
    statusText: 'Not signed in',
    hint: 'Run `codex login` in your shell to authenticate the OS-level Codex CLI.'
  }
}
