# Civic Letters Usability v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Civic Letters system feel light — a real multi-recipient admin composer backed by the seeded address book, a fixed cross-tab refresh bug, and members able to add (only) curated address-book recipients before sending.

**Architecture:** Two pure URL builders move to a shared module imported by both client and server. A reusable `RecipientEditor` chip+autocomplete component is built once and used in both the admin composer (free-form allowed) and the member detail page (picker-only, presets locked). After this shared foundation, the admin-composer work (`AdminLettersPage.tsx`) and the member-editing work (`LetterDetailPage.tsx` + a new member contacts endpoint) are file-disjoint and proceed in parallel.

**Tech Stack:** React 18 + Vite, Express 5 + tsx, Drizzle/Postgres (pglite in tests), Vitest + @testing-library/react (happy-dom) + supertest (node).

**Spec:** `docs/superpowers/specs/2026-06-18-letters-usability-v2-design.md`

---

## File Structure

**Phase 0 — shared foundation (build first, sequential):**
- Create `src/lib/letter-urls.ts` — pure `buildMailtoUrl` / `buildGmailComposeUrl` (imports only the `LetterAddress` type). *(Task 1)*
- Modify `server/services/letter-utils.ts` — re-export the two builders from the shared module; keep `stripHtml` + `renderLetterHtml`. *(Task 1)*
- Modify `tsconfig.server.json` — add `src/lib/letter-urls.ts` to `include`. *(Task 1)*
- Create `src/components/letters/RecipientEditor.tsx` — reusable chip+autocomplete recipient editor. *(Task 2)*

**Phase 1A — Feature 1: admin composer (parallel; all in `src/pages/AdminLettersPage.tsx`):**
- 22.1 multi-recipient editor *(Task 3)*
- 22.6 refresh bug *(Task 4)*
- 22.5 usability pass *(Task 5)*

**Phase 1B — Feature 2: member editing (parallel):**
- Modify `server/routes/letters.ts` + `src/lib/api-client.ts` — member contacts endpoint. *(Task 6)*
- Modify `src/pages/LetterDetailPage.tsx` — locked presets + picker additions + client-side URL rebuild. *(Task 7)*

Phase 1A and 1B share no files; run them as two independent workflows after Phase 0 merges.

---

## Phase 0 — Shared foundation

### Task 1: Extract URL builders into a shared module

**Files:**
- Create: `src/lib/letter-urls.ts`
- Modify: `server/services/letter-utils.ts:39-75` (replace the two builder functions with a re-export; keep `stripHtml`, `renderLetterHtml`)
- Modify: `tsconfig.server.json` (`include` array)
- Test: `tests/server/letter-url-parity.test.ts` (new); existing `tests/server/letter-utils.test.ts` must stay green

- [ ] **Step 1: Create the shared module**

