import manifest from '../../../../design-assets/agent-identicon/agent-identicons.manifest.json'

export interface NamedAgentIdenticonMetadata {
  name: string
  slug: string
  file: string
  accent: string
  hue: number
}

function normalizeAgentIdentityName(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function normalizeAgentIdentitySlug(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function parseManifestEntry(value: unknown): NamedAgentIdenticonMetadata | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  const slug = typeof record.slug === 'string' ? record.slug.trim() : ''
  const file = typeof record.file === 'string' ? record.file.trim() : ''
  const accent = typeof record.accent === 'string' ? record.accent.trim() : ''
  const hue = Number(record.hue)
  if (!name || !slug || !file || !/^#[0-9a-f]{6}$/i.test(accent) || !Number.isFinite(hue)) {
    return null
  }
  return { name, slug, file, accent: accent.toUpperCase(), hue }
}

export const NAMED_AGENT_IDENTICONS: readonly NamedAgentIdenticonMetadata[] = (
  manifest as readonly unknown[]
)
  .map(parseManifestEntry)
  .filter((entry): entry is NamedAgentIdenticonMetadata => Boolean(entry))

const NAMED_IDENTICON_BY_NAME = new Map(
  NAMED_AGENT_IDENTICONS.map((entry) => [normalizeAgentIdentityName(entry.name), entry])
)

const NAMED_IDENTICON_BY_SLUG = new Map(
  NAMED_AGENT_IDENTICONS.map((entry) => [normalizeAgentIdentitySlug(entry.slug), entry])
)

export function namedAgentIdenticonForName(
  name: string | null | undefined
): NamedAgentIdenticonMetadata | undefined {
  return NAMED_IDENTICON_BY_NAME.get(normalizeAgentIdentityName(name))
}

export function namedAgentIdenticonForSlug(
  slug: string | null | undefined
): NamedAgentIdenticonMetadata | undefined {
  return NAMED_IDENTICON_BY_SLUG.get(normalizeAgentIdentitySlug(slug))
}

export function namedAgentIdenticonForIdentity(input: {
  name?: string | null
  slug?: string | null
}): NamedAgentIdenticonMetadata | undefined {
  return namedAgentIdenticonForSlug(input.slug) ?? namedAgentIdenticonForName(input.name)
}
