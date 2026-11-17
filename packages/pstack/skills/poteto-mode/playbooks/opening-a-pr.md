### Opening a PR

Invoked at the end of every other playbook.

Work from a git worktree off trunk, and keep unrelated work out of it. Rebase into small, landable commits. Run `/deslop` over the diff before commit.

Title: `type(scope): subject`, naming a real symbol when one carries the change. Body: load the bundled `pr` skill from `../pr/SKILL.md` and follow its template and evidence rules.

Stack follow-ups by base branch. Open PRs ready: use `gh pr create` without `--draft`. Opening a PR does not start a babysit.
