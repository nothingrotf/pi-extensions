### Autopilot-full

Keep one persistent implementer per issue through build and compatible corrections.
The root owns independent verification, countersigns, and audits.
This playbook requires explicit autonomy and landing authority for the queue.

1. **Honor operator gates.**
   Keep operator-named items under operator review and landing control.
   If the operator requests a plan, state it and wait for an explicit go.
   After that go, arm a `/goal` with the full queue objective.

2. **Create durable issue lanes.**
   Pass the per-issue fields from `../references/delivery-contract.md` inside each Task prompt.
   Keep the accepted design, artifact identities, acceptance criteria, and verification owner attached through corrections.
   Start an uncommitted `decisions.tsv` and retain checks, findings, and the PR URL.
   Resume the same implementer while its contract remains compatible.
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
   Apply self-proof, skeptical Bugbot triage, deslop, and comment cleanup through the delivery contract.
   Assign one independent reviewer that never wrote the implementation.
   For combined static and live checks, use `role: "runtime verification"` with shell access and manual isolation from the first dispatch.
    For static-only review, use `role: "code review"` with read-only tools.
    Select one permitted model from the required family, not every pool entry.
    Preserve that role and contract on compatible corrections, and require one complete verdict.
   Before landing, verify load-bearing behavior, required gates, receipts, and the diff at the merge-ready head.
   Use `control-cli` or `control-ui` for the actual surface.
   Run the load-bearing regression on current trunk when that behavior exists.
   If trunk lacks the feature, record that limit and verify the added behavior and final user-visible state.
   For distinct high-risk boundaries or an explicit swarm requirement, partition verification through the **swarm** skill.
   Do not start duplicate verifiers for the same proof merely because a model pool is large.
   Return findings to the same implementer and affected evidence to the same reviewer.
   Invalidate changed evidence according to the delivery contract, without rerunning unchanged passing checks unnecessarily.

5. **Separate publication and landing.**
   Send the accepted patch to a separately scoped foreground publication Task for destination commit, push, and PR creation.
   Pass `role: "publication"` and `capability_profile: "pstack-leaf"` to publication.
    Include commit and PR text in that operation without a separate prose-preparation Task.
   Never publish synthetic snapshot history or join a runtime verifier's incidental patch.
   Rebase onto current trunk before babysit through `playbooks/babysit.md`.
   Apply the same foreground destination boundary to later rebases and landing operations.
   Record the base SHA, head SHA, and stable patch-id with the root verdict.
   If trunk moves, apply the patch rule from `playbooks/shipping.md`.
   A changed patch voids the code verdict, while an unchanged patch still requires current mergeability and CI.
   Dispatch landing only with explicit queue landing authority and the root's clean independent verdict.
   Squash-merge only the accepted PR, then assign the next independent issue to its owner.
   Operator-named items remain merge-ready until the operator acts.

6. **Audit the root layer.**
   Require a fresh root countersign for a genuinely new increase in a pinned gate or budget.
   Absorbing a value already on main is drift, not an increase.
   Arm an audit with the installed `loop` skill, an event watcher when available, and a 30-minute heartbeat fallback.
   At each audit, reread this playbook and the armed goal.
   Inspect Task status, decision trails, real checks, commits, pushes, and PR changes.
   Do not infer progress or failure solely from token output or silence.
   If a lane exceeds its expected runtime without evidence, diagnose it before replacing the owner.
   Cancel a genuinely stuck writer before replacing it from retained scope and evidence.
   After a merge batch, review outcomes and inspect new bot comments.

7. **Honor an immediate stop.**
   Cancel isolated writers for a zero-write order and stop publication or landing dispatches.
   Steering alone does not stop an in-flight write.
   Keep retained briefs and evidence until the operator releases the hold.

**Reply:** Report each issue's implementer, state, head SHA, and independent verdict.
List landed work, next assignments, countersigns, operator gates, pilot limits, and retained evidence locations.
