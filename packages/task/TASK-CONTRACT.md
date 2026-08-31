# Task protocol contract

## Evidence boundary

This contract describes Cursor Agent `2026.08.25-3e8eec8`.

The evidence came from generated protocol classes, static bundle traces, isolated runtime instrumentation, JSONL streams, and child transcripts.

The probes used temporary bundle copies. The installed runtime remained unchanged.

Live probes stopped after the account returned `ActionRequiredError: You've hit your usage limit Get Cursor Pro for more Agent usage, unlimited Tab, and more.`

## Public call

The model calls the tool as `Task`. Some runtime views label the same protocol as `Subagent`.

The model-facing argument contract uses these fields:

| Field                                  | Form                  | Contract                                                                  |
| -------------------------------------- | --------------------- | ------------------------------------------------------------------------- |
| `description`                          | string                | Required short title for the task.                                        |
| `prompt`                               | string                | Required child instruction. Empty or absent values fail validation.       |
| `subagent_type`                        | string                | Required built-in or custom child type.                                   |
| `model`                                | optional string       | Requested child model. `inherit` and `default` select inherited behavior. |
| `resume`                               | optional string       | Prior child identity for a continuation turn.                             |
| `readonly`                             | optional boolean      | Requests ask-mode resources and read-only enforcement.                    |
| `run_in_background`                    | optional boolean      | Returns after launch and keeps the child active.                          |
| `attachments`                          | optional string array | Attachment references for the child request.                              |
| `environment`                          | optional enum         | Selects unspecified, local, or cloud execution.                           |
| `cloud_base_branch`                    | optional string       | Selects a cloud base branch.                                              |
| `cloud_requested_environment_build_id` | optional string       | Selects a cloud environment build.                                        |
| `machine`                              | optional target       | Selects the same machine, a cloud VM, a worker, or a worker pool.         |
| `interrupt`                            | optional boolean      | Requests the interrupt path where the active host supports it.            |

`TaskToolCallArgsProto` uses field numbers 1 through 13 in the table order.

## Target machine

`TargetMachine` is a one-of value.

| Variant              | Fields                                             |
| -------------------- | -------------------------------------------------- |
| `same_machine`       | No fields.                                         |
| `new_cloud_vm`       | Optional `environment_build_id` and `base_branch`. |
| `self_hosted_worker` | Required worker identity.                          |
| `self_hosted_pool`   | Optional pool and repeated key-value labels.       |

## Child types

`SubagentType` is a protocol one-of value.

The observed variants are:

- `unspecified`
- `computer_use`
- `custom`
- `explore`
- `media_review`
- `bash`
- `browser_use`
- `shell`
- `vm_setup_helper`
- `debug`
- `cursor_guide`
- `watch_video`

A custom variant carries a `name` string.

The runtime displays `unspecified` as `general-purpose`. It displays `bash` and `shell` as `shell`.

## Prepared request

The runtime converts the public call into `PreparedTaskSubagent` before execution.

The prepared record contains these fields:

1. `subagent_id`
2. `subagent_type_name`
3. `subagent_type`
4. `analytics_subagent_type`
5. `resolved_model_id`
6. `effective_readonly`
7. `use_ask_mode_for_subagent`
8. `conversation_state`
9. `initial_action`
10. `initial_turns_count`
11. `subagent_request_id`
12. `tool_call_id`
13. `is_resume`
14. `parent_request_id`
15. `root_parent_request_id`
16. `task_prompt`
17. `task_description`
18. `selected_context`
19. `plugin`
20. `marketplace`
21. `parent_model_name`
22. `raw_args`
23. `subagent_credentials`
24. `result_suffix`
25. `enable_execute_hook_exec`
26. `configured_steps`
27. `readonly_shell_enabled`
28. `tool_name`
29. `prepared_timestamp_unix_ms`
30. `plugin_id`
31. `marketplace_id`
32. `subagent_source`
33. `cloud_subagent_bc_id`
34. `provider_tool_name`
35. `inherited_context`

Field 24 is absent from the observed generated class.

The host execution request also carries parent and root conversation identities, mode, environment, model parameters, and optional continuation configuration.

## Session creation

A fresh call creates a separate child identity and child conversation store.

The child uses the parent workspace. The child writes a separate transcript under the workspace transcript tree.

