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

## Roles

- `generalPurpose`
- `explore`
- `shell`
- `debug`

Read [`PLAN.md`](PLAN.md) for the contract, architecture, references, and scope.

## Development

```sh
bun run check
bun run test
```
