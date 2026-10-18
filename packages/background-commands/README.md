# @nothingrotf/background-commands

Run session-owned shell commands without blocking the Pi agent turn.
Inspect recent logs, stop one command, and receive a completion message automatically.
Ordinary `bash` behavior stays unchanged.

This package independently implements the capability explored in [JetBrains ThinkRail](https://github.com/JetBrains/thinkrail/tree/3bee4f16454515674c5548cb96ed46c57c2a4956/packages/pi-background-commands).
It does not depend on ThinkRail or copy its host, renderers, or runtime implementation.

## Load

Try the local extension without changing Pi settings:

```sh
pi -e ./packages/background-commands/src/index.ts
```

Install the local package:

```sh
pi install ./packages/background-commands
```

The package requires Pi 1.1.0 or later.
The repository's local-profile command discovers it automatically.

## Tool

Start a command:

```ts
background_command({ action: 'start', command: 'bun run dev', name: 'Development server' })
```

Set an optional timeout in seconds:

```ts
background_command({ action: 'start', command: 'bun run test', name: 'Tests', timeout: 120 })
```

Inspect or stop a command with its returned opaque ID:

```ts
background_command({ action: 'list' })
background_command({ action: 'output', id: '<command-id>' })
background_command({ action: 'stop', id: '<command-id>' })
```

`start` acknowledges launch, not command success.
`output` includes the current status and terminal exit code when available.
Successful tool results also expose schema-validated structured data to codemode scripts.
A command can fail after its start request succeeds.

Natural completion posts `background-command-completion` with status, exit code, diagnostics, and a bounded log excerpt.
Its content reaches the model, while structured `details` support rendering and session history.
Each retained natural outcome can trigger one follow-up turn. Explicit cancellation does not wake the agent.
Completion delivery waits for idle and pauses during prompt preflight, compaction, question forms, and UI dialogs.
Pending records stay outside Pi's model queue, so Escape cannot discard their completion messages.
Manual compaction schedules a deferred flush after Pi clears its compaction state.
If another extension consumes or rejects an input before a model run, delivery can wait until the next actual agent turn.
On Pi 1.1, an earlier asynchronous input handler can delay this package's preflight signal.
A simultaneous completion can reject that incoming prompt as busy. Retry the prompt after the completion turn.
A failed synchronous delivery remains pending until a later flush.
Pi acceptance is not a guarantee of an eventual provider response.

The footer shows the number of active commands.
Completion messages show a status glyph, the name, the exit code, and the run time.
Expand tool results or completion messages to inspect more output and the command ID.

## HUD integration

The package works with `@nothingrotf/hud` without a dependency in either direction.

- The HUD footer shows active commands, such as `⚙ 2 bg, 1 stopping`.
- The HUD action rail shows each call as a shell row, such as `Launched Sleeper · in background`.
- A launch row states that the command runs in the background. It does not report command success.

The footer contract uses the Pi event bus:

- `background-commands:state` carries `{ version: 1, running, stopping }` after each lifecycle change.
- `background-commands:state:request` asks the extension to emit the current state again.

Session navigation and shutdown emit a zero state. Output chunks do not emit state events.

## Execution and ownership

Pi's public local shell executor owns process execution and process-tree cancellation.
Commands inherit the current session directory, shell settings, environment, and `PI_SESSION_*`/model metadata at launch.
The tool does not accept a separate directory, environment, PID, or stdin.
Keep the shell command foreground. Do not use `&`, `nohup`, `disown`, or daemonization.
There is no PTY or interactive terminal.

Each command owns cancellation independently of the parent turn.
Aborting the parent turn does not cancel a launched command.
A pending natural completion can resume the agent after a parent-turn abort.
Stopping a command enters `stopping`; only executor settlement establishes `stopped`.
Cancellation cannot undo earlier writes or network effects.

Standalone session shutdown, reload, switching, forking, and tree navigation stop owned commands and suppress late completion delivery.
Navigation attempts can stop commands even when navigation later cancels.
Shutdown signals every command before waiting, with a maximum wait of five seconds.
A wait timeout does not prove that an uncooperative or escaped process ended.
Commands that escape shell supervision are outside the cleanup guarantee.

There is no OS sandbox, automatic secret masking, or log redaction.
Commands, names, and output can contain sensitive data. Do not print credentials.
The `cloak` package masks file reads, not this tool or its completion messages.

## Limits and retention

- At most eight commands can remain active per session. Excess starts fail instead of queueing.
- The service retains the newest twenty terminal command records. Eviction also drops any undelivered completion for that record.
- Each log retains its last 2,000 lines or 50 KiB, whichever limit applies first.
- Completion messages retain at most forty lines or 4 KiB of log output.
- Command input is limited to 64 KiB. Display names are limited to 200 characters.
- Execution has no default timeout. An explicit timeout terminates the command and reports an error.

Output snapshots replace previous snapshots and never consume logs.
UTF-8 decoding preserves characters split between executor chunks.
Truncation is explicit and remains visible after later output arrives.
Terminal renderers remove control sequences without modifying stored logs.

Records and full retained logs live only in memory.
They are unavailable after host restart or eviction. Only delivered messages remain in the Pi transcript.
The extension never reconstructs control authority from a stored PID or reruns commands after restart.

## Host API

Import `createBackgroundCommands` and its contracts from `@nothingrotf/background-commands/headless`.
Bind one service to one immutable session ID and supply current launch context through `getContext()`.
`start()` returns an explicit success/error result. `find()` returns only this service's commands.
Snapshots and outputs are detached copies.
`onChange()` reports lifecycle and retention changes, not every output chunk.

Import `createBackgroundCommandsExtension` from the package root to attach an existing service.
The injected service belongs to its host. The extension detaches delivery on shutdown without disposing that service.
The host must call `dispose()` when its owning session ends.
Rebinding replays pending retained completions without duplicating accepted sends.

## Integration boundaries

The package does not grant tools to Task children or register a subagent capability.
A future child integration must preserve readonly policy, worktree lifetime, and command cleanup before Task settlement.
The `pstack` delivery system does not count this tool as command evidence.
Never treat a successful `start` tool result as a successful test or bypass a delivery gate.

## Development

```sh
bun run check
bun run test
```

Tests exercise real shell commands and real Pi sessions with deterministic local providers.
They require no provider credentials or paid model calls.
