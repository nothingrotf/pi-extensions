---
name: loop
description: >-
  Run a prompt or skill in this session on a recurring or variable interval
  (for example, /loop 5m /foo).
---

# Loop

Run `/loop` on a recurring or variable interval. The Pi loop machine owns timers and watchers.

Use a persistent TUI or RPC session. One-shot print and JSON modes cannot run a loop.

## Parse

Accept `/loop [interval] <prompt>`.

- Leading interval: `5m /foo`, `30s check status`, `2h run report`.
- Trailing interval: `check deploy every 5m`, `run tests every 10 minutes`.
- No interval: dynamic mode. The agent selects the delay and can change it after each tick.
- Empty prompt: show `Usage: /loop [interval] <prompt>`.

Use intervals such as `30s`, `5m`, `2h`, and `1d`. The minimum interval is one second.

The loop machine expands skill commands and prompt templates on every tick.

## Fixed schedule

Run this command:

```text
/loop 5m /foo
```

The loop machine runs the prompt once immediately. It then fires at the fixed interval until the loop stops.

Do not call `loop_next` for a fixed loop. Do not create a shell timer or another loop.

Confirm the interval and the immediate first run. State when the first scheduled tick will arrive.

On later ticks, give a short update about the result.

## Dynamic schedule

Run this command without an interval:

```text
/loop check deploy
```

The loop machine runs the prompt once immediately. Select the next wake before each loop turn ends.

Call `loop_next` with `delaySeconds`. Select a delay that matches the next useful check.

Use the optional `prompt` field when the next tick requires different work. If absent, the loop reuses the current prompt.

### Time wake

Call `loop_next` with only `delaySeconds` and an optional `prompt`.

The delay is the cadence for the next tick. You can select a different delay after that tick.

### Event wake

If an observable event can wake the loop earlier, add `watch` to `loop_next`.

Set `watch.command` to a quiet command that waits for the event. The loop machine runs it in the session workspace.

Set `watch.pattern` to a regular expression that matches one output line. If absent, a successful command exit wakes the loop.

The delay remains the fallback heartbeat. Select a long fallback when the watcher is the primary wake source.

The loop machine cancels the watcher after one wake. Call `loop_next` again after the tick to rearm it.

Do not create a background shell sleep loop. Do not create duplicate sleepers or watchers.

Confirm these facts:

- The loop uses a dynamic schedule.
- The prompt ran once immediately.
- The selected fallback delay applies.
- The watcher is the primary wake source, if present.

## Repeat schedule

Run this command to repeat one prompt after every settled turn:

```text
/loop repeat [compact] [count|duration] [prompt]
```

- No prompt: the next user prompt becomes the loop prompt.
- `count`: stop after that many iterations. `duration`: stop after that time.
- `compact`: compact the context before each iteration.
- `/loop repeat` again disables the loop. `/loop pause` and `/loop resume` control it.
- An aborted turn pauses the loop.

Do not call `loop_next` for a repeat loop. The loop machine re-sends the prompt 800 ms after each settled turn.

While any loop is active, an active goal does not send its own continuation. The loop owns the cadence.

## Stop

Stop the active loop with this command:

```text
/loop-stop <reason>
```

You can also use `/loop stop <reason>`.

Call `loop_stop` when the agent determines that the loop must stop.

The stop operation cancels the timer and watcher. Do not schedule another wake after the stop.

Show the current state with `/loop-list` or `/loop status`.

## Replacement and persistence

Only one loop can run in a session. A replacement requires confirmation.

The loop state remains in the current session. A session resume restores the timer and watcher.

Each tick stays in the current conversation. The loop does not create a subagent.
