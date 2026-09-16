### Feature

**One issue owner grounds, designs, implements, and corrects. An independent reviewer owns acceptance.**

Assign the implementation owner before discovery. Give it the original request, criteria, source evidence, and accepted design when one exists.
For managed delivery, use `role: "feature"` and `pstack-leaf` unless justified delegation requires `pstack-nested`.
The same owner executes the steps below without creating a child merely to advance a phase.

1. If grounding is missing or stale, run `how` in the owner's session. Otherwise, reuse the accepted design and its evidence.
2. Design only genuinely new or contested contracts, ownership, state, or security with `architect`. Crossing a function is not a design trigger. An accepted design for this issue carries its grounding, so implementation inherits it without rerunning `how` or `architect`; record `design: accepted <ref>`. When the issue needs exploration, do not fold the decision silently into implementation, and keep a skip as `architect skipped: <reason>`.
3. Write the throughput checkpoint as four todo items. A dimension that genuinely does not apply (single file, no fan-out) keeps its item with `n/a: <reason>` rather than being dropped:
   - **Blocking first steps.** Gates run before fan-out. Before broad implementation, establish the connected probe from `references/delivery-contract.md`. For new behavior, build only the minimal vertical slice needed to exercise the real entry point and durable result.
   - **Independent workstreams.** Disjoint files, services, or layers parallelize. Shared writes serialize.
   - **Shared mutable state.** Default to splitting the target (the **separate-before-serializing-shared-state** principle skill). Serialize only for real invariants.
   - **Smallest safe decomposition.** If one worker is best, name why.
4. Continue code-writing in the same persistent issue owner with its specific scope (paths, data shape, organizing structure, and success criteria). Use the configured `feature` model and `role: "feature"`. Follow `references/task-contracts.md` for capabilities and isolation. Concrete selectors use `provider/model-id:effort [fast]`. Omit `Task.model` to use the scalar runtime policy. Pass `capability_profile: "pstack-leaf"` for a leaf or `pstack-nested` for a delegating owner. Pass the per-issue fields from `references/delivery-contract.md` in the Task prompt: issue, phase, accepted design and evidence refs, base and head identity, verification owner, and acceptance criteria. Review its diff yourself. Use **arena** only for unresolved implementation tradeoffs with material behavioral consequences or an explicit user request. Ordinary local structure choices do not trigger a bakeoff. Independent review remains required. A delegated workflow owner requires `pstack-nested`. A leaf implements the scoped design already supplied by its coordinator. Return a design need when that design is missing, incompatible, or contested, not when it merely crosses a function. Corrections resume the same implementer while the accepted design stays compatible. Send the accepted patch to one independent reviewer that never wrote it; that reviewer may combine comment cleanup per **no-comments**, **deslop**, and static audit when those passes are safe together. Comments per **Comments**. Surgical edits, re-ground against the source for upstream-derived files. Port shared-primitive improvements to all consumers and verify each. Recheck only the affected behavior after a correction. Run the full required gates before commit and commit liberally.
5. Verify on the matching surface with the retained early probe and regression scenarios. Reuse the repository-owned harness for independent review. Preserve gate exit status and immutable logs. Read existing logs instead of repeating unchanged passing checks for a different summary. "Inconclusive" or wrong-surface is not a pass. Flag it. Validation and publication stay with separate owners, and publication is a separately scoped foreground Task.
6. Rebase into small, ordered commits. Stack follow-ups.
   Use the **sequence-verifiable-units** principle skill, building, verifying, and committing each small unit before the next.
7. If the design is contested, `interrogate` before shipping.
8. Run **Opening a PR**.

Code-coupled work stays with one owner and its evidence checkpoint. Delegate only independent artifacts or explicitly required perspectives, not investigation and implementation stages. Rewrite the checkpoint at phase boundaries. Preserve compatible owners through corrections. Replace an owner only for a demonstrated context or execution-contract failure.

**Reply:** what you built, what you chose and why, the throughput checkpoint, open decisions. Tables for design alternatives.
