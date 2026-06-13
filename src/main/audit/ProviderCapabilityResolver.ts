/*
 * ProviderCapabilityResolver — the safety core of the audit orchestrator.
 *
 * Resolves, BEFORE any orchestration token is spent, which providers each
 * audit role may use — as an ordered fallback chain, not a single assignment.
 * Eligibility is composed from live signals the orchestrator gathers (probe
 * reachability, auth state, usage band, Ollama status) intersected with user
 * policy. It is NEVER inferred by an agent and NEVER discovered by failure.
 *
 * This module is pure: it takes injected signals and returns a roster, so it
 * unit-tests without electron, network, or spawns. The orchestrator (Slice 4)
 * gathers the signals and feeds them in.
 *
 * Design (see plan): eligibility layers, ordered fallback chains, Ollama
 * role-restriction + opt-in, honest degradation reporting, graceful
 * single-provider degrade.
 */

import type {
  AuditDegradation,
  AuditOrchestrationSettings,
  AuditRole,
  AuditRoster,
  ProviderId
} from '../store/types'

export type ProviderUsageBandValue = 'low' | 'medium' | 'high' | 'critical' | 'unknown'

/** One provider's live capability signals, gathered by the orchestrator. */
export interface ProviderSignal {
  provider: ProviderId
  /** Provider is structurally registered + has a binary/credential configured. */
  configured: boolean
  /** Auth currently valid (token not expired / key present). */
  authenticated: boolean
  /** Reachable right now (probe passed). */
  healthy: boolean
  /** Live quota band; `critical` excludes the provider this run. */
  usageBand?: ProviderUsageBandValue
  /** Local model (Ollama) — defaults to provider === 'ollama'. */
  isLocal?: boolean
}

export interface ResolveCapabilityInput {
  rolesNeeded: AuditRole[]
  signals: ProviderSignal[]
  policy?: AuditOrchestrationSettings
}

/** Local models are restricted to cheap roles — never recon or synthesis,
 * which want a strong cloud model. */
const LOCAL_ELIGIBLE_ROLES: ReadonlySet<AuditRole> = new Set<AuditRole>(['reviewer', 'skeptic'])

function isLocal(signal: ProviderSignal): boolean {
  return signal.isLocal ?? signal.provider === 'ollama'
}

/** First failing eligibility layer (in order) → degradation reason, or null
 * when the provider is fully eligible. Order matters: report the EARLIEST
 * cause so "unconfigured" never masquerades as "rate limited". */
function eligibilityReason(
  signal: ProviderSignal,
  policy: AuditOrchestrationSettings | undefined
): AuditDegradation['reason'] | null {
  if (!signal.configured) return 'unconfigured'
  if (!signal.authenticated) return 'unauthenticated'
  if (!signal.healthy) return 'unhealthy'
  if (signal.usageBand === 'critical') return 'rate_limited'
  if (policy?.providerAllowlist && !policy.providerAllowlist.includes(signal.provider)) {
    return 'policy_excluded'
  }
  if (isLocal(signal) && !policy?.ollamaEnabled) return 'ollama_disabled'
  return null
}

/** Default ordering among otherwise-equal eligible providers: cloud before
 * local, then lower usage band first, then stable input order. Opinion about
 * "which provider is smartest" lives in user policy (perRolePreferences) and
 * the order the orchestrator passes signals in — NOT here. */
const BAND_RANK: Record<ProviderUsageBandValue, number> = {
  low: 0,
  unknown: 1,
  medium: 1,
  high: 2,
  critical: 3
}

function defaultPriority(signals: ProviderSignal[]): ProviderId[] {
  return signals
    .map((signal, index) => ({ signal, index }))
    .sort((a, b) => {
      const localDelta = Number(isLocal(a.signal)) - Number(isLocal(b.signal))
      if (localDelta !== 0) return localDelta
      const bandDelta =
        BAND_RANK[a.signal.usageBand ?? 'unknown'] - BAND_RANK[b.signal.usageBand ?? 'unknown']
      if (bandDelta !== 0) return bandDelta
      return a.index - b.index
    })
    .map((entry) => entry.signal.provider)
}

/** Build one role's ordered fallback chain from the eligible set: policy
 * preferences first (in their order), then remaining eligible providers by
 * default priority. Local providers are dropped for roles that disallow them. */
function chainForRole(
  role: AuditRole,
  eligible: ProviderId[],
  prioritized: ProviderId[],
  localProviders: ReadonlySet<ProviderId>,
  policy: AuditOrchestrationSettings | undefined
): ProviderId[] {
  const roleAllowsLocal = LOCAL_ELIGIBLE_ROLES.has(role)
  const allow = (provider: ProviderId): boolean =>
    eligible.includes(provider) && (roleAllowsLocal || !localProviders.has(provider))

  const chain: ProviderId[] = []
  const push = (provider: ProviderId): void => {
    if (allow(provider) && !chain.includes(provider)) chain.push(provider)
  }
  for (const provider of policy?.perRolePreferences?.[role] ?? []) push(provider)
  for (const provider of prioritized) push(provider)
  return chain
}

/**
 * Resolve role→provider fallback chains + the list of providers excluded and
 * why. A role with an empty chain is returned as-is (empty) — the orchestrator
 * decides whether to degrade or abort; the resolver never throws.
 */
export function resolveProviderCapabilities(input: ResolveCapabilityInput): AuditRoster {
  const policy = input.policy
  const degradations: AuditDegradation[] = []
  const eligible: ProviderId[] = []
  const localProviders = new Set<ProviderId>()

  for (const signal of input.signals) {
    if (isLocal(signal)) localProviders.add(signal.provider)
    const reason = eligibilityReason(signal, policy)
    if (reason) {
      degradations.push({ provider: signal.provider, reason })
    } else {
      eligible.push(signal.provider)
    }
  }

  const prioritized = defaultPriority(input.signals.filter((s) => eligible.includes(s.provider)))

  const perRole: Partial<Record<AuditRole, ProviderId[]>> = {}
  for (const role of input.rolesNeeded) {
    perRole[role] = chainForRole(role, eligible, prioritized, localProviders, policy)
  }

  return { perRole, degradations }
}

/** Convenience: the next provider in a role's chain after the ones already
 * tried (used for mid-run fallback substitution). Returns null when the chain
 * is exhausted. */
export function nextProviderInChain(
  chain: ProviderId[] | undefined,
  alreadyTried: readonly ProviderId[]
): ProviderId | null {
  if (!chain) return null
  for (const provider of chain) {
    if (!alreadyTried.includes(provider)) return provider
  }
  return null
}
