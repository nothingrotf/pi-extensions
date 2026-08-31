# @nothingrotf/subagent

`@nothingrotf/subagent` adds a `Task` tool to Pi.

Each Task call runs an isolated `AgentSession` in the current Pi process. The child receives its own context and transcript.

## Tool

Run a foreground child:

```ts
Task({
  description: 'Inspect package metadata',
  prompt: 'Read package.json and report the package name.',
  subagent_type: 'explore',
})
```

Continue the same child:

```ts
Task({
  description: 'Continue metadata review',
  prompt: 'Now report the package version.',
  subagent_type: 'explore',
  resume: '<agent-id>',
})
```

Select a model, effort, and priority path:

```ts
Task({
  description: 'Implement the fix',
  prompt: 'Implement the requested fix and run focused tests.',
  subagent_type: 'generalPurpose',
  model: 'openai-codex/gpt-5.6-sol:high [fast]',
})
```

Set `run_in_background` to `true` to return the Agent ID after session creation.

Set `readonly` to `true` to remove shell and mutation tools.

## Parent-model intercom

Each child receives these private tools:

- `ask_parent` runs an isolated side turn with the current parent model.
- `notify_parent` sends a non-blocking update and starts a parent turn.
- `update_progress` changes the live activity text without starting a parent turn.

`ask_parent` copies a bounded parent conversation snapshot into an in-memory session. It removes tool traffic, redacts common secret formats, and uses a fixed supervisor prompt. The side turn has no tools and a two-minute timeout.

The parent model answers directly. The user does not need to reply. The final question and automatic answer enter the parent transcript as a `subagent-intercom` message.

Side turns use additional model tokens and cost. `intercomUsage` reports them separately from child usage.

## TUI

The widget above the editor shows live status, activity, tool calls, token use, cost, and elapsed time.

Open the subagent pane:

```text
/subagent-peek
```

Use `ctrl+shift+a` as the keyboard shortcut.

If no other extension owns `/subagents`, `/subagents peek` opens the same pane.

The pane supports these controls:

- Use `j`, `k`, or the arrow keys to select a child.
- Press `enter` to tail the child transcript.
- Press `x` to cancel a running child.
- Press `escape` to return or close the pane.

Run `/subagents` to show a compact status list.

## Roles

- `generalPurpose`
- `explore`
- `shell`
- `debug`

## Development

```sh
bun run check
bun run test
```
