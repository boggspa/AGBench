import type { LinkPresentationTarget } from '../lib/urlPresentation'
import { FaviconImage } from './FaviconImage'

interface ToolUrlBadgeProps {
  target: LinkPresentationTarget
  compact?: boolean
}

export function ToolUrlBadge({ target, compact = false }: ToolUrlBadgeProps) {
  return (
    <span className={`tool-url-badge${compact ? ' is-compact' : ''}`} title={target.url}>
      <FaviconImage url={target.url} host={target.host} size={compact ? 12 : 14} />
      <span className="tool-url-badge-host">{target.host}</span>
    </span>
  )
}
