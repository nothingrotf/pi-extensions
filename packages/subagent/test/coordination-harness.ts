import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai'
import {
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionContext,
  ModelRuntime,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import { type CapabilityToolDefinition } from '../src/capabilities.ts'
import { SubagentControllerHost } from '../src/controller.ts'
import { runBatch } from '../src/coordinator.ts'
import { type TaskNodeInput } from '../src/schema.ts'
import { stateHistory } from '../src/state.ts'

export const trustedTool: CapabilityToolDefinition = {
  description: 'Return trusted data.',
  async execute() {
    return { content: [{ text: 'trusted', type: 'text' }], details: {} }
  },
  label: 'Trusted Tool',
  name: 'trusted_tool',
  parameters: Type.Object({}),
}

export const node = {
  description: 'Task',
  prompt: 'Prompt',
  subagent_type: 'explore',
}

export interface TaskExecutionControl {
  failures: ReadonlySet<string>
  held: ReadonlyMap<string, Promise<void>>
  observed: Set<string>
  started: ReadonlyMap<string, PromiseWithResolvers<void>>
}

export function readonlySchedulerTask(id: string, needs?: string[]): TaskNodeInput {
  const task: TaskNodeInput = {
    description: `Scheduler ${id}`,
    id,
    model: 'coordination-test/writer',
    prompt: `SCHEDULER_${id.toUpperCase()}`,
    readonly: true,
    subagent_type: 'explore',
  }
  if (needs !== undefined) task.needs = needs
  return task
}

export const execFileAsync = promisify(execFile)

export async function createBatchHarness(control?: TaskExecutionControl) {
  const dir = await mkdtemp(join(tmpdir(), 'pi-coordination-'))
  await writeFile(join(dir, '.gitignore'), 'agent/\nsessions/\n.worktrees/\n')
  await writeFile(join(dir, 'shared.txt'), 'base\n')
  await execFileAsync('git', ['init', '-q'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  await execFileAsync('git', ['add', '.gitignore', 'shared.txt'], { cwd: dir })
  await execFileAsync('git', ['commit', '-q', '-m', 'base'], { cwd: dir })
  const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false })
  modelRuntime.registerProvider('coordination-test', {
    api: 'openai-completions',
    apiKey: 'test-key',
    baseUrl: 'http://localhost:1',
    models: [
      {
        contextWindow: 100_000,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: 'writer',
        input: ['text'],
        maxTokens: 8_000,
        name: 'Coordination writer',
        reasoning: false,
      },
    ],
    streamSimple: (model, context, options) => {
      const stream = createAssistantMessageEventStream()
      if (control !== undefined) {
        const taskId = [...control.started.keys()].find((candidate) =>
          JSON.stringify(context.messages).includes(`SCHEDULER_${candidate.toUpperCase()}`),
        )
        const failed = taskId !== undefined && control.failures.has(taskId)
        let ended = false
        const finish = (stopReason: 'aborted' | 'error' | 'stop') => {
          if (ended) return
          ended = true
          const message: AssistantMessage = {
            api: model.api,
            content: [{ text: taskId ?? 'Done', type: 'text' }],
            model: model.id,
            provider: model.provider,
            role: 'assistant',
            stopReason,
            timestamp: Date.now(),
            usage: {
              cacheRead: 0,
              cacheWrite: 0,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
              input: 1,
              output: 1,
              totalTokens: 2,
            },
          }
          if (stopReason === 'error') {
            message.errorMessage = `SCHEDULER_${taskId?.toUpperCase()} failed`
          }
          stream.push({ partial: message, type: 'start' })
          if (stopReason === 'aborted') {
            stream.push({ error: message, reason: 'aborted', type: 'error' })
          } else {
            stream.push({ message, reason: 'stop', type: 'done' })
          }
          stream.end()
        }
        options?.signal?.addEventListener('abort', () => finish('aborted'), { once: true })
        if (taskId !== undefined) {
          control.observed.add(taskId)
          control.started.get(taskId)?.resolve()
        }
        const held = taskId === undefined ? undefined : control.held.get(taskId)
        if (held === undefined) finish(failed ? 'error' : 'stop')
        else held.then(() => finish(failed ? 'error' : 'stop')).catch(() => finish('error'))
        return stream
      }
      const readsCandidate = JSON.stringify(context.messages).includes('READ_CANDIDATE')
      if (readsCandidate) {
        const read = context.messages.some((message) => message.role === 'toolResult')
        const message: AssistantMessage = {
          api: model.api,
          content: read
            ? [{ text: JSON.stringify(context.messages), type: 'text' }]
            : [
                {
                  arguments: { path: 'shared.txt' },
                  id: 'read-candidate',
                  name: 'read',
                  type: 'toolCall',
                },
              ],
          model: model.id,
          provider: model.provider,
          role: 'assistant',
          stopReason: read ? 'stop' : 'toolUse',
          timestamp: Date.now(),
          usage: {
            cacheRead: 0,
            cacheWrite: 0,
            cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
            input: 1,
            output: 1,
            totalTokens: 2,
          },
        }
        stream.push({ partial: message, type: 'start' })
        stream.push({ message, reason: read ? 'stop' : 'toolUse', type: 'done' })
        stream.end()
        return stream
      }
      const wrote = context.messages.some((message) => message.role === 'toolResult')
      const message: AssistantMessage = {
        api: model.api,
        content: wrote
          ? [{ text: 'Done', type: 'text' }]
          : [
              {
                arguments: { content: 'writer\n', path: 'shared.txt' },
                id: 'write-shared',
                name: 'write',
                type: 'toolCall',
              },
            ],
        model: model.id,
        provider: model.provider,
        role: 'assistant',
        stopReason: wrote ? 'stop' : 'toolUse',
        timestamp: Date.now(),
        usage: {
          cacheRead: 0,
          cacheWrite: 0,
          cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
          input: 1,
          output: 1,
          totalTokens: 2,
        },
      }
      stream.push({ partial: message, type: 'start' })
      stream.push({ message, reason: wrote ? 'stop' : 'toolUse', type: 'done' })
      stream.end()
      return stream
    },
  })
  const model = modelRuntime.getModel('coordination-test', 'writer')
  if (model === undefined) throw new Error('The test model is missing.')
  let host: SubagentControllerHost | undefined
  let context: ExtensionContext | undefined
  const resourceLoader = new DefaultResourceLoader({
    agentDir: join(dir, 'agent'),
    cwd: dir,
    extensionFactories: [
      (pi) => {
        host = new SubagentControllerHost(pi)
        pi.on('input', (_event, ctx) => {
          context = ctx
          return { action: 'handled' }
        })
      },
    ],
    noExtensions: true,
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true,
  })
  await resourceLoader.reload()
  const { session } = await createAgentSession({
    cwd: dir,
    model,
    modelRuntime,
    resourceLoader,
    sessionManager: SessionManager.create(dir, join(dir, 'sessions')),
    thinkingLevel: 'off',
  })
  await session.prompt('Capture coordination context')
  if (host === undefined || context === undefined) throw new Error('The test context is missing.')
  await host.replaceSession(context)
  const runtime = host.runtime
  const ctx = context
  const states = () =>
    stateHistory(session.sessionManager.getBranch(), session.sessionManager.getSessionId())
  return {
    close: async () => {
      await runtime.shutdown()
      session.dispose()
      await rm(dir, { force: true, recursive: true })
    },
    ctx,
    dir,
    host,
    runTasks: (tasks: Parameters<typeof runBatch>[0]['input']['tasks'], signal?: AbortSignal) =>
      runBatch({
        ctx,
        input: { tasks },
        runtime,
        signal,
      }),
    run: (signal?: AbortSignal) =>
      runBatch({
        ctx,
        input: {
          tasks: [
            {
              description: 'Write shared file',
              id: 'writer',
              model: 'coordination-test/writer',
              prompt: 'Write shared.txt',
              readonly: false,
              subagent_type: 'generalPurpose',
            },
          ],
        },
        runtime,
        signal,
      }),
    runtime,
    states,
  }
}