`src/lib/letter-urls.ts`:
```ts
import type { LetterAddress } from '../types'

/**
 * Build a mailto: URI with pre-filled fields. Per RFC 6068, hfields must be
 * percent-encoded with %20 for spaces — NOT URLSearchParams, which form-encodes
 * spaces as `+` that many mail clients render literally (mangling Hebrew subjects
 * and bodies). Email addresses are ASCII-safe so the to-list is left as-is.
 *
 * Pure + dependency-free so both the server (detail endpoint) and the client
 * (member recipient edits) build identical URLs from one source of truth.
 */
export function buildMailtoUrl(
  toAddresses: LetterAddress[],
  ccAddresses: LetterAddress[],
  bccAddresses: LetterAddress[],
  subject: string,
  bodyPlain: string,
): string {
  const to = toAddresses.map((a) => a.email).join(',')
  const hfields: string[] = []
  if (ccAddresses.length) hfields.push(`cc=${encodeURIComponent(ccAddresses.map((a) => a.email).join(','))}`)
  if (bccAddresses.length) hfields.push(`bcc=${encodeURIComponent(bccAddresses.map((a) => a.email).join(','))}`)
  hfields.push(`subject=${encodeURIComponent(subject)}`)
  hfields.push(`body=${encodeURIComponent(bodyPlain)}`)
  return `mailto:${to}?${hfields.join('&')}`
}

/**
 * Build a Gmail web "compose" URL. mailto: only works on desktop when a protocol
 * handler is registered (often nothing happens on Chrome); this opens Gmail's compose
 * window directly in the browser, which works regardless of handler config.
 */
export function buildGmailComposeUrl(
  toAddresses: LetterAddress[],
  ccAddresses: LetterAddress[],
  bccAddresses: LetterAddress[],
  subject: string,
  bodyPlain: string,
): string {
  const params = new URLSearchParams({ view: 'cm', fs: '1' })
  params.set('to', toAddresses.map((a) => a.email).join(','))
  if (ccAddresses.length) params.set('cc', ccAddresses.map((a) => a.email).join(','))
  if (bccAddresses.length) params.set('bcc', bccAddresses.map((a) => a.email).join(','))
  params.set('su', subject)
  params.set('body', bodyPlain)
  // Gmail decodes + as space in su/body, so URLSearchParams' + encoding is fine here.
  return `https://mail.google.com/mail/?${params.toString()}`
}
```

- [ ] **Step 2: Re-export from the server util, drop the duplicated bodies**

In `server/services/letter-utils.ts`: delete the two builder function definitions (lines ~33-75) and their `LetterAddress` import if now unused, and add a re-export near the top (after the existing imports):
```ts
// URL builders live in a shared module so the client (member recipient edits) and
// the server (detail endpoint) produce byte-identical URLs from one source of truth.
export { buildMailtoUrl, buildGmailComposeUrl } from '../../src/lib/letter-urls'
```
Keep `stripHtml` and `renderLetterHtml` exactly as they are. (`server/routes/letters.ts` imports the builders from this file and is unchanged.)

- [ ] **Step 3: Add the shared file to the server tsconfig**

In `tsconfig.server.json`, change the `include` array to:
```json
  "include": ["server/**/*", "src/types.ts", "src/lib/letter-urls.ts"],
```

- [ ] **Step 4: Write the parity test**

`tests/server/letter-url-parity.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import * as client from '../../src/lib/letter-urls'
import { buildMailtoUrl, buildGmailComposeUrl } from '../../server/services/letter-utils'

const to = [{ email: 'mk@knesset.gov.il', display_name: 'ח"כ' }]
const cc = [{ email: 'cc@gov.il', display_name: 'דובר' }]

describe('URL builder parity (client module === server re-export)', () => {
  it('mailto is identical', () => {
    expect(buildMailtoUrl(to, cc, [], 'נושא חשוב', 'שלום רב'))
      .toBe(client.buildMailtoUrl(to, cc, [], 'נושא חשוב', 'שלום רב'))
  })
  it('gmail is identical', () => {
    expect(buildGmailComposeUrl(to, cc, [], 'נושא', 'גוף'))
      .toBe(client.buildGmailComposeUrl(to, cc, [], 'נושא', 'גוף'))
  })
})
```

- [ ] **Step 5: Run tests — old builder tests + parity must pass**

Run: `npx vitest run tests/server/letter-utils.test.ts tests/server/letter-url-parity.test.ts`
Expected: PASS (the existing builder tests still pass via the re-export; parity passes).

- [ ] **Step 6: Type-check both projects**

Run: `npx tsc --noEmit -p tsconfig.app.json && npx tsc --noEmit -p tsconfig.server.json`
Expected: no errors (server resolves `../../src/lib/letter-urls` because it's now in `include`).

- [ ] **Step 7: Commit**
```bash
git add src/lib/letter-urls.ts server/services/letter-utils.ts tsconfig.server.json tests/server/letter-url-parity.test.ts
git commit -m "refactor(letters): extract mailto/gmail builders into shared src/lib/letter-urls"
```

---

### Task 2: Reusable RecipientEditor component

A chip box with debounced address-book autocomplete. Used by the composer (free-form on) and the member detail page (free-form off, locked presets). Modeled on `src/components/parliament/BillSearchCombobox.tsx` (debounced search + results dropdown).

**Files:**
- Create: `src/components/letters/RecipientEditor.tsx`
- Test: `tests/components/RecipientEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

