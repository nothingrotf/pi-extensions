# Session history

`@nothingrotf/session-history` adds the `session_history` tool to Pi.

The tool streams session metadata and validates snapshots with native Pi parsing and context helpers. Every request stays within the current project.

The tool hides physical session paths. Each session and entry receives a stable `pi-session://` reference.

## Actions

The tool supports these actions:

- `list` returns visible sessions.
- `search` finds deterministic text matches.
- `read` returns entries from an active branch or the full audit history.
- `timeline` returns compact session events.
- `tool_activity` pairs tool calls with recorded results.
- `content` returns a character window within one normalized message or tool payload.

Successful responses identify the action and include limits, pagination data, truncation status, redaction status, and skipped session counts.

Failures throw JSON error messages that preserve the action and error code. Pi records these executions as errors instead of successful tool results.

## Scope

The default scope is the current project directory. The tool resolves symbolic links before the scope comparison.

The tool excludes the current session and child sessions by default. Set the applicable include fields to `true` when required.

Child results identify the direct parent and the root session. A missing parent remains `null` and does not stop the request.

Discovery quarantines circular ancestry, duplicate session IDs, and their descendants. Healthy sessions remain available, and `skippedSessions` reports omitted records.

Direct requests for quarantined sessions return `MALFORMED_SESSION`. Discovery reevaluates quarantine on every request, so repaired relationships recover automatically.

Files that disappear or fail metadata inspection are skipped independently. The current session remains readable from live state if its backing file disappears.

The tool rejects a session identifier that is not visible in the current project. It never accepts an arbitrary project directory.

## References

A session reference uses this format:

```text
pi-session://<session-id>
```

An entry reference uses this format:

```text
pi-session://<session-id>/<entry-id>
```

Pass the session identifier and entry identifier to the `read` action for more context.

## Search behavior

Search uses case-insensitive text comparison. It does not use embeddings or external services.

Exact phrases rank above separate terms. Session name matches add a fixed score. Dates and identifiers resolve score ties.

Search includes user text, assistant text, persisted thought, tool calls, tool results, compaction summaries, branch summaries, and custom context messages.

Search indexes the full normalized content within the work limits. Returned entries and result snippets remain bounded.

Queries support up to 512 characters and 64 whitespace-separated terms. Search remains lexical and does not translate or infer paraphrases.

## Audit behavior

The `active` view uses the entries from `buildContextEntries()`. It follows the active branch and applies native compaction behavior.

The `audit` view includes every native entry. It marks each entry outside the active branch as `abandoned`.

Persisted snapshots support session versions 2 and 3. Version 2 migration occurs only in memory.

Version 1 and future versions return `UNSUPPORTED_SESSION_VERSION`. Version 1 lacks stable native entry identifiers.

Malformed JSONL lines, duplicate entry IDs, invalid timestamps, cycles, and missing entry parents reject the snapshot. History reads never migrate files on disk.

Tool status comes only from a recorded tool result. The status is `completed`, `failed`, `missing_result`, or `unknown`.

Pairing requires matching tool names and call IDs within the call's descendant branch. Reused IDs resolve to the nearest ancestor call.

Multiple results for one call produce `unknown`, without a selected result reference. Inspect the audit view to resolve conflicting evidence.

Native `bashExecution` messages appear in search, read, and timeline as `bash_execution`. Their recorded exit codes do not create synthetic tool results.

Native custom messages and message-form branch and compaction summaries preserve their original roles and references.

## Read pagination

`read` accepts a continuation `cursor`. Preserve the original filters, anchor, direction, and payload option when requesting the next page.

A native assistant entry can contain several normalized blocks. Cursor pagination visits every block, even when several blocks share one native reference.

`before` excludes the anchor. `after` starts after every block of the anchor entry.

History changes invalidate cursors. Current-session branch navigation also invalidates cursors, even without appended entries.

## Content pagination

Existing actions retain their limits and behavior. `read` also exposes a zero-based `blockIndex` for each normalized entry.

Use `content` with `session_id`, `entry_id`, and the corresponding `block_index` to retrieve long content without the preview limit.
The default block index is zero. Each content response reports `blockCount` for the native entry.

```json
{
  "action": "content",
  "session_id": "session-id",
  "entry_id": "entry-id",
  "block_index": 0,
  "limit": 2000,
  "include_tool_payloads": true
}
```

`limit` defaults to 2,000 and supports 1 through 16,000 UTF-16 code units. Windows use exact string slices without ellipses.
Offsets count UTF-16 code units, not bytes or Unicode code points. A boundary can split a surrogate pair.

Use `pagination.cursor` for the next window or `pagination.previousCursor` for the previous window.
Pass either value as `cursor`, with the original session, entry, block, limit, view, and payload options.
Both cursor fields become `null` at their respective boundaries.

Alternatively, pass a zero-based `offset` to select a window directly. Do not combine `offset` with `cursor`.
`pagination.offset`, `end`, and `total` describe the returned half-open range and normalized content length.

Each window retains the native `reference` and adds a stable `chunkReference`:

```text
pi-session://<session-id>/<entry-id>#block=<index>&version=<content-hash>&range=<start>:<end>
```

The hash identifies the normalized content revision. Identical ranges retain their references across cache eviction, store recreation, and unrelated session appends.
Content changes invalidate content cursors and change chunk references. References do not retain historical revisions after source rewrites.

The default `active` view still enforces native branch and compaction visibility. Use `view: "audit"` for entries outside active context.
Tool payloads remain omitted unless `include_tool_payloads` is `true`. Structured redaction occurs before slicing.

