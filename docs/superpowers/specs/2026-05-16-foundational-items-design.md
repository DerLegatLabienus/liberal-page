# Foundational Items 1 + 2 — Design

**Date:** 2026-05-16
**Status:** Approved
**Project:** `/home/aavitan/claude-projects/liberal-page`

---

## Overview

Two prerequisite tasks that must be completed before any other feature work. Together they turn the project from a two-component stub (Header + Hero) into a fully rendered, navigable page.

---

## Item 1 — Join form (fix join CTA)

### Problem

`site.json.joinFormUrl` is empty. `JoinSection` renders a placeholder div. The join CTA — the primary conversion goal of the site — goes nowhere.

### Decision

Support the existing effective-soft.co.il forms permanently, not as a stopgap. The existing likudliberal.org join page (`/mitpakdim/`) offers 4 form variants:

| URL | Scenario |
|-----|---------|
| `effective-soft.co.il/XZone/pfo?uid=licudliberal` | New Likud member — individual |
| `effective-soft.co.il/XZone/pfo?uid=licudliberal2` | New Likud member — couple |
| `effective-soft.co.il/XZone/pfo?uid=licudliberal3` | Existing Likud member joining group — individual |
| `effective-soft.co.il/XZone/pfo?uid=licudliberal4` | Existing Likud member joining group — couple |

A single iframe URL (current `JoinSection` design) cannot surface all 4 variants. The component is redesigned to match the existing site's logic.

### Design

**Replace the iframe with two CTA buttons** that open the appropriate form in a new tab:

- **Button 1 (primary, gold):** "התפקד לליכוד ולתא" — opens `uid=licudliberal` in a new tab. A small secondary text link "הצטרפות זוגית" (`uid=licudliberal2`) sits directly beneath it.
- **Button 2 (outlined):** "כבר חבר ליכוד? הצטרף לקבוצה" — opens `uid=licudliberal3` in a new tab. A small secondary text link "הצטרפות זוגית" (`uid=licudliberal4`) sits directly beneath it.

**`site.json` changes:** Remove the empty `joinFormUrl` field. The 4 form URLs are constants in `JoinSection.tsx` — they are fixed links to a specific external system, not site configuration. Removing them from `site.json` avoids the false impression that they are editable CMS content.

**`types.ts` change:** Remove `joinFormUrl` from `SiteConfig`.

---

## Item 2 — Wire all sections into App.tsx

### Problem

`App.tsx` renders only `<Header />` and `<Hero />`. Seven built components (BillsTracker, Representatives, UpdatesFeed, PrimariesSection, ProtocolsList, JoinSection, Footer) are unreachable. The site is not functional.

### Layout decision

**Full-width sections, no sidebar.** The Sidebar component (with About / Past recs / Constitution tabs) is not mounted in this pass. It is built and ready but deferred. The `.layout` grid class (sidebar + main) is not used.

### Section order

Follows the existing nav link order, with Representatives slotted between Bills and Updates:

```
<Header />          ← sticky, 56px, existing
<main>
  <Hero />          ← existing
  <BillsTracker />  ← #bills
  <Representatives />  ← #representatives  (new nav entry)
  <UpdatesFeed />   ← #updates
  <PrimariesSection />  ← #primaries
  <ProtocolsList /> ← #protocols
  <JoinSection />   ← #join  (redesigned — see Item 1)
</main>
<Footer />
```

### Nav update

`Header.tsx` has a hardcoded `navItems` array. Add `{ label: 'נציגים', href: '#representatives' }` between `חקיקה` and `עדכונים`.

### App.tsx

```tsx
import Header from './components/Header';
import Hero from './components/Hero';
import BillsTracker from './components/BillsTracker';
import Representatives from './components/Representatives';
import UpdatesFeed from './components/UpdatesFeed';
import PrimariesSection from './components/PrimariesSection';
import ProtocolsList from './components/ProtocolsList';
import JoinSection from './components/JoinSection';
import Footer from './components/Footer';
import './styles/globals.css';

function App() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <BillsTracker />
        <Representatives />
        <UpdatesFeed />
        <PrimariesSection />
        <ProtocolsList />
        <JoinSection />
      </main>
      <Footer />
    </>
  );
}

export default App;
```

No layout grid wrapper — sections are full-width. Each section already handles its own `padding` via the `.section` global class.

---

## Files changed

| File | Change |
|------|--------|
| `src/App.tsx` | Mount all 7 sections + Footer |
| `src/components/Header.tsx` | Add נציגים nav entry |
| `src/components/JoinSection.tsx` | Replace iframe with two CTA buttons + secondary couple links |
| `src/components/JoinSection.module.css` | Style CTA buttons (gold primary, outlined secondary) |
| `src/data/site.json` | Remove `joinFormUrl` field |
| `src/types.ts` | Remove `joinFormUrl` from `SiteConfig` |
| `docs/architecture.md` | Update App.tsx wiring status |
| `docs/data-schema.md` | Update SiteConfig — remove joinFormUrl |

---

## Verification

1. `npm run dev` — page loads with all sections visible
2. Scroll: all 7 sections render with correct content from their JSON files
3. Nav links: each anchor scrolls to its section (including new נציגים link)
4. Join buttons: both CTAs open the correct effective-soft URL in a new tab
5. `tsc --noEmit` — no type errors (joinFormUrl removed from type + data)
6. Mobile (480px): sections stack correctly, no overflow
