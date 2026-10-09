### Autopilot-stack

Build, verify, and publish the queue one layer at a time.
Each layer enters the stack as a draft pull request at its first verifiable unit and becomes ready after independent acceptance.
Deliver one linear reviewed stack for the operator to land.
Select a backend through `../references/stack-backends.md` before the first topology mutation.
This playbook grants no merge authority.
Use `../references/delivery-operations.md` for root model selection, compact checkpoints, waiting, and recovery.

1. **Keep durable issue owners.**
   Assign one implementer role per issue and one independent reviewer that never wrote its code.
   Open an issue workspace for each layer before its first dispatch, and resume its recorded owner for each correction, per poteto-mode's Subagents section.
   Pass the per-issue fields from `../references/delivery-contract.md` inside the Task prompt.
   Retain the accepted design, artifact identities, verification owner, acceptance criteria, and an uncommitted `decisions.tsv`.
   Record each PR's babysit assignment and mode in the checkpoint as part of this authorized lifecycle.
   Resume the recorded owner for each fix round and follow-up with the consolidated scope from the checkpoint.
   Give a retry after a diagnosis to a fresh implementer in the same workspace.
   After each verifiable unit, publish a WIP snapshot to the layer's draft pull request through `../references/delivery-operations.md`.
   Diagnose repeated incomplete returns through the delivery operations procedure before another equivalent dispatch.
   Use the exact implementation role and `pstack-leaf` for a bounded implementer.
   If the owner must delegate, use `pstack-nested` within its depth limit.
   Keep external evidence collection, runtime preflight, telemetry, and evaluation utility at the root.
   Apply early probes, self-proof, skeptical Bugbot triage, deslop, and comment cleanup through the delivery contract.

2. **Start two independent lanes.**
   Verify disjoint files, dependencies, branches, and mutable resources before parallel dispatch.
   Lane count follows verified independence, never the size of a configured model pool.
   Serialize dependent changes and shared topology writes.
   Keep issues in flight at or below the lane count, per Local footprint in `../references/delivery-operations.md`.
   Start a dependent layer only after its parent layer is accepted and published, and create its destination from the pushed parent branch.
   Never implement the whole queue first and split it into pull requests later.
   Measure the first two issues through the time-to-acceptance procedure in `../references/throughput.md`.
   Review the pilot before increasing concurrency.

3. **Honor operator gates and audit wakeups.**
   If the operator requests a plan, state it and wait for an explicit go.
   Run an audit tick every hour.
   On that go, arm `/loop 1h` through the installed `loop` skill with a prompt that runs this tick.
   Add event watchers when they exist, and keep the 1-hour heartbeat as their fallback.
   Never leave the cadence to memory or lossy completion notifications.
   Use `TaskControl.wait` when no independent work remains, with the typed arguments from `../references/task-contracts.md`.
   Never use shell `sleep` to await children or wait for the heartbeat after a completion.
   At each audit, read the compact checkpoint and inspect changed evidence.
   Reload this playbook only when its instructions change or a decision requires it.
   Inspect Task status, evidence, checks, branch changes, and decision trails.
   Judge each owner by its draft layer pull request and decision trail.
   Diagnose a lane that exceeds its expected runtime without evidence before replacing its owner.
   Replace an owner whose agent cannot start a turn.
   Cancel a stuck writer before replacing it from retained scope and evidence.
   On an operator stop, cancel isolated writers and stop publication dispatches.
   Steering alone cannot enforce an immediate zero-write hold.

4. **Verify STACK-READY independently.**
   Require a passing per-criterion self-proof matrix before promoting WIP to a verification candidate.
   Require the base SHA, head SHA or result tree, stable patch-id, and acceptance evidence.
   Verify required gates, live behavior, trunk regression, receipts, and the diff at that head.
   If trunk lacks the feature, record that limit and verify the added behavior and final user-visible state.
   For combined static and runtime checks, use `role: "runtime verification"` with shell access, in place in the issue workspace, from the first dispatch.
   For static-only review, use `role: "code review"` with read-only tools.
   Select one permitted model from the required family, not every pool entry.
   Keep that role and contract for each correction round's fresh reviewer, and require one complete verdict.
   Reuse the pinned harness, not an unverified surrogate artifact.
   For distinct high-risk boundaries or an explicit swarm requirement, partition verification through the **swarm** skill.
   Send findings to the resumed owner and affected evidence to a fresh independent reviewer, each with consolidated scope.
   Apply the delivery contract's evidence invalidation rules after corrections.
   Keep unresolved or unavailable proofs blocked, not clean.

