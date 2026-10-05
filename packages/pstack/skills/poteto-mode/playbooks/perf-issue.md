### Perf issue

**You own the measurement story. Plan, review, verify the numbers.** Tie every fix to a measurement, don't read source instead of measuring.

Assign the `perf-issue` owner before baseline capture. Within one round, that agent investigates and implements. Each correction round goes to a fresh owner with consolidated scope.

1. Capture a baseline trace via the matching control skill. Vet the baseline, and each later number, with the **benchmark-checklist** skill.
2. Run `how` in the owner's session to ground hypotheses. Don't claim a perf ceiling without running it first.
   Try the performance mantras in order, cheapest first:
   1. Don't do it. Stop work whose result nothing uses rather than cheapening it.
   2. Do it, but don't do it again.
   3. Do it less.
   4. Do it later.
   5. Do it when they're not looking.
   6. Do it concurrently.
   7. Do it cheaper.

   When an earlier mantra meets the target, stop.
3. Plan the fix from the trace. Run `architect` only when the fix introduces a genuinely new or contested contract, ownership, state, or security design; crossing a function is not a design trigger. An accepted design carries its grounding, so implementation inherits it without rerunning `how` or `architect`. Continue implementation in the round's owner using the configured `perf-issue` model, `role: "perf-issue"`, and the per-issue fields from `references/delivery-contract.md` in the Task prompt. Follow `references/task-contracts.md` for capabilities and isolation. Concrete selectors use `provider/model-id:effort [fast]`. Omit `Task.model` to use the scalar runtime policy. Pass `capability_profile: "pstack-leaf"` for a leaf or `pstack-nested` for a delegating owner. A fresh implementer with consolidated scope takes each correction while the accepted design stays compatible. Send the accepted patch to one independent reviewer that never wrote it. Review the diff. Recheck only the affected behavior after a correction, then run the full required gates before commit. Capture a post-fix trace.
   Apply the **sequence-verifiable-units** principle skill, verifying each attempt before trying the next.
4. Parse and compare the artifacts (JSON to sqlite, diff). Run an early executable probe before the fix when the change touches a real database role or another risky runtime boundary. "Inconclusive" or wrong-surface is not a pass. Flag it.
5. Cite the measurement in the PR.
6. Run **Opening a PR**.

For sustained improvement against a metric rather than a one-off fix, use the Hillclimb playbook (`playbooks/hillclimb.md`).

**Reply:** baseline number, post-fix number, delta, artifact path.
