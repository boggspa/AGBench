import type { CSSProperties, ReactElement } from 'react'
import type { AgentIdentity } from '../../../../main/store/types'
import {
  namedAgentIdenticonForIdentity,
  namedAgentIdenticonForName,
  type NamedAgentIdenticonMetadata
} from '../../lib/agentIdentityCatalog'
import { AgentIdenticon } from './AgentIdenticon'

const NAMED_AGENT_SVG_RAW_BY_FILE = Object.fromEntries(
  Object.entries(
    import.meta.glob('../../../../../design-assets/agent-identicon/named/*.svg', {
      eager: true,
      import: 'default',
      query: '?raw'
    }) as Record<string, string>
  ).map(([path, raw]) => [path.split('/').pop() || path, raw])
)

interface AgentIdentityIconProps {
  identity?: AgentIdentity | null
  seed?: string | null
  name?: string | null
  color?: string
  size?: number
  className?: string
  style?: CSSProperties
  title?: string
}

function safeHexColor(value: string | null | undefined): string | undefined {
  const trimmed = String(value || '').trim()
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toUpperCase() : undefined
}

function namedSvgForMetadata(metadata: NamedAgentIdenticonMetadata): string | undefined {
  return NAMED_AGENT_SVG_RAW_BY_FILE[metadata.file]
}

function prepareNamedSvg(raw: string, size: number, accent: string): string {
  return raw
    .replace(
      /^<svg\s+/,
      `<svg class="agent-named-identicon-svg" width="${size}" height="${size}" aria-hidden="true" focusable="false" `
    )
    .replace(/\srole="[^"]*"/, '')
    .replace(/\saria-labelledby="[^"]*"/, '')
    .replace(/\sstyle="[^"]*"/, ` style="color: ${accent}; --agent-accent: ${accent};"`)
}

export function AgentIdentityIcon({
  identity,
  seed,
  name,
  color,
  size = 22,
  className,
  style,
  title
}: AgentIdentityIconProps): ReactElement {
  const metadata = identity
    ? namedAgentIdenticonForIdentity(identity)
    : namedAgentIdenticonForName(name)
  const raw = metadata ? namedSvgForMetadata(metadata) : undefined
  const accent =
    safeHexColor(identity?.accent) ||
    safeHexColor(identity?.color) ||
    safeHexColor(color) ||
    metadata?.accent
  const iconStyle = {
    ...style,
    width: size,
    height: size,
    color: accent || color
  } satisfies CSSProperties
  const rootClassName = ['agent-identity-icon', className].filter(Boolean).join(' ')

  if (!metadata || !raw || !accent) {
    return (
      <span
        className={`${rootClassName} agent-identity-icon-seeded`}
        style={iconStyle}
        role={title ? 'img' : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : true}
      >
        <AgentIdenticon
          seed={identity?.agentId || seed || identity?.name || name}
          color={accent || color}
          size={size}
        />
      </span>
    )
  }

  return (
    <span
      className={`${rootClassName} agent-identity-icon-named`}
      style={iconStyle}
      data-agent-slug={metadata.slug}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      dangerouslySetInnerHTML={{ __html: prepareNamedSvg(raw, size, accent) }}
    />
  )
}
