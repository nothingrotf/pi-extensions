---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape."
disable-model-invocation: true
---

# Arena

Read [Task contracts](../poteto-mode/references/task-contracts.md) before dispatch. Pass `capability_profile: "pstack-leaf"` for non-delegating candidates and judges. Use `pstack-nested` only for owners whose assigned workflow requires delegation.

Use `todo_write` to create one item per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify) before you launch anything.

## Phase A: Frame

Every candidate gets the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric, 3-6 concrete gradeable criteria for what success looks like on *this* task. It is the picker's tool in Phase D. Candidates only see the task.
3. Pick the runners. Use the parsed `arena runners` runtime policy in context when configured. Concrete entries use `provider/model-id:effort [fast]`. For distinct choices, pass each selected `Task.model` explicitly, including `auto` or `inherit-parent` for an inherited entry. The configured pool is availability for selection, never a dispatch count. If the role is absent, inherit the parent model for each candidate the arena needs. Spawn more than the minimum only when the arena covers multiple distinct design directions. Use the same model N times when the work is generation-bound rather than judgment-sensitive.
4. Assign isolated outputs. For repository writers, give each candidate `isolation: { mode: "worktree", integration: "branch" }`. For other artifacts, assign a distinct output directory to each candidate. N candidates must never write to the same path, per the **separate-before-serializing-shared-state** principle skill.

## Phase B: Fan out

Set each candidate's `Task.role` to `arena runners`, or `architect runners` when Architect selects the runner policy. Spawn all N candidates in one message with `Task`. Use `subagent_type: "generalPurpose"` and `run_in_background: true`. Give each candidate the task, shared grounding path, isolated output contract, and instructions to produce an artifact and a short rationale naming the alternatives it considered and what it rejected. Native `Task` notifications report completion. Do not poll. If you are blocked with no other work, call `TaskControl` with `action: "wait"`.

If a candidate produces no output, proceed with N-1 and note the dropout.

## Phase C: Cross-judge

After all Phase B candidates complete, choose one entry from the parsed `arena cross-judge pool` runtime policy in context. If the role is absent, inherit the parent model. Prefer a verified concrete selector from a different model family. For a distinct pool, pass the chosen `Task.model` explicitly, including `auto` or `inherit-parent` for an inherited entry. Never silently choose the first entry. Spawn one read-only judge with `Task` and `role: "arena cross-judge pool"`. Pass the rubric, terminal outputs, artifact references, and rationales with stable candidate labels. The judge scores each criterion and recommends a base with rationale. It runs in parallel with your reading in Phase D, not with the candidates. If Pi rejects a concrete selector, mark the judge `BLOCKED` and continue your review. Do not substitute a model.

## Phase D: Pick a base

Read every candidate end to end before picking. Score each against the rubric criterion by criterion, not on holistic feel, and compare with the cross-judge. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base a future maintainer can extend most easily without breaking invariants. When two feel tied, prefer the cleaner boundary or smaller API, per the Laziness Protocol.

## Phase E: Graft

Walk each losing candidate once more for what is worth porting into the base, usually one or two things per candidate, not most of it. Fold each graft in by hand, per the **redesign-from-first-principles** principle skill, so the result stays coherent under one mental model. Don't paste mechanically. For repository artifacts, use the retained `Task` branches or patches. Apply only the selected base and explicit grafts.

If the candidates converge on one shape, that is strong agreement. Note it and ship the consensus shape. No graft is needed. If they wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

Verify the synthesized artifact like any other output, per the **prove-it-works** principle skill. If verification finds a problem the arena missed, either Phase A was wrong (re-frame and re-run) or a candidate caught it and you missed the graft (go back to Phase E). Don't paper over it.

## Outputs

One synthesized artifact, with a short synthesis note alongside naming the base and why, the cross-judge's verdict, each graft with its source candidate, what was rejected and why, any convergence or dropouts, and the verification result.
