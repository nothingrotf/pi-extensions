# Pstack subagent validation

## Verdict

Local SDK integration passes for 68 dispatch contracts and 14 workflow graphs containing 62 nodes.
The focused contract suites pass 100 tests. The latest completed repository suite passes 1,663 tests and skips 87 opt-in tests.
That suite includes the progress-feedback correction and uses one worker with a 512 MiB Node heap limit.
The real nested track also passed after the correction.
An earlier subagent suite reached its command deadline during overlapping work, but the later complete suite passed.
The snapshot performance assertion now checks exact membership rather than assuming creation order despite runtime update-based ordering.
The latest `bun run check` passes formatting, lint, and types.

This is not a full behavioral approval of every skill.
The SDK uses a scripted model provider. Actual Task tools, child sessions, file tools, Git worktrees, capability policies, and control tools execute.
The provider selects predetermined tool calls. It does not independently interpret the skill or judge its artifacts.

No product PR, merge, deployment, tracker mutation, or external-service write occurred during this validation.

## Reproduce

Run the individual integration and guidance suites:

```sh
bun run test packages/pstack/test/child-bootstrap.test.js packages/pstack/test/workflow-guidance.test.ts --reporter=verbose
```

Run all repository checks:

```sh
bun run check
bun run test
```

The recorded focused report is `/tmp/pstack-workflows.json`.
The latest repository report is `/tmp/pstack-post-fast-final-tests.json`.
These files are local evidence, not published artifacts.

## Runtime model-policy regression

The model-policy regression uses the actual pstack extension and SubagentRuntime with fake transport at the Pi SDK provider boundary. It does not mock modules or manually inject policy context.

Run the retained regression and policy matrix:

```sh
bun run test packages/pstack/test/model-policy.test.ts packages/pstack/test/child-bootstrap.test.js
```

Evidence for this correction lives in `.verification/pstack-model-policy/`. The original omitted-model reproduction selected the parent instead of the configured explorer in both extension load orders. The corrected runtime selects the configured model. Tests also cover root and nested context, grouped keys, all exact roles, inherited panel entries, effort and fast validation, malformed files, batch and background dispatch, reload, and stored resume selection.

The mixed-validity SDK Task batch regression places a valid entry before an invalid role, unavailable selected model, or omitted distinct panel choice. Each call returns a tool error with zero runtime records and zero child provider calls. Batch preflight is all-or-nothing; valid entries do not start when another entry fails preflight.

The live harness records missing policy content as JSON `null` and still passes the policy path to the extension. Only ENOENT is treated as absent. Other read failures propagate. The no-policy regression uses this evidence reader with the SDK harness and confirms parent fallback without a paid provider.

The structural role regression scans literal role declarations in all pstack skill Markdown, including playbooks and references, and checks resolved runnable workflow fixtures against `pstackRoles`. Configuration-only aliases are not dispatch roles. Scanner tests cover misspellings, shorthand used as a Task role, inline declarations, JSON fields, role lists, and role tables.

These scripted checks prove model routing and lifecycle integration. A fresh-session real-model proof remains a separate coordinator review step.

## Evidence boundaries

Each dispatch test checks these observable effects:

- The parent invokes the registered `Task` tool through an SDK session.
- The child reads its real skill or playbook and a fixture file.
- The child writes and completes a session-local todo without changing the parent's todo.
- The selected role and inherited model survive runtime records and `TaskControl jobs`.
- Read-only children lack shell tools and ambient source tools.
- Nested owners invoke a real child with a narrower leaf profile.
- Mutable children execute shell and file tools inside managed Git worktrees.
- Strict output, artifact, and status gates pass.
- `TaskControl wait` and `status` observe background completion.
- Accepted apply-mode patches reach the destination only after `TaskControl join`.
- Manual and branch-mode work does not reach the destination through `join`.

The Why follow-up also resumes the original child and preserves its role and leaf capabilities.
Graph tests check every node and decode the untrusted dependency envelope to verify upstream output transport and execution order.
Graph tests do not prove that a model correctly interprets that envelope or produces a sound synthesis.

