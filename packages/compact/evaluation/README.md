# Compaction evaluation

## Protocol

`cases.ts` defines six independent synthetic histories with four fixed-choice questions each.
The questions cover requirement changes, resolved failures, rejected hypotheses, blockers, quoted injection, and Portuguese constraints.
Gold answers are fixed before execution and never enter model requests.

`compare.ts` runs the production compiler in deterministic and hybrid modes with the same retained boundary and total character budget.
The model answers identical questions from each resulting context and from the full-history control.
The retained tail contains no answers, and probes cannot call recall tools.
Probe order rotates to reduce order effects.

The scorer validates raw JSON, rejects unexpected answer IDs, and keeps the denominator fixed.
Missing, duplicate, malformed, and out-of-range answers count as invalid, not as excluded questions.
The report separates enrichment usage from probe usage.

Ordinary tests use scripted completions and do not contact providers.
See the package README for the opt-in live command.

## First live run

- Recorded time: `2026-09-05T19:55:22.570Z`.
- Model: `openai-codex/gpt-6-astra`.
- Repetitions: one.
- Corpus SHA-256: `e45f0b9aa7aad295afe1bbd3f53a81291114082853c6b8b6aa933c3e9c32e9e1`.
- Local raw artifact: `.verification/compact/evaluation-first.json`, excluded from Git.
- Original temporary artifact: `/tmp/compact-evaluation-first.json`.

| Mode          | Correct answers | Mean context characters | Mean compaction latency |
| ------------- | --------------: | ----------------------: | ----------------------: |
| Full history  |           24/24 |                  12,138 |          Not applicable |
| Deterministic |           24/24 |                   5,769 |                 0.97 ms |
| Hybrid        |           24/24 |                   6,806 |                 26.91 s |

All six enrichment responses passed schema and citation validation.
No fallback or invalid probe response occurred.
The hybrid contexts were about 18% larger than the deterministic contexts.

Enrichment consumed 16,776 input tokens and 4,899 output tokens across six requests.
Its reported cost estimate totaled $0.41271.
The entire experiment, including 18 probes, reported $0.82917.
These figures reflect model usage metadata, not verified subscription billing.

## Interpretation

This run did not demonstrate an accuracy benefit from enrichment.
Hybrid mode added latency and context size without improving the measured score.
The default therefore remains deterministic, and hybrid mode remains an explicit session-level option.

Perfect scores do not establish equivalence between the modes.
The cases contain only about 11,000 source characters each, and all three modes reached the evaluation ceiling.
The sample is small, synthetic, and lacks confidence intervals.
Shared model biases and multiple-choice guessing can also affect the result.

## Next evidence needed

- Evaluate long histories that exceed category limits and force meaningful omissions.
- Evaluate several consecutive compactions, including changed decisions after fallback checkpoints.
- Measure actual continuation tasks, repeated work, and unsupported actions rather than only question answering.
- Use a separate held-out corpus before changing extraction prompts or selection rules.
- Compare cheaper extraction models and report their settings separately from the continuation model.
- Use sanitized real sessions only with explicit authorization for their transmission.

Do not enable hybrid mode automatically based on this initial result.
