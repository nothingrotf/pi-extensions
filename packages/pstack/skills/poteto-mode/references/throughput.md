# Delivery throughput and the two-issue pilot

Measure elapsed time until acceptance, not time until the first implementation finishes.
A completed Task, captured patch, or draft PR does not prove acceptance.

## Record delivery evidence

1. Record the issue start timestamp before discovery, preparation, or implementation.
2. Classify the issue as `bounded`, `integration`, or `architecture` before implementation.
3. Record the actual implementation model selector, including effort and fast mode when available.
4. Retain the first independent review and its count of actionable findings.
5. Record correction intervals through successful reverification.
6. Merge overlapping correction intervals before calculating `correctiveWorkMs`.
7. Record external blocking intervals separately as `blockingMs`.
8. After integration, retain the accepted artifact identity, independent review, and required check receipts.
9. Record `acceptedAt` only after every acceptance requirement passes for that artifact.
10. If work remains incomplete, record `open` or `blocked` with the observation timestamp instead.

Use Unix milliseconds for timestamps and milliseconds for durations.
Never invent timestamps or convert unknown blocking time to zero.
Retain source transcript entries or command receipts beside the measurements file.
Evidence references identify those sources but do not verify their contents automatically.

## Record P2 session evidence

Version 2 measurements retain version 1 delivery fields. They add comparison inputs and session evidence. The CLI derives P2 metrics from timestamped tool events. Do not enter repeated-read counts, compaction counts, preparation duration, or time to first edit as manual aggregates.

For each version 2 delivery, record the required `gates` and discriminating `scenarios`. The comparison is eligible only when every baseline and candidate delivery records the same gate set and scenario set. Gate and scenario names identify the required work. An accepted delivery still needs its review and check evidence.

When the source has session evidence, record a `sessionEvidence.source` reference and each attempt. An attempt can record `requestedAt` and `executionStartedAt`. It can also record `workspaceSetupMs`, `sessionSetupMs`, and tool events. Use these event kinds:

- `read` requires `at` and `target`.
- `edit` requires `at`.
- `compaction` requires `at`.
- `runtime-preflight` requires `at` and `outcome`.

The report retains `repeatedReads` for the version 2 count of repeated reads of the same target within an attempt. It also reports `withinAttemptRepeatedReads` and `crossAttemptRepeatedReads`. The cross-attempt metric counts each target once for every additional attempt that reads it, scoped to one delivery. It does not compare reads between issues and does not label either metric as waste. It measures preparation as `executionStartedAt - requestedAt`. It reports workspace and session setup components without adding them to preparation. It measures time to first edit from `executionStartedAt`. It reports failed runtime preflight events separately when the source includes a model start timestamp. Tool events before a recorded model start are invalid.

Record each correction interval in `correctionEvidence`. Classify it as `omitted-requirement`, `introduced-regression`, `environment`, `execution-contract`, `context`, or `external-decision`. The interval must fit inside the delivery observation interval.

Add `deliveryLedgerEvidence` when a delivery ledger produced the records. Add `operationalPilotEvidence` only after a real operational pilot. If either source is absent, the report records that limitation. Version 2 then reports no descriptive reduction. The CLI does not verify referenced evidence.

Use context recommendations only for observed repeated reads or compactions. Reuse an accepted owner map or API inventory only when policy permits. Keep every explicitly mandated reading in the task brief.

## Inspect Task preparation

`TaskControl.status` exposes `timing` for new Task attempts:

| Field | Meaning |
| --- | --- |
| `requestedAt` | Runtime request entry, before dispatch preflight |
| `executionStartedAt` | Child admission after workspace and session preparation |
| `executionEndedAt` | Model execution completion or failure observation |
| `settledAt` | Terminal record creation after capture and descendant settlement |
| `workspaceSetupMs` | Isolated workspace preparation, including destination discovery |
| `sessionSetupMs` | Child session construction |

Preparation elapsed time equals `executionStartedAt - requestedAt`.
Workspace and session durations identify components of preparation, not additional time to sum with it.
Finalization includes capture and descendant settlement, not later joins or delivery acceptance.
Join operations preserve these timestamps.
Resume creates fresh attempt timing under the same agent identity.
Historical transcript records retain earlier attempts, while status reports the latest attempt.
Legacy records omit `timing` because their exact preparation boundaries are unknown.

Do not sum parallel Task durations to estimate delivery wall time.
Do not treat Task settlement as independent review approval.

## Compare the next two issues

Use two candidate issues with independently verified dependency and file boundaries.
Keep one owner per issue and at most two active delivery lanes.
If the issues share a blocking dependency, serialize them instead.

Keep the model policy fixed during the first workflow pilot.
Compare implementation models separately on matched work only after the workflow stabilizes.
This avoids attributing a workflow improvement to a model change.
The report requires matching complexity, implementation model, and, when supplied, coordinator and reviewer selectors. Record each selector with its effort and fast mode. It withholds savings when these profiles differ.