Fixture writes create `output.txt`. They do not implement the feature, refactoring, comment cleanup, or publication named by a workflow.
Runtime-verifier fixtures execute local shell checks. They do not drive a product browser, simulator, or CLI.
All graph nodes use the same fixture provider. Different-family review remains unverified.

## Individual dispatch results

Every scripted SDK result below is PASS. Autonomous execution uses a separate opt-in harness and does not inherit these verdicts.
The real-model pilot remains partial. See the live validation section below.
Exact source paths, roles, agent types, and profiles appear in `packages/pstack/test/workflow-cases.js`.

| Scenario                   | Role                   | SDK mode                   |
| -------------------------- | ---------------------- | -------------------------- |
| how-simple                 | how explainer          | static                     |
| how-explorer               | how explorer           | static                     |
| how-synthesis              | how explainer          | static                     |
| how-critique               | how critics            | static                     |
| why-source-control         | why investigators      | static                     |
| why-tickets                | why investigators      | static                     |
| why-documents              | why investigators      | static                     |
| why-chat                   | why investigators      | static                     |
| why-observability          | why investigators      | static                     |
| why-errors                 | why investigators      | static                     |
| why-analytics              | why investigators      | static                     |
| why-followup               | why investigators      | static and resume          |
| why-synthesis              | why synthesizer        | static                     |
| reflect-judgment           | reflect judgment       | static                     |
| reflect-tooling            | reflect tooling        | static                     |
| reflect-divergent          | reflect divergent      | static                     |
| reflect-synthesizer        | reflect synthesizer    | static                     |
| interrogate-reviewer       | interrogate reviewers  | static                     |
| recall-slice               | judgment and prose     | static                     |
| automate-early             | judgment and prose     | static                     |
| automate-middle            | judgment and prose     | static                     |
| automate-recent            | judgment and prose     | static                     |
| verification-source-reader | judgment and prose     | static                     |
| trail-cross-review         | judgment and prose     | static                     |
| swarm-partition            | swarm workers          | static                     |
| swarm-race                 | swarm workers          | static                     |
| swarm-mixed                | swarm workers          | static                     |
| swarm-runtime              | swarm workers          | manual verifier            |
| swarm-writer               | swarm workers          | branch writer              |
| arena-candidate            | arena runners          | branch writer              |
| arena-judge                | arena cross-judge pool | static                     |
| architect-sketch           | architect runners      | branch writer              |
| comment-cleanup            | judgment and prose     | apply writer               |
| feature-leaf               | feature                | apply writer               |
| feature-owner              | feature                | nested apply writer        |
| refactoring                | refactoring            | apply writer               |
| bug-fix                    | bug-fix                | apply writer               |
| perf-issue                 | perf-issue             | apply writer               |
| hillclimb                  | hillclimb              | apply writer               |
| shipping-static            | judgment and prose     | static                     |
| shipping-runtime           | judgment and prose     | manual verifier            |
| orchestrate-worker         | feature                | apply writer               |
| orchestrate-track          | hardest tasks          | nested apply writer        |
| orchestrate-static         | judgment and prose     | static                     |
| orchestrate-runtime        | judgment and prose     | manual verifier            |
| autopilot-full-owner       | feature                | nested apply writer        |
| autopilot-stack-owner      | feature                | nested apply writer        |
| multi-phase-explorer       | hardest tasks          | static                     |
| multi-phase-live-lane      | swarm workers          | manual verifier            |
| eval-candidate             | arena runners          | branch writer, not blinded |
| eval-judge                 | arena cross-judge pool | static, not blinded        |
| bulk-reducer               | judgment and prose     | static                     |
| bug-how-owner              | bug-fix                | nested static owner        |
| bug-why-owner              | bug-fix                | nested static owner        |
| visual-parity-owner        | feature                | nested apply writer        |
| runtime-forensics-reader   | judgment and prose     | static                     |
| runtime-forensics-parser   | judgment and prose     | manual verifier            |
| trace-forensics-reader     | judgment and prose     | static                     |
| trace-forensics-parser     | judgment and prose     | manual verifier            |
| bespoke-worker             | hardest tasks          | nested apply writer        |
| bespoke-judge              | judgment and prose     | static                     |
| pickup-reducer             | judgment and prose     | static                     |
| worktree-investigator      | judgment and prose     | static                     |
| publication-preparation    | judgment and prose     | nested apply writer        |
| orchestrate-brief-auditor  | judgment and prose     | static                     |
| orchestrate-stacker        | refactoring            | apply writer               |
| orchestrate-babysitter     | judgment and prose     | manual verifier            |
| orchestrate-retro-reader   | judgment and prose     | static                     |

