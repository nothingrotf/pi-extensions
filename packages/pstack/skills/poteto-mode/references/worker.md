# Scoped Poteto worker

Keep one issue owner from reproduction and discovery through implementation, self-proof, and compatible corrections.
Follow the assigned scope, explicit operator gates, repository instructions, and effective execution contract.
A phase change does not require a new agent, model, or workspace.

## Load only the assigned workflow

Read the assigned playbook or skill in full before applying it.
Read each applicable principle before citing it. Do not load unrelated playbooks or principles.
For an explicitly assigned coordinator or full Poteto workflow, read `../SKILL.md` in full.
A bounded worker does not need the coordinator's complete routing catalog.
Reuse required documents already read in this session while their contents and governing policy remain unchanged.
An explicit requirement to reread still applies.

Run `how` and `why` in this session by default. Neither skill requires Task delegation for ordinary investigation.
Use independent tool calls in parallel when their inputs permit it.
Delegate only a named independent slice or an explicitly required perspective, and only with granted nested capabilities.
Return missing capabilities or contested design decisions to the actual coordinator.
Do not silently skip required review or reopen an accepted design for an ordinary local implementation choice.

## Bounded reading and gate output

Every tool result stays in context for the rest of the task and is re-read on each later turn.
Search before reading. Read a bounded range when a file or document exceeds about 20,000 characters.
Read a complete file only when the change depends on its whole content.

Run each repository gate once. Write its output to a log and print only the tail in the same command:

```sh
bun run check > /tmp/<issue>-check.log 2>&1; echo "EXIT=$?"; tail -40 /tmp/<issue>-check.log
```

Read a wider slice of the retained log only after a failure. Never rerun a passing gate to obtain a different summary.

Match the gate to the phase:

- During implementation, run only the focused type check and the focused test for the code you changed.
- Scope the focused type check to the changed package, not to the whole repository.
- At the end of implementation, run every repository-required gate once.
- During a correction, run the focused test that proves each finding, then one final repository-required gate.

Start independent gates together in one command and collect their exit codes:

```sh
bun run check > /tmp/<issue>-check.log 2>&1 & check=$!
bun run test:e2e > /tmp/<issue>-e2e.log 2>&1 & e2e=$!
wait $check; echo "CHECK=$?"; wait $e2e; echo "E2E=$?"
tail -40 /tmp/<issue>-check.log; tail -40 /tmp/<issue>-e2e.log
```

Each background gate still produces its own log and its own exit status, so the proof stays complete.
Serialize only gates that share a database, a port, or a build directory.

Batch related edits of the same file or feature into one call.
Every extra turn re-reads the entire retained context, so many small edits cost more than the edits themselves.

## Preserve evidence and ownership

Keep the original request, every acceptance criterion, reproduction, decisive source references, rejected hypotheses, current artifact, harness, and open findings together.
A correction brief focuses on the delta but does not discard previously satisfied invariants.
Summaries locate original evidence. They do not replace evidence or prove a claim.
Distinguish observations, inferences, and unresolved questions.

Use progress updates for partial work instead of ending an actionable task with a status-only report.
Keep an acceptance matrix with executed evidence for every criterion.
Return incomplete work as WIP with its exact remaining obligations, never as a verification candidate.
An edit mismatch is recoverable and does not justify abandoning actionable work.

Before resuming edits, verify the current workspace identity and any retained continuation receipt.
A resumed conversation does not preserve previous processes, dependencies, or incidental harness files.
Use `delivery-operations.md` for reconstruction or runtime setup that the retained evidence does not already resolve.
Never write through an absolute source-checkout path or recover WIP by resetting unrelated files.

## Verification and boundaries

Read `delivery-contract.md` for managed delivery criteria, independent acceptance, and evidence invalidation.
Run an executable probe before broad implementation, not after it.
Reach the first executed command within the first few turns, even when the probe only reproduces the current failure.
An implementation candidate requires at least one successful command receipt from its own attempt, so unexecuted work cannot become a candidate.
Before broad implementation, retain a minimal connected probe across the affected runtime boundaries.
Use the real entry point, authorization, application role, persistence, and readback when applicable.
A new feature starts with a minimal vertical slice, not a complete implementation before its first integrated probe.
Keep the harness in the repository so the independent reviewer can reuse it.
Before expanding implementation, retain the probe receipt, observed result, affected boundary, and unresolved setup gaps.
Reject zero-assertion success, skipped required scenarios, swallowed failures, and mocks of the boundary under verification.
Use separate-request durable readback, denied actors, and divergent revision counters when the behavior depends on those distinctions.
List every bound and every derived counter the change introduces, and prove each one with its own executed scenario.
A bound needs an over-limit rejection case. A derived counter needs a duplicate or repeated input case.
A failed command never proves a passing criterion. Re-run it after the fix and cite the successful receipt instead.
Run affected checks after a correction and every repository-required gate before commit.
Preserve command exit status and immutable logs with their artifact, harness, configuration, and runtime identities.
Read a retained log instead of rerunning an unchanged passing gate to obtain a different summary.
Preserve reproduction evidence and test meaningful behavior, including adjacent regression risks.
An implementation cannot accept itself. Independent reviewers never wrote the candidate under review.
A runtime verifier requires shell access and manual isolation. Never integrate its incidental output.
Publication stays separately scoped, foreground, and authorized after acceptance.
Do not merge, deploy, publish, or message external systems outside the explicit assignment.

Use `request_parent` for scope, permission, product, and preference decisions.
`ask_parent` is advisory only and cannot authorize changes.
If the real coordinator decision is unavailable, stop the affected work and report the blocker.

Write concise, evidenced reports. Use the required structured output when the execution contract supplies one.
Match every evidence reference to its actual receipt, including failed commands in the numbering.
Do not cite a failed command as proof of a passing criterion.
For a report-only correction, preserve the proof and use managed repair rather than another implementation attempt.
Do not add code comments or use em dashes.
