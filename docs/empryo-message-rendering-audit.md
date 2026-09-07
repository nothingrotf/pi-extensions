# Empryo and Pi/HUD message rendering audit

## Scope and evidence

This audit compares submitted user text and assistant prose, including links, files, Markdown, layout, and streaming.
It does not claim complete parity coverage for tools, the editor, dialogs, or every terminal.

Sources:

- HUD revision: `484ae84`.
- Workspace Pi and Pi TUI: `0.84.4`.
- Globally installed Pi: `0.85.1`.
- Configured global theme: `neosh`. A running session can override this setting.
- Empryo source: `/Users/nothing/workspaces/empryo/extracted/empryo.pretty.js`.
- Empryo source SHA-256: `af41589761ddb8db04b967047ff625b62bbea1e9c51120fcf160b55014ed1b26`.

Empryo findings come from the active application and renderer code in the extracted bundle.
Older research files contain stale symbol names and line numbers for this bundle.
Pi findings also include executable probes of the native message components with the actual HUD spacing patch.
No live Empryo session or cross-terminal screenshot comparison ran during this audit.
No implementation changes accompany this report.

The workspace and global `markdown.js` files match byte for byte.
Their user-message components also match.
The global assistant component additionally supports mouse toggles for individual thinking runs.
That difference does not change the link-rendering findings.

## Implementation status

The HUD now includes a prose layer that addresses the findings below.
The implementation lives in these files:

- `packages/hud/src/prose-links.ts`: URL detection, file candidate detection, async project file index, plain segmentation, and Markdown linkification.
- `packages/hud/src/prose-style.ts`: Empryo-derived style tokens, scope merging with fixed link and code foregrounds, and chunk serialization with OSC 8.
- `packages/hud/src/prose-stream.ts`: streaming stabilization for open fences, unbalanced inline markers, pending link destinations, and partial block markers.
- `packages/hud/src/prose-markdown.ts`: the assistant Markdown renderer.
- `packages/hud/src/prose-plain.ts`: the literal user renderer with URL and file anchors.
- `packages/hud/src/speaker-spacing.ts`: replaces the native `Markdown` children of user and assistant components with these renderers.

Resolved findings:

1. Link labels no longer receive the body foreground. Nested strong or emphasis keeps the link color, and code inside a link keeps the code color.
2. Named link destinations stay visible as `label (url)` regardless of OSC 8 support. Clickable metadata stays attached to both parts when OSC 8 is available.
3. Assistant paths and single-backtick paths become `file://` links after an asynchronous existence check. Labels keep line and column suffixes. Fenced code, explicit links, and URLs stay untouched.
4. User messages render literally with URL and file anchors.
5. Headings, code blocks, tables, lists, quotes, rules, bold, italic, and deleted text follow the Empryo style table.
6. Thinking Markdown keeps the native Pi styling instead of the previous forced body color.
7. The whole HUD palette now derives from the active Pi theme (`packages/hud/src/colors.ts`, `paletteFromTheme`). Tool category colors use the reference hue-rotation algorithm from `research/02-theme-and-icons.md`. The `empryo-dark` theme reproduces the former fixed tokens.
8. File candidates accept shell-escaped spaces (`\ `) and unescape them for the existence check and the `file://` target.

Deliberate deviations from the reference:

- Tables keep one space of cell padding for readability. The reference uses zero.
- File links hide their `file://` destination. Long absolute URLs beside every path would dominate the prose.
- Autolinks whose label equals the destination do not repeat it.
- File existence uses the filesystem instead of a project index. Directories also resolve.
- Trailing periods after a bare path are not part of the candidate.
- Deleted text keeps a strikethrough attribute together with the dim color.
- Long user messages do not fold. Pi offers no expand affordance for message bodies.
- Mermaid conversion, the timed text reveal, and Southeast Asian word segmentation are not implemented.
- Inline LaTeX supports `$$...$$` and `\(...\)`. Single-dollar math is not tokenized.
- The streaming flag applies to every assistant body while the agent runs. Earlier bodies in the same turn gain file links when the turn ends.

Verification: `bun run check` and `bun run test` pass. Tests cover the real `UserMessageComponent` and `AssistantMessageComponent` with the HUD patch applied.
No live terminal click test ran.

## Main conclusions

