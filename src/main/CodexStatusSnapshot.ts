export interface CodexStatusSnapshotInput {
  version: unknown
  clientStarted: boolean
  accountStatus?: any
  rateLimitStatus?: any
  codexUsage?: any
  startupError?: string | null
}

export function buildCodexStatusSnapshot(input: CodexStatusSnapshotInput): any {
  if (input.startupError) {
    return {
      provider: 'codex',
      available: false,
      setupRequired: true,
      version: input.version,
      appServer: 'unavailable',
      authState: 'unknown',
      planType: null,
      account: null,
      requiresOpenaiAuth: false,
      rateLimits: null,
      rateLimitsByLimitId: null,
      codexUsage: input.codexUsage,
      error: input.startupError
    }
  }

  const account = input.accountStatus?.account || null
  return {
    provider: 'codex',
    available: true,
    version: input.version,
    appServer: input.clientStarted ? 'started' : 'lazy',
    authState: account
      ? account.type
      : input.accountStatus?.requiresOpenaiAuth
        ? 'missing'
        : 'not-required',
    planType: account?.planType || null,
    account,
    requiresOpenaiAuth: Boolean(input.accountStatus?.requiresOpenaiAuth),
    rateLimits: input.rateLimitStatus?.rateLimits || null,
    rateLimitsByLimitId: input.rateLimitStatus?.rateLimitsByLimitId || null,
    codexUsage: input.codexUsage,
    error: input.accountStatus?.error
  }
}
