/*
 * useExternalPathRepoMetadata — debounced/cached hook that probes each
 * external-path grant for its git repo status (isRepo, repoRoot, branch).
 *
 * Slice 2 of the external-path-redesign arc. Calls
 * `window.api.probeExternalPath` once per unique grant path; caches the
 * result by path so repeat renders are free; revalidates only when the
 * grant list mutates. The probe result drives the new stacked above-rows
 * (slice 3) — each row reads `repoMetadata[grant.id]` to decide whether
 * to render branch + diff + Create-PR or just a basename.
 *
 * Repo metadata is NEVER persisted to disk — branch can change while the
 * grant is alive (user checks out another branch in the external repo),
 * so we always re-derive at render time. Grants stay as the durable
 * persistence layer.
 */

import { useEffect, useRef, useState } from 'react'
import type { ExternalPathGrant } from '../../../main/store/types'
import type { ExternalPathGitMetadata } from '../lib/ExternalPathRepoDetect'

interface RepoMetadataMap {
  [grantId: string]: ExternalPathGitMetadata | null
}

/**
 * Probe each grant's path and return a metadata map keyed by grant.id.
 * Re-probes when a grant is added/removed. Already-probed paths are
 * served from cache.
 *
 * Returns `null` for paths that don't exist or aren't repos — the
 * descriptor helper handles the null branch gracefully.
 */
export function useExternalPathRepoMetadata(grants: ExternalPathGrant[]): RepoMetadataMap {
  const [metadata, setMetadata] = useState<RepoMetadataMap>({})
  const cacheRef = useRef<Map<string, ExternalPathGitMetadata | null>>(new Map())

  useEffect(() => {
    let cancelled = false
    const grantsByKey = new Map<string, ExternalPathGrant>()
    for (const grant of grants) {
      // Cache key is the path itself (not grant.id) so repeated grants
      // to the same path don't re-probe. Branch changes are caught by
      // the unmount-mount cycle (chat switch / app reload).
      grantsByKey.set(grant.path, grant)
    }

    async function refresh() {
      const next: RepoMetadataMap = {}
      const pending: Array<{ id: string; path: string }> = []
      for (const grant of grants) {
        const cached = cacheRef.current.get(grant.path)
        if (cached !== undefined) {
          next[grant.id] = cached
        } else {
          pending.push({ id: grant.id, path: grant.path })
        }
      }
      // Render with whatever we already have cached, then top-up
      // asynchronously for newly-added grants.
      if (Object.keys(next).length > 0 || pending.length === 0) {
        if (!cancelled) setMetadata(next)
      }
      if (pending.length === 0) return

      const probeResults = await Promise.all(
        pending.map(async ({ id, path }) => {
          try {
            const result = await window.api.probeExternalPath(path)
            return { id, path, result: result || null }
          } catch {
            return { id, path, result: null }
          }
        })
      )
      if (cancelled) return
      for (const { path, result } of probeResults) {
        cacheRef.current.set(path, result)
      }
      // Rebuild the full map from cache after async probes settle.
      const settled: RepoMetadataMap = {}
      for (const grant of grants) {
        const cached = cacheRef.current.get(grant.path)
        settled[grant.id] = cached !== undefined ? cached : null
      }
      setMetadata(settled)
    }

    void refresh()
    return () => {
      cancelled = true
    }
    // Stable identity over grant ids + paths — re-runs only when the
    // grant set actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grants.map((g) => `${g.id}:${g.path}`).join('|')])

  return metadata
}
