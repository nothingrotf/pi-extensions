import { describe, expect, it } from 'vite-plus/test'

import task from '../src/index.ts'

const foregroundInput = {
  description: 'Read package name',
  prompt: 'Read package.json and return its name.',
  subagent_type: 'explore',
  run_in_background: false,
}

class EventBus {
  handlers = new Map()

  on(event, handler) {
    const handlers = this.handlers.get(event) ?? []
    handlers.push(handler)
    this.handlers.set(event, handlers)
    return () => {
      this.handlers.set(
        event,
        (this.handlers.get(event) ?? []).filter((candidate) => candidate !== handler),
      )
    }
  }

  emit(event, data) {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(data)
    }
  }
}

function replyRpc(bus, request, data) {
  bus.emit(`subagents:rpc:v1:reply:${request.requestId}`, {
    version: 1,
    requestId: request.requestId,
    method: request.method,
    success: true,
    data,
  })
}

function harness(initialBranch = []) {
  const bus = new EventBus()
  const tools = new Map()
  const lifecycle = new Map()
  const entries = [...initialBranch]
  let activeBranch = entries
  const messages = []
  const registrations = []
  let messageFailure
  bus.on('pi-subagents:runtime-agent-register:v1', (request) => {
    registrations.push(request)
    request.result = { ok: true, registration: { dispose() {} } }
  })
  const api = {
    events: bus,
    registerTool(tool) {
      tools.set(tool.name, tool)
    },
    on(event, handler) {
      const handlers = lifecycle.get(event) ?? []
      handlers.push(handler)
      lifecycle.set(event, handlers)
    },
    appendEntry(customType, data) {
      activeBranch.push({ type: 'custom', customType, data })
    },
    sendMessage(message, options) {
      if (messageFailure !== undefined) {
        const error = messageFailure
        messageFailure = undefined
        throw error
      }
      messages.push({ message, options })
    },
  }
  const ctx = {
    cwd: '/tmp/task-test',
    sessionManager: {
      getSessionId() {
        return 'parent-session'
      },
      getBranch() {
        return activeBranch
      },
    },
  }
  task(api)
  for (const handler of lifecycle.get('session_start') ?? []) {
    handler({}, ctx)
  }
  const tool = tools.get('Task')
  if (tool === undefined) {
    throw new Error('Task was not registered')
  }
  return {
    bus,
    tool,
    entries,
    messages,
    registrations,
    switchBranch(branch) {
      activeBranch = branch
      for (const handler of lifecycle.get('session_tree') ?? []) {
        handler({}, ctx)
      }
    },
    failNextMessage(error) {
      messageFailure = error
    },
    execute(toolCallId, input, onUpdate) {
      return tool.execute(toolCallId, input, undefined, onUpdate, ctx)
    },
  }
}

function emitForegroundSuccess(bus, request, runId, text) {
  bus.emit('prompt-template:subagent:started', {
    requestId: request.requestId,
    ownerRunId: request.ownerRunId,
    nodeId: request.nodeId,
  })
  queueMicrotask(() => {
    bus.emit('prompt-template:subagent:response', {
      requestId: request.requestId,
      ownerRunId: request.ownerRunId,
      nodeId: request.nodeId,
      status: 'completed',
      runId,
      agent: request.agent,
      model: 'provider/model',
      result: { kind: 'text', text },
      usage: {
        input: 10,
        output: 4,
        cacheRead: 2,
        cacheWrite: 0,
        cost: 0.01,
        turns: 1,
        toolCalls: 2,
        durationMs: 30,
      },
    })
  })
}

