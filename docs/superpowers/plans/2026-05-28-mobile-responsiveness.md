# Mobile Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four targeted mobile layout issues so the site works correctly on 375px-wide phones with no horizontal scroll and no cramped UI.

**Architecture:** Pure CSS class changes — Tailwind responsive utilities (`sm:` prefix, `flex-col`, `flex-wrap`, `min-w-0`, `max-h-[40vh]`). No logic changes, no new components. Each task is independent and can be committed separately.

**Tech Stack:** React 18, Tailwind CSS v4, Vitest + @testing-library/react (happy-dom)

---

## File Map

| File | What changes |
|------|-------------|
| `src/components/sections/ParliamentStrip.tsx` | Remove `shrink-0` from cards; responsive `min-w`; `w-full sm:w-auto` on "more" button |
| `src/components/parliament/AddTrackingInput.tsx` | `flex-col sm:flex-row` on wrapper; `w-full sm:w-auto` on button |
| `src/components/parliament/BillOverviewRow.tsx` | `min-w-0` on title span; `max-w-[10rem] truncate` on committee `<p>` |
| `src/components/parliament/MkCombobox.tsx` | `max-h-[40vh] sm:max-h-64` on dropdown scroll div |
| `src/components/parliament/BillSearchCombobox.tsx` | `max-h-[40vh] sm:max-h-60` on dropdown scroll div |
| `src/components/parliament/CommitteeCombobox.tsx` | `max-h-[40vh] sm:max-h-64` on dropdown scroll div |
| `tests/components/ParliamentStrip.test.tsx` | Add mobile layout assertions |
| `tests/components/AddTrackingInput.test.tsx` | Add mobile stacking assertion |
| `tests/components/BillOverviewRow.test.tsx` | Add `min-w-0` + committee truncation assertions |
| `tests/components/MkCombobox.test.tsx` | Add responsive max-height assertion |
| `tests/components/BillSearchCombobox.test.tsx` | Add responsive max-height assertion |
| `tests/components/CommitteeCombobox.test.tsx` | Add responsive max-height assertion |

---

## Task 1: ParliamentStrip — remove shrink-0, responsive min-width, full-width more button

**Files:**
- Modify: `src/components/sections/ParliamentStrip.tsx` (lines 41–74)
- Test: `tests/components/ParliamentStrip.test.tsx`

- [ ] **Step 1: Write the failing tests**

Open `tests/components/ParliamentStrip.test.tsx` and replace the entire file with:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import ParliamentStrip from '@/components/sections/ParliamentStrip'

const BILL = {
  id: 1, oknesset_id: 'b1', number: '1', title: 'הצעת חוק חופש העיסוק',
  status: 'בוועדה' as const, position: 'תומכים' as const,
  notes: '', committee: '', sourceUrl: '', documentUrl: null, hasNewData: false,
}
const COMMITTEE = {
  id: 2, oknesset_id: 'c2', name: 'ועדת הכספים', chair: '',
  lastSessionDate: '2026-05-01', lastSessionSummary: null,
  lastSessionDocumentUrl: null, sourceUrl: '', hasNewData: false, lastPolledAt: null,
}

