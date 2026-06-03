import { useState, useEffect, useCallback } from 'react'
import { api, type TrackScope } from '@/lib/api-client'
import type { Bill, Committee, Mk } from '@/types'

interface ParliamentState {
  bills: Bill[]
  committees: Committee[]
  mks: Mk[]
  loading: boolean
  error: string | null
  lastSyncedAt: string | null
  refresh: () => void
}

export function useParliament(scope: TrackScope = 'group'): ParliamentState {
  const [bills, setBills] = useState<Bill[]>([])
  const [committees, setCommittees] = useState<Committee[]>([])
  const [mks, setMks] = useState<Mk[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [b, c, m] = await Promise.all([
        api.parliament.getBills(scope),
        api.parliament.getCommittees(scope),
        api.parliament.getMks(scope),
      ])
      setBills(b)
      setCommittees(c)
      setMks(m)
      setLastSyncedAt(new Date().toISOString())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאת רשת')
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { bills, committees, mks, loading, error, lastSyncedAt, refresh }
}
