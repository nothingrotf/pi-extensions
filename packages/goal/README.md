# @nothingrotf/goal

A durable goal lifecycle for [Pi](https://github.com/earendil-works/pi) sessions.

The package recreates the verified Cursor Agent goal behavior within the Pi extension API.

- `/goal <objective>` creates an active goal and starts work immediately.
- A new goal replaces the current goal.
- Active goals continue across autonomous turns and session reloads.
- Three consecutive continuation turns without tool use stop automatic continuation.
- Tool use resets the idle continuation count.
- The user can pause, resume, or clear the goal.
- The agent can set the goal to `active` or `complete`.
- A completed goal can become active again.
- Active runtime excludes paused and completed periods.

## Install

```sh
pi install npm:@nothingrotf/goal
```

Try the local workspace without installation:

```sh
pi --no-extensions -e ./packages/goal/src/index.ts --skill ./packages/goal/skills/goal/SKILL.md
```

## Use

```text
/goal publish the package and verify the release
/goal status
/goal pause
/goal resume
/goal clear
```

A leading time limit does not become part of the objective:

```text
/goal 30m publish the package
```

Recurring work belongs to `/loop`:

```text
/loop 30m check the deployment
```

## Tools

- `get_goal` returns the current goal, status, active runtime, and continuation counts.
- `create_goal` creates or replaces an explicitly requested goal.
- `update_goal` sets the status to `active` or `complete`.

Only the user controls the `paused` and `cleared` states.

## Compatibility evidence

Static bundle inspection verified these Cursor Agent facts:

- `CreateGoal` accepts one nonempty `objective` string.
- `UpdateGoal` accepts only `active` and `complete`.
- Persisted status values include `active`, `paused`, `complete`, and `cleared`.
- Persisted state tracks active duration, idle continuation count, and continuation count.

Runtime probes verified these facts:

- A second creation replaces the first goal without an error.
- `active` succeeds for active and completed goals.
- `complete` reports cumulative active runtime.
- An active goal causes autonomous continuation turns.

Pi provides no native goal panel. This package maps user controls to `/goal` subcommands and adds `get_goal` for inspection.

## Development

```sh
bun install
bun run check
bun run test
```

## License

[MIT](LICENSE)