## Workflow graph results

Every graph below passes. Definitions appear in `packages/pstack/test/workflow-graphs.js`.
These graph fixtures validate dispatch topology and result transport, not autonomous selection of the topology.
Arena and Swarm also permit parallel single calls. Their graph fixtures exercise the equivalent dependency boundaries, not that exact invocation syntax.

| Graph                        | Nodes | Verified boundary                                         |
| ---------------------------- | ----: | --------------------------------------------------------- |
| how-complex                  |     4 | Two explorers precede synthesis, which precedes criticism |
| why-full                     |     8 | Seven category results reach one synthesizer              |
| reflect                      |     4 | Judgment, tooling, and divergent results reach synthesis  |
| swarm-partition              |     3 | All partition outputs remain observable                   |
| swarm-race                   |     3 | All race outputs remain observable                        |
| swarm-mixed                  |     3 | All mixed outputs remain observable                       |
| arena                        |     3 | Two isolated candidates precede the judge                 |
| architect                    |     3 | Two isolated sketches precede the judge                   |
| interrogate-panel            |     4 | Four reviewer results remain distinct                     |
| automate-slices              |     3 | Three time-slice readers remain independent               |
| maintenance-features         |     3 | Every indexed fixture feature receives a reader           |
| autopilot-full-verification  |     4 | Gates, live, regression, and audit lanes return           |
| autopilot-stack-verification |     4 | Gates, live, regression, and audit lanes return           |
| multi-phase-thirteen-lanes   |    13 | Gates, ten live lanes, performance, and audit return      |

## Reproduced defects and corrections

| Defect                                                                             | Evidence                                                           | Correction                                                                |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| A nested owner rejects its approved leaf profile                                   | SDK feature-owner reproduction and subagent integration regression | Compare capability subsets rather than requiring identical profile names  |
| Profile reduction could accidentally substitute another provider                   | Negative identity, version, extension, tool, and depth cases       | Preserve approved identities and existing workspace and read-only limits  |
| Recall, Automate-me, maintenance, and trail review omit standalone dispatch fields | Eight initial guidance failures include these four skills          | Declare leaf profile, review role, and executable agent type              |
| Autonomous-run invents a watcher subagent                                          | Installed Loop uses session-local watchers                         | Use `loop_next` with `watch.command` in the persistent session            |
| Autopilot owners publish managed snapshot history                                  | Conflict with the common writer contract                           | Accept patches before separate foreground destination publication         |
| Nested workflows assume ambient evidence or unlimited depth                        | Capability inventories and nested API inspection                   | Route missing evidence, root graphs, and excessive depth back to the root |
| Standard bootstrap violates Eval blinding                                          | Bootstrap exposes Arena and Eval skill paths                       | Require preflight and report BLOCKED instead of claiming a blinded run    |

The Eval correction prevents a false claim. It does not create a blinded execution environment.

### Stalled dispatch after reload

The observability session `01a06dc6` showed `Dispatching Finish OBS-58 path correction after reload` for 11 minutes 38 seconds before the background receipt arrived.
The main thread stayed above 85 percent CPU. A CPU profile attributed 90 percent to the TUI render timer, mostly intercom card wrapping.
The first Task after reload ran startup recovery over 96 dead workspaces with up to 27 nested repositories each.
Recovery re-captured workspaces that were already captured and staged. The new result commit differed, so the durable ref fetch was rejected as non-fast-forward.
The failed receipt then replaced the staged receipt. This session lost 62 of 81 staged receipts that way.
A shallow nested clone (`repos/effect`) also left a broken parent link in the durable store, because git rejects the ref update but keeps the fetched objects.

