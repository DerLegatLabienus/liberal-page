# Hourly code-quality loop

Run in a Claude Code session you can leave open:

```
/loop 1h Run an isolated code-quality pass on this repo, then report.

Invoke `superpowers:using-git-worktrees` first and do all work in a side worktree
named `quality-<YYYYMMDD-HHmm>` branched off the current `master` — never touch the
primary working tree, never `git stash`, never check out a branch in the main repo.
The user is actively editing in the main tree; treat it as read-only.

In the worktree, run the full gate and capture real output for each:
  npm ci --prefer-offline --no-audit   (only if node_modules is missing)
  npm test
  npx tsc --noEmit
  npm run lint
  npm run build

Then review what changed on `master` since the last loop iteration
(`git log --oneline -20`, `git diff HEAD~N`) for correctness bugs, dead code,
duplicated logic, and violations of `docs/design-system.md` (token utilities only,
Hebrew-first RTL on public surfaces, a11y baseline).

Rules:
- Invoke `superpowers:verification-before-completion` before claiming anything
  passes — quote the actual command output, never assert from memory.
- If a check fails, invoke `superpowers:systematic-debugging` and find the root
  cause before proposing a fix. Do not guess.
- Fix ONLY unambiguous, self-contained defects (a broken type, a lint error, a
  clearly wrong assertion), and only on the worktree branch. Commit them there
  with a message explaining the root cause. NEVER push, never merge to master,
  never force-push — the user decides what lands.
- Anything judgment-heavy (a design trade-off, an API change, a failing test that
  may encode intended behavior) goes in the report as a recommendation, not a commit.
- If the gate is fully green and the diff review turns up nothing, say exactly
  "clean — gate green, no findings" and stop. Do not invent work to look useful.
- Leave the worktree in place with its branch so the user can inspect or cherry-pick.
  Remove it only if it is empty and unchanged.

Report: gate result per command (pass/fail + the failing output), findings ranked
most-severe first with `file:line`, what you fixed and on which branch, and what
needs a human decision.
```

Notes:
- `/loop 1h` fires hourly. Drop the interval (`/loop Run an isolated...`) to let
  the model self-pace instead.
- Cancel with `/loop` stop or by interrupting the session.
- Each iteration makes its own worktree; prune accumulated ones with the
  `leftover-work-review` skill, which reports what is safe to delete.
