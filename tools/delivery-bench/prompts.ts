import { criteria } from './fixture.ts'

export type Arm = 'baseline' | 'workspace'

export const arms: readonly Arm[] = ['baseline', 'workspace']

export interface ReviewModels {
  code: string
  runtime: string
}

const issue = 'PRICE-1'

const firstRound =
  'Fix only the bulk discount boundary in src/pricing.ts in this round, and add a test for quantity 10. Leave the unknown criterion pending for the next round, and return a WIP report that says so. Run bun test before you report.'

const secondRound =
  'Next round: make priceOf throw UnknownSkuError, exported from src/pricing.ts, for a SKU that the catalog lacks, and add a test. Run bun test, then return a candidate report if every criterion passes.'

const freshSecondRound = `The previous owner fixed the bulk discount boundary and its test, and that work is already in this checkout. ${secondRound}`

const managed = `delivery {"kind":"managed","issue":"${issue}"}`

const owner = `subagent_type "generalPurpose", role "bug-fix", capability_profile "pstack-leaf", ${managed}, run_in_background false, description "Fix pricing"`

function openStep(): string {
  return [
    `Call pstack_delivery with action "open", issue "${issue}", runtimeRequired true, and these criteria:`,
    ...criteria.map((criterion) => `   - id "${criterion.id}": "${criterion.description}"`),
  ].join('\n')
}

function reviewNodes(models: ReviewModels, runtimeIsolation: string): string {
  return [
    `   - id "static", description "Static review", role "code review", subagent_type "generalPurpose", capability_profile "pstack-leaf", readonly true, model "${models.code}", ${managed}, prompt "Review the pricing change in the current directory statically against the criteria."`,
    `   - id "runtime", description "Runtime verification", role "runtime verification", subagent_type "generalPurpose", capability_profile "pstack-leaf", readonly false, model "${models.runtime}", ${managed}${runtimeIsolation}, prompt "Verify the pricing change in the current directory against the criteria. Do not change any tracked file."`,
  ].join('\n')
}

function baselinePrompt(models: ReviewModels): string {
  const isolation = 'isolation {"mode":"worktree","integration":"apply"}'
  const integrate =
    'If its summary.integration is not "integrated", call TaskControl with action "join" for that agent, then call pstack_delivery with action "refresh" for it.'
  return [
    'You are running a delivery benchmark. Follow these steps exactly. Never edit files yourself, never call pstack_delivery with action "workspace", and never publish.',
    '',
    `1. ${openStep()}`,
    `2. Dispatch one Task with ${owner}, ${isolation}, and prompt "${firstRound}"`,
    `3. Call pstack_delivery with action "record" for that agent. ${integrate}`,
    `4. Dispatch a new Task, not a resume, with the same settings and prompt "${freshSecondRound}"`,
    `5. Call pstack_delivery with action "record" for the new agent. ${integrate}`,
    '6. Dispatch one Task call with a tasks array of these two nodes, without run_in_background:',
    reviewNodes(models, ', isolation {"mode":"worktree","integration":"manual"}'),
    '7. Call pstack_delivery with action "record" for each review agent.',
    `8. Call pstack_delivery with action "read" and issue "${issue}". Print summary.state.`,
    'If any step fails, retry it once after reading the error. If it fails again, print the error and stop.',
  ].join('\n')
}

function workspacePrompt(models: ReviewModels): string {
  return [
    'You are running a delivery benchmark. Never edit files yourself, and never publish.',
    '',
    `1. ${openStep()}`,
    '2. Follow the next field of each checkpoint until next.step is "publish". Use these settings:',
    `   - workspace: call pstack_delivery with action "workspace" and issue "${issue}".`,
    `   - implement: dispatch one Task with ${owner}, and prompt "${firstRound}" Omit cwd and isolation.`,
    `   - correct: resume next.resume with subagent_type "generalPurpose", run_in_background false, description "Fix pricing", and prompt "${secondRound}"`,
    '   - review: dispatch one Task call with a tasks array of the named roles, without run_in_background. Omit cwd and isolation:',
    reviewNodes(models, ''),
    '   - record: call pstack_delivery with action "record" for each named agent.',
    `3. When next.step is "publish", call pstack_delivery with action "read" and issue "${issue}". Print summary.state.`,
    'If any step fails, retry it once after reading the error. If it fails again, print the error and stop.',
  ].join('\n')
}

export function benchmarkPrompt(arm: Arm, models: ReviewModels): string {
  return arm === 'baseline' ? baselinePrompt(models) : workspacePrompt(models)
}
