---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for /swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration."
disable-model-invocation: true
---

# Swarm

Fan out N parallel local Task workers. They can cover separate slices, race the same brief, or mix both. The parent waits, aggregates, and returns one report.

## Start

Use `todo_write` to create one item per phase before you launch anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Set N from the user or derive it from the shape. N is total workers.
4. For ordinary workers, use the parsed `swarm workers` runtime policy in context.
   Omit `Task.model` to select its scalar default.
   Concrete selectors use `provider/model-id:effort [fast]` and must match the configured role.
   If the role is absent, use inherited workers.
   For a model race, name each arm's model up front.
   If the configured scalar policy prevents the race, request a policy change instead of bypassing it.

   Managed verification uses its delivery role's pool instead, as Phase B defines.
   Verify each concrete selector against the active Pi runtime.
   If Pi rejects it, mark that arm `BLOCKED`.
   Do not substitute a model.
5. Give each worker its own writable output when it writes. For repository writers, use `isolation: { mode: "worktree", integration: "branch" }`. For other artifacts, use `/tmp/swarm-<slug>/worker-<n>/` or another distinct output directory.

## Phase B: Fan out

Read [Task contracts](../poteto-mode/references/task-contracts.md) before dispatch.
For ordinary coverage, set `Task.role` to `swarm workers` and `delivery: { kind: "independent" }`.
Pass `capability_profile: "pstack-leaf"` for leaves or `pstack-nested` for owners whose workflow requires delegation.

For managed verification, use `code review` for static analysis or `runtime verification` for shell proof.
Bind each worker with `delivery: { kind: "managed", issue: "<existing issue id>" }`.
Select a permitted model from that role's pool, explicitly when choices differ.
Retain the declared worker count, never the pool size.

Spawn all N workers in one message with parallel `Task` calls. Use `subagent_type: "generalPurpose"` and `run_in_background: true`. Native `Task` notifications report completion. Do not poll. If you are blocked with no other work, call `TaskControl` with `action: "wait"`.

Use `readonly: true` for static analysis. A worker that runs shell verification must be mutable with `isolation: { mode: "worktree", integration: "manual" }`. Never join its incidental patch. Keep repository writers separate from runtime verifiers.

Every brief stands alone.
Include the goal, scope, exact slice or race arm, verification method, and report contract.

For an independent delivery:

- Require `outputSchema` with `schemaMode: "strict"`.
- The schema contains `status` with `PASS`, `ISSUES`, or `BLOCKED`, plus `summary`, `evidence`, and `gaps`.
- Require an output artifact and status, schema-valid, artifact-present, and `/status` membership gates.

Omit `outputSchema` and `schemaMode` in a managed delivery.
Preflight supplies the exact `DeliveryOutputSchema` and current criteria.
Carry the contract below in evidence, findings, and `reason`.
Use only registered criterion IDs and preserve their required coverage.
New review findings belong in `findings`, not `criteria`.
Record missing proof against its registered criterion without claiming acceptance.

## Verifiable work contract

Apply these requirements only when the brief verifies or measures a product. Never invent SHAs or a benchmark method for generation or writing work.

Name the exact product under test in the brief.
For a committed artifact, give base and head SHAs.
For an uncommitted artifact, give the base, result tree, and patch digest.
A branch name that can move is not an identity.
Require the same identity in the result, backed by recorded evidence rather than copied from the brief.

For measurements, define the number of samples, what one sample is, and the order or interleaving of arms.
Name the runtime and conditions that affect the result.
Require the report to state the method it actually used.
Verification without measurement does not require benchmark metadata.

For independent proof reports, add a required structured `subject` field to the strict output schema.
It records the requested identity and observed identity plus a Boolean `established` field.
Use `established: false` when identity cannot be established.
The `observed` field is an empty string when unavailable, never a fabricated identity.
Use this schema for the `subject` property:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["requested", "observed", "established"],
  "properties": {
    "requested": { "type": "string" },
    "observed": { "type": "string" },
    "established": { "type": "boolean" }
  }
}
```

For measurements, also require a structured `method` field next to `subject` in the report schema.
Include sample count, sample definition, order, runtime, and conditions.
Managed reports retain `DeliveryOutputSchema` instead of adding these fields.
The `summary`, `evidence`, and `gaps` state the assigned contract.
Name the actual checks and results, not a generic `evidence` field.
The `evidence` field cites the checks and receipts that support each claim.
The `gaps` field lists every unmet part of the contract.

Missing or incompatible identity is a gap, never `PASS`.
An unestablished identity is missing proof, even when the schema passes.
Missing or incompatible method is a gap, never `PASS`, when measurement is assigned.
For independent reports, return `ISSUES` for demonstrated discrepancies or `BLOCKED` for unavailable required proof.

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

After native notifications arrive, inspect each terminal result with `TaskControl` `status`. Check the structured output, artifacts, gates, and isolation receipt. Schema gates prove shape, not semantic truth. Audit each result against its assigned requirements.

For product proof, match the observed identity and any required method to the brief.
Check that recorded evidence supports the verdict. Keep every demonstrated defect, not only the first.

If the proof exists with receipts intact and only the report is defective, repair the report through the supported path. In a managed delivery, use `pstack_delivery` with `action: "repair"` per [Delivery operations](../poteto-mode/references/delivery-operations.md), without a new Task or model run. Missing execution needs real proof, not repair. Obtain it through an authorized execution. Existing diagnoses still apply.

For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

Keep a compact result table, one-line evidenced issues, and explicit gaps or dropouts. Downgrade a result when its assigned identity or method is missing or incompatible.

## Phase D: Report

Return one consolidated in-chat report with the table, issue one-liners, gaps or dropouts, and the race rule when used.
