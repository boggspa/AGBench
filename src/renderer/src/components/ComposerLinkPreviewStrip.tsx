import { useMemo } from 'react'
import { extractHttpUrls, type LinkPresentationTarget } from '../lib/urlPresentation'
import { FaviconImage, useFaviconForUrl } from './FaviconImage'

interface ComposerLinkPreviewStripProps {
  text: string
}

export function ComposerLinkPreviewStrip({ text }: ComposerLinkPreviewStripProps) {
  const links = useMemo(() => extractHttpUrls(text, 5), [text])
  if (links.length === 0) return null
  const visible = links.slice(0, 4)
  const hiddenCount = links.length - visible.length

  return (
    <div className="composer-link-preview-strip" aria-label="Link previews">
      {visible.map((target) => (
        <ComposerLinkPreviewChip key={target.url} target={target} />
      ))}
      {hiddenCount > 0 && <span className="composer-link-preview-more">+{hiddenCount}</span>}
    </div>
  )
}

function ComposerLinkPreviewChip({ target }: { target: LinkPresentationTarget }) {
  const favicon = useFaviconForUrl(target.url)
  const label = favicon?.ok && favicon.title ? favicon.title : target.host

  return (
    <span className="composer-link-preview-chip" title={target.url}>
      <FaviconImage url={target.url} host={target.host} size={14} />
      <span className="composer-link-preview-host">{target.host}</span>
      {label && label !== target.host && <span className="composer-link-preview-title">{label}</span>}
    </span>
  )
}
