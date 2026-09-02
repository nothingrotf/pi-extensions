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

The runtime automatically adds writer isolation to a mutable background Task. Its accepted result remains staged until a safe join barrier.

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

A resumed child uses its persisted agent prompt, directory, tools, model, effort, fast mode, and foreground or background mode.

A changed agent file cannot expand the capabilities of an existing child.

A migrated v1 record has no execution contract. The runtime rejects its resume instead of re-resolving mutable capabilities.

## Task control

`TaskControl` inspects or controls an existing Task without `resume`.

Inspect one Task:

```ts
TaskControl({
  action: 'status',
  agent_id: '<agent-id>',
})
```

The result includes activity, state, usage, isolation evidence, and a terminal result when one exists.

List a bounded set of Tasks:

```ts
TaskControl({
  action: 'list',
  active_only: true,
  limit: 10,
})
```

The maximum list limit is 20.

Queue text for an active model turn:

```ts
TaskControl({
  action: 'steer',
  agent_id: '<agent-id>',
  message: 'Focus on the failing integration test.',
})
```

A `queued` receipt does not prove that the child received the text.

Cancel the current active generation:

```ts
TaskControl({
  action: 'cancel',
  agent_id: '<agent-id>',
  reason: 'Operator requested a zero-write stop.',
})
```

Cancellation preserves an isolated writer patch. The runtime rejects joins for failed or aborted runs.

For a zero-write order, cancel an isolated writer. The `steer` action cannot stop a child before its next write.

Cancellation cannot revert changes from a non-isolated foreground Task.

Join an accepted background writer at its immediate parent boundary:

```ts
TaskControl({
  action: 'join',
  agent_id: '<agent-id>',
})
```

A root join accepts only a root-scoped writer. A child Task receives a scope-bound `TaskControl` for its direct descendants.

The scope-bound tool supports status, list, steer, cancel, and join actions.

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

A mutable graph uses one aggregate workspace. Each mutable node uses a private child workspace.

The coordinator stages ready siblings, then integrates them in declared order. Applied dependencies enter the aggregate before dependent dispatch.

The coordinator captures the aggregate once. It applies one accepted aggregate result at the root boundary.

A dependent receives complete upstream outputs as Base64 JSON in a deterministic untrusted-data envelope.

The envelope prevents upstream text from closing the trust boundary. The prompt tells the child to treat decoded content only as data.

Each node publishes its complete output as an atomic artifact. The inline result remains limited to 50 KiB.

The artifact metadata includes:

- the Run ID, Task ID, and attempt number.
- a collision-resistant publication ID and file URI.
- a SHA-256 digest.
- byte and line counts.
- a media type.

Graph state, workspace state, artifact metadata, isolation attempt history, and child records enter version 6 of the persisted parent state.

The version 6 migration preserves older terminal records and artifact references.

Graph children also receive these private tools:

- `send_peer` sends a correlated message to a Task ID in the same run.
- `receive_peers` atomically consumes pending messages for the current Task.

The mailbox rejects targets and reply IDs from another run. It also validates both endpoints of each reply.

The mailbox rejects self-delivery and terminal targets. It removes closed endpoints and limits retained reply correlations.

Each message can contain 64 KiB. Each Task mailbox can hold 1,000 pending messages.

## Writer isolation

Set `isolation.mode` to `worktree` for a child that can modify files.

```ts
Task({
  description: 'Implement the fix',
  prompt: 'Implement the requested change and run the focused tests.',
  subagent_type: 'generalPurpose',
  isolation: { mode: 'worktree', integration: 'apply' },
})
```

The runtime requires a Git repository. Born and unborn repositories are supported.

It creates a private workspace from a synthetic baseline commit.

The synthetic baseline includes tracked, staged, unstaged, untracked, mode, and symbolic-link state.

Each writer receives a private Git directory and common directory. Child branches, tags, indexes, and `HEAD` values cannot change parent metadata.

The runtime uses object alternates for baseline reads. It promotes result commits into durable root storage before workspace cleanup.

Ignored dependency directories use copy-on-write copies when available. The runtime uses regular copies as the safe fallback.

Each physical attempt uses a unique workspace, attempt identity, atomic owner manifest, and cross-process lock owner.

The stable child Agent ID remains the writer identity across resume attempts. Each resume creates a new physical attempt.

The runtime captures changes after completed, failed, and aborted turns.

Each repository receipt contains:

- baseline, current, merged, and result tree IDs.
- destination `HEAD` values.
- changed files and diffstat.
- a retained binary patch URI and SHA-256 digest.
- a durable internal Git reference.
- transaction, integration, visibility, and recovery state.

The runtime discovers nested Git repositories and excludes submodules.

The receipt contains one ordered ledger entry for each repository.

The runtime rejects new, removed, or moved nested repository boundaries during capture.

`integration: 'apply'` uses a three-tree merge of the child baseline, current parent, and child result.

The runtime plans every repository before the first mutation. It applies merged worktree patches under ordered destination locks.

