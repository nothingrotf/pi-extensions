# Light mode

Light mode cuts the fan-out around a change and keeps every gate that decides whether code lands.
Use it when the operator asks for `light` mode, a smaller budget, or a faster pass.
The default mode is `full`. Record the active mode in the checkpoint, and change it only on an operator request or an escalation below.

## What stays

- The issue workspace, the issue owner, and its self-proof matrix.
- Every repository-required gate and every user-required acceptance check.
- One independent `code review` on the current candidate before publication, by another model family when the review pool offers one.
- The managed delivery ledger, its preflight, and the diagnosis rule for repeated incomplete returns.
- User gates, publication boundaries, and model policy.

## What changes

| Step | Full | Light |
| --- | --- | --- |
| Design for a new or contested contract | `architect` with two or more runners and a synthesis | One `architect runners` Task that sketches two structurally distinct candidates and recommends one. The architect owner synthesizes without a cross-judge. |
| Independent review | `code review`, plus `runtime verification` when the issue has runtime behavior | `code review` alone. Open the issue with `runtimeRequired: false` unless static review cannot observe a criterion. |
| Runtime verification, when required | Acceptance checks, the actual surface, and adversarial probes | Acceptance checks on the actual surface. The verifier reads the owner's gate logs and adds probes only for named risks. |
| Swarm, arena, interrogate, and reflect | When the playbook or the risk requires them | Only on an explicit user request |
| Parallel Tasks in one wave | Bounded by verified independence | At most three |
| `how` and `why` | In the issue owner, with delegation for independent slices | In the issue owner only |

## Escalation to full

Switch one issue to `full` when any of these holds:

- The change touches a path that the operator named as high risk, such as authentication, billing, migrations, or release tooling.
- The issue has two rejected review verdicts.
- The design is contested, or the change is a one-way door.
- A reviewer reports a blocking finding that static review cannot settle.

Record the escalation and its reason in the checkpoint. The issue stays in `full` until it publishes.
