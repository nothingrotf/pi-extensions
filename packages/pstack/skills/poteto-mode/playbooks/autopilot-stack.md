### Autopilot-stack

Run the Autopilot-full playbook, but do not merge.

1. **In place of step 5, stop at verified.** Stop when each PR is verified and green at its current head, then hand the PRs to the operator. After the handoff, nobody pushes without the operator's go. Every loop tick prompt names this file, so each tick sees the no-merge rule.
2. **Stack a PR only when it builds on another PR.** This is the one exception to step 3. Create the dependent PR's worktree branch from its parent PR's branch in place of trunk, and start it only after the parent PR is open. Link it per **Size and stacks** in `playbooks/opening-a-pr.md`. In place of step 2's rebase onto trunk, each PR rebases onto its parent PR's branch, and the stack root rebases onto trunk. A new head on the lower PR restacks the PRs above it, and a fresh owner of each upper PR rebases its own branch. A PR whose `git patch-id --stable` the restack leaves unchanged keeps its verdict.

**Reply:** list each PR with its verdict, in place of what merged.
