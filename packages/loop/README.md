# @nothingrotf/loop

A session loop for recurring and self-paced [Pi](https://github.com/earendil-works/pi) prompts or skills.

The package follows the Cursor Agent loop behavior:

- A fixed loop runs once immediately and then fires at its interval.
- A dynamic loop runs once immediately and lets the agent select each next delay.
- An optional watcher can wake a dynamic loop before its fallback timer.
- A prompt can change after each dynamic tick.
- A stop cancels the active timer and watcher.

The extension stores its state in the Pi session. A resumed session restores the active schedule.
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

## Control the loop

```text
/loop status
/loop-list
/loop stop deployment complete
/loop-stop deployment complete
```

Only one loop can run in a session. Pi requests confirmation before a replacement.

## Development

```sh
bun install
bun run check
bun run test
```

## License

[MIT](LICENSE)
