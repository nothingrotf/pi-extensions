### Autopilot-stack

Build and verify the queue, then deliver one linear reviewed stack for the operator to land.
Select a backend through `../references/stack-backends.md` before the first topology mutation.
This playbook grants no merge authority.

1. **Keep durable issue owners.**
   Assign one persistent implementer per issue and one independent reviewer that never wrote its code.
   Pass the per-issue fields from `../references/delivery-contract.md` inside the Task prompt.
   Retain the accepted design, artifact identities, verification owner, acceptance criteria, and an uncommitted `decisions.tsv`.
   Resume the same implementer for compatible corrections.
   Use the exact implementation role and `pstack-leaf` for a bounded implementer.
   If the owner must delegate, use `pstack-nested` within its depth limit.
   Keep external evidence collection, runtime preflight, telemetry, and evaluation utility at the root.
   Apply early probes, self-proof, skeptical Bugbot triage, deslop, and comment cleanup through the delivery contract.
   Run babysit through `playbooks/babysit.md` when its lifecycle requires it.

2. **Start two independent lanes.**
   Verify disjoint files, dependencies, branches, and mutable resources before parallel dispatch.
   Lane count follows verified independence, never the size of a configured model pool.
   Serialize dependent changes and shared topology writes.
   Measure the first two issues through the time-to-acceptance procedure in `../references/throughput.md`.
   Review the pilot before increasing concurrency.

3. **Honor operator gates and audit wakeups.**
   If the operator requests a plan, state it and wait for an explicit go.
   After that go, arm a `/goal` with the full stack objective.
   Arm audits with the installed `loop` skill, event watchers when available, and a 30-minute heartbeat fallback.
   At each audit, reread this playbook and the goal.
   Inspect Task status, evidence, checks, branch changes, and decision trails.
   Diagnose a lane that exceeds its expected runtime without evidence before replacing its owner.
   Cancel a stuck writer before replacing it from retained scope and evidence.
   On an operator stop, cancel isolated writers and stop publication dispatches.
   Steering alone cannot enforce an immediate zero-write hold.

4. **Verify STACK-READY independently.**
   Require the base SHA, head SHA, stable patch-id, and acceptance evidence.
   Verify required gates, live behavior, trunk regression, receipts, and the diff at that head.
   If trunk lacks the feature, record that limit and verify the added behavior and final user-visible state.
   For combined static and runtime checks, use `role: "runtime verification"` with shell access and manual isolation from the first dispatch.
    For static-only review, use `role: "code review"` with read-only tools.
    Select one permitted model from the required family, not every pool entry.
    Preserve that role and contract on compatible corrections, and require one complete verdict.
   Reuse the pinned harness, not an unverified surrogate artifact.
   For distinct high-risk boundaries or an explicit swarm requirement, partition verification through the **swarm** skill.
   Return findings to the same implementer and affected evidence to the same reviewer.
   Apply the delivery contract's evidence invalidation rules after corrections.
   Keep unresolved or unavailable proofs blocked, not clean.

5. **Publish accepted patches separately.**
   Accept the patch before a separately scoped foreground Task commits and pushes the destination branch.
   Pass `role: "publication"` and `capability_profile: "pstack-leaf"` to publication.
    Include commit and PR text in that operation without a separate prose-preparation Task.
   Never publish synthetic snapshot history or join a runtime verifier's incidental patch.
   Open the PR ready when its intended base exists.
   Otherwise, open it immediately after attaching it to the stack topology.
   Append only accepted patches in verified order or the operator's specified order.
   No implementer or publication Task merges, arms auto-merge, or closes the PR.

6. **Keep one topology writer.**
   Publication Tasks push only their assigned branches and report their tips, current bases, and intended parents.
   Keep all topology writes at the root.
   Before each topology change, fetch the intended parent and verify the remote child tip with `git ls-remote`.
   Use `--force-with-lease` only for an authorized rewritten child branch.
   For Graphite, run `gt track -p <current-tip>` and `gt submit --no-interactive --stack`.
   For GitHub, run `gh stack init --base <trunk> <branches...>` and `gh stack submit --auto --open`.
   Never mix backend metadata within one run.

7. **Reverify affected drift.**
   For Graphite, use `gt restack` and `gt sync`.
   For GitHub, use `gh stack rebase` and `gh stack sync`.
   Return conflicts to the implementer that owns the affected files, then push through the root publication boundary.
   Compare each old and new base-to-head diff with `git patch-id --stable`.
   A changed patch returns to verification.
   An unchanged patch retains its code verdict but still requires current mergeability and CI.
   Recheck live behavior when parent, trunk, configuration, or runtime changes invalidate its evidence.
   Require a fresh root countersign for a genuinely new increase in a pinned gate or budget.

8. **Deliver without landing.**
   Return the ordered PR chain, owners, head identities, independent verdicts, pilot limits, and evidence locations.
   Include each verifier verdict in the PR body or a comment through the authorized publication boundary.
   The operator reviews and lands the stack through the selected backend.

Use **Autopilot-full** only when the queue is independent and landing authority is explicit.
Use **Autopilot-stack** when the operator retains landing control or the work requires a dependent chain.
