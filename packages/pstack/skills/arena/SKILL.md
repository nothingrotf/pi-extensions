---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape."
disable-model-invocation: true
---

# Arena

Fan out N parallel attempts at the same task. Read every candidate end to end. Pick the strongest as the base. Graft the best ideas from the others into it. Verify the synthesized result.

## Start

Use `todo_write` to create one item per phase before you launch anything. The arena runs autonomously, and the list keeps each phase visible.

1. Frame
2. Fan out
3. Cross-judge
4. Pick
5. Graft
6. Verify

## Phase A: Frame

The N candidates will receive the same prompt, so the prompt is the contract. Get it right before spawning anything.

1. State the artifact each candidate is producing.
2. Derive the rubric. State what success looks like for *this* task, then turn it into 3-6 concrete gradeable criteria. Concrete: `Adds a --dry-run flag that skips writes`. Vague: `code is correct`. The rubric is the picker's tool in Phase D; candidates only see the task.
3. Pick the runners. Use `arena runners` from `~/.agents/rules/pstack-models.md` when present. Concrete entries use `provider/model-id:effort [fast]`. Omit `Task.model` for `auto` or `inherit-parent`. If the role is absent, use four inherited runners. Spawn more when the arena covers multiple design directions. Use the same model N times when the work is generation-bound rather than judgment-sensitive.
4. Assign isolated outputs. For repository writers, give each candidate `isolation: { mode: "worktree", integration: "branch" }`. For other artifacts, assign a distinct output directory to each candidate. N candidates must never write to the same path, per the **separate-before-serializing-shared-state** principle skill.

## Phase B: Fan out

Spawn all N candidates in one message with `Task`. Use `subagent_type: "generalPurpose"` and `run_in_background: true`. Give each candidate the task, shared grounding path, isolated output contract, and instructions to produce an artifact and short rationale. Native `Task` notifications report completion. Do not poll.

The rationale is mandatory. Without it, the parent cannot tell whether a candidate's structure is principled or accidental, which makes Phase E grafting unreliable. Each rationale names the alternatives the candidate considered and what it rejected.

If a candidate fails to produce output, proceed with N-1 and note the dropout in the synthesis record.

## Phase C: Cross-judge

After all Phase B candidates complete, choose one entry from the `arena cross-judge pool` in `~/.agents/rules/pstack-models.md`. If the role is absent, inherit the parent model. Prefer a verified concrete selector from a different model family. Omit `Task.model` for `auto` or `inherit-parent`. Spawn one read-only judge with `Task`. Pass the rubric, terminal outputs, artifact references, and rationales with stable candidate labels. The judge scores each criterion and recommends a base with rationale. It runs in parallel with the parent's Phase D review, not with the candidates. If Pi rejects a concrete selector, mark the judge `BLOCKED` and continue the parent's review. Do not substitute a model.

## Phase D: Pick a base

Read every candidate end to end before picking. Skimming N candidates surfaces only the candidate whose surface looks most familiar.

Score each candidate against the rubric criterion by criterion, not on holistic feel. Compare against the cross-judge. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base on which candidate a future maintainer can extend most easily without breaking invariants. Prefer the cleaner boundary or smaller surface area when two feel tied, per the Laziness Protocol.

Record the pick and the reason in a short synthesis note alongside the base artifact, including the cross-judge's verdict.

## Phase E: Graft

Walk each losing candidate once more and identify what is worth porting into the base. The signal is usually one or two things per candidate, not most of it.

Fold each graft in by hand, per the **redesign-from-first-principles** principle skill. Don't paste mechanically. The result has to remain coherent under one mental model. For repository artifacts, use the retained `Task` branches or patches. Apply only the selected base and explicit grafts.

Record what was grafted, from which candidate, and what was rejected and why. The rejection notes are the highest-signal part of the record. Future readers learn from what you considered and dropped, not just what you kept.

When N candidates converge on the same shape, that is a strong agreement signal. Note the convergence in the record and ship the consensus shape. No graft is needed. When N candidates wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

The synthesized artifact has to hold up under the same scrutiny as any other output, per the **prove-it-works** principle skill. The arena does not earn you a pass.

If verification surfaces a problem the arena did not catch, either Phase A was wrong (re-frame and re-run) or one candidate caught it and you missed the graft (go back to Phase E). Don't paper over.

## Outputs

One synthesized artifact. One short synthesis note alongside, naming the base, the grafts (with source candidate), the rejections, the dropouts if any, and the verification result.
