import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import { captureWorkspaceSnapshot, validateOutputSchema } from '@nothingrotf/subagent'
import { Type } from 'typebox'
import { describe, expect, it } from 'vite-plus/test'

import { readDeliveryJournal } from '../src/delivery-journal.ts'
import {
  deliveryReviewerPacket,
  MINIMUM_COMPLETION_WAIT_MS,
  normalizeCompletionWait,
  registerDeliveryProtocol,
  validateDeliveryTerminal,
} from '../src/delivery-tools.ts'
import {
  deliveryRepairIdentity,
  DeliveryOutputSchema,
  recordDelivery,
  repairDeliveryReport,
} from '../src/delivery.ts'

const execFile = promisify(execFileCallback)

function retainedIssue(sessionManager, issue) {
  const journal = readDeliveryJournal(sessionManager.getBranch(), sessionManager.getSessionId())
  if (!journal.ok) throw journal.error
  return journal.value.issues.get(issue)
}

function digest(content) {
  return createHash('sha256').update(content).digest('hex')
}

function reply(model, content, stopReason) {
  return {
    api: model.api,
    content,
    model: model.id,
    provider: model.provider,
    role: 'assistant',
    stopReason,
    timestamp: Date.now(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  }
}

function emptyDeliveryIssue(ownerSessionId, issue) {
  return {
    createdAt: 0,
    criteria: [{ description: 'The report identifies the evidence.', id: 'receipt' }],
    issue,
    ownerSessionId,
    runtimeRequired: false,
    submissions: [],
    version: 1,
  }
}

function deliveryIssue(ownerSessionId, diagnosis) {
  const issue = {
    createdAt: 0,
    criteria: [{ description: 'The command returns a receipt.', id: 'receipt' }],
    issue: 'retries',
    ownerSessionId,
    runtimeRequired: false,
    submissions: [],
    version: 1,
  }
  const incomplete = {
    agentId: 'implementer',
    attempt: 1,
    evidence: [],
    execution: 'failed',
    integration: 'captured',
    recordedAt: 1,
    report: {
      criteria: [],
      failureClass: 'execution-contract',
      findings: [],
      issue: issue.issue,
      kind: 'implementation',
      reason: 'The edit did not match.',
      state: 'wip',
    },
    role: 'feature',
  }
  const first = recordDelivery(issue, incomplete)
  if (!first.ok) throw first.error
  const second = recordDelivery(first.value, { ...incomplete, attempt: 2, recordedAt: 2 })
  if (!second.ok) throw second.error
  if (!diagnosis) return second.value
  const diagnostic = recordDelivery(second.value, {
    agentId: 'diagnostician',
    attempt: 1,
    evidence: [
      {
        id: 'failure',
        kind: 'failure',
        passed: true,
        reference: 'file:///diagnosis',
        sha256: 'a'.repeat(64),
      },
    ],
    execution: 'completed',
    integration: 'captured',
    recordedAt: 3,
    report: {
      criteria: [],
      failureClass: 'execution-contract',
      findings: [],
      issue: issue.issue,
      kind: 'diagnosis',
      reason: 'The edit target changed before the correction.',
      state: 'wip',
    },
    role: 'hardest tasks',
  })
  if (!diagnostic.ok) throw diagnostic.error
  return diagnostic.value
}

function runRecord(ownerSessionId, agentId, execution) {
  const record = {
    agentId,
    background: false,
    createdAt: 0,
    description: 'Managed task',
    effort: 'low',
    fast: false,
    model: 'delivery-test/model',
    modelSelector: 'delivery-test/model:low',
    output: 'issue: delivery-tools\nThe task did not finish.',
    ownerSessionId,
    readonly: false,
    role: 'feature',
    sessionFile: '/tmp/delivery-tools.jsonl',
    status: 'failed',
    subagentType: 'generalPurpose',
    updatedAt: 1,
  }
  if (execution !== undefined) record.execution = execution
  return record
}

function runtimeState(ownerSessionId, records) {
  return { ownerSessionId, records, rootStores: [], runs: [], version: 6, workspaces: [] }
}

function deliveryBinding(ownerSessionId, agentId, issue) {
  return {
    agentId,
    issue,
    ownerSessionId,
    toolCallId: `retained-${agentId}`,
  }
}

function resumeContract(logicalCwd = '/tmp', version = 4, isolation) {
  const contract = {
    agentDescription: 'Managed task',
    agentName: 'generalPurpose',
    agentSource: { kind: 'bundled' },
    effort: 'low',
    fast: false,
    gates: [],
    logicalCwd,
    model: 'delivery-test/model',
    modelSelector: 'delivery-test/model:low',
    outputSchema: DeliveryOutputSchema,
    readonly: false,
    relativeCwd: '',
    role: 'feature',
    schemaMode: 'strict',
    systemPrompt: 'Managed task',
    tools: ['read'],
    version,
  }
  if (isolation !== undefined) contract.isolation = isolation
  return contract
}

function artifactReference(uri, contents) {
  return {
    attempt: 1,
    byteLength: Buffer.byteLength(contents),
    id: 'artifact',
    lineCount: contents.split('\n').length,
    mediaType: 'text/plain',
    runId: 'run',
    sha256: digest(contents),
    taskId: 'task',
    uri,
  }
}

function managedRecord(ownerSessionId, agentId, role, report, snapshot, artifact, isolation) {
  const record = runRecord(ownerSessionId, agentId, {
    ...resumeContract(),
    workspaceIdentity: {
      baselineCommit: snapshot.repositories[0].base,
      baselineTree: snapshot.repositories[0].tree,
      expectedTree: snapshot.repositories[0].tree,
      patch: snapshot.repositories[0].patch,
      repositoryRoot: snapshot.repositories[0].root,
      snapshot,
      syntheticBaseline: true,
    },
  })
  record.artifact = artifact
  record.isolation = isolation
  record.readonly = role === 'code review'
  record.role = role
  record.status = 'completed'
  record.structuredOutput = { data: report, mode: 'strict', source: 'caller', status: 'valid' }
  return record
}

function isolationReceipt(snapshot, status) {
  const repository = snapshot.repositories[0]
  return {
    attemptId: `attempt-${status}`,
    cleanupDebt: false,
    integration: 'manual',
    integrationStatus: status,
    repositories: [
      {
        baselineCommit: repository.base,
        baselineTree: repository.tree,
        changedFiles: [],
        destinationHeadBefore: repository.base,
        diffstat: '',
        patch: repository.patch,
        relativePath: repository.relativePath,
        repoRoot: repository.root,
        resultCommit: repository.base,
        resultTree: repository.tree,
        status: 'captured',
      },
    ],
    status: 'captured',
    writerId: 'writer',
  }
}

function deliveryArtifact(snapshot) {
  return {
    repositories: snapshot.repositories.map((repository) => ({
      base: repository.base,
      patch: repository.patch.sha256,
      relativePath: repository.relativePath,
      root: repository.root,
      tree: repository.tree,
    })),
  }
}

function candidateIssue(ownerSessionId, artifact, snapshot) {
  const patch = snapshot.repositories[0].patch
  const issue = {
    createdAt: 0,
    criteria: [{ description: 'The target candidate is preserved.', id: 'receipt' }],
    issue: 'resume-target',
    ownerSessionId,
    runtimeRequired: false,
    submissions: [],
    version: 1,
  }
  const result = recordDelivery(issue, {
    agentId: 'implementation',
    attempt: 1,
    artifact,
    evidence: [
      {
        id: 'patch:.',
        kind: 'patch',
        passed: true,
        reference: patch.uri,
        sha256: patch.sha256,
      },
    ],
    execution: 'completed',
    integration: 'integrated',
    recordedAt: 1,
    report: {
      criteria: [{ evidence: ['patch:.'], id: 'receipt', result: 'pass' }],
      failureClass: 'none',
      findings: [],
      issue: issue.issue,
      kind: 'implementation',
      reason: 'The candidate is ready for review.',
      state: 'candidate',
    },
    role: 'feature',
  })
  if (!result.ok) throw result.error
  return result.value
}

async function nestedGitWorkspace(cwd) {
  await execFile('git', ['init', '-q'], { cwd })
  await execFile('git', ['config', 'user.email', 'test@example.test'], { cwd })
  await execFile('git', ['config', 'user.name', 'Delivery Test'], { cwd })
  await writeFile(join(cwd, 'surrounding.txt'), 'surrounding\n')
  await execFile('git', ['add', 'surrounding.txt'], { cwd })
  await execFile('git', ['commit', '-qm', 'surrounding'], { cwd })
  const target = join(cwd, 'inner-target')
  await mkdir(target)
  await execFile('git', ['init', '-q'], { cwd: target })
  await execFile('git', ['config', 'user.email', 'test@example.test'], { cwd: target })
  await execFile('git', ['config', 'user.name', 'Delivery Test'], { cwd: target })
  await writeFile(join(target, 'candidate.txt'), 'candidate\n')
  await execFile('git', ['add', 'candidate.txt'], { cwd: target })
  await execFile('git', ['commit', '-qm', 'candidate'], { cwd: target })
  return target
}

function reverseJson(value) {
  if (Array.isArray(value)) return value.map(reverseJson)
  if (value === null || Object(value) !== value) return value
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, entry]) => [key, reverseJson(entry)]),
  )
}

function plannedReply(content, stopReason) {
  return {
    content,
    role: 'assistant',
    stopReason,
    timestamp: Date.now(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  }
}

function taskFields(includeId, includeNeeds) {
  const fields = {
    cwd: Type.Optional(Type.String()),
    delivery: Type.Optional(
      Type.Union([
        Type.Object(
          { issue: Type.String(), kind: Type.Literal('managed') },
          { additionalProperties: false },
        ),
        Type.Object({ kind: Type.Literal('independent') }, { additionalProperties: false }),
      ]),
    ),
    description: Type.String(),
    isolation: Type.Optional(
      Type.Object(
        { integration: Type.Optional(Type.String()), mode: Type.Optional(Type.String()) },
        { additionalProperties: false },
      ),
    ),
    outputSchema: Type.Optional(Type.Unknown()),
    prompt: Type.String(),
    readonly: Type.Optional(Type.Boolean()),
    resume: Type.Optional(Type.String()),
    role: Type.Optional(Type.String()),
    run_in_background: Type.Optional(Type.Boolean()),
    schemaMode: Type.Optional(Type.String()),
    subagent_type: Type.String(),
  }
  if (includeId) fields.id = Type.String()
  if (includeNeeds) fields.needs = Type.Optional(Type.Array(Type.String()))
  return fields
}

function taskSchema() {
  return Type.Union(
    [
      Type.Object(taskFields(false, false), { additionalProperties: false }),
      Type.Object(
        {
          context: Type.Optional(Type.String()),
          tasks: Type.Array(Type.Object(taskFields(true, true), { additionalProperties: false })),
        },
        { additionalProperties: false },
      ),
    ],
    { type: 'object' },
  )
}

async function sessionWithDeliveryTool(options = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'pstack-delivery-tools-'))
  const observed = []
  let request = 0
  const messages = options.messages ?? [
    plannedReply(
      [
        {
          arguments: {
            action: 'open',
            criteria: [{ description: 'The command returns a receipt.', id: 'receipt' }],
            issue: 'delivery-tools',
            runtimeRequired: false,
          },
          id: 'open',
          name: 'pstack_delivery',
          type: 'toolCall',
        },
      ],
      'toolUse',
    ),
    plannedReply(
      [
        {
          arguments: {
            description: 'Capture injected Task input',
            prompt: 'issue: delivery-tools\nphase: implementation',
            role: 'feature',
            subagent_type: 'generalPurpose',
          },
          id: 'task',
          name: 'Task',
          type: 'toolCall',
        },
      ],
      'toolUse',
    ),
  ]
  await options.setup?.(cwd)
  const runtime = await ModelRuntime.create({ refreshOnCreate: false })
  runtime.registerProvider('delivery-test', {
    api: 'openai-completions',
    apiKey: 'test',
    baseUrl: 'https://invalid.test',
    models: [
      {
        contextWindow: 100000,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: 'model',
        input: ['text'],
        maxTokens: 1024,
        name: 'Delivery test model',
        reasoning: false,
      },
    ],
    streamSimple(model) {
      const stream = createAssistantMessageEventStream()
      const planned = messages[request]
      request += 1
      const next =
        planned === undefined
          ? reply(model, [{ text: 'Done', type: 'text' }], 'stop')
          : { ...planned, model: model.id, provider: model.provider, api: model.api }
      stream.push({ message: next, reason: next.stopReason, type: 'done' })
      stream.end()
      return stream
    },
  })
  const model = runtime.getModel('delivery-test', 'model')
  if (model === undefined) throw new Error('The delivery test model is unavailable.')
  let sessionManager
  const loader = new DefaultResourceLoader({
    agentDir: join(cwd, 'agent'),
    cwd,
    extensionFactories: [
      (pi) => {
        registerDeliveryProtocol(pi)
        pi.registerTool({
          description: 'Validate the actual Task input after extension preflight.',
          execute(_toolCallId, input) {
            if (input.outputSchema !== undefined) validateOutputSchema(input.outputSchema)
            observed.push(input)
            return (
              options.onTask?.(input, sessionManager) ?? {
                content: [{ text: 'Task preflight completed.', type: 'text' }],
                details: {},
              }
            )
          },
          name: 'Task',
          parameters: taskSchema(),
        })
        pi.registerTool({
          description: 'Validate the actual TaskControl input after extension preflight.',
          execute(_toolCallId, input) {
            observed.push(input)
            return {
              content: [{ text: 'TaskControl preflight completed.', type: 'text' }],
              details: {},
            }
          },
          name: 'TaskControl',
          parameters: Type.Object(
            {
              action: Type.String(),
              agent_ids: Type.Optional(Type.Array(Type.String())),
              timeout_ms: Type.Optional(Type.Integer()),
            },
            { additionalProperties: false },
          ),
        })
      },
    ],
    noExtensions: true,
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true,
  })
  await loader.reload()
  sessionManager = SessionManager.create(cwd, join(cwd, 'sessions'))
  await options.beforePrompt?.(sessionManager)
  const created = await createAgentSession({
    cwd,
    model,
    modelRuntime: runtime,
    resourceLoader: loader,
    sessionManager,
    tools: ['pstack_delivery', 'Task', 'TaskControl'],
  })
  return {
    close: async () => {
      created.session.dispose()
      await rm(cwd, { force: true, recursive: true })
    },
    observed,
    session: created.session,
    sessionManager,
  }
}

