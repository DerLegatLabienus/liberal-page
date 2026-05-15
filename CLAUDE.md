# Liberal Page — Dev Instructions

## Stack

- **Frontend:** React 18 + Vite (port 5173)
- **Backend:** Express + tsx (port 3001)
- Both live in the same repo. Vite proxies `/api/*` → `localhost:3001`.

## Running the Dev Environment

Always start **both** servers before testing. Use the combined command:

```bash
npm run dev
```

This runs `vite` and `tsx watch server/index.ts` concurrently.

Or start separately:

```bash
npm run dev:frontend   # Vite on :5173
npm run dev:server     # Express on :3001
```

## Restarting After Changes

- **Backend (`server/`):** Must be manually restarted — `tsx watch` handles file changes automatically when using `npm run dev:server`, but if the process was started manually (`tsx server/index.ts`), kill and restart it.
- **Frontend (`src/`):** Vite hot-reloads automatically; no restart needed for most changes. Restart if config files change (`vite.config.ts`, `tailwind.config.ts`, `index.css`).

**When in doubt, restart both.** Kill any running processes first:

```bash
pkill -f "vite|tsx server" && npm run dev
```

## Testing

Run the unit test suite (does not require the servers to be running):

```bash
npm test
```

After making backend changes, also manually verify the API:

```bash
curl http://localhost:3001/api/health
```

## Key Ports

| Service | Port | URL |
|---------|------|-----|
| Frontend | 5173 | http://localhost:5173 |
| Backend | 3001 | http://localhost:3001 |

The frontend is accessible from Windows at `http://localhost:5173` (WSL2 localhost forwarding is enabled via `host: '0.0.0.0'` in vite.config.ts).
