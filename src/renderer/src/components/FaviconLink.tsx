import { isValidElement, type AnchorHTMLAttributes, type ReactNode } from 'react'
import { displayHostForUrl } from '../lib/urlPresentation'
import { FaviconImage } from './FaviconImage'

const VAGUE_LINK_TEXT = new Set([
  'here',
  'link',
  'this',
  'this link',
  'click here',
  'source',
  'read more',
  'more',
  'website'
])

interface FaviconLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string
  resolvedUrl?: string
  children: ReactNode
}

export function FaviconLink({
  href,
  resolvedUrl,
  children,
  className = '',
  ...anchorProps
}: FaviconLinkProps) {
  const faviconUrl = resolvedUrl || href
  const host = displayHostForUrl(faviconUrl)
  const text = plainTextFromReactNode(children).trim()
  const showHost = Boolean(host && shouldShowHost(text, faviconUrl))

  return (
    <a {...anchorProps} href={href} className={`favicon-link ${className}`.trim()}>
      <FaviconImage url={faviconUrl} host={host} size={14} />
      <span className="favicon-link-text">{children}</span>
      {showHost && <span className="favicon-link-host">{host}</span>}
    </a>
  )
}

function shouldShowHost(text: string, url: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ')
  if (!normalized) return true
  if (VAGUE_LINK_TEXT.has(normalized)) return true
  return normalized === url.toLowerCase()
}

function plainTextFromReactNode(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(plainTextFromReactNode).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return plainTextFromReactNode(node.props.children)
  return ''
}