describe('completion wait normalization', () => {
  it('drops a short wait window so the wait settles on child completion', () => {
    const input = { action: 'wait', agent_ids: ['child'], timeout_ms: 300000 }
    expect(normalizeCompletionWait(input)).toBe(true)
    expect(input).toEqual({ action: 'wait', agent_ids: ['child'] })
  })

  it('strips a short wait window from the live TaskControl call', async () => {
    const harness = await sessionWithDeliveryTool({
      messages: [
        plannedReply(
          [
            {
              arguments: { action: 'wait', agent_ids: ['child'], timeout_ms: 300000 },
              id: 'wait',
              name: 'TaskControl',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('wait for the child')
      expect(harness.observed).toEqual([{ action: 'wait', agent_ids: ['child'] }])
    } finally {
      await harness.close()
    }
  })

  it('keeps an explicit long liveness deadline and an absent deadline unchanged', () => {
    const long = { action: 'wait', timeout_ms: MINIMUM_COMPLETION_WAIT_MS }
    expect(normalizeCompletionWait(long)).toBe(false)
    expect(long.timeout_ms).toBe(MINIMUM_COMPLETION_WAIT_MS)
    const open = { action: 'wait', agent_ids: ['child'] }
    expect(normalizeCompletionWait(open)).toBe(false)
    expect(open).toEqual({ action: 'wait', agent_ids: ['child'] })
  })
})

describe('pstack delivery tool interception', () => {
  it.each([
    ['diagnosis', 'architect runners'],
    ['implementation', 'architect runners'],
    ['implementation', 'divergent'],
    ['implementation', 'synthesizer'],
    ['implementation', 'hardest tasks'],
  ])('retains a failed %s report from %s without replacing the implementer', async (kind, role) => {
    const report = {
      criteria: [],
      failureClass: 'execution-contract',
      findings: [],
      issue: 'delivery-tools',
      kind,
      reason: 'Design exploration ended without an acceptable report.',
      state: 'wip',
    }
    const harness = await sessionWithDeliveryTool({
      beforePrompt(sessionManager) {
        const ownerSessionId = sessionManager.getSessionId()
        const issue = emptyDeliveryIssue(ownerSessionId, 'delivery-tools')
        const original = recordDelivery(issue, {
          agentId: 'implementer',
          attempt: 1,
          evidence: [],
          execution: 'completed',
          integration: 'captured',
          recordedAt: 1,
          report: { ...report, kind: 'implementation', state: 'blocked' },
          role: 'feature',
        })
        if (!original.ok) throw original.error
        sessionManager.appendCustomEntry('@nothingrotf/pstack/delivery-v1', original.value)
        const record = runRecord(ownerSessionId, 'designer')
        record.role = role
        record.readonly = true
        record.terminalFailureKind = 'report-contract'
        record.structuredOutput = {
          data: report,
          mode: 'strict',
          source: 'caller',
          status: 'valid',
        }
        sessionManager.appendCustomEntry(
          'pi-subagent-state',
          runtimeState(ownerSessionId, [record]),
        )
        sessionManager.appendCustomEntry(
          '@nothingrotf/pstack/delivery-binding-v1',
          deliveryBinding(ownerSessionId, 'designer', 'delivery-tools'),
        )
      },
      messages: [
        plannedReply(
          [
            {
              arguments: { action: 'record', agentId: 'designer', issue: 'delivery-tools' },
              id: 'record-design',
              name: 'pstack_delivery',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
        plannedReply(
          [
            {
              arguments: {
                description: 'Continue the implementation',
                prompt: 'issue: delivery-tools\nphase: correction',
                role: 'feature',
                subagent_type: 'generalPurpose',
              },
              id: 'continue-implementation',
              name: 'Task',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Retain the failed design and continue.', {
        expandPromptTemplates: false,
      })
      const issue = retainedIssue(harness.sessionManager, 'delivery-tools')
      expect(issue.submissions).toHaveLength(2)
      expect(issue.submissions[1]).toMatchObject({
        execution: 'failed',
        intendedReport: report,
        report: { kind: 'comments', state: 'wip' },
        role,
      })
      const result = harness.session.messages.findLast(
        (message) => message.role === 'toolResult' && message.toolCallId === 'record-design',
      )
      expect(result?.isError).not.toBe(true)
      expect(JSON.parse(result.content[0].text)).toMatchObject({
        implementationOwner: 'implementer',
        summary: { state: 'blocked', incompleteReturns: 1, diagnosisRequired: false },
      })
      expect(harness.observed).toHaveLength(1)
      const continuation = harness.session.messages.findLast(
        (message) =>
          message.role === 'toolResult' && message.toolCallId === 'continue-implementation',
      )
      expect(continuation?.isError).not.toBe(true)
      expect(continuation?.content[0]?.text).toBe('Task preflight completed.')
    } finally {
      await harness.close()
    }
  })

  it('repairs persisted reports without Task, workspace, shell, or source mutation', async () => {
    const counters = { taskStarts: 0, workspaceAllocations: 0, shellCalls: 0 }
    const report = {
      issue: 'repair-tool',
      kind: 'implementation',
      state: 'candidate',
      criteria: [{ id: 'receipt', result: 'pass', evidence: ['command:1'] }],
      findings: [],
      reason: 'The immutable receipt establishes the candidate.',
      failureClass: 'none',
    }
    const submission = {
      agentId: 'repair-agent',
      attempt: 1,
      role: 'feature',
      execution: 'completed',
      integration: 'captured',
      artifact: {
        repositories: [
          {
            root: '/repo',
            relativePath: '',
            base: 'a'.repeat(40),
            tree: 'b'.repeat(40),
            patch: 'c'.repeat(64),
          },
        ],
      },
      evidence: [
        {
          id: 'command:1',
          kind: 'command',
          passed: true,
          reference: 'artifact://command',
          sha256: 'd'.repeat(64),
          status: 'success',
        },
      ],
      intendedReport: report,
      report: { ...report, state: 'wip', reason: 'The serialized alias was stale.' },
      recordedAt: 1,
    }
    const identity = deliveryRepairIdentity(submission)
    const startedAt = performance.now()
    const harness = await sessionWithDeliveryTool({
      beforePrompt(sessionManager) {
        sessionManager.appendCustomEntry('@nothingrotf/pstack/delivery-v1', {
          ...emptyDeliveryIssue(sessionManager.getSessionId(), 'repair-tool'),
          submissions: [submission],
        })
      },
      messages: [
        plannedReply(
          [
            {
              arguments: {
                action: 'repair',
                issue: 'repair-tool',
                agentId: submission.agentId,
                attempt: submission.attempt,
                revision: 1,
                report,
                ...identity,
              },
              id: 'repair',
              name: 'pstack_delivery',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
      onTask() {
        counters.taskStarts += 1
        counters.workspaceAllocations += 1
        counters.shellCalls += 1
      },
    })
    try {
      await harness.session.prompt('Repair the retained report only.')
      const elapsedMs = performance.now() - startedAt
      const repaired = retainedIssue(harness.sessionManager, 'repair-tool')
      expect(counters).toEqual({ taskStarts: 0, workspaceAllocations: 0, shellCalls: 0 })
      expect(harness.observed).toHaveLength(0)
      expect(elapsedMs).toBeGreaterThanOrEqual(0)
      expect(repaired?.submissions[0]?.artifact).toEqual(submission.artifact)
      expect(repaired?.submissions[0]?.report).toEqual(submission.report)
      expect(repaired?.submissions[0]?.reportCorrections?.[0]?.report).toEqual(report)
      const sessionFile = harness.sessionManager.getSessionFile()
      if (sessionFile === undefined) throw new Error('Missing persisted repair session.')
      const reopened = SessionManager.open(sessionFile)
      const reloaded = retainedIssue(reopened, 'repair-tool')
      expect(reloaded?.submissions[0]?.artifact).toEqual(submission.artifact)
      expect(reloaded?.submissions[0]?.report).toEqual(submission.report)
      expect(reloaded?.submissions[0]?.reportCorrections?.[0]?.report).toEqual(report)
      process.stdout.write(`synthetic report repair elapsed: ${elapsedMs.toFixed(1)}ms\n`)
    } finally {
      await harness.close()
    }
  })

  it('builds complete reviewer packets without claiming prior aliases are reusable', () => {
    const issue = emptyDeliveryIssue('owner', 'packet')
    issue.submissions.push({
      agentId: 'implementation',
      attempt: 1,
      role: 'feature',
      execution: 'completed',
      integration: 'captured',
      artifact: {
        repositories: [
          {
            root: '/repo',
            relativePath: '',
            base: 'a'.repeat(40),
            tree: 'b'.repeat(40),
            patch: 'c'.repeat(64),
          },
        ],
      },
      evidence: [
        {
          id: 'command:1',
          kind: 'command',
          passed: true,
          reference: 'artifact://command-log',
          sha256: 'd'.repeat(64),
          status: 'success',
          command: 'bun run test',
        },
      ],
      report: {
        issue: 'packet',
        kind: 'implementation',
        state: 'candidate',
        criteria: [{ id: 'receipt', result: 'pass', evidence: ['command:1'] }],
        findings: [{ id: 'F1', blocking: true, disposition: 'corrected', evidence: ['command:1'] }],
        reason: 'Candidate ready.',
        failureClass: 'none',
      },
      recordedAt: 1,
    })
    const packet = deliveryReviewerPacket(issue)
    expect(packet).toContain('receipt: The report identifies the evidence.')
    expect(packet).toContain('"severity":"blocking","disposition":"corrected"')
    expect(packet).toContain(
      '"sha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"',
    )
    expect(packet).toContain('"command":"bun run test"')
    expect(packet).toContain('They are not current command:n or read:n aliases')
    expect(packet).toContain('Exact candidate identity')
  })

  it('uses report kind, role, and readonly together for read receipt aliases', () => {
    const issue = emptyDeliveryIssue('owner', 'alias-parity')
    const prompt = `work\n\n${deliveryReviewerPacket(issue)}`
    const readReceipt = {
      callId: 'read',
      completedAt: 2,
      isError: true,
      output: {
        byteLength: 1,
        mediaType: 'text/plain',
        sha256: 'b'.repeat(64),
        uri: 'artifact://read',
      },
      startedAt: 1,
      status: 'error',
      tool: 'read',
    }
    const base = {
      agentId: 'worker',
      artifact: {
        attempt: 1,
        byteLength: 1,
        id: 'output',
        lineCount: 1,
        mediaType: 'application/json',
        runId: 'worker',
        sha256: 'a'.repeat(64),
        taskId: 'task',
        uri: 'artifact://output',
      },
      attempt: 1,
      output: '{}',
      previousOutputs: [],
      prompt,
      toolExecutionReceipts: [readReceipt],
    }
    const diagnosis = {
      issue: issue.issue,
      kind: 'diagnosis',
      state: 'wip',
      criteria: [],
      findings: [],
      reason: 'The read evidence establishes the diagnostic cause.',
      failureClass: 'context',
    }
    expect(
      validateDeliveryTerminal({
        ...base,
        readonly: false,
        role: 'hardest tasks',
        structuredOutput: { data: diagnosis, mode: 'strict', source: 'caller', status: 'valid' },
      }).status,
    ).toBe('accepted')
    const hardestImplementation = {
      ...diagnosis,
      kind: 'implementation',
      failureClass: 'none',
      findings: [{ id: 'F0', blocking: false, disposition: 'open', evidence: ['read:1'] }],
    }
    const hardestResult = validateDeliveryTerminal({
      ...base,
      readonly: false,
      role: 'hardest tasks',
      structuredOutput: {
        data: hardestImplementation,
        mode: 'strict',
        source: 'caller',
        status: 'valid',
      },
    })
    expect(hardestResult.status).toBe('rejected')
    if (hardestResult.status !== 'rejected') {
      throw new Error('Hardest-tasks implementation received a diagnostic read alias.')
    }
    expect(hardestResult.error).toContain('missing receipt read:1')

    const comments = {
      ...diagnosis,
      kind: 'comments',
      failureClass: 'none',
      findings: [{ id: 'F1', blocking: false, disposition: 'open', evidence: ['read:1'] }],
    }
    const result = validateDeliveryTerminal({
      ...base,
      readonly: true,
      role: 'code review',
      structuredOutput: { data: comments, mode: 'strict', source: 'caller', status: 'valid' },
    })
    expect(result.status).toBe('rejected')
    if (result.status !== 'rejected') throw new Error('Comments received a review read alias.')
    expect(result.error).toContain('missing receipt read:1')
  })

  it('corrects patch aliases against immutable captured evidence', () => {
    const issue = emptyDeliveryIssue('owner', 'patch-alias-correction')
    const prompt = deliveryReviewerPacket(issue)
    const snapshot = {
      repositories: [
        {
          base: 'a'.repeat(40),
          patch: { byteLength: 1, sha256: 'b'.repeat(64), uri: 'artifact://patch' },
          relativePath: '',
          root: '/repo',
          tree: 'c'.repeat(40),
        },
      ],
    }
    const isolation = isolationReceipt(snapshot, 'not-requested')
    const original = {
      issue: issue.issue,
      kind: 'implementation',
      state: 'candidate',
      criteria: [{ id: 'receipt', result: 'pass', evidence: ['patch:wrong'] }],
      findings: [],
      reason: 'Candidate ready with an incorrect patch alias.',
      failureClass: 'none',
    }
    const base = {
      agentId: 'worker',
      artifact: {
        attempt: 1,
        byteLength: 1,
        id: 'output',
        lineCount: 1,
        mediaType: 'application/json',
        runId: 'worker',
        sha256: 'a'.repeat(64),
        taskId: 'task',
        uri: 'artifact://output',
      },
      attempt: 1,
      isolation,
      output: '{}',
      previousOutputs: [],
      prompt,
      readonly: false,
      role: 'feature',
      toolExecutionReceipts: [
        {
          callId: 'command',
          completedAt: 2,
          command: 'bun run test',
          isError: false,
          output: {
            byteLength: 1,
            mediaType: 'text/plain',
            sha256: 'e'.repeat(64),
            uri: 'artifact://command',
          },
          startedAt: 1,
          status: 'success',
          tool: 'bash',
        },
      ],
      workspaceIdentity: {
        baselineTree: 'a'.repeat(40),
        snapshot,
      },
    }
    const rejected = validateDeliveryTerminal({
      ...base,
      structuredOutput: { data: original, mode: 'strict', source: 'caller', status: 'valid' },
    })
    expect(rejected).toMatchObject({ status: 'rejected', correctionAllowed: true })
    const corrected = {
      ...original,
      criteria: [{ id: 'receipt', result: 'pass', evidence: ['patch:.'] }],
    }
    const accepted = validateDeliveryTerminal({
      ...base,
      previousOutputs: [
        {
          artifact: base.artifact,
          correction: 0,
          structuredOutput: {
            data: original,
            mode: 'strict',
            source: 'caller',
            status: 'valid',
          },
        },
      ],
      structuredOutput: { data: corrected, mode: 'strict', source: 'caller', status: 'valid' },
    })
    expect(accepted).toEqual({ status: 'accepted' })
  })

  it('allows incomplete WIP reports with an empty criterion matrix', () => {
    const issue = emptyDeliveryIssue('owner', 'wip-terminal')
    const report = {
      issue: issue.issue,
      kind: 'implementation',
      state: 'wip',
      criteria: [],
      findings: [],
      reason: 'Implementation remains incomplete.',
      failureClass: 'none',
    }
    const result = validateDeliveryTerminal({
      agentId: 'worker',
      artifact: {
        attempt: 1,
        byteLength: 1,
        id: 'output',
        lineCount: 1,
        mediaType: 'application/json',
        runId: 'worker',
        sha256: 'a'.repeat(64),
        taskId: 'task',
        uri: 'artifact://output',
      },
      attempt: 1,
      output: '{}',
      previousOutputs: [],
      prompt: deliveryReviewerPacket(issue),
      readonly: false,
      role: 'feature',
      structuredOutput: { data: report, mode: 'strict', source: 'caller', status: 'valid' },
      toolExecutionReceipts: [],
    })
    expect(result).toEqual({ status: 'accepted' })
  })

  it('fails closed when the original correction semantics are missing', () => {
    const issue = emptyDeliveryIssue('owner', 'semantic-origin')
    const report = {
      issue: issue.issue,
      kind: 'implementation',
      state: 'candidate',
      criteria: [{ id: 'receipt', result: 'pass', evidence: ['command:1'] }],
      findings: [],
      reason: 'Candidate ready.',
      failureClass: 'none',
    }
    const result = validateDeliveryTerminal({
      agentId: 'worker',
      artifact: {
        attempt: 1,
        byteLength: 1,
        id: 'output',
        lineCount: 1,
        mediaType: 'application/json',
        runId: 'worker',
        sha256: 'a'.repeat(64),
        taskId: 'task',
        uri: 'artifact://output',
      },
      attempt: 1,
      output: '{}',
      previousOutputs: [
        {
          artifact: {
            attempt: 1,
            byteLength: 1,
            id: 'original',
            lineCount: 1,
            mediaType: 'text/plain',
            runId: 'worker',
            sha256: 'c'.repeat(64),
            taskId: 'task',
            uri: 'artifact://original',
          },
          correction: 0,
        },
      ],
      prompt: deliveryReviewerPacket(issue),
      readonly: false,
      role: 'feature',
      structuredOutput: { data: report, mode: 'strict', source: 'caller', status: 'valid' },
      toolExecutionReceipts: [],
    })
    expect(result.status).toBe('rejected')
    if (result.status !== 'rejected') throw new Error('Missing original semantics were accepted.')
    expect(result.error).toContain('original report semantics are unavailable')
  })

  it('rejects terminal artifacts that settlement would reject', () => {
    const issue = emptyDeliveryIssue('owner', 'artifact-parity')
    const report = {
      issue: issue.issue,
      kind: 'implementation',
      state: 'candidate',
      criteria: [{ id: 'receipt', result: 'pass', evidence: ['command:1'] }],
      findings: [],
      reason: 'Candidate ready.',
      failureClass: 'none',
    }
    const snapshot = {
      repositories: [
        {
          base: 'a'.repeat(40),
          patch: { byteLength: 1, sha256: 'b'.repeat(64), uri: 'artifact://patch' },
          relativePath: '',
          root: '/repo',
          tree: 'c'.repeat(40),
        },
      ],
    }
    const isolation = isolationReceipt(snapshot, 'not-requested')
    isolation.repositories[0].baselineTree = 'f'.repeat(40)
    const result = validateDeliveryTerminal({
      agentId: 'worker',
      artifact: {
        attempt: 1,
        byteLength: 1,
        id: 'output',
        lineCount: 1,
        mediaType: 'application/json',
        runId: 'worker',
        sha256: 'a'.repeat(64),
        taskId: 'task',
        uri: 'artifact://output',
      },
      attempt: 1,
      isolation,
      output: '{}',
      previousOutputs: [],
      prompt: deliveryReviewerPacket(issue),
      readonly: false,
      role: 'feature',
      structuredOutput: { data: report, mode: 'strict', source: 'caller', status: 'valid' },
      toolExecutionReceipts: [
        {
          callId: 'command',
          completedAt: 2,
          command: 'bun test',
          isError: false,
          output: {
            byteLength: 1,
            mediaType: 'text/plain',
            sha256: 'd'.repeat(64),
            uri: 'artifact://command',
          },
          startedAt: 1,
          status: 'success',
          tool: 'bash',
        },
      ],
      workspaceIdentity: {
        baselineCommit: 'a'.repeat(40),
        baselineTree: 'e'.repeat(40),
        expectedTree: 'c'.repeat(40),
        patch: snapshot.repositories[0].patch,
        repositoryRoot: '/repo',
        snapshot,
        syntheticBaseline: true,
      },
    })
    expect(result.status).toBe('rejected')
    if (result.status !== 'rejected') throw new Error('Mismatched artifact was accepted.')
    expect(result.error).toContain('recorded product baseline')
    expect(result.correctionAllowed).toBe(false)
  })

  it('enforces static readonly and manual unintegrated runtime artifact parity', () => {
    const issue = emptyDeliveryIssue('owner', 'review-artifact-parity')
    const snapshot = {
      repositories: [
        {
          base: 'a'.repeat(40),
          patch: { byteLength: 1, sha256: 'b'.repeat(64), uri: 'artifact://patch' },
          relativePath: '',
          root: '/repo',
          tree: 'c'.repeat(40),
        },
      ],
    }
    issue.submissions.push({
      agentId: 'implementation',
      attempt: 1,
      role: 'feature',
      execution: 'completed',
      integration: 'integrated',
      artifact: deliveryArtifact(snapshot),
      evidence: [
        {
          id: 'command:1',
          kind: 'command',
          passed: true,
          reference: 'artifact://implementation-command',
          sha256: 'd'.repeat(64),
        },
      ],
      report: {
        issue: issue.issue,
        kind: 'implementation',
        state: 'candidate',
        criteria: [{ id: 'receipt', result: 'pass', evidence: ['command:1'] }],
        findings: [],
        reason: 'Candidate ready.',
        failureClass: 'none',
      },
      recordedAt: 1,
    })
    const report = {
      issue: issue.issue,
      kind: 'technical-review',
      state: 'accepted',
      criteria: [{ id: 'receipt', result: 'pass', evidence: ['command:1'] }],
      findings: [],
      reason: 'Review accepted.',
      failureClass: 'none',
    }
    const workspaceIdentity = {
      baselineCommit: 'a'.repeat(40),
      baselineTree: 'c'.repeat(40),
      expectedTree: 'c'.repeat(40),
      patch: snapshot.repositories[0].patch,
      repositoryRoot: '/repo',
      snapshot,
      syntheticBaseline: true,
    }
    const base = {
      agentId: 'reviewer',
      artifact: {
        attempt: 1,
        byteLength: 1,
        id: 'output',
        lineCount: 1,
        mediaType: 'application/json',
        runId: 'reviewer',
        sha256: 'a'.repeat(64),
        taskId: 'task',
        uri: 'artifact://output',
      },
      attempt: 1,
      output: '{}',
      previousOutputs: [],
      prompt: deliveryReviewerPacket(issue),
      structuredOutput: { data: report, mode: 'strict', source: 'caller', status: 'valid' },
      toolExecutionReceipts: [
        {
          callId: 'command',
          completedAt: 2,
          command: 'bun test',
          isError: false,
          output: {
            byteLength: 1,
            mediaType: 'text/plain',
            sha256: 'e'.repeat(64),
            uri: 'artifact://review-command',
          },
          startedAt: 1,
          status: 'success',
          tool: 'bash',
        },
      ],
      workspaceIdentity,
    }
    const staticResult = validateDeliveryTerminal({
      ...base,
      readonly: false,
      role: 'code review',
    })
    expect(staticResult.status).toBe('rejected')
    if (staticResult.status !== 'rejected') throw new Error('Writable static review was accepted.')
    expect(staticResult.error).toContain('Static review evidence')

    const runtimeReport = { ...report, kind: 'runtime-verification' }
    const runtimeResult = validateDeliveryTerminal({
      ...base,
      isolation: isolationReceipt(snapshot, 'integrated'),
      readonly: false,
      role: 'runtime verification',
      structuredOutput: {
        data: runtimeReport,
        mode: 'strict',
        source: 'caller',
        status: 'valid',
      },
    })
    expect(runtimeResult.status).toBe('rejected')
    if (runtimeResult.status !== 'rejected')
      throw new Error('Integrated runtime review was accepted.')
    expect(runtimeResult.error).toContain('manual isolation')

    const blockedReport = {
      ...runtimeReport,
      state: 'blocked',
      criteria: [{ id: 'receipt', result: 'fail', evidence: ['command:1'] }],
      findings: [
        {
          id: 'runtime-regression',
          blocking: true,
          disposition: 'open',
          evidence: ['command:1'],
        },
      ],
      reason: 'The runtime verifier reproduced a regression.',
      failureClass: 'regression',
    }
    const longCommandResult = validateDeliveryTerminal({
      ...base,
      isolation: isolationReceipt(snapshot, 'not-requested'),
      readonly: false,
      role: 'runtime verification',
      structuredOutput: {
        data: blockedReport,
        mode: 'strict',
        source: 'caller',
        status: 'valid',
      },
      toolExecutionReceipts: [{ ...base.toolExecutionReceipts[0], command: 'x'.repeat(5000) }],
    })
    expect(longCommandResult.status).toBe('accepted')
  })

  it('normalizes oversized prose and reports errored current receipt references', () => {
    const issue = emptyDeliveryIssue('owner', 'terminal-validation')
    const prompt = `work\n\n${deliveryReviewerPacket(issue)}`
    const result = validateDeliveryTerminal({
      agentId: 'worker',
      artifact: {
        attempt: 1,
        byteLength: 1,
        id: 'output',
        lineCount: 1,
        mediaType: 'application/json',
        runId: 'worker',
        sha256: 'a'.repeat(64),
        taskId: 'task',
        uri: 'artifact://output',
      },
      attempt: 1,
      output: '{}',
      previousOutputs: [],
      prompt,
      readonly: false,
      role: 'feature',
      structuredOutput: {
        data: {
          issue: issue.issue,
          kind: 'implementation',
          state: 'candidate',
          criteria: [{ id: 'receipt', result: 'pass', evidence: ['command:1'] }],
          findings: [],
          reason: 'x'.repeat(4097),
          failureClass: 'none',
        },
        mode: 'strict',
        source: 'caller',
        status: 'valid',
      },
      toolExecutionReceipts: [
        {
          callId: 'command',
          completedAt: 2,
          command: 'bun run test',
          isError: true,
          output: {
            byteLength: 1,
            mediaType: 'text/plain',
            sha256: 'b'.repeat(64),
            uri: 'artifact://failed-command',
          },
          startedAt: 1,
          status: 'error',
          tool: 'bash',
        },
      ],
    })
    expect(result.status).toBe('rejected')
    if (result.status !== 'rejected') throw new Error('Invalid report was accepted.')
    expect(result.error).not.toContain('/reason')
    expect(result.error).toContain('Criterion receipt references command:1 with status error')
    expect(result.correctionPrompt).toContain('command:1 status=error')
    expect(result.correctionPrompt).toContain('Failed current-attempt receipts: command:1')
  })

  it('states the verdict and receipt invariants that fail a correction', () => {
    const issue = emptyDeliveryIssue('owner', 'correction-invariants')
    const prompt = `work\n\n${deliveryReviewerPacket(issue)}`
    expect(prompt).toContain('A resume transfers no previous alias')
    expect(prompt).toContain('A resumed attempt starts an empty receipt index')
    const result = validateDeliveryTerminal({
      agentId: 'agent',
      artifact: {
        byteLength: 2,
        mediaType: 'application/json',
        sha256: 'a'.repeat(64),
        taskId: 'task',
        uri: 'artifact://output',
      },
      attempt: 2,
      output: '{}',
      previousOutputs: [],
      prompt,
      readonly: true,
      role: 'code review',
      structuredOutput: {
        data: {
          issue: issue.issue,
          kind: 'technical-review',
          state: 'candidate',
          criteria: [{ id: 'resumed', result: 'pass', evidence: ['read:18'] }],
          findings: [],
          reason: 'resumed review cites a prior attempt receipt',
          failureClass: 'none',
        },
        mode: 'strict',
        source: 'caller',
        status: 'valid',
      },
      toolExecutionReceipts: [],
    })
    expect(result.status).toBe('rejected')
    if (result.status !== 'rejected') throw new Error('Invalid report was accepted.')
    expect(result.error).toContain('references missing receipt read:18')
    expect(result.correctionPrompt).toContain('Keep the technical verdict identical')
    expect(result.correctionPrompt).toContain('Replace a missing receipt reference')
  })

  it('drops a failed receipt from a passing criterion when successful proof remains', () => {
    const issue = emptyDeliveryIssue('owner', 'failed-receipt-prune')
    const prompt = `work\n\n${deliveryReviewerPacket(issue)}`
    const snapshot = {
      repositories: [
        {
          base: 'a'.repeat(40),
          patch: { byteLength: 1, sha256: 'b'.repeat(64), uri: 'artifact://patch' },
          relativePath: '',
          root: '/repo',
          tree: 'c'.repeat(40),
        },
      ],
    }
    const receipt = (callId, uri, failed) => ({
      callId,
      command: 'bun run test',
      completedAt: 2,
      isError: failed,
      output: {
        byteLength: 1,
        mediaType: 'text/plain',
        sha256: 'b'.repeat(64),
        uri,
      },
      startedAt: 1,
      status: failed ? 'error' : 'success',
      tool: 'bash',
    })
    const result = validateDeliveryTerminal({
      agentId: 'worker',
      artifact: {
        attempt: 1,
        byteLength: 1,
        id: 'output',
        lineCount: 1,
        mediaType: 'application/json',
        runId: 'worker',
        sha256: 'a'.repeat(64),
        taskId: 'task',
        uri: 'artifact://output',
      },
      attempt: 1,
      isolation: isolationReceipt(snapshot, 'not-requested'),
      output: '{}',
      previousOutputs: [],
      prompt,
      readonly: false,
      role: 'feature',
      workspaceIdentity: { baselineTree: 'a'.repeat(40), snapshot },
      structuredOutput: {
        data: {
          issue: issue.issue,
          kind: 'implementation',
          state: 'candidate',
          criteria: [
            { id: 'receipt', result: 'pass', evidence: ['patch:.', 'command:1', 'command:2'] },
          ],
          findings: [],
          reason: 'The retry proves the criterion.',
          failureClass: 'none',
        },
        mode: 'strict',
        source: 'caller',
        status: 'valid',
      },
      toolExecutionReceipts: [
        receipt('failed', 'artifact://failed-command', true),
        receipt('passed', 'artifact://passed-command', false),
      ],
    })
    if (result.status !== 'accepted') throw new Error(`REJECTED: ${result.error}`)
    if (result.normalizedOutput === undefined) throw new Error('Missing normalized output.')
    expect(JSON.parse(result.normalizedOutput).criteria).toEqual([
      { id: 'receipt', result: 'pass', evidence: ['patch:.', 'command:2'] },
    ])
  })

  it('accepts an oversized reason by truncating prose without another correction turn', () => {
    const issue = emptyDeliveryIssue('owner', 'reason-normalization')
    const prompt = `work\n\n${deliveryReviewerPacket(issue)}`
    const result = validateDeliveryTerminal({
      agentId: 'worker',
      artifact: {
        attempt: 1,
        byteLength: 1,
        id: 'output',
        lineCount: 1,
        mediaType: 'application/json',
        runId: 'worker',
        sha256: 'a'.repeat(64),
        taskId: 'task',
        uri: 'artifact://output',
      },
      attempt: 1,
      output: '{}',
      previousOutputs: [],
      prompt,
      readonly: true,
      role: 'code review',
      structuredOutput: {
        data: {
          issue: issue.issue,
          kind: 'comments',
          state: 'wip',
          criteria: [],
          findings: [],
          reason: 'x'.repeat(5000),
          failureClass: 'none',
        },
        mode: 'strict',
        source: 'caller',
        status: 'valid',
      },
      toolExecutionReceipts: [],
    })
    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('Oversized prose blocked the report.')
    if (result.normalizedOutput === undefined) throw new Error('Missing normalized output.')
    const normalized = JSON.parse(result.normalizedOutput)
    expect(normalized.reason.length).toBe(4096)
    expect(normalized.reason.endsWith(' [reason truncated]')).toBe(true)
  })

  it('keeps an all-passing verdict when the first draft omits its failure class', () => {
    const issue = emptyDeliveryIssue('owner', 'inferred-failure-class')
    const prompt = deliveryReviewerPacket(issue)
    const snapshot = {
      repositories: [
        {
          base: 'a'.repeat(40),
          patch: { byteLength: 1, sha256: 'b'.repeat(64), uri: 'artifact://patch' },
          relativePath: '',
          root: '/repo',
          tree: 'c'.repeat(40),
        },
      ],
    }
    const draft = {
      issue: issue.issue,
      kind: 'implementation',
      state: 'candidate',
      criteria: [{ id: 'receipt', result: 'pass', evidence: ['patch:.', 'command:1'] }],
      findings: [],
      reason: 'Every registered criterion passed with executed proof.',
    }
    const result = validateDeliveryTerminal({
      agentId: 'worker',
      artifact: {
        attempt: 1,
        byteLength: 1,
        id: 'output',
        lineCount: 1,
        mediaType: 'application/json',
        runId: 'worker',
        sha256: 'a'.repeat(64),
        taskId: 'task',
        uri: 'artifact://output',
      },
      attempt: 1,
      isolation: isolationReceipt(snapshot, 'not-requested'),
      output: '{}',
      previousOutputs: [],
      prompt,
      readonly: false,
      role: 'feature',
      structuredOutput: { data: draft, mode: 'strict', source: 'caller', status: 'valid' },
      toolExecutionReceipts: [
        {
          callId: 'command',
          completedAt: 2,
          command: 'bun run test',
          isError: false,
          output: {
            byteLength: 1,
            mediaType: 'text/plain',
            sha256: 'e'.repeat(64),
            uri: 'artifact://command',
          },
          startedAt: 1,
          status: 'success',
          tool: 'bash',
        },
      ],
      workspaceIdentity: { baselineTree: 'a'.repeat(40), snapshot },
    })
    if (result.status !== 'accepted') throw new Error(`REJECTED: ${result.error}`)
    if (result.normalizedOutput === undefined) throw new Error('Missing normalized output.')
    expect(JSON.parse(result.normalizedOutput)).toMatchObject({
      failureClass: 'none',
      state: 'candidate',
    })
  })

  it('keeps an incomplete draft rejected when it omits its failure class', () => {
    const issue = emptyDeliveryIssue('owner', 'missing-failure-class')
    const prompt = `work\n\n${deliveryReviewerPacket(issue)}`
    const draft = {
      issue: issue.issue,
      kind: 'comments',
      state: 'wip',
      criteria: [],
      findings: [],
      reason: 'Work remains.',
    }
    const result = validateDeliveryTerminal({
      agentId: 'worker',
      artifact: {
        attempt: 1,
        byteLength: 1,
        id: 'output',
        lineCount: 1,
        mediaType: 'application/json',
        runId: 'worker',
        sha256: 'a'.repeat(64),
        taskId: 'task',
        uri: 'artifact://output',
      },
      attempt: 1,
      output: '{}',
      previousOutputs: [],
      prompt,
      readonly: true,
      role: 'code review',
      structuredOutput: { data: draft, mode: 'strict', source: 'caller', status: 'valid' },
      toolExecutionReceipts: [],
    })
    expect(result.status).toBe('rejected')
    if (result.status !== 'rejected') throw new Error('An unclassified incomplete draft passed.')
    expect(result.error).toContain('failureClass')
  })
  it('injects the supported delivery schema into the real Task tool call', async () => {
    const harness = await sessionWithDeliveryTool()
    try {
      await harness.session.prompt('Open the managed issue, then dispatch its Task.', {
        expandPromptTemplates: false,
      })
      expect(harness.observed).toHaveLength(1)
      const task = harness.observed[0]
      expect(task.schemaMode).toBe('strict')
      expect(task.prompt).toContain('Managed issue: delivery-tools. Delivery: wip.')
      expect(task.prompt).toContain('receipt: The command returns a receipt.')
      expect(task.prompt).toContain('command:1')
      expect(task.prompt).toContain('Never invent a receipt reference.')
      expect(JSON.stringify(task.outputSchema)).not.toContain('anyOf')
      expect(JSON.stringify(task.outputSchema)).not.toContain('const')
    } finally {
      await harness.close()
    }
  })

  it('retains passed criterion IDs and complete finding IDs in correction prompts', async () => {
    let target
    const harness = await sessionWithDeliveryTool({
      async setup(cwd) {
        target = await nestedGitWorkspace(cwd)
      },
      async beforePrompt(sessionManager) {
        const ownerSessionId = sessionManager.getSessionId()
        const snapshot = await captureWorkspaceSnapshot(target)
        if (snapshot === undefined) throw new Error('The candidate snapshot is unavailable.')
        const candidate = candidateIssue(ownerSessionId, deliveryArtifact(snapshot), snapshot)
        const result = recordDelivery(candidate, {
          ...candidate.submissions[0],
          agentId: 'reviewer',
          role: 'code review',
          report: {
            ...candidate.submissions[0].report,
            kind: 'technical-review',
            state: 'blocked',
            reason: 'The replay boundary needs correction.',
            findings: [
              {
                id: 'F1-replay-boundary',
                blocking: true,
                disposition: 'open',
                evidence: ['patch:.'],
              },
              {
                id: 'F2-public-contract',
                blocking: false,
                disposition: 'open',
                evidence: ['patch:.'],
              },
            ],
          },
        })
        if (!result.ok) throw result.error
        sessionManager.appendCustomEntry('@nothingrotf/pstack/delivery-v1', result.value)
      },
      messages: [
        plannedReply(
          [
            {
              arguments: {
                description: 'Correct the retained review findings',
                prompt:
                  'issue: resume-target\nCorrect the review findings without changing the criteria.',
                role: 'feature',
                subagent_type: 'generalPurpose',
              },
              id: 'correct-reviewed-candidate',
              name: 'Task',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Correct the reviewed candidate.', {
        expandPromptTemplates: false,
      })
      expect(harness.observed).toHaveLength(1)
      const task = harness.observed[0]
      expect(task.prompt).toContain('Open criteria: none.')
      expect(task.prompt).toContain('Registered criterion IDs: receipt.')
      expect(task.prompt).toContain(
        'Report every registered criterion, including previously passing criteria.',
      )
      expect(task.prompt).toContain(
        'Registered finding IDs: F1-replay-boundary, F2-public-contract.',
      )
      expect(task.prompt).toContain(
        'Reuse complete finding IDs. Do not abbreviate or renumber them.',
      )
      expect(task.prompt).toContain(
        'Evidence arrays contain recorded receipt IDs, not prose or file paths.',
      )
      expect(task.prompt).toContain(
        'Return only the JSON report. Do not wrap it in Markdown or surrounding text.',
      )
      expect(task.outputSchema).toEqual(DeliveryOutputSchema)
      expect(task.schemaMode).toBe('strict')
    } finally {
      await harness.close()
    }
  })

  it.each([
    'feature',
    'refactoring',
    'bug-fix',
    'perf-issue',
    'hillclimb',
    'code review',
    'runtime verification',
    'publication',
    'hardest tasks',
  ])('blocks a managed %s Task without an issue binding', async (role) => {
    const task = {
      arguments: {
        description: `Unbound ${role}`,
        prompt: 'Inspect the managed delivery state.',
        role,
        subagent_type: 'generalPurpose',
      },
      id: `unbound-${role}`,
      name: 'Task',
      type: 'toolCall',
    }
    if (role === 'code review') task.arguments.readonly = true
    if (role === 'runtime verification') {
      task.arguments.isolation = { integration: 'manual', mode: 'worktree' }
      task.arguments.readonly = false
    }
    if (role === 'publication') task.arguments.run_in_background = false
    if (role === 'hardest tasks') task.arguments.readonly = true
    const harness = await sessionWithDeliveryTool({
      beforePrompt(sessionManager) {
        const actualOwner = sessionManager.getSessionId()
        sessionManager.appendCustomEntry(
          '@nothingrotf/pstack/delivery-v1',
          emptyDeliveryIssue(actualOwner, 'issue-one'),
        )
        sessionManager.appendCustomEntry(
          '@nothingrotf/pstack/delivery-v1',
          emptyDeliveryIssue(actualOwner, 'issue-two'),
        )
      },
      messages: [plannedReply([task], 'toolUse')],
    })
    try {
      await harness.session.prompt('Dispatch the managed delivery Task.', {
        expandPromptTemplates: false,
      })
      expect(harness.observed).toHaveLength(0)
      const result = harness.session.messages.findLast(
        (message) => message.role === 'toolResult' && message.toolCallId === task.id,
      )
      expect(result?.content[0]?.text).toContain('issue binding')
    } finally {
      await harness.close()
    }
  })

  it.each([
    ['unrepaired', false],
    ['repaired', true],
    ['superseded', true],
  ])('requires repair only for the current repairable review: %s', async (mode, allowed) => {
    let target
    const harness = await sessionWithDeliveryTool({
      async setup(cwd) {
        target = await nestedGitWorkspace(cwd)
      },
      async beforePrompt(sessionManager) {
        const ownerSessionId = sessionManager.getSessionId()
        const snapshot = await captureWorkspaceSnapshot(target)
        if (snapshot === undefined) throw new Error('The candidate snapshot is unavailable.')
        const artifact = deliveryArtifact(snapshot)
        let issue = candidateIssue(ownerSessionId, artifact, snapshot)
        const intendedReport = {
          criteria: [{ evidence: ['patch:.'], id: 'receipt', result: 'pass' }],
          failureClass: 'none',
          findings: [],
          issue: issue.issue,
          kind: 'technical-review',
          reason: 'The review accepted the candidate.',
          state: 'accepted',
        }
        const failed = {
          agentId: 'failed-review',
          artifact,
          attempt: 1,
          evidence: [
            {
              id: 'patch:.',
              kind: 'patch',
              passed: true,
              reference: snapshot.repositories[0].patch.uri,
              sha256: snapshot.repositories[0].patch.sha256,
            },
          ],
          execution: 'failed',
          failureKind: 'report-contract',
          integration: 'captured',
          intendedReport,
          recordedAt: 2,
          report: {
            ...intendedReport,
            criteria: [{ evidence: [], id: 'receipt', result: 'pending' }],
            reason: 'The serialized report requires repair.',
            state: 'wip',
          },
          role: 'code review',
        }
        const recorded = recordDelivery(issue, failed)
        if (!recorded.ok) throw recorded.error
        issue = recorded.value
        if (mode === 'repaired') {
          const identity = deliveryRepairIdentity(failed)
          const repaired = repairDeliveryReport(issue, {
            agentId: failed.agentId,
            attempt: failed.attempt,
            recordedAt: 3,
            report: failed.report,
            revision: 1,
            ...identity,
          })
          if (!repaired.ok) throw repaired.error
          issue = repaired.value
        }
        if (mode === 'superseded') {
          const newer = structuredClone(failed)
          newer.agentId = 'newer-review'
          newer.attempt = 2
          newer.execution = 'completed'
          delete newer.failureKind
          delete newer.intendedReport
          newer.recordedAt = 3
          newer.report.reason = 'The newer review needs more proof.'
          const superseded = recordDelivery(issue, newer)
          if (!superseded.ok) throw superseded.error
          issue = superseded.value
        }
        sessionManager.appendCustomEntry('@nothingrotf/pstack/delivery-v1', issue)
      },
      messages: [
        plannedReply(
          [
            {
              arguments: {
                cwd: 'inner-target',
                delivery: { issue: 'resume-target', kind: 'managed' },
                description: 'Review the candidate',
                prompt: 'Review the current candidate.',
                readonly: true,
                role: 'code review',
                subagent_type: 'generalPurpose',
              },
              id: `review-${mode}`,
              name: 'Task',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Review the candidate.', { expandPromptTemplates: false })
      expect(harness.observed).toHaveLength(allowed ? 1 : 0)
      if (!allowed) {
        const result = harness.session.messages.findLast(
          (message) => message.role === 'toolResult' && message.toolCallId === `review-${mode}`,
        )
        expect(result?.content[0]?.text).toContain('Repair the retained report')
      }
    } finally {
      await harness.close()
    }
  })

  it('binds fresh managed work through the structured public Task field', async () => {
    const harness = await sessionWithDeliveryTool({
      beforePrompt(sessionManager) {
        sessionManager.appendCustomEntry(
          '@nothingrotf/pstack/delivery-v1',
          emptyDeliveryIssue(sessionManager.getSessionId(), 'issue-one'),
        )
      },
      messages: [
        plannedReply(
          [
            {
              arguments: {
                delivery: { issue: 'issue-one', kind: 'managed' },
                description: 'Implement managed work',
                prompt: 'Implement the accepted correction.',
                role: 'feature',
                subagent_type: 'generalPurpose',
              },
              id: 'structured-managed',
              name: 'Task',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Dispatch structured managed work.', {
        expandPromptTemplates: false,
      })
      expect(harness.observed).toHaveLength(1)
      expect(harness.observed[0].delivery).toEqual({ issue: 'issue-one', kind: 'managed' })
      expect(harness.observed[0].prompt).toContain('issue: issue-one')
    } finally {
      await harness.close()
    }
  })

  it('preserves explicit independent work while a managed ledger is open', async () => {
    const harness = await sessionWithDeliveryTool({
      beforePrompt(sessionManager) {
        sessionManager.appendCustomEntry(
          '@nothingrotf/pstack/delivery-v1',
          emptyDeliveryIssue(sessionManager.getSessionId(), 'issue-one'),
        )
      },
      messages: [
        plannedReply(
          [
            {
              arguments: {
                delivery: { kind: 'independent' },
                description: 'Independent maintenance',
                prompt: 'Inspect unrelated behavior.',
                role: 'feature',
                subagent_type: 'generalPurpose',
              },
              id: 'independent',
              name: 'Task',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Dispatch independent work.', { expandPromptTemplates: false })
      expect(harness.observed).toHaveLength(1)
      expect(harness.observed[0]).toMatchObject({ delivery: { kind: 'independent' } })
      expect(harness.observed[0].outputSchema).toBeUndefined()
    } finally {
      await harness.close()
    }
  })

  it('preserves a retained independent v5 resume with an open ledger', async () => {
    const harness = await sessionWithDeliveryTool({
      beforePrompt(sessionManager) {
        const ownerSessionId = sessionManager.getSessionId()
        const execution = resumeContract('/tmp', 5)
        execution.delivery = { kind: 'independent' }
        const record = runRecord(ownerSessionId, 'independent-owner', execution)
        record.status = 'running'
        sessionManager.appendCustomEntry(
          '@nothingrotf/pstack/delivery-v1',
          emptyDeliveryIssue(ownerSessionId, 'issue-one'),
        )
        sessionManager.appendCustomEntry(
          'pi-subagent-state',
          runtimeState(ownerSessionId, [record]),
        )
      },
      messages: [
        plannedReply(
          [
            {
              arguments: {
                description: 'Resume independent work',
                prompt: 'Continue unrelated work.',
                resume: 'independent-owner',
                subagent_type: 'generalPurpose',
              },
              id: 'resume-independent',
              name: 'Task',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Resume independent work.', { expandPromptTemplates: false })
      expect(harness.observed).toHaveLength(1)
      expect(harness.observed[0]).toMatchObject({ delivery: { kind: 'independent' } })
      expect(harness.observed[0].prompt).toBe('Continue unrelated work.')
    } finally {
      await harness.close()
    }
  })

  it('preserves an unrelated read-only investigation with an open ledger', async () => {
    const harness = await sessionWithDeliveryTool({
      beforePrompt(sessionManager) {
        const ownerSessionId = sessionManager.getSessionId()
        sessionManager.appendCustomEntry(
          '@nothingrotf/pstack/delivery-v1',
          emptyDeliveryIssue(ownerSessionId, 'issue-one'),
        )
        sessionManager.appendCustomEntry(
          '@nothingrotf/pstack/delivery-v1',
          emptyDeliveryIssue(ownerSessionId, 'issue-two'),
        )
      },
      messages: [
        plannedReply(
          [
            {
              arguments: {
                description: 'Investigate unrelated context',
                prompt: 'Read the surrounding history without changing delivery state.',
                readonly: true,
                role: 'how explorer',
                subagent_type: 'generalPurpose',
              },
              id: 'unrelated-investigation',
              name: 'Task',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Run the unrelated investigation.', {
        expandPromptTemplates: false,
      })
      expect(harness.observed).toHaveLength(1)
      expect(harness.observed[0].outputSchema).toBeUndefined()
      expect(harness.observed[0].prompt).toBe(
        'Read the surrounding history without changing delivery state.',
      )
    } finally {
      await harness.close()
    }
  })

  it('rejects prose-only issue text on a managed resume', async () => {
    const harness = await sessionWithDeliveryTool({
      beforePrompt(sessionManager) {
        const ownerSessionId = sessionManager.getSessionId()
        const record = runRecord(ownerSessionId, 'prose-only', resumeContract())
        record.output = 'issue: issue-one\\nThe report was only terminal prose.'
        record.status = 'running'
        sessionManager.appendCustomEntry(
          '@nothingrotf/pstack/delivery-v1',
          emptyDeliveryIssue(ownerSessionId, 'issue-one'),
        )
        sessionManager.appendCustomEntry(
          'pi-subagent-state',
          runtimeState(ownerSessionId, [record]),
        )
      },
      messages: [
        plannedReply(
          [
            {
              arguments: {
                description: 'Resume prose-only report',
                prompt: 'Continue the managed report.',
                resume: 'prose-only',
                role: 'feature',
                subagent_type: 'generalPurpose',
              },
              id: 'prose-only-resume',
              name: 'Task',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Resume the managed Task.', { expandPromptTemplates: false })
      expect(harness.observed).toHaveLength(0)
      const result = harness.session.messages.findLast(
        (message) => message.role === 'toolResult' && message.toolCallId === 'prose-only-resume',
      )
      expect(result?.content[0]?.text).toContain('retained issue binding')
    } finally {
      await harness.close()
    }
  })

  it.each([
    ['issue: issue-one\nissue: issue-one', false],
    ['issue: issue-one\nissue: issue-two', false],
    ['  IsSuE  :  issue-one  ', true],
  ])('handles legacy issue lines without ambiguous binding: %j', async (prompt, accepted) => {
    const harness = await sessionWithDeliveryTool({
      beforePrompt(sessionManager) {
        sessionManager.appendCustomEntry(
          '@nothingrotf/pstack/delivery-v1',
          emptyDeliveryIssue(sessionManager.getSessionId(), 'issue-one'),
        )
      },
      messages: [
        plannedReply(
          [
            {
              arguments: {
                description: 'Legacy managed work',
                prompt,
                role: 'feature',
                subagent_type: 'generalPurpose',
              },
              id: 'legacy-lines',
              name: 'Task',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Dispatch legacy managed work.', {
        expandPromptTemplates: false,
      })
      expect(harness.observed).toHaveLength(accepted ? 1 : 0)
      if (accepted) {
        expect(harness.observed[0].delivery).toEqual({ issue: 'issue-one', kind: 'managed' })
      } else {
        const result = harness.session.messages.findLast(
          (message) => message.role === 'toolResult' && message.toolCallId === 'legacy-lines',
        )
        expect(result?.content[0]?.text).toContain('exactly one issue field')
      }
    } finally {
      await harness.close()
    }
  })

  it('preflights every managed batch node before any Task starts', async () => {
    const harness = await sessionWithDeliveryTool({
      beforePrompt(sessionManager) {
        const ownerSessionId = sessionManager.getSessionId()
        sessionManager.appendCustomEntry(
          '@nothingrotf/pstack/delivery-v1',
          emptyDeliveryIssue(ownerSessionId, 'issue-one'),
        )
        sessionManager.appendCustomEntry(
          '@nothingrotf/pstack/delivery-v1',
          emptyDeliveryIssue(ownerSessionId, 'issue-two'),
        )
      },
      messages: [
        plannedReply(
          [
            {
              arguments: {
                tasks: [
                  {
                    description: 'Bound implementation',
                    id: 'bound',
                    prompt: 'issue: issue-one\\nImplement the correction.',
                    role: 'feature',
                    subagent_type: 'generalPurpose',
                  },
                  {
                    description: 'Unbound review',
                    id: 'unbound',
                    prompt: 'Review the correction.',
                    readonly: true,
                    role: 'code review',
                    subagent_type: 'generalPurpose',
                  },
                ],
              },
              id: 'mixed-batch',
              name: 'Task',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Start the managed batch.', { expandPromptTemplates: false })
      expect(harness.observed).toHaveLength(0)
      const result = harness.session.messages.findLast(
        (message) => message.role === 'toolResult' && message.toolCallId === 'mixed-batch',
      )
      expect(result?.content[0]?.text).toContain('issue binding')
    } finally {
      await harness.close()
    }
  })

  it('reads compact issue evidence and pages retained submissions without changing the ledger', async () => {
    const description = 'The original criterion remains intact. '.repeat(20)
    const inputs = [
      { action: 'read', issue: 'retries' },
      { action: 'read', issue: 'retries', view: 'submissions', offset: 1, limit: 1 },
      { action: 'read', issue: 'retries', view: 'criteria', offset: 0, limit: 1 },
      { action: 'read', issue: 'retries', view: 'submissions', offset: 99, limit: 1 },
    ]
    const harness = await sessionWithDeliveryTool({
      beforePrompt(sessionManager) {
        const issue = deliveryIssue(sessionManager.getSessionId(), true)
        issue.criteria[0].description = description
        sessionManager.appendCustomEntry('@nothingrotf/pstack/delivery-v1', issue)
      },
      messages: inputs.map((argumentsList, index) =>
        plannedReply(
          [
            {
              arguments: argumentsList,
              id: `read-${index}`,
              name: 'pstack_delivery',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ),
    })
    try {
      await harness.session.prompt('Read the issue evidence and inspect one retained attempt.', {
        expandPromptTemplates: false,
      })
      const results = harness.session.state.messages.filter(
        (message) => message.role === 'toolResult' && message.toolName === 'pstack_delivery',
      )
      expect(results).toHaveLength(4)
      expect(results.every((result) => !result.isError)).toBe(true)
      const compact = JSON.parse(results[0].content[0].text)
      expect(compact).toMatchObject({
        issue: 'retries',
        implementationOwner: 'implementer',
        submissionCount: 3,
        summary: { state: 'wip' },
        criteria: [
          { id: 'receipt', description: description.slice(0, 160), descriptionTruncated: true },
        ],
        recentAttempts: [
          { agentId: 'implementer' },
          { agentId: 'implementer' },
          { agentId: 'diagnostician' },
        ],
      })
      expect(compact.submissions).toBeUndefined()
      expect(compact.recentAttempts[2].evidence[0]).toMatchObject({
        reference: 'file:///diagnosis',
        sha256: 'a'.repeat(64),
      })
      expect(JSON.parse(results[1].content[0].text)).toMatchObject({
        issue: 'retries',
        offset: 1,
        nextOffset: 2,
        submissionCount: 3,
        submissions: [{ agentId: 'implementer', attempt: 2 }],
      })
      expect(JSON.parse(results[2].content[0].text)).toMatchObject({
        criteria: [{ id: 'receipt', description }],
        nextOffset: null,
      })
      expect(JSON.parse(results[3].content[0].text)).toMatchObject({
        submissions: [],
        nextOffset: null,
      })
      expect(
        harness.sessionManager
          .getBranch()
          .filter(
            (entry) =>
              entry.type === 'custom' && entry.customType === '@nothingrotf/pstack/delivery-v1',
          ),
      ).toHaveLength(1)
    } finally {
      await harness.close()
    }
  })

  it('pages oversized submissions as valid JSON without losing retained evidence', async () => {
    const issue = deliveryIssue('placeholder', true)
    const submission = issue.submissions[0]
    submission.evidence = Array.from({ length: 20 }, (_, index) => ({
      id: `read:${index + 1}`,
      kind: 'command',
      passed: true,
      reference: `file:///${'界\\\n'.repeat(800)}${index}`,
      sha256: 'a'.repeat(64),
    }))
    const serialized = JSON.stringify(submission)
    const inputs = [
      { action: 'read', issue: issue.issue, view: 'submissions', limit: 1 },
      ...Array.from({ length: Math.ceil(serialized.length / 4096) }, (_, index) => ({
        action: 'read',
        issue: issue.issue,
        view: 'submission',
        agentId: submission.agentId,
        attempt: submission.attempt,
        offset: index * 4096,
        limit: 4096,
        sha256: digest(serialized),
      })),
    ]
    const harness = await sessionWithDeliveryTool({
      beforePrompt(sessionManager) {
        issue.ownerSessionId = sessionManager.getSessionId()
        sessionManager.appendCustomEntry('@nothingrotf/pstack/delivery-v1', issue)
      },
      messages: inputs.map((input, index) =>
        plannedReply(
          [{ arguments: input, id: `page-${index}`, name: 'pstack_delivery', type: 'toolCall' }],
          'toolUse',
        ),
      ),
    })
    try {
      await harness.session.prompt('Read all retained evidence through bounded pages.', {
        expandPromptTemplates: false,
      })
      const results = harness.session.state.messages.filter(
        (message) => message.role === 'toolResult' && message.toolName === 'pstack_delivery',
      )
      expect(() => JSON.parse(results[0].content[0].text)).not.toThrow()
      expect(results.every((result) => !result.isError)).toBe(true)
      const pages = results.map((result) => {
        expect(Buffer.byteLength(result.content[0].text)).toBeLessThanOrEqual(32 * 1024)
        expect(Buffer.byteLength(JSON.stringify(result.details))).toBeLessThanOrEqual(32 * 1024)
        return JSON.parse(result.content[0].text)
      })
      expect(pages[0].submissions[0]).toMatchObject({
        agentId: submission.agentId,
        attempt: submission.attempt,
        partial: true,
        detail: { view: 'submission', agentId: submission.agentId, attempt: submission.attempt },
      })
      expect(pages[0].nextOffset).toBe(1)
      expect(pages.at(-1).nextOffset).toBeNull()
      expect(
        JSON.parse(
          pages
            .slice(1)
            .map((page) => page.content)
            .join(''),
        ),
      ).toEqual(submission)
      expect(
        harness.sessionManager.getBranch().filter((entry) => entry.type === 'custom'),
      ).toHaveLength(1)
    } finally {
      await harness.close()
    }
  })

  it('fails closed for corrupt ownership instead of discarding delivery authority', async () => {
    const harness = await sessionWithDeliveryTool({
      beforePrompt(sessionManager) {
        sessionManager.appendCustomEntry('@nothingrotf/pstack/delivery-v1', { version: 'corrupt' })
      },
    })
    try {
      await harness.session.prompt('Do not bypass corrupt delivery authority.', {
        expandPromptTemplates: false,
      })
      expect(harness.observed).toEqual([])
      const results = harness.session.messages.filter((message) => message.role === 'toolResult')
      expect(results.length).toBeGreaterThan(0)
      expect(results.every((message) => message.isError)).toBe(true)
      expect(
        harness.sessionManager.getBranch().filter((entry) => entry.type === 'custom'),
      ).toHaveLength(1)
    } finally {
      await harness.close()
    }
  })

  it('skips corrupt foreign checkpoints before opening a local issue', async () => {
    const harness = await sessionWithDeliveryTool({
      beforePrompt(sessionManager) {
        sessionManager.appendCustomEntry('@nothingrotf/pstack/delivery-v1', {
          ownerSessionId: 'another-session',
          version: 'corrupt',
        })
      },
    })
    try {
      await harness.session.prompt('Open the managed issue, then dispatch its Task.', {
        expandPromptTemplates: false,
      })
      expect(harness.observed).toHaveLength(1)
    } finally {
      await harness.close()
    }
  })

  it('accepts a semantically identical schema on the Task call', async () => {
    const harness = await sessionWithDeliveryTool({
      messages: [
        plannedReply(
          [
            {
              arguments: {
                action: 'open',
                criteria: [{ description: 'The command returns a receipt.', id: 'receipt' }],
                issue: 'delivery-tools',
                runtimeRequired: false,
              },
              id: 'open',
              name: 'pstack_delivery',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
        plannedReply(
          [
            {
              arguments: {
                description: 'Resume with the saved schema',
                outputSchema: reverseJson(DeliveryOutputSchema),
                prompt: 'issue: delivery-tools\nphase: correction',
                role: 'feature',
                subagent_type: 'generalPurpose',
              },
              id: 'resume',
              name: 'Task',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Open the managed issue, then resume its Task.', {
        expandPromptTemplates: false,
      })
      expect(harness.observed).toHaveLength(1)
    } finally {
      await harness.close()
    }
  })

  it('blocks a third implementation dispatch until a diagnosis is recorded', async () => {
    const harness = await sessionWithDeliveryTool({
      beforePrompt(sessionManager) {
        sessionManager.appendCustomEntry(
          '@nothingrotf/pstack/delivery-v1',
          deliveryIssue(sessionManager.getSessionId(), false),
        )
      },
      messages: [
        plannedReply(
          [
            {
              arguments: {
                description: 'Attempt a third correction',
                prompt: 'issue: retries\nphase: correction',
                role: 'unlisted implementation role',
                subagent_type: 'generalPurpose',
              },
              id: 'blocked',
              name: 'Task',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Attempt the correction.', { expandPromptTemplates: false })
      expect(harness.observed).toHaveLength(0)
      const result = harness.session.messages.findLast(
        (message) => message.role === 'toolResult' && message.toolName === 'Task',
      )
      expect(result?.content[0]?.text).toContain('require a recorded diagnosis')
    } finally {
      await harness.close()
    }
  })

  it('records a failed WIP without isolation through the protocol', async () => {
    const harness = await sessionWithDeliveryTool({
      beforePrompt(sessionManager) {
        sessionManager.appendCustomEntry(
          'pi-subagent-state',
          runtimeState(sessionManager.getSessionId(), [
            runRecord(sessionManager.getSessionId(), 'failed-wip'),
          ]),
        )
      },
      messages: [
        plannedReply(
          [
            {
              arguments: {
                action: 'open',
                criteria: [{ description: 'The command returns a receipt.', id: 'receipt' }],
                issue: 'delivery-tools',
                runtimeRequired: false,
              },
              id: 'open',
              name: 'pstack_delivery',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
        plannedReply(
          [
            {
              arguments: { action: 'record', agentId: 'failed-wip', issue: 'delivery-tools' },
              id: 'record',
              name: 'pstack_delivery',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Open and record the failed task.', {
        expandPromptTemplates: false,
      })
      const result = harness.session.messages.findLast(
        (message) => message.role === 'toolResult' && message.toolCallId === 'record',
      )
      expect(result?.isError).toBe(false)
      expect(JSON.parse(result.content[0].text).summary.state).toBe('wip')
    } finally {
      await harness.close()
    }
  })

  it('bounds a 5KB fallback failure reason while preserving WIP', async () => {
    const error = 'x'.repeat(5_120)
    const harness = await sessionWithDeliveryTool({
      beforePrompt(sessionManager) {
        const record = runRecord(sessionManager.getSessionId(), 'long-failure')
        record.error = error
        sessionManager.appendCustomEntry(
          'pi-subagent-state',
          runtimeState(sessionManager.getSessionId(), [record]),
        )
      },
      messages: [
        plannedReply(
          [
            {
              arguments: {
                action: 'open',
                criteria: [{ description: 'Verified.', id: 'receipt' }],
                issue: 'delivery-tools',
                runtimeRequired: false,
              },
              id: 'open',
              name: 'pstack_delivery',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
        plannedReply(
          [
            {
              arguments: { action: 'record', agentId: 'long-failure', issue: 'delivery-tools' },
              id: 'long-record',
              name: 'pstack_delivery',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Record the failed task.', { expandPromptTemplates: false })
      const issue = retainedIssue(harness.sessionManager, 'delivery-tools')
      expect(issue?.submissions[0].report.state).toBe('wip')
      expect(issue?.submissions[0].report.reason).toHaveLength(4_096)
      expect(issue?.submissions).toHaveLength(1)
      const reopened = SessionManager.open(harness.sessionManager.getSessionFile())
      expect(retainedIssue(reopened, 'delivery-tools')).toEqual(issue)
    } finally {
      await harness.close()
    }
  })

  it('records a valid read-only diagnosis from a read receipt without command citations', async () => {
    const contents = 'The failed correction target changed.\\n'
    let workspace
    const harness = await sessionWithDeliveryTool({
      async setup(cwd) {
        workspace = cwd
        await writeFile(join(cwd, 'diagnosis.txt'), contents)
      },
      beforePrompt(sessionManager) {
        const ownerSessionId = sessionManager.getSessionId()
        const record = runRecord(ownerSessionId, 'diagnostician', resumeContract())
        record.execution.readonly = true
        record.readonly = true
        record.role = 'hardest tasks'
        record.status = 'completed'
        record.output = 'Terminal prose without a structured report.'
        const report = {
          criteria: [{ evidence: ['read:1'], id: 'receipt', result: 'pass' }],
          failureClass: 'execution-contract',
          findings: [],
          issue: 'delivery-tools',
          kind: 'diagnosis',
          reason: 'The failed correction target changed before the retry.',
          state: 'wip',
        }
        record.structuredOutput = {
          data: report,
          mode: 'strict',
          source: 'caller',
          status: 'valid',
        }
        record.toolExecutionReceipts = [
          {
            callId: 'diagnosis-read',
            completedAt: 1,
            isError: false,
            output: artifactReference(
              pathToFileURL(join(workspace, 'diagnosis.txt')).toString(),
              contents,
            ),
            startedAt: 0,
            status: 'success',
            tool: 'read',
          },
        ]
        sessionManager.appendCustomEntry(
          '@nothingrotf/pstack/delivery-v1',
          emptyDeliveryIssue(ownerSessionId, 'delivery-tools'),
        )
        sessionManager.appendCustomEntry(
          'pi-subagent-state',
          runtimeState(ownerSessionId, [record]),
        )
      },
      messages: [
        plannedReply(
          [
            {
              arguments: { action: 'record', agentId: 'diagnostician', issue: 'delivery-tools' },
              id: 'diagnosis-record',
              name: 'pstack_delivery',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Record the diagnostic report.', {
        expandPromptTemplates: false,
      })
      const issue = retainedIssue(harness.sessionManager, 'delivery-tools')
      expect(issue?.submissions[0].report.kind).toBe('diagnosis')
      expect(issue?.submissions[0].evidence).toEqual([
        expect.objectContaining({
          id: 'read:1',
          reference: pathToFileURL(join(workspace, 'diagnosis.txt')).toString(),
        }),
      ])
      expect(issue?.submissions[0].evidence.some((item) => item.id.startsWith('command:'))).toBe(
        false,
      )
    } finally {
      await harness.close()
    }
  })

  it.each([
    { role: 'code review', receipt: 'valid', runtimeRequired: false, expected: 'accepted' },
    { role: 'code review', receipt: 'valid', runtimeRequired: true, expected: 'accepted' },
    { role: 'code review', receipt: 'failed', runtimeRequired: false, expected: 'wip' },
    { role: 'code review', receipt: 'tampered', runtimeRequired: false, expected: 'wip' },
    { role: 'code review', receipt: 'missing', runtimeRequired: false, expected: 'wip' },
    { role: 'code review', receipt: 'wrong-tree', runtimeRequired: false, expected: 'wip' },
    { role: 'runtime verification', receipt: 'valid', runtimeRequired: true, expected: 'wip' },
  ])(
    'records $role with $receipt read receipts and runtimeRequired=$runtimeRequired as $expected',
    async ({ role, receipt, runtimeRequired, expected }) => {
      let workspace
      let target
      const contents = [
        'The candidate code was inspected.\n',
        'The retained runtime report was read.\n',
      ]
      const report = {
        criteria: [
          {
            evidence: ['read:1', receipt === 'missing' ? 'read:3' : 'read:2'],
            id: 'receipt',
            result: 'pass',
          },
        ],
        failureClass: 'none',
        findings: [],
        issue: 'resume-target',
        kind: role === 'code review' ? 'technical-review' : 'runtime-verification',
        reason: 'The retained candidate evidence was inspected.',
        state: 'accepted',
      }
      if (receipt === 'tampered') {
        report.state = 'blocked'
        report.findings.push({
          id: 'retained-blocker',
          blocking: true,
          disposition: 'open',
          evidence: ['read:2'],
        })
      }
      const harness = await sessionWithDeliveryTool({
        async setup(cwd) {
          workspace = cwd
          target = await nestedGitWorkspace(cwd)
          for (const [index, content] of contents.entries()) {
            await writeFile(join(cwd, `read-${index + 1}.txt`), content)
          }
          await writeFile(join(cwd, 'review.json'), JSON.stringify(report))
        },
        async beforePrompt(sessionManager) {
          const ownerSessionId = sessionManager.getSessionId()
          const snapshot = await captureWorkspaceSnapshot(target)
          if (snapshot === undefined) throw new Error('The candidate snapshot is unavailable.')
          const candidate = candidateIssue(ownerSessionId, deliveryArtifact(snapshot), snapshot)
          candidate.runtimeRequired = runtimeRequired
          const executionSnapshot = structuredClone(snapshot)
          if (receipt === 'wrong-tree') executionSnapshot.repositories[0].tree = 'a'.repeat(40)
          const record = managedRecord(
            ownerSessionId,
            'read-reviewer',
            role,
            report,
            executionSnapshot,
            artifactReference(
              pathToFileURL(join(workspace, 'review.json')).toString(),
              JSON.stringify(report),
            ),
            role === 'runtime verification'
              ? isolationReceipt(snapshot, 'not-requested')
              : undefined,
          )
          record.toolExecutionReceipts = contents.map((content, index) => ({
            callId: `review-read-${index + 1}`,
            completedAt: index + 1,
            isError: receipt === 'failed' && index === 1,
            output: artifactReference(
              pathToFileURL(join(workspace, `read-${index + 1}.txt`)).toString(),
              content,
            ),
            startedAt: index,
            status: receipt === 'failed' && index === 1 ? 'error' : 'success',
            tool: 'read',
          }))
          if (receipt === 'tampered') await writeFile(join(workspace, 'read-2.txt'), 'replaced\n')
          sessionManager.appendCustomEntry('@nothingrotf/pstack/delivery-v1', candidate)
          sessionManager.appendCustomEntry(
            'pi-subagent-state',
            runtimeState(ownerSessionId, [record]),
          )
        },
        messages: [
          plannedReply(
            [
              {
                arguments: { action: 'record', agentId: 'read-reviewer', issue: 'resume-target' },
                id: 'record-read-review',
                name: 'pstack_delivery',
                type: 'toolCall',
              },
            ],
            'toolUse',
          ),
        ],
      })
      try {
        await harness.session.prompt('Record the read-based review.', {
          expandPromptTemplates: false,
        })
        const submission = retainedIssue(harness.sessionManager, 'resume-target')?.submissions.at(
          -1,
        )
        expect(submission?.agentId).toBe('read-reviewer')
        expect(submission?.report.state).toBe(expected)
        const result = harness.session.messages.findLast(
          (message) => message.role === 'toolResult' && message.toolCallId === 'record-read-review',
        )
        expect(result?.details.state).toBe(
          expected === 'accepted' && !runtimeRequired ? 'accepted' : 'candidate',
        )
        if (receipt === 'tampered') {
          expect(submission.report.findings).toEqual(report.findings)
          expect(submission.report.criteria).toEqual(report.criteria)
          expect(result.details.unresolvedFindings).toContain('retained-blocker')
        }
        if (expected === 'accepted') {
          expect(submission.evidence.filter((item) => item.id.startsWith('read:'))).toEqual([
            expect.objectContaining({ id: 'read:1', passed: true, sha256: digest(contents[0]) }),
            expect.objectContaining({ id: 'read:2', passed: true, sha256: digest(contents[1]) }),
          ])
          expect(submission.evidence.some((item) => item.id.startsWith('command:'))).toBe(false)
        }
      } finally {
        await harness.close()
      }
    },
  )

  it('records tampered artifacts as recoverable WIP without promoting them', async () => {
    const contents = 'artifact\n'
    let workspace
    const harness = await sessionWithDeliveryTool({
      async setup(cwd) {
        workspace = cwd
        await writeFile(join(cwd, 'artifact.txt'), contents)
      },
      beforePrompt(sessionManager) {
        const record = runRecord(sessionManager.getSessionId(), 'tampered')
        record.artifact = {
          ...artifactReference(pathToFileURL(join(workspace, 'artifact.txt')).toString(), contents),
          sha256: '0'.repeat(64),
        }
        sessionManager.appendCustomEntry(
          'pi-subagent-state',
          runtimeState(sessionManager.getSessionId(), [record]),
        )
      },
      messages: [
        plannedReply(
          [
            {
              arguments: {
                action: 'open',
                criteria: [{ description: 'Verified.', id: 'receipt' }],
                issue: 'delivery-tools',
                runtimeRequired: false,
              },
              id: 'open',
              name: 'pstack_delivery',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
        plannedReply(
          [
            {
              arguments: { action: 'record', agentId: 'tampered', issue: 'delivery-tools' },
              id: 'tampered-record',
              name: 'pstack_delivery',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Record the tampered artifact.', {
        expandPromptTemplates: false,
      })
      const result = harness.session.messages.findLast(
        (message) => message.role === 'toolResult' && message.toolCallId === 'tampered-record',
      )
      expect(result?.isError).toBe(false)
      expect(result?.details.state).toBe('wip')
      expect(result?.content[0]?.text).toContain('Evidence digest mismatch')
    } finally {
      await harness.close()
    }
  })

  it('names the issue state and next step when review precedes a candidate', async () => {
    const harness = await sessionWithDeliveryTool({
      messages: [
        plannedReply(
          [
            {
              arguments: {
                action: 'open',
                criteria: [{ description: 'The command returns a receipt.', id: 'receipt' }],
                issue: 'delivery-tools',
                runtimeRequired: true,
              },
              id: 'open',
              name: 'pstack_delivery',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
        plannedReply(
          [
            {
              arguments: {
                description: 'Review nothing',
                prompt: 'issue: delivery-tools',
                readonly: true,
                role: 'code review',
                subagent_type: 'generalPurpose',
              },
              id: 'early-review',
              name: 'Task',
              type: 'toolCall',
            },
            {
              arguments: {
                description: 'Verify nothing',
                isolation: { integration: 'manual', mode: 'worktree' },
                prompt: 'issue: delivery-tools',
                role: 'runtime verification',
                subagent_type: 'generalPurpose',
              },
              id: 'early-verify',
              name: 'Task',
              type: 'toolCall',
            },
            {
              arguments: {
                description: 'Publish nothing',
                prompt: 'issue: delivery-tools',
                role: 'publication',
                subagent_type: 'generalPurpose',
              },
              id: 'early-publish',
              name: 'Task',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Open and review too early.', {
        expandPromptTemplates: false,
      })
      expect(harness.observed).toHaveLength(0)
      const text = (id) =>
        harness.session.messages.findLast(
          (message) => message.role === 'toolResult' && message.toolCallId === id,
        )?.content[0]?.text
      expect(text('early-review')).toContain(
        'Static review requires the current candidate artifact.',
      )
      expect(text('early-review')).toContain(
        'Issue delivery-tools is wip, unresolved criteria receipt.',
      )
      expect(text('early-review')).toContain('Record an implementation candidate')
      expect(text('early-verify')).toContain(
        'Runtime verification requires the integrated candidate artifact.',
      )
      expect(text('early-verify')).toContain('Issue delivery-tools is wip')
      expect(text('early-publish')).toContain('Publication must remain explicitly foreground.')
      expect(text('early-publish')).toContain('Pass run_in_background: false.')
    } finally {
      await harness.close()
    }
  })

  it('blocks a fresh unrecorded issue dispatch under an arbitrary role', async () => {
    const harness = await sessionWithDeliveryTool({
      beforePrompt(sessionManager) {
        const ownerSessionId = sessionManager.getSessionId()
        sessionManager.appendCustomEntry(
          'pi-subagent-state',
          runtimeState(ownerSessionId, [runRecord(ownerSessionId, 'unrecorded')]),
        )
        sessionManager.appendCustomEntry(
          '@nothingrotf/pstack/delivery-binding-v1',
          deliveryBinding(ownerSessionId, 'unrecorded', 'delivery-tools'),
        )
      },
      messages: [
        plannedReply(
          [
            {
              arguments: {
                action: 'open',
                criteria: [{ description: 'The command returns a receipt.', id: 'receipt' }],
                issue: 'delivery-tools',
                runtimeRequired: false,
              },
              id: 'open',
              name: 'pstack_delivery',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
        plannedReply(
          [
            {
              arguments: {
                description: 'Start another implementation',
                prompt: 'issue: delivery-tools\nphase: correction',
                role: 'unlisted implementation role',
                subagent_type: 'generalPurpose',
              },
              id: 'blocked-fresh',
              name: 'Task',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Open and redispatch.', { expandPromptTemplates: false })
      expect(harness.observed).toHaveLength(0)
      const result = harness.session.messages.findLast(
        (message) => message.role === 'toolResult' && message.toolCallId === 'blocked-fresh',
      )
      expect(result?.content[0]?.text).toContain('Record each terminal issue attempt')
    } finally {
      await harness.close()
    }
  })

  it('binds a failed Task from its actual dispatch even when output names no issue', async () => {
    const argumentsList = [
      {
        name: 'pstack_delivery',
        arguments: {
          action: 'open',
          criteria: [{ description: 'Verified.', id: 'receipt' }],
          issue: 'delivery-tools',
          runtimeRequired: false,
        },
      },
      {
        name: 'Task',
        arguments: {
          description: 'First attempt',
          prompt: 'issue: delivery-tools',
          role: 'feature',
          subagent_type: 'generalPurpose',
        },
      },
      {
        name: 'Task',
        arguments: {
          description: 'Equivalent retry',
          prompt: 'issue: delivery-tools',
          role: 'feature',
          subagent_type: 'generalPurpose',
        },
      },
    ]
    const harness = await sessionWithDeliveryTool({
      onTask(_input, sessionManager) {
        const record = runRecord(sessionManager.getSessionId(), 'failed-without-report')
        record.output = 'WIP. A recoverable edit failed.'
        sessionManager.appendCustomEntry(
          'pi-subagent-state',
          runtimeState(sessionManager.getSessionId(), [record]),
        )
        return {
          content: [{ type: 'text', text: record.output }],
          details: { agentId: record.agentId, status: 'failed' },
        }
      },
      messages: argumentsList.map((call, index) =>
        plannedReply([{ ...call, id: `binding-${index}`, type: 'toolCall' }], 'toolUse'),
      ),
    })
    try {
      await harness.session.prompt('Dispatch, then retry without recording the failed attempt.', {
        expandPromptTemplates: false,
      })
      expect(harness.observed).toHaveLength(1)
      const result = harness.session.messages.findLast(
        (message) => message.role === 'toolResult' && message.toolCallId === 'binding-2',
      )
      expect(result?.content[0]?.text).toContain('Record each terminal issue attempt')
      expect(result?.content[0]?.text).toContain(
        'Unrecorded: failed-without-report attempt 1 (failed)',
      )
      expect(result?.content[0]?.text).toContain('Call pstack_delivery record for each one first')
    } finally {
      await harness.close()
    }
  })

  it('does not bind an agent ID when preflight reports attemptStarted false', async () => {
    let calls = 0
    const harness = await sessionWithDeliveryTool({
      onTask() {
        calls += 1
        return {
          content: [{ type: 'text', text: 'Preflight rejected.' }],
          details: { agentId: 'never-started', attemptStarted: false, status: 'failed' },
        }
      },
      messages: [
        plannedReply(
          [
            {
              arguments: {
                action: 'open',
                criteria: [{ description: 'Verified.', id: 'receipt' }],
                issue: 'delivery-tools',
                runtimeRequired: false,
              },
              id: 'open',
              name: 'pstack_delivery',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
        ...[1, 2].map((attempt) =>
          plannedReply(
            [
              {
                arguments: {
                  delivery: { issue: 'delivery-tools', kind: 'managed' },
                  description: `Rejected attempt ${attempt}`,
                  prompt: 'Attempt managed work.',
                  role: 'feature',
                  subagent_type: 'generalPurpose',
                },
                id: `not-started-${attempt}`,
                name: 'Task',
                type: 'toolCall',
              },
            ],
            'toolUse',
          ),
        ),
      ],
    })
    try {
      await harness.session.prompt('Retry a rejected preflight.', {
        expandPromptTemplates: false,
      })
      expect(calls).toBe(2)
      const bindings = harness.sessionManager
        .getBranch()
        .filter(
          (entry) =>
            entry.type === 'custom' &&
            entry.customType === '@nothingrotf/pstack/delivery-binding-v1',
        )
      expect(bindings).toHaveLength(0)
    } finally {
      await harness.close()
    }
  })

  it('forbids independent publication once managed delivery is active', async () => {
    const harness = await sessionWithDeliveryTool({
      beforePrompt(sessionManager) {
        sessionManager.appendCustomEntry(
          '@nothingrotf/pstack/delivery-v1',
          deliveryIssue(sessionManager.getSessionId(), false),
        )
      },
      messages: [
        plannedReply(
          [
            {
              name: 'Task',
              id: 'unbound-publication',
              type: 'toolCall',
              arguments: {
                delivery: { kind: 'independent' },
                description: 'Publish without binding',
                prompt: 'Publish.',
                role: 'publication',
                run_in_background: false,
                subagent_type: 'generalPurpose',
              },
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Attempt publication without the managed issue.', {
        expandPromptTemplates: false,
      })
      expect(harness.observed).toHaveLength(0)
      const result = harness.session.messages.findLast(
        (message) => message.role === 'toolResult' && message.toolCallId === 'unbound-publication',
      )
      expect(result?.content[0]?.text).toContain('cannot opt out')
    } finally {
      await harness.close()
    }
  })

  it('does not impose managed contracts on an unrelated plain resume', async () => {
    const harness = await sessionWithDeliveryTool({
      messages: [
        plannedReply(
          [
            {
              name: 'Task',
              id: 'plain-resume',
              type: 'toolCall',
              arguments: {
                description: 'Continue plain work',
                prompt: 'Continue reading.',
                resume: 'plain-agent',
                subagent_type: 'generalPurpose',
              },
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Continue the unrelated Task.', { expandPromptTemplates: false })
      expect(harness.observed).toHaveLength(1)
      expect(harness.observed[0].outputSchema).toBeUndefined()
    } finally {
      await harness.close()
    }
  })

  it('preserves issue binding for a recorded managed resume', async () => {
    const harness = await sessionWithDeliveryTool({
      beforePrompt(sessionManager) {
        const ownerSessionId = sessionManager.getSessionId()
        sessionManager.appendCustomEntry(
          'pi-subagent-state',
          runtimeState(ownerSessionId, [
            runRecord(ownerSessionId, 'resume-owner', resumeContract()),
          ]),
        )
        sessionManager.appendCustomEntry(
          '@nothingrotf/pstack/delivery-binding-v1',
          deliveryBinding(ownerSessionId, 'resume-owner', 'delivery-tools'),
        )
      },
      messages: [
        plannedReply(
          [
            {
              arguments: {
                action: 'open',
                criteria: [{ description: 'The command returns a receipt.', id: 'receipt' }],
                issue: 'delivery-tools',
                runtimeRequired: false,
              },
              id: 'open',
              name: 'pstack_delivery',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
        plannedReply(
          [
            {
              arguments: { action: 'record', agentId: 'resume-owner', issue: 'delivery-tools' },
              id: 'record',
              name: 'pstack_delivery',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
        plannedReply(
          [
            {
              arguments: {
                description: 'Resume the recorded task',
                prompt: 'Continue the managed correction.',
                resume: 'resume-owner',
                subagent_type: 'generalPurpose',
              },
              id: 'resume',
              name: 'Task',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Open, record, and resume.', { expandPromptTemplates: false })
      expect(harness.observed).toHaveLength(1)
      expect(harness.observed[0].prompt).toContain('issue: delivery-tools')
    } finally {
      await harness.close()
    }
  })

  it.each([
    ['legacy binding', true, false],
    ['stored delivery contract', false, true],
  ])('rejects independent escape from a managed %s', async (_label, bound, storedContract) => {
    const harness = await sessionWithDeliveryTool({
      beforePrompt(sessionManager) {
        const ownerSessionId = sessionManager.getSessionId()
        const execution = resumeContract('/tmp', 4)
        if (!storedContract) {
          delete execution.outputSchema
          execution.schemaMode = 'permissive'
        }
        sessionManager.appendCustomEntry(
          '@nothingrotf/pstack/delivery-v1',
          emptyDeliveryIssue(ownerSessionId, 'delivery-tools'),
        )
        sessionManager.appendCustomEntry(
          'pi-subagent-state',
          runtimeState(ownerSessionId, [
            runRecord(ownerSessionId, 'legacy-managed-owner', execution),
          ]),
        )
        if (bound) {
          sessionManager.appendCustomEntry(
            '@nothingrotf/pstack/delivery-binding-v1',
            deliveryBinding(ownerSessionId, 'legacy-managed-owner', 'delivery-tools'),
          )
        }
      },
      messages: [
        plannedReply(
          [
            {
              arguments: {
                delivery: { kind: 'independent' },
                description: 'Escape managed delivery',
                prompt: 'Continue outside the issue.',
                resume: 'legacy-managed-owner',
                subagent_type: 'generalPurpose',
              },
              id: 'legacy-independent-escape',
              name: 'Task',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Attempt the legacy escape.', {
        expandPromptTemplates: false,
      })
      expect(harness.observed).toHaveLength(0)
      const result = harness.session.messages.findLast(
        (message) =>
          message.role === 'toolResult' && message.toolCallId === 'legacy-independent-escape',
      )
      expect(result?.content[0]?.text).toContain('cannot escape its retained issue binding')
    } finally {
      await harness.close()
    }
  })

  it('preserves an ordinary unbound legacy resume', async () => {
    const harness = await sessionWithDeliveryTool({
      beforePrompt(sessionManager) {
        const ownerSessionId = sessionManager.getSessionId()
        const execution = resumeContract('/tmp', 4)
        delete execution.outputSchema
        execution.schemaMode = 'permissive'
        sessionManager.appendCustomEntry(
          'pi-subagent-state',
          runtimeState(ownerSessionId, [runRecord(ownerSessionId, 'ordinary-legacy', execution)]),
        )
      },
      messages: [
        plannedReply(
          [
            {
              arguments: {
                description: 'Continue ordinary legacy work',
                prompt: 'Continue reading.',
                resume: 'ordinary-legacy',
                subagent_type: 'generalPurpose',
              },
              id: 'ordinary-legacy-resume',
              name: 'Task',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Resume ordinary legacy work.', {
        expandPromptTemplates: false,
      })
      expect(harness.observed).toHaveLength(1)
      expect(harness.observed[0].delivery).toBeUndefined()
      expect(harness.observed[0].outputSchema).toBeUndefined()
    } finally {
      await harness.close()
    }
  })

  it.each([
    ['code review', 3, true],
    ['code review', 4, true],
    ['runtime verification', 3, false],
    ['runtime verification', 4, false],
  ])(
    'uses persisted cwd and isolation for a managed %s resume (%s)',
    async (role, version, readonly) => {
      let target
      const harness = await sessionWithDeliveryTool({
        async setup(cwd) {
          target = await nestedGitWorkspace(cwd)
        },
        async beforePrompt(sessionManager) {
          const ownerSessionId = sessionManager.getSessionId()
          const snapshot = await captureWorkspaceSnapshot(target)
          if (snapshot === undefined) throw new Error('The inner target snapshot is unavailable.')
          const artifact = deliveryArtifact(snapshot)
          const isolation =
            role === 'runtime verification'
              ? { integration: 'manual', mode: 'worktree' }
              : undefined
          const execution = resumeContract(target, version, isolation)
          execution.readonly = readonly
          execution.role = role
          const record = runRecord(
            ownerSessionId,
            `${role.replaceAll(' ', '-')}-${version}`,
            execution,
          )
          record.readonly = readonly
          record.role = role
          record.status = 'running'
          sessionManager.appendCustomEntry(
            '@nothingrotf/pstack/delivery-v1',
            candidateIssue(ownerSessionId, artifact, snapshot),
          )
          sessionManager.appendCustomEntry(
            'pi-subagent-state',
            runtimeState(ownerSessionId, [record]),
          )
          sessionManager.appendCustomEntry(
            '@nothingrotf/pstack/delivery-binding-v1',
            deliveryBinding(ownerSessionId, record.agentId, 'resume-target'),
          )
        },
        messages: [
          plannedReply(
            [
              {
                arguments: {
                  description: `Resume ${role}`,
                  prompt: 'Continue the managed check.',
                  resume: `${role.replaceAll(' ', '-')}-${version}`,
                  subagent_type: 'generalPurpose',
                },
                id: `resume-${role}-${version}`,
                name: 'Task',
                type: 'toolCall',
              },
            ],
            'toolUse',
          ),
        ],
      })
      try {
        await harness.session.prompt('Resume the managed check.', { expandPromptTemplates: false })
        expect(harness.observed).toHaveLength(1)
        const task = harness.observed[0]
        expect(task.cwd).toBe(target)
        expect(task.outputSchema).toEqual(DeliveryOutputSchema)
        expect(task.schemaMode).toBe('strict')
        expect(task.prompt).toContain('Managed issue: resume-target. Delivery: candidate.')
        if (role === 'runtime verification')
          expect(task.isolation).toEqual({ integration: 'manual', mode: 'worktree' })
      } finally {
        await harness.close()
      }
    },
  )

  it.each([
    { integration: 'apply', mode: 'worktree' },
    { integration: 'branch', mode: 'worktree' },
  ])('rejects an explicit non-manual fresh runtime isolation policy', async (isolation) => {
    let target
    const harness = await sessionWithDeliveryTool({
      async setup(cwd) {
        target = await nestedGitWorkspace(cwd)
      },
      async beforePrompt(sessionManager) {
        const ownerSessionId = sessionManager.getSessionId()
        const snapshot = await captureWorkspaceSnapshot(target)
        if (snapshot === undefined) throw new Error('The inner target snapshot is unavailable.')
        sessionManager.appendCustomEntry(
          '@nothingrotf/pstack/delivery-v1',
          candidateIssue(ownerSessionId, deliveryArtifact(snapshot), snapshot),
        )
      },
      messages: [
        plannedReply(
          [
            {
              arguments: {
                cwd: 'inner-target',
                description: 'Reject non-manual runtime isolation',
                isolation,
                prompt: 'issue: resume-target',
                readonly: false,
                role: 'runtime verification',
                subagent_type: 'generalPurpose',
              },
              id: `non-manual-${isolation.integration}`,
              name: 'Task',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Reject non-manual runtime isolation.', {
        expandPromptTemplates: false,
      })
      expect(harness.observed).toHaveLength(0)
    } finally {
      await harness.close()
    }
  })

  it.each([
    ['omitted', undefined],
    ['mode-only', { mode: 'worktree' }],
  ])('normalizes %s fresh runtime isolation to manual', async (_label, isolation) => {
    let target
    const task = {
      arguments: {
        cwd: 'inner-target',
        description: 'Normalize runtime isolation',
        prompt: 'issue: resume-target',
        readonly: false,
        role: 'runtime verification',
        subagent_type: 'generalPurpose',
      },
      id: 'normalize-runtime',
      name: 'Task',
      type: 'toolCall',
    }
    if (isolation !== undefined) task.arguments.isolation = isolation
    const harness = await sessionWithDeliveryTool({
      async setup(cwd) {
        target = await nestedGitWorkspace(cwd)
      },
      async beforePrompt(sessionManager) {
        const ownerSessionId = sessionManager.getSessionId()
        const snapshot = await captureWorkspaceSnapshot(target)
        if (snapshot === undefined) throw new Error('The inner target snapshot is unavailable.')
        sessionManager.appendCustomEntry(
          '@nothingrotf/pstack/delivery-v1',
          candidateIssue(ownerSessionId, deliveryArtifact(snapshot), snapshot),
        )
      },
      messages: [plannedReply([task], 'toolUse')],
    })
    try {
      await harness.session.prompt('Normalize fresh runtime isolation.', {
        expandPromptTemplates: false,
      })
      expect(harness.observed).toHaveLength(1)
      expect(harness.observed[0].isolation).toEqual({ integration: 'manual', mode: 'worktree' })
      expect(harness.observed[0].outputSchema).toEqual(DeliveryOutputSchema)
      expect(harness.observed[0].schemaMode).toBe('strict')
    } finally {
      await harness.close()
    }
  })

  it('rejects explicit readonly runtime verification', async () => {
    let target
    const harness = await sessionWithDeliveryTool({
      async setup(cwd) {
        target = await nestedGitWorkspace(cwd)
      },
      async beforePrompt(sessionManager) {
        const ownerSessionId = sessionManager.getSessionId()
        const snapshot = await captureWorkspaceSnapshot(target)
        if (snapshot === undefined) throw new Error('The inner target snapshot is unavailable.')
        sessionManager.appendCustomEntry(
          '@nothingrotf/pstack/delivery-v1',
          candidateIssue(ownerSessionId, deliveryArtifact(snapshot), snapshot),
        )
      },
      messages: [
        plannedReply(
          [
            {
              arguments: {
                cwd: 'inner-target',
                description: 'Reject readonly runtime verification',
                prompt: 'issue: resume-target',
                readonly: true,
                role: 'runtime verification',
                subagent_type: 'generalPurpose',
              },
              id: 'readonly-runtime',
              name: 'Task',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Reject readonly runtime verification.', {
        expandPromptTemplates: false,
      })
      expect(harness.observed).toHaveLength(0)
    } finally {
      await harness.close()
    }
  })

  it.each([false, true])(
    'records the complete delivery and respects a late negative verdict: %s',
    async (blocked) => {
      let snapshot
      let records
      let workspace
      const reports = {
        implementation: {
          criteria: [{ evidence: ['patch:.'], id: 'receipt', result: 'pass' }],
          failureClass: 'none',
          findings: [],
          issue: 'roundtrip',
          kind: 'implementation',
          reason: 'Verified candidate.',
          state: 'candidate',
        },
        review: {
          criteria: [{ evidence: ['patch:.'], id: 'receipt', result: 'pass' }],
          failureClass: 'none',
          findings: [],
          issue: 'roundtrip',
          kind: 'technical-review',
          reason: 'Review accepted.',
          state: 'accepted',
        },
        runtime: {
          criteria: [{ evidence: ['command:1'], id: 'receipt', result: 'pass' }],
          failureClass: 'none',
          findings: [],
          issue: 'roundtrip',
          kind: 'runtime-verification',
          reason: 'Runtime accepted.',
          state: 'accepted',
        },
      }
      const harness = await sessionWithDeliveryTool({
        async setup(cwd) {
          workspace = cwd
          await execFile('git', ['init', '-q'], { cwd })
          await execFile('git', ['config', 'user.email', 'test@example.test'], { cwd })
          await execFile('git', ['config', 'user.name', 'Delivery Test'], { cwd })
          await writeFile(join(cwd, '.gitignore'), 'agent\nsessions\nreceipt.txt\nreport.json\n')
          await writeFile(join(cwd, 'product.txt'), 'candidate\n')
          await execFile('git', ['add', '.gitignore', 'product.txt'], { cwd })
          await execFile('git', ['commit', '-qm', 'candidate'], { cwd })
          const receipt = 'runtime verified\n'
          await writeFile(join(cwd, 'receipt.txt'), receipt)
          await writeFile(join(cwd, 'report.json'), JSON.stringify(reports))
        },
        async beforePrompt(sessionManager) {
          const captured = await captureWorkspaceSnapshot(workspace)
          if (captured === undefined) throw new Error('The test workspace snapshot is unavailable.')
          snapshot = captured
          const artifact = artifactReference(
            pathToFileURL(join(workspace, 'report.json')).toString(),
            JSON.stringify(reports),
          )
          const receipt = artifactReference(
            pathToFileURL(join(workspace, 'receipt.txt')).toString(),
            'runtime verified\n',
          )
          records = [
            managedRecord(
              sessionManager.getSessionId(),
              'implementation',
              'feature',
              reports.implementation,
              snapshot,
              artifact,
              isolationReceipt(snapshot, 'not-requested'),
            ),
            managedRecord(
              sessionManager.getSessionId(),
              'review',
              'code review',
              reports.review,
              snapshot,
              artifact,
            ),
            managedRecord(
              sessionManager.getSessionId(),
              'runtime',
              'runtime verification',
              reports.runtime,
              snapshot,
              artifact,
              isolationReceipt(snapshot, 'not-requested'),
            ),
          ]
          if (blocked)
            records.push(
              managedRecord(
                sessionManager.getSessionId(),
                'runtime-blocked',
                'runtime verification',
                { ...reports.runtime, state: 'blocked', reason: 'A regression was reproduced' },
                snapshot,
                artifact,
                isolationReceipt(snapshot, 'not-requested'),
              ),
            )
          records[2].toolExecutionReceipts = [
            {
              callId: 'runtime-command',
              command: 'bun run test',
              completedAt: 1,
              isError: false,
              output: receipt,
              startedAt: 0,
              status: 'success',
              tool: 'bash',
            },
          ]
          sessionManager.appendCustomEntry(
            'pi-subagent-state',
            runtimeState(sessionManager.getSessionId(), records),
          )
        },
        onTask(input, sessionManager) {
          if (input.role === 'publication') {
            const publication = runRecord(sessionManager.getSessionId(), 'publication-agent')
            publication.role = 'publication'
            publication.status = 'completed'
            publication.output = 'Publication completed.'
            records.push(publication)
            sessionManager.appendCustomEntry(
              'pi-subagent-state',
              runtimeState(sessionManager.getSessionId(), records),
            )
            return {
              content: [{ type: 'text', text: publication.output }],
              details: { agentId: publication.agentId },
            }
          }
          if (records[0].isolation.integrationStatus === 'not-requested') {
            records[0].isolation.integrationStatus = 'integrated'
            sessionManager.appendCustomEntry(
              'pi-subagent-state',
              runtimeState(sessionManager.getSessionId(), records),
            )
          }
        },
        messages: [
          plannedReply(
            [
              {
                arguments: {
                  action: 'open',
                  criteria: [{ description: 'Verified.', id: 'receipt' }],
                  issue: 'roundtrip',
                  runtimeRequired: true,
                },
                id: 'open',
                name: 'pstack_delivery',
                type: 'toolCall',
              },
            ],
            'toolUse',
          ),
          plannedReply(
            [
              {
                arguments: { action: 'record', agentId: 'implementation', issue: 'roundtrip' },
                id: 'implementation-record',
                name: 'pstack_delivery',
                type: 'toolCall',
              },
            ],
            'toolUse',
          ),
          plannedReply(
            [
              {
                arguments: {
                  description: 'Review candidate',
                  prompt: 'issue: roundtrip',
                  readonly: true,
                  role: 'code review',
                  subagent_type: 'generalPurpose',
                },
                id: 'review-task',
                name: 'Task',
                type: 'toolCall',
              },
            ],
            'toolUse',
          ),
          plannedReply(
            [
              {
                arguments: { action: 'refresh', agentId: 'implementation', issue: 'roundtrip' },
                id: 'refresh',
                name: 'pstack_delivery',
                type: 'toolCall',
              },
            ],
            'toolUse',
          ),
          plannedReply(
            [
              {
                arguments: { action: 'record', agentId: 'review', issue: 'roundtrip' },
                id: 'review-record',
                name: 'pstack_delivery',
                type: 'toolCall',
              },
            ],
            'toolUse',
          ),
          plannedReply(
            [
              {
                arguments: {
                  description: 'Verify candidate',
                  isolation: { integration: 'manual', mode: 'worktree' },
                  prompt: 'issue: roundtrip',
                  readonly: false,
                  role: 'runtime verification',
                  subagent_type: 'generalPurpose',
                },
                id: 'runtime-task',
                name: 'Task',
                type: 'toolCall',
              },
            ],
            'toolUse',
          ),
          plannedReply(
            [
              {
                arguments: { action: 'record', agentId: 'runtime', issue: 'roundtrip' },
                id: 'runtime-record',
                name: 'pstack_delivery',
                type: 'toolCall',
              },
            ],
            'toolUse',
          ),
          ...(blocked
            ? [
                plannedReply(
                  [
                    {
                      arguments: {
                        action: 'record',
                        agentId: 'runtime-blocked',
                        issue: 'roundtrip',
                      },
                      id: 'negative-verdict',
                      name: 'pstack_delivery',
                      type: 'toolCall',
                    },
                  ],
                  'toolUse',
                ),
              ]
            : []),
          plannedReply(
            [
              {
                arguments: {
                  description: 'Publish accepted candidate',
                  prompt: 'issue: roundtrip',
                  role: 'publication',
                  run_in_background: false,
                  subagent_type: 'generalPurpose',
                },
                id: 'publication',
                name: 'Task',
                type: 'toolCall',
              },
            ],
            'toolUse',
          ),
          ...(blocked
            ? []
            : [
                plannedReply(
                  [
                    {
                      arguments: {
                        action: 'record',
                        agentId: 'publication-agent',
                        issue: 'roundtrip',
                      },
                      id: 'publication-record',
                      name: 'pstack_delivery',
                      type: 'toolCall',
                    },
                  ],
                  'toolUse',
                ),
              ]),
        ],
      })
      try {
        await harness.session.prompt('Complete the managed delivery.', {
          expandPromptTemplates: false,
        })
        expect(harness.observed.map((task) => task.role)).toEqual(
          blocked
            ? ['code review', 'runtime verification']
            : ['code review', 'runtime verification', 'publication'],
        )
        const publication = harness.session.messages.findLast(
          (message) => message.role === 'toolResult' && message.toolCallId === 'publication',
        )
        expect(publication?.isError).toBe(blocked)
        if (!blocked) {
          const recorded = harness.session.messages.findLast(
            (message) =>
              message.role === 'toolResult' && message.toolCallId === 'publication-record',
          )
          expect(recorded?.details.state).toBe('accepted')
          expect(recorded?.details.artifact.repositories[0].tree).toBe(
            snapshot.repositories[0].tree,
          )
        }
      } finally {
        await harness.close()
      }
    },
    30_000,
  )

  it('allows a correction after diagnosis', async () => {
    const harness = await sessionWithDeliveryTool({
      beforePrompt(sessionManager) {
        sessionManager.appendCustomEntry(
          '@nothingrotf/pstack/delivery-v1',
          deliveryIssue(sessionManager.getSessionId(), true),
        )
      },
      messages: [
        plannedReply(
          [
            {
              arguments: {
                description: 'Apply the diagnosed correction',
                prompt: 'issue: retries\nphase: correction',
                role: 'another implementation role',
                subagent_type: 'generalPurpose',
              },
              id: 'correction',
              name: 'Task',
              type: 'toolCall',
            },
          ],
          'toolUse',
        ),
      ],
    })
    try {
      await harness.session.prompt('Apply the diagnosed correction.', {
        expandPromptTemplates: false,
      })
      expect(harness.observed).toHaveLength(1)
    } finally {
      await harness.close()
    }
  })
})
