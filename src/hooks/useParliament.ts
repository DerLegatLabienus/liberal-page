import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api-client'
import type { Bill, Committee, Mk } from '@/types'
import billsStatic from '@/data/bills.json'
import committeesStatic from '@/data/committees.json'
import mksStatic from '@/data/mks.json'

interface ParliamentState {
  bills: Bill[]
  committees: Committee[]
  mks: Mk[]
  loading: boolean
  error: string | null
  lastSyncedAt: string | null
  refresh: () => void
}

export function useParliament(): ParliamentState {
  const [bills, setBills] = useState<Bill[]>(billsStatic as Bill[])
  const [committees, setCommittees] = useState<Committee[]>(committeesStatic as Committee[])
  const [mks, setMks] = useState<Mk[]>(mksStatic as Mk[])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [b, c, m] = await Promise.all([
        api.parliament.getBills(),
        api.parliament.getCommittees(),
        api.parliament.getMks(),
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
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { bills, committees, mks, loading, error, lastSyncedAt, refresh }
}
