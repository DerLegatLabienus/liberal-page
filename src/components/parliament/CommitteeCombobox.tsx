import { useState, useRef, useEffect } from 'react'
import { useCommitteeList } from '@/hooks/useCommitteeList'
import { api, type TrackScope } from '@/lib/api-client'
import type { CommitteeListItem } from '@/types'

interface CommitteeComboboxProps { onAdd: () => void; scope?: TrackScope }

export default function CommitteeCombobox({ onAdd, scope }: CommitteeComboboxProps) {
  const { committees, loading } = useCommitteeList()
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

  const filtered = committees.filter((c) =>
    !query || c.name.toLowerCase().includes(query.toLowerCase())
  )

  const handleSelect = async (item: CommitteeListItem) => {
    setOpen(false)
    setQuery('')
    await api.committees.track(item.committeeId, item.name, item.knessetUrl, scope).catch(() => {})
    onAdd()
  }

  return (
    <div ref={containerRef} className="relative" dir="rtl">
      <button type="button"
        className="flex w-full items-center gap-2 rounded-md border border-border bg-blue-50 px-3 py-2 text-start"
        onClick={() => setOpen((v) => !v)}>
        <span className="flex-1 text-sm text-muted-foreground">ועדה — חפש ועדה...</span>
        <span className="text-xs text-muted-foreground">▼</span>
      </button>

      {open && (
        <div className="absolute top-full z-50 mt-1 w-full rounded-md border border-border bg-white shadow-lg">
          <div className="border-b border-border p-2">
            <input autoFocus className="w-full text-sm outline-none" placeholder="חפש ועדה..."
              value={query} onChange={(e) => setQuery(e.target.value)} dir="rtl" />
          </div>
          <div className="max-h-[40vh] sm:max-h-64 overflow-y-auto">
            {loading && <div className="p-4 text-center text-sm text-muted-foreground">...</div>}
            {filtered.map((c) => (
              <button key={c.committeeId} type="button"
                className="flex w-full items-center px-3 py-2 text-start text-sm hover:bg-slate-50"
                onClick={() => handleSelect(c)}>
                {c.name}
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