describe('ParliamentStrip', () => {
  it('does not render a constitution link (it lives in the hero CTA)', () => {
    render(
      <MemoryRouter>
        <ParliamentStrip bills={[]} committees={[]} onOpenDrawer={vi.fn()} />
      </MemoryRouter>,
    )
    const constitutionLink = screen
      .queryAllByRole('link')
      .find((l) => l.getAttribute('href') === '/constitution')
    expect(constitutionLink).toBeFalsy()
  })

  it('bill cards do not have shrink-0 (allows wrapping on narrow screens)', () => {
    render(
      <MemoryRouter>
        <ParliamentStrip bills={[BILL]} committees={[]} onOpenDrawer={vi.fn()} />
      </MemoryRouter>,
    )
    // The bill card is the first div with border-s-4 styling
    const card = document.querySelector('[class*="border-s-4"]')
    expect(card).not.toBeNull()
    expect(card!.className).not.toContain('shrink-0')
  })

  it('bill cards use responsive min-width (min-w-[150px] on mobile)', () => {
    render(
      <MemoryRouter>
        <ParliamentStrip bills={[BILL]} committees={[]} onOpenDrawer={vi.fn()} />
      </MemoryRouter>,
    )
    const card = document.querySelector('[class*="border-s-4"]')
    expect(card!.className).toContain('min-w-[150px]')
  })

  it('"more" button spans full width on mobile (w-full sm:w-auto)', () => {
    render(
      <MemoryRouter>
        <ParliamentStrip bills={[]} committees={[]} onOpenDrawer={vi.fn()} />
      </MemoryRouter>,
    )
    const moreBtn = screen.getByText(/עוד נתונים/i).closest('button')!
    expect(moreBtn.className).toContain('w-full')
    expect(moreBtn.className).toContain('sm:w-auto')
  })
})
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
npx vitest run tests/components/ParliamentStrip.test.tsx
```

Expected: 2–3 of the new tests FAIL (shrink-0, min-w-[150px], w-full) because the current code has `shrink-0`, `min-w-[180px]`, and `min-w-[120px] shrink-0`.

- [ ] **Step 3: Implement the fix in ParliamentStrip.tsx**

Open `src/components/sections/ParliamentStrip.tsx`. Make these three targeted changes:

**Bill cards** — line ~46, change:
```tsx
className={`min-w-[180px] shrink-0 rounded-lg border border-s-4 bg-white px-4 py-3 text-right shadow-sm ${STATUS_COLORS[bill.status] ?? 'border-slate-300 bg-slate-50'}`}
```
to:
```tsx
className={`min-w-[150px] sm:min-w-[180px] rounded-lg border border-s-4 bg-white px-4 py-3 text-right shadow-sm ${STATUS_COLORS[bill.status] ?? 'border-slate-300 bg-slate-50'}`}
```

**Committee cards** — line ~57, change:
```tsx
className="min-w-[180px] shrink-0 rounded-lg border border-s-4 border-blue-500 bg-white px-4 py-3 text-right shadow-sm"
```
to:
```tsx
className="min-w-[150px] sm:min-w-[180px] rounded-lg border border-s-4 border-blue-500 bg-white px-4 py-3 text-right shadow-sm"
```

**More button** — line ~68, change:
```tsx
className="flex min-w-[120px] shrink-0 items-center justify-center rounded-lg border border-dashed border-primary/40 bg-white px-4 py-3 text-sm font-medium text-primary shadow-sm hover:bg-primary/5"
```
to:
```tsx
className="flex w-full items-center justify-center rounded-lg border border-dashed border-primary/40 bg-white px-4 py-3 text-sm font-medium text-primary shadow-sm hover:bg-primary/5 sm:w-auto"
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/components/ParliamentStrip.test.tsx
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/sections/ParliamentStrip.tsx tests/components/ParliamentStrip.test.tsx
git commit -m "fix(mobile): ParliamentStrip cards wrap on narrow screens"
```

---

## Task 2: AddTrackingInput — stack input and button vertically on mobile

**Files:**
- Modify: `src/components/parliament/AddTrackingInput.tsx` (lines 54–66)
- Test: `tests/components/AddTrackingInput.test.tsx`

- [ ] **Step 1: Write the failing test**

Open `tests/components/AddTrackingInput.test.tsx` and add these two tests inside the existing `describe('AddTrackingInput', ...)` block, after the last existing `it(...)`:

```tsx
  it('input+button wrapper stacks vertically on mobile (flex-col sm:flex-row)', () => {
    render(<AddTrackingInput onAdd={vi.fn()} />)
    const input = screen.getByPlaceholderText(/הדבק קישור/i)
    // Walk up to the immediate flex wrapper (the div containing Input + Button)
    const wrapper = input.closest('div[class*="flex"]')!
    expect(wrapper.className).toContain('flex-col')
    expect(wrapper.className).toContain('sm:flex-row')
  })

  it('submit button is full-width on mobile (w-full sm:w-auto)', () => {
    render(<AddTrackingInput onAdd={vi.fn()} />)
    const btn = screen.getByRole('button', { name: /הוסף/i })
    expect(btn.className).toContain('w-full')
    expect(btn.className).toContain('sm:w-auto')
  })
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
npx vitest run tests/components/AddTrackingInput.test.tsx
```

Expected: the two new tests FAIL because the wrapper has `flex gap-2` (no `flex-col`) and the button has no `w-full`.

- [ ] **Step 3: Implement the fix in AddTrackingInput.tsx**

Open `src/components/parliament/AddTrackingInput.tsx`.

**Wrapper div** — line 54, change:
```tsx
      <div className="flex gap-2">
