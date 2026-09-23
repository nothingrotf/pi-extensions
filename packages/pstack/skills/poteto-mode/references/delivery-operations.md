# Delivery operations

Use this reference for long-running issue queues and correction cycles.
The [delivery contract](delivery-contract.md) owns acceptance and authorization.
The [Task contract](task-contracts.md) owns tool arguments, isolation, and model selection.

## Root model and checkpoints

Model policy selects delegated Tasks, not the root session model.
For the Sol/Terra/Astra/Opus/Luna policy, start a new coordinator with this command:

```sh
pi --model openai-codex/gpt-5.6-sol:medium
```

Preserve explicit operator model choices and existing sessions.
Never change global Pi defaults or restart an active stack to enforce this recommendation.
A model switch does not compact existing context.

Use `pstack_delivery` with `action: "read"` for a compact managed-issue checkpoint.
Read `view: "submissions"` or `view: "criteria"` with `offset` and `limit` for retained records.
Follow `nextOffset`, because the byte budget can shorten a page.
For an oversized submission, open its `detail` locator with `view: "submission"`, `agentId`, and `attempt`.
Pass the returned `sha256` with subsequent offsets. Concatenate `content` chunks before parsing the exact submission.
If the digest changes, restart at offset zero instead of combining different revisions.
Retained references locate evidence but do not verify its current contents.
Delivery records use a linked event journal. Refresh changes integration only and preserves immutable evidence.
Do not rewrite session entries or alternate older and newer extension versions within an active journal.

Keep one small checkpoint per stack in its existing authorized evidence directory.
Update it after each issue handoff, verdict, publication, or operator decision.
Retain these fields:

- Objective, scope, operator gates, and accepted design references.
- Issue states, implementation owners, verification owners, and actual model selectors.
- Agent IDs, attempt IDs, workspace IDs, effective paths, and pending decision or delivery IDs.
- Destination branch, base SHA, head or tree identity, patch URI, digest, and stable patch-id.
- Acceptance matrix, unresolved findings, harness reference, and next authorized action.

Keep raw logs, patches, screenshots, and full reports outside the checkpoint.
Link immutable evidence instead of copying it into every prompt or status response.
Load only the issue and evidence needed for the next decision.
Do not reread an unchanged playbook at every heartbeat.

Before a context handoff, persist the checkpoint and reconcile outstanding tool calls and notices.
At an idle issue boundary, use supported session compaction when context needs reduction.
In interactive Pi, `/compact` can retain the checkpoint reference and unresolved obligations.
If no compaction tool is available, report that limitation instead of inventing one.
Never rewrite session JSONL or start a replacement session while active children still depend on their owner.
Checkpoint persistence alone does not reduce the current context.

## Completion-driven waiting

When independent work remains, do that work before waiting.
Otherwise, wait through `TaskControl.wait` using the typed example in the Task contract.
Omit `timeout_ms` unless a shorter liveness deadline is required.
A re-issued wait costs a full coordinator turn and can miss the provider prompt cache.
Prefer one open wait over repeated short windows.
A completion or decision request is the next scheduling event.
Use the loop heartbeat only to audit liveness, not to delay completion handling.
Never substitute shell `sleep`, polling loops, or repeated status requests for completion-driven waiting.
After a schema error, correct arguments from the actual descriptor before retrying.

## Stalled corrections

Keep partial work as WIP, not as an accepted artifact or verification candidate.
Record completed criteria, failing criteria, evidence changes, and the exact reason for each early return.
Two consecutive incomplete returns without meaningful acceptance progress require diagnosis before another equivalent dispatch.
A recurring contract defect or a structural regression also requires diagnosis before the next correction.

Classify the cause as implementation, environment, execution contract, context, or external decision.
A new passing criterion establishes progress. A changed captured result tree also establishes progress when the completed attempt cites a successful command receipt. Cite that receipt in a criterion or finding. Patch changes alone, repeated result trees, and uncited commands do not establish progress. This check permits another correction without promoting WIP or proving an unresolved criterion.
Fix shared environment failures once before redispatching affected work.
Preserve compatible owners when they can continue from a precise correction brief.
If context or artifact access requires replacement, consolidate the checkpoint before creating a fresh owner.
Cancel a still-running writer before replacing it.

For a structural diagnosis, dispatch one `pstack-leaf` with `role: "hardest tasks"` and the configured selector.
Do not hardcode a model override or reopen accepted design automatically.
Supply the exact artifact, prior findings, failed correction, and executable reproduction.
Require a cause, bounded correction proposal, and regression test plan.
Diagnosis grants no implementation, publication, or acceptance authority.
Return the diagnosis to the implementation owner and retain independent verification afterward.
A retry threshold triggers diagnosis, never automatic acceptance or silent abandonment.