Select two accepted baseline deliveries with the same complexity mix.
Exclude incomplete drafts from accepted baseline samples.
Record incomplete candidates instead of dropping them to improve the result.
The report withholds a reduction estimate when samples are incomplete, too small, or mismatched.
Even a matched two-issue comparison is descriptive evidence, not a causal benchmark or backlog forecast.

Run the report from the installed package directory:

```sh
bun src/throughput-cli.ts /absolute/path/to/measurements.json
```

From this repository root, run:

```sh
bun packages/pstack/src/throughput-cli.ts /absolute/path/to/measurements.json
```

The CLI reads the measurements file without changing it.
Invalid evidence produces a nonzero exit code and no success report.
The output includes acceptance time, correction time, first-pass acceptance, p90 time to acceptance, and accepted, blocked, and incomplete denominators. P90 uses the nearest-rank value: after sorting accepted delivery times, it selects the value at `ceil(0.90 * sample size)`. A zero-sample p90 is `null`, and every p90 includes its accepted-delivery sample size. It includes complexity-specific model groups, correction classifications, and session metrics. Version 2 also reports gate and scenario matches, data-source limits, and recommendations that preserve mandated reading. Version 3 additionally reports observed model usage cost and its coverage limits.

## Compare model policies on matched work

Keep a copy of the previous selector file before changing the active policy.
Treat the revised policy as a hypothesis, not a measured improvement.
Separate model-policy comparisons from workflow comparisons; the two-issue workflow pilot does not establish a model ranking.
Keep the workflow, verification contract, task specification, starting tree, dependencies, and required scenarios fixed across policy arms.
Use fresh workspaces and agent contexts for each run.
Record every actual selector, including effort, fast mode, and any escalation.
Pin reviewer and verifier selections explicitly when their configured pools contain distinct choices.

Compare the complete old and new policies first when evaluating the overall delivery configuration.
For attribution to a particular role, change only that role's selector in a separate comparison.
Run at least three repetitions per task and policy arm before drawing a descriptive conclusion.
Alternate policy order to reduce time-of-day and service-load effects.
Retain all failed, blocked, interrupted, and unfinished runs in the denominator.
Do not count checkpoints from the same evolving workspace as independent samples.

Record these outcomes beside their immutable evidence:

- Cumulative acceptance across every required scenario, not only the newest feature.
- Introduced regressions, previously unmet requirements, and failures whose origin remains unknown.
- Correction rounds, time to acceptance, and required checks that remain unavailable.
- Review findings confirmed by executable evidence, plus defects discovered after acceptance.
- Observed total usage cost, accounting coverage, and cost per accepted delivery when accounting is complete.

Use the existing correction classifications and describe failure origins in the retained evidence.
Keep later defect observations beside the original acceptance evidence instead of rewriting the historical verdict.
State the observation window; no observed escaped defects does not establish that none exist.
Use version 3 accounting for observed model costs, and never substitute unknown cost with zero.
The throughput CLI intentionally withholds reduction estimates when compared model profiles differ.
Report model-policy results separately rather than changing selector labels to bypass that guard.
Report per-task outcomes and their uncertainty; three repetitions do not establish a universal winner.
Do not claim savings from incomplete accounting or higher reliability from a single run.

Schedule paid model comparisons only within explicit benchmark scope and budget.
Policy editing alone does not authorize new delivery issues or external publication.

## Measurements format

This example is synthetic format documentation, not pilot evidence:

```json
{
  "version": 1,
  "deliveries": [
    {
      "issue": "example-baseline",
      "cohort": "baseline",
      "complexity": "integration",
      "implementationModel": "provider/model:effort",
      "startedAt": 1000,
      "blockingMs": 0,
      "state": "accepted",
      "acceptedAt": 101000,
      "correctiveWorkMs": 20000,
      "firstReviewFindings": 2,
      "artifact": "/evidence/accepted-tree",
      "reviewEvidence": "/evidence/independent-review",
      "checksEvidence": "/evidence/required-checks"
    },
    {
      "issue": "example-candidate",
      "cohort": "candidate",
      "complexity": "integration",
      "implementationModel": "provider/model:effort",
      "startedAt": 200000,
      "blockingMs": 10000,
      "state": "blocked",
      "observedAt": 240000
    }
  ]
}
```

Use `open` with the same fields as `blocked` for work that continues without an external blocker.
Accepted records require all three evidence references and the first-review finding count.
Each issue appears once, so replace its open observation when acceptance occurs.
Preserve the original receipts outside this summary file.

Version 1 remains valid for the existing delivery summary. It cannot establish matching gates or scenarios. It also cannot establish a delivery-ledger source or operational-pilot evidence. The report keeps its descriptive reduction empty. Use version 2 for P2 comparison.