1. Empryo uses different body renderers for user and assistant messages. Pi uses Markdown for both.
2. Empryo recognizes indexed project files and converts them into links. HUD does not implement this recognition.
3. Pi hides a Markdown link destination when OSC 8 is available. Empryo's inline renderer retains the destination.
4. HUD's default body color overrides the link-label foreground through nested ANSI sequences.
5. HUD combines fixed body colors with the active Pi theme's Markdown colors. This is not a complete Empryo prose theme.
6. Matching Empryo requires rendering behavior changes, not just a different `mdLink` color.

## Render paths

### Empryo user

`uPA -> l_K -> w6q -> gUK -> text/span/a`

References in the Empryo bundle:

- `uPA`: lines 363194-363213.
- Long-message projection, `l_K`: lines 363019-363029.
- Plain-text link renderer, `w6q`: lines 362188-362224.
- URL and file segmentation: lines 360302-360422.

The ordinary user message remains literal text.
Asterisks, backticks, heading markers, and Markdown link punctuation do not undergo Markdown rendering.
Recognized URL and file segments become anchors with `info` foreground and underline.
The visible segment retains its original spelling.

Messages longer than ten source lines collapse to four opening lines and four closing lines.
A hidden-line count separates those sections.
Expanded mode displays the full message.
Special steering, review, and plan messages use separate compact presentations.

### Empryo assistant

`b6q -> H1 -> OpenTUI MarkdownRenderable (eWE) -> CodeRenderable (Kx)`

`H1`, at lines 360581-360586, performs these display transformations:

1. Normalize text with a streaming-specific or settled function.
2. Remove assistant system-reminder sections and normalize excessive blank lines.
3. Add word boundaries for selected Southeast Asian scripts outside protected regions.
4. Convert supported Mermaid diagrams into terminal text diagrams.
5. During streaming, repair incomplete Markdown constructs.
6. After streaming, convert recognized project paths into Markdown links.
7. Render concealed Markdown with Tree-sitter highlighting and custom code/table presentation.

### Pi and HUD

Native component sources:

- `packages/hud/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/user-message.js`
- `packages/hud/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/assistant-message.js`
- `packages/hud/node_modules/@earendil-works/pi-tui/dist/components/markdown.js`

Both user and assistant bodies use `Markdown` from Pi TUI.
The user renderer preserves list markers and backslash escapes, but still interprets Markdown.
The assistant renderer trims text blocks and constructs Markdown components during content updates.

HUD changes framing and default text color through `packages/hud/src/speaker-spacing.ts:102-110`.
It removes the user background, normalizes empty boundary lines, and applies a three-column body indent.
It does not replace the native Markdown parser or link renderer.
Its Markdown transformer only hides thinking text in `packages/hud/src/index.ts:208-211`.

## Links and files

### Destination visibility

For this source:

```text
[Docs](https://example.com/docs)
```

Pi emits these visible forms:

| Terminal capability | Visible text                      | Click target               |
| ------------------- | --------------------------------- | -------------------------- |
| OSC 8 enabled       | `Docs`                            | `https://example.com/docs` |
| OSC 8 disabled      | `Docs (https://example.com/docs)` | No OSC 8 anchor            |

The native rule also avoids repeating a destination when the label already equals the URL.
It treats matching `mailto:` labels similarly.
The `PI_HYPERLINKS` override and terminal detection control this branch.

Empryo's concealed inline link branch emits the label followed by ` (destination)`.
It attaches link metadata to the label and destination chunks.
This branch does not condition destination visibility on terminal hyperlink capabilities.
Unlike Pi's fallback, this branch does not deduplicate equal labels and destinations.

Evidence: Empryo lines 338663-338674, Pi `markdown.js:540-565`.
Empryo's settled paragraph path also uses Tree-sitter chunks and `sCj` link detection at lines 321195-321224.
Tables also use the explicit inline link branch, at lines 338952-338964.
Settled prose honors concealment metadata from Markdown highlight queries, which were not found in the examined reference repository.
Its exact destination visibility and punctuation remain unverified without those queries or an actual frame.
Do not treat the initial inline branch alone as proof of every final paragraph's appearance.

### Confirmed HUD foreground defect

The native assistant renderer applies `mdLink` directly to a link label.
HUD inserts `defaultTextStyle.color` inside that styled label.
The inner foreground wins in a terminal.

The executable dark-theme probe produced this effective sequence:

```text
Native assistant:
FG(mdLink) UNDERLINE Docs

Assistant with HUD:
FG(mdLink) UNDERLINE FG(hudTextPrimary) Docs
```

The HUD primary color is `#e8e4f2`.
Changing `mdLink` alone cannot fix this ordering.
The destination suffix still uses `mdLinkUrl` when Pi displays it.
Inline code retains `mdCode` because its renderer does not apply the default text style first.

The native user component has the same ordering when `userMessageText` supplies a foreground.
HUD forces a foreground even when the selected theme leaves that token at the terminal default.

Evidence:

- `packages/hud/src/speaker-spacing.ts:62-67` and `102-110`.
- Pi `markdown.js:503-565`.
- Real `UserMessageComponent` and `AssistantMessageComponent` probes with `sweepSpeakerSpacing`.

### Automatic project-file links

Empryo recognizes candidate paths and optional `:line:column` suffixes.
It excludes URL spans from file matching.
It normalizes candidates against the project directory and checks the project index asynchronously.
Only a successful index lookup produces an automatic file link.
A missing or unready index does not immediately create a link.

The assistant conversion handles bare paths and single-backtick spans containing one complete path.
It skips complete fenced code blocks.
The conversion runs after streaming, not on every incoming token.
The user renderer performs segmentation without interpreting Markdown.

The generated target uses `file://` plus the encoded project path.
Line and column remain visible in the label, but the active target builder does not include them.
Therefore, Empryo's visible `:42:7` does not prove that clicking opens that exact location.

Evidence:

- Candidate detection and conversion: Empryo lines 360302-360383.
- Async index lookup and target builder: lines 360423-360493.
- Assistant pipeline: line 360584.

Pi's prose renderer does not recognize bare file paths or paths inside backticks as file links.
An explicit Markdown link passes its destination directly to OSC 8.
For example, `[file](src/index.ts)` targets the relative string `src/index.ts`, not a normalized absolute `file://` URL.
Pi's image fallback has a separate absolute-file linking helper. That helper does not apply to ordinary prose.

### Recognition boundaries

| Input                  | Empryo                                            | Pi/HUD                                |
| ---------------------- | ------------------------------------------------- | ------------------------------------- |
| `https://example.com`  | User URL anchor; assistant Markdown handling      | Markdown autolink                     |
| `www.example.com`      | User target gains `https://`                      | Marked autolink rules                 |
| `github.com/org/repo`  | Explicitly recognized by user URL matcher         | No Empryo-specific matcher            |
| `src/index.ts`         | Link if the project index recognizes it           | Plain text                            |
| `` `src/index.ts` ``   | Settled assistant can link the code span          | Colored code, not an automatic link   |
| `src/index.ts:42:7`    | Visible suffix retained; target omits location    | Plain text unless explicitly linked   |
| `[file](src/index.ts)` | User keeps literal Markdown syntax                | Markdown label and direct destination |
| `@packages/hud/`       | No general Pi-style mention resolver in this path | Plain prose after submission          |

Do not generalize Empryo's matcher to arbitrary paths.
Its regex uses restricted path characters and does not establish support for spaces, all Unicode names, or directory mentions.

## Rendering difference matrix

