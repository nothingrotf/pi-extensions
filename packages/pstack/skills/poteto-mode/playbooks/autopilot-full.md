### Autopilot-full

Keep one implementer role per issue through build and corrections, and give each round to a fresh agent with consolidated scope.
The root owns independent verification, countersigns, and audits.
This playbook requires explicit autonomy and landing authority for the queue.
Use `../references/delivery-operations.md` for root model selection, compact checkpoints, waiting, and recovery.

1. **Honor operator gates.**
   Keep operator-named items under operator review and landing control.
   If the operator requests a plan, state it and wait for an explicit go.
   On that go, arm the audit loop from step 6.

2. **Create durable issue lanes.**
   Pass the per-issue fields from `../references/delivery-contract.md` inside each Task prompt.
   Keep the accepted design, artifact identities, acceptance criteria, and verification owner attached through corrections.
   Start an uncommitted `decisions.tsv` and retain checks, findings, and the PR URL.
   Record each PR's babysit assignment and mode in the checkpoint as part of this authorized lifecycle.
   Give each fix round, follow-up, and retry to a fresh implementer with the consolidated scope from the checkpoint.
   After each verifiable unit, publish a WIP snapshot through `../references/delivery-operations.md`.
   Diagnose repeated incomplete returns before another equivalent dispatch.
   Update the checkpoint after each handoff, verdict, and publication.
   Use the exact implementation role and `pstack-leaf` for a bounded implementer.
   If the owner must delegate, use `pstack-nested` within its depth limit.
   Keep external evidence collection, runtime preflight, telemetry, and evaluation utility at the root.

3. **Start two independent lanes.**
   Verify disjoint files, dependencies, branches, and mutable resources before parallel dispatch.
   Lane count follows verified independence, never the size of a configured model pool.
   Serialize overlapping work and shared topology changes.
   Branch self-contained issues from main and use merge-then-branch for sequenced work.
   If a genuinely dependent split needs a private stack, follow `../references/stack-backends.md`.
   Record the first two issues as the time-to-acceptance pilot through `../references/throughput.md`.
   Review the pilot before increasing concurrency.

4. **Build and verify the accepted artifact.**
   Run early risk probes and reuse the pinned harness through corrections.
   Require a passing per-criterion self-proof matrix before promoting WIP to a verification candidate.
   Apply self-proof, skeptical Bugbot triage, deslop, and comment cleanup through the delivery contract.
   Assign one independent reviewer that never wrote the implementation.
   For combined static and live checks, use `role: "runtime verification"` with shell access and manual isolation from the first dispatch.
   For static-only review, use `role: "code review"` with read-only tools.
   Select one permitted model from the required family, not every pool entry.
   Keep that role and contract for each correction round's fresh reviewer, and require one complete verdict.
   Before landing, verify load-bearing behavior, required gates, receipts, and the diff at the merge-ready head.
   Use `control-cli` or `control-ui` for the actual surface.
   Run the load-bearing regression on current trunk when that behavior exists.
   If trunk lacks the feature, record that limit and verify the added behavior and final user-visible state.
   For distinct high-risk boundaries or an explicit swarm requirement, partition verification through the **swarm** skill.
   Do not start duplicate verifiers for the same proof merely because a model pool is large.
   Send findings to a fresh implementer and affected evidence to a fresh independent reviewer, each with consolidated scope.
   Invalidate changed evidence according to the delivery contract, without rerunning unchanged passing checks unnecessarily.

5. **Separate publication and landing.**
   Send the accepted patch to a separately scoped foreground publication Task for destination commit, push, and PR creation.
   Pass `role: "publication"` and `capability_profile: "pstack-leaf"` to publication.
   Include commit and PR text in that operation without a separate prose-preparation Task.
   Never publish synthetic snapshot history or join a runtime verifier's incidental patch.
   Rebase onto current trunk through the foreground destination boundary before babysit.
   When publication returns the PR URL, the root starts the assigned loop through `playbooks/babysit.md`.
   This lifecycle assignment does not require another babysit request or completion of other independent PRs.
   Use `background` while independent builds continue, or `check` for small or docs-only PRs.
   Give code fixes to a fresh implementer and publish accepted corrections through the foreground destination boundary.
   Apply the same foreground destination boundary to later rebases and landing operations.
   Before a rewritten push, verify the assigned branch's remote tip with `git ls-remote`.
   Use `git push --force-with-lease=<branch>:<observed-tip>` only for an explicitly authorized rewritten branch.
   Never force-push a shared branch.
   Recheck the artifact and required gates after a rebase before publication or landing.
   Record the base SHA, head SHA, and stable patch-id with the root verdict.
   If trunk moves, apply the patch rule from `playbooks/shipping.md`.
   A changed patch voids the code verdict, while an unchanged patch still requires current mergeability and CI.
   Once that head is green and its patch-id matches the verdict, a later trunk move does not force another rebase.
   Right before landing, fetch trunk and check that `git merge-tree` of the head against current trunk is clean.
   Also check that no path in `git diff --name-only $(git merge-base HEAD origin/main) origin/main` is a path the PR changes or a path that decides which CI runs for it, such as the repository's CI configuration.
   If either check fails, rebase again through the foreground destination boundary, record the new head SHA, wait for CI on it, and repeat these checks.
   Dispatch landing only with explicit queue landing authority and the root's clean independent verdict.
   Squash-merge only the accepted PR. A fresh implementer takes the next independent issue.
   Operator-named items remain merge-ready until the operator acts.

6. **Audit the root layer.**
   Require a fresh root countersign for a genuinely new increase in a pinned gate or budget.
   Absorbing a value already on main is drift, not an increase.
   Run an audit tick every hour.
   On the operator's go, arm `/loop 1h` through the installed `loop` skill with a prompt that runs this tick.
   Add an event watcher when one exists, and keep the 1-hour heartbeat as its fallback.
   Never leave the cadence to memory or lossy completion notifications.
   Use `TaskControl.wait` when no independent work remains, with the typed arguments from `../references/task-contracts.md`.
   Never use shell `sleep` to await children or wait for the heartbeat after a completion.
   At each audit, read the compact checkpoint and inspect changed evidence.
   Reload this playbook only when its instructions change or a decision requires it.
   Inspect Task status, decision trails, real checks, commits, pushes, and PR changes.
   Do not infer progress or failure solely from token output or silence.
   Judge each owner by its WIP snapshot branch and decision trail.
   If a lane exceeds its expected runtime without evidence, diagnose it before replacing the owner.
   Replace an owner whose agent cannot start a turn.
   Cancel a genuinely stuck writer before replacing it from retained scope and evidence.
   After a merge batch, review outcomes and inspect new bot comments.

7. **Honor an immediate stop.**
   Cancel isolated writers for a zero-write order and stop publication or landing dispatches.
   Steering alone does not stop an in-flight write.
   Keep retained briefs and evidence until the operator releases the hold.

**Reply:** Report each issue's implementer, state, head SHA, and independent verdict.
List landed work, the next issue each fresh implementer took, countersigns, operator gates, pilot limits, and retained evidence locations.
