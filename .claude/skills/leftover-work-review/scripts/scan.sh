#!/usr/bin/env bash
# Enumerates worktrees, local branches, unpushed commits, stashes, and prunable worktree
# metadata in the current repo, and reconciles a two-signal merge verdict (commit-wise +
# content-wise) for every branch against every real base branch found. Report-only — makes
# no changes to the repo (git commit-tree below creates a dangling, unreferenced object for
# the content check; it is not a ref and needs no cleanup).
set -uo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "Not inside a git repo." >&2; exit 1; }

BASE_CANDIDATES=(main master develop dev trunk)

# --- discover real base branches -------------------------------------------------------
bases=()
for name in "${BASE_CANDIDATES[@]}"; do
  if git show-ref --verify --quiet "refs/heads/$name"; then
    bases+=("$name")
  fi
done
# Also add the remote's default branch if it resolves and isn't already listed (covers repos
# whose trunk is named something outside the candidate list above).
default_ref=$(git symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null | sed 's#refs/remotes/origin/##')
if [ -n "${default_ref:-}" ] && git show-ref --verify --quiet "refs/heads/$default_ref"; then
  found=0
  for b in "${bases[@]:-}"; do [ "$b" = "$default_ref" ] && found=1; done
  [ "$found" -eq 0 ] && bases+=("$default_ref")
fi

if [ "${#bases[@]}" -eq 0 ]; then
  echo "=== BASES ==="
  echo "No candidate base branch (main/master/develop/dev/trunk, or origin's default) found locally."
  echo "Merge-verdict checks below are skipped; everything else still runs."
  echo
else
  echo "=== BASES ==="
  printf '%s\n' "${bases[@]}"
  echo
fi

# --- content-wise check: is branch's content already fully present in base, regardless of
# whether it was merged, rebase-merged, or squash-merged? Builds a dangling synthetic commit
# (branch's tree, parented on the base/branch merge-base) and checks via `git cherry` whether
# an equivalent change already exists in base's history — the same technique the well-known
# `git-delete-squashed` script uses, since squashing collapses N commits into one new patch-id
# that plain `git cherry <base> <branch>` would otherwise miss entirely. -------------------
content_already_in_base() {
  local base="$1" branch="$2" mb tree base_tree synth
  mb=$(git merge-base "$base" "$branch" 2>/dev/null) || return 2   # no common history
  tree=$(git rev-parse "${branch}^{tree}")
  base_tree=$(git rev-parse "${mb}^{tree}")
  [ "$tree" = "$base_tree" ] && return 0   # branch never diverged in content from the merge-base
  synth=$(git commit-tree "$tree" -p "$mb" -m "leftover-work-review: synthetic content check" 2>/dev/null) || return 2
  git cherry "$base" "$synth" 2>/dev/null | grep -q '^-' && return 0
  return 1
}

# --- per-branch verdict against every discovered base ----------------------------------
branch_verdict() {
  local branch="$1"
  if [ "${#bases[@]}" -eq 0 ]; then
    echo "no base branch to check against"
    return
  fi
  local any_clean=0 any_squash=0 checked_any=0
  for base in "${bases[@]}"; do
    [ "$base" = "$branch" ] && continue
    checked_any=1
    if git merge-base --is-ancestor "$branch" "$base" 2>/dev/null; then
      any_clean=1
    else
      if content_already_in_base "$base" "$branch"; then
        any_squash=1
      fi
    fi
  done
  if [ "$checked_any" -eq 0 ]; then
    echo "is itself a base branch"
  elif [ "$any_clean" -eq 1 ]; then
    echo "CLEAN — ancestor of a base branch"
  elif [ "$any_squash" -eq 1 ]; then
    echo "SAFE TO CLEAN — content already in a base branch (squash/rebase-merged)"
  else
    echo "UNMERGED — real work not yet in any base branch"
  fi
}

# --- worktrees ---------------------------------------------------------------------------
echo "=== WORKTREES ==="
git worktree list --porcelain | awk '
  /^worktree / { path=$2 }
  /^branch /   { sub("refs/heads/", "", $2); branch=$2; print path"\t"branch; path=""; branch="" }
  /^detached/  { print path"\t(detached HEAD)"; path="" }
' | while IFS=$'\t' read -r wtpath wtbranch; do
  [ -z "$wtpath" ] && continue
  dirty=$(git -C "$wtpath" status --porcelain 2>/dev/null)
  dirty_note="clean working tree"
  [ -n "$dirty" ] && dirty_note="UNCOMMITTED CHANGES present"
  if [ "$wtbranch" = "(detached HEAD)" ]; then
    echo "- $wtpath : detached HEAD — $dirty_note"
  else
    verdict=$(branch_verdict "$wtbranch")
    echo "- $wtpath : branch '$wtbranch' — $dirty_note — $verdict"
  fi
done
echo

# --- local branches not checked out in any worktree -------------------------------------
echo "=== LOCAL BRANCHES (not checked out in any worktree) ==="
checked_out=$(git worktree list --porcelain | awk '/^branch /{sub("refs/heads/","",$2); print $2}')
all_branches=$(git for-each-ref --format='%(refname:short)' refs/heads)
found_any=0
while IFS= read -r branch; do
  [ -z "$branch" ] && continue
  echo "$checked_out" | grep -qxF "$branch" && continue
  found_any=1
  verdict=$(branch_verdict "$branch")
  echo "- $branch : $verdict"
done <<< "$all_branches"
[ "$found_any" -eq 0 ] && echo "(none)"
echo

# --- unpushed commits ---------------------------------------------------------------------
echo "=== UNPUSHED COMMITS (per local branch) ==="
found_any=0
while IFS= read -r branch; do
  [ -z "$branch" ] && continue
  upstream=$(git for-each-ref --format='%(upstream:short)' "refs/heads/$branch")
  if [ -z "$upstream" ]; then
    found_any=1
    echo "- $branch : no upstream configured (never pushed)"
    continue
  fi
  ahead=$(git log "$upstream..$branch" --oneline 2>/dev/null)
  if [ -n "$ahead" ]; then
    found_any=1
    count=$(echo "$ahead" | wc -l | tr -d ' ')
    echo "- $branch : $count commit(s) ahead of $upstream"
  fi
done <<< "$all_branches"
[ "$found_any" -eq 0 ] && echo "(none — every branch with an upstream is fully pushed)"
echo

# --- stashes -------------------------------------------------------------------------------
echo "=== STASHES ==="
stashes=$(git stash list)
if [ -n "$stashes" ]; then
  echo "$stashes"
else
  echo "(none)"
fi
echo

# --- prunable worktree metadata -------------------------------------------------------------
echo "=== PRUNABLE WORKTREE METADATA (git worktree prune --dry-run) ==="
prune_output=$(git worktree prune --dry-run --verbose 2>&1)
if [ -n "$prune_output" ]; then
  echo "$prune_output"
else
  echo "(nothing to prune)"
fi