| Defect                                                               | Correction                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Startup recovery re-captured every dead workspace                    | Capture only `active` and `closing` manifests                            |
| Promotion accepted rejected ref updates when the object existed      | Force the internal ref and verify that it points at the promoted commit  |
| Baselines from shallow repositories referenced missing parents       | Create parentless baselines when the repository is shallow               |
| Failed captures were staged and could integrate partial repositories | Stage only captured receipts and report the capture error                |
| Intercom cards re-wrapped their bodies on every render frame         | Cache rendered lines per width, expansion, delivery state, and age label |

Regression tests cover each correction in `packages/subagent/test/isolation.test.ts` and `packages/subagent/test/integration.test.ts`.
The observability repository still needs manual cleanup: 97 retained worktrees under `.git/pi-subagent/worktrees`, 2,418 internal refs, and a broken link from commit `648f566d` to `e03ea907`.

## Lifecycle and indirect routes

The full repository run also exercises subagent cancellation, steering, restart, resume, nested failure, decisions, model rejection, graph failure, and isolation recovery.
Those tests live under `packages/subagent/test/`. They remain component evidence, not additional completed pstack programs.

| Route                                           | Coverage                                        | Remaining full-flow proof                                              |
| ----------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| Investigation and Architect grounding           | How and Why dispatches and dependency transport | Correct explanation, rationale, and design choices                     |
| Feature alternatives and No-comments escalation | Arena, Architect, and review dispatches         | Correct selection, grafting, comment exceptions, and retry judgment    |
| Prototype and skill-authoring handoff           | Downstream Feature and publication contracts    | Organic handoff and generated artifact quality                         |
| Orchestrate pilot, track, audit, and worker     | Local Task contracts and nested attenuation     | Rolling-window scheduling, ledger correctness, and program convergence |
| Destination publication and stack topology      | Isolation boundary and publication guidance     | Authenticated push, PR, rebase, and stack operations                   |
| Babysit and retro monitoring                    | Worker contracts and Loop component tests       | Real CI, review events, and post-merge findings                        |
| Pause, cancellation, replacement, and recovery  | Subagent component tests                        | Program-wide zero-write holds and durable pickup                       |
| First-pass, best-of, dropout, and reframing     | Result transport and component failure tests    | Correct acceptance rule and complete coverage accounting               |
| Parent decisions                                | Private dispatcher and decision component tests | Correct escalation of real product and permission choices              |
| Setup-pstack                                    | Available-model discovery and role transport    | Interactive policy selection and diverse real-model execution          |
| Create-verification-skill                       | No independent Task dispatch prescribed         | Generate and execute a project-specific live driver                    |
| Eval                                            | Dispatch integration only                       | BLOCKED under the standard revealing bootstrap                         |

No additional remote-agent dispatch transport appears in the audited pstack specifications.
External APIs, Git hosting, and cloud browser drivers are dependencies, not additional Task transports.

## Outstanding validation

The complete request remains partially blocked on Anthropic credit, external targets, and the remaining autonomous execution review.
Available-model discovery succeeds. It does not prove successful requests to each model provider.

Full validation still needs these outcomes:

- Autonomous models select and follow each skill without scripted tool decisions.
- Reviewers produce independent, supported findings and select valid artifacts.
- Different-family requirements use verified, responsive providers.
- Why queries the applicable source categories and preserves real citations.
- Runtime lanes drive the target product at its exact revision.
- Publication, stack, and CI paths run against authorized disposable targets.
- Eval uses an environment that satisfies its complete blinding contract.

Do not convert these unexecuted outcomes into PASS because the local SDK tests pass.

## Live validation

`packages/pstack/test/live-workflows.test.js` captures autonomous execution for each of the 68 roles and 14 workflow variants.
It preserves the configured model policy, real tool calls, child transcripts, worktree snapshots, errors, and unfinished phases.
A successful harness test means evidence capture completed. It does not mean that the workflow passed.
Each result starts as `REQUIRES_REVIEW`.

