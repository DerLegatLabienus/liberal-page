import { useState, useEffect } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { api, type JoinAnalyticsData } from '@/lib/api-client'

/** Read-only join click-through analytics: all-time total, per-combo breakdown, last 14 days. */
export default function JoinAnalyticsSection() {
  const { toast } = useToast()
  const [data, setData] = useState<JoinAnalyticsData | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void (async () => {
      try { setData(await api.admin.analytics.joinSummary()) }
      catch (e) { toast(e instanceof Error ? e.message : 'Failed to load analytics', 'error') }
      finally { setLoaded(true) }
    })()
  }, [toast])

  const breakdown = data?.lifetime ? Object.entries(data.lifetime.breakdown).sort((a, b) => b[1] - a[1]) : []
  const days = data?.daily.slice(0, 14) ?? []

  if (loaded && !data?.lifetime && breakdown.length === 0 && days.length === 0) {
    return <p className="text-sm text-muted-foreground">No data yet.</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold">{data?.lifetime?.total ?? 0}</span>
        <span className="text-xs text-muted-foreground">all-time clicks</span>
      </div>

      {breakdown.length > 0 && (
        <ul className="space-y-0.5">
          {breakdown.map(([combo, count]) => (
            <li key={combo} className="flex justify-between rounded-lg bg-muted px-3 py-1.5 text-xs">
              <span className="font-mono">{combo}</span>
              <span>{count}</span>
            </li>
          ))}
        </ul>
      )}

      {days.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Last {days.length} days</summary>
          <ul className="mt-1.5 space-y-0.5">
            {days.map((row) => (
              <li key={row.bucket} className="flex justify-between rounded-lg bg-muted px-3 py-1.5">
                <span>{row.bucket}</span>
                <span>{row.total}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
