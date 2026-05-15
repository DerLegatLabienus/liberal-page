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

```
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
```

## Data flow

```
src/data/*.json
      │  (static import, typed cast)
      ▼
Component.tsx  →  renders JSX
      │
      ▼
Vite bundles → dist/
```

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
