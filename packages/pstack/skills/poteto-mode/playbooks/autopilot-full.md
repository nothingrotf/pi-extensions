### Autopilot-full

Keep one implementer role per issue through build and corrections, and resume its recorded owner in the issue workspace for each correction.
The root owns independent verification, countersigns, and audits.
This playbook requires explicit autonomy and landing authority for the queue.
Use `../references/delivery-operations.md` for root model selection, compact checkpoints, waiting, and recovery.
A verdict covers one patch, and green CI covers one head. Every new head needs its own green CI.

1. **Honor operator gates.**
   The landing grant covers only the queue's items.
   Operator-named items and PRs outside the queue stop at merge-ready under operator control.
   A request to state the plan is not a go. State the plan and wait for an explicit go.
   On that go, arm the audit loop from step 6.

2. **Create durable issue lanes.**
   Pass the per-issue fields from `../references/delivery-contract.md` inside each Task prompt.
   Keep the accepted design, artifact identities, acceptance criteria, and verification owner attached through corrections.
   Start an uncommitted `decisions.tsv` and retain checks, findings, and the PR URL.
   Record each PR's babysit assignment and mode in the checkpoint as part of this authorized lifecycle.
   Open an issue workspace for each issue before its first dispatch, and record its worktree and branch in the checkpoint.
   Resume the recorded owner for each fix round and follow-up with the consolidated scope from the checkpoint.
   Give a retry after a diagnosis to a fresh implementer in the same workspace.
   After each verifiable unit, publish a WIP snapshot through `../references/delivery-operations.md`.
   Run the build, review, and correction loop of each issue with `pstack_deliver`, per the Delivery engine section of `../references/delivery-operations.md`. Publish the WIP snapshot after the engine returns.
   Diagnose repeated incomplete returns before another equivalent dispatch.
   Update the checkpoint after each handoff, verdict, and publication.
   Use the exact implementation role and `pstack-leaf` for a bounded implementer.
   If the owner must delegate, use `pstack-nested` within its depth limit.
   Keep external evidence collection, runtime preflight, telemetry, and evaluation utility at the root.

3. **Start two independent lanes.**
   Verify disjoint files, dependencies, branches, and mutable resources before parallel dispatch.
   Lane count follows verified independence, never the size of a configured model pool.
   Serialize overlapping work and shared topology changes.
   Keep issues in flight at or below the lane count, per Local footprint in `../references/delivery-operations.md`.
   Branch self-contained issues from main and use merge-then-branch for sequenced work.
   Never stack these PRs, so that each PR lands on its own. Route dependent work to Autopilot-stack.
   Record the first two issues as the time-to-acceptance pilot through `../references/throughput.md`.
   Review the pilot before increasing concurrency.

4. **Build and verify the accepted artifact.**
   Run early risk probes and reuse the pinned harness through corrections.
   Require a passing per-criterion self-proof matrix before promoting WIP to a verification candidate.
   Apply self-proof, skeptical Bugbot triage, deslop, and comment cleanup through the delivery contract.
   Assign one independent reviewer that never wrote the implementation.
   For combined static and live checks, use `role: "runtime verification"` with shell access, in place in the issue workspace, from the first dispatch.
   For static-only review, use `role: "code review"` with read-only tools.
   Select one permitted model from the required family, not every pool entry.
   Keep that role and contract for each correction round's fresh reviewer, and require one complete verdict.
   Before landing, verify load-bearing behavior, required gates, receipts, and the diff at the merge-ready head.
   Use `control-cli` or `control-ui` for the actual surface.
   Run the load-bearing regression on current trunk when that behavior exists.
   If trunk lacks the feature, record that limit and verify the added behavior and final user-visible state.
   For distinct high-risk boundaries or an explicit swarm requirement, partition verification through the **swarm** skill.
   When verification uses a swarm, run it once at the code-ready head. Run another swarm only for new behavior, a redesign, or a large new diff.
   A rebase, a conflict resolution, or a minor fix gets one fresh independent reviewer at the new head.
   Do not start duplicate verifiers for the same proof merely because a model pool is large.
   Send findings to the resumed owner and affected evidence to a fresh independent reviewer, each with consolidated scope.
   A defect that a reviewer filed as a note is still a finding.
   A defect that trunk shows without the PR is recorded against trunk and does not gate the PR.
   A defect that the PR copies or newly reaches belongs to the PR.
   The root never writes a fix itself, because each branch has one writer. Replace a stuck owner instead.
   Invalidate changed evidence according to the delivery contract, without rerunning unchanged passing checks unnecessarily.

