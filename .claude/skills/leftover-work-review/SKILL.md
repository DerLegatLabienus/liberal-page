---
name: leftover-work-review
description: Scans the repo for leftover work — worktrees, local branches, unpushed commits, stashes, and prunable worktree metadata — and reports which items are genuinely unmerged versus already safely integrated (including via squash or rebase merge, which a plain ancestry check misses). Report-only: never deletes, force-pushes, or cleans anything up itself. Use this at the end of a work session, before closing out a worktree, when the user asks "did I leave anything behind", "is there uncommitted work anywhere", "can I delete this branch/worktree safely", or wants a repo health check before things get messy.
triggers:
  - review leftover work
  - check for uncommitted work
  - is it safe to delete this branch
  - clean up worktrees
  - repo health check
  - did I leave anything behind
---

# Leftover Work Review

Finds git state that could represent real, un-integrated work — uncommitted changes in a
worktree, a branch that never got merged, an unpushed commit, a forgotten stash — and tells
you which of those are actually safe to ignore/clean up versus which need a decision from you.

## Why this needs two signals, not one

A plain ancestry check (`git merge-base --is-ancestor branch base`) says a branch is
"unmerged" the moment it was merged via **squash** or **rebase**, because neither leaves the
branch's own commits as ancestors of the base — even though every line of content already
landed. This is exactly the common case for agent-created worktree branches. Reporting those
as "unmerged work" trains you to ignore the warning, which defeats the entire point of a
skill meant to catch real leftovers before they pile up.

So every branch gets checked two ways and reconciled:

| Commit-wise (ancestor?) | Content-wise (already in base?) | Verdict |
|---|---|---|
| yes | — | **Clean** — normally/fast-forward merged |
| no | yes | **Safe to clean** — squash- or rebase-merged; content is fully in a base, just not the commits |
| no | no | **Real unmerged work** — surface this, don't guess |

The content-wise check builds a throwaway, unreferenced commit (branch's current tree,
parented on its merge-base with the base branch) and asks `git cherry` whether an equivalent
change already exists in the base's history — the same technique the well-known
`git-delete-squashed` script uses. This is what actually catches squashes; a naive tree-diff
between the two tips doesn't, because a base that's moved on with unrelated commits since the
squash-merge will look "different" from the branch even though the branch's content is fully
incorporated.

## Running it

```bash
bash .claude/skills/leftover-work-review/scripts/scan.sh
```

Run from anywhere inside the repo (the script finds the repo root itself). It discovers real
base branches generically — checks `main`/`master`/`develop`/`dev`/`trunk` for whichever
actually exist locally, plus the remote's default branch if resolvable — rather than
assuming any particular one exists. A master-only repo (no `main`/`dev`) is expected and
handled: verdicts are computed against whatever base(s) are actually present.

The script prints five sections:
1. **Worktrees** — path, checked-out branch, dirty/clean working tree, and that branch's merge verdict
2. **Local branches not checked out anywhere** — same merge verdict per branch
3. **Unpushed commits** — branches ahead of their upstream, and branches with no upstream at all ("never pushed")
4. **Stashes** — every entry in `git stash list`
5. **Prunable worktree metadata** — what `git worktree prune --dry-run --verbose` would remove (administrative — a worktree whose directory is gone but git still tracks it; distinct from "is there real work here")

## After running it

Summarize the findings for the user, grouped by what needs a decision versus what doesn't:

- **Uncommitted changes in a worktree**, and **real unmerged branches** — these are the ones
  that matter. Point them out clearly and ask the user what they want to do (keep working,
  commit, merge, or discard) — never decide for them.
- **Squash/rebase-merged branches**, stale worktree metadata, and fully-pushed clean branches
  — mention these as safe-to-clean context, not warnings.
- **Stashes** and **never-pushed branches** — surface them; a stash in particular is easy to
  forget entirely, so even an old one is worth a one-line mention.

**Never run cleanup yourself** — no `git worktree remove`, `git branch -D`, `git stash drop`,
`git push`, etc. This skill's job ends at reporting; if the user decides to clean something
up after seeing the report, that's a separate, explicit action they ask for next, following
this repo's normal git-safety rules (confirm before anything destructive/irreversible).

## Verifying changes to the script

If you ever modify `scripts/scan.sh`, don't just trust it — the whole reason this skill
exists is to be more correct than eyeballing `git branch --merged`. Build a throwaway fixture
repo, deliberately create a squash-merged branch (`git merge --squash`, commit) and a
rebase-merged one (cherry-pick a commit onto the base so the original branch ref goes stale),
and confirm the script calls both "safe to clean," not "unmerged work." A plain fast-forward
merge alone does not exercise the part of the logic that's actually hard to get right.
