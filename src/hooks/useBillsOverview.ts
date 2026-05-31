import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api-client'
import type { KnessetBillOverviewItem } from '@/types'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'

export interface TabState {
  items: KnessetBillOverviewItem[]
  loading: boolean
  error: string | null
  retry: () => Promise<void>
}

function useTab(fetcher: () => Promise<KnessetBillOverviewItem[]>, enabled = true): TabState {
  const [items, setItems] = useState<KnessetBillOverviewItem[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!enabled) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      setItems(await fetcher())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setLoading(false)
    }
    // fetcher is a stable api method reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  useEffect(() => { void load() }, [load])

  return { items, loading, error, retry: load }
}

export function useBillsOverview() {
  const flags = useFeatureFlags()
  const policyEnabled = flags['policyFilter']?.enabled ?? false
  const recent = useTab(() => api.bills.recent(10))
  const trending = useTab(() => api.bills.trending())
  const policyAligned = useTab(() => api.bills.policyAligned(10), policyEnabled)
  return { recent, trending, policyAligned, policyEnabled }
}
