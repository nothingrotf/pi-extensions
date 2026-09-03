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

1. A row is groupable only when it is done, has no subtree, and has no images.
2. Two rows merge only when the tool name matches.
3. The minimum run length is 2. A single row stays ungrouped.
4. There is no maximum run length.
5. An error does NOT break a run.

Rule 5 matters. A failed call inside a run stays in the run, and the parent row
shows the error state when any child failed.

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
