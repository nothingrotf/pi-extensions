# @nothingrotf/goal

Goal mode for [Pi](https://github.com/earendil-works/pi) sessions.

The package ports the goal subsystem of [oh-my-pi](https://github.com/can1357/oh-my-pi) to the Pi extension API. One session holds one persistent objective. Pi works toward the objective across autonomous turns until the agent verifies completion, the budget runs out, or the user stops the goal.

## Behavior

- `/goal <objective>` creates the goal and sends the objective as the first prompt.
- After each settled run, the extension waits 800 ms and sends a hidden continuation prompt.
- A continuation turn without tool calls suppresses the next continuation. A user message, a tool call, or a budget change resets the suppression.
- Esc pauses the goal. Session resume pauses the goal. The user must run `/goal resume` to continue.
- The goal tracks tokens and wall-clock time. Token accounting counts input, output, and cache writes. It ignores cache reads.
- When usage reaches the token budget, the goal becomes `budget-limited` and the agent receives one wrap-up steer.
- The objective enters every prompt as escaped XML inside `<objective>`, marked as user data and not as instructions.
- The `goal` tool is visible to the model only while a goal exists.
- When `@nothingrotf/todo` is installed and `todo_write` is active, the goal context includes the persisted todo list as live progress state.

## Editor panel

An Empryo-style goal strip appears above the editor while a goal exists:

```text
    ╭─ ⟲ goal · active ▾ ── 1.2k/5k tokens · 1m 05s ─╮
    │   Ship the editor dock                         │
    ╰─ continuing toward the objective ─ /goal drop ─╯
```

The responsive side inset uses one to four columns. The panel uses a rounded border and a title chip.

The border reports the goal state. The title reports token use and elapsed time.

A paused goal displays `/goal resume`. A limited goal displays `token budget reached`.

The footer uses `/goal drop` because this package names the discard command `drop`.

## Install

```sh
pi install npm:@nothingrotf/goal
```

Try the local workspace without installation:

```sh
pi --no-extensions -e ./packages/goal/src/index.ts
```

## Commands

```text
/goal <objective>        create a goal and start work
/goal                    open the goal menu
/goal set <objective>    replace the active goal
/goal show               print objective, status, tokens, and time
/goal pause              pause the goal
/goal resume             resume a paused goal
/goal drop               discard the goal after confirmation
/goal budget <n|off>     set or clear the token budget
/guided-goal [idea]      interview the user, then create a goal
```

`/guided-goal` asks one question per turn until five fields are fixed: binary success criteria, verification method, attempt cap, scope boundaries, and stop conditions. The agent then calls `goal({op:"create"})` with a structured objective.

## Tool

The model uses one tool named `goal` with a single `op` field:

- `create`: start a goal. Requires `objective`. Accepts a positive `token_budget`. Fails when a goal already exists.
- `get`: return the current goal and the remaining budget.
- `resume`: reactivate a paused goal.
- `complete`: mark the goal complete. The prompt requires current-state evidence for every deliverable.
- `drop`: discard the goal.

## Session entries

- `pi-goal-mode`: the current mode (`goal`, `goal_paused`, or `none`) with the goal record.
- `pi-goal-completed`: objective and usage of a completed goal.

The extension restores the newest valid `pi-goal-mode` entry on session start and on branch switch.

## Loop integration

While `@nothingrotf/loop` has an active loop (scheduled or repeat), the goal does not send continuations. The loop owns the wake cadence. The goal context still enters every prompt, and the completion rules still apply. This matches oh-my-pi, where loop mode disables the goal continuation.

## Todo integration

The extension reads the newest successful `todo_write` tool result or `pi-todo-user-edit` entry on the session branch. It does not import the todo package. The rendered `<todo_context>` block lists each todo as `- [status] #id content` with XML escaping and flattened line breaks. `blocked` todos count as open and show the blocker note.

With the todo package installed, the stop reminder of the todo package runs before the goal continuation. The reminder fires on `agent_end`. The goal continuation waits for `agent_settled` and for an idle session.

## Differences from oh-my-pi

- oh-my-pi groups todos into phases and keys them by text. This package renders one flat list keyed by `#id`.
- Pi has no plan or vibe mode. The mode guards do not exist.
- The `goal.enabled` and `goal.continuationModes` settings do not exist. Continuation runs in every mode with an idle session.

## Development

```sh
bun install
bun run check
bun run test
```

## License

[MIT](LICENSE)
