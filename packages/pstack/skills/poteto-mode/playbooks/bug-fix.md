### Bug fix

**One issue owner reproduces, investigates, implements, and corrects. An independent reviewer owns acceptance.**

Assign the owner before reproduction, not after another agent writes a plan.
For managed delivery, dispatch one `poteto-agent` with `role: "bug-fix"` and `capability_profile: "pstack-leaf"`.
Omit `Task.model` for the configured scalar policy.
Read `references/task-contracts.md` and pass the original request, evidence, and per-issue fields from `references/delivery-contract.md`.
If an existing owner already has the evidence and compatible contract, continue that owner instead of creating another Task.
The owner executes the following steps directly. It does not delegate merely because a step has a different name.

1. Reproduce the failure on the matching surface through the control skill. Use the smallest executable trigger that represents the user's experience. For integration failures, connect the real entry point, authorization, persistence, and observable result before editing. Retain that probe in a repository-owned harness. If the actual surface is unavailable, record the limitation and use the closest executable reproduction without declaring acceptance.
2. Trace the cause with `how` in the owner's session. Use `why` locally when regression history or a disputed rationale matters. Execute independent tool queries in parallel. Retain decisive observations, contrary evidence, and rejected hypotheses with stable references. Confirm the mechanism before changing code.
3. Plan and implement the smallest fix supported by that evidence. Use `architect` only for genuinely new or contested contracts, ownership, state, or security. An accepted design carries its grounding. A leaf returns a required design decision to the coordinator without discarding its investigation. After that decision, resume the same compatible owner.
4. Verify the original reproduction and adjacent regression risks on the corrected artifact. Reuse the retained harness and preserve gate exit status and immutable logs. Read unchanged passing logs instead of rerunning gates for a different summary. Keep incomplete work as WIP. A passing unit suite does not replace required runtime proof. Recheck affected behavior after corrections and run the full required gates before commit.
5. Send the complete candidate to one independent reviewer that never wrote it. Combine static, no-comments, deslop, and runtime findings when the reviewer has the required tools and manual isolation. Return findings to the same implementer. Keep the same compatible reviewer for the correction delta. Neither summaries nor agent agreement prove acceptance.
6. Preserve a failing-then-passing regression test when the reproduction supports it. Follow `tdd` for a cheap local test path. Do not manufacture a separate agent or expensive test stage only to satisfy a phase label.
7. Run **Opening a PR** only after independent acceptance and the required gates. Publication remains separately scoped and authorized.

The issue evidence retains the original request, criteria, reproduction, decisive source references, rejected hypotheses, current artifact, harness, and open findings.
Do not fan out `how` and `why` by default. Delegate only a justified independent slice or an explicit user-required perspective.

**Reply:** what was broken, root cause, fix, and executed verification. Include failing-then-passing evidence and remaining limitations.