## Managed dispatch binding

Bind managed Tasks with `delivery: { kind: "managed", issue: "<open issue id>" }` before dispatch.
For unrelated work, use `delivery: { kind: "independent" }` without inventing an issue.
Legacy calls can use exactly one `issue: <id>` prompt line or the resumed owner's retained binding.
This requirement covers implementation roles, `code review`, `runtime verification`, `publication`, and `hardest tasks` diagnosis.
Conflicting, duplicate, unknown, and prose-only bindings fail closed.
Resume preserves its existing delivery identity instead of switching issues or escaping managed acceptance.
Never infer an issue from prose or choose the first ledger issue.

After binding, preflight supplies the exact delivery schema, current criteria, and receipt instructions to implementations, reviews, and diagnoses.
Publication instead requires an accepted checkpoint and explicit foreground execution.
Shell reports cite existing `command:n` receipts.
Read-only static reviews and diagnoses can cite retained `read:n` receipts.
Read receipts do not establish runtime verification without shell proof.
Do not fabricate receipt references.
Read-only investigations outside delivery roles and sessions without a ledger remain ordinary Tasks.

## Report validation and repair

Managed terminal validation checks the report before the Task settles.
A bounded correction stays in the same child session with tools disabled.
It can correct report formatting and references, but it cannot execute checks or change product code.
If correction fails, retain WIP, the raw report revisions, and the specific diagnostics.

For an already terminal report-only defect, use `pstack_delivery` with `action: "repair"` before allocating a replacement reviewer.
Inspect the exact persisted report and diagnostics before deciding whether additional execution is necessary.
A completed repair or superseding valid verdict must not leave a permanent redispatch block.
When repair cannot establish the verdict, retain WIP and obtain missing evidence instead of repeating report-only repair indefinitely.
Read the `repair` locator from `recentAttempts`, `view: "submissions"`, or the exact `view: "submission"` envelope.
Copy its `issue`, `agentId`, `attempt`, `revision`, `reportSha256`, `evidenceSha256`, and `artifactSha256` fields unchanged.
Add only the corrected `report` to that locator.
Do not guess hashes or derive them from a checkpoint preview.
Preserve the original technical verdict.
Preserve criterion outcomes, finding identities, blocking severity, and dispositions.
A repair can correct invalid references but cannot make failed evidence pass.
It cannot accept an implementation as an independent review.

Repair retains the original submission and appends an auditable report revision.
It creates no Task, worktree, shell execution, or new runtime proof.
If the repair identity is stale, read the current identity and inspect the changed revision before retrying.
If required evidence is missing, return WIP and obtain it through a separately authorized execution.
Never mutate session JSONL or weaken acceptance to repair a report.

## Artifact and continuation preflight

Read the specific agent's compact status before selecting its artifact.
Retain the returned attempt identity. Request detailed evidence only for the section needed for the next decision.
Use `TaskControl` with `action: "evidence"`, `agent_id`, `attempt`, and `section: "isolation"` for the complete receipt.
Follow the returned cursor until the required section is complete. Never infer omitted data from a preview.
Resolve repository entries by repository identity and relative path.
Never select an artifact, workspace, or patch through modification time, `ls -t`, or a guessed directory layout.
Manifests and artifacts can remain under Git storage while execution paths live elsewhere.
Use the receipt's explicit paths and identities.

A compatible resume retains conversation and creates a new private workspace. Processes and incidental runtime setup do not survive.
For a compatible captured receipt, the runtime reconstructs retained WIP after verifying ownership, location, private Git state, the exact source baseline, and artifact identity.
A failed retained workspace can be recaptured on same-owner resume only after those checks pass.
Unchanged source reconstructs the retained result.
If every repository already matches the retained result, the runtime verifies durable artifacts and digests before skipping patch reapplication.
Dirty unrelated source blocks recovery.
Already integrated attempts do not reapply their old patches.

An unrelated source change, unresolved integration conflict, or legacy receipt without workspace identity blocks automatic reconstruction.
This includes unrelated non-ignored source edits. There is no silent resume-without-WIP fallback.
The failure retains the original receipt and names its artifacts for recovery.
Use a fresh authorized issue owner to reconcile that evidence when the original baseline cannot be restored safely.
Never reset unrelated source edits or discard WIP to force a resume.

Before resuming, retain the WIP patch URI, SHA-256, baseline tree, result tree, and per-criterion evidence.
Pass retained evidence and any required runtime setup in the correction brief.

Before editing in a new attempt:

