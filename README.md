# הליברלים בליכוד

A Hebrew-first public website for **הליברלים בליכוד**: a liberal movement working inside Likud to promote individual liberty, free markets, civil rights, accountable government, and democratic institutions.

The site combines public movement content with a practical Knesset tracking tool. It is built to help members and supporters understand what is happening in the Knesset, follow relevant bills and committees, and connect parliamentary activity back to the movement's public work.

## What This Project Includes

- A responsive public homepage with movement messaging, gallery content, FAQ, join calls to action, and a Calendly-backed "Meet Us" section for external visitors.
- Hebrew/English UI support, with the parliamentary tracker currently enabled for Hebrew users.
- A Knesset tracker drawer for monitored bills, committees, and MKs.
- Search and tracking flows for Knesset bills, committees, and members via OData comboboxes.
- Invite-only Google sign-in with JWT sessions, per-user personal tracking lists, email alerts on bill status changes, and an admin panel for managing invites, users, email templates, and feature flags.
- A background poller that refreshes tracked parliamentary data, sends digest emails, and reclaims storage automatically.
- An Express API for tracking actions, Knesset data refreshes, AI-backed protocol summaries, and analytics.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite |
| Styling | Tailwind CSS, shadcn-style local UI primitives |
| Backend | Express 5, `tsx` |
| Database | Postgres (Drizzle ORM + `node-postgres`; pglite in tests) |
| External sources | Knesset OData API, Knesset website APIs, oknesset.org, Calendly |
| Tests | Vitest, Testing Library |

## Local Development

Install dependencies:

```bash
npm install
```

Copy `.env.example` → `.env`, then start the database:

```bash
npm run db:up      # start local Postgres (Docker)
npm run db:seed    # load test data (one-time)
npm run dev        # frontend + backend together
```

The frontend runs at `http://localhost:5173` and proxies `/api/*` requests to the Express backend at `http://localhost:3001`.

Useful commands:

```bash
npm run dev:frontend
npm run dev:server
npm run build
npm run lint
npm test
```

See `CLAUDE.md` for the full command reference.

## Project Structure

```text
src/
  components/
    admin/        Admin panel (invites, users, templates, flags)
    layout/       Header, footer, auth control, Knesset tracker drawer
    sections/     Homepage sections (Hero, About, Gallery, FAQ, Join, MeetUs)
    parliament/   Bill, committee, MK, and tracking UI
    ui/           Local UI primitives
  data/           Static JSON content (about, faq, gallery, site — not tracking data)
  hooks/          Direction, parliament, feature flags, and lookup hooks
  lib/            API client, auth context, toast context
server/
  routes/         Express API routes
  services/       Knesset integrations, polling, email, Calendly, summarization
  repositories/   Postgres repositories (one per domain)
  db/             Drizzle schema, migrations, client factory
scripts/
  seed-data/      Curated baseline (bills, MKs, committees, feature flags)
tests/            Component, unit, and server tests
docs/             Architecture and project documentation
```

## Documentation

- [Architecture](docs/architecture.md)
- [Components](docs/components.md)
- [Data schema](docs/data-schema.md)
- [Project knowledge base](docs/README.md)
- [Backlog](BACKLOG.md)

## Notes

This repository is the application code for the movement website and tracker. It is not an official Knesset service. Parliamentary data is fetched from public sources and cached in Postgres for the site experience.
