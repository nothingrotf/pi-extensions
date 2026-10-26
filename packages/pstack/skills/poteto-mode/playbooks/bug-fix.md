### Bug fix

**You own this task. Plan, review, verify.** Delegate the fix to a subagent and stay in the lead.

This is the default flow. With an explicit managed delivery request, run the owner and review loop through `references/delivery-contract.md` instead of steps 3 and 4.

Be scientific. Every shipped line traces to runtime evidence. Belt-and-suspenders that "might help" is a hypothesis, not a fix. It does not ship. When evidence refutes a hypothesis, revert what it motivated. The smallest change the evidence justifies ships, nothing more.

1. Reproduce it yourself on the matching surface via the control skill (Non-negotiables), even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
2. Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with `how` over the affected subsystem and the **why** skill for regression history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. Drive a long or stubborn hunt with the installed `loop` skill. Confirm the surviving *mechanism* with runtime evidence before planning the fix.
3. Plan the fix. Use `architect` only for genuinely new or contested contracts, ownership, state, or security. Delegate implementation to one `poteto-agent` with `role: "bug-fix"` and `capability_profile: "pstack-leaf"`, with a specific scope, the reproduction, and the confirmed mechanism. Run it in place in its linked worktree per Repository writer in `references/task-contracts.md`. It runs focused checks, then the repository-required gates once on the finished head.
4. Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence. Review the diff yourself, and get one second opinion from a read-only `arena cross-judge pool` Task on another model family.
5. Stage the commits so the failing repro lands before the fix in git history. See the **tdd** skill for the failing-test-first cadence when the bug has a cheap local test path. Skip it when the test would be expensive, integration-heavy, or unclear.
   This is the canonical **sequence-verifiable-units** principle skill, the failing test first and the fix on top.
6. Run **Opening a PR**.

**Reply:** what was broken, root cause, fix, how you verified. Paste failing-then-passing repro output verbatim.
