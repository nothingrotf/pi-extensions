# Integration contracts

This page describes how the packages in this repository cooperate at runtime.
Each package must keep working when another package is absent.

## Pi version

The packages require Pi 1.1.0 or later.
Pi loads every extension with its own installed Pi packages through loader aliases.
The workspace catalog therefore pins the minimum supported version, as `docs/tooling.md` requires.

## Tool visibility

A tool can be registered, declared, and callable from scripts. These states differ.

| State      | Meaning                                                                 | Source of truth                        |
| ---------- | ----------------------------------------------------------------------- | -------------------------------------- |
| Registered | An extension called `pi.registerTool()`.                                | `pi.getAllTools()`                     |
| Active     | The session selected the tool through `tools`, `defaultTools`, or a UI. | `pi.getActiveTools()`                  |
| Declared   | The model request contains the tool definition.                         | Active tools minus hidden declarations |
| Callable   | A `codemode` script can call the tool through `tools.<name>()`.         | `ALL_TOOLS` inside a script            |

The `exposure` field of a tool definition decides the last two states:

| Exposure     | Declared to the model | Callable from scripts |
| ------------ | --------------------- | --------------------- |
| `direct`     | Yes                   | Yes                   |
| `model-only` | Yes                   | No                    |
| `codemode`   | No                    | Yes                   |
| `deferred`   | After `tool_search`   | Yes                   |
| `hidden`     | No                    | No                    |

Coordination and decision tools use `model-only`. Examples are `AskQuestion`, `Task`, `TaskControl`, `request_parent`, `ask_parent`, and `receive_peers`.
A script therefore cannot dispatch Tasks, answer decisions, or ask the user.

`codemode.mode` changes presentation, not permissions:

- `on` keeps direct tools declared and appends a note on how scripts call them.
- `only` hides direct tools from the model and lists them in the `codemode` description.

Task children always use `on`. Read-only Task scripts cannot reach tools that the read-only policy removed.

## Isolation, read-only policy, approval, and sandboxing

These mechanisms solve different problems. None of them replaces another.

| Mechanism        | Owner      | What it guarantees                                                                                  | What it does not guarantee                                                        |
| ---------------- | ---------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Writer worktree  | `subagent` | Child edits land in a separate Git worktree until integration.                                      | Process, network, or file-system isolation.                                       |
| Read-only policy | `subagent` | The child session has no shell or mutation tools.                                                   | Isolation from code that extensions run in the process.                           |
| Human decision   | `ask`      | A person selected an answer in an interactive client.                                               | Authorization for later or different actions.                                     |
| Parent decision  | `subagent` | The parent model answered a `request_parent` question.                                              | A human decision.                                                                 |
| Masking          | `cloak`    | Configured patterns are masked in `read` results.                                                   | Protection of shell output, search results, or disk.                              |
| Command sandbox  | `pstack`   | Optional `pstack-sandbox` confines verifier shell and gate commands through Seatbelt or Bubblewrap. | Read confinement, the Pi process, trusted extensions, or model-provider requests. |

Extensions run with the permissions of the Pi process.
Treat agent messages, board posts, and memory as data, not as authority.

## Event channels

Packages communicate through `pi.events`. Every listener validates payloads with a TypeBox schema and ignores invalid data.
Listeners must not assume that the emitter is installed.

