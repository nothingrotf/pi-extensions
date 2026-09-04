# Rail specification

The rail is the action tree that the HUD draws under an assistant turn. It
shows every tool call, groups repeated calls, and expands on demand.

This document is the contract. The implementation lives in
`packages/hud/src/rail.ts` and its neighbours.

## Row anatomy

A row is a sequence of cells. Widths are in terminal columns, not characters.

| cell      | width             | content                                  |
| --------- | ----------------- | ---------------------------------------- |
| indent    | 3 per depth level | `\|  ` or three spaces                   |
| connector | 3                 | `├─ ` or `╰─ `                           |
| status    | 2                 | spinner, `✓`, `✗`, or blank              |
| icon      | 2                 | tool icon plus one space                 |
| body      | remaining         | label, detail, separator, summary        |
| duration  | 8                 | right aligned, only when the row is done |

The body width is:

```
bodyWidth = totalWidth - 3 * (depth + 1) - 2 - 2 - (done ? 8 : 0)
```

The label sits INSIDE the body. It is not a protected cell. When the terminal
is narrow, the label clips like any other text.

## Tree drawing

| glyph        | codepoint     | use                                    |
| ------------ | ------------- | -------------------------------------- |
| `├─ `        | U+251C U+2500 | a row that is not last at its level    |
| `╰─ `        | U+2570 U+2500 | the last row at its level              |
| `\|  `       | U+2502        | the trunk under a row that is not last |
| three spaces |               | under the last row, the trunk stops    |

The last connector uses the ROUNDED corner U+2570. Do not use U+2514.

Children of a row that is not last carry the trunk. Children of the last row do
not. This is what makes the tree readable at a glance.

## Grouping

Consecutive calls of the same tool fold into one row with a `×N` multiplier.

Rules:

1. A row is groupable only when it has no children and is not a pseudo row.
2. Two rows merge only when the done label matches.
3. The minimum run length is 2. A single row stays ungrouped.
4. There is no maximum run length.
5. An error DOES break a run.

Rule 5 is a deliberate divergence from the original. The original keeps a failed
call inside the run, so the failure and any denial become invisible at the parent
row. This implementation puts a failed call on its own row instead.

At most five groups render. Older groups collapse into one `N completed` row at
the top of the tree.

## Pseudo rows

A thought row and a narration row are not tool calls. They render with:

- A blank status cell, never a check or a cross.
- The thought icon or the chat icon.
- A dim body.

They never join a run, and they break the run around them.

A pending thought row renders as the last row of the tree when the turn streams,
every tool call finished, the answer has not started, and no reasoning is active.

## Sources

Rows enter the rail from three places. All three converge on `RailStore`.

| source            | hook                                            | produces                                                              |
| ----------------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| tool events       | `tool_execution_start` and `tool_execution_end` | tool rows                                                             |
| assistant message | `message_end`                                   | thought and narration rows                                            |
| other extensions  | the `hud:rail-action` event                     | tool rows, and nested rows when the report carries `parentToolCallId` |

Reopening a session rebuilds the same rows from the stored entries, so a
restored turn and a live turn render identically.

The rail entry opens on the first row of any kind. A turn that only thinks still
shows a tree.

## Labels

Each tool has two labels. The running label is present continuous. The done
label is past tense.

| state   | label                      | color          |
| ------- | -------------------------- | -------------- |
| running | `Reading`                  | brand          |
| done    | `Read`                     | the tool color |
| denied  | done label, struck through | faint          |

A row switches label and color in place when it completes. The rail is not
append only. Rows mutate.

## Width and clipping

Terminal width is measured in columns, never in code units.

| class                                        | columns |
| -------------------------------------------- | ------- |
| ASCII, box drawing, `✓`, `✗`                 | 1       |
| basic plane private use, for example U+E628  | 1       |
| supplementary private use, U+F0000 and above | 2       |
| East Asian wide                              | 2       |
| emoji                                        | 2       |
| combining marks                              | 0       |

`String.prototype.length` is not usable. A supplementary private use glyph has
length 2 and width 1 or 2 depending on the plane.

Rows clip. Rows do not wrap and do not add an ellipsis.

## Detail and summary

The body after the label is:

```
label + glyphs + detail + " · " + summary
```

Spacing differs between a group and a single row:

| row     | glyph spacing                                         |
| ------- | ----------------------------------------------------- |
| grouped | leading space before the glyphs and before the detail |
| single  | trailing space after the glyphs                       |

Getting this backwards emits a double space. Cover it with a test.

## Text zones

Assistant text splits into three zones, in `rail-segments.ts`:

| zone      | rule                                                 | placement       |
| --------- | ---------------------------------------------------- | --------------- |
| opening   | text before the first tool call                      | above the tree  |
| narration | text between tool calls                              | inside the tree |
| answer    | text after the last tool call, once the turn settles | below the tree  |

Adjacent text blocks merge into one. A tools or reasoning block keeps them apart.

While a turn is partial and not live, trailing text stays narration. It becomes
the answer only when the turn settles. This is the only retroactive change in the
tree.

## Usage row

The usage row reports the current turn:

```
▪ 26s · $0.26 · 85.7k in · 1.7k out · ⛁ 64% cached · ⚡65.4/s
```

It is visible WHILE the turn runs, not only at the end. The row is the LAST line
of the rail, separated from the tree by one blank line, so it always sits under
the block being generated.

While the turn runs the row shimmers. When the turn settles the shimmer stops
and the row renders in the dim tone. The final figures also settle into a static
transcript entry.

The cost uses three decimals below `$0.10` and two at or above it.

## Speaker header

The header names the speaker:

```
● Agent · 04:31 AM
```

The user header and its body occupy adjacent rows. One blank row separates the user body from the assistant header.

The assistant header appears after the user message ends. It exists before the first assistant message starts.

The assistant header and its first visible content occupy adjacent rows. The header appears once during each agent run.

The first active frame uses a `·` glyph in `brandDim`. The name uses `textPrimary` and bold style.

The space before the name belongs to the bold shimmer span. It does not belong to the glyph span.

| part       | base color              | tint color           | settled color           |
| ---------- | ----------------------- | -------------------- | ----------------------- |
| glyph      | `brandDim` `#2e2845`    | `brand` `#8069ac`    | `brand` `#8069ac`       |
| model name | `textPrimary` `#e8e4f2` | `brandAlt` `#a7c7f0` | `textPrimary` `#e8e4f2` |
| clock      | `textFaint` `#423e54`   | none                 | `textFaint` `#423e54`   |

The glyph follows a double pulse over a period of 2600 ms:

| beat   | phase | time   | weight |
| ------ | ----- | ------ | ------ |
| first  | 0.1   | 260 ms | 1.0    |
| second | 0.3   | 780 ms | 0.55   |

```
intensity = min(1, exp(-(p - 0.1)^2 / 0.0016) + 0.55 * exp(-(p - 0.3)^2 / 0.0024))
glyph     = intensity > 0.45 ? "●" : "·"
color     = mixOklab(brandDim, brand, intensity)
```

The rest of the period is quiet. The two beats form a heartbeat instead of a blink.

The pulse and shimmer use one global 70 ms tick. The ticker starts with its first subscriber.

The ticker stops after its last subscriber leaves. Its phase continues when a later run starts.

When the run ends, the header settles before the final usage row appears. The settled name remains bold.

The clock uses `toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })`. The assistant clock adopts the first assistant message timestamp.

`NO_MOTION` with any value disables the header animation. `EMPRYO_NO_MOTION=1` also disables it.

The static header remains visible when motion is disabled. It uses the settled colors and the `●` glyph.

The HUD uses the active model name instead of the literal `Empryo` name. The HUD uses the fixed English label `You`.

The HUD does not read Empryo's `config.motion` value. Pi does not expose that configuration value to extensions.

## Shimmer

The shimmer is a narrow highlight that sweeps back and forth. It is not a
wrapping scan and not a whole line pulse.

| constant        | value                 |
| --------------- | --------------------- |
| tick            | 70 ms                 |
| wave speed      | 0.12 radians per tick |
| band half width | 2.5 cells             |
| blend floor     | 0.22                  |
| blend range     | 0.62                  |

For tick `t` and a string of length `n`:

```
centre    = (sin(t * 0.12) * 0.5 + 0.5) * (n - 1)
highlight = max(0, 1 - |index - centre| / 2.5)
color     = highlight <= 0 ? base : mixOklab(base, tint, 0.22 + 0.62 * highlight)
```

The centre moves sinusoidally, so the highlight eases at both ends and reverses
instead of jumping back. One full sweep takes about 3.7 seconds.

The color uses the exact Culori Oklab conversion and eight-bit channel rounding.

Do not quantize the color into tiers. Do not add bold style only at the peak.

Both changes cause visible bands that the original does not have.

## Header

The tree sits under a one line header:

```
7 actions ▾
```

The count counts raw calls, not groups. The caret is `▾` when expanded and `▸`
when collapsed.

## Reference implementation

A verified reference implementation exists outside this repository. It was
derived by measurement, not by guessing, and every rule above is covered by an
executable check.

When a rule here and the code disagree, fix the code or fix this document. Do
not leave them out of step.