`tests/components/RecipientEditor.test.tsx`:
```tsx
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect } from 'vitest'
import RecipientEditor from '@/components/letters/RecipientEditor'
import type { LetterContact } from '@/types'

const CONTACTS: LetterContact[] = [
  { id: 1, displayName: 'דובר משרד החינוך', email: 'dover@education.gov.il', category: 'ministry', createdAt: '' },
  { id: 2, displayName: 'ח"כ ישראל ישראלי', email: 'mk@knesset.gov.il', category: 'mk', createdAt: '' },
]

function search(_q: string) { return Promise.resolve(CONTACTS) }

it('renders locked presets as non-removable chips', () => {
  render(<RecipientEditor label="To" value={[]} onChange={vi.fn()} search={search}
    lockedValue={[{ email: 'p@gov.il', display_name: 'נמען קבוע' }]} />)
  expect(screen.getByText('נמען קבוע')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /remove נמען קבוע/ })).not.toBeInTheDocument()
})

it('adds a contact from the dropdown', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup({ delay: null })
  render(<RecipientEditor label="To" value={[]} onChange={onChange} search={search} />)
  await user.type(screen.getByPlaceholderText(/הקלד/), 'דובר')
  await act(async () => { await new Promise((r) => setTimeout(r, 350)) })
  await user.click(await screen.findByText(/dover@education.gov.il/))
  expect(onChange).toHaveBeenCalledWith([
    { email: 'dover@education.gov.il', display_name: 'דובר משרד החינוך', contact_id: 1 },
  ])
})

it('removes a value chip', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup({ delay: null })
  render(<RecipientEditor label="To" value={[{ email: 'x@y.com', display_name: 'איקס' }]}
    onChange={onChange} search={search} />)
  await user.click(screen.getByRole('button', { name: /remove איקס/ }))
  expect(onChange).toHaveBeenCalledWith([])
})

it('rejects free-form when allowFreeForm is false, accepts when true', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup({ delay: null })
  const { rerender } = render(
    <RecipientEditor label="To" value={[]} onChange={onChange} search={search} allowFreeForm={false} />)
  const input = screen.getByPlaceholderText(/הקלד/)
  await user.type(input, 'free@form.com{Enter}')
  expect(onChange).not.toHaveBeenCalled()

  rerender(<RecipientEditor label="To" value={[]} onChange={onChange} search={search} allowFreeForm />)
  await user.clear(input)
  await user.type(input, 'free@form.com{Enter}')
  expect(onChange).toHaveBeenCalledWith([{ email: 'free@form.com', display_name: 'free@form.com' }])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/RecipientEditor.test.tsx`
Expected: FAIL — cannot find module `@/components/letters/RecipientEditor`.

- [ ] **Step 3: Implement the component**

`src/components/letters/RecipientEditor.tsx`:
```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/RecipientEditor.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**
```bash
git add src/components/letters/RecipientEditor.tsx tests/components/RecipientEditor.test.tsx
git commit -m "feat(letters): reusable RecipientEditor chip+autocomplete component"
```

---

## Phase 1A — Feature 1: admin composer (`src/pages/AdminLettersPage.tsx`)

> Depends on Phase 0. All three tasks edit the same file — run sequentially in one workflow.

### Task 3: 22.1 — Multi-recipient composer (To/Cc/Bcc)

Replace the single `toEmail`/`toName` pair in `NewLetterForm` with three `RecipientEditor`s.

**Files:**
- Modify: `src/pages/AdminLettersPage.tsx` (`NewLetterBody` type ~249-254; `NewLetterForm` ~256-405)
- Test: `tests/components/AdminLettersComposer.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

