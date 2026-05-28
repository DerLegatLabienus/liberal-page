# Mobile Responsiveness Design

## Context

The site has a solid responsive foundation — Header, Hero, About, Gallery, Join, and all tracked-item cards already behave correctly on mobile. However, four specific areas break or degrade on narrow screens (≤ 375px, e.g. iPhone SE / 14 mini).

## Scope

Fix four targeted issues. No full redesign; no changes to components already working.

---

## Issue 1 — ParliamentStrip: horizontal scroll

**File:** `src/components/sections/ParliamentStrip.tsx`

**Problem:** Cards have `min-w-[180px] shrink-0` inside a non-wrapping flex row. On a 375px screen two cards already exceed the viewport, causing unintentional horizontal scroll.

**Fix:**
- Remove `shrink-0` from bill/committee cards.
- Change `min-w-[180px]` → `min-w-[150px] sm:min-w-[180px]` so cards shrink slightly on very narrow phones.
- Add `flex-wrap` to the cards container so cards wrap to a second row when needed.
- Change the "more" button from `min-w-[120px] shrink-0` to `w-full sm:w-auto` so it spans the full width as a final row item on mobile.

---

## Issue 2 — AddTrackingInput: cramped input + button

**File:** `src/components/parliament/AddTrackingInput.tsx`

**Problem:** The URL input and "Add" button share a single `flex` row with no mobile stack. On narrow screens the input shrinks to the point where the placeholder is unreadable and typing is uncomfortable.

**Fix:**
- Change the wrapper from `flex gap-2` → `flex flex-col gap-2 sm:flex-row`.
- Make the button `w-full sm:w-auto` so it spans the full width when stacked.

---

## Issue 3 — BillOverviewRow: long titles + committee chip overflow

**File:** `src/components/parliament/BillOverviewRow.tsx`

**Problem:** Knesset bill titles can be 80+ characters. In the collapsed row the title has no truncation, pushing the status chip onto a new line or causing layout shift. The committee chip (now populated after the Phase 2 fix) also lacks a max-width constraint.

**Fix:**
- In the collapsed button row, wrap title + status chip in a `flex items-center justify-between gap-2` container.
- Apply `flex-1 min-w-0 truncate` to the title span — shows ellipsis when truncated; full text is visible when the row is expanded.
- Apply `shrink-0` to the status chip so it never gets squeezed.
- Apply `max-w-[10rem] truncate` to the committee `<p>` in the expanded view so very long committee names don't overflow narrow screens.

---

## Issue 4 — Comboboxes: dropdown too tall on mobile

**Files:** `src/components/parliament/MkCombobox.tsx`, `BillSearchCombobox.tsx`, `CommitteeCombobox.tsx`

**Problem:** All three comboboxes use a fixed `max-h-60` (240px) dropdown. On a phone with the software keyboard open, the visible viewport can be as short as 300–350px. A 240px dropdown leaves almost no room for the input itself and context above it.

**Fix:**
- Change `max-h-60` → `max-h-[40vh] sm:max-h-60` on each dropdown list container.
- 40vh = 40% of the visible viewport height, which adapts automatically to both portrait and landscape orientation and to whether the keyboard is open.

---

## Files to modify

| File | Change |
|------|--------|
| `src/components/sections/ParliamentStrip.tsx` | flex-wrap, remove shrink-0, responsive min-w, full-width "more" button |
| `src/components/parliament/AddTrackingInput.tsx` | flex-col sm:flex-row stacking |
| `src/components/parliament/BillOverviewRow.tsx` | truncate on title, shrink-0 on chip, max-w on committee |
| `src/components/parliament/MkCombobox.tsx` | max-h-[40vh] sm:max-h-60 |
| `src/components/parliament/BillSearchCombobox.tsx` | max-h-[40vh] sm:max-h-60 |
| `src/components/parliament/CommitteeCombobox.tsx` | max-h-[40vh] sm:max-h-60 |

## Not in scope

Header, HeroSection, AboutSection, GallerySection, JoinSection, ParliamentDrawer shell, BillCard, MkCard, CommitteeCard — all already responsive. No changes.

## Testing

- Vitest component tests: update any snapshot/class assertions that reference the changed class strings.
- Manual: resize browser DevTools to 375px width and verify no horizontal scroll on any page; open the parliament drawer and verify the add-tracking input stacks vertically; open a combobox and verify the dropdown does not overflow the phone frame.
