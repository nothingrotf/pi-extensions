# @nothingrotf/fast-mode

`@nothingrotf/fast-mode` requests Fast Mode for supported OpenAI Codex models.
It changes only `service_tier` through Pi's `before_provider_request` hook.
It preserves the provider, authentication, reasoning effort, verbosity, and other request fields.

## Install

```sh
pi install npm:@nothingrotf/fast-mode
```

Remove other extensions that override Codex Fast Mode before activation.
Restart Pi after installation.

## Commands

```text
/fast on
/fast off
/fast status
```

`/codex-fast` is an alias.
The package stores the preference in `<agentDir>/state/fast-mode.json`.
The initial preference is off.
Other sessions read preference changes before their next request.

Fast Mode increases usage. The status reports a requested tier, not proof that the server used that tier.
`off` stops this package's tier override. It preserves tiers supplied by other request sources.

## Model support

The package reads `${CODEX_HOME:-~/.codex}/models_cache.json` without network requests.
An explicit catalog tier declaration takes precedence over the built-in compatibility list, including a declaration without a Fast tier.

The built-in list covers these verified model identifiers when the catalog lacks tier metadata:

- `gpt-5.4`
- `gpt-5.5`
- `gpt-5.6-luna`
- `gpt-5.6-sol`
- `gpt-5.6-terra`
- `gpt-6-astra`

Unknown models require a catalog entry that advertises `priority` or `fast`.
The package does not apply Codex tier rules to the public OpenAI API or other providers.
A model switch preserves the preference but suspends the override for an unsupported model.
An invalid preference file disables the override and reports an error.

## Subagents

The package exports the shared capability policy through `@nothingrotf/fast-mode/policy`.
The subagent package uses this policy for explicit `[fast]` selectors.
Subagents do not inherit the global preference automatically.

## Sources

- [Codex configuration reference](https://developers.openai.com/codex/config-reference)
- [OpenAI Fast Mode guide](https://developers.openai.com/api/docs/guides/fast-mode)

## Verification

```sh
bun run check
bun run test
```