`tests/components/AdminLettersComposer.test.tsx`:
```tsx
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { admin: { letters: {
    create: vi.fn().mockResolvedValue({ letter: {} }),
    list: vi.fn().mockResolvedValue({ letters: [] }),
    contacts: { list: vi.fn().mockResolvedValue({ contacts: [
      { id: 1, displayName: 'דובר חינוך', email: 'dover@education.gov.il', category: 'ministry', createdAt: '' },
    ] }) },
    letterTemplates: { list: vi.fn().mockResolvedValue({ templates: [] }) },
  } } } },
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin' }, ready: true }) }))
vi.mock('@/hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({}) }))

import AdminLettersPage from '@/pages/AdminLettersPage'
import { MemoryRouter } from 'react-router-dom'
import { api } from '@/lib/api-client'

const renderPage = () => render(<MemoryRouter><AdminLettersPage /></MemoryRouter>)

describe('admin composer multi-recipient', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a letter with a To recipient picked from the address book', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await user.click(await screen.findByRole('button', { name: /New Letter/ }))
    await user.type(screen.getByPlaceholderText('Internal title'), 'כותרת')
    await user.type(screen.getByPlaceholderText('Re: ...'), 'נושא')
    await user.type(screen.getByPlaceholderText(/<p>/), '<p>גוף</p>')
    // Add a To recipient via the address-book picker
    const toInput = screen.getAllByPlaceholderText(/הקלד/)[0]
    await user.type(toInput, 'דובר')
    await act(async () => { await new Promise((r) => setTimeout(r, 350)) })
    await user.click(await screen.findByText(/dover@education.gov.il/))
    await user.click(screen.getByRole('button', { name: /Create Letter/ }))
    expect(api.admin.letters.create).toHaveBeenCalledWith(expect.objectContaining({
      toAddresses: [{ email: 'dover@education.gov.il', display_name: 'דובר חינוך', contact_id: 1 }],
    }))
  })

  it('blocks submit when there is no To recipient', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await user.click(await screen.findByRole('button', { name: /New Letter/ }))
    await user.type(screen.getByPlaceholderText('Internal title'), 'כותרת')
    await user.type(screen.getByPlaceholderText('Re: ...'), 'נושא')
    await user.type(screen.getByPlaceholderText(/<p>/), '<p>גוף</p>')
    await user.click(screen.getByRole('button', { name: /Create Letter/ }))
    expect(api.admin.letters.create).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/AdminLettersComposer.test.tsx`
Expected: FAIL (composer still has single To email/name fields; no `הקלד` picker input).

- [ ] **Step 3: Update the `NewLetterBody` type and `NewLetterForm` state**

In `src/pages/AdminLettersPage.tsx`, change `NewLetterBody` to carry all three arrays:
```tsx
type NewLetterBody = {
  title: string; subject: string; bodyHtml: string
  toAddresses: LetterAddress[]
  ccAddresses: LetterAddress[]
  bccAddresses: LetterAddress[]
  status: Letter['status']; priority: Letter['priority']
  templateId: number | null
}
```
Add `LetterAddress` to the type import at the top:
```tsx
import type { Letter, LetterWithStats, LetterIssueTag, LetterContact, LetterTemplate, LetterAddress } from '@/types'
```
Add the import for the editor:
```tsx
import RecipientEditor from '@/components/letters/RecipientEditor'
```
Replace the `toEmail`/`toName` state with:
```tsx
  const [toAddresses, setToAddresses] = useState<LetterAddress[]>([])
  const [ccAddresses, setCcAddresses] = useState<LetterAddress[]>([])
  const [bccAddresses, setBccAddresses] = useState<LetterAddress[]>([])
  const [showCc, setShowCc] = useState(false)
  const [showBcc, setShowBcc] = useState(false)
```
Add a search helper inside `NewLetterForm`:
```tsx
  const searchContacts = (q: string) => api.admin.letters.contacts.list(q).then((r) => r.contacts)
```

- [ ] **Step 4: Replace the To email/name inputs with RecipientEditor instances**

