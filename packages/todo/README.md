# @nothingrotf/todo

A complete `todo_write` and `todo_read` lifecycle for Pi sessions.

## Capabilities

- It registers `todo_write` with detailed task lifecycle instructions.
- It registers `todo_read` with status and ID filters.
- It supports replacement, merge, status updates, cancellation, blocking, dependencies, and clear.
- It auto-promotes the first ready `pending` task to `in_progress` and keeps one task in progress.
- It rejects duplicate ids, blank content, unknown dependencies, and dependency cycles. The list stays unchanged.
- It registers `/todo` for the user: show, edit, export, import, append, start, done, drop, block, unblock, rm, eager.
- It records user edits on the session branch and tells the model that the user changed the list.
- It can inject an eager planning prelude on the first prompt of a session.
- It returns complete state, readiness, transition, and reminder metadata.
- It stores complete todo snapshots on the active Pi session branch.
- It restores the correct list after resume, fork, or branch navigation.
- It renders an Empryo-style task panel above the editor.
- It displays a responsive frame, a progress title, state icons, and a six-row task window.
- It hides completed panel rows after one agent run.
- It publishes update, turn-start, and reminder events for other extensions.
- It reminds the agent after a settled run with actionable todos, at most three times per user message.
- It nudges the agent after twelve successful file edits or writes without a successful todo update.

## Install

```sh
pi install npm:@nothingrotf/todo
```

Restart Pi after installation.

## todo_write

`merge: false` replaces the complete list.

```json
{
  "merge": false,
  "todos": [
    { "id": "1", "content": "Inspect", "status": "in_progress" },
    {
      "id": "2",
      "content": "Implement",
      "status": "pending",
      "dependencies": ["1"]
    }
  ]
}
```

`merge: true` updates or adds items by `id`. Unmentioned items remain unchanged.

Clear the list with an empty replacement.

```json
{
  "merge": false,
  "todos": []
}
```

The supported status values are:

- `pending`
- `in_progress`
- `completed`
- `cancelled`
- `blocked`

A `blocked` todo waits on external input. Add a short `blocker` note. The extension keeps the note only while the status is `blocked`. Blocked todos count as open but never trigger a stop reminder.

Write result details contain these fields:

- `todos`
- `totalCount`
- `wasMerge`
- `success`
- `readyTaskIds`
- `needsInProgressTodos`
- `initialTodos`
- `finalTodos`
- `attachments`

The attachment object contains state snapshots, nudge messages, a reminder flag, and a reminder type.

## State rules

After each successful `todo_write` call:

- If no task is `in_progress`, the earliest `pending` task with completed dependencies becomes `in_progress`.
- If several tasks are `in_progress`, only the earliest stays. The others return to `pending`.
- `blocked` tasks never auto-promote.

The result text lists the remaining items, the closed counts, and the blocked items.

Validation checks the complete dependency graph after the proposed merge or replacement. It rejects self-dependencies, unknown dependencies, and cycles.

Validation errors throw an exception. Pi records `isError: true`, and the list stays unchanged. Rejected calls do not reset the nudge counter.

A validation error contains the current list:

```text
Errors: Duplicate id "x" in todos
Remaining items (1):
  - Inspect [in_progress] (id: 1)
Closed: 0 completed, 0 cancelled. Blocked: 0.
```

## todo_read

Read the complete list with empty filters.

```json
{}
```

Filter by status, ID, or both.

```json
{
  "statusFilter": ["pending", "in_progress"],
  "idFilter": ["1", "2"]
}
```

## Persistent task panel

The widget renders an Empryo-style task panel above the editor:

```text
    ╭─  Tasks 1/3 ▾ ─────────────────╮
    │  +1 done                        │
    │  ⠋ Implement change             │
    │  ○ Verify behavior              │
    ╰─────────────────────────────────╯
```

The responsive side inset uses one to four columns. The panel uses a rounded border and a title chip.

Rows use these states:

- Completed tasks enter the success summary.
- Tasks in progress use a spinner and bold text only during agent execution.
- Idle sessions show a static circle without a timer. Task status stays unchanged.
- Pending tasks use a muted circle.
- Blocked tasks use an error cross.

Active tasks appear first. Pending and blocked tasks retain source order.

The panel shows at most six task rows. An additional row reports the hidden task count.

Closed rows remain visible for one agent run. The next agent run hides those rows from an open panel.

An all-settled panel remains visible for three seconds.

The widget registers once at session start. It renders nothing while the list is empty.

The state remains available through `todo_read` after the panel hides a completed row.

## /todo command

