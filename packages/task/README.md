# @nothingrotf/task

`@nothingrotf/task` adds the `Task` compatibility tool to Pi.

The extension delegates all child work to `pi-subagents`. It does not own a child process, transcript store, or orchestration runtime.

## Requirements

Install `pi-subagents` and this package in the same Pi process.

```sh
pi install npm:pi-subagents
pi install npm:@nothingrotf/task
```

The package is not published yet. Use the repository package during local development.

## Tool

```ts
Task({
  description: 'Inspect package metadata',
  prompt: 'Read package.json and return the package name.',
  subagent_type: 'explore',
  run_in_background: false,
})
```

The tool returns an opaque `Agent ID`. Pass that value to `resume` for a later child turn.

```ts
Task({
  description: 'Continue metadata review',
  prompt: 'Now report the package version.',
  subagent_type: 'explore',
  resume: '<agent-id>',
})
```

Set `run_in_background` to `true` for detached work. The parent receives a correlated `system/task_notification` message after completion.

Set `readonly` to `true` for a new state-free task. The adapter uses a runtime agent with only `read`, `grep`, `find`, and `ls`.

A read-only resume requires an Agent ID that this adapter recorded as read-only. Otherwise, the adapter rejects the call.

## Agent selection

The adapter applies these built-in mappings:

| `subagent_type`                                                       | `pi-subagents` agent           |
| --------------------------------------------------------------------- | ------------------------------ |
| `generalPurpose`, `general-purpose`, `general_purpose`, `unspecified` | `worker`                       |
| `shell`, `bash`                                                       | `worker`                       |
| `explore`                                                             | `scout`                        |
| Any other value                                                       | The same configured agent name |

A new read-only call always uses `task-readonly`. A retained read-only child keeps that boundary during resume.

## Child access to `Task`

Built-in `pi-subagents` agents use strict tool lists. They do not receive `Task` by default.

Define a custom agent for nested calls. Add `Task` to its tool list. Load this package for that child.

## Protocol references

- [`TASK-CONTRACT.md`](TASK-CONTRACT.md) records the observed source protocol.
- [`PI-MAPPING.md`](PI-MAPPING.md) records the Pi adapter map and its limits.

## Development

Run the package checks.

```sh
bun run check
bun run test
```

Run the repository checks before a commit.

```sh
bun run check
bun run test
```
