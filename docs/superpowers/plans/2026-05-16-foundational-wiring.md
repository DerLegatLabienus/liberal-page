# Foundational Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire all built components into a navigable page and replace the broken join CTA with working links to the existing effective-soft membership forms.

**Architecture:** Full-width sections stacked in a `<main>` element below a sticky Header. No sidebar this pass. JoinSection drops the iframe model entirely and uses direct links to four effective-soft form URLs (two member scenarios × individual/couple). Type cleanup removes `joinFormUrl` from `SiteConfig` since the URLs are now constants in the component, not configuration.

**Tech Stack:** React 18, TypeScript 5.6, Vite 5.4, CSS Modules. No test framework — verification is `tsc --noEmit` + `npm run dev` visual check.

---

## File map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/types.ts` | Modify | Remove `joinFormUrl` from `SiteConfig` |
| `src/data/site.json` | Modify | Remove `joinFormUrl` field |
| `src/components/JoinSection.tsx` | Rewrite | CTA buttons instead of iframe |
| `src/components/JoinSection.module.css` | Rewrite | Button styles; remove iframe/placeholder styles |
| `src/App.tsx` | Rewrite | Mount all sections |
| `src/components/Header.tsx` | Modify | Add נציגים nav entry |
| `docs/architecture.md` | Modify | Update App.tsx wiring status |
| `docs/data-schema.md` | Modify | Remove joinFormUrl from SiteConfig table |

---

## Task 1: Remove joinFormUrl from types and data

**Files:**
- Modify: `src/types.ts`
- Modify: `src/data/site.json`

- [ ] **Step 1: Remove `joinFormUrl` from `SiteConfig` in `src/types.ts`**

Replace the full `SiteConfig` interface with:

```typescript
export interface SiteConfig {
  partyName: string;
  cellSubtitle: string;
  heroHeadline: string;
  heroTagline: string;
  logoPath: string;
  constitutionUrl: string;
  contactEmail: string;
}
```

- [ ] **Step 2: Remove `joinFormUrl` from `src/data/site.json`**

```json
{
  "partyName": "הליברלים בליכוד",
  "cellSubtitle": "תא ליכוד · ירושלים",
  "heroHeadline": "ליברליזם בתוך הימין",
  "heroTagline": "מקדמים חקיקה, מייצגים עקרונות, ופועלים מבפנים",
  "logoPath": "/logo.png",
  "constitutionUrl": "",
  "contactEmail": ""
}
```

- [ ] **Step 3: Type-check**

```bash
cd /home/aavitan/claude-projects/liberal-page/.claude/worktrees/foundational-wiring
npx tsc --noEmit
```

Expected: errors referencing `joinFormUrl` (from JoinSection still importing the old type). That is expected — Task 2 fixes them. If you see errors from other files, stop and investigate.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/data/site.json
git commit -m "chore: remove joinFormUrl from SiteConfig and site.json"
```

---

## Task 2: Redesign JoinSection with CTA buttons

**Files:**
- Rewrite: `src/components/JoinSection.tsx`
- Rewrite: `src/components/JoinSection.module.css`

- [ ] **Step 1: Rewrite `src/components/JoinSection.tsx`**

```tsx
import styles from './JoinSection.module.css';

const JOIN_FORMS = {
  newIndividual:   'https://effective-soft.co.il/XZone/pfo?uid=licudliberal',
  newCouple:       'https://effective-soft.co.il/XZone/pfo?uid=licudliberal2',
  groupIndividual: 'https://effective-soft.co.il/XZone/pfo?uid=licudliberal3',
  groupCouple:     'https://effective-soft.co.il/XZone/pfo?uid=licudliberal4',
} as const;