```
to:
```tsx
      <div className="flex flex-col gap-2 sm:flex-row">
```

**Button** — line 63, change:
```tsx
        <Button size="sm" onClick={handleSubmit} disabled={!canSubmit || loading}>
```
to:
```tsx
        <Button size="sm" onClick={handleSubmit} disabled={!canSubmit || loading} className="w-full sm:w-auto">
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/components/AddTrackingInput.test.tsx
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/parliament/AddTrackingInput.tsx tests/components/AddTrackingInput.test.tsx
git commit -m "fix(mobile): stack AddTrackingInput vertically on narrow screens"
```

---

## Task 3: BillOverviewRow — min-w-0 on title, truncate on committee chip

**Files:**
- Modify: `src/components/parliament/BillOverviewRow.tsx` (lines 15, 23)
- Test: `tests/components/BillOverviewRow.test.tsx`

**Background:** The title span already has `flex-1 truncate`, but `truncate` only works in a flex container when the element also has `min-width: 0` (Tailwind: `min-w-0`). Without it, the flex item's minimum size is its content, so it won't shrink and the text won't truncate. The committee `<p>` has no class at all and needs `max-w-[10rem] truncate` to prevent long committee names overflowing the expanded row.

- [ ] **Step 1: Write the failing tests**

Open `tests/components/BillOverviewRow.test.tsx` and add these two tests inside the existing `describe('BillOverviewRow', ...)` block:

```tsx
  it('title span has min-w-0 so truncate works inside flex on narrow screens', () => {
    render(<BillOverviewRow bill={BILL} />)
    const titleSpan = screen.getByText('הצעת חוק חופש העיסוק')
    expect(titleSpan).toHaveClass('min-w-0')
  })

  it('committee name is truncated in expanded view', async () => {
    const billWithCommittee = { ...BILL, committee: 'ועדת הכספים' }
    render(<BillOverviewRow bill={billWithCommittee} />)
    await userEvent.click(screen.getByRole('button', { name: /הצעת חוק חופש העיסוק/ }))
    const committeeEl = screen.getByText('ועדת הכספים')
    expect(committeeEl).toHaveClass('truncate')
  })
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
npx vitest run tests/components/BillOverviewRow.test.tsx
```

Expected: both new tests FAIL — title span is missing `min-w-0`, committee `<p>` has no class.

- [ ] **Step 3: Implement the fix in BillOverviewRow.tsx**

Open `src/components/parliament/BillOverviewRow.tsx`.

**Title span** — line 15, change:
```tsx
          <span className="flex-1 truncate font-medium">{bill.title}</span>
```
to:
```tsx
          <span className="flex-1 min-w-0 truncate font-medium">{bill.title}</span>
```

**Committee paragraph** — line 23, change:
```tsx
          {bill.committee && <p>{bill.committee}</p>}
```
to:
```tsx
          {bill.committee && <p className="max-w-[10rem] truncate">{bill.committee}</p>}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/components/BillOverviewRow.test.tsx
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/parliament/BillOverviewRow.tsx tests/components/BillOverviewRow.test.tsx
git commit -m "fix(mobile): truncate long bill titles and committee names in overview rows"
```

---

## Task 4: Comboboxes — responsive dropdown max-height

**Files:**
- Modify: `src/components/parliament/MkCombobox.tsx` (line 66)
- Modify: `src/components/parliament/BillSearchCombobox.tsx` (line 68)
- Modify: `src/components/parliament/CommitteeCombobox.tsx` (line 48)
- Test: `tests/components/MkCombobox.test.tsx`
- Test: `tests/components/BillSearchCombobox.test.tsx`
- Test: `tests/components/CommitteeCombobox.test.tsx`

**Background:** All three comboboxes have a fixed-pixel `max-h-60` or `max-h-64` (240–256px) on the scrollable results list. On a phone with the keyboard open, the visible viewport can be as short as 300px; a 256px dropdown leaves almost no breathing room. Changing to `max-h-[40vh]` makes the dropdown at most 40% of whatever viewport is currently visible — it adapts automatically to portrait vs landscape and to the keyboard being open.

- [ ] **Step 1: Write the failing tests**

Add one test to each of the three test files. Each test opens the dropdown and checks the scrollable div's class.

**`tests/components/MkCombobox.test.tsx`** — add inside `describe('MkCombobox', ...)`:
```tsx
  it('dropdown list uses responsive max-height (max-h-[40vh] sm:max-h-64)', async () => {
    const user = userEvent.setup()
    render(<MkCombobox onSelect={vi.fn()} selectedSiteId={null} />)
    await user.click(screen.getByText('חפש ח"כ...'))
    // The scrollable div wraps the list items
    const scrollDiv = document.querySelector('.overflow-y-auto')!
    expect(scrollDiv.className).toContain('max-h-[40vh]')
    expect(scrollDiv.className).toContain('sm:max-h-64')
  })
