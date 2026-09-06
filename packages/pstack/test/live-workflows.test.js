import { execFile } from 'node:child_process'
import { appendFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { createSessionTodoTools } from '@nothingrotf/todo/headless'
import { describe, it } from 'vite-plus/test'

import sessionHistory from '../../session-history/src/index.ts'
import { registerSubagent } from '../../subagent/src/index.ts'
import { loadPstackBootstrap } from '../src/bootstrap.ts'
import pstack from '../src/index.ts'
import { prepareLiveFixture } from './live-fixtures.js'
import { workflowCases } from './workflow-cases.js'
import { workflowGraphs } from './workflow-graphs.js'

const enabled = process.env.PSTACK_LIVE === '1'
const destination = process.env.PSTACK_LIVE_DIR
const selected = process.env.PSTACK_LIVE_CASES?.split(',')
const deadlineMs = Number(process.env.PSTACK_LIVE_TIMEOUT_MS ?? 480_000)
const execute = promisify(execFile)

const scenarios = [
  ...workflowCases.map((scenario) => ({ ...scenario, mode: 'delegate' })),
  ...workflowGraphs.map((graph) => {
    const first = workflowCases.find((scenario) => scenario.id === graph.nodes[0]?.scenario)
    if (first === undefined) throw new Error(`No source for ${graph.id}`)
    const source = graph.id.startsWith('autopilot-full')
      ? 'poteto-mode/playbooks/autopilot-full.md'
      : graph.id.startsWith('autopilot-stack')
        ? 'poteto-mode/playbooks/autopilot-stack.md'
        : graph.id.startsWith('multi-phase')
          ? 'poteto-mode/playbooks/multi-phase-plan.md'
          : first.source
    return { ...first, source, id: `flow-${graph.id}`, mode: 'workflow', graph: graph.id }
  }),
].filter((scenario) => selected === undefined || selected.includes(scenario.id))

async function fixture(directory) {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, '.gitignore'), 'sessions/\nagent/\n')
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ type: 'module', scripts: { test: 'bun test' } }),
  )
  await writeFile(
    join(directory, 'names.js'),
    'export function normalizeNames(values) {\n  return values.map((value) => value.trim()).filter(Boolean)\n}\n',
  )
  await writeFile(
    join(directory, 'cli.js'),
    'import { normalizeNames } from "./names.js"\nconst values = process.argv.slice(2)\nconsole.log(JSON.stringify(normalizeNames(values)))\n',
  )
  await writeFile(
    join(directory, 'names.test.js'),
    'import { expect, test } from "bun:test"\nimport { normalizeNames } from "./names.js"\ntest("trims names and removes blanks", () => {\n  expect(normalizeNames([" Ada ", "", " Lin "])).toEqual(["Ada", "Lin"])\n})\n',
  )
  await writeFile(
    join(directory, 'README.md'),
    '# Name list\n\nRun `bun cli.js " Ada " "" " Lin "` to print normalized names as JSON.\nRun `bun test` to verify trimming and blank removal. Duplicate names currently remain.\nThe requested enhancement is stable deduplication after trimming. Keep the first occurrence and preserve order.\n',
  )
  await writeFile(
    join(directory, 'evidence.md'),
    '# Supplied local evidence\n\nThese are fixture records, not records from external services.\n- Source control: the baseline preserves input order and removes blank names.\n- Product request: repeated names must appear only once, preserving the first occurrence.\n- Documents: callers expect JSON arrays, not sorted output.\n- Chat: no additional evidence supplied.\n- Observability: no production telemetry supplied.\n- Errors: no incidents supplied.\n- Analytics: no usage data supplied.\n\nDo not invent external citations. Distinguish fixture facts, absent evidence, and inference.\n',
  )
  await writeFile(
    join(directory, 'AGENTS.md'),
    '# Local scope\n\nWork only in this disposable repository or its managed Task worktrees. Read installed pstack skills without editing them. Never access credentials or unrelated sessions. No network commands, publication, PR creation, pushes, merges, deployments, service mutations, or global configuration writes. No code comments or em dashes. Local commits and tests are permitted. Use Bun. When an unavailable tool or forbidden external step blocks a workflow, report BLOCKED with the exact reason. Never substitute self-review for mandatory independent review.\n',
  )
  await execute('git', ['init', '--quiet'], { cwd: directory })
  await execute('git', ['add', '.'], { cwd: directory })
  await execute(
    'git',
    [
      '-c',
      'user.name=Local Verification',
      '-c',
      'user.email=local@example.test',
      'commit',
      '--quiet',
      '-m',
      'Initial name normalization',
    ],
    { cwd: directory },
  )
}