A foreground result includes the child identity, final message, duration, conversation steps, and observed tool use data.

## Resume and lineage

A resume call uses the prior child identity. A successful continuation keeps that identity and the prior child context.

The CLI host persists child conversation state. Resume still works after a worker restart and parent conversation resume.

The host validates root and direct parent lineage. An unrelated parent cannot claim the retained child.

An unavailable child returns:

```text
Cannot resume subagent 43b05232-1599-43dd-91cd-f26a17656ade: its conversation state is no longer available. Start a new subagent instead.
```

A call against an active background child can return:

```text
Sub-agent is currently running. You may send the follow-up message when it has completed.
```

## Foreground lifecycle

The host creates or restores the child session. It then runs one child turn.

The low-level outcomes are `completed`, `background`, `error`, and `aborted`.

A completed foreground call returns child conversation steps and the child identity.

An abort returns an error result. The default abort text is `Subagent was aborted by the user`.

The host releases a failed session. It retains persisted state where the resume contract permits it.

## Background lifecycle

`run_in_background: true` returns immediately after launch.

The immediate result sets `is_background` and includes the child identity. The low-level host reports `status: "background"`.

`SubagentBackgroundReason` contains these values:

- `UNSPECIFIED`
- `AGENT_REQUEST`
- `USER_REQUEST`
- `QUEUED_FOLLOW_UP`

The child continues without parent polling.

At completion, the host enqueues this correlated payload:

```json
{
  "taskId": "<child-id>",
  "kind": "subagent",
  "status": "success | error | aborted",
  "title": "<derived title>",
  "detail": "<final message or error>"
}
```

The parent receives `system/task_notification`. The notification causes a parent follow-up turn.

## Result protocol

`TaskSuccess` contains these fields:

| Field                | Form                         |
| -------------------- | ---------------------------- |
| `conversation_steps` | Repeated conversation steps. |
| `agent_id`           | Optional child identity.     |
| `is_background`      | Boolean.                     |
| `duration_ms`        | Optional unsigned duration.  |
| `result_suffix`      | Optional text.               |
| `background_reason`  | `SubagentBackgroundReason`.  |
| `transcript_path`    | Optional transcript path.    |

`TaskError` contains one `error` string.

`TaskResult` is a one-of value with `success` or `error`.

`TaskToolCall` contains the original arguments, the result, and an optional cloud child identity.

## Concurrency

Two `Task` calls from one assistant message execute concurrently.

Each call owns a separate child identity, transcript, tool call identity, and result.

The host deduplicates equivalent execution requests by parent conversation, tool call, resume identity, and fork identity.

## Nested children

A foreground child can call `Task` and wait for its nested child.

A child can also launch a nested background child and finish first.

The host tracks direct parent links and root parent links. Nested background completion reaches the root parent.

The host queues child completions for continuation loops when that mode requests child collection.

## Custom agents

`.cursor/agents/*.md` metadata becomes `CustomSubagent` data.

The generated custom record contains:

- full path
- name
- description
- tools
- model
- prompt
- permission mode
- background default
- plugin and marketplace identities
- default-model override
- source

The permission modes are `UNSPECIFIED`, `DEFAULT`, `READONLY`, and `AGENT_ONLY`.

A custom `readonly: true` profile blocked writes in the probe.

The exact error was:

```text
You are in ask mode and cannot run non read-only tools. Ask the user to switch to agent mode if edits are required.
```

The tested built-in `explore` profile did not enforce read-only behavior. It wrote a file when no explicit read-only mode applied.

A tested custom `tools: Read` declaration did not block Shell. Tool metadata alone is not an observed security boundary.

A custom background default starts the selected child in the background when the call omits an explicit override.

## Model selection

The child model resolves before execution. Resolution errors become Task errors and retain the child identity when one exists.

The observed explicit `model: "auto"` path resolved to `composer-2.5` before the plan rejected it.

The returned error was:

```text
Named models unavailable Free plans can only use Auto. Switch to Auto or upgrade plans to continue.
```

## Prompt requirement

`prompt` remains required for fresh calls and resume calls.

The protocol contains internal await and continuation modes. Those modes do not make `Task` a status-only tool.

An omitted prompt fails schema validation. An empty prompt does not provide a valid status probe.
