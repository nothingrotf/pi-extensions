import { readFile } from 'node:fs/promises'
import { stripVTControlCharacters } from 'node:util'

import type { Context, TextContent } from '@earendil-works/pi-ai'
import { getAgentDir, initTheme } from '@earendil-works/pi-coding-agent'
import { visibleWidth } from '@earendil-works/pi-tui'
import { Value } from 'typebox/value'
import { describe, expect, it } from 'vite-plus/test'

import { completionMessageType } from '../src/index.ts'
import { CompletionSchema, ToolOutputSchema } from '../src/schema.ts'
import { nodeCommand, start, waitForCommand } from './helpers.ts'
import { sessionFixture, toolCall } from './session-harness.ts'

function contextText(messages: Context['messages']): string {
  return messages
    .flatMap((message) =>
      Array.isArray(message.content)
        ? message.content.filter((part) => part.type === 'text').map((part) => part.text)
        : [message.content],
    )
    .join('\n')
}

describe('real Pi session integration', () => {
  it('declares the tool and persists one completion that wakes the provider with bounded logs', async () => {
    const fixture = await sessionFixture((request) =>
      request === 1
        ? [
            toolCall('background_command', {
              action: 'start',
              name: 'UTF-8 fixture',
              command: nodeCommand(
                'setTimeout(() => process.stdout.write("á😀".repeat(10000) + "\\nverified-tail\\n"), 100)',
              ),
            }),
          ]
        : [{ type: 'text', text: 'Done' }],
    )
    await fixture.session.prompt('Start the fixture')
    expect(fixture.toolNames()).toContain('background_command')
    expect(getAgentDir()).toBe(`${fixture.directory}/agent`)
    await expect.poll(() => fixture.requests.length).toBe(3)
    await fixture.session.waitForIdle()
    const initial = fixture.session.messages.find(
      (message) => message.role === 'toolResult' && message.toolName === 'background_command',
    )
    expect(initial?.role).toBe('toolResult')
    if (initial?.role !== 'toolResult') throw new Error('Missing tool result')
    expect(initial.isError).toBe(false)
    expect(Value.Check(ToolOutputSchema, initial.details)).toBe(true)
    expect(initial.details).toMatchObject({ action: 'start', snapshot: { status: 'running' } })
    const completion = fixture.completions()[0]
    if (completion?.type !== 'custom_message') throw new Error('Missing completion')
    expect(fixture.completions()).toHaveLength(1)
    expect(Value.Check(CompletionSchema, completion.details)).toBe(true)
    expect(completion.details).toMatchObject({
      status: 'completed',
      exitCode: 0,
      output: { truncated: true },
    })
    expect(contextText(fixture.requests.at(-1)?.messages ?? [])).toContain('verified-tail')
    expect(Buffer.byteLength(JSON.stringify(completion.details))).toBeLessThan(6000)
    const transcript = fixture.manager.getSessionFile()
    if (transcript === undefined) throw new Error('Missing transcript')
    expect(await readFile(transcript, 'utf8')).toContain(completionMessageType)
  })

  it('returns structured data to a real codemode script', async () => {
    const fixture = await sessionFixture((request) =>
      request === 1
        ? [
            toolCall('codemode', {
              code: 'const result = await tools.background_command({action:"list"}); text({action: result.action, count: result.commands.length});',
            }),
          ]
        : [{ type: 'text', text: 'Done' }],
    )
    await fixture.session.prompt('Inspect commands with codemode')
    const result = fixture.session.messages.find(
      (message) => message.role === 'toolResult' && message.toolName === 'codemode',
    )
    expect(result).toMatchObject({ isError: false })
    if (result?.role !== 'toolResult') throw new Error('Missing codemode tool result')
    expect(
      result.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n'),
    ).toContain('"count":0')
    expect(fixture.service.list()).toEqual([])
  })

  it('rejects extra action fields and foreign command IDs through the real tool', async () => {
    const fixture = await sessionFixture((request) => {
      if (request === 1)
        return [
          toolCall('background_command', {
            action: 'start',
            command: 'printf forbidden',
            cwd: '/',
          }),
        ]
      if (request === 2)
        return [toolCall('background_command', { action: 'output', id: 'another-session-command' })]
      return [{ type: 'text', text: 'Done' }]
    })
    await fixture.session.prompt('Reject invalid requests')
    const results = fixture.session.messages.filter((message) => message.role === 'toolResult')
    expect(results).toHaveLength(2)
    expect(results.every((message) => message.role === 'toolResult' && message.isError)).toBe(true)
    expect(fixture.service.list()).toEqual([])
    expect(fixture.completions()).toEqual([])
  })

  it('reports terminal errors with an exit code instead of promoting start acceptance to success', async () => {
    const fixture = await sessionFixture((request) =>
      request === 1
        ? [
            toolCall('background_command', {
              action: 'start',
              command: nodeCommand('setTimeout(() => process.exit(9), 50)'),
            }),
          ]
        : [{ type: 'text', text: 'Done' }],
    )
    await fixture.session.prompt('Run a failing command')
    await expect.poll(() => fixture.completions().length).toBe(1)
    expect(fixture.completions()[0]).toMatchObject({ details: { status: 'error', exitCode: 9 } })
    await fixture.session.waitForIdle()
    expect(fixture.requests).toHaveLength(3)
  })

  it('appends cancellation without a follow-up request', async () => {
    const fixture = await sessionFixture()
    const command = start(fixture.service, { command: nodeCommand('setInterval(() => {}, 1000)') })
    command.stop()
    await waitForCommand(fixture.service, command)
    expect(fixture.completions()).toHaveLength(1)
    expect(fixture.completions()[0]).toMatchObject({ details: { status: 'stopped' } })
    expect(fixture.requests).toEqual([])
  })

  it('holds completion while a question is pending and flushes when it clears', async () => {
    const fixture = await sessionFixture()
    fixture.api().events.emit('ask:state', { version: 1, pending: 1, paused: false })
    const command = start(fixture.service, { command: 'printf held' })
    await waitForCommand(fixture.service, command)
    expect(fixture.completions()).toEqual([])
    fixture.api().events.emit('ask:state', { version: 2, pending: 0, paused: false })
    expect(fixture.completions()).toEqual([])
    fixture.api().events.emit('ask:state', { version: 1, pending: 0, paused: false })
    await expect.poll(() => fixture.requests.length).toBe(1)
    await fixture.session.waitForIdle()
    expect(fixture.completions()).toHaveLength(1)
  })

  it('holds completion during a native dialog and flushes after it closes', async () => {
    const fixture = await sessionFixture()
    await fixture.session.extensionRunner.emit({
      type: 'ui_prompt_start',
      reason: 'ui_prompt',
      kind: 'confirm',
    })
    const command = start(fixture.service, { command: 'printf held-dialog' })
    await waitForCommand(fixture.service, command)
    expect(fixture.completions()).toEqual([])
    await fixture.session.extensionRunner.emit({
      type: 'ui_prompt_end',
      reason: 'ui_prompt',
      kind: 'confirm',
    })
    await expect.poll(() => fixture.requests.length).toBe(1)
    await fixture.session.waitForIdle()
    expect(fixture.completions()).toHaveLength(1)
  })

  it('retains injected commands across a real resource reload without duplicate completion', async () => {
    const fixture = await sessionFixture()
    const command = start(fixture.service, {
      command: nodeCommand('setTimeout(() => process.stdout.write("after-reload"), 200)'),
    })
    await fixture.session.reload()
    await waitForCommand(fixture.service, command)
    await expect.poll(() => fixture.requests.length).toBe(1)
    await fixture.session.waitForIdle()
    expect(fixture.completions()).toHaveLength(1)
    expect(fixture.completions()[0]).toMatchObject({
      details: { output: { text: 'after-reload' } },
    })
  })

  it('cancels standalone commands during resource reload without restoring old command authority', async () => {
    const fixture = await sessionFixture(
      (request) =>
        request === 1
          ? [
              toolCall('background_command', {
                action: 'start',
                command: nodeCommand('setInterval(() => {}, 1000)'),
              }),
            ]
          : request === 3
            ? [toolCall('background_command', { action: 'list' })]
            : [{ type: 'text', text: 'Done' }],
      'standalone',
    )
    await fixture.session.prompt('Start standalone command')
    await fixture.session.reload()
    await fixture.session.prompt('Inspect fresh service')
    const results = fixture.session.messages.filter(
      (message) => message.role === 'toolResult' && message.toolName === 'background_command',
    )
    expect(results.at(-1)).toMatchObject({ details: { action: 'list', commands: [] } })
    expect(fixture.completions()).toEqual([])
  })

  it('retains a completion when Escape clears the active model queue', async () => {
    const fixture = await sessionFixture()
    fixture.hold()
    const prompt = fixture.session.prompt('Keep this model turn active')
    await expect.poll(() => fixture.requests.length).toBe(1)
    const command = start(fixture.service, { command: 'printf retained-after-escape' })
    await waitForCommand(fixture.service, command)
    fixture.session.clearQueue()
    fixture.release()
    await prompt
    await expect.poll(() => fixture.completions().length).toBe(1)
    await fixture.session.waitForIdle()
    expect(fixture.requests).toHaveLength(2)
  })

  it('does not race a user prompt after automatic preflight compaction', async () => {
    const fixture = await sessionFixture()
    fixture.session.settingsManager.applyOverrides({
      compaction: { enabled: false, keepRecentTokens: 128, reserveTokens: 128 },
    })
    await fixture.session.prompt('First seed. '.repeat(2000))
    fixture.setInputTokens(99990)
    await fixture.session.prompt('Recent seed. '.repeat(100))
    fixture.setInputTokens(1)
    fixture.session.settingsManager.applyOverrides({
      compaction: { enabled: true, keepRecentTokens: 128, reserveTokens: 128 },
    })
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    fixture.api().on('session_before_compact', async (event) => {
      entered.resolve()
      await release.promise
      return {
        compaction: {
          summary: 'Automatic compaction fixture',
          firstKeptEntryId: event.preparation.firstKeptEntryId,
          tokensBefore: event.preparation.tokensBefore,
        },
      }
    })
    const prompt = fixture.session.prompt('User prompt after compaction').then(
      () => 'completed',
      (error: Error) => error.message,
    )
    await Promise.race([
      entered.promise,
      prompt.then((result) => {
        throw new Error(`Automatic compaction hook missing: ${result}`)
      }),
    ])
    const command = start(fixture.service, { command: 'printf held-during-auto-compaction' })
    await waitForCommand(fixture.service, command)
    fixture.hold()
    release.resolve()
    await expect.poll(() => fixture.requests.length).toBe(3)
    expect(contextText(fixture.requests[2]?.messages ?? [])).toContain(
      'User prompt after compaction',
    )
    fixture.release()
    expect(await prompt).toBe('completed')
    await expect.poll(() => fixture.completions().length).toBe(1)
    await fixture.session.waitForIdle()
    expect(fixture.requests).toHaveLength(4)
    expect(fixture.errors).toEqual([])
  })

  it('keeps a command alive when the parent model turn is aborted', async () => {
    let hold = () => {}
    const fixture = await sessionFixture((request) => {
      if (request === 1) {
        hold()
        return [
          toolCall('background_command', {
            action: 'start',
            command: nodeCommand(
              'setTimeout(() => process.stdout.write("survived-parent-abort"), 300)',
            ),
          }),
        ]
      }
      return [{ type: 'text', text: 'Done' }]
    })
    hold = fixture.hold
    const prompt = fixture.session.prompt('Start independently owned work')
    await expect.poll(() => fixture.requests.length).toBe(2)
    await fixture.session.abort()
    fixture.release()
    await prompt
    await expect.poll(() => fixture.completions().length).toBe(1)
    await fixture.session.waitForIdle()
    expect(fixture.completions()[0]).toMatchObject({
      details: { status: 'completed', output: { text: 'survived-parent-abort' } },
    })
    expect(fixture.errors).toEqual([])
  })

  it.each(['cancel', 'complete'])(
    'defers completion through real manual compaction (%s)',
    async (outcome) => {
      const fixture = await sessionFixture()
      fixture.session.settingsManager.applyOverrides({
        compaction: { enabled: false, keepRecentTokens: 128, reserveTokens: 128 },
      })
      await fixture.session.prompt('Seed context. '.repeat(2000))
      await fixture.session.prompt('Second turn to retain. '.repeat(100))
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      fixture.api().on('session_before_compact', async (event) => {
        entered.resolve()
        await release.promise
        return outcome === 'cancel'
          ? { cancel: true }
          : {
              compaction: {
                summary: 'Compacted local fixture',
                firstKeptEntryId: event.preparation.firstKeptEntryId,
                tokensBefore: event.preparation.tokensBefore,
              },
            }
      })
      const compacting = fixture.session.compact().then(
        () => 'complete',
        (error: Error) => error.message,
      )
      await Promise.race([
        entered.promise,
        compacting.then((result) => {
          throw new Error(`Compaction did not reach its hook: ${result}`)
        }),
      ])
      const command = start(fixture.service, { command: 'printf during-compaction' })
      await waitForCommand(fixture.service, command)
      expect(fixture.completions()).toEqual([])
      release.resolve()
      expect(await compacting).toBe(outcome === 'cancel' ? 'Compaction cancelled' : 'complete')
      await expect.poll(() => fixture.requests.length).toBe(3)
      await fixture.session.waitForIdle()
      expect(fixture.completions()).toHaveLength(1)
      expect(fixture.errors).toEqual([])
    },
  )

  it('stops standalone commands before session navigation', async () => {
    const fixture = await sessionFixture(
      (request) =>
        request === 1
          ? [
              toolCall('background_command', {
                action: 'start',
                command: nodeCommand('setInterval(() => {}, 1000)'),
              }),
            ]
          : request === 3
            ? [toolCall('background_command', { action: 'list' })]
            : [{ type: 'text', text: 'Done' }],
      'standalone',
    )
    await fixture.session.prompt('Start before navigation')
    await fixture.session.extensionRunner.emit({ type: 'session_before_switch', reason: 'new' })
    await fixture.session.prompt('Inspect after cancelled navigation')
    const result = fixture.session.messages.findLast((message) => message.role === 'toolResult')
    expect(result).toMatchObject({ details: { action: 'list', commands: [] } })
    expect(fixture.completions()).toEqual([])
  })

  it('publishes HUD state and rail reports through the event bus', async () => {
    const fixture = await sessionFixture()
    initTheme('dark')
    const api = fixture.api()
    const states: unknown[] = []
    api.events.on('background-commands:state', (data) => {
      states.push(data)
    })
    api.events.emit('background-commands:state:request', {})
    expect(states).toEqual([{ version: 1, running: 0, stopping: 0 }])
    const command = start(fixture.service, {
      command: nodeCommand('setTimeout(() => {}, 100)'),
      name: 'Tick',
    })
    expect(states.at(-1)).toEqual({ version: 1, running: 1, stopping: 0 })
    await waitForCommand(fixture.service, command)
    expect(states.at(-1)).toEqual({ version: 1, running: 0, stopping: 0 })

    const tool = fixture.session.extensionRunner.getToolDefinition('background_command')
    if (tool?.renderCall === undefined || tool.renderResult === undefined)
      throw new Error('Missing background command renderers')
    const actions: unknown[] = []
    api.events.on('hud:rail-action', (data) => {
      actions.push(data)
    })
    const args = { action: 'list' }
    const context = {
      args,
      toolCallId: 'rail-call',
      invalidate: () => undefined,
      lastComponent: undefined,
      state: {},
      cwd: fixture.directory,
      executionStarted: true,
      argsComplete: true,
      isPartial: false,
      expanded: false,
      showImages: false,
      isError: false,
      durationMs: undefined,
      outputPad: 0,
    }
    const content: TextContent[] = [{ type: 'text', text: 'Tick: completed, exit 0' }]
    const result = {
      content,
      details: { action: 'list', commands: fixture.service.list() },
    }
    tool.renderCall(args, fixture.theme(), context)
    expect(actions).toEqual([])
    api.events.emit('hud:rail-enabled', { enabled: true })
    tool.renderCall(args, fixture.theme(), context)
    tool.renderResult(result, { expanded: false, isPartial: false }, fixture.theme(), context)
    expect(actions).toMatchObject([
      { toolCallId: 'rail-call', status: 'pending', runningLabel: 'Listing', iconKey: 'shell' },
      { toolCallId: 'rail-call', status: 'ok', doneLabel: 'Listed', summary: '1 finished' },
    ])
  })

  it('renders compact and expanded terminal content within narrow widths', async () => {
    const fixture = await sessionFixture()
    initTheme('dark')
    const renderer = fixture.session.extensionRunner.getMessageRenderer(completionMessageType)
    if (renderer === undefined) throw new Error('Missing completion renderer')
    const command = start(fixture.service, { command: 'printf harmless', name: 'wide 😀 中' })
    await waitForCommand(fixture.service, command)
    await fixture.session.waitForIdle()
    const message = fixture.session.messages.find(
      (entry) => entry.role === 'custom' && entry.customType === completionMessageType,
    )
    if (message?.role !== 'custom') throw new Error('Missing custom message')
    for (const expanded of [false, true]) {
      const component = renderer(message, { expanded, outputPad: 0 }, fixture.theme())
      if (component === undefined) throw new Error('Renderer rejected a valid completion')
      for (const width of [1, 8, 20, 80]) {
        const lines = component.render(width)
        expect(lines.length).toBeGreaterThan(0)
        for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width)
      }
      expect(component.render(80).join('\n')).toContain('harmless')
    }
    const padded = renderer(message, { expanded: false, outputPad: 1 }, fixture.theme())
    if (padded === undefined) throw new Error('Renderer rejected a valid completion')
    const [header = '', body = ''] = padded.render(80).map((line) => stripVTControlCharacters(line))
    expect(header).toMatch(/^ ✓ wide 😀 中 completed, exit 0 · \d+s/u)
    expect(header).not.toContain(command.id)
    expect(body.trimEnd()).toBe('   harmless')
    const expanded = renderer(message, { expanded: true, outputPad: 1 }, fixture.theme())
    expect(expanded?.render(80).join('\n')).toContain(command.id)
  })
})
