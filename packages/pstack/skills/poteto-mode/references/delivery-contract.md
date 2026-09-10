# Delivery contract

Read this contract before dispatching or resuming issue work.

## Per-issue fields

Copy these fields into the Task `prompt` as plain text.
They are prompt content, not Task schema parameters.

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

Keep one implementer responsible for each issue through compatible corrections.
The independent reviewer never wrote the code under review.
Combine the no-comments checklist, deslop findings, and static audit into one complete verdict.
The reviewer reports cleanup findings, and the implementer applies required edits.
Do not create a separate cleanup agent or verdict-reducer Task for each pass.
A verdict names the artifact, findings, executed checks, evidence, and unresolved blockers.

Use `code review` for static review and `runtime verification` for combined static and executable acceptance checks.
Choose one permitted selector from these pools, not every configured entry.
For required cross-family review, select a different family from the actual implementation model.
If no permitted model satisfies that requirement, return `BLOCKED` and request a policy update.
Plan runtime reviewers with shell access and manual isolation from their first dispatch.
Never join the verifier's incidental patch.

Start with two independent issue lanes when files, dependencies, and mutable resources are disjoint.
Lane count follows verified independence, never the size of a configured model pool.
Serialize shared dependencies and topology changes.
Do not silently increase the two-lane pilot because more models are available.

## Phase handoff

An accepted design closes design and carries its grounding into implementation and correction.
Those phases do not rerun `how` or `architect` for the same decision.
Return missing, incompatible, or contested design to the coordinator before implementing a different contract.
A leaf returns required delegation instead of bypassing its capability profile.

Resume the same implementer and verifier while their execution contracts remain compatible.
Resume a compatible reviewer to complete a missing verdict instead of repeating its review.
If runtime resume validation rejects a changed contract, create a fresh child from the saved brief and evidence.
A new role, required tool set, model family, or incompatible artifact access requires a fresh contract.
Carry the existing harness and findings into that replacement instead of restarting discovery.
Do not weaken capability checks to retain an identity.

Keep publication separately scoped and foreground after artifact acceptance and required verification.
Use `publication` for that Task and include commit text and PR text in the same scoped operation.
Do not allocate a separate worktree or preparation owner only to draft publication text.
Reserve `judgment and prose` for prose or evidence synthesis, not technical acceptance.
A publication Task never merges, deploys, or pushes synthetic snapshot history.
Explicitly authorized landing workflows retain their separate merge gates.

## Early probes and verification reuse

Run an early executable probe before extensive implementation across security, concurrency, database-role, or runtime boundaries.
Probe the application database role, not only the migration role.
Exercise denial paths, concurrent state changes, and the configured Worker or other actual runtime when relevant.
If the real surface is unavailable, record the blocker and use the closest executable reproduction without declaring acceptance.

Pin a reusable harness to the actual artifact and configuration.
Retain the command, runtime version, environment identity, database role, output, and artifact identity with its verdict.
Store the reusable harness in the accepted artifact or an explicitly authorized durable location.
A resumed isolated Task creates a new workspace attempt, not a persistent process or unchanged filesystem.
Do not keep the only harness copy in incidental verifier files, and never join those files to recover it.
Reuse the harness across corrections instead of rebuilding equivalent verification environments.
Keep dependency writes private to the verifier workspace.

Reuse a passing receipt only while its artifact, harness, configuration, and runtime inputs remain unchanged.
A changed patch invalidates its code verdict.
A changed runtime or dependency invalidates affected runtime evidence even when the patch-id is unchanged.
After a correction, run affected checks first and keep unresolved findings visible.
Run every repository-required gate before commit and every user-required acceptance check.
Do not repeat an unchanged passing check without a new failure, changed input, or explicit freshness requirement.

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
