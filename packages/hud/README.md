# @nothingrotf/hud

A compact one-line footer for [Pi](https://github.com/earendil-works/pi).
It replaces the default footer and adds speaker headers, an action rail, a loader, usage rows, and completion sounds.

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

A user message always carries a `◆ You` header. Its body starts on the next row.

The assistant header appears after the user body and before the first assistant content. It appears once per agent run.

The active header starts with a `·` glyph in `brandDim`. Its bold name starts in `textPrimary`.

The glyph follows a double pulse and blends toward `brand`. The name shimmers from `textPrimary` toward `brandAlt`.

Both effects share one subscriber-owned 70 ms clock. The header settles before the final usage row appears.

The clock uses the system locale with two-digit hours and minutes. The settled glyph and name stay bold and static.

Set `NO_MOTION` to any value to disable the header animation. `EMPRYO_NO_MOTION=1` also disables it.

The HUD names the active model instead of the literal `Empryo` product name. The user label stays `You`.

The row totals every assistant message in the run. It shows the duration, cost, token counts, cache share, and output rate.

An active run shows a zero-value row before token metrics arrive.
A completed run with no tokens shows no row. Each row starts at the transcript body column.

The throughput divides total output tokens by the time from the first turn through the run end.

Headers and usage rows are active by default. They never enter the model context.

Use `/hud` to open the settings picker. All HUD settings use this command:

- `/hud rail <on|off|toggle>` controls the action rail.
- `/hud thinking <rail|inline|toggle>` controls inline thinking text.
- `/hud timestamps <on|off|toggle>` controls speaker headers and usage rows.
- `/hud sound` opens the completion sound picker.

The `Sound settings` menu controls both sounds, the focus policy, and the sound preview.

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

The rail also holds the model's own voice:

- A live reasoning block creates a `Thinking` row with a braille spinner.
- The row becomes `Thought` when the reasoning block ends.
- The settled `Thought` row has a blank status cell.
- The detail uses the first heading or the first line.
- Assistant text between tool calls becomes a `Note` row.
- Opening text and the final answer stay as normal transcript prose.
- Intermediate text appears only as a `Note`, not as duplicate prose.
- A separate pending `Thinking...` row appears after the last tool.
- The pending row disappears when reasoning or answer text starts.

A check or a cross always identifies a tool call.

A tool that spawns children, such as a subagent, nests them under its own row
with the same trunk rules.

At most five groups render. Older groups collapse into one `N completed` row.

Use `/hud thinking inline` to show the full thinking text inline.
Use `/hud rail off` to turn the rail off.

Read `docs/rail-spec.md` for the full contract, including width rules and
grouping semantics.

## Working loader

The extension hides the built-in working loader and renders its own loader as the last widget above the editor. This keeps the loader below the `TODO` and `Subagents` widgets, in the same order as the oh-my-pi dock.

The loader shows a braille spinner and shimmers the message with the elapsed time of the current run, for example ` ⠋ waiting for the model · 9s`.

A live usage row reports the turn as it runs:

```
 ▪ 26s · $0.26 · 85.7k in · 1.7k out · ⛁ 64% cached · ⚡65.4/s
```

During tool activity, the row is the last rail line. When answer prose starts, the row moves below that prose.

The row always follows the newest visible interaction content. It shimmers while the turn runs and becomes dim when the turn ends.

The shimmer is a narrow highlight that sweeps back and forth with a continuous
color blend. Read `docs/rail-spec.md` for the exact wave.

Other extensions set the loader text through the `hud:working-message` event. Emit a string to set the text. Emit `null` to restore `waiting for the model`. The `@nothingrotf/subagent` package emits `Waiting on N jobs` while a Task call waits on children.

Retry, compaction, and branch summary indicators still use the built-in status row.

Every widget in the dock ends with one blank line.

## Sounds

The extension plays a sound when the agent ends a turn.
It plays a second sound when an ask style tool opens and waits for your input.
The default sounds are `fx-ok01` for completion and `fx-ack01` for awaiting input.

Use `/hud sound` to change the sounds:

- `/hud sound` opens the completion sound picker.
- `/hud sound <off|bell|fx-ok01|fx-ack01|/absolute/path.wav>` sets the completion sound.
- `/hud sound ask <sound>` sets the awaiting-input sound.
- `/hud sound focus <always|focused|unfocused>` sets the focus policy.
- `/hud sound test` plays the current completion sound.

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