function objective(scenario) {
  if (scenario.id.includes('eval'))
    return 'Assess whether the local environment can satisfy the Eval blinding prerequisites. Do not run an unblinded candidate as though it were blinded.'
  if (scenario.role.startsWith('how'))
    return 'Explain normalizeNames and the CLI call path, ownership, data flow, and edge cases. For a critic, review that architecture rather than implementing changes.'
  if (scenario.role.startsWith('why'))
    return 'Explain the rationale and evidence gaps for order-preserving normalization using evidence.md and local code. The root supplies the available fixture evidence. Do not claim searches of external categories.'
  if (
    scenario.role.startsWith('reflect') ||
    scenario.id.startsWith('automate') ||
    scenario.id.includes('recall') ||
    scenario.id.includes('trail') ||
    scenario.id.includes('pickup')
  )
    return 'Analyze only supplied evidence.md and the local execution evidence. If the exact workflow requires session_history or a different-family review that is unavailable, identify that prerequisite and stop that affected phase.'
  if (
    scenario.role === 'interrogate reviewers' ||
    scenario.id.includes('judge') ||
    scenario.id.includes('auditor')
  )
    return 'Independently review whether stable deduplication after trimming fits this CLI contract. Cite the actual code, note risks, and give an evidenced recommendation without changing product files.'
  if (scenario.kind === 'verifier')
    return 'Verify the current CLI through its real command line. Run bun cli.js with spaced, blank, and duplicate names. Distinguish current behavior from the requested deduplication enhancement. Preserve product files.'
  if (scenario.kind === 'writer')
    return 'Implement stable deduplication after trimming in normalizeNames. Preserve order and blank removal. Add a meaningful regression and verify the actual CLI. If this is a sketch or design role, produce only its scoped design artifact. If the named workflow requires unavailable performance evidence, trace data, comments, PRs, or a different artifact, report the mismatch instead of inventing it.'
  return 'Inspect this small CLI and return the bounded evidence or review that the named role requires. Do not edit product files. Report missing prerequisites rather than inventing sessions, traces, worktrees, or external state.'
}

function prompt(scenario, root, localGoal) {
  const scope =
    'Execute only local work. Do not publish PRs, push, merge, deploy, mutate external services, or write outside the disposable repository. Preserve explicit approvals and missing-prerequisite blockers. Run lanes serially or in waves of at most three active children, including owners. Do not launch a large swarm. Do not edit installed skills. Do not launch unrelated work. Reading applicable global and project AGENTS.md instructions is permitted, but credentials and unrelated sessions remain forbidden. Audit each dispatched child with session_history tool_activity before concluding. A completion flag alone does not prove the required work.'
  if (scenario.mode === 'workflow') {
    return `${scope}\nRead ${join(root, scenario.source)} and run its local workflow for this repository. The requested workflow variant is ${scenario.graph}. Determine the Task calls yourself from the skill, including roles, profiles, model policy, independent reviews, and dependencies. Run only this workflow now. ${localGoal ?? objective(scenario)}\nReview actual child results and artifacts before concluding. Return a concise verdict with local work completed, observed integration failures, and blocked phases. Do not claim a full workflow pass if a mandatory phase did not execute.`
  }
  return `${scope}\nValidate the ${scenario.id} scenario as one real delegated role from ${join(root, scenario.source)}. Read that source first, then dispatch exactly one initial Task with subagent_type ${scenario.type}, role ${scenario.role}, and capability_profile ${scenario.profile}. Resolve its model from the supplied real pstack model policy. For a panel role, use its first configured entry in this single-role probe. Additional delegation is allowed only when required. A leaf cannot delegate, but you can dispatch independent root reviewers for coordinator-owned phases. Do not treat a leaf limitation as a restriction on the root.\nThe child must read its relevant skill references and act independently on this scope: ${localGoal ?? objective(scenario)}\n${scenario.kind === 'static' ? 'The child is read-only.' : `Use mutable managed worktree isolation with integration ${scenario.kind === 'verifier' ? 'manual' : (scenario.integration ?? 'apply')}.`}\nUse native completion and TaskControl. Review the actual result and diff. Do not apply verifier or candidate patches. Do not silently substitute tools or models. Return a concise verdict with observed evidence and exact blockers. This is a scoped role probe, not permission to claim the entire enclosing workflow completed.`
}