Run selected cases with a new evidence directory:

```sh
PSTACK_LIVE=1 PSTACK_LIVE_DIR=/tmp/pstack-live-new PSTACK_LIVE_CASES=how-explorer PSTACK_LIVE_TIMEOUT_MS=300000 NODE_OPTIONS=--max-old-space-size=512 bun run test packages/pstack/test/live-workflows.test.js --maxWorkers=1
```

Run one case per process on a constrained workstation. Do not overlap live capture with repository suites.
Check available disk space before each case. The latest serial batch required at least 8 GiB free and stopped on failure.
The heap limit bounds V8 memory, not total machine memory. It does not guarantee that every nested workflow fits.
The harness rejects existing case directories rather than overwriting evidence.
Each coordinator has an eight-minute deadline. History preparation uses separate ninety-second deadlines.
Local concurrency is limited to three active children per admission check. The harness prohibits publication and external mutation.
These tool guards are not an operating-system sandbox.

Fixtures provide distinct inputs for refactoring, regression investigation, performance, trace inspection, design comparison, maintenance, worktree investigation, and local shipping verification.
Performance fixtures preserve an exact-output correctness gate alongside a measured workload.
Historical fixtures contain actual model-selected CLI checks. Their fictional requests do not establish preferences of the real user.
Source observations supplied directly by the harness remain labeled as fixture input, not executed upstream-agent results.

The initial pilot retained these findings:

- `how-simple`: Anthropic returned HTTP 400 requiring extra-usage credit. No model fallback occurred.
- `how-explorer`: the configured Luna model completed an explanation, but parent transcript auditing returned `OUT_OF_SCOPE`.
- `feature-leaf`: Astra reproduced duplicate output, added a regression, implemented stable deduplication, and passed the actual CLI checks.
- The feature coordinator left acceptance unfinished because the mandatory independent Comment Sicko phase did not execute.

The history failure exposed two integration defects: children ignored custom parent stores, and managed-worktree sessions failed the exact-directory filter.
The correction shares parent storage and admits only linked descendants inside the actual managed Git boundary.
Additional SDK regressions cover nested owners, sibling managed descendants, linked Git roots, cleanup, duplicate IDs, cycles, symlink escapes, and unrelated projects.
The original evidence remains under `/tmp/pstack-live-local-v1`. The corrected pilot uses `/tmp/pstack-live-local-v2`.

### Reviewed serial retries

The retained audit is `/tmp/pstack-live-audit.json`. Results and original tool transcripts remain under the evidence directories below.

| Cases                                                   | Evidence                                   | Reviewed result                                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `swarm-runtime`                                         | `/tmp/pstack-live-local-v5/swarm-runtime/` | Real CLI results and strict structured output passed. Manual receipt contains no product changes.                                |
| `why-followup`                                          | `/tmp/pstack-live-local-v5/why-followup/`  | Actual resume preserves agent ID, role, model, and profile. Initial citations were corrected.                                    |
| `why-tickets`, `why-documents`, `why-chat`              | `/tmp/pstack-live-local-v5/`               | Separate category packets, linked source guides, and fixture provenance verified. Documents made an unnecessary filename search. |
| `why-source-control`, `why-observability`, `why-errors` | `/tmp/pstack-live-local-v6/`               | Retried after citation failures. Actual numbered grep results support the corrected citations.                                   |
| `why-analytics`                                         | `/tmp/pstack-live-local-v7/why-analytics/` | Corrected citations and parent-search provenance. An unnecessary filename search remains a process caveat.                       |
| `why-synthesis`                                         | `/tmp/pstack-live-local-v5/why-synthesis/` | Supplied-input synthesis distinguishes fixture observations, executed baseline evidence, and unexecuted implementation phases.   |

These are scoped local results, not authenticated external investigations or complete workflow approvals.
The investigator template now requires numbered citation checks and separates investigator reads from recorded parent searches.
The parent must correct citation or provenance failures before acceptance.

