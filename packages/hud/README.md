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

The transcript shows a local timestamp below each user and assistant message.
Timestamps are active by default and never enter the model context.
The feature does not track or display prompt cache state.
Use `/hud-timestamp` to disable or enable timestamps.

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
