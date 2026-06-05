import { agentIdenticonHash } from './agentIdenticon'
import { NAMED_AGENT_IDENTICONS, namedAgentIdenticonForName } from './agentIdentityCatalog'

/**
 * Pure, deterministic seed -> named character identity.
 *
 * Maps an arbitrary STABLE seed (a sub-thread id, or a synthesized hash for
 * untrackable provider-internal agents) onto a fixed entry from the
 * agent-identicon catalog (~54 named characters). The same seed ALWAYS yields
 * the same character + name, with no state and no side effects.
 *
 * This is the stateless counterpart to `assignAgentIdentity` in
 * `./agentIdentity.ts`. That function is a per-chat registry: it allocates pool
 * names sequentially and persists them onto `chat.providerMetadata`, so the
 * Nth distinct agent in a chat gets the Nth pool name regardless of its id.
 * Use THIS helper instead when you only have a stable seed and want a fixed,
 * reproducible character for it without touching (or needing) a ChatRecord —
 * e.g. provider-internal agents that never surface as a `ChildAgentThread`.
 *
 * The catalog is sourced from `NAMED_AGENT_IDENTICONS` (the single source of
 * truth, built from the design-assets manifest) so it can never drift from the
 * set `AgentIdentityIcon` can actually render. `key` is exactly the value
 * `AgentIdentityIcon`'s `name` prop expects.
 */

export interface AgentSeedIdentity {
  /**
   * The catalog key for this identity. Equal to `name`; this is the value to
   * pass to `<AgentIdentityIcon name={key} />`. Always a valid catalog name
   * (resolvable via `namedAgentIdenticonForName`) whenever the catalog is
   * non-empty.
   */
  key: string
  /** Human display name (shown in chips, cards, panels). Equal to `key`. */
  name: string
  /** Stable lowercase slug (catalog id; also the named SVG filename stem). */
  slug: string
  /** Accent color (hex, uppercased) for this character. */
  accent: string
}

/**
 * Hard fallback used when the catalog is empty (e.g. a malformed manifest
 * filtered every entry out). Keeps the function total so callers never get an
 * undefined name. The accent mirrors the geometric-primitive palette tone.
 */
const EMPTY_CATALOG_FALLBACK: AgentSeedIdentity = {
  key: 'Agent',
  name: 'Agent',
  slug: 'agent',
  accent: '#5A8CFF'
}

/**
 * Map a stable seed to a fixed catalog character.
 *
 * Deterministic: `assignAgentIdentity(seed)` returns the same identity for the
 * same seed across calls, sessions, and reloads. Empty / null / undefined
 * seeds collapse to the same stable bucket (via `agentIdenticonHash`'s own
 * fallback-seed handling), so they all resolve to one consistent identity
 * rather than throwing or returning something random.
 *
 * @param seed any stable string (sub-thread id, hash, etc.)
 * @returns `{ key, name, slug, accent }` — `key`/`name` are the catalog name,
 *          which is a valid `AgentIdenticon`/`AgentIdentityIcon` input.
 */
export function assignAgentIdentity(seed: string | null | undefined): AgentSeedIdentity {
  const catalog = NAMED_AGENT_IDENTICONS
  if (catalog.length === 0) {
    return EMPTY_CATALOG_FALLBACK
  }
  // Reuse the established FNV-1a hash so seed -> bucket stays consistent with
  // the geometric-primitive identicon selection elsewhere in the app.
  const index = agentIdenticonHash(seed) % catalog.length
  const entry = catalog[index]
  return {
    key: entry.name,
    name: entry.name,
    slug: entry.slug,
    accent: entry.accent
  }
}

/** Stateless alias with an explicit name, for call sites that want to make the
 * "from a seed, not from a chat" intent obvious next to the registry's
 * identically-named `assignAgentIdentity(chat, thread)`. */
export const assignAgentIdentityFromSeed = assignAgentIdentity

/**
 * True when `key` is a value `AgentIdentityIcon` / `AgentIdenticon` can resolve
 * to a named catalog character. Exposed mainly so tests and defensive call
 * sites can assert the contract that `assignAgentIdentity().key` is always a
 * valid identicon input.
 */
export function isValidAgentIdentityKey(key: string | null | undefined): boolean {
  return Boolean(namedAgentIdenticonForName(key))
}
