# Session history

`@nothingrotf/session-history` adds the `session_history` tool to Pi.

The tool reads native Pi session files through `SessionManager`. It limits every request to the current project.

The tool hides physical session paths. Each session and entry receives a stable `pi-session://` reference.

## Actions

The tool supports these actions:

- `list` returns visible sessions.
- `search` finds deterministic text matches.
- `read` returns entries from an active branch or the full audit history.
- `timeline` returns compact session events.
- `tool_activity` pairs tool calls with recorded results.

All responses identify the action. All responses include limits, pagination data, truncation status, redaction status, and skipped session counts.

## Scope

The default scope is the current project directory. The tool resolves symbolic links before the scope comparison.

The tool excludes the current session and child sessions by default. Set the applicable include fields to `true` when required.

Child results identify the direct parent and the root session. A missing parent remains `null` and does not stop the request.

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

Search indexes the full normalized content. Returned entries and result snippets remain bounded.

## Audit behavior

The `active` view uses the entries from `buildContextEntries()`. It follows the active branch and applies native compaction behavior.

The `audit` view uses `getEntries()`. It marks each entry outside the active branch as `abandoned`.

Tool status comes only from a recorded tool result. The status is `completed`, `failed`, `missing_result`, or `unknown`.

## Data limits

Each action limits its item count. Normalized content uses a 2,000-character item limit.

Timeline and tool activity summaries use shorter content. The tool rejects any final response above 200,000 characters.

Pi 0.84.4 does not expose a separate tool response limit. This package applies its own limit before it returns content.

Known sensitive field names receive `[REDACTED]` before output. The field set includes `authorization`, `cookie`, `password`, `secret`, and `token`.

Free text can contain other sensitive data. The tool does not claim full secret detection.

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
