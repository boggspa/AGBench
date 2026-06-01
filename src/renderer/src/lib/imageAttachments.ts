export type ImageAttachment = {
  id: string
  path: string
  name: string
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|heic|avif|tiff|tif|svg|jfif)(\?.*)?$/i
export const MAX_IMAGE_ATTACHMENTS = 5

export const sanitizeImagePath = (value: string): string =>
  value.trim().replace(/^\s*["'`]|["'`]\s*$/g, '')

export const getImageName = (value: string): string => {
  return value.split(/[/\\]/).filter(Boolean).pop() || value
}

export const isImageAttachmentPath = (path: string): boolean => IMAGE_EXT.test(path)

export const dedupePaths = (values: string[]): string[] => {
  const seen = new Set<string>()
  const next: string[] = []
  for (const item of values) {
    const normalized = sanitizeImagePath(item)
    if (!normalized || seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    next.push(normalized)
  }
  return next
}

export const collectDroppedAttachmentPaths = (dataTransfer?: DataTransfer | null): string[] => {
  if (!dataTransfer) {
    return []
  }
  const paths: string[] = []

  const fileList = dataTransfer.files
  for (let i = 0; i < fileList.length; i += 1) {
    const file = fileList.item(i)
    if (!file) continue
    const asFile = file as File & { path?: string }
    const candidate = sanitizeImagePath(asFile.path || file.name)
    if (candidate) {
      paths.push(candidate)
    }
  }

  if (paths.length > 0) {
    return dedupePaths(paths)
  }

  const uriList = dataTransfer.getData('text/uri-list')
  if (!uriList) {
    return []
  }

  const uriCandidates = uriList
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.startsWith('file://'))
    .map((line) => {
      try {
        return sanitizeImagePath(decodeURIComponent(line.replace(/^file:\/\//, '')))
      } catch {
        return sanitizeImagePath(line.replace(/^file:\/\//, ''))
      }
    })
    .filter(Boolean)

  return dedupePaths(uriCandidates)
}

export const getImagePreviewSrc = (imagePath: string): string => {
  const normalized = sanitizeImagePath(imagePath).replace(/\\/g, '/')
  return /^[A-Za-z]:\//.test(normalized)
    ? `file:///${normalized}`
    : `file://${normalized.startsWith('/') ? '' : '/'}${normalized}`
}

const dedupeAttachments = (incoming: ImageAttachment[]): ImageAttachment[] => {
  const seen = new Set<string>()
  const next: ImageAttachment[] = []
  for (const item of incoming) {
    const key = sanitizeImagePath(item.path)
    if (!seen.has(key)) {
      seen.add(key)
      next.push(item)
    }
  }
  return next
}

export const mergeImageAttachments = (
  current: ImageAttachment[],
  additions: ImageAttachment[]
): ImageAttachment[] => {
  return dedupeAttachments([...current, ...additions]).slice(-MAX_IMAGE_ATTACHMENTS)
}