Replace the two `<div>` blocks holding "To — Email" and "To — Display Name" (~333-342) with:
```tsx
        <div className="col-span-2 space-y-3">
          <RecipientEditor label="To *" value={toAddresses} onChange={setToAddresses}
            search={searchContacts} allowFreeForm />
          {showCc
            ? <RecipientEditor label="Cc" value={ccAddresses} onChange={setCcAddresses} search={searchContacts} allowFreeForm />
            : <button type="button" onClick={() => setShowCc(true)} className="text-xs text-primary hover:underline">+ add Cc</button>}
          {showBcc
            ? <RecipientEditor label="Bcc" value={bccAddresses} onChange={setBccAddresses} search={searchContacts} allowFreeForm />
            : <button type="button" onClick={() => setShowBcc(true)} className="text-xs text-primary hover:underline">+ add Bcc</button>}
        </div>
```

- [ ] **Step 5: Update submit validity + payload + reset**

In `submit`:
```tsx
    if (!title || !subject || !bodyHtml || toAddresses.length === 0) return
    setSaving(true)
    try {
      await onCreate({
        title, subject, bodyHtml,
        toAddresses, ccAddresses, bccAddresses,
        status, priority, templateId,
      })
      setTitle(''); setSubject(''); setBodyHtml('')
      setToAddresses([]); setCcAddresses([]); setBccAddresses([])
      setShowCc(false); setShowBcc(false); setTemplateId(null)
      setOpen(false)
    } finally {
      setSaving(false)
    }
```
The parent `onCreate` already calls `api.admin.letters.create(body)`; `create`'s `Partial<Letter>` type accepts the array fields (they are real `Letter` keys), so no api-client change is needed.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/components/AdminLettersComposer.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Type-check + commit**
```bash
npx tsc --noEmit -p tsconfig.app.json
git add src/pages/AdminLettersPage.tsx tests/components/AdminLettersComposer.test.tsx
git commit -m "feat(letters): multi-recipient To/Cc/Bcc composer with address-book picker (§22.1)"
```

---

### Task 4: 22.6 — Composer refreshes templates when opened

Live contact search already fixes stale contacts. Remaining: the template dropdown is fetched once and goes stale if a template is created in another tab. Refetch templates when the New Letter form opens.

**Files:**
- Modify: `src/pages/AdminLettersPage.tsx` (`NewLetterForm` open handler + parent reload)
- Test: extend `tests/components/AdminLettersComposer.test.tsx`

- [ ] **Step 1: Write the failing test (append to the existing describe block)**
```tsx
  it('refetches templates when the composer opens', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await screen.findByRole('button', { name: /New Letter/ })
    const before = vi.mocked(api.admin.letters.letterTemplates.list).mock.calls.length
    await user.click(screen.getByRole('button', { name: /New Letter/ }))
    expect(vi.mocked(api.admin.letters.letterTemplates.list).mock.calls.length).toBeGreaterThan(before)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/AdminLettersComposer.test.tsx -t "refetches templates"`
Expected: FAIL — opening the form does not call `letterTemplates.list` again.

- [ ] **Step 3: Add an `onOpen` prop and pass a templates reloader**