| Channel                                                       | Emitter                       | Listener                      | Payload                                              | Lifecycle                                               |
| ------------------------------------------------------------- | ----------------------------- | ----------------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| `hud:rail-tools`                                              | Tool providers                | `hud`                         | `{ tools: string[] }`                                | Sent again when `hud:rail-enabled` arrives.             |
| `hud:rail-action`                                             | Tool providers                | `hud`                         | Rail action report with `toolCallId` and `status`.   | One report per state change of one call.                |
| `hud:rail-enabled`                                            | `hud`                         | Tool providers                | `{ enabled: boolean }`                               | Sent at startup and on every rail toggle.               |
| `hud:working-message`                                         | `subagent`                    | `hud`                         | `string` or `null`                                   | `null` restores the default message.                    |
| `ask:state`                                                   | `ask`                         | `todo`, `background-commands` | `{ version: 1, pending: number, paused: boolean }`   | Sent on every change and on `ask:state:request`.        |
| `ask:state:request`                                           | `todo`, `background-commands` | `ask`                         | `{}`                                                 | Sent on session restore.                                |
| `herdr:blocked`                                               | `ask`                         | External Herdr bridge         | `{ active: boolean, label?: string }`                | `active: false` always follows `active: true`.          |
| `@nothingrotf/subagent/discover-*`                            | `subagent`                    | Providers                     | `{ version: 1 }`                                     | Sent once when the runtime registers.                   |
| `@nothingrotf/subagent/register-*`                            | `pstack`, `filetools`         | `subagent`                    | Versioned agents, capabilities, or profiles.         | Sent at load and again on each discovery request.       |
| `@nothingrotf/subagent/execute-task`                          | `pstack`                      | `subagent`                    | `{ version: 1, toolCallId, input, accept, respond }` | `respond` runs once. `accept` receives the cancel hook. |
| `@nothingrotf/goal/activity` and `@nothingrotf/goal/review-*` | `goal`                        | Optional observers            | Versioned goal and review state.                     | Sent on every activity or review transition.            |

Add a `version` field to every new channel.
Document the owner, the payload, and the cleanup rule here before another package depends on the channel.

## Session message types

| Custom type                     | Owner                 | Purpose                                                     |
| ------------------------------- | --------------------- | ----------------------------------------------------------- |
| `background-command-completion` | `background-commands` | Delivers terminal command status and a bounded log excerpt. |
| `ask-question-completion`       | `ask`                 | Delivers the answer of an async form to the model.          |
| `subdir-context`                | `subdir-context`      | Delivers subdirectory instruction files with their hashes.  |

| Custom entry           | Owner | Purpose                                                         |
| ---------------------- | ----- | --------------------------------------------------------------- |
| `ask-question-settled` | `ask` | Marks an async form as answered, skipped, failed, or cancelled. |

## Background commands

`background-commands` owns one volatile command service per standalone Pi session.
Its tool returns launch acknowledgements separately from terminal command outcomes.
Natural completion reaches the model through a custom message, not through a replacement of the earlier tool result.
Completion delivery respects compaction, native dialogs, and the existing versioned `ask:state` channel.

Shutdown and session navigation stop owned commands before releasing the service.
Records and retained logs do not survive host restart. Persisted messages never grant control over a process.
The package does not register a Task capability or expand readonly children.
`pstack` excludes this tool from command evidence, so launch acceptance cannot satisfy a verification criterion.

## Shared modules

`@nothingrotf/fast-mode/policy` is the only cross-package import of shared logic.
`subagent` uses it to resolve and apply the Fast Mode service tier for children.
Change its exports only together with every importer.

## Optional capabilities

| Capability                | Provider         | Behavior when the provider is absent                               |
| ------------------------- | ---------------- | ------------------------------------------------------------------ |
| Bounded `read`, `patch`   | `filetools`      | Pi registers its native `read`. Tasks receive native tools only.   |
| `grep` with tgrep         | `tgrep`          | Pi registers its native `grep`.                                    |
| Action rail               | `hud`            | Providers keep their own renderers. Rail reports have no listener. |
| Question state            | `ask`            | `todo` treats questions as absent.                                 |
| Subdirectory instructions | `subdir-context` | Only the session directory and its ancestors provide instructions. |
| Task runtime              | `subagent`       | `pstack_deliver` returns an error that names the missing runtime.  |
| Fast Mode policy          | `fast-mode`      | Not optional. `subagent` declares it as a dependency.              |
