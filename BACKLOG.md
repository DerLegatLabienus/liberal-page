# Backlog

## 1. Modernized Hitkpakdut Form (Priority: High)

`src/components/parliament/JoinForm.tsx` is built with all fields (name, phone, email, ID, neighborhood).
Currently the "הצטרפות" CTA in `JoinSection.tsx` links to the official Likud registration page.

**To activate:** Wire `JoinForm` as the primary CTA in `JoinSection.tsx` and add
`POST /api/members/join` to the Express server that writes submissions to
`src/data/members.json`. Replace the external link button with the form.

## 2. Database Migration (Priority: Medium)

Replace `src/data/*.json` files with a proper database (PostgreSQL or SQLite).
All server services already read/write through helper functions (`readItems`, `writeItems`)
in each route file — swap those functions for repository calls.

## 3. Multi-Language Support (Priority: Low)

Add an English (LTR) version of the site. `useDirection()` already observes
`document.documentElement.dir` — switching the attribute flips all directional
components automatically.

## 4. User Accounts & Alerts (Priority: Low)

Member login, personalized tracking lists, email alerts on bill status changes.
Requires database (item 2 above) and an email service.
