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

The transcript labels each message author and closes each agent run with one usage row:

```text
◆ You · 10:11 PM

can you render a todo list?

● GLM 5.3 · 10:12 PM

Yes. The harness registers todo_write and todo_read.

▪ 5s · $0.299 · 576.6k in · 278 out · ⛁ 100% cached · ⚡58.6/s
```

A user message always carries a `◆ You` header. An assistant header names the active model and appears once per run, before the first assistant message, so turns inside a run stay unlabelled.

The row totals every assistant message in the run. It shows the run duration, the cost, the input tokens including cache, the output tokens, the share of input served from cache, and the output tokens per second. A run that reports no tokens shows no row.

The row shares the column that the `outputPad` setting controls.
The throughput divides the total output tokens by the time from the first turn to the end of the run.
Headers and usage rows are active by default and never enter the model context.
Use `/hud-timestamp` to disable or enable them.

## Action rail

The rail draws a tree of the tool calls in the current turn.

```
7 actions ▾
├─ ✓ ⧬ Sequenced   ×3 ▸
├─ ✓ ▦ Read        ×2 TS 8 files · 4 files ▾
│  ├─ ✓ ▦ Read        TS 8 files · 402 lines
│  ╰─ ✓ ▦ Read        TS 4 files · 165 lines
╰─ ✓ ⧬ Synthesized ×2 ▾
   ├─ ✓ ⧬ Synthesized  · 6 lines
   ╰─ ✓ ⧬ Synthesized  · 2 lines
```

Consecutive calls of the same tool fold into one row with a `×N` multiplier.
The last row at each level uses the rounded corner `╰─`. Rows that are not last
carry a trunk `│` under their children.

A row updates in place. While a call runs it shows a present tense label in the
brand color. When the call finishes the label switches to past tense and takes
the tool color.

Read `docs/rail-spec.md` for the full contract, including width rules and
grouping semantics.

## Working loader

The extension hides the built-in working loader and renders its own loader as the last widget above the editor. This keeps the loader below the `TODO` and `Subagents` widgets, in the same order as the oh-my-pi dock.

The loader shows a braille spinner and shimmers the message with the elapsed time of the current run, for example ` ⠋ waiting for the model · 9s`. The final usage row reports the same span.

Other extensions set the loader text through the `hud:working-message` event. Emit a string to set the text. Emit `null` to restore `waiting for the model`. The `@nothingrotf/subagent` package emits `Waiting on N jobs` while a Task call waits on children.

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
