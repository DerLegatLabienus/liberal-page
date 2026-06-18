import { useEffect, useRef, useState } from 'react'
import type { LetterAddress, LetterContact } from '@/types'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface RecipientEditorProps {
  label: string
  value: LetterAddress[]
  onChange: (next: LetterAddress[]) => void
  search: (q: string) => Promise<LetterContact[]>
  /** Admin composer: true (paste any address). Member side: false (curated only). */
  allowFreeForm?: boolean
  /** Admin presets shown but not removable (member detail page). */
  lockedValue?: LetterAddress[]
}

export default function RecipientEditor({
  label, value, onChange, search, allowFreeForm = false, lockedValue = [],
}: RecipientEditorProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LetterContact[]>([])
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try { setResults(await search(q)) } catch { setResults([]) }
    }, 300)
    return () => clearTimeout(timer.current)
  }, [query, search])

  const present = (email: string) =>
    value.some((a) => a.email === email) || lockedValue.some((a) => a.email === email)

  function add(addr: LetterAddress) {
    if (present(addr.email)) { setQuery(''); setResults([]); return }
    onChange([...value, addr])
    setQuery(''); setResults([])
  }
  const addContact = (c: LetterContact) =>
    add({ email: c.email, display_name: c.displayName, contact_id: c.id })
  function addFreeForm() {
    const email = query.trim()
    if (!allowFreeForm || !EMAIL_RE.test(email)) return
    add({ email, display_name: email })
  }
  const remove = (email: string) => onChange(value.filter((a) => a.email !== email))

  const grouped = results.reduce<Record<string, LetterContact[]>>((acc, c) => {
    (acc[c.category] ??= []).push(c); return acc
  }, {})
  const canFreeForm = allowFreeForm && EMAIL_RE.test(query.trim())

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex flex-wrap items-center gap-1 rounded border px-2 py-1">
        {lockedValue.map((a) => (
          <span key={`l-${a.email}`} data-testid="locked-chip"
            className="rounded-full bg-muted px-2 py-0.5 text-xs">{a.display_name}</span>
        ))}
        {value.map((a) => (
          <span key={a.email} className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs">
            {a.display_name}
            <button type="button" aria-label={`remove ${a.display_name}`}
              onClick={() => remove(a.email)} className="text-muted-foreground hover:text-foreground">✕</button>
          </span>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addFreeForm() } }}
          placeholder="הקלד שם או אימייל…"
          className="min-w-[140px] flex-1 border-none bg-transparent text-sm outline-none"
        />
      </div>
      {results.length > 0 && (
        <ul className="mt-1 max-h-48 overflow-auto rounded border bg-card text-sm">
          {Object.entries(grouped).map(([cat, items]) => (
            <li key={cat}>
              <div className="bg-muted px-2 py-0.5 text-xs text-muted-foreground">{cat}</div>
              {items.map((c) => (
                <button key={c.id} type="button" onClick={() => addContact(c)}
                  className="block w-full px-2 py-1 text-right hover:bg-muted">
                  {c.displayName} · {c.email}
                </button>
              ))}
            </li>
          ))}
        </ul>
      )}
      {canFreeForm && (
        <button type="button" onClick={addFreeForm} className="mt-1 text-xs text-primary hover:underline">
          + הוסף &quot;{query.trim()}&quot;
        </button>
      )}
    </div>
  )
}
