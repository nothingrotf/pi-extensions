# Issue workspaces replace per-attempt writer copies for managed delivery

Managed pstack delivery gives each issue one persistent Git worktree on its own branch, outside the source checkout, and prepares its environment once.
The issue owner, its runtime verifier, and publication run in place in that worktree through `isolation: { mode: "in-place" }`, which holds an exclusive writer lease and captures base and result trees as the candidate identity.
Corrections resume the same owner in the same worktree, and static review and runtime verification run in parallel against the same tree.

We chose this because measured sessions showed that the Task runtime itself costs about 1.5 s per attempt, while the workflow around it dominated elapsed time.
Each round copied the repository into a temporary writer workspace, joined the patch back, copied it again for manual-isolation verification, and repeated environment setup for databases, ports, and dependencies.
About half of the WIP and blocked delivery reports mentioned workspace, identity, or environment friction, and accepted issues needed a median of three implementation submissions.
T3 Code, pstack-t3, Claude Code, and Cursor all isolate parallel work with real worktrees bound before the agent starts and integrate through Git.

## Considered options

- **Keep per-attempt synthetic writer copies.** Strong isolation and zero-write cancellation, but every round repeats workspace and environment preparation, and the verifier cannot reuse the owner's environment.
- **Run owners as separate agent processes in Herdr panes.** Adds visibility and process isolation, but uses terminal input as its control channel and cannot enforce tool or model policy. It does not address the measured causes, so it is deferred.
- **Persistent issue worktrees with in-place writers (chosen).** Keeps the in-process Task API, capability policy, and delivery ledger, and removes the copy, join, and repeated setup steps from the delivery loop.

## Consequences

- An in-place writer cannot provide a zero-write cancellation. The worktree retains partial edits for the next round.
- A runtime verifier must leave the candidate tree unchanged. Scratch output belongs outside the worktree or in ignored paths, and a changed tree rejects the verdict.
- Synthetic per-attempt isolation remains the default for other mutable background Tasks and for nested writers.