| Area                      | Empryo                                                                      | Current Pi/HUD                                                             |
| ------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| User body                 | Literal text with recognized anchors                                        | Markdown with preserved list markers and escapes                           |
| Long user messages        | More than ten lines collapse to 4 + 4                                       | No equivalent body folding in the inspected component                      |
| User link styling         | `info` plus underline                                                       | `mdLink` plus underline, with HUD foreground override                      |
| Assistant link label      | `brandAlt`; inline-code labels use `brand`                                  | `mdLink`, effectively overridden by HUD body color                         |
| Link destination          | Separate dim destination in inline branch                                   | Hidden with OSC 8; dim suffix without OSC 8                                |
| Automatic file links      | Async project-index validation                                              | Not implemented in prose                                                   |
| Body palette              | Active Empryo theme tokens                                                  | Fixed `hudTextPrimary` combined with active Pi Markdown tokens             |
| Bold                      | Primary foreground and bold                                                 | Bold around inherited content style                                        |
| Italic                    | Secondary foreground and italic                                             | Italic without a separate foreground token                                 |
| Deleted text              | Dim styling in the inspected syntax configuration                           | Actual strikethrough attribute                                             |
| Inline code               | `brand`, with delimiters concealed                                          | `mdCode`, with delimiters removed                                          |
| Headings                  | Primary H1/H2, secondary H3, bold                                           | One `mdHeading`; H1 underlined; H3+ retain `###` markers                   |
| Code blocks               | Custom left border in `brand`, conditional tinted surface, concealed fences | Visible opening/closing fences, two-space code indent                      |
| Code highlighting         | Tree-sitter and bundled grammar assets                                      | `cli-highlight` for supported explicit languages                           |
| Unsupported code language | Renderer/parser fallback                                                    | Uniform `mdCodeBlock`; no automatic language guessing                      |
| Tables                    | Rounded border, faint color, zero cell padding, content width               | Square border, spaces around cells, row separators, width-aware allocation |
| Narrow tables             | OpenTUI table layout                                                        | Raw-Markdown fallback when borders and cells cannot fit                    |
| List markers              | Warning token; separate marker column; explicit checkbox tokens skipped     | Shared `mdListBullet` for bullet and task marker                           |
| Nested lists              | Nested layout components                                                    | Four-space depth increments                                                |
| Quotes                    | Left border and muted italic text                                           | `│ ` border with `mdQuote`, italic                                         |
| Horizontal rules          | Renderer-specific concealed Markdown                                        | `─` capped at 80 columns                                                   |
| Markdown images           | Inline branch creates a linked label                                        | Alt text only in the inspected inline fallback                             |
| Mermaid                   | Flowchart/graph and sequence conversion                                     | Ordinary fenced code; no diagram conversion in this path                   |
| LaTeX                     | No equivalent app-level conversion found in this path                       | Explicit inline and block LaTeX rendering                                  |
| Incomplete Markdown       | Broad streaming repair pass                                                 | Partial closing-fence trimming and pending math handling                   |
| Text reveal               | Adaptive 32 ms reveal timer; constant opacity                               | Incoming text rendered without an equivalent HUD reveal layer              |
| Paragraph updates         | Persistent OpenTUI blocks and Tree-sitter updates                           | New Markdown components on assistant updates; render cache per component   |
| System reminders          | Assistant display removes complete and partial reminder markup              | No corresponding transformation in HUD's assistant-prose hook              |
| Southeast Asian wrapping  | Language-aware segmentation outside code and URLs                           | General ANSI-aware word wrapping                                           |
| User surface              | Theme-based normal/hover surfaces                                           | HUD removes the native background                                          |
| Body geometry             | Layout-based rows with action controls                                      | Three-column indent; user reserves copy/edit chip width                    |

These are source-level behavioral differences, not universal pixel-level conclusions.
Similar features, such as bold, quotes, and wrapping, can still differ in nesting and narrow-width edge cases.

### Additional structural details

Empryo's list renderer normalizes unordered markers to `-` and computes a shared marker width.
Checked and unchecked theme scopes exist, but they do not establish visible checkbox controls in the active list path.
Actual task-list appearance remains a frame-test requirement.
Evidence: lines 338724-338821.

Empryo's table adapter does not forward parsed Markdown alignment values.
Pi's inspected table renderer also ignores those alignment values, so this is a shared limitation rather than a parity gap.
A header-only Empryo table falls back to Markdown-source rendering.
Its header cells receive heading styles, and unchanged cells use content-keyed caches.
Evidence: lines 338952-339021.

The decorative Empryo code wrapper applies to top-level code blocks.
Code nested inside lists uses the underlying code renderer directly.
This body path does not add line numbers, a language badge, or a code-specific copy button.
Evidence: lines 338820-338835 and 360567-360578.

Empryo's reveal wrapper uses a backlog-adaptive 32 ms interval, not an opacity fade.
Its boundary handling accounts for graphemes, surrogate pairs, ANSI sequences, and nearby punctuation.
Completion immediately exposes the full text.
Evidence: lines 362413-362489.

The incremental Markdown lexer reuses stable prefixes.
During streaming, two trailing tokens remain unstable. No tokens remain unstable after completion.
Compatible top-level blocks update in place, although custom wrapped code blocks can require recreation.
Evidence: lines 333512-333539 and 339092-339225.

Empryo merges overlapping Tree-sitter scopes by specificity rather than nesting foreground escape sequences.
Its assistant syntax theme does not explicitly underline link labels, unlike the user anchor renderer.
Evidence: lines 319879-319986 and 340508-340520.

