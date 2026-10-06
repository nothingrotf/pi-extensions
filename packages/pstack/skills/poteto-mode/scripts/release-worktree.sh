#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: release-worktree.sh <worktree> [--remote <name>] [--keep-branch]" >&2
  exit 2
}

hold() {
  printf 'held\t%s\t%s\n' "$worktree" "$1"
  exit 1
}

worktree=""
remote="origin"
keep_branch=no
while [ "$#" -gt 0 ]; do
  case "$1" in
    --remote)
      [ "$#" -ge 2 ] || usage
      remote="$2"
      shift 2
      ;;
    --keep-branch)
      keep_branch=yes
      shift
      ;;
    -*) usage ;;
    *)
      [ -z "$worktree" ] || usage
      worktree="$1"
      shift
      ;;
  esac
done
[ -n "$worktree" ] || usage
[ -d "$worktree" ] || hold "not a directory"

worktree=$(cd "$worktree" && pwd -P)
top=$(git -C "$worktree" rev-parse --show-toplevel 2>/dev/null) || hold "not a git worktree"
[ "$(cd "$top" && pwd -P)" = "$worktree" ] || hold "not a worktree root"
common=$(cd "$worktree" && cd "$(git rev-parse --git-common-dir)" && pwd -P)
main=$(git -C "$worktree" worktree list --porcelain | awk '/^worktree /{print substr($0, 10); exit}')
[ "$(cd "$main" && pwd -P)" != "$worktree" ] || hold "main worktree"
git_dir=$(cd "$worktree" && cd "$(git rev-parse --git-dir)" && pwd -P)
[ ! -e "$git_dir/locked" ] || hold "locked worktree"

[ -z "$(git -C "$worktree" status --porcelain --untracked-files=all)" ] || hold "uncommitted or untracked changes"

head=$(git -C "$worktree" rev-parse HEAD)
branch=$(git -C "$worktree" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
if [ -n "$branch" ]; then
  git -C "$worktree" fetch --quiet "$remote" "+refs/heads/$branch:refs/remotes/$remote/$branch" 2>/dev/null ||
    hold "remote branch $remote/$branch is unavailable"
  git -C "$worktree" merge-base --is-ancestor "$head" "refs/remotes/$remote/$branch" ||
    hold "HEAD is not on $remote/$branch"
  published="$remote/$branch"
else
  git -C "$worktree" fetch --quiet "$remote" 2>/dev/null || hold "remote $remote is unavailable"
  published=$(git -C "$worktree" for-each-ref --contains "$head" --count=1 \
    --format='%(refname:short)' "refs/remotes/$remote")
  [ -n "$published" ] || hold "detached HEAD is not on any $remote branch"
fi

size_kb=$(du -sk "$worktree" 2>/dev/null | awk '{print $1}')
git -C "$main" worktree remove --force "$worktree" 2>/dev/null || true
if [ -d "$worktree" ]; then
  rm -rf "$worktree"
fi
git --git-dir="$common" worktree prune

released_branch="-"
if [ -n "$branch" ] && [ "$keep_branch" = no ]; then
  if ! git -C "$main" worktree list --porcelain | grep -qx "branch refs/heads/$branch"; then
    git -C "$main" branch -D "$branch" >/dev/null
    released_branch="$branch"
  fi
fi

printf 'released\t%s\t%s\t%s\t%s\n' "$worktree" "$released_branch" "$published" "${size_kb:-0}"
