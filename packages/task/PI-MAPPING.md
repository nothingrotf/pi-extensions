# Task to pi-subagents map

## Design rule

The adapter owns translation only. `pi-subagents` owns child execution, process state, transcripts, persistence, resume, nesting, and completion delivery.

The adapter does not import private `pi-subagents` modules. It uses public process events.

## Transport map

| Task behavior                     | Pi seam                                                          |
| --------------------------------- | ---------------------------------------------------------------- |
| Fresh foreground call             | Structured delegation events under `prompt-template:subagent:*`. |
| Fresh background call             | `subagents:rpc:v1:request` with method `spawn`.                  |
| Resume                            | RPC method `resume`.                                             |
| Foreground resume result          | `subagent:async-complete`, while the Task call waits.            |
| Background completion             | `subagent:async-complete`.                                       |
| Cancellation of a foreground call | Structured delegation cancellation event.                        |
| Cancellation of a resumed call    | RPC method `stop`.                                               |
| Child identity                    | The opaque `pi-subagents` run identity.                          |
| Restart persistence               | Pi session entries plus retained `pi-subagents` run data.        |
| Read-only execution               | Runtime agent registration with a strict four-tool list.         |

## Argument map

| Task argument                          | Adapter behavior                                                |
| -------------------------------------- | --------------------------------------------------------------- |
| `description`                          | Persists as the title for a background notification.            |
| `prompt`                               | Passes without adapter normalization.                           |
| `subagent_type`                        | Resolves through the built-in map or a configured agent name.   |
| `model`                                | Passes named models. Inherits `default` and `inherit`.          |
| `resume`                               | Targets a retained Pi run.                                      |
| `readonly`                             | Selects `task-readonly` for a new task.                         |
| `run_in_background`                    | Selects RPC launch instead of structured foreground delegation. |
| `attachments`                          | Rejects non-empty arrays.                                       |
| `environment`                          | Accepts unspecified and local values. Rejects cloud.            |
| `cloud_base_branch`                    | Rejects the call.                                               |
| `cloud_requested_environment_build_id` | Rejects the call.                                               |
| `machine.same_machine`                 | Accepts the call.                                               |
| Other `machine` values                 | Rejects the call.                                               |
| `interrupt`                            | Rejects `true`.                                                 |

## Agent map

The adapter maps `generalPurpose`, `general-purpose`, `general_purpose`, `unspecified`, `shell`, and `bash` to `worker`.

The adapter maps `explore` to `scout`. It passes every other value as a configured `pi-subagents` agent name.

New read-only calls always use `task-readonly`. The adapter registers that runtime agent through `pi-subagents:runtime-agent-register:v1`.

The runtime agent receives only these tools:

- `read`
- `grep`
- `find`
- `ls`

This tool list enforces the adapter boundary. A prompt cannot grant write or shell tools to that child.

## Identity and persistence

A fresh foreground result exposes its Pi run identity as `Agent ID`.

A fresh background result exposes its async Pi run identity as `Agent ID`.

A resume call keeps the caller-visible prior `Agent ID`. The internal continuation run can use a different Pi run identity.

The adapter records each new Agent ID and its read-only mode. A read-only resume requires a recorded read-only Agent ID.

If the adapter cannot verify that boundary, it rejects the read-only resume. It never resumes a write-capable child as read-only.

The adapter persists pending background correlations in `pi-task-state` session entries.

Each record contains:

- the completion run identity
- the caller-visible child identity
- the description
- the requested child type
- the launch timestamp

A restored session reads the latest valid state entry. A later completion still maps to the original `Agent ID`.

Lineage validation remains inside `pi-subagents`. The adapter cannot resume a retained run from an unrelated Pi session.

## Foreground result

Structured delegation returns:

- run identity
- final text
- model
- usage
- turn count
- tool call count
- duration

The adapter converts those values into `Task` result details. The text result starts with `Agent ID`.

A foreground call uses `context: "fresh"`. The child owns an isolated Pi session.

## Background result

RPC `spawn` returns an async run identity and run directory. The adapter returns immediately with `status: "background"`.

The adapter listens for `subagent:async-complete`. It validates the payload before it updates Task state.

