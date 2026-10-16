# Setting up a new device

From a fresh machine to a passing `npm run -s loop:gate`. Commands, ports and day-to-day workflow
are in `CLAUDE.md`; this page is only what a new machine needs once.

The developer works in **WSL2 (Ubuntu-20.04) on Windows**. On Windows, the repo is reached at
`\\wsl.localhost\Ubuntu-20.04\home\<user>\claude-projects\liberal-page`. Everything below runs
inside WSL.

## 1. Tools

| Tool | Why | Check |
|---|---|---|
| **Node 22** (`package.json` `engines`, and what CI uses) | Everything | `node --version` → `v22.x` |
| **git** | — | `git --version` |
| **GitHub CLI**, signed in (`gh auth login`) | The backlog is GitHub issues; the loop scripts, `gh run watch` for CI | `gh auth status` |
| **Docker** (Docker Desktop with WSL integration, or Docker in WSL) | Only for the offline local database and the optional MinIO | `docker compose version` |
| **Python 3.10+** | Only for graphify (step 6) | `python3 --version` |

## 2. Clone and install

```bash
git clone https://github.com/DerLegatLabienus/liberal-page.git
cd liberal-page
npm install
npx playwright install chromium   # only for npm run smoke:browser
```

## 3. Environment (`.env`)

```bash
cp .env.example .env
```

`.env.example` explains every variable. A local machine needs only these:

| Variable | Set it to |
|---|---|
| `DATABASE_URL` | A safe database: see step 4. **Never the Neon `production` branch.** |
| `JWT_SECRET` | Any long random string (`openssl rand -hex 32`). Without it, every sign-in fails. |
| `ALLOW_DEV_LOGIN` | `true`, to get the "Dev Sign In (admin)" / "(member)" buttons instead of a real Google account. It can never take effect on the deployed backend (`server/services/auth-providers/dev.ts`). |

Everything else (Resend, Anthropic, Calendly, Turnstile, R2) can stay unset. Each integration
degrades without crashing (`CLAUDE.md`, "Local full-stack dev — what's real vs. faked").

## 4. Database

Pick one; switching later is a one-line `.env` edit. Tests need neither: they use in-memory pglite.

- **Neon `dev` branch (default).** A schema-only branch with no real rows. Copy its connection
  string from the Neon console (project `Liberal-page`, branch `dev`) into `DATABASE_URL`.
- **Local Docker Postgres (offline).** Set `DATABASE_URL` to the commented Docker line in
  `.env.example`, then `npm run db:up` and, for test data, `npm run db:seed`.

Migrations apply when the server starts.

## 5. Check it works

```bash
npm run -s loop:gate   # tests, tsc, lint, build — all four must pass
npm run dev            # http://localhost:5173 (frontend), http://localhost:3001 (API)
curl http://localhost:3001/api/health
```

Sign in with a Dev Sign In button to see the member and admin pages.

## 6. Claude Code on this machine

None of this is in the repo; each machine sets it up once.

- **MCP servers.** Neon (the production database; read and verify only) and Render (deploy
  status). Add them with `claude mcp add`, signed in to the developer's accounts. `CLAUDE.md`
  ("Infrastructure & Tooling Map") lists the project and workspace IDs.
- **graphify** (the code knowledge graph in `graphify-out/`, gitignored):
  1. `pip install --user graphifyy` (two y's), so `graphify` is on your `PATH`.
  2. `graphify hook install` in the repo, for the git hooks that rebuild the code layer.
  3. Copy the three hook scripts `graphify-guard.sh`, `graphify-post-merge.sh` and
     `graphify-stale-docs.sh` into `~/.claude/hooks/` from an existing machine, and add their
     entries to `.claude/settings.local.json` (`PreToolUse` for the guard, `SessionStart` for
     stale docs). They are per-machine and not in the repo.
  4. Build the graph once with `/graphify` in a Claude session. The docs layer needs an LLM, so
     it is only refreshed on request (`/graphify --update`).
- **Bash sandbox (`/sandbox`).** With the sandbox on, `tsx` cannot open its IPC pipe, so every
  `npm run loop:*` script, the gate and the dev server fail with `listen EPERM`. Linux cannot
  allow a single socket path, so choose one in `.claude/settings.local.json`:
  - **Safer (recommended):** run those commands outside the sandbox and keep sockets blocked:
    `"sandbox": { "excludedCommands": ["npm run *", "npx tsx *", "npx vitest *"] }`.
  - **⚠ Security risk:** `"sandbox": { "network": { "allowAllUnixSockets": true } }`. Every
    sandboxed command can then reach any local socket, **including the Docker socket, which is
    root on the host**. The developer's main machine uses this, as an accepted risk; do not
    copy it to a new machine without deciding that again.

## 7. Never on a development machine

- A `DATABASE_URL` pointing at Neon `production`. It holds real emails and live session tokens,
  and nothing in code stops it.
- Production secrets in `.env`. Production one-off scripts take the production URL on the
  command line only, from Neon's `get_connection_string`, and only with the developer's go-ahead
  (`CLAUDE.md`).
