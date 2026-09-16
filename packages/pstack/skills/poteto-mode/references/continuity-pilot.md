# Continuity pilot

## Compare workflows, not safety gates

Compare the previous workflow with local investigation and one continuous issue owner.
Keep repository revisions, task scope, tools, acceptance criteria, independent review, and publication requirements equivalent.
Record exact coordinator, implementation, and reviewer selectors, including effort and fast mode.
Do not change global model policy for this experiment.

Use two candidate issues as an operational rehearsal, not a statistical benchmark.
Then use matched samples across bounded changes, integrations, and architectural decisions.
Retain blocked and unfinished issues in their original cohorts.
Never create substitute successes when an issue fails acceptance.

## Preserve attribution

1. Record the original request and every criterion before discovery.
2. Assign the implementation owner before reproduction or investigation.
3. Record source references, discarded hypotheses, artifact identities, and the runtime harness.
4. Record every owner transfer and its reason.
5. Retain every attempt, including failed preparation and abandoned work.
6. Attribute coordinator usage to issue-scoped intervals without copying parent aggregate totals.
7. Mark unavailable billing data as unknown.
8. Record acceptance only after independent review and all required checks pass.
9. Record post-acceptance regressions separately from first-review findings.
10. Retain the raw evidence for independent inspection.

Use [throughput.md](throughput.md) for version 3 measurements and CLI commands.
Compare baseline and candidate accounting separately through `modelUsageByCohort`.
Cost per accepted delivery includes costs from incomplete and blocked work in its numerator.
The denominator includes only accepted deliveries.

Review these outcomes together:

- Median and p90 time to acceptance, with sample sizes.
- Total cost per accepted delivery and unknown-cost coverage.
- Input, output, and cache tokens.
- First-pass acceptance, omitted requirements, and introduced regressions.
- Open and blocked denominators.
- Violations of acceptance, isolation, and publication gates.
- Owner transfers, repeated reads, and observed preparation time.

The current reporter does not derive owner transfers, critical-path delay, or post-acceptance regressions automatically.
Retain those observations beside the measurement file instead of inventing supported fields or zero values.
Matched profiles and source references permit descriptive comparison, not causal attribution.
No operational savings claim follows from synthetic regression tests.

## Concurrency decision

Keep at most two issue lanes unless the operator explicitly authorizes a broader workflow.
Verify disjoint files, dependencies, workspaces, and mutable resources before parallel implementation.

Read-only Task graphs now release a node when its own dependencies settle.
A slow unrelated sibling no longer blocks that node.
Graphs with mutable tasks retain wave execution and integration barriers.
This preserves the product snapshot and conflict handling required by dependent writers.

The scheduler does not add a global concurrency semaphore.
It retains ready-task dispatch without a new capacity limit, so cross-wave overlap can increase peak read-only concurrency.
Measure active tasks, throttling, memory pressure, and elapsed time before selecting a new capacity policy.
Do not infer a concurrency limit from the number of configured models.

## Completion evidence

Record actual command receipts and artifact identities for each pilot delivery.
Do not publish PRs, change credentials, or start unrelated issues through this procedure.
A prepared comparison protocol is not a completed operational pilot.