### Temporary fast-model pilot

The user authorized temporary model substitutions without changing the global configuration.
The harness accepts `PSTACK_LIVE_POLICY_FILE`, `PSTACK_LIVE_COORDINATOR_MODEL`, and `PSTACK_LIVE_COORDINATOR_EFFORT`.
The coordinator model is an available `openai-codex` model ID. Supported coordinator effort overrides are `low` and `medium`.
An explicit policy override is passed to the pstack extension through its `modelPolicyPath` loader option and recorded in every result. The harness does not inject raw policy text or copy it into AGENTS.md. Root and nested policy context comes from the actual extension.
Panel entry counts and mandatory different-family review requirements remain unchanged.

| Configuration                       | Case            | Elapsed     | Reviewed outcome                                                                                       |
| ----------------------------------- | --------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| Spark coordinator and worker        | `how-simple`    | 27 seconds  | Dispatch succeeded, but the child skipped mandatory skill reads. Not approved.                         |
| Mini coordinator and worker         | `how-simple`    | 83 seconds  | Three invalid Task calls preceded recovery. Mandatory child skill reads remained absent. Not approved. |
| Astra low coordinator, Spark worker | `how-simple`    | 65 seconds  | Required reads and dispatch worked. Report contained an incorrect edge-case claim. Not approved.       |
| Astra low coordinator, Spark worker | `swarm-runtime` | 102 seconds | Actual CLI checks passed. Coordinator corrected a README claim. Scoped verification only.              |
| Astra low coordinator, Spark worker | `why-followup`  | 201 seconds | Same-agent resume preserved identity. Report retained provenance and reasoning defects. Not approved.  |

Spark refers to `gpt-5.3-codex-spark`, Mini to `gpt-5.4-mini`, and Astra to `gpt-6-astra`.
Every temporary worker used low reasoning effort. These timings describe different runs, not a controlled performance benchmark.
The global model-policy SHA-256 remained unchanged across the pilot.
Evidence remains under `/tmp/pstack-fast-v1/`, `/tmp/pstack-fast-mini-v1/`, and `/tmp/pstack-fast-hybrid-v1/`.
This pilot does not approve the complete workflow matrix or the original model policy.

### Resource failures

Earlier overlapping suite runs reached timeouts and disk exhaustion. Their failed reports remain available and do not count as passes.
The serial full suite subsequently passed all 1,624 tests with a 512 MiB Node heap limit.

The later `orchestrate-track` live case exhausted that heap limit near its five-minute deadline.
Its batch stopped before `orchestrate-static`. The failed attempt retains transcripts but no terminal `result.json`.
An instrumented retry stopped producing worker timer samples when nested `TaskControl wait` began.

A bounded regression reproduced a progress-notification feedback loop: unchanged updates triggered fresh runtime notifications and repeated publication.
`JobProgress` now suppresses unchanged watched-job notifications. Its timer still refreshes elapsed time, and meaningful job changes still publish.
The regression and focused job/control suites pass.

The real nested track then completed under the same 512 MiB heap limit, with an eight-minute deadline.
The worker's sampled peak heap was 71.9 MiB and sampled peak RSS was 217.6 MiB. No early memory guard fired.
Actual receipts confirm nested and root patch integration. Destination CLI output matched, and all four fixture tests passed.
This validates the scoped track, not external orchestration, publication, or the remaining workflow variants.

Evidence:

- Failed attempt: `/tmp/pstack-live-v5-orchestrate-track.log` and `/tmp/pstack-live-local-v5/orchestrate-track/sessions/`.
- Diagnostic timer samples: `/tmp/pstack-heap-v1/`.
- Successful retry: `/tmp/pstack-live-heap-v2/orchestrate-track/result.json`.
- Successful retry memory samples: `/tmp/pstack-heap-v2/`.

Anthropic-dependent roles remain provider-blocked until the configured account accepts requests.
Eval remains blocked by the revealing standard bootstrap.
Publication, remote stacks, CI monitoring, and external source searches remain unverified without their authorized targets.
