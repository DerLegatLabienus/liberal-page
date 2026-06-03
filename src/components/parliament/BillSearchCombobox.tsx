import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type TrackScope } from '@/lib/api-client'
import type { BillSearchResult } from '@/types'

interface BillSearchComboboxProps {
  onAdd: () => void
  scope?: TrackScope
}

export default function BillSearchCombobox({ onAdd, scope }: BillSearchComboboxProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<BillSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (query.length < 3) { setResults([]); setOpen(false); return }
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await api.bills.search(query)
        setResults(data)
        setOpen(true)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  const handleSelect = async (result: BillSearchResult) => {
    setOpen(false)
    setQuery('')
    setResults([])
    await api.bills.track(result.billId, result.name, result.knessetUrl, scope).catch(() => {/* ignore */})
    onAdd()
  }

  return (
    <div ref={containerRef} className="relative" dir="rtl">
      <div className="relative">
        <input
          className="w-full rounded-md border border-border bg-blue-50 px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
          placeholder={`${t('tracker.tab_bill')} — חפש הצ"ח לפי כותרת...`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          dir="rtl"
        />
        {loading && (
          <div className="absolute left-2 top-2.5 h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full z-50 mt-1 w-full rounded-md border border-border bg-white shadow-lg">
          <div className="max-h-[40vh] sm:max-h-60 overflow-y-auto">
            {results.map((r) => (
              <button
                key={r.billId}
                type="button"
                className="flex w-full flex-col px-3 py-2 text-start hover:bg-slate-50"
                onClick={() => handleSelect(r)}
              >
                <span className="text-sm leading-snug">{r.name}</span>
                <span className="text-xs text-muted-foreground">{r.billId}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