describe('Task lifecycle', () => {
  it('registers the compatibility tool and read-only runtime agent', () => {
    const instance = harness()
    expect(instance.tool.name).toBe('Task')
    expect(instance.tool.executionMode).toBe('parallel')
    expect(instance.tool.parameters.required).toEqual(['description', 'prompt', 'subagent_type'])
    expect(instance.registrations).toHaveLength(1)
    expect(instance.registrations[0].name).toBe('task-readonly')
    expect(instance.registrations[0].definition.tools).toEqual(['read', 'grep', 'find', 'ls'])
  })

  it('returns foreground output, identity, usage, and progress', async () => {
    const instance = harness()
    const updates = []
    let childTask
    instance.bus.on('prompt-template:subagent:request', (request) => {
      childTask = request.task
      instance.bus.emit('prompt-template:subagent:started', {
        requestId: request.requestId,
        ownerRunId: request.ownerRunId,
        nodeId: request.nodeId,
      })
      instance.bus.emit('prompt-template:subagent:update', {
        requestId: request.requestId,
        ownerRunId: request.ownerRunId,
        nodeId: request.nodeId,
        runId: 'run-foreground',
        currentTool: 'read',
      })
      queueMicrotask(() => {
        instance.bus.emit('prompt-template:subagent:response', {
          requestId: request.requestId,
          ownerRunId: request.ownerRunId,
          nodeId: request.nodeId,
          status: 'completed',
          runId: 'run-foreground',
          agent: request.agent,
          model: 'provider/model',
          result: { kind: 'text', text: '@nothingrotf/task' },
          usage: {
            input: 10,
            output: 4,
            cacheRead: 2,
            cacheWrite: 0,
            cost: 0.01,
            turns: 1,
            toolCalls: 2,
            durationMs: 30,
          },
        })
      })
    })
    const exactPrompt = `  ${foregroundInput.prompt}\n`
    const result = await instance.execute(
      'call-1',
      { ...foregroundInput, prompt: exactPrompt },
      (update) => {
        updates.push(update)
      },
    )
    expect(childTask).toBe(exactPrompt)
    expect(result.content[0].text).toBe('Agent ID: run-foreground\n\n@nothingrotf/task')
    expect(result.details).toEqual({
      status: 'completed',
      agentId: 'run-foreground',
      finalMessage: '@nothingrotf/task',
      toolCallCount: 2,
      durationMs: 30,
      runId: 'run-foreground',
      model: 'provider/model',
      usage: {
        input: 10,
        output: 4,
        cacheRead: 2,
        cacheWrite: 0,
        cost: 0.01,
        turns: 1,
        toolCalls: 2,
        durationMs: 30,
      },
    })
    expect(updates[0].content[0].text).toBe('Task child uses read.')
  })

  it('permits parallel foreground calls', async () => {
    const instance = harness()
    let active = 0
    let maximumActive = 0
    instance.bus.on('prompt-template:subagent:request', (request) => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      instance.bus.emit('prompt-template:subagent:started', {
        requestId: request.requestId,
        ownerRunId: request.ownerRunId,
        nodeId: request.nodeId,
      })
      setTimeout(() => {
        active -= 1
        instance.bus.emit('prompt-template:subagent:response', {
          requestId: request.requestId,
          ownerRunId: request.ownerRunId,
          nodeId: request.nodeId,
          status: 'completed',
          runId: request.nodeId,
          result: { kind: 'text', text: request.nodeId },
        })
      }, 5)
    })
    const results = await Promise.all([
      instance.execute('parallel-a', foregroundInput),
      instance.execute('parallel-b', foregroundInput),
    ])
    expect(maximumActive).toBe(2)
    expect(results.map((result) => result.details.agentId)).toEqual(['parallel-a', 'parallel-b'])
  })

  it('launches background work and sends one correlated notification', async () => {
    const instance = harness()
    instance.bus.on('subagents:rpc:v1:request', (request) => {
      if (request.method === 'ping') {
        replyRpc(instance.bus, request, { version: 1 })
        return
      }
      replyRpc(instance.bus, request, {
        text: 'started',
        details: { runId: 'background-1', asyncId: 'background-1', asyncDir: '/tmp/run' },
      })
    })
    const result = await instance.execute('call-background', {
      ...foregroundInput,
      description: 'Background check',
      run_in_background: true,
    })
    expect(result.details).toEqual({
      status: 'background',
      agentId: 'background-1',
      runId: 'background-1',
      backgroundReason: 'agent_request',
    })
    instance.bus.emit('subagent:async-complete', {
      runId: 'background-1',
      success: true,
      results: [{ success: true, output: 'BACKGROUND_DONE' }],
    })
    expect(instance.messages).toEqual([
      {
        message: {
          customType: 'system/task_notification',
          content:
            'Task notification: {"taskId":"background-1","kind":"subagent","status":"success","title":"Background check","detail":"BACKGROUND_DONE"}',
          display: false,
          details: {
            taskId: 'background-1',
            kind: 'subagent',
            status: 'success',
            title: 'Background check',
            detail: 'BACKGROUND_DONE',
          },
        },
        options: { triggerTurn: false, deliverAs: 'steer' },
      },
    ])
  })

  it('reconciles a completion after the parent returns to its branch', async () => {
    const instance = harness()
    instance.bus.on('subagents:rpc:v1:request', (request) => {
      if (request.method === 'ping') {
        replyRpc(instance.bus, request, { version: 1 })
        return
      }
      replyRpc(instance.bus, request, {
        text: 'started',
        details: { runId: 'branch-run', asyncId: 'branch-run' },
      })
    })
    await instance.execute('branch-launch', {
      ...foregroundInput,
      description: 'Branch task',
      run_in_background: true,
    })
    instance.switchBranch([])
    instance.bus.emit('subagent:async-complete', {
      runId: 'branch-run',
      success: true,
      results: [{ success: true, output: 'BRANCH_DONE' }],
    })
    expect(instance.messages).toHaveLength(0)
    for (let index = 0; index < 300; index += 1) {
      instance.bus.emit('subagent:async-complete', {
        runId: `unrelated-${index}`,
        success: true,
        results: [{ success: true, output: 'UNRELATED' }],
      })
    }
    instance.switchBranch(instance.entries)
    expect(instance.messages).toHaveLength(1)
    expect(instance.messages[0].message.details.detail).toBe('BRANCH_DONE')
  })

  it('retains a pending completion when notification delivery fails', async () => {
    const instance = harness()
    instance.bus.on('subagents:rpc:v1:request', (request) => {
      if (request.method === 'ping') {
        replyRpc(instance.bus, request, { version: 1 })
        return
      }
      replyRpc(instance.bus, request, {
        text: 'started',
        details: { runId: 'retry-run', asyncId: 'retry-run' },
      })
    })
    await instance.execute('retry-launch', {
      ...foregroundInput,
      description: 'Retry task',
      run_in_background: true,
    })
    instance.failNextMessage(new Error('delivery failed'))
    expect(() => {
      instance.bus.emit('subagent:async-complete', {
        runId: 'retry-run',
        success: true,
        results: [{ success: true, output: 'RETRY_DONE' }],
      })
    }).toThrow('delivery failed')
    expect(instance.messages).toHaveLength(0)
    instance.switchBranch(instance.entries)
    expect(instance.messages).toHaveLength(1)
    expect(instance.messages[0].message.details.detail).toBe('RETRY_DONE')
  })

  it('preserves aborted background status', async () => {
    const instance = harness()
    instance.bus.on('subagents:rpc:v1:request', (request) => {
      if (request.method === 'ping') {
        replyRpc(instance.bus, request, { version: 1 })
        return
      }
      replyRpc(instance.bus, request, {
        text: 'started',
        details: { runId: 'stopped-run', asyncId: 'stopped-run' },
      })
    })
    await instance.execute('stopped-launch', {
      ...foregroundInput,
      description: 'Stopped task',
      run_in_background: true,
    })
    instance.bus.emit('subagent:async-complete', {
      runId: 'stopped-run',
      state: 'stopped',
      stopped: true,
      summary: 'Stopped by the parent.',
      results: [{ success: false, stopped: true }],
    })
    expect(instance.messages[0].message.details).toEqual({
      taskId: 'stopped-run',
      kind: 'subagent',
      status: 'aborted',
      title: 'Stopped task',
      detail: 'Stopped by the parent.',
    })
  })

  it('keeps completion when a background child finishes before its launch receipt', async () => {
    const instance = harness()
    instance.bus.on('subagents:rpc:v1:request', (request) => {
      if (request.method === 'ping') {
        replyRpc(instance.bus, request, { version: 1 })
        return
      }
      instance.bus.emit('subagent:async-complete', {
        runId: 'fast-run',
        success: true,
        results: [{ success: true, output: 'FAST_DONE' }],
      })
      replyRpc(instance.bus, request, {
        text: 'started',
        details: { runId: 'fast-run', asyncId: 'fast-run' },
      })
    })
    const result = await instance.execute('fast-launch', {
      ...foregroundInput,
      description: 'Fast task',
      run_in_background: true,
    })
    expect(result.details.status).toBe('background')
    expect(instance.messages[0].message.details).toEqual({
      taskId: 'fast-run',
      kind: 'subagent',
      status: 'success',
      title: 'Fast task',
      detail: 'FAST_DONE',
    })
  })

  it('restores pending notification identity after a session restart', async () => {
    const first = harness()
    first.bus.on('subagents:rpc:v1:request', (request) => {
      if (request.method === 'ping') {
        replyRpc(first.bus, request, { version: 1 })
        return
      }
      replyRpc(first.bus, request, {
        text: 'started',
        details: { runId: 'restart-run', asyncId: 'restart-run' },
      })
    })
    await first.execute('restart-launch', {
      ...foregroundInput,
      description: 'Restart task',
      run_in_background: true,
    })
    const second = harness(first.entries)
    second.bus.emit('subagent:async-complete', {
      runId: 'restart-run',
      success: true,
      results: [{ success: true, output: 'RESTORED_DONE' }],
    })
    expect(second.messages[0].message.details).toEqual({
      taskId: 'restart-run',
      kind: 'subagent',
      status: 'success',
      title: 'Restart task',
      detail: 'RESTORED_DONE',
    })
  })

  it('continues a retained child and preserves its Agent ID', async () => {
    const instance = harness()
    instance.bus.on('subagents:rpc:v1:request', (request) => {
      if (request.method === 'ping') {
        replyRpc(instance.bus, request, { version: 1 })
        return
      }
      if (request.method === 'resume') {
        replyRpc(instance.bus, request, {
          text: 'resumed',
          details: { runId: 'continuation-run', asyncId: 'continuation-run' },
        })
        setTimeout(() => {
          instance.bus.emit('subagent:async-complete', {
            runId: 'continuation-run',
            success: true,
            durationMs: 70,
            results: [{ success: true, output: 'REMEMBERED', toolBudget: { toolCount: 1 } }],
          })
        }, 0)
      }
    })
    const result = await instance.execute('resume-call', {
      ...foregroundInput,
      prompt: 'Return the remembered value.',
      resume: 'original-agent-id',
    })
    expect(result.content[0].text).toBe('Agent ID: original-agent-id\n\nREMEMBERED')
    expect(result.details.agentId).toBe('original-agent-id')
    expect(result.details.runId).toBe('original-agent-id')
    expect(result.details.toolCallCount).toBe(1)
  })

  it('enforces read-only calls through the registered agent', async () => {
    const instance = harness()
    let selectedAgent
    instance.bus.on('prompt-template:subagent:request', (request) => {
      selectedAgent = request.agent
      emitForegroundSuccess(instance.bus, request, 'readonly-run', 'READ_ONLY_DONE')
    })
    const result = await instance.execute('readonly-call', {
      ...foregroundInput,
      subagent_type: 'custom-writer',
      readonly: true,
    })
    expect(selectedAgent).toBe('task-readonly')
    expect(result.details.status).toBe('completed')
  })

  it('enforces the retained read-only boundary', async () => {
    const readOnly = harness()
    readOnly.bus.on('prompt-template:subagent:request', (request) => {
      emitForegroundSuccess(readOnly.bus, request, 'readonly-source', 'READ_ONLY_SOURCE')
    })
    await readOnly.execute('readonly-source-call', {
      ...foregroundInput,
      readonly: true,
    })
    const restored = harness(readOnly.entries)
    restored.bus.on('subagents:rpc:v1:request', (request) => {
      if (request.method === 'ping') {
        replyRpc(restored.bus, request, { version: 1 })
        return
      }
      replyRpc(restored.bus, request, {
        text: 'resumed',
        details: { runId: 'readonly-continuation', asyncId: 'readonly-continuation' },
      })
      queueMicrotask(() => {
        restored.bus.emit('subagent:async-complete', {
          runId: 'readonly-continuation',
          success: true,
          results: [{ success: true, output: 'READ_ONLY_RESUMED' }],
        })
      })
    })
    const resumed = await restored.execute('readonly-resume-call', {
      ...foregroundInput,
      readonly: true,
      resume: 'readonly-source',
    })
    expect(resumed.details.status).toBe('completed')

    const writable = harness()
    writable.bus.on('prompt-template:subagent:request', (request) => {
      emitForegroundSuccess(writable.bus, request, 'writable-source', 'WRITABLE_SOURCE')
    })
    await writable.execute('writable-source-call', foregroundInput)
    const rejected = await writable.execute('writable-resume-call', {
      ...foregroundInput,
      readonly: true,
      resume: 'writable-source',
    })
    expect(rejected.isError).toBe(true)
    expect(rejected.details.error).toContain('cannot enforce read-only mode')
  })

  it('supports reentrant Task calls for nested agent protocols', async () => {
    const instance = harness()
    let nestedResult
    instance.bus.on('prompt-template:subagent:request', (request) => {
      if (request.nodeId === 'outer-call') {
        instance
          .execute('nested-call', {
            ...foregroundInput,
            subagent_type: 'shell',
            prompt: 'Return NESTED_OK.',
          })
          .then((result) => {
            nestedResult = result
            emitForegroundSuccess(instance.bus, request, 'outer-run', 'OUTER_OK')
          })
        instance.bus.emit('prompt-template:subagent:started', {
          requestId: request.requestId,
          ownerRunId: request.ownerRunId,
          nodeId: request.nodeId,
        })
        return
      }
      emitForegroundSuccess(instance.bus, request, 'nested-run', 'NESTED_OK')
    })
    const outer = await instance.execute('outer-call', foregroundInput)
    expect(outer.details.agentId).toBe('outer-run')
    expect(nestedResult.details.agentId).toBe('nested-run')
  })

  it('returns the lineage error from pi-subagents resume', async () => {
    const instance = harness()
    instance.bus.on('subagents:rpc:v1:request', (request) => {
      if (request.method === 'ping') {
        replyRpc(instance.bus, request, { version: 1 })
        return
      }
      instance.bus.emit(`subagents:rpc:v1:reply:${request.requestId}`, {
        version: 1,
        requestId: request.requestId,
        method: request.method,
        success: false,
        error: {
          code: 'not_found',
          message: 'The retained child is not owned by this session.',
        },
      })
    })
    const result = await instance.execute('cross-parent', {
      ...foregroundInput,
      resume: 'unavailable-agent',
    })
    expect(result.isError).toBe(true)
    expect(result.details).toEqual({
      status: 'error',
      error: 'not_found: The retained child is not owned by this session.',
      agentId: 'unavailable-agent',
    })
  })
})
