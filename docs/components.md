# Component Reference

All components are in `src/components/`. Each has a co-located `.module.css` file. No external UI library — all styling is custom CSS Modules + global tokens.

---

## Mounted in App.tsx

Only two components are currently rendered:

| Component | Section id | Data source |
|-----------|-----------|-------------|
| `Header` | — | `site.json` |
| `Hero` | — | `site.json` |

All others are built and data-wired but not yet composed into the page (backlog foundational item #2).

---

## Header

**Data:** `SiteConfig` (partyName, logoPath)  
**Renders:** Logo image (with `logoFallback` div on error) + party name on the right; nav links on the left.  
**Nav links (hardcoded):** חקיקה → `#bills`, עדכונים → `#updates`, פריימריז → `#primaries`, פרוטוקולים → `#protocols`, הצטרפו → `#join` (accent style).  
**State:** `logoError: boolean` — switches to fallback on `img.onError`.

---

## Hero

**Data:** `SiteConfig` (cellSubtitle, heroHeadline, heroTagline)  
**Renders:** Subtitle label, H1 headline, tagline paragraph, CTA button.  
**CTA:** Smooth-scrolls to `#join` section on click.

---

## BillsTracker

**Data:** `Bill[]` from `bills.json`  
**Renders:** Section with title/subtitle + CSS grid of `BillCard` components.  
**Section id:** `#bills`

### BillCard

**Props:** `{ bill: Bill }`  
**Renders:**
- Left accent bar color driven by `bill.position` (`accentGold` / `accentRed` / `accentGray`)
- Bill number (`פ/1234`)
- Bill title
- Two badges: status badge + position badge (CSS classes from `globals.css`)
- Notes text

**Badge class map:**

| Value | CSS class |
|-------|-----------|
| בוועדה | `.badge-committee` |
| הצבעה קרובה | `.badge-vote` |
| עבר | `.badge-passed` |
| נדחה | `.badge-rejected` |
| תומכים | `.badge-support` |
| מתנגדים | `.badge-oppose` |
| עוקבים | `.badge-monitor` |

---

## Representatives

**Data:** `Representative[]` from `representatives.json`  
**Renders:** Section with title + flex-wrap grid of inline cards.  
**Section id:** `#representatives`  
**Card fields (top to bottom):** Avatar circle (initials), name, role, party (muted), committee (gold).  
**`party` field:** Required on all records — no default/fallback in component or data.  
**Note:** Cards are built inline — no separate `RepresentativeCard` component.

---

## UpdatesFeed

**Data:** `Update[]` from `updates.json`  
**Renders:** Ordered list. Each item: date badge (`dd/mm`) + title + description.  
**Section id:** `#updates`  
**Date format:** strips year — shows `dd/mm` only.

---

## PrimariesSection

**Data:** `PrimariesCycle[]` from `primaries.json`  
**Renders:** If a `current` cycle exists: cycle name H3 + grid of `CandidateCard`. Otherwise: empty state message.  
**Section id:** `#primaries`

### CandidateCard

**Props:** `{ candidate: PrimariesCandidate }`  
**Renders:** Gold star icon, avatar circle (auto-derived initials), name, role, optional reason block.  
**Initials:** First char of first two whitespace-separated words in `name`.

---

## ProtocolsList

**Data:** `Protocol[]` from `protocols.json`  
**Renders:** List. Each row: DOC badge, date (`dd/mm/yyyy`), title, attendee names joined by ` · `, download link.  
**Section id:** `#protocols`  
**Date format:** full `dd/mm/yyyy`.

---

## JoinSection

**Data:** `SiteConfig` (joinFormUrl)  
**Renders:** If `joinFormUrl` is set: `<iframe>`. Otherwise: placeholder text "קישור לטופס ההצטרפות לא הוגדר עדיין".  
**Section id:** `#join`

---

## Sidebar

**State:** `activeTab: 'about' | 'pastrecs' | 'constitution'`  
**Renders:** Tab bar (3 buttons) + tab content switcher.  
**Tabs:**
- `AboutTab` — renders `about.json` paragraphs + values list
- `PastRecsTab` — past primaries recommendations (reads `primaries.json` cycles where `current === false`)
- `ConstitutionTab` — links to / embeds `site.constitutionUrl`

---

## Footer

Renders party name and copyright. No data dependencies beyond `site.json` partyName.
