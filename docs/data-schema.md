# Data Schema

All interfaces live in `src/types.ts`. All data files live in `src/data/`.

---

## SiteConfig — `src/data/site.json`

```typescript
interface SiteConfig {
  partyName: string;
  cellSubtitle: string;
  heroHeadline: string;
  heroTagline: string;
  logoPath: string;        // "/logo.png" — served from public/
  constitutionUrl: string; // "" (empty)
  contactEmail: string;    // "" (empty)
}
```

**Note:** `constitutionUrl` and `contactEmail` are currently empty strings — their UI surfaces (ConstitutionTab, Footer email link) handle the empty-string case gracefully.

**Join form URLs** are constants in `JoinSection.tsx`, not in `site.json`:
- `effective-soft.co.il/XZone/pfo?uid=licudliberal` — new member, individual
- `effective-soft.co.il/XZone/pfo?uid=licudliberal2` — new member, couple
- `effective-soft.co.il/XZone/pfo?uid=licudliberal3` — existing Likud member joining group, individual
- `effective-soft.co.il/XZone/pfo?uid=licudliberal4` — existing Likud member joining group, couple

---

## Bill — `src/data/bills.json`

```typescript
interface Bill {
  id: number;
  number: string;   // "פ/1234"
  title: string;
  status: 'בוועדה' | 'הצבעה קרובה' | 'עבר' | 'נדחה';
  position: 'תומכים' | 'מתנגדים' | 'עוקבים';
  notes: string;
}
```

---

## Representative — `src/data/representatives.json`

```typescript
interface Representative {
  id: number;
  name: string;      // "ח\"כ רון כהן"
  role: string;      // "חבר כנסת" | "חברת כנסת"
  committee: string;
  initials: string;  // shown in avatar circle
}
```

---

## Update — `src/data/updates.json`

```typescript
interface Update {
  id: number;
  date: string;        // ISO: "2026-05-02"
  title: string;
  description: string;
}
```

---

## Protocol — `src/data/protocols.json`

```typescript
interface Protocol {
  id: number;
  date: string;
  title: string;
  attendees: string[];
  fileUrl: string;   // placeholder paths — files not yet hosted
}
```

---

## PrimariesCycle / PrimariesCandidate — `src/data/primaries.json`

```typescript
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
```

---

## AboutData — `src/data/about.json`

```typescript
interface AboutData {
  paragraphs: string[];
  values: string[];
}
```