```

**`tests/components/BillSearchCombobox.test.tsx`** — add inside `describe('BillSearchCombobox', ...)`:
```tsx
  it('dropdown list uses responsive max-height (max-h-[40vh] sm:max-h-60)', async () => {
    const user = userEvent.setup({ delay: null })
    render(<BillSearchCombobox onAdd={vi.fn()} />)
    await user.type(screen.getByPlaceholderText(/חפש הצ"ח/i), 'חופש')
    await act(async () => { await new Promise((r) => setTimeout(r, 350)) })
    const scrollDiv = document.querySelector('.overflow-y-auto')!
    expect(scrollDiv.className).toContain('max-h-[40vh]')
    expect(scrollDiv.className).toContain('sm:max-h-60')
  })
```

**`tests/components/CommitteeCombobox.test.tsx`** — add inside the first `describe('CommitteeCombobox', ...)`:
```tsx
  it('dropdown list uses responsive max-height (max-h-[40vh] sm:max-h-64)', async () => {
    const user = userEvent.setup()
    render(<CommitteeCombobox onAdd={vi.fn()} />)
    await user.click(screen.getByText(/חפש ועדה/i))
    const scrollDiv = document.querySelector('.overflow-y-auto')!
    expect(scrollDiv.className).toContain('max-h-[40vh]')
    expect(scrollDiv.className).toContain('sm:max-h-64')
  })
```

- [ ] **Step 2: Run the three test files to verify the new tests fail**

```bash
npx vitest run tests/components/MkCombobox.test.tsx tests/components/BillSearchCombobox.test.tsx tests/components/CommitteeCombobox.test.tsx
```

Expected: the three new `max-h-[40vh]` tests FAIL; all existing tests pass.

- [ ] **Step 3: Implement the fix in all three combobox components**

**`src/components/parliament/MkCombobox.tsx`** — line 66, change:
```tsx
          <div className="max-h-64 overflow-y-auto">
```
to:
```tsx
          <div className="max-h-[40vh] overflow-y-auto sm:max-h-64">
```

**`src/components/parliament/BillSearchCombobox.tsx`** — line 68 (inside the results dropdown), change:
```tsx
          <div className="max-h-60 overflow-y-auto">
```
to:
```tsx
          <div className="max-h-[40vh] overflow-y-auto sm:max-h-60">
```

**`src/components/parliament/CommitteeCombobox.tsx`** — line 48, change:
```tsx
          <div className="max-h-64 overflow-y-auto">
```
to:
```tsx
          <div className="max-h-[40vh] overflow-y-auto sm:max-h-64">
```

- [ ] **Step 4: Run all three test files to verify they pass**

```bash
npx vitest run tests/components/MkCombobox.test.tsx tests/components/BillSearchCombobox.test.tsx tests/components/CommitteeCombobox.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/parliament/MkCombobox.tsx src/components/parliament/BillSearchCombobox.tsx src/components/parliament/CommitteeCombobox.tsx tests/components/MkCombobox.test.tsx tests/components/BillSearchCombobox.test.tsx tests/components/CommitteeCombobox.test.tsx
git commit -m "fix(mobile): responsive dropdown height in all three comboboxes"
```

---

## Task 5: Final verification

- [ ] **Step 1: Run the full test suite**

```bash
npx vitest run
```

Expected: all tests pass (should be 233+ passing, 5 skipped).

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Done**

All four mobile issues are fixed. The worktree is ready to merge to master.
