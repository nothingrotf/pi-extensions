#!/usr/bin/env bash
set -u

repo="${1:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "$repo" ] || { echo "not in a git repo; pass a repo path" >&2; exit 1; }
cd "$repo" || exit 1

main_wt=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')
git fetch origin main --quiet 2>/dev/null || echo "warn: could not fetch origin/main; merged state may be stale" >&2
prs=$(mktemp)
trap 'rm -f "$prs"' EXIT
gh pr list --author "@me" --state all --limit 1000 --json number,state,headRefName 2>/dev/null > "$prs" || echo "[]" > "$prs"
now=$(date +%s)

printf "SIZE_KB\tAGE\tMERGED\tDIRTY\tREMOTE\tPR\tBUCKET\tWORKTREE\n"

git worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r wt; do
  [ "$wt" = "$main_wt" ] && continue
  size=$(du -sk "$wt" 2>/dev/null | awk '{print $1}')
  head=$(git -C "$wt" rev-parse HEAD 2>/dev/null)
  head_ts=$(git -C "$wt" log -1 --format='%ct' HEAD 2>/dev/null || echo 0)
  age=$([ "$head_ts" -gt 0 ] 2>/dev/null && echo "$(((now - head_ts) / 86400))d" || echo "?")
  git merge-base --is-ancestor "$head" origin/main 2>/dev/null && merged=YES || merged=no
  porcelain=$(git -C "$wt" status --porcelain 2>/dev/null)
  if [ -z "$porcelain" ]; then
    dirty=clean
  elif printf '%s\n' "$porcelain" | grep -qv '^??'; then
    dirty="wip:$(printf '%s\n' "$porcelain" | grep -cv '^??')"
  else
    dirty="scratch:$(printf '%s\n' "$porcelain" | grep -c '^??')"
  fi
  branch=$(git -C "$wt" symbolic-ref --quiet --short HEAD 2>/dev/null || echo "")
  if [ -z "$branch" ]; then
    remote=detached
  elif git -C "$wt" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    if [ "$(git -C "$wt" rev-parse "origin/$branch" 2>/dev/null)" = "$head" ]; then
      remote=pushed
    else
      remote="ahead$(git -C "$wt" rev-list --count "origin/$branch..HEAD" 2>/dev/null)"
    fi
  else
    remote=no-remote
  fi
  pr=$([ -n "$branch" ] && jq -r --arg b "$branch" '.[] | select(.headRefName==$b) | "#\(.number)/\(.state)"' "$prs" 2>/dev/null | head -1)
  [ -n "$pr" ] || pr="-"
  case "$dirty" in
    wip:*) bucket=hold-wip ;;
    *)
      case "$pr" in
        *OPEN*) bucket=hold-open-pr ;;
        *)
          if [ "$merged" = YES ] || [ "$pr" != "-" ]; then bucket=safe; else bucket=review; fi
          ;;
      esac
      ;;
  esac
  printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" "$size" "$age" "$merged" "$dirty" "$remote" "$pr" "$bucket" "$wt"
done | sort -t$'\t' -k1,1nr
