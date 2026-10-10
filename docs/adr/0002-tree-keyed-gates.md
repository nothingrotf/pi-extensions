# Tree-keyed gate results replace repeated suite runs in managed delivery

Managed pstack agents run full suites and repository gates through the `pstack_gate` tool instead of `bash`.
The tool keys each result by the workspace identity that the delivery ledger already uses for a candidate: the tree of each repository, the repository root, the working directory, and the exact command.
A passing result for an unchanged key is reused without running the command again, and concurrent calls for one key share one run.
A process-wide limit bounds how many gates run at once, and the tool owns the timeout instead of the model.
Each call produces a normal tool receipt, so the delivery ledger counts it as command evidence.

We chose this because the real-fix benchmark showed that test suites dominate managed delivery time.
Each delivery ran the full pstack suite 2.6 times on average, between the owner and the runtime verifier, for 307 of 621 seconds.
Agents also chose `bash` timeouts below the suite duration and repeated timed-out runs, and two concurrent deliveries made each suite run twice as slow.
The pi-harness postmortem reached the same conclusion: the engine, not the model, should run the deterministic gate at a task boundary.

## Considered options

- **Keep suites in `bash`.** No new contract, but every agent repeats the same suite on the same tree, and the model guesses the timeout.
- **Run gates automatically after each implementation submission.** This matches the pi-harness commit gate, but it needs per-repository gate configuration and the delivery engine. It is deferred, and the engine will call the same gate service.
- **Key results by commit.** Owners and verifiers work in place on uncommitted trees, so a commit key misses the common case.
- **Cache failures too.** A failure caused by load or a flaky test would stick to the tree, so only passes are reused.
- **Tree-keyed gate tool with shared passes (chosen).** It removes repeated runs without new repository configuration, and it keeps the receipt contract unchanged.

## Consequences

- A command that depends on state outside the tree, such as a database, network service, or ignored files, can be reused wrongly. The tool is only for deterministic checks, and `fresh: true` forces a new run.
- The key includes the worktree path, so reuse stays inside one prepared issue workspace whose dependencies come from one setup.
- A run that changes the tree is reported but not reused.
- A runtime verifier can cite a pass that the owner produced for the same tree. The tool, not the owner's report, produced that result.
- Read-only static reviewers do not receive the tool.
