# @nothingrotf/pstack

`@nothingrotf/pstack` ports pstack workflow skills to Pi with minimal source changes.

## Install

Install the required tools first:

```sh
pi install npm:@nothingrotf/ask
pi install npm:@nothingrotf/goal
pi install npm:@nothingrotf/loop
pi install npm:@nothingrotf/session-history
pi install npm:@nothingrotf/subagent
pi install npm:@nothingrotf/todo
```

Install pstack:

```sh
pi install npm:@nothingrotf/pstack
```

Restart Pi after installation.

## Resources

The package provides 44 upstream skills and four Pi compatibility skills. `make-bot-ui` remains outside the project by explicit decision.

- `architect`
- `arena`
- `automate-me`
- `blast-radius`
- `bro`
- `control-cli`
- `control-ui`
- `create-skill`
- `create-verification-skill`
- `deslop`
- `figure-it-out`
- `how`
- `interrogate`
- `maintain-verification-skill`
- `no-comments`
- `principle-boundary-discipline`
- `principle-build-the-lever`
- `principle-encode-lessons-in-structure`
- `principle-exhaust-the-design-space`
- `principle-experience-first`
- `principle-fix-root-causes`
- `principle-foundational-thinking`
- `principle-guard-the-context-window`
- `principle-laziness-protocol`
- `principle-make-operations-idempotent`
- `principle-migrate-callers-then-delete-legacy-apis`
- `principle-minimize-reader-load`
- `principle-model-the-domain`
- `principle-never-block-on-the-human`
- `principle-outcome-oriented-execution`
- `principle-prove-it-works`
- `principle-redesign-from-first-principles`
- `principle-separate-before-serializing-shared-state`
- `principle-sequence-verifiable-units`
- `principle-subtract-before-you-add`
- `principle-type-system-discipline`
- `poteto-mode`
- `recall`
- `reflect`
- `setup-pstack`
- `show-me-your-work`
- `swarm`
- `tdd`
- `teach`
- `technical-writing`
- `typescript-best-practices`
- `unslop`
- `why`

The package registers the `Comment Sicko` and `poteto-agent` agents with `@nothingrotf/subagent` through the shared Pi event bus.

It also registers the `pstack-nested` capability profile. The profile permits three local Task levels.

The `poteto-agent` defaults to background mode. Mutable background work runs in automatic writer isolation.

Inspect a completed writer with `TaskControl`. Use `action: "join"` only when the parent workspace must receive its accepted patch.

## Stack backends

Poteto supports Graphite `gt` and GitHub `github/gh-stack`.

If only `gh` exists, Poteto asks for approval before it runs:

```sh
gh extension install github/gh-stack
```

Set `POTETO_STACK_BACKEND=graphite` or `POTETO_STACK_BACKEND=github` to select a backend. The automatic mode prefers GitHub when both exist. Graphite remains an explicit selection and an automatic fallback.

GitHub stack workflows require GitHub Stacked Pull Requests on the repository.