After completion, the adapter injects a hidden `system/task_notification` message with this detail shape:

```json
{
  "taskId": "<agent-id>",
  "kind": "subagent",
  "status": "success | error | aborted",
  "title": "<description>",
  "detail": "<final output or error>"
}
```

The adapter sets `triggerTurn: false`. The package-owned `pi-subagents` completion notice already owns the wake.

This rule prevents a second completion turn. The model can still receive both the native Pi notice and the Task-compatible detail.

## Resume

The public structured delegation API does not expose foreground continuation.

The adapter calls RPC `resume`, which starts a retained async continuation. A foreground Task call waits for its completion event.

This preserves caller-visible foreground behavior. `pi-subagents` still owns the continuation session, lease, lineage, model, tools, and persistence.

A background resume returns after the RPC receipt. The completion correlation uses the new continuation run identity.

Public Pi execution can trim boundary whitespace from a child task. The adapter does not normalize the prompt before transport.

## Concurrency

The Pi tool declares `executionMode: "parallel"`.

Independent Task calls can enter the structured delegation bridge at the same time. Each call uses a unique request identity and tool node identity.

The adapter keeps no global foreground lock.

## Nesting

`pi-subagents` owns nested routes and root completion delivery.

A child needs access to this extension before it can call `Task`. It also needs `Task` in its agent tool list.

Built-in `worker` and `scout` agents use strict lists. They do not include extension tools.

Configure a custom Pi agent for nested Task calls. Load this extension for the child and add `Task` to that agent.

A nested background run still uses the package-owned root route. Its native completion notice reaches the root parent.

The Task-specific pending state belongs to the session that launched the nested call. If that session closes first, only native root delivery remains guaranteed.

## Custom agent differences

The adapter does not parse `.cursor/agents/*.md`.

Use Pi agent definitions for prompts, tools, models, skills, extensions, and default execution settings.

The adapter passes an unknown `subagent_type` as the Pi agent name. Agent discovery and validation remain inside `pi-subagents`.

The adapter does not infer a background default from Cursor metadata. Set `run_in_background` explicitly.

## Unavoidable protocol differences

### Result structure

Cursor returns repeated conversation steps. The public Pi delegation seam returns final text and structured usage.

The adapter returns final text. It does not reconstruct synthetic conversation steps.

### Transcript path

The foreground delegation response does not expose a transcript path. The adapter cannot return that path for a fresh foreground call.

Async completion can expose a transcript path. The adapter preserves it when the public event includes it.

### Resume mechanics

Cursor resumes the same child identity directly. Pi RPC creates a continuation run that retains the same child session.

The adapter keeps the old `Agent ID` in the external result. It uses the continuation identity only for completion correlation.

### Notification duplication

`pi-subagents` owns its native completion notice. Another extension cannot suppress that notice through the public RPC contract.

The adapter adds Task-compatible details without another wake. A parent can see native Pi text plus the hidden compatibility message.

### Read-only role prompt

Cursor can apply read-only mode to the selected custom prompt. Pi runtime agent registration creates one dedicated read-only prompt.

The adapter preserves structural tool limits. It does not preserve every custom role prompt on a read-only call.

### Automatic model selection

Cursor `auto` selects a platform-managed automatic model. Pi has no provider-neutral equivalent for that selector.

The adapter rejects `model: "auto"`. It never substitutes the parent model or an unrelated provider model.

### Cloud and remote targets

The public Pi seams do not provide Cursor cloud VM, worker, pool, or branch selection.

The adapter rejects those calls. It never runs them on an unintended local target.

### Attachments

Structured delegation accepts a text task. It does not accept Task attachment references.

The adapter rejects non-empty attachments. It never drops an attachment silently.

### Interrupt

Pi exposes run interrupt and steering controls. Their state contract differs from the observed Task `interrupt` field.

The adapter rejects `interrupt: true`. It never substitutes a different control action.

## Error map

The adapter preserves public Pi RPC error codes in the error text.

An active-run resume maps to:

```text
Sub-agent is currently running. You may send the follow-up message when it has completed.
```

A missing delegation owner returns:

```text
pi-subagents is not installed or its delegation bridge is not ready.
```

Unsupported protocol fields return explicit errors before child launch.
