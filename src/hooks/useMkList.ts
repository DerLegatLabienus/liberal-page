import { useState, useEffect } from 'react'
import { api } from '@/lib/api-client'
import type { KnessetMember } from '@/types'

let sessionCache: KnessetMember[] | null = null

export function resetSessionCache() {
  sessionCache = null
}

export function useMkList() {
  const [mks, setMks] = useState<KnessetMember[]>(sessionCache ?? [])
  const [loading, setLoading] = useState(sessionCache === null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (sessionCache !== null) return
    api.mks.list()
      .then((data) => {
        sessionCache = data
        setMks(data)
        setLoading(false)
      })
      .catch((err: Error) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  return { mks, loading, error }
}