1. Confirm the effective directory and repository root from the current attempt receipt.
2. Compare the current artifact with the expected baseline and retained result.
3. If the retained result already exists, verify its identity instead of applying the patch twice.
4. If the baseline matches, verify the patch digest and run `git apply --check` before applying it.
5. After applying, verify the resulting tree or complete base-to-result patch identity.
6. If neither identity matches, stop reconstruction and report the mismatch without destructive resets.

Apply patches only inside the effective child workspace.
Never reset or clean the source checkout to reconstruct an isolated attempt.
For nested repositories, reconstruct and verify each recorded repository independently.
A synthetic baseline SHA is not the product head SHA.
An uncommitted candidate requires the product base plus a verified result tree and complete patch identity.
Record a product head SHA when one exists, and require it before publication finishes.

## Integrated probe and gate logs

Before broad implementation, execute the smallest connected path that can expose the integration risk.
For new behavior, build a minimal vertical slice before expanding the implementation.
Exercise the real entry point, authorization, application role, persistence, and observable result when those boundaries apply.
Separate handler and database tests remain useful, but they do not prove the connected path.
Keep the harness in the repository instead of an incidental verifier workspace.
Give the independent reviewer the same launch recipe and add adversarial scenarios to its assignment.

Before expanding the implementation, retain a probe checkpoint with the command receipt, tested boundary, observed result, and remaining gaps.
A failing reproduction establishes the bug, not candidate readiness.
If setup fails, repair the shared harness before expanding product code or creating another verifier.
For persistence behavior, verify durable readback through a separate request or connection rather than an in-memory return value.
For authorization behavior, test the intended application principal and an unauthorized principal against the same entry point.
For revision-sensitive behavior, use divergent counters and mutate the relevant state between requests.
Reject a harness that exits successfully with zero assertions, skipped required scenarios, swallowed errors, or mocked affected boundaries.
A passing command receipt proves execution and exit status, not that its assertions cover the requirement.
The independent reviewer checks this semantic coverage before accepting the result.

Record these fields beside each criterion's proof:

| Field | Retained value |
| --- | --- |
| Source | Agent ID, attempt, and exact receipt ID |
| Subject | Product artifact identity and relevant changed inputs |
| Harness | Repository path, digest, command, and dependency lockfile digest |
| Runtime | Runtime version, configuration identity, and application role without secret values |
| Result | Exit status, duration, output artifact URI, and output digest |
| Applicability | Covered criteria and conditions that invalidate reuse |

Use recorded output artifacts as the authoritative logs.
Read or filter an existing log when only a summary needs to change.
Do not execute the gate again merely to change `tail`, `grep`, or the displayed line count.
Preserve the tested command's exit status when a shell pipeline formats its output.
Keep failed cleanup and expected no-match searches outside the evidence for passing criteria.

If the artifact, harness, configuration, or runtime changes, rerun affected checks and renew the code verdict.
If unchanged inputs cannot be established, treat the retained result as historical evidence, not current proof.
Required repository gates and explicit freshness requirements still apply.
A report-only repair reuses the original attempt's immutable receipts and does not claim a new runtime execution.

## Browser and runtime preflight

Use a repository-owned launch, doctor, drive, evidence, and cleanup recipe.
If the recipe is missing, establish it once before extensive UI work.
Read the installed `control-ui` guide and `agent-browser skills get core` before selecting CLI flags.

Pin these inputs in the harness receipt:

- Artifact identity, dependency lockfile, runtime version, and launch commands.
- Browser CLI version, engine, named session, and expected user agent.
- Exact web origin, API target, certificate paths, readiness checks, and owned process IDs.
- Isolated database, application role, fixture actor, and required authorization headers.

Create a dedicated browser session for the task.
Select Chrome explicitly for visual evidence, unless the project requires a different rendering engine.
Verify the actual engine through `navigator.userAgent` before capturing visual proof.
Never change the global browser configuration, use the shared unnamed session, or close another task's browser.

Keep the origin's scheme, host, and port consistent across proxy, cookies, and allowed-origin configuration.
Use the repository's HTTPS recipe when secure cookies or browser mutation guards require it.
Do not replace HTTPS with HTTP or bypass mutation guards to make a probe pass.
Restrict certificate exceptions to the owned local test session.

Check port ownership before launch and wait for readiness predicates instead of fixed sleeps.
Verify an authenticated read and an authorized mutation through the real browser path before broad screenshots.
Confirm styles load before treating screenshots as visual evidence.
Refresh element references after navigation or rerender.

On failure, retain the command and output and fix the shared recipe before repeating the same setup.
Stop only owned processes and the named browser session during cleanup.
Keep regression probes and receipts outside incidental verifier files so corrections can reuse them.