5. **Separate publication and landing.**
   Send the accepted patch to a separately scoped foreground publication Task for destination commit, push, and PR creation.
   Pass `role: "publication"` and `capability_profile: "pstack-leaf"` to publication.
   Include commit and PR text in that operation without a separate prose-preparation Task.
   Never publish synthetic snapshot history or join a runtime verifier's incidental patch.
   Rebase onto current trunk through the foreground destination boundary before babysit.
   When publication returns the PR URL, release the issue's local footprint through `../references/delivery-operations.md`.
   Then the root starts the assigned loop through `playbooks/babysit.md`.
   This lifecycle assignment does not require another babysit request or completion of other independent PRs.
   Use `background` while independent builds continue, or `check` for small or docs-only PRs.
   Give code fixes to a fresh implementer and publish accepted corrections through the foreground destination boundary.
   Apply the same foreground destination boundary to later rebases and landing operations.
   Before a rewritten push, verify the assigned branch's remote tip with `git ls-remote`.
   If that tip differs from the last push that the run made or took over, stop and report it instead of overwriting it.
   Use `git push --force-with-lease=<branch>:<observed-tip>` only for an explicitly authorized rewritten branch.
   Never force-push a shared branch.
   Recheck the artifact and required gates after a rebase before publication or landing.
   Record the base SHA, head SHA, and stable patch-id with the root verdict.
   If trunk moves, apply the patch rule from `playbooks/shipping.md`.
   A changed patch voids the code verdict, while an unchanged patch still requires current mergeability and CI.
   Green CI alone never authorizes a landing.
   Once that head is green and its patch-id matches the verdict, a later trunk move does not force another rebase.
   Right before landing, fetch trunk and ask whether its changes can affect the patch, because rebasing for every trunk move never ends.
   Rebase through the foreground destination boundary and wait for CI when the code that would land was never tested.
   Examples include a `git merge-tree` conflict, a file that both sides changed, or a trunk change to the checks that run for the PR.
   A lockfile that both sides changed needs no rebase when a frozen install passes on the merge result and the PR's changed packages resolve there as on the head.
   A failing install means that the rebase must repair the lockfile.
   When trunk changed a caller of the patch or a dependency of the patch, run the patch's checks on the merge result and land on a pass.
   Otherwise land without another rebase.
   If trunk would force a third rebase past merge prep, hold the PR, report the collision, and sequence the colliding work.
   Dispatch landing only with explicit queue landing authority and the root's clean independent verdict.
   Squash-merge only the accepted PR. Release any worktree or service that the landing recreated.
   A fresh implementer takes the next independent issue.
   Operator-named items remain merge-ready until the operator acts.

6. **Audit the root layer.**
   Anything that loosens a gate, such as a raised budget or an allowlist entry, needs verifier proof and a fresh root countersign.
   Absorbing a value already on main is drift, not an increase.
   A disabled or soft-failed check always comes out, because it stops guarding every case.
   Never give or bypass an approval that the forge enforces.
   Run an audit tick every hour.
   On the operator's go, arm `/loop 1h` through the installed `loop` skill with a prompt that runs this tick.
   Add an event watcher when one exists, and keep the 1-hour heartbeat as its fallback.
   Never leave the cadence to memory or lossy completion notifications.
   Use `TaskControl.wait` when no independent work remains, with the typed arguments from `../references/task-contracts.md`.
   Never use shell `sleep` to await children or wait for the heartbeat after a completion.
   At each audit, read the compact checkpoint and inspect changed evidence.
   Reload this playbook only when its instructions change or a decision requires it.
   Probe every agent, down to the leaf lanes.
   Inspect Task status, decision trails, real checks, commits, pushes, and PR changes.
   Do not infer progress or failure solely from token output or silence.
   An agent that waits on the root or the operator is not stuck. Answer it.
   Judge each owner by its WIP snapshot branch and decision trail.
   If a lane exceeds its expected runtime without evidence, diagnose it before replacing the owner.
   Replace an owner whose agent cannot start a turn.
   Cancel a genuinely stuck writer before replacing it from retained scope and evidence.
   After a merge batch, review outcomes and inspect new bot comments.
   End a tick that changed something for the operator by catching them up per the **ketchup** skill. A tick that changed nothing stays quiet.

7. **Honor an immediate stop.**
   Cancel isolated writers for a zero-write order and stop publication or landing dispatches.
   Steering alone does not stop an in-flight write.
   Keep retained briefs and evidence until the operator releases the hold.

**Reply:** Catch the operator up per the **ketchup** skill.
Cover each issue's state and independent verdict, landed work, countersigns, operator gates, and pilot limits.
Report the final local footprint audit and the reason for each held resource.
Link each PR and the retained evidence locations.
