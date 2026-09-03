# @nothingrotf/hud

A compact one-line footer for [Pi](https://github.com/earendil-works/pi).
It replaces the default footer without changing the editor, theme, transcript, or notification behavior.

The left side shows:

- the current workspace
- the Git branch and working tree counters
- the provider, model, and reasoning effort
- the active goal status from `@nothingrotf/goal`

The right side shows provider quota windows and context use.
Quota windows support Anthropic and OpenAI Codex authentication from Pi.

The transcript labels each message with a role header and closes each assistant turn with a usage row:

```text
◆ You · 10:11 PM (now)
  this harness can use a todo list tool?

● Agent · 10:11 PM (now)
  Yes. The harness registers todo_write and todo_read.

   ▪ 8s · 43.4k · 165 out · ⛁ 93% cached · ⚡23.9/s
```

The header shows the role glyph, the role, the local time, and the age of the message. The age updates when the transcript redraws.

The usage row shows the turn duration, the input tokens including cache, the output tokens, the share of input served from cache, and the output tokens per second. Each part appears only when the message reports it. A turn that reports no tokens shows no row.

The throughput divides the output tokens by the time from the turn start to the end of the message.
Role headers and usage rows are active by default and never enter the model context.
Use `/hud-timestamp` to disable or enable them.

## Working loader

The extension hides the built-in working loader and renders its own loader as the last widget above the editor. This keeps the loader below the `TODO` and `Subagents` widgets, in the same order as the oh-my-pi dock.

Other extensions set the loader text through the `hud:working-message` event. Emit a string to set the text. Emit `null` to restore `Working...`. The `@nothingrotf/subagent` package emits `Waiting on N jobs` while a Task call waits on children.

Retry, compaction, and branch summary indicators still use the built-in status row.

Every widget in the dock ends with one blank line.

## Sounds

The extension plays a sound when the agent ends a turn.
It plays a second sound when an ask style tool opens and waits for your input.
The default sounds are `fx-ok01` for completion and `fx-ack01` for awaiting input.

Use `/hud-sound` to change the sounds:

- `/hud-sound` opens the completion sound picker
- `/hud-sound <off|bell|fx-ok01|fx-ack01|/absolute/path.wav>` sets the completion sound
- `/hud-sound ask <sound>` sets the awaiting-input sound
- `/hud-sound focus <always|focused|unfocused>` sets the focus policy
- `/hud-sound test` plays the current completion sound

Settings persist in `hud.json` inside the Pi agent directory.
Playback uses `afplay` on macOS, `paplay`, `aplay`, or `ffplay` on Linux, and PowerShell on Windows.
If no player is available, the extension writes the terminal bell.

## Install

```sh
pi install npm:@nothingrotf/hud
```

Try the local workspace without installation:

```sh
pi --no-extensions -e ./packages/hud/src/index.ts
```

## Development

```sh
bun install
bun run check
bun run test
```

## License

[MIT](LICENSE)
