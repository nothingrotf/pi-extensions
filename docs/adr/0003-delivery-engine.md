# A deterministic engine runs the managed delivery loop

The `pstack_deliver` tool runs the managed delivery loop in code instead of one coordinator model turn per step.
The coordinator opens the issue and calls the tool once with the owner role, the owner brief, and the reviewer models.
The engine then prepares the workspace, dispatches the owner, records each attempt, dispatches static review and runtime verification together, and resumes the owner for corrections.
It dispatches a diagnosis when the ledger requires one, and it stops at acceptance, at a step that needs the coordinator, or at a submission limit.
The engine dispatches each Task through a new subagent event, `@nothingrotf/subagent/execute-task`, that runs the Task in the same runtime on behalf of the active tool call.
pstack applies its managed preflight and dispatch bindings to each engine Task, and it calls `pstack_delivery` through `ctx.executeTool`, so the ledger, journal, and hooks behave as they do for model calls.

We chose this because the checkpoint already computes the next step, so a model turn that copies `next` into a tool call adds latency and tokens without a decision.
A replayed fix used 14 coordinator turns per delivery, and the measured autopilot session used about 1,600 Opus turns for 16 issues, with a median prompt of 257,000 tokens.
Claude Code dynamic workflows, the pi-harness runner, and pstack-t3 also keep the deterministic loop in code and call a model only for decisions.

## Considered options

- **Keep the coordinator model on every step.** This needs no new contract, but each step costs a model turn over the whole coordinator context.
- **Make `Task` callable through `ctx.executeTool`.** This needs no new event, but it also exposes `Task` to codemode scripts, which the subagent deliberately prevents with `model-only` exposure.
- **Run the engine in a separate process.** pstack-t3 drives agents over RPC, but a separate process loses the in-process runtime, the capability policy, and the ledger hooks.
- **Engine tool with a subagent execution event (chosen).** It keeps every existing contract and moves only the loop into code.

## Consequences

- One `pstack_deliver` call lasts the whole delivery. Aborting the call stops the loop and cancels its running Task.
- The coordinator writes the owner brief once. The engine writes the review prompts and the correction prompts from the checkpoint.
- Several issues run in parallel when the coordinator calls `pstack_deliver` for each one in the same turn. `pstack_gate` bounds the gate load.
- Child decisions still reach the parent model through `request_parent`.
- Engine Tasks have no tool row in the coordinator transcript. The delivery journal and the subagent state record them, and the engine result lists every step with its duration.
- A subagent version without the execution event fails the first dispatch before any Task starts.
- Publication, an integration refresh, and running background Tasks stay with the coordinator.
