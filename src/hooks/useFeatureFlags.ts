import { useState, useEffect } from 'react'
import { api } from '@/lib/api-client'
import type { FeatureFlags } from '@/types'

// Module-level dedup: feature flags are global and change rarely, so all hook consumers share a
// single fetch instead of each firing its own GET /api/feature-flags. Previously every component
// using this hook (Header, MeetUsSection, useBillsOverview, …) fetched independently — 3+
// identical requests per homepage load.
let cache: FeatureFlags | null = null
let inflight: Promise<FeatureFlags> | null = null

function loadFlags(): Promise<FeatureFlags> {
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    inflight = api.featureFlags.get()
      .then((f) => { cache = f; return f })
      .catch(() => ({} as FeatureFlags))
      .finally(() => { inflight = null })
  }
  return inflight
}

/** Test-only: clear the shared cache/in-flight fetch between cases. */
export function _resetFeatureFlagsCache(): void { cache = null; inflight = null }

export function useFeatureFlags(): FeatureFlags {
  const [flags, setFlags] = useState<FeatureFlags>(cache ?? {})
  useEffect(() => {
    let alive = true
    loadFlags().then((f) => { if (alive) setFlags(f) })
    return () => { alive = false }
  }, [])
  return flags
}