`sourceTruncated` reports preexisting normalization or source truncation. `payloadOmitted` distinguishes hidden payloads from paginated text.
Pagination cannot recover source text that Pi never recorded or structured fields omitted by normalization limits.

## Reusable API

Import `SessionHistoryStore` independently of tool registration. `readContent()` returns a typed `ContentResponse` with the same scope, validation, redaction, and cancellation controls.

```typescript
import { SessionHistoryStore } from '@nothingrotf/session-history'

const history = new SessionHistoryStore(ctx.sessionManager)
const page = await history.readContent(
  { session_id: sessionId, entry_id: entryId, limit: 2000 },
  signal,
)
const chunk = page.data[0]
```

`execute({ action: "content", ...options })` uses the same implementation. The package exports `ContentReadInput`, `ContentResponse`, `ContentChunk`, and `ContentReadSchema`.

The API reads session state without appending entries, changing branches, or rewriting session files.

## Data limits

Each action limits its item count. Normalized content uses a 2,000-character item limit.

Timeline and tool activity summaries use shorter content. The tool rejects any final response above 200,000 characters.

Pi 0.84.4 does not expose a separate tool response limit. This package applies its own limit before it returns content.

Known sensitive field names receive `[REDACTED]` before output. The field set includes authorization, cookies, passwords, tokens, API keys, client secrets, and private keys.

Matching ignores case, underscores, and hyphens. Unrelated fields such as `tokenCount` remain visible.

Free text can contain other sensitive data. The tool does not claim full secret detection.

The LRU cache uses a 16 MiB estimated normalized-storage budget. This estimate is not a hard process-memory limit.

Discovery evicts cached snapshots that disappear or enter quarantine. Store consumers can inspect `cacheDiagnostics()` and release retained snapshots with `clearCache()`.

A separate 2 MiB metadata cache retains names and bounded previews, not complete conversation bodies. Detached preview strings avoid retaining large source strings.

File identity includes device, inode, size, modification time, and change time. Reads validate the opened file and verify the path identity after consumption.

Mutation detected during a directly requested snapshot load returns `SESSION_CHANGED`. Discovery and multi-session actions can instead skip changed candidates.

Retry the request to obtain a fresh snapshot.

I/O uses 64 KiB batches with at most eight concurrent files. Normalization yields between batches of 128 native entries.

Cancellation stops work at these checkpoints. Parsing one JSON line and synchronous ranking remain non-preemptive.

Tool-result pairing yields every 256 traversal operations and checks the request's cancellation signal and elapsed-time budget.
Ancestor indexes keep pairing linear even when calls reuse identifiers. Same-message duplicate identities remain ambiguous.

## Work limits

Successful responses publish work limits under `limits.work`.

| Resource                                       |      Limit |
| ---------------------------------------------- | ---------: |
| Files discovered in one directory              |      1,000 |
| Sessions searched or expanded through children |        100 |
| Bytes per file                                 |     32 MiB |
| Bytes read per request                         |    128 MiB |
| Charged entry visits per request               |    100,000 |
| Cooperative elapsed-time budget                | 10 seconds |

Search, timeline, and tool activity report capped session coverage through `omittedSessions` and `truncated`.

Pairing uses a separate request-wide counter with the same 100,000-entry limit across all selected sessions.

Other exhausted budgets throw `WORK_LIMIT_EXCEEDED` instead of returning apparently complete results. Oversized directories or files can therefore reject a request during discovery.

These budgets do not guarantee a process-memory ceiling. A large JSON line can still allocate substantially more memory than its serialized size.

## Evaluations

Run reproducible evaluations separately to reduce timing interference:

```sh
SESSION_HISTORY_EVAL=1 bun run --cwd packages/session-history test -- test/evals.test.ts
SESSION_HISTORY_EVAL=1 bun run --cwd packages/session-history test -- test/tool-evidence.test.ts
SESSION_HISTORY_EVAL=1 bun run --cwd packages/session-history test -- test/quality.test.ts
SESSION_HISTORY_EVAL=1 bun run --cwd packages/session-history test -- test/cancellation.test.ts
SESSION_HISTORY_HEAP=1 bun run --cwd packages/session-history test -- test/heap.test.ts
```

The retrieval evaluation checks 30 labeled queries against 3,000 entries. The pairing evaluation compares 10,000 calls against the previous linear-scan strategy.

Repeated-ID regressions cover 256, 512, and 1,024 sequential calls, sibling branches, and 1,024 same-message duplicates with 1,024 results.
They also verify cancellation during indexing and ancestry traversal, plus cumulative pairing budgets.

The quality corpus includes eight retrieval labels, 36 structured-secret cases, and 20 ordinary-field controls.

Heap evaluations cover short blocks, large payloads, and previews of large first messages. They use isolated Node processes with explicit garbage collection.

Ordinary test runs skip opt-in heap and cancellation timing measurements.

Timing and heap results are diagnostic, not hardware-independent CI thresholds.

## External skill contract

Use `list` or `search` to discover a session. Preserve the returned reference with any cited fact.

Use `read` to verify the surrounding entries. Use `timeline` for session flow and `tool_activity` for command evidence.

Do not treat assistant statements as execution proof. Use the recorded tool result and its reference.

## Install

Add the package to the Pi configuration:

```json
{
  "packages": ["npm:@nothingrotf/session-history"]
}
```

Pi loads `src/index.ts` through the package manifest during local development.

## Development

Run the package checks:

```sh
bun run --cwd packages/session-history check
bun run --cwd packages/session-history test
```

Run the repository checks before a commit:

```sh
bun run check
bun run test
git diff --check
```
