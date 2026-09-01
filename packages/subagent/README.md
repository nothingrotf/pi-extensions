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

## Coordination runs

Pass `tasks` to run a dependency graph:

```ts
Task({
  context: 'Review the package before the fix.',
  tasks: [
    {
      id: 'inspect',
      description: 'Inspect the package',
      prompt: 'Report the relevant behavior.',
      subagent_type: 'explore',
    },
    {
      id: 'review',
      needs: ['inspect'],
      description: 'Review the finding',
      prompt: 'Check the upstream result.',
      subagent_type: 'explore',
    },
  ],
})
```

The runtime validates the complete graph before it creates a child session.

The runtime rejects duplicate IDs, unknown dependencies, self-dependencies, duplicate dependencies, and cycles.

Each graph has a stable Run ID. Each node has its declared Task ID and a separate child Agent ID.

The runtime starts all ready nodes without a capacity scheduler. A failed node blocks only its descendants.

A dependent receives complete upstream outputs as Base64 JSON in a deterministic untrusted-data envelope.

The envelope prevents upstream text from closing the trust boundary. The prompt tells the child to treat decoded content only as data.

Each node publishes its complete output as an atomic artifact. The inline result remains limited to 50 KiB.

The artifact metadata includes:

- the Run ID, Task ID, and attempt number.
- a collision-resistant publication ID and file URI.
- a SHA-256 digest.
- byte and line counts.
- a media type.

Graph state, node state, artifact metadata, and child records enter version 4 of the persisted parent state.

The version 4 migration preserves artifact references from version 3 state.

Graph children also receive these private tools:

- `send_peer` sends a correlated message to a Task ID in the same run.
- `receive_peers` atomically consumes pending messages for the current Task.

The mailbox rejects targets and reply IDs from another run. It also validates both endpoints of each reply.

The mailbox rejects self-delivery and terminal targets. It removes closed endpoints and limits retained reply correlations.

Each message can contain 64 KiB. Each Task mailbox can hold 1,000 pending messages.

## Structured output and gates

Set `outputSchema` to parse the final child text as JSON. A single JSON code fence is accepted.

Set `schemaMode` to `permissive` to preserve invalid output without run failure.

Set `schemaMode` to `strict` to fail the node when JSON parsing or schema validation fails.

The built-in validator supports boolean schemas, `type`, `enum`, object properties, required properties, arrays, and additional property control.

Use `gates` for deterministic checks after artifact publication:

- `status` checks normal completion.
- `schema-valid` checks the structured result.
- `artifact-present` checks artifact publication and an optional media type.
- `json-pointer` checks existence, equality, or membership.

A failed gate fails the node before the coordinator releases its descendants.

Snapshots expose current context use, active automatic retry state, and the last terminal retry failure.

## Capability profiles

The runtime denies ambient extensions and generic MCP inheritance.

A trusted extension can register versioned executable capabilities:

```ts
const runtime = registerSubagent(pi)

runtime.registerCapability({
  id: 'review-tools',
  version: '1',
  tools: [trustedReviewTool],
  readonlyTools: ['trusted_review'],
  extensions: [trustedReviewHooks],
})

runtime.registerCapabilityProfile({
  id: 'review-profile',
  registrations: ['review-tools'],
})
```

Set `capability_profile` on a Task call to select an approved profile.

The effective contract persists the profile, registration versions, approved tools, and extension providers.

A read-only Task removes each capability tool unless `readonlyTools` explicitly permits it. Known mutation tools can never enter `readonlyTools`.

Each child receives an isolated model runtime. A capability provider cannot mutate a sibling provider registry.

Resume fails if a registration is absent or its version changed. Resume also rejects changed schemas, schema modes, and gates.

`pi.getAllTools()` exposes metadata without executable dispatch. The package does not treat that metadata as an executable capability.

A trusted provider can register MCP proxy tools as explicit tool definitions inside an approved inline extension.

## Nested Task

Nested Task remains disabled unless a capability profile contains a finite depth policy:

```ts
runtime.registerCapabilityProfile({
  id: 'nested-owner',
  registrations: [],
  nested: { maxDepth: 3 },
})
```

The first child has depth `1`. A child can spawn only when its depth is less than `maxDepth`.

The runtime checks depth before dispatch. It also removes `Task` from the child tool surface at the limit.

A nested child cannot select a different capability profile.

The persisted contract records the root owner, root agent, parent agent, parent session, and depth.

The depth policy does not limit sibling count, tokens, requests, tool calls, cost, or concurrency.

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
- `result()` returns a terminal result with artifact, structured-output, and gate evidence.
- `wait()` waits for a terminal result.
- `steer()` queues text for an active model turn.
- `cancel()` requests cancellation for the same active generation.
- `subscribe()` emits owner-bound events with monotonic revisions.
- `registerAgents()` adds extension agent definitions.

Steering rejects empty text, stale handles, terminal children, and idle sessions.

Session replacement invalidates old handles. An owner-generation fence rejects child setup that finishes after replacement.

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
