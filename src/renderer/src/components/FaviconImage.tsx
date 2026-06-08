import { useEffect, useMemo, useState } from 'react'
import { displayHostForUrl } from '../lib/urlPresentation'

export type FaviconLookupResult =
  | {
      ok: true
      origin: string
      host: string
      iconUrl: string
      dataUrl: string
      contentType: string
      source: 'cache' | 'network'
      title?: string
    }
  | { ok: false; origin?: string; host?: string; blocked?: boolean; error: string }

const faviconRequestCache = new Map<string, Promise<FaviconLookupResult>>()

export function requestFaviconForUrl(url: string): Promise<FaviconLookupResult> {
  const key = String(url || '').trim()
  if (!key) return Promise.resolve({ ok: false, error: 'Missing URL.' })
  const cached = faviconRequestCache.get(key)
  if (cached) return cached
  const api =
    typeof window !== 'undefined' && window.api && typeof window.api.getFaviconForUrl === 'function'
      ? window.api
      : null
  const promise = api
    ? api.getFaviconForUrl(key).catch((error) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : 'Favicon lookup failed.'
      }))
    : Promise.resolve({ ok: false as const, error: 'Favicon bridge unavailable.' })
  faviconRequestCache.set(key, promise)
  return promise
}

export function useFaviconForUrl(url: string): FaviconLookupResult | null {
  const [result, setResult] = useState<FaviconLookupResult | null>(null)
  const key = useMemo(() => String(url || '').trim(), [url])

  useEffect(() => {
    let cancelled = false
    setResult(null)
    if (!key) return
    void requestFaviconForUrl(key).then((next) => {
      if (!cancelled) setResult(next)
    })
    return () => {
      cancelled = true
    }
  }, [key])

  return result
}

interface FaviconImageProps {
  url: string
  host?: string
  size?: number
  className?: string
}

export function FaviconImage({ url, host, size = 14, className = '' }: FaviconImageProps) {
  const result = useFaviconForUrl(url)
  const fallbackHost = host || displayHostForUrl(url)
  const fallbackLetter = fallbackHost.slice(0, 1).toUpperCase() || '?'
  const style = { width: size, height: size }

  if (result?.ok) {
    return (
      <span className={`favicon-image ${className}`} style={style} aria-hidden="true">
        <img src={result.dataUrl} alt="" draggable={false} />
      </span>
    )
  }

  return (
    <span className={`favicon-image favicon-image-fallback ${className}`} style={style} aria-hidden="true">
      {fallbackLetter}
    </span>
  )
}