export default function JoinSection() {
  return (
    <section id="join" className={styles.section}>
      <h2 className={styles.heading}>הצטרפו לתא</h2>
      <p className={styles.subtitle}>רוצים להיות חלק מהמהלך?</p>

      <div className={styles.ctaGroup}>
        <div className={styles.ctaBlock}>
          <a
            href={JOIN_FORMS.newIndividual}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.ctaPrimary}
          >
            התפקד לליכוד ולתא ←
          </a>
          <a
            href={JOIN_FORMS.newCouple}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.ctaSecondary}
          >
            הצטרפות זוגית
          </a>
        </div>

        <div className={styles.ctaBlock}>
          <a
            href={JOIN_FORMS.groupIndividual}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.ctaOutlined}
          >
            כבר חבר ליכוד? הצטרף לקבוצה ←
          </a>
          <a
            href={JOIN_FORMS.groupCouple}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.ctaSecondary}
          >
            הצטרפות זוגית
          </a>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Rewrite `src/components/JoinSection.module.css`**

```css
.section {
  background: var(--color-navy);
  padding: 3rem 2rem;
  text-align: center;
  border-bottom: 1px solid rgba(200, 168, 75, 0.3);
}

.heading {
  color: var(--color-white);
  font-family: 'David Libre', Georgia, serif;
  font-size: clamp(1.5rem, 3vw, 2rem);
  font-weight: 700;
  margin-bottom: 0.75rem;
}

.subtitle {
  color: var(--color-gold);
  font-size: 1rem;
  margin-bottom: 2.5rem;
}

.ctaGroup {
  display: flex;
  gap: 2rem;
  justify-content: center;
  flex-wrap: wrap;
}

.ctaBlock {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
}

.ctaPrimary {
  display: inline-block;
  background: var(--color-gold);
  color: var(--color-navy);
  text-decoration: none;
  font-weight: 700;
  font-size: 1rem;
  padding: 0.75rem 1.75rem;
  border-radius: 4px;
  transition: opacity 0.15s;
}

.ctaPrimary:hover {
  opacity: 0.88;
}

.ctaOutlined {
  display: inline-block;
  background: transparent;
  color: var(--color-gold);
  border: 2px solid var(--color-gold);
  text-decoration: none;
  font-weight: 700;
  font-size: 1rem;
  padding: 0.75rem 1.75rem;
  border-radius: 4px;
  transition: background 0.15s, color 0.15s;
}

.ctaOutlined:hover {
  background: rgba(200, 168, 75, 0.1);
}

.ctaSecondary {
  color: var(--color-nav-link);
  font-size: 0.82rem;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.ctaSecondary:hover {
  color: var(--color-gold);
}
```

- [ ] **Step 3: Type-check — expect clean**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/JoinSection.tsx src/components/JoinSection.module.css
git commit -m "feat: replace join iframe with effective-soft CTA buttons"
```

---

## Task 3: Wire all sections into App.tsx

**Files:**
- Rewrite: `src/App.tsx`

- [ ] **Step 1: Rewrite `src/App.tsx`**

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

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Start dev server and visually verify**

```bash
npm run dev
```

Open `http://localhost:5173` (or the port Vite reports). Scroll from top to bottom and confirm all sections are visible in order:
1. Header (sticky)
2. Hero — headline "ליברליזם בתוך הימין"
3. BillsTracker — "מעקב חקיקה" with 4 bill cards
4. Representatives — "הנציגים שלנו" with 3 MK cards
5. UpdatesFeed — "עדכונים פנימיים" with 3 items
6. PrimariesSection — "המלצות לפריימריז" with 2 candidate cards
7. ProtocolsList — "פרוטוקולים" with 3 rows
8. JoinSection — navy background, two CTA buttons in gold
9. Footer — party name + copyright

Stop the dev server (`Ctrl+C`) when done.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire all sections into App.tsx (full-width, no sidebar)"
```

---

## Task 4: Add נציגים to Header nav

**Files:**
- Modify: `src/components/Header.tsx`

- [ ] **Step 1: Add `נציגים` entry to `navItems` in `src/components/Header.tsx`**

Replace the `navItems` array (lines 8–14) with:

```typescript
const navItems = [
  { label: 'חקיקה', href: '#bills' },
  { label: 'נציגים', href: '#representatives' },
  { label: 'עדכונים', href: '#updates' },
  { label: 'פריימריז', href: '#primaries' },
  { label: 'פרוטוקולים', href: '#protocols' },
  { label: 'הצטרפו', href: '#join', isAccent: true },
];
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Verify nav link works**

