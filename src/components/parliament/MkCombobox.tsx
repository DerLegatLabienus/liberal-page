import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useMkList } from '@/hooks/useMkList'
import type { KnessetMember } from '@/types'

interface MkComboboxProps {
  onSelect: (member: KnessetMember) => void
  selectedSiteId: number | null
}

export default function MkCombobox({ onSelect, selectedSiteId }: MkComboboxProps) {
  const { t } = useTranslation()
  const { mks, loading } = useMkList()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selected = mks.find((m) => m.siteId === selectedSiteId)

  const filtered = mks
    .filter((mk) => {
      const q = query.toLowerCase()
      return !q || mk.name.toLowerCase().includes(q) || mk.party.toLowerCase().includes(q)
    })
    .sort((a, b) => {
      const score = (m: KnessetMember) => (m.isLiberal ? 2 : m.isSupporter ? 1 : 0)
      const diff = score(b) - score(a)
      return diff !== 0 ? diff : a.name.localeCompare(b.name, 'he')
    })

  return (
    <div ref={containerRef} className="relative" dir="rtl">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md border border-border bg-blue-50 px-3 py-2 text-start"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex-1 text-sm">
          {selected
            ? selected.name
            : <span className="text-muted-foreground">{t('showcase.search_placeholder')}</span>}
        </span>
        <span className="text-xs text-muted-foreground">▼</span>
      </button>

      {open && (
        <div className="absolute top-full z-50 mt-1 w-full rounded-md border border-border bg-white shadow-lg">
          <div className="border-b border-border p-2">
            <input
              autoFocus
              className="w-full text-sm outline-none"
              placeholder={t('showcase.search_placeholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              dir="rtl"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {loading && (
              <div className="p-4 text-center text-sm text-muted-foreground">...</div>
            )}
            {filtered.map((mk) => (
              <button
                key={mk.siteId}
                type="button"
                className={`flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-slate-50 ${
                  mk.siteId === selectedSiteId ? 'bg-blue-50' : ''
                }`}
                onClick={() => { onSelect(mk); setOpen(false); setQuery('') }}
              >
                {mk.photoUrl && (
                  <img
                    src={mk.photoUrl}
                    className="h-6 w-6 shrink-0 rounded-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                    alt=""
                  />
                )}
                <span className="flex-1 text-sm">{mk.name}</span>
                {mk.isLiberal && (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                    💙 {t('showcase.liberal_badge')}
                  </span>
                )}
                {mk.isSupporter && !mk.isLiberal && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                    ⭐ {t('showcase.supporter_badge')}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">{mk.party}</span>
              </button>
            ))}
            {!loading && filtered.length === 0 && (
              <div className="p-4 text-center text-sm text-muted-foreground">לא נמצאו תוצאות</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
