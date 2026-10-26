### Feature

**You own the design. Plan, review, verify.** Delegate implementation. Stay in the lead.

1. Run `how` over the affected subsystem when grounding is missing or stale. An accepted design for this issue carries its grounding, so implementation inherits it without rerunning `how` or `architect`; record `design: accepted <ref>`.
2. Design only genuinely new or contested contracts, ownership, state, or security with `architect`. Crossing a function is not a design trigger. Keep a skip as `architect skipped: <reason>`.
3. Write the throughput checkpoint as four todo items. A dimension that genuinely does not apply (single file, no fan-out) keeps its item with `n/a: <reason>` rather than being dropped:
   - **Blocking first steps.** Gates run before fan-out. For new behavior across a runtime boundary, build the minimal vertical slice first and exercise its real entry point.
   - **Independent workstreams.** Disjoint files, services, or layers parallelize. Shared writes serialize.
   - **Shared mutable state.** Default to splitting the target (the **separate-before-serializing-shared-state** principle skill). Serialize only for real invariants.
   - **Smallest safe decomposition.** If one worker is best, name why.
4. Delegate code-writing to one `poteto-agent` with `role: "feature"` and `capability_profile: "pstack-leaf"`, or `pstack-nested` when it must delegate. Omit `Task.model` to use the configured selector. Give it a specific scope: file paths, the named data shape and its organizing structure per **principle-model-the-domain**, and success criteria. Run it in place in its linked worktree per Repository writer in `references/task-contracts.md`. It proves each unit with focused checks, runs the repository-required gates once on the finished head, commits, pushes, and opens its PR. Use **arena** only for unresolved implementation tradeoffs with material behavioral consequences or an explicit user request. Ordinary local structure choices do not trigger a bakeoff. Comments per **Comments**. Surgical edits, re-ground against the source for upstream-derived files. Port shared-primitive improvements to all consumers and verify each. Commit liberally.
5. Review the diff yourself and verify on the matching surface. Get one second opinion from a read-only `arena cross-judge pool` Task on another model family. "Inconclusive" or wrong-surface is not a pass. Flag it. Send proven findings to a fresh owner with consolidated scope in the same worktree.
6. Rebase into small, ordered commits. Stack follow-ups.
   Use the **sequence-verifiable-units** principle skill, building, verifying, and committing each small unit before the next.
7. If the design is contested, `interrogate` before shipping.
8. Run **Opening a PR**.

Code-coupled work (one feature, one migration) goes to a single owner with the checkpoint inline. That owner fans out internally after the blocking phase. Parent-level fan-out is for slices that produce independent artifacts (audits, cross-subsystem investigations, competing experiments). Rewrite the checkpoint at phase boundaries. Spawn a fresh owner rather than chaining interrupts.

**Reply:** what you built, what you chose and why, the throughput checkpoint, open decisions. Tables for design alternatives.
