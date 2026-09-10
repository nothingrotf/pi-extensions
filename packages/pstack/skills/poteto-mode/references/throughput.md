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
Group results by implementation model and complexity, but inspect reviewer differences before drawing conclusions.

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
The output includes acceptance time, correction time, first-pass acceptance, unfinished counts, and complexity-specific model groups.

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

Do not change global model selectors, publish PRs, or start unrelated issues through this reporting procedure.
