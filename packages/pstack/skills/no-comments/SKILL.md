---
name: no-comments
description: "Run the Comment Sicko rubric, fix accepted findings, and offer encodings for claimed constraints."
disable-model-invocation: true
---

# No comments

Apply the Comment Sicko rubric to the caller's files or diff. Otherwise use the current diff against the base branch, default `main`, including the working tree.

Read `../../agents/comment-sicko.md` completely before reviewing. Its exception list is exact:

- Legal or license headers.
- Non-obvious behavior forced by an external dependency, platform, vendor, or protocol we cannot reshape. Surprises in our own code are meat. Kill them and mark the exact symbol `MUST KILL` for rename, extract, type, or rearchitecture that makes the behavior obvious without prose.
- `// prettier-ignore`. Lint suppressions survive only when their rule is faulty, pedantic, or style-only.
- Doc comments that define a public API contract.
- Issue or RFC links that explain a constraint code cannot express.

Do not add exceptions or soften the burden of proof.

## Review mode

If you are already an independently assigned reviewer, including a leaf reviewer, perform the rubric inline. Do not spawn another Task or invoke `/how`, `/why`, or `/architect`. Trace direct scoped evidence first with available read-only tools. If required evidence is unavailable, return a precise blocker to the root coordinator naming the claim, symbol, and missing source. Preserve the caller's read-only, no-write, and report-only constraints.

During accepted delivery or publication, reuse the existing independent verdict when its artifact and evidence remain current. Apply the checklist inline without another reviewer Task. Do not treat this check as a new independent verdict. If evidence is missing or invalidated, return to the assigned independent reviewer.

For a standalone invocation, launch exactly one independent reviewer selected explicitly from the configured `code review` pool:

- `role`: `code review`
- `capability_profile`: `pstack-leaf`
- `subagent_type`: `Comment Sicko`
- `model`: the selected configured entry, including explicit `auto` or `inherit-parent`; omit only when the pool is unconfigured or all choices are identical
- `readonly`: `true`

The pool is availability, not fanout. Never launch one reviewer per entry. Pass the scope and require the reviewer to read and apply `../../agents/comment-sicko.md` directly. The reviewer reports only and never edits product files.

## Consolidate

Inspect the report against scoped evidence. Reject scope escapes, exception-protected deletions, misstated `MUST KILL` reasons, invented findings, and flags that treat proven intentional code as guilty. Audit missed scoped lint and TypeScript suppressions. Correctness or safety suppressions remain actionable `MUST KILL`s. A keep survives only with proof that an exact exception applies. If required proof is unavailable, report the review blocker rather than guessing or recursively delegating.

Consolidation never authorizes the reviewer to edit product files. An authorized writing coordinator may apply accepted deletions and root-cause fixes within its existing file scope. A read-only or report-only caller reports recommendations without edits. Never widen permissions inherited from the caller.

Constraint comments say `do not remove`, `do not change wording`, or `talk to X before changing`. Offer the cheapest in-scope type, runtime, test, or CI lint. Wait for explicit user approval before encoding. Without approval, report the constraint and proposed encoding without editing it.

Report the deletion recommendations, exact exceptions kept with evidence, `MUST KILL` findings, blockers, encoding offers, authorized fixes, and open work.
