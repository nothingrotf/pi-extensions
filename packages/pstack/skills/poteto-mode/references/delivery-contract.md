# Delivery contract

Read this contract before dispatching or resuming issue work.
Use [Delivery operations](delivery-operations.md) for checkpoints, completion-driven waiting, stalled corrections, artifact reconstruction, and runtime preflight.

## Per-issue fields

Bind managed work through `Task.delivery` with `{ kind: "managed", issue: "<open issue id>" }`.
For unrelated work, select `{ kind: "independent" }` instead of inventing an issue.
Copy the following context fields into the Task `prompt` as plain text.
These context fields are not Task schema parameters.
The legacy `issue:` line must agree with the structured binding when both exist.

```text
issue: <stable issue id>
phase: design | implementation | correction | verification | publication
accepted design: <rationale and immutable evidence ref, or none yet>
evidence: <artifact refs required by this phase>
base: <base SHA>
head: <head SHA>
patch: <stable patch-id or captured tree identity>
verification owner: <reviewer identity, isolation, and mode>
acceptance criteria: <checkable criteria, one per line>
```

Before a prospective artifact exists, mark its identity pending with a reason.
Verification and publication require resolved artifact identities, not branch names that can move.

## Risk routing

| Work | Default |
| --- | --- |
| Bounded implementation against an accepted design | One persistent implementer and one independent reviewer |
| Local correction | Same implementer, affected tests, and the same independent reviewer |
| New or contested architecture | Two structurally distinct candidates and one independent judge |
| Runtime validation | A reusable harness on the actual artifact and configuration |

Use a larger panel only for distinct unresolved risks or an explicit user requirement.
A configured model pool supplies candidates, not a dispatch count.
Crossing a function boundary or choosing ordinary local code structure does not reopen design.
Preserve explicit user review gates, including a requested full swarm.

## Lanes and ownership

Assign one implementer before reproduction or discovery and retain it through compatible corrections.
The same owner gathers evidence, investigates, implements, and executes self-proof.
Run `how` and `why` locally by default. A phase boundary alone does not justify a new Task.
For managed delivery, keep the issue owner as a direct Task of the coordinator that owns the ledger.
Delegated coordinators do not inherit that ledger or its managed acceptance hooks.
The independent reviewer never wrote the code under review.
Combine the no-comments checklist, deslop findings, and static audit into one complete verdict.
The reviewer reports cleanup findings, and the implementer applies required edits.
Do not create a separate cleanup agent or verdict-reducer Task for each pass.
A verdict names the artifact, findings, executed checks, evidence, and unresolved blockers.

Use `code review` for static review and `runtime verification` for combined static and executable acceptance checks.
Only `feature`, `bug-fix`, `refactoring`, `perf-issue`, and `hillclimb` can own an implementation submission.
Architecture, diagnosis, review, verification, publication, synthesis, and investigation roles never replace the implementation owner.
If one of those roles returns an implementation-shaped report, retain it as non-owning WIP or reject it without changing candidate identity.
Choose one permitted selector from these pools, not every configured entry.
For required cross-family review, select a different family from the actual implementation model.
If no permitted model satisfies that requirement, return `BLOCKED` and request a policy update.
Plan runtime reviewers with shell access and manual isolation from their first dispatch.
Never join the verifier's incidental patch.

Start with two independent issue lanes when files, dependencies, and mutable resources are disjoint.
Lane count follows verified independence, never the size of a configured model pool.
Serialize shared dependencies and topology changes.
Do not silently increase the two-lane pilot because more models are available.

## Candidate readiness

Keep a criterion matrix with the issue's evidence:

| Criterion | Executed evidence | Result | Remaining obligation |
| --- | --- | --- | --- |
| Each accepted requirement | Command receipt or immutable artifact reference | pass, fail, blocked, or pending | Exact missing proof |

Populate every accepted criterion, not only the criteria covered by existing tests.
A green suite does not prove a requirement that no assertion exercises.
Keep incomplete implementation as WIP until its self-proof matrix passes.
A candidate requires resolved artifact identity, complete self-proof, and a reproducible harness for independent verification.
Unavailable required proof blocks promotion instead of becoming an implicit exemption.
A diagnostic review of WIP remains diagnostic, not an acceptance verdict.
Independent verification can still reject a candidate whose self-proof passes.
Do not publish until the independent verdict and required gates accept the same artifact.

## Structured reports

Return only the required JSON object, without Markdown or surrounding text.
Copy the registered criterion IDs exactly, including previously passing criteria.
Keep review findings in `findings`, not `criteria`.
Preserve complete finding IDs across corrections and reviews.
Use recorded receipt IDs in evidence arrays, not prose, severities, or file paths.
Put explanations and file-line references in `reason`.

A resumed attempt has its own receipt numbering.
Previous `command:n` references do not automatically identify evidence in the new attempt.
For a report-only defect, retain the original report, attempt identity, artifact identity, and immutable receipt references.
Use the managed report-repair operation instead of resuming implementation or creating another workspace.
Repair cannot change execution results, receipt status, artifact identity, or the meaning of a criterion.
If required proof is missing or invalidated, return WIP and obtain that proof through an authorized execution.
Verify retained work before editing or reapplying a patch.
Never rename criteria, fabricate receipts, or discard findings to repair a report.

## Phase handoff

