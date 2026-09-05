# @nothingrotf/compact

Replace Pi's default summarizer with bounded, source-linked structured compaction.
The default mode makes no model calls and retains Pi's native context boundary.
Optional hybrid mode adds source-linked model interpretations.

## Install

Install the local package from this repository:

```sh
pi install /absolute/path/to/pi-extensions/packages/compact
```

Run `/reload` after installation.
The package handles `/compact`, automatic threshold compaction, and overflow compaction through `session_before_compact`.
It does not register another `/compact` command.

Use only one default compaction provider.
If pi-vcc remains installed for its recall tool, set `overrideDefaultCompaction` to `false` in `~/.pi/agent/pi-vcc-config.json`.
Use `/compact`, not `/pi-vcc`, with this package.

The repository's `pi:install` and `pi:profile` commands discover this workspace automatically.

## Behavior

The compiler preserves these categories:

- User requests as quoted excerpts.
- The latest successful `todo_write` plan snapshot.
- File operations with successful matching tool results.
- Tool results and historical failures.
- Assistant statements, explicitly separated from independent evidence.
- Custom messages, branch summaries, and imported compaction summaries.

Every excerpt carries a stable session entry ID.
The compiler excludes the retained tail from its state and includes split-turn prefixes in the summarized span.

The summary has a maximum of 16,000 characters.
For smaller inputs, its budget targets 60% of the estimated source characters, with a 1,000-character minimum.
These are character budgets, not tokenizer guarantees.

Structured state persists in the native compaction entry's `details`.
Subsequent compactions merge new excerpts into that checkpoint instead of nesting summary text.
The state keeps at most 152 excerpts, each with at most 900 characters.
The summary reports omitted excerpts and points to recall.

| Category             | Maximum entries |
| -------------------- | --------------: |
| User requests        |              20 |
| File operations      |              32 |
| Tool results         |              24 |
| Historical failures  |              16 |
| Plan items           |              32 |
| Assistant statements |              20 |
| Other context        |               8 |

The request window preserves the first request and the latest 19 requests.
Later messages take precedence over historical excerpts.
The compiler does not infer that a historical failure remains unresolved.

## Optional semantic enrichment

Open the native settings menu with `/compact-mode`, using the same selector style as `/hud`.
The menu marks the current mode and describes inference cost and privacy implications.
Use the arrow keys and Enter to select a mode, or Escape to leave it unchanged.
Direct arguments remain available for scripts and noninteractive sessions:

```text
/compact-mode
/compact-mode hybrid
/compact-mode deterministic
```

Run `/compact` after changing the mode.
Mode changes persist in the active session lineage and follow native branching and restoration.
Alternatively, launch Pi with `--compact-llm` to set the initial mode to hybrid.
A recorded session mode takes precedence over the launch flag.

Hybrid mode sends bounded session evidence to the active model through Pi's authenticated model registry.
It does not choose another provider or export files to an external memory service.
The default remains deterministic.

The model returns a JSON patch containing these categories:

- Decisions and hypotheses.
- User constraints.
- Issues and their resolution status.
- Next steps.

Each item has a stable semantic ID, a status, and one or two exact source quotes.
The validator rejects unknown sources, fabricated quotes, duplicate IDs, invalid replacement references, and invalid response shapes.
Updates require fresh evidence, and explicit replacement links mark earlier items as superseded.
Citation checks establish provenance, not semantic truth or authorization.
Model interpretations remain separate from deterministic excerpts.

The compiler retains at most 32 semantic items and reports omissions.
Each patch contains at most 16 updates.
New evidence follows the last successful semantic checkpoint, including evidence missed during intervening fallback compactions.
Inherited citations must still match the active lineage.
On first activation, source selection considers the branch history before the retained boundary.

Each source excerpt has at most 5,000 characters.
Selected serialized sources occupy at most 32,000 characters, prioritizing the first user message and recent evidence.
The complete serialized request must fit within 64,000 characters.
Requests omit assistant thinking, image payloads, and shell commands excluded from context.
These limits do not guarantee exact token counts.

The request uses the active model's output limit, capped at 4,096 tokens, with a 45-second deadline.
There is no extension-level retry.
Timeouts, provider failures, and invalid responses preserve the deterministic summary.
Explicit user cancellation cancels the entire compaction instead of committing a fallback.

A successful patch can use up to 35% of the existing summary budget, capped at 5,000 characters.
It does not increase the total summary limit or modify the retained tail.
Fallback summaries omit potentially stale interpretations but retain the last semantic checkpoint for subsequent reconciliation.

Compaction details include enrichment outcome, latency, request size, and omitted source count.
Pi records returned model usage, including completed responses rejected by validation.
Interrupted requests might incur provider usage that the extension cannot report.

## Native Pi responsibilities

Pi still owns:

- Trigger thresholds and automatic compaction settings.
- Retained context size and safe tool-call boundaries.
- Session persistence and context reconstruction.
- Abort controls, progress display, and completion notifications.
- Overflow retry and continuation scheduling.

The package does not change global token thresholds or prune retained tool results.
Pi can require a selected model and valid authentication before emitting the compaction hook.
Deterministic mode does not request inference from that model.

Configure the native settings as usual:

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

`/compact instructions` preserves the supplied focus and boosts excerpts that contain the exact focus text.
It does not interpret arbitrary instructions through an LLM.

## Recall

`compact_recall` reads the current session's retained entry log through `SessionManager`.
It works with persistent and in-memory sessions, including messages omitted from the active context.
It does not open unrelated session files or export history to external services.

Search with Unicode-aware, case-insensitive keywords:

```json
{ "query": "transaction isolation" }
```

Search returns five excerpts per page, ranked by matched keyword count and recency.
Keywords use OR matching. Regex is not supported.

Expand a stable entry ID returned by the summary or search:

```json
{ "entryId": "ID_FROM_RESULT", "offset": 0, "limit": 4000 }
```

Expansion returns up to 8,000 characters and identifies the next character offset.
Read subsequent slices to recover longer text.

The default scope is the active lineage.
Explicitly include other branches of the same session when needed:

```json
{ "query": "alternative approach", "allBranches": true, "page": 1 }
```

Images appear as metadata, not reconstructed image content.
Assistant thinking remains available through recall but does not enter the compacted assistant excerpts.
Commands explicitly excluded from context remain excluded from recall.

## Safety and limitations

Compilation builds a candidate without modifying the session or clearing existing state.
Aborts, invalid boundaries, concurrent session changes, and non-reducing summaries cancel the operation.
Failures do not silently invoke the default LLM summarizer.
Pi performs the final persistence after the hook returns.

This implementation extracts state at compaction boundaries, not after every streaming event.
It incrementally merges persisted structured checkpoints across compactions.
Its optional LLM patch stage is not a complete Empryo V2 implementation.
It does not implement external memory export or a custom status UI.

Extraction is lossy and tool-specific.
Recognized file tools include `read`, `grep`, `find`, `ls`, `edit`, `write`, and several compatible aliases.
Shell redirects and embedded patch paths do not become confirmed file records automatically.
Unrecognized tool outputs remain available as result excerpts and through recall.
A successful tool result records reported success, not independent verification of the current filesystem.

File excerpts describe the latest recorded operation per path and operation category.
Plan items beyond the category limit remain available through their source entry.
Imported summaries from other compactors have a 6,400-character excerpt limit.
The package does not replace `/tree` branch summarization.

Use the current Pi lifecycle APIs. Integration tests target the workspace's catalog version.
The compiler preserves the `firstKeptEntryId` checkpoint contract supplied by the host.

## Development

From the repository root:

```sh
bun install
bunx vp test run packages/compact/test
bun run check
bun run test
```

The tests cover native manual and automatic compaction, overflow retry, cancellation, persistence, repeated checkpoints, lineage isolation, extraction limits, and paginated recall.
Scripted local providers verify default request counts, hybrid usage accounting, and deterministic fallback.
Live evaluation is opt-in and never runs during ordinary repository tests.

## Automatic comparison

Run the synthetic comparison with a configured provider and model:

```sh
COMPACT_EVAL_LIVE=1 \
COMPACT_EVAL_PROVIDER=openai-codex \
COMPACT_EVAL_MODEL=MODEL_ID_FROM_YOUR_CATALOG \
COMPACT_EVAL_REPEATS=1 \
bunx vp test run packages/compact/test/evaluation.live.test.ts
```

When explicit evaluation settings are absent, the runner uses `PI_PROVIDER` and `PI_MODEL`.
It uses existing Pi authentication without printing credentials.
The runner prints the report path and writes each completed trial to a temporary JSON file.
Set `COMPACT_EVAL_OUTPUT` to choose another report path with an existing parent directory.

The corpus contains six synthetic cases and 24 fixed-choice questions with predefined answers.
The runner compares full history, deterministic compaction, and hybrid compaction using identical retained boundaries.
The same model answers all probes, without recall tools or access to the gold answers.
Probe order rotates across cases and repetitions.
Each repetition uses six enrichment requests and 18 probe requests.
Repetitions must range from one to five.

Reports include accuracy, invalid answers, context characters, latency, provider usage, fallback outcomes, and raw synthetic responses.
Probe usage remains separate from compaction usage.
Provider-reported zero cost does not establish free inference.

This small evaluation measures bounded question answering, not autonomous task completion or production reliability.
Shared model biases, choice guessing, limited context pressure, and synthetic histories restrict generalization.
The full-history control can also answer incorrectly.
The runner never enables hybrid mode automatically, even when its score improves.
