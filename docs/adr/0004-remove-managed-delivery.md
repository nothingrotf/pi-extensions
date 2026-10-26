# pstack follows the upstream flow without managed delivery

pstack removes managed delivery: the delivery ledger, `pstack_delivery`, the `pstack_deliver` engine, issue workspaces, light mode, the throughput pilot, and the delivery benchmark.
Every `/poteto-mode` run now uses the upstream flow: one owner per issue in a linked worktree, a second opinion from `arena cross-judge pool`, and an owner-published PR.
We chose this because managed delivery was a local addition with no upstream counterpart. The operator observed managed runs that took hours for tasks that upstream pstack finishes in about 30 minutes.
It also added about 7,000 lines and a `delivery` field to the Task schema that every model call received.

## Consequences

- `pstack_gate`, the `pstack-sandbox` profile, and in-place Tasks in linked worktrees stay, because the default flow uses them.
- The subagent no longer accepts a `delivery` binding or the `@nothingrotf/subagent/execute-task` event. A retained Task record that still carries a binding resumes without it.
- The policy parser ignores `code review`, `runtime verification`, and `publication` lines, so older `pstack-models.md` files stay valid.
- Ledger entries in older sessions remain in the session file and have no effect.