```bash
npm run dev
```

Open `http://localhost:5173`. Click "נציגים" in the header. Page should smooth-scroll to the Representatives section. Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add src/components/Header.tsx
git commit -m "feat: add נציגים nav link pointing to #representatives"
```

---

## Task 5: Update docs

**Files:**
- Create: `docs/architecture.md`
- Create: `docs/data-schema.md`

> **Note:** These files were created in the main checkout but were never committed to git. They don't exist in this worktree. Create them fresh with the correct content for the post-wiring state.

- [ ] **Step 1: Create `docs/README.md`**

```markdown
# liberal-page — Knowledge Base

**Project:** הליברלים בליכוד — Jerusalem cell website
**Stack:** React 18 + TypeScript + Vite, CSS Modules, static JSON data
**Status:** All sections wired — Header, Hero, BillsTracker, Representatives, UpdatesFeed, PrimariesSection, ProtocolsList, JoinSection, Footer.

---

## Quick links

| Doc | Purpose |
|-----|---------|
| [architecture.md](./architecture.md) | Stack, folder structure, data flow |
| [data-schema.md](./data-schema.md) | TypeScript interfaces + JSON shapes |
| [components.md](./components.md) | Component reference — inputs, outputs, rendered fields |
| [backlog.md](../BACKLOG.md) | Prioritised feature + tech backlog |
```

- [ ] **Step 2: Create `docs/architecture.md`**

```markdown
# Architecture

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18.3 + TypeScript 5.6 |
| Build | Vite 5.4 |
| Styling | CSS Modules per component + `src/styles/globals.css` for shared tokens |
| Data | Static JSON files in `src/data/` — imported directly in components |
| Type checking | `tsc -b && vite build` |
| Linting | ESLint 9 with react-hooks + react-refresh plugins |

## Folder structure

\`\`\`
liberal-page/
├── src/
│   ├── App.tsx                  # Entry — Header + Hero + all 7 content sections + Footer
│   ├── main.tsx
│   ├── types.ts                 # All shared TypeScript interfaces
│   ├── styles/
│   │   └── globals.css          # CSS variables, .card, .badge-*, .section, .layout
│   ├── components/
│   │   ├── Header.tsx/.module.css
│   │   ├── Hero.tsx/.module.css
│   │   ├── BillsTracker.tsx/.module.css   — grid wrapper, delegates to BillCard
│   │   ├── BillCard.tsx/.module.css
│   │   ├── Representatives.tsx/.module.css
│   │   ├── UpdatesFeed.tsx/.module.css
│   │   ├── PrimariesSection.tsx/.module.css — delegates to CandidateCard
│   │   ├── CandidateCard.tsx/.module.css
│   │   ├── ProtocolsList.tsx/.module.css
│   │   ├── JoinSection.tsx/.module.css    — 4-variant CTA buttons (effective-soft)
│   │   ├── Footer.tsx/.module.css
│   │   ├── Sidebar.tsx/.module.css        — built but not mounted (deferred)
│   │   └── tabs/
│   │       ├── AboutTab.tsx/.module.css
│   │       ├── PastRecsTab.tsx/.module.css
│   │       └── ConstitutionTab.tsx/.module.css
│   └── data/
│       ├── site.json            # SiteConfig — party name, URLs, copy
│       ├── bills.json           # Bill[]
│       ├── representatives.json # Representative[]
│       ├── updates.json         # Update[]
│       ├── protocols.json       # Protocol[]
│       ├── primaries.json       # PrimariesCycle[]
│       └── about.json           # AboutData
├── public/
├── docs/                        # This knowledge base
└── package.json
\`\`\`

## Data flow

\`\`\`
src/data/*.json
      │  (static import, typed cast)
      ▼
Component.tsx  →  renders JSX
      │
      ▼
Vite bundles → dist/
\`\`\`

All 7 content sections are mounted. No API calls, no state management library, no routing (yet). Each section component imports its own JSON file and renders directly.

## Layout model

Full-width sections stacked in `<main>`. The `.layout` CSS class (240px sidebar grid) exists in globals.css but is not used — Sidebar is deferred. Each section uses the `.section` global class for padding and bottom border.

## Design tokens (globals.css CSS vars)

| Token | Value | Usage |
|-------|-------|-------|
| `--color-navy` | `#1a2744` | Headings, JoinSection bg, avatar bg |
| `--color-gold` | `#c8a84b` | Accents, CTA buttons, committee text |
| `--color-bg` | `#f4f2ed` | Page background |
| `--color-border` | `#dddddd` | Card/section borders |
| `--header-height` | `56px` | Layout offset |

