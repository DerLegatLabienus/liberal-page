# Letter detail page UX redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/letters/:id` as one column — title + share, channel tabs, one morphing message pane, and exactly one split-button control per channel.

**Architecture:** Presentation-only refactor. `LetterDetailPage` keeps data fetching, selected-channel state, and the send handlers; three new focused components under `src/components/letters/` own the tab bar, the message pane, and the split button + menu. No API, data-model, or analytics change.

**Tech Stack:** React 18 + Vite, Tailwind, Vitest + @testing-library/react (happy-dom), Hebrew-first RTL.

## Global Constraints

- **Presentation only.** Do NOT change the detail API response (`{ letter, channels }`), `buildChannelSends`, the share-URL gate, or `buildLetterPreviewDoc`.
- **Analytics must fire exactly as today:** `api.letters.recordSend(id, 'mailto')` for BOTH the mailto and Gmail actions, `api.letters.recordSend(id, 'copy')` for copy, and `api.letters.publicSend(id, kind, contactId)` per SMS/WhatsApp recipient. Moving controls into a menu is where send-tracking usually gets dropped — don't.
- **Hebrew hardcoded** in this UI (no `t()`/locale keys), matching the existing letters pages. The one exception is the already-i18n'd `CopyShareLink`.
- **Channel color only** as a small dot on the tab and a tinted bubble border — never a full-color button.
- **Gate:** `npm test` && `npx tsc --noEmit` && `npm run lint` && `npm run build`. Baseline: 792 passing, build exit 0, lint 0 errors.
- **Commit per task; do not push** until the whole redesign is done and gated.
- **Commit trailers:**
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UPPKuAwc48W6D5uVucwx1A
  ```
- Spec: `docs/superpowers/specs/2026-07-19-letter-detail-ux-redesign-design.md`

## File Structure

**Create:**
- `src/components/letters/ChannelTabs.tsx` — tab bar; `role="tablist"`, RTL-aware roving tabindex; renders nothing when ≤1 channel.
- `src/components/letters/ChannelMessage.tsx` — the morphing pane (email iframe sheet vs. SMS/WhatsApp bubble).
- `src/components/letters/ChannelSendButton.tsx` — split button + menu; owns open/close, outside-click, Escape, ARIA.

**Modify:**
- `src/pages/LetterDetailPage.tsx` — one-column layout, selected-channel state, wires the three components; deletes the 3 stacked email buttons, the explanation paragraph, and the old preview panel.
- `tests/components/LetterDetailPage.test.tsx` — updated for the new UI.

**Create (tests):** `tests/components/ChannelSendButton.test.tsx`

---

### Task 1: `ChannelMessage` — the morphing pane

**Files:**
- Create: `src/components/letters/ChannelMessage.tsx`
- Test: covered via `LetterDetailPage.test.tsx` in Task 4 (pure presentational, no logic worth isolating)

**Interfaces:**
- Consumes: `ChannelSend` from `@/types`; `buildLetterPreviewDoc` from `@/lib/letter-preview`.
- Produces: `export default function ChannelMessage({ channel }: { channel: ChannelSend })`

- [ ] **Step 1: Write the component**

```tsx
import type { ChannelSend } from '@/types'
import { buildLetterPreviewDoc } from '@/lib/letter-preview'

/**
 * One framed surface that changes form by channel: a letter sheet for email,
 * a chat bubble for SMS/WhatsApp. Keeping both in the same frame is what makes
 * switching tabs read as one object changing shape rather than three screens.
 */
