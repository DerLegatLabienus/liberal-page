import { useState } from 'react'
import type { LetterContact } from '@/types'

export interface RecipientEditorProps {
  /** Optional field label rendered above the chip box. */
  label?: string
  /** Selected contact ids. */
  value: number[]
  onChange: (next: number[]) => void
  /** Candidate contacts for THIS channel (already channel-filtered by the caller). */
  contacts: LetterContact[]
}

export default function RecipientEditor({ label, value, onChange, contacts = [] }: RecipientEditorProps) {
  const [query, setQuery] = useState('')

  const byId = new Map(contacts.map((c) => [c.id, c]))
  const q = query.trim().toLowerCase()
  const candidates = q.length < 1
    ? []
    : contacts.filter(
        (c) =>
          !value.includes(c.id) &&
          (c.displayName.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q)),
      )

  function add(id: number) {
    if (!value.includes(id)) onChange([...value, id])
    setQuery('')
  }
  const remove = (id: number) => onChange(value.filter((v) => v !== id))

  return (
    <div>
      {label ? <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div> : null}
      <div className="flex flex-wrap items-center gap-1 rounded border px-2 py-1">
        {value.map((id) => {
          const name = byId.get(id)?.displayName ?? `#${id}`
          return (
            <span key={id} className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs">
              {name}
              <button type="button" aria-label={`remove ${name}`}
                onClick={() => remove(id)} className="text-muted-foreground hover:text-foreground">✕</button>
            </span>
          )
        })}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="הקלד שם או אימייל…"
          className="min-w-[140px] flex-1 border-none bg-transparent text-sm outline-none"
        />
      </div>
      {candidates.length > 0 && (
        <ul className="mt-1 max-h-48 overflow-auto rounded border bg-card text-sm">
          {candidates.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => add(c.id)}
                className="block w-full px-2 py-1 text-right hover:bg-muted">
                {c.displayName}{c.email ? ` · ${c.email}` : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
