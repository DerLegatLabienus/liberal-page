# GitHub & DevOps Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a private GitHub repo, a CI pipeline (lint → tsc → test → build → smoke test) that runs on every push, and a Claude-powered AI PR review bot.

**Architecture:** Three GitHub Actions workflows live in `.github/workflows/`. The CI workflow is a single job with sequential steps. The PR review workflow calls the Claude API via a Python script in `.github/scripts/` and posts the result as a PR comment. No deployment is involved — the health check is a local smoke test inside CI.

**Tech Stack:** GitHub Actions, Node 20, `gh` CLI, `anthropic` Python SDK, `curl`.

---

## File map

| File | Action |
|------|--------|
| `.github/workflows/ci.yml` | Create — lint, tsc, test, build, smoke test |
| `.github/workflows/pr-review.yml` | Create — Claude AI PR review on PR open/sync |
| `.github/scripts/pr_review.py` | Create — Python script that calls Claude and prints review |

No existing files are modified. The `.gitignore` already excludes `.env`.

---

## Task 1: Create the private GitHub repo

**Files:** none (one-time `gh` command)

> **Prerequisite:** You must be logged in to `gh`. Run `gh auth status` to verify. If not logged in, run `gh auth login` first.

- [ ] **Step 1: Verify `gh` is authenticated**

```bash
gh auth status
```

Expected: shows your GitHub username and a valid token.

- [ ] **Step 2: Create the private repo and push master**

Run from `/home/aavitan/claude-projects/liberal-page`:

```bash
gh repo create liberal-page --private --source=. --push --remote=origin --description "הליברלים בליכוד — Jerusalem cell website and Knesset tracker"
```

Expected output includes:
```
✓ Created repository <username>/liberal-page on GitHub
✓ Added remote https://github.com/<username>/liberal-page.git
✓ Pushed commits to https://github.com/<username>/liberal-page.git
```

- [ ] **Step 3: Add the `ANTHROPIC_API_KEY` secret**

```bash
gh secret set ANTHROPIC_API_KEY
```

Paste your API key when prompted.

Or set it via GitHub web UI: repo Settings → Secrets and variables → Actions → New repository secret, name `ANTHROPIC_API_KEY`.

- [ ] **Step 4: Set branch protection on master**

Replace `OWNER/REPO` with your actual username/repo (e.g. `avivavitan63/liberal-page`):

```bash
gh api repos/OWNER/REPO/branches/master/protection \
  --method PUT \
  --field required_status_checks='{"strict":false,"contexts":["ci"]}' \
  --field enforce_admins=false \
  --field required_pull_request_reviews=null \
  --field restrictions=null
```

Expected: HTTP 200, protection applied. The `ci` check (from Task 2) must pass before PRs can be merged.

---

## Task 2: Create the CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create directories**

```bash
mkdir -p .github/workflows .github/scripts
```

- [ ] **Step 2: Create `.github/workflows/ci.yml`**

```yaml
name: ci

on:
  push:
    branches: ["**"]
  pull_request:
    branches: ["**"]

jobs:
  ci:
    name: ci
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node 20
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Type check
        run: npx tsc --noEmit

      - name: Test
        run: npm test

      - name: Build
        run: npm run build

      - name: Smoke test — start server and hit /api/health
        run: |
          npx tsx server/index.ts &
          SERVER_PID=$!
          sleep 5
          curl -f http://localhost:3001/api/health
          CURL_EXIT=$?
          kill $SERVER_PID 2>/dev/null || true
          exit $CURL_EXIT
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add CI workflow — lint, tsc, test, build, smoke test"
```

- [ ] **Step 4: Push and verify the workflow runs**

```bash
git push origin master
```

Open `https://github.com/OWNER/REPO/actions` — the `ci` workflow should appear and go green within ~2 minutes.

---

## Task 3: Create the AI PR review workflow

**Files:**
- Create: `.github/scripts/pr_review.py`
- Create: `.github/workflows/pr-review.yml`

- [ ] **Step 1: Create `.github/scripts/pr_review.py`**

```python
#!/usr/bin/env python3
"""Claude PR reviewer — called by pr-review.yml.

Reads /tmp/diff.txt (the PR diff) and CLAUDE.md (project context),
calls the Claude API, and prints the review to stdout.
"""
import anthropic
import os
import sys


def main():
    diff_path = "/tmp/diff.txt"
    claude_md_path = "CLAUDE.md"

    try:
        diff = open(diff_path).read()
    except FileNotFoundError:
        print("No diff file found at /tmp/diff.txt", file=sys.stderr)
        sys.exit(1)

    try:
        claude_md = open(claude_md_path).read()
    except FileNotFoundError:
        claude_md = "(CLAUDE.md not found)"

    # Cap diff at ~12k chars to stay within model context budget
    if len(diff) > 12000:
        diff = diff[:12000] + "\n\n... (diff truncated)"

    if not diff.strip():
        print("Empty diff — nothing to review.")
        return

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    system = f"""You are reviewing a pull request for the Liberals in Likud (הליברלים בליכוד) website — a Hebrew/RTL React 18 + TypeScript + Vite site with an Express backend that tracks Knesset legislation.

Project conventions (from CLAUDE.md):
{claude_md}

Review the diff for:
- Correctness and bugs
- TypeScript type safety
- RTL/Hebrew content handling
- Test coverage gaps
- Adherence to project conventions

Structure your response as:

**Summary:** one sentence.

**Critical (must fix):** list issues that would break functionality or introduce bugs. If none, write "None."

**Important (should fix):** list issues that affect quality or maintainability. If none, write "None."

Skip minor style nits. Be concise."""

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=system,
        messages=[
            {
                "role": "user",
                "content": f"Review this diff:\n\n```diff\n{diff}\n```",
            }
        ],
    )

    print(response.content[0].text)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Create `.github/workflows/pr-review.yml`**

```yaml
name: pr-review

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  pull-requests: write
  contents: read

jobs:
  review:
    name: Claude PR Review
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Get diff
        run: git diff origin/master...HEAD > /tmp/diff.txt

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install anthropic SDK
        run: pip install anthropic

      - name: Run Claude review
        run: python .github/scripts/pr_review.py > /tmp/review.txt
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

      - name: Post review comment
        run: |
          REVIEW=$(cat /tmp/review.txt)
          gh pr comment ${{ github.event.pull_request.number }} \
            --body "🤖 **Claude PR Review**

${REVIEW}"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 3: Make the script executable and commit**

```bash
chmod +x .github/scripts/pr_review.py
git add .github/scripts/pr_review.py .github/workflows/pr-review.yml
git commit -m "ci: add Claude AI PR review workflow"
git push origin master
```

---

## Task 4: Verify end-to-end

- [ ] **Step 1: Verify CI on master runs green**

```bash
gh run list --limit 3
```

Expected: most recent run shows `completed` / `success`. Or open `https://github.com/OWNER/REPO/actions`.

- [ ] **Step 2: Open a test PR to verify AI review fires**

```bash
git checkout -b test/verify-pr-review
echo "" >> README.md
git add README.md
git commit -m "test: trigger PR review"
git push -u origin test/verify-pr-review
gh pr create --title "Test PR review" --body "Testing the Claude reviewer"
```

Expected: within ~1 minute, a comment from `github-actions[bot]` appears on the PR starting with `🤖 **Claude PR Review**`.

- [ ] **Step 3: Close and delete the test branch**

```bash
gh pr close test/verify-pr-review --delete-branch
git checkout master
git branch -d test/verify-pr-review
```
