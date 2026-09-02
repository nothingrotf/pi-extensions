# @nothingrotf/todo

A complete `todo_write` and `todo_read` lifecycle for Pi sessions.

## Capabilities

- It registers `todo_write` with detailed task lifecycle instructions.
- It registers `todo_read` with status and ID filters.
- It supports replacement, merge, status updates, cancellation, blocking, dependencies, and clear.
- It auto-promotes the first ready `pending` task to `in_progress` and keeps one task in progress.
- It rejects a call with duplicate ids, blank content, or unknown dependencies, and keeps the list unchanged.
- It registers `/todo` for the user: show, edit, export, import, append, start, done, drop, block, unblock, rm, eager.
- It records user edits on the session branch and tells the model that the user changed the list.
- It can inject an eager planning prelude on the first prompt of a session.
- It returns complete state, readiness, transition, and reminder metadata.
- It stores complete todo snapshots on the active Pi session branch.
- It restores the correct list after resume, fork, or branch navigation.
- It renders grouped statuses, progress headers, icons, colors, and strike-through text.
- It displays a persistent tree above the editor.
- It hides completed tree rows after one agent run.
- It publishes update, turn-start, and reminder events for other extensions.
- It reminds the agent when a run stops with open todos, at most three times per prompt.
- It nudges the agent after twelve file or shell mutations without a `todo_write` call.

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

The result text lists the remaining items, the closed counts, and the blocked items. Errors reject the whole call:

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

## Persistent tree

The tree uses a flat version of the oh-my-pi HUD layout above the editor:

```text
 TODO · 1/3
  ├─ ☑ Inspect code
  ├─ ☐ Implement change
  └─ ☐ Verify behavior
```

The tree connectors form a progress path. The accent part of the path grows with the closed task count.

Rows use one color per status: success for completed, accent for in progress, dim for pending, warning for blocked, and error for cancelled. Completed and cancelled rows use strikethrough text.

The tree shows the last closed task, then the task in progress, then the next pending tasks. It shows at most 5 open rows and a `… n more todos` summary for the rest.

Closed rows remain visible for one agent run. The next agent run hides those rows from the tree.

The state remains available through `todo_read` after the tree hides a completed row.

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

The extension injects a hidden planning reminder on the first user prompt of a session when no todos exist and the prompt does not end with `?` or `!`. `preferred` suggests the list. `always` tells the model that it must create the list first. `off` disables the prelude. The mode persists on the session branch. Default: `preferred`.

## Events

The extension publishes `todo_update` after each `todo_write` call.

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

When an agent run ends with a text-only assistant message and open todos exist, the extension sends a hidden `todo-reminder` message and triggers a new turn.

The reminder does not fire when:

- the last assistant message ends with a question or a response cue
- the last assistant message called tools, was aborted, or errored
- a previous reminder still waits for progress
- three reminders already fired for the current prompt
- only `blocked` todos remain
- `todo_write` is not an active tool
- other messages are pending

The extension publishes `todo_reminder` before each reminder.

```json
{
  "todos": [{ "id": "1", "content": "Inspect", "status": "pending" }],
  "attempt": 1,
  "maxAttempts": 3
}
```

## Mid-run nudge

After twelve successful `bash`, `edit`, or `write` calls without a `todo_write` call, the extension steers a hidden `todo-mid-run-nudge` message into the current run. At most two nudges fire per prompt. A `todo_write` call resets the count.

## Reminder metadata

The details object records reminder metadata fields for compatibility. The stop reminder and the mid-run nudge do not read these fields.
