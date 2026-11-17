### Opening a PR

Invoked at the end of every other playbook.

Follow Repository writer in [Task contracts](../references/task-contracts.md). The owner works from its linked worktree off trunk, keeps unrelated work out of it, commits, pushes its own branch, and opens the PR. Release each linked worktree after its PR lands or closes with `scripts/release-worktree.sh <path>`. Rebase into small, landable commits. Run `/deslop` over the diff before commit and `/no-comments` before review.

Title: `type(scope): subject`, naming a real symbol when one carries the change. Body: load the bundled `pr` skill from `../pr/SKILL.md` and follow its template and evidence rules. Attach local proof assets with native `gh --attach`.

Stack follow-ups through `../references/stack-backends.md`. Open every PR ready: omit `--draft` from `gh pr create`. Opening a PR does not start a babysit.