This version 2 example is synthetic format documentation, not pilot evidence:

```json
{
  "version": 2,
  "deliveryLedgerEvidence": "/evidence/delivery-ledger",
  "deliveries": [
    {
      "issue": "example-candidate",
      "cohort": "candidate",
      "complexity": "integration",
      "implementationModel": "provider/model:effort",
      "startedAt": 200000,
      "blockingMs": 10000,
      "state": "blocked",
      "observedAt": 240000,
      "gates": ["independent-review", "required-checks"],
      "scenarios": ["durable-delivery"],
      "correctionEvidence": [
        {
          "classification": "omitted-requirement",
          "startedAt": 210000,
          "endedAt": 220000
        }
      ],
      "sessionEvidence": {
        "source": "/evidence/task-session",
        "attempts": [
          {
            "requestedAt": 200000,
            "executionStartedAt": 202000,
            "events": [
              { "kind": "read", "at": 203000, "target": "docs/contract.md" },
              { "kind": "edit", "at": 205000 },
              { "kind": "runtime-preflight", "at": 206000, "outcome": "failed" }
            ]
          }
        ]
      }
    }
  ]
}
```

## Record P3 model usage accounting

Version 3 retains every version 2 delivery field and may add `coordinatorModel`, `reviewerModel`, and `modelUsageEvidence`. The coordinator and reviewer selectors are optional, but when supplied they must include the actual model, effort, and fast mode and must match across comparison cohorts. The existing `implementationModel` remains required.

`modelUsageEvidence` is optional because some evidence sources do not expose billing data. When present, its `source` must identify raw issue-scoped accounting evidence, not a parent aggregate. It declares `coveredRoles` and records one aggregate row per agent attempt in `entries`. A record retains its agent identity, attempt identity, model selector, start and end timestamps, input, output, and cache token counts, `usageRole`, and optional USD cost. Valid accounting roles are `coordinator`, `implementation`, `review`, `retry`, `publication`, and `advisory`.

Use a unique source for each delivery and a globally unique `(agent, attempt)` identity for each entry. Do not copy a parent total into child deliveries or combine an agent attempt with a retry. Aggregate model calls within each agent attempt. Never include parent totals that already contain child usage. The CLI verifies shape and duplicate identities, but does not inspect the evidence source or collect telemetry automatically.

A missing `costUsd` is unknown, not zero. The report sums observed costs and input, output, and cache tokens. It reports pooled accounting and separate baseline and candidate accounting. Accepted, open, and blocked deliveries retain separate cost denominators.

Cost per accepted delivery requires accounting for every delivery, coverage of all six roles, and known costs.
Each delivery requires at least one observed attempt. Every covered role requires an observed entry or an explicit `zeroUsageRoles` declaration.
Declare zero usage only when the referenced accounting source establishes that no model attempt used that role.
Empty entries or missing role observations leave accounting incomplete. A role cannot appear in both entries and `zeroUsageRoles`. Its numerator includes costs from accepted, open, and blocked work. Its denominator includes only accepted deliveries. Partial role coverage remains observable but cannot establish complete delivery cost.

This version 3 example is synthetic format documentation, not pilot evidence:

```json
{
  "version": 3,
  "deliveries": [
    {
      "issue": "example-candidate",
      "cohort": "candidate",
      "complexity": "integration",
      "implementationModel": "provider/implementer:high:fast",
      "coordinatorModel": "provider/coordinator:medium",
      "reviewerModel": "provider/reviewer:xhigh",
      "startedAt": 200000,
      "blockingMs": 10000,
      "state": "accepted",
      "acceptedAt": 260000,
      "correctiveWorkMs": 5000,
      "firstReviewFindings": 1,
      "artifact": "/evidence/accepted-tree",
      "reviewEvidence": "/evidence/independent-review",
      "checksEvidence": "/evidence/required-checks",
      "gates": ["independent-review", "required-checks"],
      "scenarios": ["durable-delivery"],
      "modelUsageEvidence": {
        "source": "/evidence/example-candidate/raw-model-usage",
        "coveredRoles": ["coordinator", "implementation", "review", "retry", "publication", "advisory"],
        "zeroUsageRoles": ["coordinator", "review", "retry", "publication", "advisory"],
        "entries": [
          {
            "agent": "implementer-1",
            "attempt": "attempt-1",
            "usageRole": "implementation",
            "model": "provider/implementer:high:fast",
            "startedAt": 210000,
            "endedAt": 230000,
            "inputTokens": 1200,
            "outputTokens": 800,
            "cacheTokens": 400,
            "costUsd": 0.42
          }
        ]
      }
    }
  ]
}
```

Do not change global model selectors, publish PRs, or start unrelated issues through this reporting procedure.
