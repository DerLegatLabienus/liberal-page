import { useState, useEffect } from 'react'
import { api } from '@/lib/api-client'
import type { FeatureFlags } from '@/types'

export function useFeatureFlags(): FeatureFlags {
  const [flags, setFlags] = useState<FeatureFlags>({})
  useEffect(() => {
    let alive = true
    api.featureFlags.get().then((f) => { if (alive) setFlags(f) }).catch(() => {})
    return () => { alive = false }
  }, [])
  return flags
}