export default function ChannelMessage({ channel }: { channel: ChannelSend }) {
  if (channel.kind === 'email') {
    return (
      <iframe
        srcDoc={buildLetterPreviewDoc(channel.renderedHtml ?? '')}
        title="תצוגת מכתב"
        className="h-[420px] w-full rounded-xl border border-border bg-background"
        sandbox="allow-same-origin"
      />
    )
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <p
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bs-sm border bg-muted/30 px-4 py-3 text-sm leading-relaxed ${
          channel.kind === 'whatsapp' ? 'border-emerald-500/40' : 'border-border'
        }`}
      >
        {channel.bodyText}
      </p>
    </div>
  )
}
```

Note: `rounded-bs-sm` is not a stock Tailwind class — use `rounded-bl-sm` (LTR-agnostic enough here) or plain `rounded-2xl`; pick one that compiles and keep the asymmetric-corner look if trivial.

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | grep -n "ChannelMessage"` → no errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/components/letters/ChannelMessage.tsx
git commit -m "feat(letters): channel message pane (letter sheet / chat bubble)"
```

---

### Task 2: `ChannelSendButton` — one control per channel

**Files:**
- Create: `src/components/letters/ChannelSendButton.tsx`
- Test: `tests/components/ChannelSendButton.test.tsx`

**Interfaces:**
- Consumes: `ChannelSend`, `RecipientSendLink` from `@/types`.
- Produces:
  ```tsx
  export interface ChannelSendButtonProps {
    channel: ChannelSend
    onPrimary: () => void              // email: open mailto. sms/whatsapp: unused (menu opens)
    onGmail: () => void                // email only
    onCopy: () => void                 // email only
    onRecipient: (r: RecipientSendLink) => void  // sms/whatsapp only
    copied: boolean                    // drives the "✓ הועתק" menu-item label
  }
  export default function ChannelSendButton(props: ChannelSendButtonProps)
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/ChannelSendButton.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect } from 'vitest'
import ChannelSendButton from '@/components/letters/ChannelSendButton'
import type { ChannelSend } from '@/types'

const email: ChannelSend = {
  kind: 'email', enabled: true, bodyText: 'plain', unavailableCount: 0,
  mailtoUrl: 'mailto:a@b.c', gmailUrl: 'https://mail.google.com/x', renderedHtml: '<p>hi</p>',
}
const sms: ChannelSend = {
  kind: 'sms', enabled: true, bodyText: 'קצר', unavailableCount: 0,
  recipients: [
    { contactId: 1, displayName: 'דן', photoUrl: null, url: 'sms:+9725?&body=x' },
    { contactId: 2, displayName: 'מיכל', photoUrl: null, url: 'sms:+9726?&body=x' },
  ],
}
const noop = () => {}

describe('ChannelSendButton', () => {
  it('email: exactly one visible button; Gmail and copy live in the menu', async () => {
    const onGmail = vi.fn(); const onPrimary = vi.fn()
    const u = userEvent.setup({ delay: null })
    render(<ChannelSendButton channel={email} onPrimary={onPrimary} onGmail={onGmail} onCopy={noop} onRecipient={noop} copied={false} />)

    expect(screen.queryByRole('menuitem', { name: /Gmail/ })).not.toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: /שליחה במייל/ }))
    expect(onPrimary).toHaveBeenCalled()

    await u.click(screen.getByRole('button', { name: /אפשרויות/ }))
    await u.click(screen.getByRole('menuitem', { name: /Gmail/ }))
    expect(onGmail).toHaveBeenCalled()
  })

  it('sms: the primary button opens the recipient menu and picking one fires onRecipient', async () => {
    const onRecipient = vi.fn()
    const u = userEvent.setup({ delay: null })
    render(<ChannelSendButton channel={sms} onPrimary={noop} onGmail={noop} onCopy={noop} onRecipient={onRecipient} copied={false} />)

    await u.click(screen.getByRole('button', { name: /שליחה/ }))
    await u.click(screen.getByRole('menuitem', { name: /דן/ }))
    expect(onRecipient).toHaveBeenCalledWith(expect.objectContaining({ contactId: 1 }))
  })

  it('closes the menu on Escape', async () => {
    const u = userEvent.setup({ delay: null })
    render(<ChannelSendButton channel={sms} onPrimary={noop} onGmail={noop} onCopy={noop} onRecipient={noop} copied={false} />)
    await u.click(screen.getByRole('button', { name: /שליחה/ }))
    expect(screen.getByRole('menuitem', { name: /דן/ })).toBeInTheDocument()
    await u.keyboard('{Escape}')
    expect(screen.queryByRole('menuitem', { name: /דן/ })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/ChannelSendButton.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useRef, useState } from 'react'
import type { ChannelSend, RecipientSendLink } from '@/types'

export interface ChannelSendButtonProps {
  channel: ChannelSend
  onPrimary: () => void
  onGmail: () => void
  onCopy: () => void
  onRecipient: (r: RecipientSendLink) => void
  copied: boolean
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('')
}

export default function ChannelSendButton({ channel, onPrimary, onGmail, onCopy, onRecipient, copied }: ChannelSendButtonProps) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const isEmail = channel.kind === 'email'

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onKey) }
  }, [open])

  // email sends on primary click; sms/whatsapp have no default recipient, so the
  // primary click opens the same menu the caret does.
  const handlePrimary = () => { if (isEmail) onPrimary(); else setOpen((v) => !v) }

  return (
    <div ref={wrap} className="relative inline-flex">
      <button
        ref={trigger}
        type="button"
        onClick={handlePrimary}
        className={`inline-flex items-center gap-2 bg-primary px-5 py-2.5 font-semibold text-primary-foreground hover:bg-primary/90 ${isEmail ? 'rounded-s-lg' : 'rounded-lg'}`}
        aria-haspopup={isEmail ? undefined : 'menu'}
        aria-expanded={isEmail ? undefined : open}
      >
        {isEmail ? 'שליחה במייל' : 'שליחה'}
      </button>
      {isEmail && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="אפשרויות נוספות"
          aria-haspopup="menu"
          aria-expanded={open}
          className="rounded-e-lg border-s border-primary-foreground/25 bg-primary px-3 text-primary-foreground hover:bg-primary/90"
        >
          ▾
        </button>
      )}

      {open && (
        <div role="menu" className="absolute bottom-[calc(100%+8px)] start-0 z-20 min-w-[240px] rounded-xl border border-border bg-card p-1.5 shadow-lg">
          {isEmail ? (
            <>
              <button role="menuitem" type="button" onClick={() => { onGmail(); setOpen(false) }} className="block w-full rounded-lg px-3 py-2 text-start text-sm hover:bg-muted">
                פתיחה ב-Gmail
              </button>
              <button role="menuitem" type="button" onClick={() => onCopy()} className="block w-full rounded-lg px-3 py-2 text-start text-sm hover:bg-muted">
                {copied ? '✓ הועתק' : 'העתקת הטקסט'}
              </button>
              <p className="border-t border-border px-3 pb-1 pt-2 text-xs text-muted-foreground">
                אם תוכנת המייל לא נפתחת במחשב — השתמשו ב-Gmail.
              </p>
            </>
          ) : (
            (channel.recipients ?? []).map((r) => (
              <button
                key={r.contactId}
                role="menuitem"
                type="button"
                onClick={() => { onRecipient(r); setOpen(false) }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start text-sm hover:bg-muted"
              >
                {r.photoUrl
                  ? <img src={r.photoUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                  : <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold">{initials(r.displayName)}</span>}
                {r.displayName}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/ChannelSendButton.test.tsx` → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/letters/ChannelSendButton.tsx tests/components/ChannelSendButton.test.tsx
git commit -m "feat(letters): single split-button send control per channel"
```

---

### Task 3: `ChannelTabs`

**Files:**
- Create: `src/components/letters/ChannelTabs.tsx`
- Test: covered via `LetterDetailPage.test.tsx` (Task 4)

**Interfaces:**
- Consumes: `ChannelKind` from `@/types`.
- Produces:
  ```tsx
  export default function ChannelTabs({ kinds, selected, onSelect }: {
    kinds: ChannelKind[]; selected: ChannelKind; onSelect: (k: ChannelKind) => void
  })
  ```
  Renders `null` when `kinds.length <= 1`.

- [ ] **Step 1: Implement**

```tsx
import type { ChannelKind } from '@/types'

const LABELS: Record<ChannelKind, string> = { email: 'מייל', sms: 'SMS', whatsapp: 'וואטסאפ' }
const DOT: Record<ChannelKind, string> = { email: 'bg-primary', sms: 'bg-slate-500', whatsapp: 'bg-emerald-500' }

/** Tab bar for a letter's enabled channels. Hidden when there's only one — a lone tab is chrome.
 *  RTL arrow keys mirror HomePanels.tsx: in RTL, Left = forward. */
export default function ChannelTabs({ kinds, selected, onSelect }: {
  kinds: ChannelKind[]; selected: ChannelKind; onSelect: (k: ChannelKind) => void
}) {
  if (kinds.length <= 1) return null
  const move = (delta: number) => {
    const i = kinds.indexOf(selected)
    const next = kinds[Math.min(Math.max(i + delta, 0), kinds.length - 1)]
    if (next) onSelect(next)
  }
  return (
    <div
      role="tablist"
      className="flex gap-1 border-b border-border px-5"
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); move(1) }
        else if (e.key === 'ArrowRight') { e.preventDefault(); move(-1) }
      }}
    >
      {kinds.map((k) => (
        <button
          key={k}
          role="tab"
          type="button"
          aria-selected={k === selected}
          tabIndex={k === selected ? 0 : -1}
          onClick={() => onSelect(k)}
          className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
            k === selected ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${DOT[k]}`} />
          {LABELS[k]}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | grep -n "ChannelTabs"` → no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/letters/ChannelTabs.tsx
git commit -m "feat(letters): channel tab bar"
```

---

### Task 4: Rebuild `LetterDetailPage` around the three components

**Files:**
- Modify: `src/pages/LetterDetailPage.tsx`
- Modify: `tests/components/LetterDetailPage.test.tsx`

**Interfaces:**
- Consumes: `ChannelTabs`, `ChannelMessage`, `ChannelSendButton` (Tasks 1–3), existing `CopyShareLink`.

- [ ] **Step 1: Update the tests first**

In `tests/components/LetterDetailPage.test.tsx`, keep the existing DETAIL fixture and replace the UI assertions:

```tsx
it('defaults to the email channel and shows its letter in the pane', async () => {
  const { container } = renderAt()
  await screen.findByRole('button', { name: /שליחה במייל/ })
  expect(container.querySelector('iframe')).toBeInTheDocument()
})

it('renders exactly one send control per channel (old stacked buttons are gone)', async () => {
  renderAt()
  await screen.findByRole('button', { name: /שליחה במייל/ })
  expect(screen.queryByRole('button', { name: /פתח ב-Gmail/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /העתק גוף/ })).not.toBeInTheDocument()
})

it('switching to the SMS tab shows the message text and a single send button', async () => {
  const u = userEvent.setup({ delay: null })
  renderAt()
  await u.click(await screen.findByRole('tab', { name: /SMS/ }))
  expect(screen.getByText('תוכן ההודעה')).toBeInTheDocument()
  await u.click(screen.getByRole('button', { name: /שליחה/ }))
  await u.click(screen.getByRole('menuitem', { name: /דן/ }))
  expect(api.letters.publicSend).toHaveBeenCalledWith(5, 'sms', 1)
})

it('email primary click records a mailto send', async () => {
  const u = userEvent.setup({ delay: null })
  renderAt()
  await u.click(await screen.findByRole('button', { name: /שליחה במייל/ }))
  expect(api.letters.recordSend).toHaveBeenCalledWith(5, 'mailto')
})
```
Keep the existing share-link tests (they still apply). Delete the obsolete "renders one send button per SMS recipient" and "has no open in new tab" assertions that no longer match the UI.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/components/LetterDetailPage.test.tsx`
Expected: FAIL — no tabs / no `שליחה במייל` control yet.

- [ ] **Step 3: Rebuild the page**

Replace the `{data && (…)}` block with the one-column card. Keep `handleMailto`, `handleGmail`, `handleCopyHtml`, `handleRecipient`, `copied`, and the data fetching exactly as they are. Add:

```tsx
const enabled = data ? data.channels.filter((c) => c.enabled) : []
const kinds = enabled.map((c) => c.kind)
const [tab, setTab] = useState<ChannelKind | null>(null)
const active = enabled.find((c) => c.kind === tab) ?? enabled.find((c) => c.kind === 'email') ?? enabled[0]
```

Render:

```tsx
{data && active && (
  <div className="mx-auto max-w-3xl overflow-hidden rounded-xl border bg-card shadow-sm">
    <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-5">
      <h1 className="text-xl font-bold">{data.letter.title}</h1>
      {data.letter.shareUrl && (
        <CopyShareLink
          url={data.letter.shareUrl}
          className="shrink-0 whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        />
      )}
    </div>

    <ChannelTabs kinds={kinds} selected={active.kind} onSelect={setTab} />

    <div className="px-5 py-5">
      <ChannelMessage channel={active} />
    </div>

    <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
      <ChannelSendButton
        channel={active}
        copied={copied}
        onPrimary={() => handleMailto(active)}
        onGmail={() => handleGmail(active)}
        onCopy={() => handleCopyHtml(active)}
        onRecipient={(r) => handleRecipient(active.kind === 'whatsapp' ? 'whatsapp' : 'sms', r)}
      />
      {active.unavailableCount > 0 && (
        <p className="text-xs text-amber-700">{active.unavailableCount} נמענים אינם זמינים בערוץ זה.</p>
      )}
    </div>
  </div>
)}
<LetterPrivacyNotice className="mx-auto mt-4 max-w-3xl" />
```

Delete: the `[350px_1fr]` grid, the three stacked email buttons, the explanation paragraph (`"שלח ממייל שלי" פותח את…`), the old per-recipient button list, and the old preview panel. Import `ChannelKind` from `@/types` and the three new components. Keep `previewDoc` only if `ChannelMessage` doesn't already own it — it does, so remove `previewHtml`/`previewDoc` from the page.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/components/LetterDetailPage.test.tsx tests/components/ChannelSendButton.test.tsx` → PASS.

- [ ] **Step 5: Full gate**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all green, build exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/pages/LetterDetailPage.tsx tests/components/LetterDetailPage.test.tsx
git commit -m "feat(letters): one-column letter page with channel tabs and a single send control"
```

## Self-Review notes (spec coverage)

- One-column layout, header + share ghost button → Task 4. ✅
- Morphing message pane (sheet / bubble) → Task 1. ✅
- One split-button per channel; Gmail + copy in the menu; recipient menu for sms/wa → Task 2. ✅
- Tabs, hidden when ≤1 channel, RTL arrows, default = email else first → Tasks 3, 4. ✅
- Removed: counts, badges, explanation paragraph, stacked buttons → Task 4. ✅
- Kept: `unavailableCount` warning only when > 0 → Task 4. ✅
- Analytics unchanged → asserted in Task 4 tests. ✅
- Menu a11y (Escape, outside click, roles) → Task 2. ✅
