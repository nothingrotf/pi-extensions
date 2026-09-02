---
name: maintain-verification-skill
description: "Periodic pass that keeps a project's verification skill and feature map honest: parallel source readers per feature, one live session that drives every feature, and at most one PR of proven corrections. Use for /maintain-verification-skill or 'audit the verify skill'."
disable-model-invocation: true
---

# Maintain a verification skill

A feature map rots when the app changes. This skill maintains a project verification skill and its feature map. Cover each feature from source and exercise each feature live.

## Outcomes

Select one outcome and state it:

- **clean** - Every feature received source and live coverage. No branch or PR exists.
- **changed** - One PR contains proven documentation, harness, or map corrections.
- **blocked** - Coverage or safe shipment did not finish. State the exact blocker.

## Edit scope

Edit only the verification skill directory, including its `SKILL.md`, `features/`, and owned harness scripts. Never edit product code. Report product regressions instead of hiding them in documentation.

## Pass

0. **Locate the target.** Find a project verification skill under `.pi/skills/verify-*/` or `.agents/skills/verify-*/`. Its body must contain launch and drive sections plus a feature map. If several candidates exist, use `AskQuestion` to select one. If none exists, stop and point to `/create-verification-skill`.

1. **Index hygiene.** Read the feature-map README and sibling files. Fix missing, extra, duplicate, and dead entries. Do not generate an inventory.

2. **Source wave.** Launch one concurrent read-only `Task` node per feature file. Use `subagent_type: "generalPurpose"`, `readonly: true`, and a bounded graph. Each node explains the user-facing feature from source, cites entry points, flags likely drift, and returns one live recipe. Children never drive the app or edit files.

3. **Reconcile.** Require one returned summary per feature file. Merge overlapping recipes into few app states. Verify cited drift. Search recent source changes for missing user-facing surfaces. Require a concrete source path before you add one.

4. **Live pass.** Live verification is mandatory. The coordinator owns all control. Follow the verification skill's launch model. Use one serially controlled instance for servers and UIs. Use a fresh isolated session for each short-lived CLI drive.

Maintain these invariants:

- Run doctor before the first drive and after surprising behavior.
- Preserve evidence at its named location through every cleanup.
- Remove state and processes when a drive no longer needs them.

If doctor cannot detect a bad UI state, reset or relaunch. If skill drift breaks doctor, fix it within scope and retry once. Restart only invalidated state.

Mark a feature `verified-unreachable` only with the attempted route and concrete missing prerequisite. If the map omits that prerequisite, fix the drift. Re-drive each harness correction before shipment. Run final teardown after the last proof.

If the current Pi turn lacks the required UI, CLI, simulator, browser, or service-control capability, return **blocked**. Do not substitute unit tests for the live pass.

5. **Triage.** Fix incorrect user documentation as doc drift. Fix an unreachable working behavior as a harness gap. Report broken app behavior as a product gap. Make helper scripts executable and document their invocations.

6. **Ship or stop.** For **changed**, create one review branch and PR with proven corrections. Read every changed file before shipment. For **clean** or **blocked**, create no PR.

Keep concise run notes in scratch storage. Do not commit them.
