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

Set an effective directory and a tool allowlist:

```ts
Task({
  description: 'Inspect the web package',
  prompt: 'Read the package metadata and report the scripts.',
  subagent_type: 'explore',
  cwd: 'packages/web',
  tools: ['read', 'grep'],
})
```

A relative `cwd` resolves from the parent directory. The resolved path must exist and must be a directory.

The runtime permits absolute paths and parent traversal. Trusted adapters must apply a narrower policy when their boundary requires one.

The effective tools equal the intersection of the runtime, agent, and call policies. Read-only policy then removes mutable tools.

Private intercom tools enter after policy validation. A call cannot request or remove them.

A resumed child uses its persisted agent prompt, directory, tools, model, effort, and fast mode.

A changed agent file cannot expand the capabilities of an existing child.

A migrated v1 record has no execution contract. The runtime rejects its resume instead of re-resolving mutable capabilities.

## Custom agents

Extensions can register agent definitions through the controller:

```ts
const controller = acquireSubagentController(pi)
const unregister = controller.registerAgents('review-extension', [
  {
    name: 'reviewer',
    description: 'Review code without mutations.',
    systemPrompt: 'Review the requested code and report concrete findings.',
    readonly: true,
    tools: ['read', 'grep', 'find'],
  },
])
```

Call `unregister()` when the source no longer exists.

The resolver searches these project directories from the effective `cwd` through its ancestors:

- `.agents/agents`
- `.pi/agents`
- `.claude/agents`

The resolver then searches the equivalent user directories. Registered extension definitions have the lowest precedence.

Each Markdown file uses YAML frontmatter and a prompt body:

```md
---
name: reviewer
description: Review code without mutations.
effort: high
readonly: true
tools:
  - read
  - grep
  - find
---

Review the requested code and report concrete findings.
```

The resolver rejects duplicate definitions at one precedence level. It canonicalizes symlinks and limits metadata and file size.

Call `controller.invalidateAgentCache()` after an external change to an agent file.

## Extension controller

`acquireSubagentController(pi)` returns the controller for one `ExtensionAPI` instance and package module.

`registerSubagent(pi)` reuses that controller. It registers lifecycle hooks, the `Task` tool, and the TUI one time.

The controller provides these operations:

- `start()` returns an owner-bound task receipt and opaque handle.
- `snapshot()` returns an immutable active snapshot.
- `result()` returns a terminal result.
- `wait()` waits for a terminal result.
- `steer()` queues text for an active model turn.
- `cancel()` requests cancellation for the same active generation.
- `subscribe()` emits owner-bound events with monotonic revisions.
- `registerAgents()` adds extension agent definitions.

Steering rejects empty text, stale handles, terminal children, and idle sessions.

Session replacement invalidates old handles. A late lifecycle callback cannot restore an older owner over a new owner.

The Pi SDK does not provide a shared process registry. Separate physical package copies can create separate controllers.

## Parent-model intercom

Each child receives these private tools:

- `ask_parent` runs an isolated side turn with the current parent model.
- `notify_parent` sends a non-blocking update and starts a parent turn.
- `update_progress` changes the live activity text without starting a parent turn.

`ask_parent` copies a bounded parent conversation snapshot into an in-memory session. It removes tool traffic, redacts common secret formats, and uses a fixed supervisor prompt. The side turn has no tools and a two-minute timeout.

The parent model answers directly. The user does not need to reply. The final question and automatic answer enter the parent transcript as a `subagent-intercom` message.

Side turns use additional model tokens and cost. `intercomUsage` reports them separately from child usage.

A side turn preserves the provider, model, and thinking level available through the SDK. It does not preserve every parent provider setting.

The side turn does not guarantee the parent hooks, cache identity, transport, retry state, or effective service tier.

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

## Bundled roles

- `generalPurpose`
- `explore`
- `shell`
- `debug`

## Development

```sh
bun run check
bun run test
```