The runtime preserves the parent index. New child changes enter the parent as unstaged changes.

A content conflict does not modify any destination repository. The receipt retains the patch, stage entries, path list, and transaction journal.

An operational failure triggers rollback only from a verified complete tree. An ambiguous destination remains available for recovery.

`integration: 'manual'` retains durable artifacts without parent changes.

`integration: 'branch'` also creates a public artifact branch. It does not apply the result.

Failed and aborted turns never apply changes. Their patches remain available in the terminal result. Recovery also keeps interrupted patches as evidence without join permission.

A nested writer starts from its immediate parent workspace. Its result enters that workspace before the root boundary.

A successful parent closes all descendants before parent capture. A failed parent cancels descendants and blocks their root visibility.

A background writer remains staged until an explicit join, successful parent closure, or coordinator dependency barrier.

The recovery scan reads durable registries. It preserves live and ambiguous owners, then processes dead leaves before ancestors.

Recovery attaches root writer evidence to the interrupted record. It does not reconstruct nested parent join scopes.

A cleanup failure retains recovery evidence and sets `cleanupDebt`.

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

A separate extension can publish static profiles through the shared event bus:

```ts
const publish = () => {
  pi.events.emit('@nothingrotf/subagent/register-capability-profiles', {
    sourceId: 'workflow-extension',
    profiles: [{ id: 'workflow-nested', nested: { maxDepth: 3 }, registrations: [] }],
  })
}

const unsubscribe = pi.events.on('@nothingrotf/subagent/discover-capability-profiles', publish)
publish()
pi.on('session_shutdown', unsubscribe)
```

Publish each source one time. The runtime ignores later publications from the same source.

The effective contract persists the profile, registration versions, approved tools, and extension providers.

A read-only Task removes each capability tool unless `readonlyTools` explicitly permits it. Known mutation tools can never enter `readonlyTools`.

A read-only Task does not load arbitrary capability extensions. Tool definitions remain subject to the read-only allowlist.

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

The runtime checks depth before dispatch. It caps registered profile depth at 16. It also removes `Task` and the scope-bound `TaskControl` at the limit.

The runtime automatically isolates mutable nested Tasks. It also isolates a mutable root owner that enables nested delegation.

A successful parent joins completed descendant writers in spawn order.

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

Agent names accept letters, numbers, underscores, hyphens, and single spaces between words.

A separately installed package can register agents through the shared Pi event bus:

```ts
const publish = () => {
  pi.events.emit('@nothingrotf/subagent/register-agents', {
    sourceId: 'review-extension',
    definitions: [
      {
        name: 'Review Agent',
        description: 'Review code without mutations.',
        systemPrompt: 'Review the requested code and report concrete findings.',
      },
    ],
  })
}

const unsubscribe = pi.events.on('@nothingrotf/subagent/discover-agents', publish)
publish()
pi.on('session_shutdown', unsubscribe)
```

Publish immediately and respond to discovery events. This handshake works in either package load order.

A repeated `sourceId` replaces its prior registration. Project and user definitions still take precedence.

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

Set `is_background: true` to use background execution when the call omits `run_in_background`.

An explicit `run_in_background` value overrides the agent default. A resume preserves the prior mode unless the call overrides it.

A mutable background default automatically activates writer isolation. Coordinated task graphs always use foreground execution.

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
- `cancel()` requests cancellation for the same active generation and accepts an optional reason.
- `subscribe()` emits owner-bound events with monotonic revisions.
- `registerAgents()` adds extension agent definitions.

Steering rejects empty text, stale handles, terminal children, and idle sessions.

Session replacement invalidates old handles. An owner-generation fence rejects child setup that finishes after replacement.

The Pi SDK does not provide a shared process registry. Separate physical package copies can create separate controllers.

Use the shared event bus registration contract between separately installed packages.

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

The `Subagents` widget above the editor shows live status, activity, tool calls, token use, cost, and elapsed time.

A foreground or batch Task call streams a job tree into its tool result while the children run:

```text
ⓘ waiting on 2 of 3 jobs · 1 done
├─ ⠹ [task] Ampere lane 8m8s → Read runtime.ts
├─ ⠹ [task] Ada lane 8m8s
└─ ✓ [task] Blackwell lane 2m1s
```

The tree updates on every child change and once per second for the durations.
The working loader shows the same title while at least one child runs.
After the call settles, the tree keeps only the settled rows.
A background Task returns at once and does not stream a tree.

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

## Migration from `@nothingrotf/task`

`@nothingrotf/subagent` replaces the local `@nothingrotf/task` package.

The common local fields remain available. Legacy role aliases also remain available.

The replacement does not accept `attachments`, cloud fields, `machine`, or `interrupt`.

Those fields represented unsupported compatibility paths in the removed adapter.

Custom `subagent_type` values now require a discovered or registered agent definition.

Old retained Agent IDs used the external RPC runtime. They cannot resume in this runtime.

This package replacement is incompatible with consumers of those paths.

## Development

```sh
bun run check
bun run test
```
