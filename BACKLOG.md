# Backlog

## 1. Join Flow Analytics / Config (Priority: Low)

`JoinSection` uses a frontend-only selector that routes users to the correct
effective-soft form. The site does not collect or store membership details.

Potential future enhancement: move the URL mapping/help text to a read-only
config endpoint or add anonymous click analytics. Do not proxy submissions or
store identity/payment/signature data locally.

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