5. **Publish each accepted layer immediately.**
   Publish a layer as soon as its independent verdict accepts it. Never hold accepted layers locally for a later batch submission.
   Accept the patch before a separately scoped foreground Task commits and pushes the destination branch.
   Pass `role: "publication"` and `capability_profile: "pstack-leaf"` to publication.
   Include commit and PR text in that operation without a separate prose-preparation Task.
   Never publish synthetic snapshot history or join a runtime verifier's incidental patch.
   Publication replaces the draft's snapshot commit with the accepted commit through `--force-with-lease=<branch>:<observed-snapshot-tip>`.
   It updates the PR title and body, then marks the draft ready with `gh pr ready <number>`.
   If the layer has no draft PR, publication opens the PR ready on its parent branch.
   Append only accepted patches in verified order or the operator's specified order.
   No implementer or publication Task merges, arms auto-merge, or closes the PR.
   When publication returns the PR URL, confirm through step 6 that the layer is ready and in the stack, in the same root turn.
   Release the issue's local footprint through `../references/delivery-operations.md` before the next dispatch.
   Then the root starts the assigned loop through `playbooks/babysit.md`.
   Keep one babysitter at the stack's merge frontier while independent builds continue.
   Use `background` while independent builds continue, or `check` for small or docs-only PRs.
   Give code fixes to a fresh implementer and publish accepted corrections through the foreground destination boundary.
   Update the checkpoint after each verdict and publication before advancing to the next issue.

6. **Keep one topology writer.**
   Publication Tasks push only their assigned branches and report their tips, current bases, and intended parents.
   Keep all topology writes at the root.
   Before each topology change, fetch the intended parent and verify the remote child tip with `git ls-remote`.
   Use `git push --force-with-lease=<branch>:<observed-tip>` only for an authorized rewritten child branch.
   If the selected backend cannot enforce that observed tip, block the rewritten push instead of using an implicit lease.
   For Graphite, run `gt track -p <current-tip>` and `gt submit --no-interactive --stack`.
   For GitHub, attach each new layer PR with `gh stack link --remote <remote> --base <trunk> <bottom-to-top PR numbers>` when it opens.
   Omit `--open` for a draft layer. A ready layer that the stack already contains needs no second link.
   That command reads remote pull requests and needs no local stack checkout, so the footprint release can follow at once.
   Never mix backend metadata within one run.

7. **Reverify affected drift.**
   For Graphite, use `gt restack` and `gt sync`.
   For GitHub, use `gh stack rebase` and `gh stack sync`.
   Run a rebase in one temporary stacker worktree created from the remote branches, and release it after the push.
   Give conflicts to a fresh implementer for the issue that owns the affected files, then push through the foreground destination boundary.
   Compare each old and new base-to-head diff with `git patch-id --stable`.
   A changed patch returns to verification.
   An unchanged patch retains its code verdict but still requires current mergeability and CI.
   Recheck live behavior when parent, trunk, configuration, or runtime changes invalidate its evidence.
   Require a fresh root countersign for a genuinely new increase in a pinned gate or budget.

8. **Deliver without landing.**
   Run the final footprint audit from `../references/delivery-operations.md`.
   Leave no run-owned worktree, local branch, container, or volume for a published layer.
   Return the ordered PR chain, owners, head identities, independent verdicts, pilot limits, and evidence locations.
   Report the local footprint before and after the audit, with the reason for each held resource.
   Include each verifier verdict in the PR body or a comment through the authorized publication boundary.
   The operator reviews and lands the stack through the selected backend.

Use **Autopilot-full** only when the queue is independent and landing authority is explicit.
Use **Autopilot-stack** when the operator retains landing control or the work requires a dependent chain.
