# @nothingrotf/loop

A session loop for recurring and self-paced [Pi](https://github.com/earendil-works/pi) prompts or skills.

The package follows the Cursor Agent loop behavior:

- A fixed loop runs once immediately and then fires at its interval.
- A dynamic loop runs once immediately and lets the agent select each next delay.
- An optional watcher can wake a dynamic loop before its fallback timer.
- A prompt can change after each dynamic tick.
- A stop cancels the active timer and watcher.
- A repeat loop re-sends one prompt after every settled turn, with an optional iteration or duration limit.

The extension stores its state in the Pi session. A resumed session restores scheduled timers and watchers. Repeat loops resume in a paused state.
TUI and RPC sessions support loops. One-shot print and JSON modes reject them.

## Install

```sh
pi install npm:@nothingrotf/loop
```

Try the local workspace without installation:

```sh
pi --no-extensions -e ./packages/loop/src/index.ts --skill ./packages/loop/skills/loop/SKILL.md
```

## Use a fixed schedule

```text
/loop 5m check CI
/loop run tests every 10 minutes
/loop 30s /skill:my-check
```

## Use a dynamic schedule

```text
/loop monitor the deployment
```

The agent uses `loop_next` after each dynamic tick. It selects a fallback delay and can add an event watcher.

## Use a repeat loop

```text
/loop repeat                      the next prompt repeats after each turn
/loop repeat 10 fix the tests     repeat at most 10 times
/loop repeat 30m poll ci          repeat for 30 minutes
/loop repeat compact 5 retry      compact the context before each iteration
/loop repeat                      again: disable
/loop pause
/loop resume
```

The repeat loop waits 800 ms after each settled turn, then re-sends the prompt. While the repeat loop is enabled, every prompt that the user types becomes the new loop prompt.

An aborted turn (Esc) pauses the loop. A session resume pauses the loop. Use `/loop resume` or send a prompt to continue. A repeat loop and a scheduled loop cannot run at the same time.

## Control the loop

```text
/loop status
/loop-list
/loop stop deployment complete
/loop-stop deployment complete
```

Only one loop can run in a session. Pi requests confirmation before a replacement.

## Goal mode

While any loop is active, `@nothingrotf/goal` does not send its own continuation. The loop owns the wake cadence.

## Development

```sh
bun install
bun run check
bun run test
```

## License

[MIT](LICENSE)
