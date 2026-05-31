export const AGENT_IDENTICON_VARIANTS = [
  'bridge',
  'fold',
  'hinge',
  'lattice',
  'compass',
  'weave',
  'bracket',
  'prism',
  'circuit',
  'stack',
  'switchback',
  'anchor'
] as const

export type AgentIdenticonVariant = (typeof AGENT_IDENTICON_VARIANTS)[number]

export type AgentIdenticonRotation = 0 | 90 | 180 | 270

const ROTATIONS: readonly AgentIdenticonRotation[] = [0, 90, 180, 270]
const FALLBACK_SEED = 'agent'

function normaliseIdenticonSeed(seed: string | null | undefined): string {
  const trimmed = seed?.trim()
  return trimmed ? trimmed.toLowerCase() : FALLBACK_SEED
}

/**
 * Deterministic, tiny FNV-1a hash for choosing one of the hand-drawn SVG
 * sigils. This is intentionally not cryptographic; it only needs stable,
 * cross-session bucketing for UI identity.
 */
export function agentIdenticonHash(seed: string | null | undefined): number {
  const value = normaliseIdenticonSeed(seed)
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function agentIdenticonVariantForSeed(
  seed: string | null | undefined
): AgentIdenticonVariant {
  return AGENT_IDENTICON_VARIANTS[agentIdenticonHash(seed) % AGENT_IDENTICON_VARIANTS.length]
}

export function agentIdenticonRotationForSeed(
  seed: string | null | undefined
): AgentIdenticonRotation {
  const bucket = Math.floor(agentIdenticonHash(seed) / AGENT_IDENTICON_VARIANTS.length)
  return ROTATIONS[bucket % ROTATIONS.length]
}
