import { useState, useEffect } from 'react'
import { api } from '@/lib/api-client'
import type { MkActivity } from '@/types'

const activityCache = new Map<number, MkActivity[]>()

export function resetActivityCache() {
  activityCache.clear()
}

export function useMkActivity(siteId: number | null) {
  const [activity, setActivity] = useState<MkActivity[] | null>(
    siteId !== null ? (activityCache.get(siteId) ?? null) : null
  )
  const [loading, setLoading] = useState(siteId !== null && !activityCache.has(siteId))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (siteId === null) return
    if (activityCache.has(siteId)) {
      setActivity(activityCache.get(siteId)!)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    api.mks.activity(siteId)
      .then((data) => {
        activityCache.set(siteId, data)
        setActivity(data)
        setLoading(false)
      })
      .catch((err: Error) => {
        setError(err.message)
        setLoading(false)
      })
  }, [siteId])

  return { activity, loading, error }
}
