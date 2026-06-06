export const getHostPlatform = (): string =>
  typeof window !== 'undefined' && typeof window.api?.hostPlatform === 'string'
    ? window.api.hostPlatform
    : 'unknown'

export const hasWindowsDrivePrefix = (value: string): boolean => /^[A-Za-z]:[\\/]/.test(value)

export const stripTrailingPathSeparators = (value: string): string => {
  if (!value) return value
  if (/^[A-Za-z]:[\\/]?$/.test(value)) return value.replace(/[\\/]$/, '\\')
  return value.replace(/[\\/]+$/, '')
}

export const fileUriToLocalPath = (value: string): string => {
  const trimmed = value.trim()
  if (!/^file:\/\//i.test(trimmed)) return trimmed
  try {
    const url = new URL(trimmed)
    let pathname = decodeURIComponent(url.pathname)
    if (url.hostname && url.hostname !== 'localhost') {
      return `//${url.hostname}${pathname}`
    }
    if (/^\/[A-Za-z]:\//.test(pathname)) {
      pathname = pathname.slice(1)
    }
    return pathname
  } catch {
    return trimmed.replace(/^file:\/\/\/?/i, '')
  }
}

export const sanitizeLocalPath = (value: string): string =>
  fileUriToLocalPath(value.trim().replace(/^\s*["'`]|["'`]\s*$/g, ''))

export const pathBasename = (value: string, fallback = value): string => {
  const normalized = stripTrailingPathSeparators(fileUriToLocalPath(value))
  if (!normalized) return fallback
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  return parts.pop() || normalized || fallback
}

export const pathComparisonKey = (value: string, platform = getHostPlatform()): string => {
  const normalized = stripTrailingPathSeparators(sanitizeLocalPath(value)).replace(/\\/g, '/')
  return platform === 'win32' || hasWindowsDrivePrefix(normalized)
    ? normalized.toLowerCase()
    : normalized
}

export const localPathToFileUrl = (value: string): string => {
  const normalized = sanitizeLocalPath(value).replace(/\\/g, '/')
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${normalized}`
  }
  if (normalized.startsWith('//')) {
    return `file:${normalized}`
  }
  return `file://${normalized.startsWith('/') ? '' : '/'}${normalized}`
}