Keep an evidence brief with the original request, all criteria, reproduction, decisive references, rejected hypotheses, artifact, harness, and open findings.
A correction focuses on the delta but preserves previously satisfied invariants.
A summary locates the original evidence and never replaces it.

An accepted design closes design and carries its grounding into implementation and correction.
Those phases do not rerun `how` or `architect` for the same decision.
Return missing, incompatible, or contested design to the coordinator before implementing a different contract.
A leaf returns required delegation instead of bypassing its capability profile.

Resume the same implementer and verifier while their execution contracts remain compatible.
Use report repair for a malformed verdict backed by complete retained evidence.
Resume a compatible reviewer to complete a missing verdict that requires additional inspection or execution.
If runtime resume validation rejects a changed contract, create a fresh child from the saved brief and evidence.
A new role, required tool set, model family, or incompatible artifact access requires a fresh contract.
A diagnosed context failure can also require a fresh owner with a consolidated brief.
Follow the stalled-correction procedure before repeating an equivalent incomplete dispatch.
Carry the existing harness and findings into that replacement instead of restarting discovery.
Do not weaken capability checks to retain an identity.

Keep publication separately scoped and foreground after artifact acceptance and required verification.
Use `publication` for that Task and include commit text and PR text in the same scoped operation.
Do not allocate a separate worktree or preparation owner only to draft publication text.
Reserve `judgment and prose` for prose or evidence synthesis, not technical acceptance.
A publication Task never merges, deploys, or pushes synthetic snapshot history.
Explicitly authorized landing workflows retain their separate merge gates.

## Early probes and verification reuse

Before broad implementation, run an early executable probe across the affected integrations.
For a new feature, implement only enough behavior to exercise that path before expanding coverage.
For a bug fix, preserve the failing path before changing its behavior.
Drive the real entry point through authentication, application wiring, persistence, and observable readback when those boundaries apply.
Separate handler, SQL, and service tests cannot substitute for one connected execution.
Probe the application database role, not only the migration role.
Exercise denial paths, concurrent state changes, and the configured Worker or other actual runtime when relevant.
Retain the probe as a repository-owned harness, then extend it with the implementation and regression scenarios.
The independent reviewer executes that harness and adds adversarial checks without rebuilding an equivalent environment.
Retain the early probe checkpoint before broad implementation, including its receipt, observed result, boundary, and unresolved setup gaps.
A successful exit with zero assertions or skipped required scenarios is not behavioral proof.
Verify durable readback separately from returned memory, and use divergent revision counters when revisions can evolve independently.
If the real surface is unavailable, record the blocker and use the closest executable reproduction without declaring acceptance.

Pin a reusable harness to the actual artifact and configuration.
Retain the exact command, exit status, duration, runtime version, environment identity, database role, output digest, and artifact identity.
Include the harness digest, dependency lockfile digest, and configuration identity without recording secrets.
Keep full logs in immutable artifacts and put their receipt references in the criterion matrix.
Store the reusable harness in the accepted artifact or an explicitly authorized durable location.
A resumed isolated Task creates a new workspace attempt, not a persistent process or unchanged filesystem.
Do not keep the only harness copy in incidental verifier files, and never join those files to recover it.
Reuse the harness across corrections instead of rebuilding equivalent verification environments.
Keep dependency writes private to the verifier workspace.

Reuse a passing receipt only while its artifact, harness, configuration, and runtime inputs remain unchanged.
A changed patch invalidates its code verdict.
A changed runtime or dependency invalidates affected runtime evidence even when the patch-id is unchanged.
After a correction, run affected checks first and keep unresolved findings visible.
Map each finding to its regression test, changed inputs, and retained evidence.
Reproduce each blocking failure on the corrected artifact before issuing a new verdict.
Review the correction delta and adjacent risks rather than restarting unrelated discovery.
Classify new findings as regressions, missed requirements, environment failures, or non-blocking follow-ups.
A changed code verdict still needs renewal even when unaffected runtime receipts remain reusable.
Run every repository-required gate before commit and every user-required acceptance check.
Do not repeat an unchanged passing check without a new failure, changed input, or explicit freshness requirement.
Read or filter the retained log when only its presentation needs to change.
Use the current workspace identity, never a previous attempt's absolute directory.
Preserve the tested command's exit status when piping or filtering its output.
A no-match search or failed cleanup command cannot prove a passing criterion.
Keep such diagnostics separate from successful behavioral evidence.

## Dispatch preflight

Resolve the exact role, model selector, capability profile, tools, and directory before allocating expensive work.
Inspect actual tool descriptors instead of guessing fields.
Tool parameter schemas require an explicit object root.
Nested workflow owners need `pstack-nested`, while bounded implementation against an accepted design can use `pstack-leaf`.
A runtime verifier needs shell access and manual isolation, not a read-only tool policy.
Integrate the accepted patch into the destination before dispatching an isolated verifier from that destination.
Never target another managed workspace beneath `.git` as an isolated Task directory.

## Pilot and evaluation

Compare two independent issues as the pilot for a delivery change.
Record time-to-acceptance, first-review findings, and corrective work, including unfinished and blocked issues.
Use the [throughput procedure](throughput.md) and its tested reporting CLI.
Report the comparison and its limits, and promise no measured savings before collecting real pilot evidence.
The root owns runtime preflight, telemetry, and evaluation utility.

No lane gains authorization for external actions through this contract.
Preserve capability limits, required review, user gates, manual isolation, and model policy.
