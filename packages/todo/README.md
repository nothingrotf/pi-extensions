# @nothingrotf/todo

A complete `todo_write` and `todo_read` lifecycle for Pi sessions.

## Capabilities

- It registers `todo_write` with detailed task lifecycle instructions.
- It registers `todo_read` with status and ID filters.
- It supports replacement, merge, status updates, cancellation, dependencies, and clear.
- It returns complete state, readiness, transition, and reminder metadata.
- It stores complete todo snapshots on the active Pi session branch.
- It restores the correct list after resume, fork, or branch navigation.
- It renders grouped statuses, progress headers, icons, colors, and strike-through text.
- It displays a persistent tree above the editor.
- It hides completed tree rows after one agent run.
- It publishes update and turn-start events for other extensions.

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

The tree uses this layout above the editor:

```text
● Todos (1/3)
├─ ✓ #inspect Inspect code
├─ ◐ #implement Implement change
└─ ○ #verify Verify behavior ⛓ #implement
```

The tree displays at most 12 rows. It retains active rows before completed rows when space is limited.

Completed rows remain visible for one agent run. The next agent run hides those rows from the tree.

The state remains available through `todo_read` after the tree hides a completed row.

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

## Reminder metadata

The details object supports periodic and post-edit reminder metadata.

The extension records disabled reminder metadata until a workflow supplies explicit nudge text and activation policy.

The pstack adapter owns strict workflow gates and completion policy.