The bundle also contains HTML-generating renderer methods.
Those methods are not the examined TUI message path and cannot establish its visual behavior.
Evidence: HTML methods at lines 334107-334214, active `markdown: eWE` registration at line 349976.

## Configured color mismatch

The configured `neosh` theme sets:

- `mdLink` and `mdHeading`: `#a5b4fc`.
- `mdLinkUrl`: `#4a4f57`.
- `mdCode`: `#38bdf8`.
- `mdCodeBlockBorder`: `#2a2e37`.

HUD fixes the body at `#e8e4f2` and its brand at `#8069ac`.
Thus, the existing HUD appearance mixes two palettes even before the link override occurs.
Empryo instead derives its prose styles from its active theme through `X2j` at lines 340508-340516.
A theme-only change can align some colors but cannot add file recognition, retained destinations, or literal user rendering.

## Executed probes

Two read-only Bun probes exercised the installed renderer without network requests or model calls.

The first rendered these inputs with hyperlinks both enabled and disabled:

- `[Docs](https://example.com/docs)`.
- `https://example.com/docs`.
- `[file](src/index.ts)`.
- A backtick-wrapped `src/index.ts:42`.
- `@packages/hud/`.
- `![alt](https://example.com/a.png)`.

Observed results:

- Named link destinations disappear with OSC 8 and appear without it.
- Plain URL labels remain visible in both modes.
- Relative file destinations enter OSC 8 unchanged.
- Backtick paths receive code styling without link metadata.
- The directory mention remains plain text.
- The image produces only its alt text.

The second probe used real native user and assistant components.
It rendered each component before and after `sweepSpeakerSpacing` with `FORCE_COLOR=3`.
The ANSI output confirmed the HUD foreground override in both roles.
It also confirmed that OSC 8 metadata remains present after HUD framing.

These probes do not establish mouse-opening behavior in the user's terminal.
Repository checks and tests did not run because this audit changes no implementation.

## Recommended implementation order

### Priority 1: Correct link styling

Preserve semantic inline styles instead of injecting the body foreground inside every nested token.
Add regression tests against real user and assistant components, not only text fixtures.
Cover named links, autolinks, code labels, wrapping, and theme invalidation.

Treat this as a style-composition defect, not an incorrect hex color.

### Priority 2: Separate link visibility from clickability

Support a destination-display policy independently from OSC 8 support.
Retain clickable metadata when the destination also appears beside the label.
Define whether equal label/destination pairs should repeat.
Avoid duplicating long automatic `file://` destinations without an explicit display rule.

### Priority 3: Add safe file recognition

Recognize paths outside protected Markdown regions and existing links.
Resolve targets against the owning session's project directory.
Cache successful and unsuccessful lookups without synchronous filesystem work during rendering.
Preserve the original message in history, model context, copy operations, and export.
Define explicit behavior for line and column targets, spaces, Unicode, symlinks, and missing files.

Do not copy the reference's location-suffix omission as a requirement.

### Priority 4: Decide user-message semantics

Exact Empryo parity requires literal user text with inline URL/file recognition.
That changes existing Pi behavior for pasted Markdown, lists, headings, and backticks.
Treat this as a product decision rather than an incidental consequence of fixing links.

### Priority 5: Align the rest of the prose renderer

Align code-block presentation, heading hierarchy, tables, task markers, and theme ownership.
Keep Mermaid conversion and broad streaming repair separate from the initial link change.
Retain Pi's LaTeX support unless a separate requirement removes it.

## Remaining verification

- Recover the loaded Empryo Markdown highlight queries to resolve settled-prose destination concealment.
- Render identical finalized and streaming fixtures through the actual Empryo parser assets and Pi/HUD.
- Capture OSC 8 output and test clicks in the intended terminal.
- Compare screenshots at narrow and wide widths, including long destinations and wrapped inline code.
- Verify copying, selection, transcript search, and export against unchanged source text.
- Verify delayed file-index readiness. Empryo's user memoization does not visibly depend on the cache version.
- Verify existing Markdown links with file-like labels before reusing Empryo's regex-based conversion.
- Verify light themes and terminals without truecolor or hyperlink support.

This inventory supports a scoped implementation plan.
It does not establish that every reference behavior is desirable or that every untested edge case matches the source-level prediction.
