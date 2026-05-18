import { useState, useEffect } from 'react'
import { api } from '@/lib/api-client'
import type { CommitteeListItem } from '@/types'

let sessionCache: CommitteeListItem[] | null = null

export function resetSessionCache() {
  sessionCache = null
}

export function useCommitteeList() {
  const [committees, setCommittees] = useState<CommitteeListItem[]>(sessionCache ?? [])
  const [loading, setLoading] = useState(sessionCache === null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (sessionCache !== null) return
    api.committees.list()
      .then((data) => { sessionCache = data; setCommittees(data); setLoading(false) })
      .catch((err: Error) => { setError(err.message); setLoading(false) })
  }, [])

  return { committees, loading, error }
}