In the parent (the `letters` tab render), pass a reloader to `NewLetterForm`:
```tsx
            <NewLetterForm
              templates={templates}
              beautifyEnabled={beautifyEnabled}
              onOpen={async () => { setTemplates((await api.admin.letters.letterTemplates.list()).templates) }}
              onCreate={async (body) => { await api.admin.letters.create(body); refresh() }}
            />
```
Extend the `NewLetterForm` props type with `onOpen: () => void | Promise<void>` and trigger it from the "+ New Letter" button:
```tsx
  if (!open) {
    return (
      <button type="button" onClick={() => { setOpen(true); onOpen() }}
        className="rounded border border-dashed border-border px-4 py-2 text-sm text-muted-foreground hover:border-primary hover:text-primary">
        + New Letter
      </button>
    )
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/AdminLettersComposer.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Type-check + commit**
```bash
npx tsc --noEmit -p tsconfig.app.json
git add src/pages/AdminLettersPage.tsx tests/components/AdminLettersComposer.test.tsx
git commit -m "fix(letters): refetch templates when composer opens; live contact search (§22.6)"
```

---

### Task 5: 22.5 — Composer usability pass

Group the form into labeled sections and add a live template preview. (No new behavior contract beyond a rendered preview; keep it light.)

**Files:**
- Modify: `src/pages/AdminLettersPage.tsx` (`NewLetterForm` JSX)
- Test: extend `tests/components/AdminLettersComposer.test.tsx`

- [ ] **Step 1: Write the failing test (append)**
```tsx
  it('shows a live preview of the body wrapped in the selected template', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await user.click(await screen.findByRole('button', { name: /New Letter/ }))
    await user.type(screen.getByPlaceholderText(/<p>/), '<p>שלום</p>')
    expect(screen.getByTitle('composer-preview')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/AdminLettersComposer.test.tsx -t "live preview"`
Expected: FAIL — no element with title `composer-preview`.

- [ ] **Step 3: Add section headings and a live preview iframe**

Add a small section label above each group (Identify / Recipients / Content) using existing classes, and after the Body textarea block add:
```tsx
        <div className="col-span-2">
          <p className="mb-1 text-xs text-muted-foreground">Live preview:</p>
          <iframe
            title="composer-preview"
            srcDoc={(templates.find((t) => t.id === templateId)?.html ?? '{{CONTENT}}')
              .replace('{{CONTENT}}', bodyHtml || '<em>תוכן המכתב…</em>')}
            className="h-48 w-full rounded border"
            sandbox="allow-same-origin"
          />
        </div>
```

- [ ] **Step 4: Run the full composer test file**

Run: `npx vitest run tests/components/AdminLettersComposer.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Type-check + commit**
```bash
npx tsc --noEmit -p tsconfig.app.json
git add src/pages/AdminLettersPage.tsx tests/components/AdminLettersComposer.test.tsx
git commit -m "feat(letters): composer sections + live template preview (§22.5)"
```

---

## Phase 1B — Feature 2: member add-only editing

> Depends on Phase 0. File-disjoint from Phase 1A — run as a separate workflow.

### Task 6: Member contacts endpoint

**Files:**
- Modify: `server/routes/letters.ts` (add `GET /contacts` **before** the `/:id` route)
- Modify: `src/lib/api-client.ts` (add `api.letters.contacts`)
- Test: `tests/server/letters-contacts-route.test.ts` (new)

- [ ] **Step 1: Write the failing test**

`tests/server/letters-contacts-route.test.ts`:
```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, refreshTokens, letterContacts } from '../../server/db/schema'
import { issueAccessToken } from '../../server/services/auth-service'
import { FeatureFlagsRepository } from '../../server/repositories/feature-flags-repository'
import lettersRouter from '../../server/routes/letters'

const app = express()
app.use(express.json())
app.use('/api/letters', lettersRouter)
const flags = new FeatureFlagsRepository()
let token: string

describe('GET /api/letters/contacts', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(refreshTokens); await db.delete(users)
    const [u] = await db.insert(users).values({ label: 'm@x.com', email: 'm@x.com', role: 'member', createdAt: new Date() }).returning({ id: users.id })
    token = issueAccessToken({ id: u.id, email: 'm@x.com', name: 'M', role: 'member' })
    await flags.setFlag('lettersEnabled', true, '')
  })

  it('401 for anonymous', async () => {
    expect((await request(app).get('/api/letters/contacts')).status).toBe(401)
  })

  it('returns contacts and filters by q for an authed member', async () => {
    // The seed migration populated contacts; assert the shape and that q filters.
    const all = await request(app).get('/api/letters/contacts').set('Authorization', `Bearer ${token}`)
    expect(all.status).toBe(200)
    expect(Array.isArray(all.body.contacts)).toBe(true)
    expect(all.body.contacts.length).toBeGreaterThan(0)
    const filtered = await request(app).get('/api/letters/contacts?q=zzz-no-match-zzz').set('Authorization', `Bearer ${token}`)
    expect(filtered.body.contacts).toHaveLength(0)
  })

  it('404 when lettersEnabled is off', async () => {
    await flags.setFlag('lettersEnabled', false, '')
    expect((await request(app).get('/api/letters/contacts').set('Authorization', `Bearer ${token}`)).status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/letters-contacts-route.test.ts`
Expected: FAIL — `/contacts` matches the `/:id` handler → 400/404, not the contacts shape.

- [ ] **Step 3: Add the route (BEFORE `/:id`)**

In `server/routes/letters.ts`, add the contacts repo import:
```ts
import { LetterContactsRepository } from '../repositories/letter-contacts-repository'
```
instantiate near the other repos:
```ts
const contactsRepo = new LetterContactsRepository()
```
and add this handler immediately after the `GET /tags` handler (so it is registered before `GET /:id`):
```ts
// GET /api/letters/contacts — read-only address book for the member recipient picker.
// MUST be declared before `/:id` so Express doesn't treat "contacts" as an id.
router.get('/contacts', async (req, res) => {
  try {
    const q = req.query.q as string | undefined
    const contacts = q ? await contactsRepo.search(q) : await contactsRepo.list()
    res.json({ contacts })
  } catch (err) {
    console.error('[letters] contacts failed:', err)
    res.status(500).json({ error: 'Failed to load contacts' })
  }
})
```

- [ ] **Step 4: Add the api-client method**

In `src/lib/api-client.ts`, inside the member `letters: { ... }` object, add:
```ts
    contacts: (q?: string) =>
      apiFetch<{ contacts: LetterContact[] }>(`/letters/contacts${q ? `?q=${encodeURIComponent(q)}` : ''}`),
```
(`LetterContact` is already imported in this file for the admin section.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/server/letters-contacts-route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Type-check + commit**
```bash
npx tsc --noEmit -p tsconfig.server.json && npx tsc --noEmit -p tsconfig.app.json
git add server/routes/letters.ts src/lib/api-client.ts tests/server/letters-contacts-route.test.ts
git commit -m "feat(letters): member-readable contacts endpoint for recipient picker (§22.2)"
```

---

### Task 7: Member detail page — locked presets + add-only editing

On `/letters/:id`, show admin presets as locked chips, let members add curated recipients, and rebuild the mailto/Gmail URLs client-side from the merged set.

**Files:**
- Modify: `src/pages/LetterDetailPage.tsx`
- Test: `tests/components/LetterDetailEditing.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

`tests/components/LetterDetailEditing.test.tsx`:
```tsx
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { letters: {
    detail: vi.fn(),
    recordSend: vi.fn().mockResolvedValue({ ok: true }),
    contacts: vi.fn().mockResolvedValue({ contacts: [
      { id: 9, displayName: 'דובר בריאות', email: 'dover@health.gov.il', category: 'ministry', createdAt: '' },
    ] }),
  } },
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1 }, ready: true }) }))
vi.mock('@/components/layout/Header', () => ({ default: () => null }))
vi.mock('@/components/layout/Footer', () => ({ default: () => null }))