## RTL

`body { direction: rtl; }` in globals.css. All components assume RTL layout.
```

- [ ] **Step 3: Create `docs/data-schema.md`**

```markdown
# Data Schema

All interfaces live in `src/types.ts`. All data files live in `src/data/`.

---

## SiteConfig — `src/data/site.json`

\`\`\`typescript
interface SiteConfig {
  partyName: string;
  cellSubtitle: string;
  heroHeadline: string;
  heroTagline: string;
  logoPath: string;        // "/logo.png" — served from public/
  constitutionUrl: string; // "" (empty)
  contactEmail: string;    // "" (empty)
}
\`\`\`

**Note:** `constitutionUrl` and `contactEmail` are currently empty strings — their UI surfaces (ConstitutionTab, Footer email link) handle the empty-string case gracefully.

**Join form URLs** are constants in `JoinSection.tsx`, not in `site.json`:
- `effective-soft.co.il/XZone/pfo?uid=licudliberal` — new member, individual
- `effective-soft.co.il/XZone/pfo?uid=licudliberal2` — new member, couple
- `effective-soft.co.il/XZone/pfo?uid=licudliberal3` — existing Likud member joining group, individual
- `effective-soft.co.il/XZone/pfo?uid=licudliberal4` — existing Likud member joining group, couple

---

## Bill — `src/data/bills.json`

\`\`\`typescript
interface Bill {
  id: number;
  number: string;   // "פ/1234"
  title: string;
  status: 'בוועדה' | 'הצבעה קרובה' | 'עבר' | 'נדחה';
  position: 'תומכים' | 'מתנגדים' | 'עוקבים';
  notes: string;
}
\`\`\`

---

## Representative — `src/data/representatives.json`

\`\`\`typescript
interface Representative {
  id: number;
  name: string;      // "ח\"כ רון כהן"
  role: string;      // "חבר כנסת" | "חברת כנסת"
  committee: string;
  initials: string;  // shown in avatar circle
}
\`\`\`

---

## Update — `src/data/updates.json`

\`\`\`typescript
interface Update {
  id: number;
  date: string;        // ISO: "2026-05-02"
  title: string;
  description: string;
}
\`\`\`

---

## Protocol — `src/data/protocols.json`

\`\`\`typescript
interface Protocol {
  id: number;
  date: string;
  title: string;
  attendees: string[];
  fileUrl: string;   // placeholder paths — files not yet hosted
}
\`\`\`

---

## PrimariesCycle / PrimariesCandidate — `src/data/primaries.json`

\`\`\`typescript
interface PrimariesCandidate {
  name: string;
  role: string;
  reason?: string;
}

interface PrimariesCycle {
  cycle: string;
  current: boolean;  // only the current cycle is displayed
  candidates: PrimariesCandidate[];
}
\`\`\`

---

## AboutData — `src/data/about.json`

\`\`\`typescript
interface AboutData {
  paragraphs: string[];
  values: string[];
}
\`\`\`
```

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs: add knowledge base (architecture, schema, readme)"
```

---

## Final verification

- [ ] Run `npx tsc --noEmit` — must be clean
- [ ] Run `npm run build` — must succeed with no errors
- [ ] Run `npm run dev`, open browser:
  - All 9 visible zones present top-to-bottom (header through footer)
  - Nav: clicking each link scrolls to its section
  - Join section: gold "התפקד" button and outlined "כבר חבר" button visible; each opens a new tab to the correct effective-soft URL
  - Mobile (resize to 480px): sections stack, no horizontal overflow