async function inspectTranscript(path) {
  const entries = (await readFile(path, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  const messages = entries.filter((entry) => entry.type === 'message').map((entry) => entry.message)
  return {
    tools: messages.flatMap((message) =>
      Array.isArray(message.content)
        ? message.content
            .filter((part) => part.type === 'toolCall')
            .map((part) => ({ name: part.name, arguments: part.arguments }))
        : [],
    ),
    errors: messages
      .filter((message) => message.role === 'toolResult' && message.isError)
      .map((message) => ({ tool: message.toolName, content: message.content })),
    models: [
      ...new Set(
        messages
          .filter((message) => message.role === 'assistant')
          .map((message) => `${message.provider}/${message.model}`),
      ),
    ],
    final: messages.findLast((message) => message.role === 'assistant')?.content,
  }
}

async function historySeeds(scenario, directory, caseRoot, model, modelRuntime, boundary) {
  if (!/automate|reflect|recall|trail|pickup|retro/.test(scenario.id)) return []
  const captured = []
  for (let index = 0; index < (scenario.id.includes('automate') ? 3 : 1); index += 1) {
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    })
    const resourceLoader = new DefaultResourceLoader({
      cwd: directory,
      agentDir: join(directory, 'agent'),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      settingsManager,
      extensionFactories: [boundary],
    })
    await resourceLoader.reload()
    const { session } = await createAgentSession({
      cwd: directory,
      model,
      modelRuntime,
      thinkingLevel: 'low',
      resourceLoader,
      settingsManager,
      sessionManager: SessionManager.create(directory, join(caseRoot, 'sessions')),
      tools: ['read', 'bash'],
    })
    let timedOut = false
    let abortError
    let aborting = Promise.resolve()
    const timer = setTimeout(() => {
      timedOut = true
      aborting = session.abort().catch((failure) => {
        abortError = String(failure)
      })
    }, 90000)
    try {
      await session.prompt(
        `This is fictional local history fixture ${index + 1}, not a real user's preference record. Inspect the local README first. Run bun test and the actual CLI with spaced names, blanks, and repeated names. Do not edit files, invoke network commands, access credentials, or delegate. For this fixture, prefer real interface checks and concise evidence over claiming success from source inspection. Report commands, observed stdout, and limitations.`,
      )
      await session.agent.waitForIdle()
      captured.push({
        transcript: session.sessionFile,
        timedOut,
        observed: await inspectTranscript(session.sessionFile),
      })
    } finally {
      clearTimeout(timer)
      await aborting
      session.dispose()
    }
    if (abortError !== undefined) throw new Error(abortError)
    if (timedOut) throw new Error('Local history preparation reached its explicit deadline')
  }
  await writeFile(join(caseRoot, 'history-seeds.json'), JSON.stringify(captured, null, 2))
  return captured
}

