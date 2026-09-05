# @nothingrotf/goal

`@nothingrotf/goal` runs a persistent coder-reviewer loop for one objective.

The package keeps the coder active until an independent reviewer returns `PASS`. A self-reported completion only requests review.

The extension combines persistent goal state, usage accounting, objective and budget controls, and an independent coder-reviewer cycle:

- A fresh reviewer context for each attempt.
- Deterministic checks before reviewer judgment.
- A strict `PASS`, `FAIL`, or `PARTIAL` verdict.
- Bounded attempts, token budgets, and oscillation detection.
- Persisted verdict history and user steering.

## Install

```bash
pi install npm:@nothingrotf/goal
```

## Start a goal

Run a direct goal:

```text
/goal Ship the release
```

Set optional loop controls:

```text
/goal Ship the release --max=8 --review-model=openai/gpt-5 --review-fallback=anthropic/claude-opus-4-6 --runtime-probe
```

Use guided preparation for unclear work:

```text
/guided-goal migrate the service
```

Guided preparation uses the request, conversation, and read-only repository evidence. It asks only for unresolved material choices.

If all fields are known, it creates the goal without another permission request. It does not execute the goal during preparation.

Use the conversation-only interview for one question per reply:

```text
/guided-goal --interview migrate the service
```

Both modes establish five fields before goal creation:

1. Binary success criteria.
2. Exact verification actions.
3. A maximum attempt count.
4. Scope boundaries.
5. Stop and escalation conditions.

## Manage a goal

```text
/goal
/goal show
/goal pause
/goal resume
/goal drop
/goal budget 80000
/goal budget off
/goal max 8
/goal reviewer openai/gpt-5
/goal reviewer inherit
/goal probe on
/goal probe off
```

A bare `/goal` opens the management menu in TUI mode.

## Review cycle

Each completed coder turn starts this cycle:

1. The package captures the current Git working tree scope.
2. The package runs the project type check.
3. The package runs the project test command.
4. The package runs an optional runtime probe.
5. A new read-only agent session inspects the repository.
6. The reviewer returns one strict JSON verdict.
7. The controller applies the verdict.

`PASS` completes the goal. `FAIL` or `PARTIAL` returns evidence to the coder.

A failed deterministic check forces `FAIL`. `PASS` requires concrete evidence and a successful final reviewer response. A provider error cannot reuse an earlier verdict. Reviewer token use counts against the goal token budget, including cancelled and restarted reviews when the provider reports usage.

Budget exhaustion lets the current coder turn finish and permits one final review. It is a stopping policy between turns, not a hard limit on an individual model response. Completion and final budget usage stay visible in the session transcript.

The default attempt cap is five reviews. The hard maximum is twelve reviews.

The controller stops before the cap after three consecutive equivalent failures, comparing both reasons and evidence while ignoring line-number changes. Resuming starts a fresh repetition audit and preserves the overall attempt cap and token total.

When configured, the controller uses the fallback reviewer after three failed reviews.

Before the final available attempt, the coder receives a directive to reconsider the approach.

Each reviewer gets only read/search tools, current requirements, check results, and prior findings. Parent conversation history, extensions, skills, and prompt templates are not loaded into the reviewer. Repository instructions follow the parent session's project trust setting.

A review has a ten-minute deadline, including contract loading, model setup, session creation, and inference.
Cancellation allows up to one second for provider cleanup. A provider that ignores cancellation cannot hold the Goal controller indefinitely.
Late session creation disposes the session instead of starting a stale prompt.

## Project checks

For JavaScript and TypeScript projects, the package finds the nearest `package.json`.

The package selects the first available type check script:

1. `typecheck`
2. `check`
3. `lint`

The package also runs `test` when that script exists.

If the runtime probe is active, the package selects the first available script:

1. `probe`
2. `smoke`
3. `test:e2e`

The Git scope includes modified and untracked files. It tells each fresh reviewer where to start.

Unavailable checks remain visible to the reviewer. Missing optional scripts do not force failure. A configured command that cannot launch, or an explicitly requested runtime probe that is unavailable, prevents `PASS`.

Checks run with closed standard input and `CI=1`, have execution deadlines, and terminate their process group when cancelled. An invalid nearest `package.json` fails verification instead of selecting scripts from an ancestor project.

The package does not execute project commands when Pi disables project trust.

## Goal tool

The extension exposes one tool with these operations:

- `create`
- `get`
- `resume`
- `complete`
- `drop`

`create` accepts these optional fields:

- `token_budget`
- `max_iterations`
- `review_model`
- `review_fallback_model`
- `runtime_probe`

`complete` requests independent review after the current turn. It does not set the goal status to complete.

## Steering

Send normal text during an active review to steer the reviewer.

Steering is persisted, delivered to the reviewer, and included in subsequent coder and reviewer prompts. A review that misses a queued message restarts before its verdict can complete the goal.

The queue accepts five messages per review and preserves up to 24 messages per goal, each up to 2,000 characters. Rejected text returns to the editor with an explanation. Use `/goal set` to revise the objective when its constraints need more space.

Image attachments are forwarded to the active reviewer and retained for immediate review restarts. Image data is not persisted; resend attachments after reopening a session.

Slash commands remain available during review.

## Goal panel

The panel above the editor wraps the complete objective within the terminal width, without a trailing ellipsis.
Resizing the terminal reflows the objective while preserving the title, usage totals, and footer actions.

The panel separates the coder turn from the open goal. Only an independent PASS produces the final goal result.

Live phases include:

- `coding`: the parent agent is active.
- `checking`: automated checks run before review.
- `starting reviewer`: the independent session initializes.
- `reviewing`: the reviewer requests model responses or uses tools.
- `waiting`: continuation waits for a specific blocker to clear.
- `queued`: the next coder turn is queued but does not yet run.

The panel shows check outcomes, phase duration, reviewer model, current tool, observed tokens, and review-history indicators.
Narrow terminals prioritize the reviewer's operation over its model name.
The review number identifies the current attempt, not a completion percentage.

One display timer updates active animations every 150 milliseconds and slows to one second after six seconds without activity.
Waiting states use the slower cadence. Pause, drop, and shutdown stop the timer.
The elapsed clock does not imply provider progress. A separate line reports the age of the last observed activity event.
Providers can withhold usage until a message finishes. Token counters use reported usage, not estimates, and exclude cached reads like the budget ledger.

Display ticks do not write session entries. Live projections include unflushed usage without changing the durable accounting baseline.

Continuation waits for editor drafts, pending messages, parent activity, or an external loop without losing its retry.
Clearing a temporary blocker resumes scheduling automatically. A delivery exception pauses the goal and permits explicit recovery through `/goal resume`.

## Persistence

The package writes version 3 state to `pi-goal-mode` custom entries.
Live activity remains transient. It stores at most four check summaries and excludes check output, tool arguments, and reasoning content.
A restored review does not retain a fictitious live worker.

Persisted state includes:

- The objective and budget totals.
- The current review phase.
- The attempt count and cap.
- The last eight verdicts.
- Pending and previously accepted user steering.
- The start of the current repetition audit.
- Reviewer and runtime probe settings.
- The stop reason.

Session restore pauses an active goal. Run `/goal resume` to continue it.

The decoder migrates version 2 goal entries to version 3 state.

## Events

The extension emits these Pi events:

- `@nothingrotf/goal/activity`
- `@nothingrotf/goal/review-start`
- `@nothingrotf/goal/review-verdict`
- `@nothingrotf/goal/review-stop`

Activity events publish the goal identifier, goal status, and transient activity snapshot for status consumers.
Only semantic activity changes emit these events. Display ticks do not emit activity events.
The goal tool also returns the current activity snapshot.

Each verdict also creates a `pi-goal-review` custom entry.

## External loops

Goal still runs checks and review when a Loop extension controls cadence.

Goal does not send a second coder turn while an external loop remains active. Its local scheduling timer checks for release of that blocker. If another coder turn starts during review, the old review is cancelled and its verdict is discarded. The next settled turn is reviewed against current files.

## Compatibility

The package targets the repository Pi catalog (`0.84.4` or newer) and is validated with Pi `0.85.0`. It uses the `ModelRuntime` and `agent_settled` APIs.

## Development

Run `bun run check` and `bun run test` from the repository root. Goal tests cover persistence, accounting, convergence, project subprocesses, lifecycle races, and fresh reviews using the actual Pi SDK with a deterministic local provider. The SDK tests require no network calls or model credits.
They cover cancellation and deadlines during initialization, late-session disposal, progress callbacks, and parallel reviewer tools.
Lifecycle tests cover temporary blockers, failed delivery, repeated tool activity, stale progress, timer cleanup, and heartbeat persistence.
