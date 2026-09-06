import { Type, type Static } from 'typebox'

import { TodoInputSchema } from './domain.ts'

export const TodoWriteSchema = Type.Object(
  {
    todos: Type.Array(TodoInputSchema, {
      description: 'Array of TODO items to update or create',
    }),
    merge: Type.Boolean({
      description:
        'Whether to merge the todos with the existing todos. If true, listed items update or extend the existing list while unlisted items remain unchanged. Each listed item still requires id, content, and status. If false, the new todos replace the existing list.',
    }),
  },
  { additionalProperties: false },
)

export type TodoWriteInput = Static<typeof TodoWriteSchema>

export const todoWriteDescription = `Write a structured todo list to track progress within a session.

**Tasks: verbatim content strings with a stable \`id\`. Reference existing tasks by their \`id\` from the previous result. Never guess an id from memory: call \`todo_read\` to recover the list.**

After each successful call: if nothing is \`in_progress\`, the earliest \`pending\` task whose dependencies are completed auto-promotes to \`in_progress\`; if several are \`in_progress\`, only the earliest stays. Blocked tasks never auto-promote. Completed tasks never revert by themselves.

## Operations

|\`merge\`|Fields|Effect|
|---|---|---|
|\`false\`|\`todos: [...]\`|Initialize full list; replaces existing|
|\`false\`|\`todos: []\`|Clear the list|
|\`true\`|\`todos: [{id, content, status}]\`|Update or add the listed items by id; unlisted items stay unchanged|

Status values:
- \`pending\`: not started
- \`in_progress\`: current work (one at a time)
- \`completed\`: finished successfully
- \`cancelled\`: no longer needed
- \`blocked\`: waiting on external input (a user decision, another agent, a service). Add a short \`blocker\` note. Blocked items never trigger stop reminders. Set them back to \`pending\` when actionable.

Optional \`dependencies\`: ids that must complete before the task is ready. Unknown ids are an error.

A call with any error is rejected as a whole and the list stays unchanged.

## Anatomy

- Task content: 5-10 words; what, not how; unique.
- Id: short stable token (\`auth-port\`, \`run-tests\`). Never rename an id after creation.

## Rules

- Mark tasks completed immediately after finishing; keep the list in execution order.
- NEVER make a todo call the turn's only tool call. Batch it with real work: create the list with the first reads or edits; each completion with the next action. Solo todo turns waste a round trip.
- Waiting on something you cannot act on: set \`blocked\` with a \`blocker\`. If the blocker is agent-actionable, add an unblocking task instead.
- New instructions arrive mid-task: capture them in the list before proceeding.

## Create a list

- Task requires 3+ distinct steps.
- User explicitly requests one.
- User provides a set of tasks.

<critical>
User gives a multi-step plan (numbered or bulleted checklist, or "N bugs/items/tasks"):
- MUST create every item as its own task before working.
- Enumerate all; NEVER summarize into fewer tasks, sample "the important ones", drop items, or track the rest from memory.
</critical>

## Skip

Single straightforward steps, trivial tasks, purely conversational requests, and tool-call tracking within one turn.

## Examples

Initial setup:
{"merge": false, "todos": [{"id": "scaffold", "content": "Scaffold package", "status": "in_progress"}, {"id": "wire", "content": "Wire workspace", "status": "pending", "dependencies": ["scaffold"]}, {"id": "tests", "content": "Run test suite", "status": "pending", "dependencies": ["wire"]}]}

Complete one task (the next ready task auto-promotes):
{"merge": true, "todos": [{"id": "scaffold", "content": "Scaffold package", "status": "completed"}]}

Block on the user:
{"merge": true, "todos": [{"id": "wire", "content": "Wire workspace", "status": "blocked", "blocker": "needs registry token from user"}]}

Append tasks:
{"merge": true, "todos": [{"id": "retries", "content": "Handle retries", "status": "pending"}]}

Clear:
{"merge": false, "todos": []}`

export const todoReadDescription =
  'Read the structured task list for the current coding session. Filter by status, ID, or both. Empty filters return the complete list.'
