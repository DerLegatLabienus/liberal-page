# GitHub & DevOps Setup — Design

**Date:** 2026-05-18
**Status:** Approved

---

## Overview

Set up a private GitHub repository, a CI pipeline that runs on every push, a server smoke test, and an AI-powered PR review bot using the Claude API.

---

## Section 1: GitHub repo setup

### Steps (one-time)

1. **Create private repo** via `gh repo create`:
   ```bash
   gh repo create liberal-page --private --source=. --push --remote=origin
   ```

2. **Add `ANTHROPIC_API_KEY` secret** — GitHub repo Settings → Secrets and variables → Actions → New repository secret. Used by the PR review workflow.

3. **Branch protection on `master`** — require the `ci` status check to pass before merging a PR. Direct push to `master` stays allowed (single contributor). No PR requirement enforced.

4. **`.gitignore` addition** — ensure `.env` files are excluded:
   ```
   .env
   .env.*
   ```

---

## Section 2: CI workflow

**File:** `.github/workflows/ci.yml`

**Triggers:**
- `push` to any branch
- `pull_request` to any branch

**Node version:** 20

**Cache:** `~/.npm` keyed by `package-lock.json` hash

**Jobs (sequential, fast-fail):**

| Step | Command | Purpose |
|------|---------|---------|
| checkout | `actions/checkout@v4` | |
| setup-node | `actions/setup-node@v4` with cache | Install Node 20, restore npm cache |
| install | `npm ci` | Clean install |
| lint | `npm run lint` | ESLint |
| tsc | `npx tsc --noEmit` | Type check |
| test | `npm test` | 71 Vitest tests |
| build | `npm run build` | Vite bundle |
| smoke-test | Start server, hit `/api/health`, stop | Server boots and routes respond |

**Smoke test implementation:**
```yaml
- name: Smoke test
  run: |
    npx tsx server/index.ts &
    SERVER_PID=$!
    sleep 4
    curl -f http://localhost:3001/api/health
    kill $SERVER_PID
```

The `/api/health` endpoint already exists in the Express server.

**Expected runtime:** ~60 seconds with cache warm, ~2 minutes cold.

---

## Section 3: AI PR review

**File:** `.github/workflows/pr-review.yml`

**Triggers:** `pull_request` — types `opened` and `synchronize`

**Permissions:**
```yaml
permissions:
  pull-requests: write
  contents: read
```

**Secret required:** `ANTHROPIC_API_KEY` (set in Section 1)

**Steps:**

1. Checkout (with full history: `fetch-depth: 0`)
2. Get diff: `git diff origin/master...HEAD > /tmp/diff.txt`
3. Post to Claude API, capture review text
4. Post review as PR comment via `gh pr comment`

**Claude API call (Python script in workflow):**
```python
import anthropic, os

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
diff = open("/tmp/diff.txt").read()[:12000]  # cap at ~12k chars
claude_md = open("CLAUDE.md").read()

system = f"""You are reviewing a pull request for the Liberals in Likud website — a Hebrew/RTL React 18 + TypeScript + Vite site with an Express backend that tracks Knesset legislation.

Project conventions:
{claude_md}

Review for: correctness, TypeScript type safety, RTL/Hebrew content handling, test coverage gaps, adherence to project conventions.

Keep the review concise. Flag Critical issues (must fix) and Important issues (should fix). Skip minor style nits. Start with a one-line summary."""

response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    messages=[{"role": "user", "content": f"Review this diff:\n\n```diff\n{diff}\n```"}],
    system=system,
)
print(response.content[0].text)
```

**Review comment format** posted to the PR:
```
🤖 **Claude PR Review**

<review text>
```

**When it fires:** Only on PRs. Direct pushes to `master` run the CI job but skip this review.

---

## Files created

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | Lint → tsc → test → build → smoke test on every push |
| `.github/workflows/pr-review.yml` | Claude AI review on PR open/update |
| `.github/scripts/pr_review.py` | Python script called by the review workflow |

---

## Out of scope

- Deployment / hosting (no live URL yet)
- Scheduled health check of a live URL (nothing to ping)
- Auto-merge or auto-approve
- Dependabot (can be added later with one config file)