import LetterDetailPage from '@/pages/LetterDetailPage'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { api } from '@/lib/api-client'

const DETAIL = {
  letter: {
    id: 5, title: 'מכתב', subject: 'נושא', bodyPlain: 'שלום רב',
    toAddresses: [{ email: 'preset@gov.il', display_name: 'נמען קבוע' }],
    ccAddresses: [], bccAddresses: [],
  },
  renderedHtml: '<p>שלום</p>', mailtoUrl: 'mailto:preset@gov.il', gmailUrl: 'https://mail.google.com/',
}

const renderAt = () => render(
  <MemoryRouter initialEntries={['/letters/5']}>
    <Routes><Route path="/letters/:id" element={<LetterDetailPage />} /></Routes>
  </MemoryRouter>)

describe('member recipient editing', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.letters.detail).mockResolvedValue(DETAIL as never) })

  it('shows admin presets as non-removable chips', async () => {
    renderAt()
    expect(await screen.findByText('נמען קבוע')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove נמען קבוע/ })).not.toBeInTheDocument()
  })

  it('adds a curated recipient and includes it in the copied addresses', async () => {
    const user = userEvent.setup({ delay: null })
    renderAt()
    await screen.findByText('נמען קבוע')
    await user.type(screen.getByPlaceholderText(/הקלד/), 'דובר')
    await act(async () => { await new Promise((r) => setTimeout(r, 350)) })
    await user.click(await screen.findByText(/dover@health.gov.il/))
    expect(screen.getByText(/דובר בריאות/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/LetterDetailEditing.test.tsx`
Expected: FAIL — no recipient picker / preset chips on the page yet.

- [ ] **Step 3: Add member-edit state, picker, and client-side URL rebuild**

In `src/pages/LetterDetailPage.tsx`:

Add imports:
```tsx
import RecipientEditor from '@/components/letters/RecipientEditor'
import { buildMailtoUrl, buildGmailComposeUrl } from '@/lib/letter-urls'
import type { LetterDetailResponse, LetterAddress } from '@/types'
```
Add state for member additions (near the other `useState`s):
```tsx
  const [extraTo, setExtraTo] = useState<LetterAddress[]>([])
```
Add a contacts search helper and merged URLs (after `data` is available — compute inside render, guarded):
```tsx
  const searchContacts = useCallback((q: string) => api.letters.contacts(q).then((r) => r.contacts), [])
```
Replace the `handleMailto`/`handleGmail` bodies to use rebuilt URLs from the merged recipients. Compute the merged set + URLs from `data` (admin presets) + `extraTo`:
```tsx
  const mergedTo: LetterAddress[] = data ? [...data.letter.toAddresses, ...extraTo] : []
  const liveMailto = data ? buildMailtoUrl(mergedTo, data.letter.ccAddresses, data.letter.bccAddresses, data.letter.subject, data.letter.bodyPlain) : ''
  const liveGmail = data ? buildGmailComposeUrl(mergedTo, data.letter.ccAddresses, data.letter.bccAddresses, data.letter.subject, data.letter.bodyPlain) : ''
```
Point the handlers at the live URLs:
```tsx
  const handleMailto = useCallback(() => {
    if (!data || !id) return
    window.location.href = liveMailto
    api.letters.recordSend(Number(id), 'mailto').catch(() => {})
  }, [data, id, liveMailto])

  const handleGmail = useCallback(() => {
    if (!data || !id) return
    window.open(liveGmail, '_blank', 'noopener,noreferrer')
    api.letters.recordSend(Number(id), 'mailto').catch(() => {})
  }, [data, id, liveGmail])
```
Update `handleCopyAddresses` to copy the merged set:
```tsx
  const handleCopyAddresses = useCallback(async () => {
    if (!data) return
    const addresses = [...data.letter.toAddresses, ...extraTo].map((a) => a.email).join(', ')
    await navigator.clipboard.writeText(addresses)
    setCopied('addresses')
    setTimeout(() => setCopied(null), 2000)
  }, [data, extraTo])
```
In the Send Panel JSX, replace the static "נמענים" line with the editor (presets locked, additions add-only):
```tsx
                <div>
                  <span className="font-medium text-muted-foreground">נמענים: </span>
                  <RecipientEditor
                    label=""
                    value={extraTo}
                    onChange={setExtraTo}
                    search={searchContacts}
                    allowFreeForm={false}
                    lockedValue={data.letter.toAddresses}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">ניתן להוסיף נמענים מספר הכתובות בלבד.</p>
                </div>
```
Reset `extraTo` when the loaded letter changes — add `setExtraTo([])` in the `detail(...).then(...)` chain in the existing `useEffect`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/LetterDetailEditing.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Type-check + commit**
```bash
npx tsc --noEmit -p tsconfig.app.json
git add src/pages/LetterDetailPage.tsx tests/components/LetterDetailEditing.test.tsx
git commit -m "feat(letters): member add-only recipient editing on detail page (§22.2)"
```

---

## Final verification (after both phases merge)

- [ ] `npm run lint`
- [ ] `npx tsc --noEmit -p tsconfig.app.json && npx tsc --noEmit -p tsconfig.server.json`
- [ ] `npm test`
- [ ] `npm run build`  *(per the build-check memory — build, not just tsc, before pushing)*
- [ ] Update docs: note the new member contacts endpoint in `CLAUDE.md`'s API table and the shared URL module in `docs/architecture.md`; mark §22.1/22.2/22.5/22.6 resolved in `BACKLOG.md`.
- [ ] Merge to master per the session workflow.
