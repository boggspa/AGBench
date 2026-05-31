import type { CSSProperties, ReactElement } from 'react'
import {
  agentIdenticonRotationForSeed,
  agentIdenticonVariantForSeed,
  type AgentIdenticonVariant
} from '../../lib/agentIdenticon'

interface AgentIdenticonProps {
  seed?: string | null
  variant?: AgentIdenticonVariant
  size?: number
  color?: string
  className?: string
  style?: CSSProperties
  title?: string
}

/**
 * Static SVG-based agent identicon.
 *
 * The drawing set is a fixed catalog of original geometric sigils, selected
 * by a deterministic seed. It avoids pixel-grid identicons and avoids any
 * provider logo language, so it can be wired into child-agent identities
 * without looking like a copied vendor badge.
 */
export function AgentIdenticon({
  seed,
  variant,
  size = 22,
  color,
  className,
  style,
  title
}: AgentIdenticonProps): ReactElement {
  const resolvedVariant = variant || agentIdenticonVariantForSeed(seed)
  const rotation = seed ? agentIdenticonRotationForSeed(seed) : 0
  const resolvedStyle = color ? { ...style, color } : style

  return (
    <svg
      className={['agent-identicon', `agent-identicon-${resolvedVariant}`, className]
        .filter(Boolean)
        .join(' ')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={resolvedStyle}
    >
      {title && <title>{title}</title>}
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="currentColor" opacity="0.12" />
      <rect
        x="2.5"
        y="2.5"
        width="19"
        height="19"
        rx="5.5"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.26"
      />
      <g
        className="agent-identicon-glyph"
        transform={`rotate(${rotation} 12 12)`}
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <AgentIdenticonPaths variant={resolvedVariant} />
      </g>
    </svg>
  )
}

function AgentIdenticonPaths({ variant }: { variant: AgentIdenticonVariant }): ReactElement {
  switch (variant) {
    case 'bridge':
      return (
        <g>
          <path d="M5.2 15.8c2.1-3.8 4.3-5.7 6.8-5.7s4.7 1.9 6.8 5.7" />
          <path d="M6.7 17.8h10.6" />
          <path d="M8.2 14.8v3" />
          <path d="M12 10.2v7.6" />
          <path d="M15.8 14.8v3" />
        </g>
      )
    case 'fold':
      return (
        <g>
          <path d="M6.4 7.3 12 4.8l5.6 2.5v6.2L12 19.2l-5.6-5.7Z" />
          <path d="M6.4 7.3 12 12l5.6-4.7" />
          <path d="M12 12v7.2" />
          <path d="M6.4 13.5 12 12" />
          <path d="M17.6 13.5 12 12" />
        </g>
      )
    case 'hinge':
      return (
        <g>
          <path d="M6.3 6.2h5.1v5.1H6.3Z" />
          <path d="M12.6 12.7h5.1v5.1h-5.1Z" />
          <path d="M11.4 8.7h3.3a2.6 2.6 0 0 1 2.6 2.6v1.4" />
          <path d="M12.6 15.3H9.3a2.6 2.6 0 0 1-2.6-2.6v-1.4" />
        </g>
      )
    case 'lattice':
      return (
        <g>
          <path d="M6.2 6.5h11.6v11H6.2Z" />
          <path d="m6.2 10.2 5.8-3.7 5.8 3.7-5.8 3.7Z" />
          <path d="m6.2 13.9 5.8 3.6 5.8-3.6" />
          <path d="M12 6.5v11" />
        </g>
      )
    case 'compass':
      return (
        <g>
          <path d="M12 5.4v13.2" />
          <path d="M5.4 12h13.2" />
          <path d="m7.5 7.5 9 9" />
          <path d="m16.5 7.5-9 9" />
          <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" opacity="0.34" />
        </g>
      )
    case 'weave':
      return (
        <g>
          <path d="M5.5 8.2c1.7-1.8 3.7-1.8 6 0s4.3 1.8 6 0" />
          <path d="M5.5 12c1.7 1.8 3.7 1.8 6 0s4.3-1.8 6 0" />
          <path d="M5.5 15.8c1.7-1.8 3.7-1.8 6 0s4.3 1.8 6 0" />
          <path d="M8 6.6v10.8" />
          <path d="M16 6.6v10.8" />
        </g>
      )
    case 'bracket':
      return (
        <g>
          <path d="M8.5 5.8h-3v12.4h3" />
          <path d="M15.5 5.8h3v12.4h-3" />
          <path d="M8.3 9.2h7.4" />
          <path d="M8.3 14.8h7.4" />
          <path d="m10 9.2 4 5.6" />
        </g>
      )
    case 'prism':
      return (
        <g>
          <path d="m12 5.2 6.2 3.6v6.9L12 18.8l-6.2-3.1V8.8Z" />
          <path d="M12 5.2v7.1l6.2 3.4" />
          <path d="M12 12.3 5.8 15.7" />
          <path d="M5.8 8.8 12 12.3l6.2-3.5" />
        </g>
      )
    case 'circuit':
      return (
        <g>
          <path d="M5.8 7.5h5.1v4.1h7.3" />
          <path d="M5.8 16.5h5.1v-4.1h7.3" />
          <path d="M9 7.5v9" />
          <circle cx="5.8" cy="7.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="5.8" cy="16.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="18.2" cy="12" r="1" fill="currentColor" stroke="none" />
        </g>
      )
    case 'stack':
      return (
        <g>
          <path d="m6 8 6-3.2L18 8l-6 3.2Z" />
          <path d="m6 12 6 3.2 6-3.2" />
          <path d="m6 16 6 3.2 6-3.2" />
          <path d="M6 8v8" />
          <path d="M18 8v8" />
        </g>
      )
    case 'switchback':
      return (
        <g>
          <path d="M6 6.4h6.4a2.7 2.7 0 1 1 0 5.4H11.6a2.7 2.7 0 1 0 0 5.4H18" />
          <path d="m15.8 4.6 2.2 1.8-2.2 1.8" />
          <path d="m8.2 15.4-2.2 1.8 2.2 1.8" />
          <circle cx="12" cy="12" r="0.95" fill="currentColor" stroke="none" />
        </g>
      )
    case 'anchor':
      return (
        <g>
          <path d="M12 5.4v13" />
          <path d="M8.3 8h7.4" />
          <path d="M7 13.2c.8 3.5 2.5 5.2 5 5.2s4.2-1.7 5-5.2" />
          <path d="m7 13.2 2.4.5" />
          <path d="m17 13.2-2.4.5" />
          <circle cx="12" cy="5.4" r="1.2" />
        </g>
      )
  }
}
