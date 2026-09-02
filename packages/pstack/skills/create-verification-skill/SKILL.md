---
name: create-verification-skill
description: "Generate a project-local verification skill that drives your app the way a user does - any language, framework, or platform. Use for /create-verification-skill, 'make a control skill for this repo', or when a project has no scripted way to prove UI, CLI, or service behavior."
disable-model-invocation: true
---

# Create a verification skill

Every serious project needs a scripted way to drive the real app and prove behavior. This skill generates a project-local skill under `.pi/skills/verify-<app>/`. The output serves the next agent, who reads it cold during a task.

## 1. Interview the repository, not the user

Answer these questions from the repository. Use `AskQuestion` only for a material choice that the repository and active tools cannot resolve.

- **Surface:** What does a user touch? Select the primary surface and note other surfaces.
- **Run:** How does the app start locally? Use documented project commands. Record ports, environment variables, seed data, and authentication.
- **Drive:** Which active harness or skill can drive it? Prefer existing Playwright, Cypress, expect, PTY, HTTP, simulator, or debug-port tools. Use the bundled `control-ui` or `control-cli` contract when it matches. Never claim a driver that the current Pi turn cannot access.
- **Observe:** Which evidence can the harness capture? Examples include screenshots, terminal transcripts, response bodies, logs, exit codes, and stored state.
- **Isolate:** Can two instances run safely? If not, make the generated skill refuse concurrent control of shared state.

If no real driver exists, return `BLOCKED`. Name the missing capability. Do not replace live verification with unit tests.

If the checkout does not build or start, reproduce the failure through the user-facing entry point. Fix the base or report the exact blocker before generation. The generated skill can create irrelevant startup scaffolding and remove it during cleanup.

## 2. Generate the skill

Write `.pi/skills/verify-<app>/SKILL.md`. Use valid YAML frontmatter with `name: verify-<app>` and a description that names the app, surface, and trigger. Ground every section in repository evidence. Leave no placeholders.

- **Launch:** Give the exact start command, readiness proof, and teardown. For short-lived programs, build once and start each drive in an isolated session.
- **Doctor:** Give one read-only check for process identity, version, port ownership, and authentication.
- **Drive:** Give exact commands and stable handles from this repository. Prefer accessible names, data attributes, prompts, and routes over coordinates.
- **Evidence:** Exercise the real user path. Capture both the action and result. Verify side effects through a second observable view. Use mocks only at an existing production boundary. Verify what dry-run or test modes skip.
- **Cleanup:** Stop only instances that the run started. Remove scratch state but retain proof artifacts.
- **Helpers:** Make each helper executable and show its invocation in the skill body.

Project policy can select `.agents/skills/verify-<app>/` instead. Use one project location consistently. Do not write Cursor skill paths.

## 3. Seed the feature map

Create `features/README.md` under the generated skill. Add one file for each of the top three to five user-facing features. Follow [`references/feature-map-example/`](references/feature-map-example/).

Each feature file describes the user view, entry path, exact drive recipe, and observable proof. Use these four H2 headings:

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with <harness>`
4. `Gotchas`

The map is the maintained verification source. A proof that ignores listed entry points is incomplete.

## 4. Prove the generated skill

Run the generated instructions end to end once. Launch the app, run doctor, drive one mapped feature, capture evidence, and clean up. Verify that evidence remains after cleanup.

Fix each failed iteration. Run cleanup after each failure. A skill that never ran is a draft, not a deliverable.

## 5. Offer maintenance

Point the user to `/maintain-verification-skill`. Suggest a cadence only when the user asks.
