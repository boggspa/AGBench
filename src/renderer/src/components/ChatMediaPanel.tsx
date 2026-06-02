import type { ChatRecord, ChatMessage, ExternalPathGrant } from '../../../main/store/types'
import { collectExternalPathGrantsFromMetadata } from '../../../main/store/ExternalPathGrants'
import { XSymbolIcon } from './AppChromeSymbols'
import { FileTypeIcon } from './FileTypeIcon'
import { useCopyFeedback } from '../lib/useCopyFeedback'

export type ChatMediaSource = 'upload' | 'external_path'
export type ChatMediaKind = 'image' | 'file' | 'folder'

export interface ChatMediaRef {
  id: string
  kind: ChatMediaKind
  source: ChatMediaSource
  name: string
  path: string
  access?: ExternalPathGrant['access']
}

export type MediaAttachmentLike = {
  id?: string
  path?: string
  name?: string
  kind?: ChatMediaKind
  source?: ChatMediaSource
  access?: ExternalPathGrant['access']
}

export function isChatMediaImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|heif|svg)$/i.test(path)
}

export function chatMediaNameFromPath(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, '')
  if (!trimmed) return 'Untitled'
  return trimmed.split('/').pop() || trimmed
}

export function chatMediaPreviewSrc(path: string): string {
  if (/^(file|https?):\/\//i.test(path)) return path
  if (!path.startsWith('/')) return ''
  return `file://${encodeURI(path)}`
}

export function formatChatMediaLocation(path: string, workspacePath?: string): string {
  if (workspacePath && path.startsWith(`${workspacePath}/`)) {
    return path.slice(workspacePath.length + 1)
  }
  return path
}

export function collectChatMediaRefs(
  chat: ChatRecord | null,
  pendingImages: MediaAttachmentLike[],
  currentExternalPathGrants: ExternalPathGrant[]
): ChatMediaRef[] {
  const refs: ChatMediaRef[] = []
  const seen = new Set<string>()

  const addRef = (ref: ChatMediaRef) => {
    if (!ref.path) return
    const key = `${ref.source}:${ref.path}:${ref.access || ''}`
    if (seen.has(key)) return
    seen.add(key)
    refs.push(ref)
  }

  const addAttachment = (
    attachment: MediaAttachmentLike | null | undefined,
    source: ChatMediaSource = 'upload'
  ) => {
    const path = typeof attachment?.path === 'string' ? attachment.path.trim() : ''
    if (!path) return
    addRef({
      id: attachment?.id || `${source}:${path}`,
      kind: isChatMediaImagePath(path) ? 'image' : 'file',
      source,
      name: attachment?.name || chatMediaNameFromPath(path),
      path
    })
  }

  const addGrant = (grant: Partial<ExternalPathGrant> | null | undefined) => {
    const path = typeof grant?.path === 'string' ? grant.path.trim() : ''
    if (!path) return
    const grantKind = grant?.kind
    const grantAccess = grant?.access
    const kind =
      grantKind === 'directory' ? 'folder' : isChatMediaImagePath(path) ? 'image' : 'file'
    addRef({
      id: grant?.id || `external_path:${path}:${grantAccess || 'read'}`,
      kind,
      source: 'external_path',
      name: chatMediaNameFromPath(path),
      path,
      access: grantAccess
    })
  }

  pendingImages.forEach((attachment) => addAttachment(attachment))
  currentExternalPathGrants.forEach((grant) => addGrant(grant))

  const chatAny = chat as any
  collectExternalPathGrantsFromMetadata(chatAny?.providerMetadata).forEach((grant) =>
    addGrant(grant)
  )

  const messages = Array.isArray(chatAny?.messages) ? chatAny.messages : []
  messages.forEach((message: any) => {
    const metadata = message?.metadata || {}
    ;[metadata.imageAttachments, metadata.attachments, metadata.mediaRefs].forEach((candidate) => {
      if (Array.isArray(candidate)) {
        candidate.forEach((attachment) => addAttachment(attachment))
      }
    })
  })

  const runs = Array.isArray(chatAny?.runs) ? chatAny.runs : []
  runs.forEach((run: any) => {
    ;[
      run,
      run?.request,
      run?.snapshot,
      run?.requestSnapshot,
      run?.runRequest,
      run?.payload
    ].forEach((candidate) => {
      if (!candidate) return
      if (Array.isArray(candidate.imageAttachments)) {
        candidate.imageAttachments.forEach((attachment: MediaAttachmentLike) =>
          addAttachment(attachment)
        )
      }
      if (Array.isArray(candidate.attachments)) {
        candidate.attachments.forEach((attachment: MediaAttachmentLike) =>
          addAttachment(attachment)
        )
      }
      if (Array.isArray(candidate.externalPathGrants)) {
        candidate.externalPathGrants.forEach((grant: Partial<ExternalPathGrant>) => addGrant(grant))
      }
    })
  })

  return refs.sort((a, b) => {
    const rank = (ref: ChatMediaRef) => (ref.kind === 'image' ? 0 : ref.kind === 'folder' ? 1 : 2)
    return rank(a) - rank(b) || a.name.localeCompare(b.name)
  })
}

export function collectMessageMediaRefs(message: ChatMessage): ChatMediaRef[] {
  const refs: ChatMediaRef[] = []
  const seen = new Set<string>()
  const metadata = message.metadata || {}

  const addAttachment = (attachment: MediaAttachmentLike | null | undefined) => {
    const path = typeof attachment?.path === 'string' ? attachment.path.trim() : ''
    if (!path) return
    const source = attachment?.source === 'external_path' ? 'external_path' : 'upload'
    const key = `${source}:${path}:${attachment?.access || ''}`
    if (seen.has(key)) return
    seen.add(key)
    const declaredKind = attachment?.kind
    const kind =
      declaredKind === 'folder' || declaredKind === 'file' || declaredKind === 'image'
        ? declaredKind
        : isChatMediaImagePath(path)
          ? 'image'
          : 'file'
    refs.push({
      id: attachment?.id || `${source}:${path}`,
      kind,
      source,
      name: attachment?.name || chatMediaNameFromPath(path),
      path,
      ...(attachment?.access ? { access: attachment.access } : {})
    })
  }

  ;[metadata.imageAttachments, metadata.attachments, metadata.mediaRefs].forEach((candidate) => {
    if (Array.isArray(candidate)) {
      candidate.forEach((attachment) => addAttachment(attachment as MediaAttachmentLike))
    }
  })

  return refs
}

export function ChatMessageMediaStrip({
  refs,
  workspacePath
}: {
  refs: ChatMediaRef[]
  workspacePath?: string
}) {
  const { copiedId, copy } = useCopyFeedback()
  if (refs.length === 0) return null
  return (
    <div className="message-attachment-strip" aria-label="Message attachments">
      {refs.map((ref) => {
        const previewSrc = ref.kind === 'image' ? chatMediaPreviewSrc(ref.path) : ''
        const isCopied = copiedId === ref.id
        return (
          <button
            key={ref.id}
            type="button"
            className={`message-attachment-card is-${ref.kind}`}
            title={isCopied ? 'Copied' : `Copy ${ref.name} path`}
            onClick={() => copy(ref.id, ref.path)}
          >
            {previewSrc ? (
              <img src={previewSrc} alt={ref.name} />
            ) : (
              <span className="message-attachment-icon">
                <FileTypeIcon path={ref.path} size={16} workspacePath={workspacePath} />
              </span>
            )}
            <span className="message-attachment-copy">
              <span className="message-attachment-name">{ref.name}</span>
              <span className="message-attachment-path">
                {isCopied ? 'Copied' : formatChatMediaLocation(ref.path, workspacePath)}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function ChatMediaFloatingPanel({
  open,
  refs,
  workspacePath,
  onClose
}: {
  open: boolean
  refs: ChatMediaRef[]
  workspacePath?: string
  onClose: () => void
}) {
  const { copiedId, copy } = useCopyFeedback()
  if (!open) return null

  const imageRefs = refs.filter((ref) => ref.kind === 'image')
  const fileRefs = refs.filter((ref) => ref.kind !== 'image')

  return (
    <section className="chat-media-panel" aria-label="Chat media and files">
      <header className="chat-media-panel-header">
        <div>
          <div className="chat-media-panel-kicker">Chat media</div>
          <h2>Uploads and paths</h2>
        </div>
        <button
          className="chat-media-panel-close"
          type="button"
          onClick={onClose}
          aria-label="Close chat media panel"
        >
          <XSymbolIcon />
        </button>
      </header>

      {refs.length === 0 ? (
        <div className="chat-media-empty">
          Explicitly uploaded images and granted file paths for this chat will appear here.
        </div>
      ) : (
        <>
          {imageRefs.length > 0 && (
            <div className="chat-media-section">
              <div className="chat-media-section-title">Images</div>
              <div className="chat-media-image-grid">
                {imageRefs.map((ref) => {
                  const previewSrc = chatMediaPreviewSrc(ref.path)
                  const isCopied = copiedId === ref.id
                  return (
                    <button
                      key={ref.id}
                      className="chat-media-image-card"
                      type="button"
                      title={isCopied ? 'Copied' : ref.path}
                      onClick={() => copy(ref.id, ref.path)}
                    >
                      {previewSrc ? (
                        <img src={previewSrc} alt={ref.name} />
                      ) : (
                        <span className="chat-media-file-fallback">
                          <FileTypeIcon path={ref.path} size={22} workspacePath={workspacePath} />
                        </span>
                      )}
                      <span>{isCopied ? 'Copied' : ref.name}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {fileRefs.length > 0 && (
            <div className="chat-media-section">
              <div className="chat-media-section-title">Files and paths</div>
              <div className="chat-media-file-list">
                {fileRefs.map((ref) => {
                  const isCopied = copiedId === ref.id
                  return (
                    <button
                      key={ref.id}
                      className="chat-media-file-row"
                      type="button"
                      title={isCopied ? 'Copied' : 'Copy path'}
                      onClick={() => copy(ref.id, ref.path)}
                    >
                      <span className="chat-media-file-icon">
                        <FileTypeIcon path={ref.path} size={18} workspacePath={workspacePath} />
                      </span>
                      <span className="chat-media-file-copy">
                        <span className="chat-media-file-name">{ref.name}</span>
                        <span className="chat-media-file-path">
                          {isCopied ? 'Copied' : formatChatMediaLocation(ref.path, workspacePath)}
                        </span>
                      </span>
                      <span className={`chat-media-source source-${ref.source}`}>
                        {ref.source === 'external_path' ? ref.access || 'path' : 'upload'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
