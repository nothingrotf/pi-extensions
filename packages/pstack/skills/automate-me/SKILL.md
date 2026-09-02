---
name: automate-me
description: "Use for 'automate me', 'create, update, or refresh my -mode skill', 'capture my preferences or working style', or wanting agents to follow how the user works. Drafts or revises a personal -mode skill through create-skill and unslop, with optional evidence from recent Pi sessions."
disable-model-invocation: true
---

# Automate me

Turn the user's working conventions into one `-mode` skill, such as `jay-mode` or `priya-mode`.

This skill coordinates a session evidence pass, the bundled `create-skill` skill, and the **unslop** skill. It sequences them and does not replace them.

## Flow

### 0. Check for an existing skill

Search project `.pi/skills/` and `.agents/skills/` recursively for `*-mode/SKILL.md`. Search user `~/.pi/agent/skills/` and `~/.agents/skills/` when the user requests a personal skill. Match the user's handle. Mode skills can live in a category directory.

If one exists, use `AskQuestion` unless the user already requested an update. Offer:

- Update the existing skill.
- Start fresh and state why.

Update mode changes the flow:

- Step 1 searches only sessions after `git log -1 --format=%cI <path>` when Git tracks the skill.
- Step 2 asks what changed or remains absent.
- Step 4 edits the existing file. Preserve rules that new evidence does not contradict.

### 1. Mine session history

The parent uses project-scoped `session_history`. Never inspect guessed physical session paths.

Set a recent window, usually two to four weeks. Use `list` and `search`, then bounded `read` calls with `view: "audit"`. Use `timeline` and `tool_activity` when they provide decision or execution evidence. Exclude the current session and child sessions. Preserve `pi-session://` references.

For a large result set, split bounded evidence into three time slices. Launch parallel `Task` children with `subagent_type: "generalPurpose"` and `readonly: true`. Children analyze supplied evidence only. They do not access session files or ambient source tools.

Each child returns a short structured list with evidence references. Search for:

- Response length, tone, and format preferences
- Delegation and parallelism habits
- Verification requirements
- Code and prose discipline
- Worktree, commit, PR, review, and merge conventions
- Skill maintenance preferences

Cross-check slices. Treat patterns from two or more slices as high confidence. Drop lone signals unless the user confirms them. If `session_history` is unavailable, skip mining only when the user supplies enough direct evidence. Otherwise return `BLOCKED`.

### 2. Ask the user directly

Use `AskQuestion` with `allowMultiple: true` for category choices. Ask one or two questions with four to six options. Start with the areas that matter most. Follow with specific choices for selected areas. Ask one short free-form question only when the structured answers leave a material gap.

Do not ask for facts that repository or session tools can discover.

### 3. Cluster findings

Group confirmed signals into only the sections that apply:

- **Response style**
- **Autonomy**
- **Understand first**
- **Subagents**
- **Prose and code discipline**
- **Review and verify**
- **Process**
- **Skills**

Read **poteto-mode** for granularity. Do not copy its content.

### 4. Draft the skill

Load and follow the bundled `create-skill` skill.

For an existing mode, preserve its project or user location. For a new project mode, use `.pi/skills/<handle>/<handle>-mode/SKILL.md` when a personal category exists. Otherwise use `.pi/skills/<handle>-mode/SKILL.md`. Use `.agents/skills/` only when project policy selects that location. For a user skill, use the matching user skill root after user approval.

Use the user's chosen handle. Make the frontmatter description trigger on the handle, `/<handle>-mode`, and work in that user's style. Do not use generic triggers.

Set `disable-model-invocation: true` by default. Change it only when the user explicitly wants automatic invocation.

### 5. Iterate on prose

Apply **unslop** and the writing guidance from `create-skill` to every line.

Show the draft to the user and apply feedback. Keep the mode skill short and operational.

### 6. Land it

For a repository skill, work in an isolated branch or worktree from the repository's main branch. Commit and open one PR for review. Do not push directly to the main branch.

For a user skill outside a repository, apply only after explicit approval. Report the final path and verification result.

## Guardrails

- **Do not overfit one conversation.** Require repeated evidence or explicit confirmation.
- **Do not restate other skills.** Reference them.
- **Keep sections minimal.** Add only specific non-default rules.
- **Use generic instruction nouns.** Use "the user" or "the human" in rules.
- **Do not force symmetry.** Omit sections without real preferences.

## Evaluation

A `-mode` skill is subjective. Ask whether the draft reads like the user and misses any important rule. Use a description optimization pass only after trigger accuracy fails in practice.

## When not to use

- For a task-specific skill, use `create-skill` without mode mining.
- For one narrow workflow, create a regular skill.

## References

- **poteto-mode** for output granularity
- **unslop** for prose discipline
- The bundled `create-skill` skill for authoring and verification