describe.skipIf(!enabled)('capture real-model pstack local workflow evidence', () => {
  it.each(scenarios)(
    '$id',
    async (scenario) => {
      if (destination === undefined)
        throw new Error('PSTACK_LIVE_DIR is required for retained evidence')
      const requestedRoot = resolve(destination, scenario.id)
      await mkdir(resolve(destination), { recursive: true })
      await mkdir(requestedRoot)
      const caseRoot = await realpath(requestedRoot)
      const directory = join(caseRoot, 'project')
      await fixture(directory)
      const localGoal = await prepareLiveFixture(directory, scenario)
      const policy = await readFile(join(homedir(), '.agents/rules/pstack-models.md'), 'utf8')
      const bootstrap = await loadPstackBootstrap()
      const modelRuntime = await ModelRuntime.create()
      const model = modelRuntime.getModel('openai-codex', 'gpt-6-astra')
      if (model === undefined) throw new Error('Configured coordinator model is unavailable')
      let runtime
      const boundaries = []
      const boundary = (pi) => {
        pi.on('tool_call', (event, ctx) => {
          let reason
          if (event.toolName === 'Task') {
            const proposed = Array.isArray(event.input.tasks) ? event.input.tasks.length : 1
            const active = runtime
              .listSnapshots()
              .filter((snapshot) => snapshot.status === 'running').length
            if (active + proposed > 3)
              reason =
                'At most three active children are permitted. Execute remaining lanes serially.'
          }
          if (
            event.toolName === 'bash' &&
            /\b(gh|gt|curl|wget|ssh|scp)\b|git\s+(push|merge)(?:\s|$)|\b(npm|bun)\s+(publish|install|add)\b/.test(
              event.input.command ?? '',
            )
          ) {
            reason =
              'External operations and dependency mutations are outside this local validation scope.'
          }
          if (['write', 'edit'].includes(event.toolName)) {
            const target = resolve(ctx.cwd, event.input.path ?? '')
            if (target !== caseRoot && !target.startsWith(`${caseRoot}/`))
              reason = 'Writes outside the disposable repository are forbidden.'
          }
          if (reason !== undefined) {
            boundaries.push({ tool: event.toolName, input: event.input, reason })
            return { block: true, reason }
          }
        })
      }
      const historical = await historySeeds(
        scenario,
        directory,
        caseRoot,
        model,
        modelRuntime,
        boundary,
      )
      const observer = (pi) => {
        for (const tool of createSessionTodoTools()) pi.registerTool(tool)
        boundary(pi)
        pi.events.on('@nothingrotf/subagent/register-capabilities', (publication) => {
          for (const registration of publication.registrations) {
            if (
              !registration.extensions.some(
                (extension) => extension.name === 'local-validation-boundary',
              )
            ) {
              registration.extensions.push({
                name: 'local-validation-boundary',
                factory: boundary,
                hidden: true,
              })
            }
          }
        })
      }
      const settingsManager = SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: false },
      })
      const loader = new DefaultResourceLoader({
        cwd: directory,
        agentDir: join(directory, 'agent'),
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        settingsManager,
        appendSystemPrompt: [
          `You are the coordinator for one local, disposable pstack workflow. Follow the user scope over skill autonomy language. Never publish, push, merge, deploy, mutate external services, access credentials, or modify installed skills. Only local repository work is authorized.\n${policy}\n${bootstrap.systemPrompt}`,
        ],
        extensionFactories: [
          observer,
          sessionHistory,
          pstack,
          (pi) => {
            runtime = registerSubagent(pi, Math.min(deadlineMs, 300_000))
          },
        ],
      })
      await loader.reload()
      const { session } = await createAgentSession({
        cwd: directory,
        model,
        modelRuntime,
        thinkingLevel: 'medium',
        resourceLoader: loader,
        settingsManager,
        sessionManager: SessionManager.create(directory, join(caseRoot, 'sessions')),
        tools: [
          'read',
          'grep',
          'find',
          'ls',
          'bash',
          'edit',
          'write',
          'todo_read',
          'todo_write',
          'Task',
          'TaskControl',
          'session_history',
        ],
      })
      const events = []
      session.subscribe((event) => {
        if (event.type === 'tool_execution_start')
          events.push({
            type: event.type,
            tool: event.toolName,
            arguments: event.args,
            at: Date.now(),
          })
        if (event.type === 'tool_execution_end')
          events.push({
            type: event.type,
            tool: event.toolName,
            error: event.isError,
            at: Date.now(),
          })
      })
      const startedAt = Date.now()
      let timedOut = false
      let error
      let aborting = Promise.resolve()
      const timer = setTimeout(() => {
        timedOut = true
        aborting = Promise.all([
          session.abort(),
          runtime.shutdown('Local workflow deadline reached'),
        ]).catch((failure) => {
          error = String(failure)
        })
      }, deadlineMs)
      await appendFile(
        join(destination, 'progress.jsonl'),
        `${JSON.stringify({ id: scenario.id, event: 'started', at: startedAt })}\n`,
      )
      try {
        await session.prompt(prompt(scenario, bootstrap.root, localGoal))
        await session.agent.waitForIdle()
      } catch (failure) {
        error = String(failure)
      } finally {
        clearTimeout(timer)
        await aborting
        await runtime.shutdown('Local workflow finished')
        const snapshots = runtime.listSnapshots()
        const children = []
        for (const snapshot of snapshots) {
          const record = runtime.getRecord(snapshot.agentId)
          if (record !== undefined)
            children.push({
              snapshot,
              transcript: record.sessionFile,
              error: record.error,
              observed: await inspectTranscript(record.sessionFile),
            })
        }
        const diff = await execute('git', ['diff', '--stat'], { cwd: directory })
        const result = {
          id: scenario.id,
          mode: scenario.mode,
          source: scenario.source,
          policy,
          objective: localGoal ?? objective(scenario),
          startedAt,
          endedAt: Date.now(),
          timedOut,
          error,
          historical,
          coordinatorTranscript: session.sessionFile,
          coordinator: await inspectTranscript(session.sessionFile),
          children,
          boundaries,
          events,
          diff: diff.stdout,
          classification: 'REQUIRES_REVIEW',
        }
        await writeFile(join(caseRoot, 'result.json'), JSON.stringify(result, null, 2))
        await appendFile(
          join(destination, 'progress.jsonl'),
          `${JSON.stringify({ id: scenario.id, event: 'finished', timedOut, error, children: children.length, at: Date.now() })}\n`,
        )
        session.dispose()
      }
    },
    deadlineMs + 360_000,
  )
})
