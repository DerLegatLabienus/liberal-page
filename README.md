# הליברלים בליכוד

A Hebrew-first public website for **הליברלים בליכוד**: a liberal movement working inside Likud to promote individual liberty, free markets, civil rights, accountable government, and democratic institutions.

The site combines public movement content with a practical Knesset tracking tool. It is built to help members and supporters understand what is happening in the Knesset, follow relevant bills and committees, and connect parliamentary activity back to the movement's public work.

## What This Project Includes

- A responsive public homepage with movement messaging, gallery content, FAQ, and join calls to action.
- Hebrew/English UI support, with the parliamentary tracker currently enabled for Hebrew users.
- A Knesset tracker drawer for monitored bills, committees, and MKs.
- Search and tracking flows for Knesset bills, committees, and members.
- Local JSON-backed content and tracking data under `src/data/`.
- An Express API for tracking actions, Knesset data refreshes, summaries, and cache-backed lookup routes.
- Polling services that refresh tracked parliamentary data and mark new updates.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite |
| Styling | Tailwind CSS, shadcn-style local UI primitives |
| Backend | Express 5, `tsx` |
| Data | JSON files in `src/data/` |
| External sources | Knesset OData API, Knesset website APIs, oknesset.org |
| Tests | Vitest, Testing Library |

## Local Development

Install dependencies:

```bash
npm install
```

Run the frontend and backend together:

```bash
npm run dev
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

## Project Structure

```text
src/
  components/
    layout/       Header, footer, Knesset tracker drawer
    sections/     Homepage sections
    parliament/   Bill, committee, MK, and tracking UI
    ui/           Local UI primitives
  data/           JSON content and local datastore
  hooks/          Direction, parliament, and lookup hooks
  lib/            API client helpers
server/
  routes/         Express API routes
  services/       Knesset integrations, polling, summarization
  repositories/   JSON cache repositories
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

This repository is the application code for the movement website and tracker. It is not an official Knesset service. Parliamentary data is fetched from public sources and cached locally for the site experience.