```text
/todo                     show the list as Markdown
/todo edit                edit the list in the editor
/todo export [path]       write the list as Markdown (default TODO.md)
/todo import [path]       replace the list from a Markdown file
/todo append <text>       add a pending task
/todo start <id|text>     mark a task in progress
/todo done <id|text>      mark a task completed
/todo drop <id|text>      mark a task cancelled
/todo block <id|text> [: reason]
/todo unblock <id|text>   set a blocked task back to pending
/todo rm [id|text]        remove one task, or clear the list
/todo eager <off|preferred|always>
```

A task reference matches an id first, then a case-insensitive substring of the content. When several tasks match, the command picks the single open match or reports the ambiguity.

Each user edit appends a `pi-todo-user-edit` entry to the session branch and queues a hidden `todo-user-edit` message for the model. The message states that the user changed the list and, after a removal, that the model must not re-add the removed items.

## Markdown format

```markdown
# Todos

- [x] #inspect Inspect code
- [/] #impl Implement change <!-- deps: inspect -->
- [!] #ops Ask ops <!-- blocker: approval -->
- [-] #skip Skip it
- [ ] #verify Verify behavior <!-- deps: impl -->
```

Markers: `[ ]` pending, `[/]` in progress, `[x]` completed, `[-]` cancelled, `[!]` blocked. A line without `#id` receives an id derived from its text.

## Eager prelude

The extension can inject a hidden planning reminder on the first user prompt. The list must be empty, and the prompt must not end with `?` or `!`.

The `preferred` mode suggests a list. The `always` mode requires a list. The `off` mode disables only this prelude, not stop reminders or mid-run nudges.

The mode persists on the session branch. The default is `preferred`. Extension-generated prompts do not receive the eager prelude.

## Events

The extension publishes `todo_update` after each successful `todo_write` call.

```json
{
  "toolCallId": "call-id",
  "todos": [{ "id": "1", "content": "Inspect", "status": "in_progress" }],
  "merge": false
}
```

A clear operation publishes the same event with an empty `todos` array.

The extension publishes `todo_turn_start_ids` when an agent run starts.

```json
{
  "todoIds": ["1", "2"]
}
```

## Stop reminder

The extension captures the last assistant response at `agent_end`. It evaluates the response at `agent_settled`, after automatic retries and queued continuations finish.

An eligible stop produces a visible `todo-reminder` message and a new agent run. The extension awaits this continuation before the original prompt returns.

Each accepted user message resets the reminder cycle at `message_start`. This includes queued user messages. Custom reminder continuations do not reset the cycle or emit `before_agent_start`.

The reminder does not fire when:

- one of the last 12 non-empty prose lines is a question or a recognized response request
- the last assistant response is empty, contains tool calls, or has a stop reason other than `stop`
- a previous reminder still waits for progress
- three reminders already fired for the current user message
- no actionable tasks remain
- `todo_write` is inactive
- another run is active or user messages remain queued

The detector uses Markdown structure and ignores quoted examples, code, tables, images, and HTML. It handles multiline quotes, multiline code spans, emphasis, headings, and questions regardless of ASCII characters.

Response requests without a question mark support English and Portuguese. These rules are conservative heuristics, not a semantic check of user intent.

Actionable tasks include pending and active tasks whose dependency chains can complete without external input. Blocked, cancelled, missing, and cyclic dependencies exclude dependent tasks from reminders.

Progress means a successful `edit` or `write`, or resolution of a previously open task. Resolution includes completion, cancellation, removal, or an explicit blocked status.

Read-only tools, shell calls, failed tools, label changes, and no-op todo updates do not count as progress. Status changes alone do not prove that work finished.

The extension publishes `todo_reminder` before each reminder.

```json
{
  "todos": [{ "id": "1", "content": "Inspect", "status": "pending" }],
  "attempt": 1,
  "maxAttempts": 3
}
```

## Mid-run nudge

The extension counts successful `edit` and `write` calls at `tool_execution_end`. It checks the threshold after the full tool batch at `turn_end`.

After twelve calls without a successful todo update, it queues a hidden `todo-mid-run-nudge` as steering input. The next model request in the current run receives the nudge.

At most two nudges fire per user message. A successful `todo_write` or manual todo edit resets the call counter, but not the two-nudge limit.

Shell calls do not count because their results do not establish whether files changed. Failed calls do not count or reset the counter.

## Reminder metadata

The details object records reminder metadata fields for compatibility. The stop reminder and the mid-run nudge do not read these fields.

The `shouldShowTodoWriteReminder` and `todoReminderType` fields do not enable, disable, or schedule reminders.

## Tests

The integration tests use real `AgentSession` instances with a local scripted provider. They check lifecycle events, model context, error results, and continuation limits without external requests.
