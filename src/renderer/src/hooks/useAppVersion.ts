import { useEffect, useState } from 'react'

/**
 * Resolves the running app version via IPC, fetched once on mount so callers
 * (e.g. the BugReportSheet's auto-captured row) show the same version string the
 * main process stamps into the file. `getAppVersion` is feature-detected because
 * not every preload build exposes it; until the IPC resolves the value is
 * "unknown" so the UI never flashes empty. Extracted from App() with behavior
 * preserved.
 */
export function useAppVersion(): string {
  const [appVersion, setAppVersion] = useState<string>('unknown')
  useEffect(() => {
    let cancelled = false
    const api = window.api as typeof window.api & {
      getAppVersion?: () => Promise<string>
    }
    if (typeof api.getAppVersion !== 'function') return
    api
      .getAppVersion()
      .then((version) => {
        if (!cancelled && typeof version === 'string' && version.trim()) {
          setAppVersion(version)
        }
      })
      .catch(() => {
        /* Non-fatal — the sheet displays "unknown" and the main
         * process stamps the canonical version on the file regardless. */
      })
    return () => {
      cancelled = true
    }
  }, [])
  return appVersion
}
