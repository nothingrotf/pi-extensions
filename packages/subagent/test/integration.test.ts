import { getEventListeners } from 'node:events'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { CustomMessageComponent, initTheme, SessionManager } from '@earendil-works/pi-coding-agent'
import { stripTerminalSequences, Text, visibleWidth } from '@earendil-works/pi-tui'
import { Value } from 'typebox/value'
import { describe, expect, it, vi } from 'vite-plus/test'

import { acquireSubagentHost } from '../src/controller.ts'
import { renderSubagentHudLines } from '../src/format.ts'
import { type SubagentEvent } from '../src/index.ts'
import { redactSensitiveText } from '../src/intercom.ts'
import { SubagentRuntime } from '../src/runtime.ts'
import { type TaskToolInput } from '../src/schema.ts'
import {
  RailActionReportLikeSchema,
  agentId,
  baseInput,
  contentText,
  createHarness,
  deferred,
  initializeHarnessRepository,
  latestState,
  runBatch,
  runTask,
  runTaskControl,
  type RailActionReportLike,
} from './integration-harness.ts'

describe('subagent Task integration', () => {
  it('carries an explicit task role from the real tool to its worker widget', async () => {
    const harness = await createHarness()
    try {
      const input = { ...baseInput, role: 'why synthesizer' }
      const result = await runTask(harness, input)
      expect(result).toContain('Agent ID:')
      const theme = {
        bg: (_color: string, text: string) => text,
        bold: (text: string) => text,
        fg: (_color: string, text: string) => text,
        getFgAnsi: () => '',
      }
      const lines = renderSubagentHudLines(harness.runtime.listSnapshots(), theme, 120)
      expect(lines.join('\n')).toContain('why synthesizer')
      const id = agentId(result)
      expect(latestState(harness).records.at(-1)).toMatchObject({
        role: 'why synthesizer',
        execution: { role: 'why synthesizer' },
      })
      expect(harness.runtime.latestResult(id)?.role).toBe('why synthesizer')
      expect(await runTaskControl(harness, { action: 'status', agent_id: id })).toContain(
        '"role": "why synthesizer"',
      )
      expect(await runTaskControl(harness, { action: 'jobs' })).toContain('why synthesizer')
    } finally {
      await harness.close()
    }
  })

  it('preserves explicit role through disk restore, real reload, and resume without inference', async () => {
    const harness = await createHarness()
    try {
      await harness.session.bindExtensions({ shutdownHandler: () => undefined })
      const id = agentId(await runTask(harness, { ...baseInput, role: 'feature' }))
      const sessionFile = harness.session.sessionManager.getSessionFile()
      if (sessionFile === undefined) throw new Error('The parent transcript is unavailable.')
      const restored = new SubagentRuntime(harness.pi)
      restored.restore({ sessionManager: SessionManager.open(sessionFile) })
      expect(restored.listSnapshots().find((snapshot) => snapshot.agentId === id)?.role).toBe(
        'feature',
      )
      await harness.session.reload()
      expect(await runTaskControl(harness, { action: 'status', agent_id: id })).toContain(
        '"role": "feature"',
      )
      expect(await runTask(harness, { ...baseInput, resume: id, prompt: 'second' })).toContain(
        'child:first|second',
      )
      expect(latestState(harness).records.find((record) => record.agentId === id)).toMatchObject({
        role: 'feature',
        execution: { role: 'feature' },
      })
      expect(await runTask(harness, { ...baseInput, resume: id, role: 'refactoring' })).toContain(
        'preserve the original role',
      )
      const legacy = agentId(
        await runTask(harness, { ...baseInput, prompt: 'feature refactoring why synthesizer' }),
      )
      expect(await runTask(harness, { ...baseInput, resume: legacy })).toContain('Agent ID:')
      const record = latestState(harness).records.find((entry) => entry.agentId === legacy)
      expect(record).not.toHaveProperty('role')
      expect(record?.execution).not.toHaveProperty('role')
    } finally {
      await harness.close()
    }
  })

  it.each(['first', 'FAIL'])(
    'persists attempt timing for %s and resets it on resume',
    async (prompt) => {
      const harness = await createHarness()
      try {
        await harness.session.bindExtensions({ shutdownHandler: () => undefined })
        const id = agentId(await runTask(harness, { ...baseInput, prompt }))
        const before = latestState(harness).records.find((record) => record.agentId === id)?.timing
        if (before?.executionEndedAt === undefined || before.settledAt === undefined) {
          throw new Error('The terminal attempt must preserve complete timing.')
        }
        expect(before.workspaceSetupMs).toBe(0)
        expect(before.sessionSetupMs).toBeGreaterThanOrEqual(0)
        expect(before.executionStartedAt).toBeGreaterThanOrEqual(before.requestedAt)
        expect(before.executionEndedAt).toBeGreaterThanOrEqual(before.executionStartedAt)
        expect(before.settledAt).toBeGreaterThanOrEqual(before.executionEndedAt)
        const sessionFile = harness.session.sessionManager.getSessionFile()
        if (sessionFile === undefined) throw new Error('The parent transcript is unavailable.')
        const restored = new SubagentRuntime(harness.pi)
        restored.restore({ sessionManager: SessionManager.open(sessionFile) })
        expect(
          restored.listSnapshots().find((snapshot) => snapshot.agentId === id)?.timing,
        ).toEqual(before)
        expect(restored.latestResult(id)?.timing).toEqual(before)
        expect(await runTaskControl(harness, { action: 'status', agent_id: id })).toContain(
          '"workspaceSetupMs": 0',
        )
        await harness.session.reload()
        await runTask(harness, { ...baseInput, resume: id, prompt: 'second' })
        const after = latestState(harness).records.find((record) => record.agentId === id)?.timing
        expect(after?.requestedAt).toBeGreaterThanOrEqual(before.settledAt)
        expect(after?.executionStartedAt).toBeGreaterThanOrEqual(after?.requestedAt ?? 0)
        expect(after?.settledAt).toBeGreaterThanOrEqual(after?.executionEndedAt ?? 0)
      } finally {
        await harness.close()
      }
    },
  )

  it('preserves per-item role in coordinated batches, blocked results, and reloaded state', async () => {
    const harness = await createHarness()
    try {
      await harness.session.bindExtensions({ shutdownHandler: () => undefined })
      const result = await runTask(harness, {
        tasks: [
          { ...baseInput, id: 'feature', role: 'feature' },
          { ...baseInput, id: 'failure', prompt: 'FAIL', role: 'refactoring' },
          { ...baseInput, id: 'blocked', needs: ['failure'], role: 'why synthesizer' },
          { ...baseInput, id: 'legacy' },
        ],
      })
      expect(result).toContain('blocked: blocked')
      const roles = latestState(harness)
        .runs.at(-1)
        ?.tasks.map((task) => task.role)
      expect(roles).toEqual(['feature', 'refactoring', 'why synthesizer', undefined])
      const message = harness.session.messages.findLast(
        (entry) => entry.role === 'toolResult' && entry.toolName === 'Task',
      )
      expect(message).toMatchObject({
        details: {
          items: [
            { role: 'feature' },
            { role: 'refactoring' },
            { role: 'why synthesizer' },
            { taskId: 'legacy' },
          ],
        },
      })
      await harness.session.reload()
      expect(
        latestState(harness)
          .runs.at(-1)
          ?.tasks.map((task) => task.role),
      ).toEqual(roles)
      expect(latestState(harness).records.map((record) => record.role)).toEqual(
        expect.arrayContaining(['feature', 'refactoring', undefined]),
      )
    } finally {
      await harness.close()
    }
  })

  it('renders active role widgets at wide and narrow widths without replacing agent glyphs', async () => {
    const harness = await createHarness()
    try {
      await runBatch(
        harness,
        ['feature', 'refactoring', 'why synthesizer'].map((role) => ({
          ...baseInput,
          description: 'Inspect behavior',
          model: 'openai-codex/gpt-6-astra',
          prompt: 'BLOCK',
          role,
          run_in_background: true,
        })),
      )
      await harness.state.blockedReady.promise
      const snapshots = harness.runtime.listSnapshots()
      expect(snapshots).toHaveLength(3)
      expect(snapshots.every((snapshot) => snapshot.running)).toBe(true)
      const theme = {
        bg: (_color: string, text: string) => text,
        bold: (text: string) => text,
        fg: (_color: string, text: string) => text,
        getFgAnsi: () => '',
      }
      const now = Math.max(...snapshots.map((snapshot) => snapshot.startedAt))
      for (const width of [1, 8, 20, 40, 80, 120]) {
        const lines = renderSubagentHudLines(snapshots, theme, width, now)
        expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true)
        if (width >= 40) {
          const text = lines.join('\n')
          expect(text).toContain('feature')
          expect(text).toContain('refactoring')
          expect(text).toContain('why synthesizer')
          expect(text).toContain('6-astra')
        }
      }
      expect(renderSubagentHudLines(snapshots, theme, 120, now).join('\n')).toContain('✧')
      const legacy = snapshots.map(({ role, ...snapshot }) => {
        expect(role).toBeDefined()
        return snapshot
      })
      for (const width of [120, 40]) {
        const before = renderSubagentHudLines(legacy, theme, width, now).join('\n')
        const after = renderSubagentHudLines(snapshots, theme, width, now).join('\n')
        expect(before).not.toContain('why synthesizer')
        expect(after).toContain('why synthesizer')
        const evidencePath = process.env.PI_SUBAGENT_ROLE_EVIDENCE
        if (evidencePath !== undefined) {
          await writeFile(
            evidencePath,
            `ROLE WIDGET ${width} COLUMNS\nLEGACY (NO ROLE)\n${before}\nEXPLICIT ROLE\n${after}\n`,
            { flag: 'a' },
          )
        }
      }
    } finally {
      for (const release of harness.state.blocked.splice(0)) release()
      await harness.close()
    }
  })

  it('keeps role on live background jobs and aborted results', async () => {
    const harness = await createHarness()
    try {
      const id = agentId(
        await runTask(harness, {
          ...baseInput,
          role: 'refactoring',
          prompt: 'BLOCK',
          run_in_background: true,
        }),
      )
      await harness.state.blockedReady.promise
      expect(
        harness.runtime.listSnapshots().find((snapshot) => snapshot.agentId === id),
      ).toMatchObject({
        role: 'refactoring',
        running: true,
      })
      expect(await runTaskControl(harness, { action: 'jobs' })).toContain('refactoring')
      await harness.runtime.cancel(id)
      expect(harness.runtime.latestResult(id)).toMatchObject({
        role: 'refactoring',
        status: 'aborted',
      })
    } finally {
      for (const release of harness.state.blocked.splice(0)) release()
      await harness.close()
    }
  })

  it('keeps explicit nested role separate from its parent role and executable agent type', async () => {
    const harness = await createHarness()
    try {
      await runTask(harness, baseInput)
      harness.runtime.registerCapabilityProfile({
        id: 'role-nested',
        nested: { maxDepth: 2 },
        registrations: [],
      })
      const result = await runTask(harness, {
        ...baseInput,
        capability_profile: 'role-nested',
        role: 'feature',
        prompt: 'NESTED_ROLE',
      })
      expect(result).toContain('nested-result:')
      const records = latestState(harness).records
      expect(records.find((record) => record.parentAgentId !== undefined)).toMatchObject({
        role: 'why synthesizer',
        subagentType: 'generalPurpose',
        execution: { role: 'why synthesizer' },
      })
      expect(records.find((record) => record.agentId === agentId(result))?.role).toBe('feature')
    } finally {
      await harness.close()
    }
  })

  it('reflows IRC cards at the actual terminal width without losing expanded text', async () => {
    const harness = await createHarness()
    try {
      initTheme('dark')
      const body =
        'A complete report with evidence that must remain visible after resizing. '.repeat(3) +
        'FINAL EVIDENCE'
      const renderer = harness.session.extensionRunner.getMessageRenderer('subagent-intercom')
      expect(renderer).toBeDefined()
      const component = new CustomMessageComponent(
        {
          role: 'custom',
          customType: 'subagent-intercom',
          content: body,
          display: true,
          timestamp: 0,
          details: { agentId: 'card-probe', kind: 'notification', level: 'info', message: body },
        },
        renderer,
      )
      expect(component.render(240).join('\n')).toContain('FINAL EVIDENCE')
      component.setExpanded(true)
      const narrow = component.render(40)
      const recovered = narrow
        .map(stripTerminalSequences)
        .filter((line) => line.includes('▏'))
        .map((line) => line.slice(line.indexOf('▏') + 1).trim())
        .join(' ')
      expect(recovered).toBe(body)
      expect(narrow.every((line) => visibleWidth(line) <= 40)).toBe(true)
      expect(narrow.join('\n')).not.toContain('…')
    } finally {
      await harness.close()
    }
  })

  it('reuses rendered IRC card lines until an input changes', async () => {
    const harness = await createHarness()
    vi.useFakeTimers({ toFake: ['Date'] })
    const renderSpy = vi.spyOn(Text.prototype, 'render')
    try {
      initTheme('dark')
      vi.setSystemTime(10_000)
      const renderer = harness.session.extensionRunner.getMessageRenderer('subagent-intercom')
      expect(renderer).toBeDefined()
      const component = new CustomMessageComponent(
        {
          role: 'custom',
          customType: 'subagent-intercom',
          content: 'Cached probe',
          display: true,
          timestamp: 5_000,
          details: {
            agentId: 'cache-probe',
            kind: 'notification',
            level: 'info',
            message: 'Cached probe body line.\n'.repeat(4),
          },
        },
        renderer,
      )
      const first = component.render(100)
      const rendersAfterFirst = renderSpy.mock.calls.length
      expect(rendersAfterFirst).toBeGreaterThan(0)
      expect(component.render(100)).toEqual(first)
      expect(renderSpy.mock.calls.length).toBe(rendersAfterFirst)
      expect(component.render(60)).not.toEqual(first)
      const rendersAfterResize = renderSpy.mock.calls.length
      expect(rendersAfterResize).toBeGreaterThan(rendersAfterFirst)
      vi.setSystemTime(10_000 + 61_000)
      expect(component.render(60).join('\n')).toContain('1m ago')
      expect(renderSpy.mock.calls.length).toBeGreaterThan(rendersAfterResize)
    } finally {
      renderSpy.mockRestore()
      vi.useRealTimers()
      await harness.close()
    }
  })

  it('refreshes existing transcript cards after delivery and acknowledgment', async () => {
    const harness = await createHarness()
    try {
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      initTheme('dark')
      const journal = harness.runtime.deliveries
      journal.pause()
      const receipt = journal.enqueue({
        agentId: 'card-probe',
        content: 'Card probe',
        customType: 'subagent-intercom',
        display: true,
        kind: 'notice',
        level: 'warning',
        ownerSessionId: harness.session.sessionManager.getSessionId(),
        runGeneration: 1,
      })
      const renderer = harness.session.extensionRunner.getMessageRenderer('subagent-intercom')
      expect(renderer).toBeDefined()
      const component = new CustomMessageComponent(
        {
          role: 'custom',
          customType: 'subagent-intercom',
          content: 'Card probe',
          display: true,
          timestamp: receipt.sentAt,
          details: {
            agentId: receipt.agentId,
            kind: 'notification',
            level: receipt.level,
            message: receipt.content,
            deliveryId: receipt.id,
          },
        },
        renderer,
      )
      expect(component.render(100).join('\n')).toContain('queued')
      journal.context([], () => true)
      expect(component.render(100).join('\n')).toContain('delivered')
      journal.acknowledge(receipt.id)
      expect(component.render(100).join('\n')).toContain('acknowledged')
      expect(component.render(100).join('\n')).not.toContain('queued')
    } finally {
      await harness.close()
    }
  })

  it('redacts common credential formats from side-channel text', () => {
    const secrets = [
      ['AWS_SECRET_ACCESS_KEY=', 'abcdefghijklmnopqrstuvwxyz1234567890'].join(''),
      ['AKIA', 'ABCDEFGHIJKLMNOP'].join(''),
      ['AIza', 'abcdefghijklmnopqrstuvwxyz123456'].join(''),
      ['TOKEN=', 'generic-token-value'].join(''),
      ['eyJheader', '.payload.signature'].join(''),
      ['postgres://user:', 'database-password@example.com/app'].join(''),
    ].join('\n')
    const redacted = redactSensitiveText(secrets)
    expect(redacted).not.toContain('abcdefghijklmnopqrstuvwxyz1234567890')
    expect(redacted).not.toContain(['AKIA', 'ABCDEFGHIJKLMNOP'].join(''))
    expect(redacted).not.toContain('AIzaabcdefghijklmnopqrstuvwxyz123456')
    expect(redacted).not.toContain('generic-token-value')
    expect(redacted).not.toContain('eyJheader.payload.signature')
    expect(redacted).not.toContain('database-password')
  })

  it('steers, observes, waits for, and cancels through the controller', async () => {
    const harness = await createHarness()
    try {
      await runTask(harness, baseInput)
      const ctx = harness.context()
      const events: SubagentEvent[] = []
      const mutatingUnsubscribe = harness.controller.subscribe(
        ctx.sessionManager.getSessionId(),
        (event) => {
          if (event.type === 'created') event.receipt.handle.agentId = 'mutated'
          if (event.type === 'updated') event.snapshot.usage.input = 999
          if (event.type === 'terminal') event.result.usage.input = 999
        },
      )
      const unsubscribe = harness.controller.subscribe(ctx.sessionManager.getSessionId(), (event) =>
        events.push(event),
      )
      const immediate = await harness.controller.start({
        ctx,
        input: { ...baseInput, readonly: true },
      })
      expect(immediate.handle.agentId).not.toBe('mutated')
      expect((await harness.controller.wait(immediate.handle)).status).toBe('completed')
      expect(
        events.some(
          (event) => event.type === 'terminal' && event.handle.agentId === immediate.handle.agentId,
        ),
      ).toBe(true)

      const receipt = await harness.controller.start({
        ctx,
        input: { ...baseInput, prompt: 'BLOCK', readonly: true },
      })
      await harness.state.blockedReady.promise
      const activeSnapshot = harness.controller.snapshot(receipt.handle)
      expect(activeSnapshot?.running).toBe(true)
      if (activeSnapshot === undefined) throw new Error('The active snapshot is missing.')
      activeSnapshot.usage.input = 999
      expect(harness.controller.snapshot(receipt.handle)?.usage.input).not.toBe(999)
      const steered = await harness.controller.steer(receipt.handle, 'redirect')
      expect(steered.status).toBe('queued')
      for (const release of harness.state.blocked.splice(0)) release()
      const result = await harness.controller.wait(receipt.handle)
      expect(result.output).toContain('child:BLOCK|redirect')
      const completedResult = harness.controller.result(receipt.handle)
      expect(completedResult?.status).toBe('completed')
      if (completedResult === undefined) throw new Error('The terminal result is missing.')
      completedResult.usage.input = 999
      expect(harness.controller.result(receipt.handle)?.usage.input).not.toBe(999)
      expect(events[0]?.type).toBe('created')
      expect(events.some((event) => event.type === 'terminal')).toBe(true)
      const revisions = events.map((event) => event.revision)
      expect(revisions).toEqual([...revisions].sort((left, right) => left - right))
      expect((await harness.controller.steer(receipt.handle, 'late')).status).toBe('rejected')

      harness.state.blockedReady = deferred()
      const cancellable = await harness.controller.start({
        ctx,
        input: { ...baseInput, prompt: 'BLOCK', readonly: true },
      })
      await harness.state.blockedReady.promise
      expect((await harness.controller.cancel(cancellable.handle)).status).toBe('requested')
      expect((await harness.controller.wait(cancellable.handle)).status).toBe('aborted')

      harness.state.blockedReady = deferred()
      const abortController = new AbortController()
      const signaled = await harness.controller.start({
        ctx,
        input: { ...baseInput, prompt: 'BLOCK', readonly: true },
        signal: abortController.signal,
      })
      await harness.state.blockedReady.promise
      abortController.abort()
      expect((await harness.controller.wait(signaled.handle)).status).toBe('aborted')
      expect(
        events.some((event) => event.type === 'updated' && event.snapshot.usage.input === 999),
      ).toBe(false)
      expect(
        events.some((event) => event.type === 'terminal' && event.result.usage.input === 999),
      ).toBe(false)
      mutatingUnsubscribe()
      unsubscribe()
    } finally {
      for (const release of harness.state.blocked.splice(0)) release()
      await harness.close()
    }
  })

  it('invalidates stale lifecycle callbacks and handles across session replacements', async () => {
    const first = await createHarness()
    const second = await createHarness()
    try {
      await initializeHarnessRepository(first)
      await initializeHarnessRepository(second)
      await runTask(first, baseInput)
      await runTask(second, baseInput)
      const lifecycleEvents: SubagentEvent[] = []
      const unsubscribe = first.controller.subscribe(
        first.session.sessionManager.getSessionId(),
        (event) => lifecycleEvents.push(event),
      )
      const firstDestination = await first.runtime.rootDestination(first.context())
      const receipt = await first.controller.start({
        ctx: first.context(),
        input: { ...baseInput, prompt: 'BLOCK', readonly: true },
      })
      await first.state.blockedReady.promise
      const host = acquireSubagentHost(first.pi)
      const staleStop = host.stopSession(first.context(), 'The parent session switched.')
      const replacement = host.replaceSession({ sessionManager: second.session.sessionManager })
      for (const release of first.state.blocked.splice(0)) release()
      expect(await staleStop).toBe(false)
      expect(await replacement).toBe(true)
      expect(first.controller.snapshot(receipt.handle)).toBeUndefined()
      expect(first.controller.result(receipt.handle)).toBeUndefined()
      expect((await first.controller.cancel(receipt.handle)).status).toBe('stale-handle')
      expect((await first.controller.steer(receipt.handle, 'late')).status).toBe('rejected')
      expect(first.runtime.ownerSessionId).toBe(second.session.sessionManager.getSessionId())
      const secondDestination = await first.runtime.rootDestination(second.context())
      expect(secondDestination.destinationPhysicalRoot).toBe(await realpath(second.dir))
      expect(secondDestination.destinationPhysicalRoot).not.toBe(
        firstDestination.destinationPhysicalRoot,
      )
      expect(
        lifecycleEvents.some(
          (event) =>
            event.type === 'owner-invalidated' &&
            event.ownerGeneration === receipt.handle.ownerGeneration,
        ),
      ).toBe(true)
      expect(await host.stopSession(first.context(), 'A delayed stale callback.')).toBe(false)
      expect(await host.replaceSession({ sessionManager: first.session.sessionManager })).toBe(
        false,
      )
      await expect(
        first.controller.start({
          ctx: first.context(),
          input: { ...baseInput, readonly: true },
        }),
      ).rejects.toThrow('does not belong to the active parent session')

      expect(
        await host.stopSession(
          { sessionManager: second.session.sessionManager },
          'The parent session forked.',
        ),
      ).toBe(true)
      expect(await host.replaceSession({ sessionManager: first.session.sessionManager })).toBe(true)
      expect(await host.stopSession(first.context(), 'The parent session tree changed.')).toBe(true)
      expect(await host.replaceSession({ sessionManager: second.session.sessionManager })).toBe(
        true,
      )
      const secondContext = { sessionManager: second.session.sessionManager }
      const earlierShutdown = host.stopSession(secondContext, 'The parent session stopped.')
      const latestShutdown = host.stopSession(secondContext, 'The parent session stopped.')
      expect(await earlierShutdown).toBe(false)
      expect(await latestShutdown).toBe(true)
      unsubscribe()
    } finally {
      for (const release of first.state.blocked.splice(0)) release()
      await first.close()
      await second.close()
    }
  }, 180_000)

  it('invalidates active handles during a real extension reload', async () => {
    const harness = await createHarness()
    try {
      await runTask(harness, baseInput)
      const receipt = await harness.controller.start({
        ctx: harness.context(),
        input: { ...baseInput, prompt: 'BLOCK', readonly: true },
      })
      await harness.state.blockedReady.promise
      const reload = harness.session.reload()
      for (const release of harness.state.blocked.splice(0)) release()
      await reload
      expect(harness.controller.snapshot(receipt.handle)).toBeUndefined()
      expect((await harness.controller.cancel(receipt.handle)).status).toBe('stale-handle')
    } finally {
      for (const release of harness.state.blocked.splice(0)) release()
      await harness.close()
    }
  })

  it('invalidates active handles during real tree navigation', async () => {
    const harness = await createHarness()
    try {
      await runTask(harness, baseInput)
      const target = harness.session.sessionManager
        .getBranch()
        .find((entry) => entry.type === 'message' && entry.message.role === 'user')
      if (target === undefined) throw new Error('The tree target is missing.')
      const receipt = await harness.controller.start({
        ctx: harness.context(),
        input: { ...baseInput, prompt: 'BLOCK', readonly: true },
      })
      await harness.state.blockedReady.promise
      const navigation = harness.session.navigateTree(target.id)
      for (const release of harness.state.blocked.splice(0)) release()
      await navigation
      expect(harness.controller.snapshot(receipt.handle)).toBeUndefined()
      expect((await harness.controller.cancel(receipt.handle)).status).toBe('stale-handle')
    } finally {
      for (const release of harness.state.blocked.splice(0)) release()
      await harness.close()
    }
  })

  it('answers child questions with an isolated parent-model side turn', async () => {
    const harness = await createHarness()
    try {
      const result = await runTask(harness, {
        ...baseInput,
        description: 'Ask the parent model',
        prompt: 'ASK_PARENT',
      })
      expect(result).toContain('guided:Advisory only, not a live-parent decision')
      expect(result).toContain('Use @nothingrotf/pi-extensions.')
      expect(harness.state.sideQuestions).toHaveLength(1)
      expect(harness.state.sideQuestions[0]).toContain(
        'Which workspace name did the parent request?',
      )
      expect(harness.state.sideSystemPrompts[0]).not.toContain('PROJECT_CONTEXT_SENTINEL')
      expect(harness.state.sideSystemPrompts[0]).toContain(
        'You provide advisory guidance in a separate side turn, not a reply from the live parent agent.',
      )
      expect(harness.state.sideToolNames[0]).toEqual([])
      expect(harness.state.sideContextPrompts[0]?.join('\n')).toContain(
        'Invoke the queued Task input.',
      )
      expect(latestState(harness).records.at(-1)?.intercomUsage).toMatchObject({
        input: 3,
        output: 4,
        turns: 1,
      })
      expect(
        harness.session.messages.some(
          (message) => message.role === 'custom' && message.customType === 'subagent-intercom',
        ),
      ).toBe(true)
    } finally {
      await harness.close()
    }
  })

  it('redacts parent context and side-turn replies before child delivery', async () => {
    const harness = await createHarness()
    try {
      await harness.session.prompt(
        `${['password=', 'parent-secret-12345'].join('')}\n${'<'.repeat(30_000)}`,
        { expandPromptTemplates: false },
      )
      const result = await runTask(harness, {
        ...baseInput,
        description: 'Test parent context isolation',
        prompt: 'ASK_PARENT_SECRET',
      })
      expect(result).toContain('guided:Advisory only')
      expect(result).toContain('api_key=[REDACTED]')
      expect(result).not.toContain('sidechannel-secret-12345')
      const sideContext = harness.state.sideContextPrompts.flat().join('\n')
      expect(sideContext).not.toContain('parent-secret-12345')
      expect(sideContext.length).toBeLessThan(90_000)
      expect(harness.state.sideQuestions.at(-1)).toContain('&lt;/subagent-intercom&gt;')
      const intercomText: string[] = []
      for (const message of harness.session.messages) {
        if (message.role !== 'custom' || message.customType !== 'subagent-intercom') continue
        intercomText.push(contentText(message.content))
      }
      expect(intercomText.join('\n')).not.toContain('sidechannel-secret-12345')
    } finally {
      await harness.close()
    }
  })

  it('delivers child progress and notifications to the parent session', async () => {
    const harness = await createHarness()
    try {
      const result = await runTask(harness, {
        ...baseInput,
        description: 'Report to the parent model',
        prompt: 'REPORT_PARENT',
      })
      expect(result).toContain('reported')
      const notice = harness.session.messages.find(
        (message) =>
          message.role === 'custom' &&
          message.customType === 'subagent-intercom' &&
          contentText(message.content).includes('The workspace name needs review.'),
      )
      expect(notice).toBeDefined()
      expect(harness.state.parentNotices).toHaveLength(1)
    } finally {
      await harness.close()
    }
  })

  it('nests foreground child tool calls under the Task rail row', async () => {
    const harness = await createHarness()
    const reports: RailActionReportLike[] = []
    const unsubscribe = harness.pi.events.on('hud:rail-action', (data) => {
      if (Value.Check(RailActionReportLikeSchema, data)) reports.push(data)
    })
    try {
      harness.pi.events.emit('hud:rail-enabled', { enabled: true })
      const result = await runTask(harness, {
        ...baseInput,
        description: 'Report to the parent model',
        prompt: 'REPORT_PARENT',
      })
      expect(result).toContain('reported')
      const parent = harness.session.messages
        .flatMap((message) => (message.role === 'assistant' ? message.content : []))
        .find((block) => block.type === 'toolCall' && block.name === 'Task')
      expect(parent?.type).toBe('toolCall')
      const parentId = parent?.type === 'toolCall' ? parent.id : ''
      const children = reports.filter((report) => report.parentToolCallId !== undefined)
      expect(children.length).toBeGreaterThan(0)
      expect(children.every((report) => report.parentToolCallId === parentId)).toBe(true)
      expect(children.map((report) => report.toolName)).not.toContain('update_progress')
      const notified = children.filter((report) => report.toolName === 'notify_parent')
      expect(notified.map((report) => report.status)).toEqual(['pending', 'ok'])
      expect(notified[0]).toMatchObject({
        detail: 'The workspace name needs review.',
        doneLabel: 'Notified parent',
        iconKey: 'agent',
        runningLabel: 'Notifying parent',
      })
      expect(notified[1]?.durationMs).toBeGreaterThanOrEqual(0)
      expect(notified[1]?.summary?.length ?? 0).toBeGreaterThan(0)
      const agentId = harness.runtime.listSnapshots()[0]?.agentId ?? ''
      expect(notified[0]?.toolCallId.startsWith(`${agentId}:`)).toBe(true)
      harness.pi.events.emit('hud:rail-enabled', { enabled: false })
      const before = reports.length
      await runTask(harness, { ...baseInput, prompt: 'REPORT_PARENT' })
      expect(reports.slice(before).some((report) => report.parentToolCallId !== undefined)).toBe(
        false,
      )
    } finally {
      unsubscribe()
      await harness.close()
    }
  })

  it('removes the abort listener when a controller wait completes', async () => {
    const harness = await createHarness()
    try {
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      const receipt = await harness.controller.start({
        ctx: harness.context(),
        input: { ...baseInput, prompt: 'BLOCK', readonly: true },
      })
      await harness.state.blockedReady.promise
      const controller = new AbortController()
      const waiting = harness.controller.wait(receipt.handle, controller.signal)
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1)
      for (const release of harness.state.blocked.splice(0)) release()
      await waiting
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    } finally {
      for (const release of harness.state.blocked.splice(0)) release()
      await harness.close()
    }
  })

  it('preserves execution timestamps after an isolated patch joins', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      const started = await runTask(harness, {
        ...baseInput,
        prompt: 'WRITE_ISOLATED',
        subagent_type: 'generalPurpose',
        run_in_background: true,
      })
      const id = agentId(started)
      const handle = harness.runtime.handle(id)
      if (handle !== undefined) await harness.controller.wait(handle)
      const before = harness.runtime.listSnapshots().find((snapshot) => snapshot.agentId === id)
      expect(before?.status).toBe('completed')
      const destination = await harness.runtime.rootDestination(harness.context())
      const joined = await harness.runtime.joinStaged(id, destination, harness.session.sessionId)
      expect(joined.status).toBe('joined')
      const after = harness.runtime.listSnapshots().find((snapshot) => snapshot.agentId === id)
      expect(after?.startedAt).toBe(before?.startedAt)
      expect(after?.endedAt).toBe(before?.endedAt)
      expect(after?.timing).toEqual(before?.timing)
      expect(after?.timing?.workspaceSetupMs).toBeGreaterThan(0)
      expect(after?.timing?.sessionSetupMs).toBeGreaterThan(0)
      expect(await readFile(join(harness.dir, 'isolated.txt'), 'utf8')).toBe('isolated content\n')
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('serializes joins against another join and a resumed attempt', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      const started = await runTask(harness, {
        ...baseInput,
        prompt: 'WRITE_ISOLATED',
        subagent_type: 'generalPurpose',
        run_in_background: true,
      })
      const id = agentId(started)
      const handle = harness.runtime.handle(id)
      if (handle !== undefined) await harness.controller.wait(handle)
      const destination = await harness.runtime.rootDestination(harness.context())
      const joining = harness.runtime.joinStaged(id, destination, harness.session.sessionId)
      expect(
        (await harness.runtime.joinStaged(id, destination, harness.session.sessionId)).reason,
      ).toBe('running')
      const resumed = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          prompt: 'RETURN_TOOLS',
          subagent_type: 'generalPurpose',
          resume: id,
        },
        signal: undefined,
      })
      expect(resumed.kind).toBe('failed')
      if (resumed.kind !== 'failed') throw new Error('The concurrent resume was not rejected.')
      expect(resumed.details.error).toContain('already has an active run')
      expect((await joining).status).toBe('joined')
      expect(await readFile(join(harness.dir, 'isolated.txt'), 'utf8')).toBe('isolated content\n')
      expect(
        harness.runtime.deliveries.list(id).find((delivery) => delivery.kind === 'completion')
          ?.state,
      ).toBe('acknowledged')
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('drains an invalidated join without applying its patch', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      const started = await runTask(harness, {
        ...baseInput,
        prompt: 'WRITE_ISOLATED',
        subagent_type: 'generalPurpose',
        run_in_background: true,
      })
      const id = agentId(started)
      const handle = harness.runtime.handle(id)
      if (handle !== undefined) await harness.controller.wait(handle)
      const destination = await harness.runtime.rootDestination(harness.context())
      const joining = harness.runtime.joinStaged(id, destination, harness.session.sessionId)
      harness.runtime.invalidateHandles()
      const shutdown = harness.runtime.shutdown()
      expect((await joining).status).not.toBe('joined')
      await shutdown
      await expect(readFile(join(harness.dir, 'isolated.txt'), 'utf8')).rejects.toThrow(/ENOENT/)
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('delivers a child notice before the parent final answer', async () => {
    const harness = await createHarness()
    try {
      await runTask(harness, {
        ...baseInput,
        description: 'Report during foreground work',
        prompt: 'REPORT_PARENT',
      })
      const messages = harness.session.messages
      const noticeIndex = messages.findIndex(
        (message) => message.role === 'custom' && message.customType === 'subagent-intercom',
      )
      const finalIndex = messages.findIndex(
        (message) => message.role === 'assistant' && message.stopReason === 'stop',
      )
      expect(noticeIndex).toBeGreaterThan(-1)
      expect(noticeIndex).toBeLessThan(finalIndex)
      expect(
        messages.filter((message) => message.role === 'assistant' && message.stopReason === 'stop'),
      ).toHaveLength(1)
    } finally {
      await harness.close()
    }
  })

  it('answers a background decision through the real coordinator TaskControl reply', async () => {
    const harness = await createHarness()
    try {
      harness.state.autoReplyToDecision = true
      const started = await runTask(harness, {
        ...baseInput,
        prompt: 'REQUEST_PARENT',
        readonly: true,
        run_in_background: true,
      })
      const id = agentId(started)
      const handle = harness.runtime.handle(id)
      if (handle !== undefined) await harness.controller.wait(handle)
      await harness.session.agent.waitForIdle()
      const result = harness.runtime.latestResult(id)
      expect(result?.status).toBe('completed')
      expect(result?.output).toBe('decision:No. Preserve the assigned scope.')
      expect(harness.state.sideQuestions).toHaveLength(0)
      expect(
        harness.runtime.deliveries.list(id).find((delivery) => delivery.kind === 'request')?.state,
      ).toBe('acknowledged')
    } finally {
      await harness.close()
    }
  })

  it.each(['completed', 'cancelled'])(
    'defers background delivery until manual compaction is %s',
    async (outcome) => {
      const harness = await createHarness()
      const entered = deferred()
      const releaseCompact = deferred()
      try {
        harness.session.settingsManager.applyOverrides({
          compaction: { enabled: false, keepRecentTokens: 1 },
        })
        await harness.session.prompt('Compaction history. '.repeat(100), {
          expandPromptTemplates: false,
        })
        const started = await runTask(harness, {
          ...baseInput,
          prompt: 'BLOCK',
          readonly: true,
          run_in_background: true,
        })
        await harness.state.blockedReady.promise
        harness.pi.on('session_before_compact', async (event) => {
          entered.resolve()
          await releaseCompact.promise
          if (outcome === 'cancelled') return { cancel: true }
          return {
            compaction: {
              summary: 'A background Task is in progress.',
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              tokensBefore: event.preparation.tokensBefore,
            },
          }
        })
        const compact = harness.session.compact()
        await Promise.race([
          entered.promise,
          compact.then(() => {
            throw new Error('Compaction did not reach the barrier.')
          }),
        ])
        const requests = harness.state.parentRequests
        const handle = harness.runtime.handle(agentId(started))
        if (handle === undefined) throw new Error('The background child is missing.')
        for (const release of harness.state.blocked.splice(0)) release()
        await harness.controller.wait(handle)
        expect(harness.state.parentRequests).toBe(requests)
        expect(harness.runtime.deliveries.list(handle.agentId)[0]?.state).toBe('queued')
        releaseCompact.resolve()
        if (outcome === 'cancelled') await expect(compact).rejects.toThrow('Compaction cancelled')
        else await compact
        await harness.state.notification.promise
        await harness.session.agent.waitForIdle()
        expect(harness.runtime.deliveries.list(handle.agentId)[0]?.state).toBe('delivered')
      } finally {
        releaseCompact.resolve()
        for (const release of harness.state.blocked.splice(0)) release()
        await harness.close()
      }
    },
  )

  it('keeps a foreground child running and returns its open decision without authorization', async () => {
    const harness = await createHarness()
    try {
      const result = await runTask(harness, {
        ...baseInput,
        prompt: 'REQUEST_PARENT',
        readonly: true,
      })
      expect(result).toContain('decision:')
      expect(result).toContain('No authorization was granted')
      expect(result).toContain('report this decision with its options and your recommendation')
      expect(harness.runtime.latestResult(agentId(result))?.status).toBe('completed')
      expect(harness.state.sideQuestions).toHaveLength(0)
    } finally {
      await harness.close()
    }
  })

  it('retains unresolved delivery authority beyond terminal record pruning on restore', async () => {
    const harness = await createHarness()
    try {
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      const seed = latestState(harness)
      const record = seed.records[0]
      if (record === undefined) throw new Error('The seed task is missing.')
      const records = Array.from({ length: 257 }, (_unused, index) => ({
        ...record,
        agentId: `restored-delivery-${index}`,
        createdAt: index,
        updatedAt: index,
        runGeneration: index + 1,
      }))
      harness.session.sessionManager.appendCustomEntry('pi-subagent-state', { ...seed, records })
      harness.session.sessionManager.appendCustomEntry('pi-subagent-delivery', {
        agentId: 'restored-delivery-0',
        id: 'retained-notice',
        content: 'Unresolved work result',
        customType: 'subagent-notification',
        display: false,
        kind: 'completion',
        level: 'info',
        ownerSessionId: seed.ownerSessionId,
        runGeneration: 1,
        state: 'queued',
        queuedAt: 0,
        sentAt: 0,
      })
      harness.runtime.restore(harness.context())
      expect(
        harness.runtime.deliveries.context([], (delivery) =>
          harness.runtime.isCurrentDelivery(delivery),
        ),
      ).toHaveLength(1)
      expect(harness.runtime.latestResult('restored-delivery-0')?.status).toBe('completed')
    } finally {
      await harness.close()
    }
  })

  it('restores branch state and marks interrupted children as aborted', async () => {
    const harness = await createHarness(1)
    try {
      await runTask(harness, baseInput)
      const record = latestState(harness).records.find(
        (candidate) => candidate.agentId === 'interrupted-child',
      )
      expect(record?.agentId).toBe('interrupted-child')
      expect(record?.status).toBe('aborted')
      expect(record?.error).toBe('Interrupted by session reload.')
    } finally {
      await harness.close()
    }
  })

  it('rejects legacy resume records without a persisted execution contract', async () => {
    const harness = await createHarness()
    try {
      const first = await runTask(harness, baseInput)
      const id = agentId(first)
      const record = latestState(harness).records.find((candidate) => candidate.agentId === id)
      if (record === undefined) throw new Error('The child record is missing.')
      const legacy = { ...record }
      delete legacy.execution
      harness.pi.appendEntry('pi-subagent-state', {
        ownerSessionId: harness.session.sessionManager.getSessionId(),
        records: [legacy],
        version: 1,
      })
      harness.runtime.restore(harness.context())

      const resumed = await runTask(harness, { ...baseInput, prompt: 'second', resume: id })
      expect(resumed).toContain(
        'A legacy Task record cannot resume without a persisted execution contract.',
      )
    } finally {
      await harness.close()
    }
  })

  it('migrates valid v2 state to v6', async () => {
    const harness = await createHarness()
    try {
      await runTask(harness, baseInput)
      harness.pi.appendEntry('pi-subagent-state', {
        ownerSessionId: harness.session.sessionManager.getSessionId(),
        records: [],
        version: 2,
      })
      harness.runtime.restore(harness.context())
      expect(latestState(harness)).toMatchObject({ records: [], version: 6 })
    } finally {
      await harness.close()
    }
  })

  it('migrates v4 records and coordination state to v6', async () => {
    const harness = await createHarness()
    try {
      const result = await runTask(harness, baseInput)
      const id = agentId(result)
      const state = latestState(harness)
      harness.pi.appendEntry('pi-subagent-state', { ...state, version: 4 })
      harness.runtime.restore(harness.context())
      const migrated = latestState(harness)
      expect(migrated.version).toBe(6)
      expect(migrated.records.some((record) => record.agentId === id)).toBe(true)
      expect(migrated.runs).toEqual(state.runs)
    } finally {
      await harness.close()
    }
  })

  it('migrates v3 artifact records without invalidating their references', async () => {
    const harness = await createHarness()
    try {
      const result = await runTask(harness, baseInput)
      const id = agentId(result)
      const state = latestState(harness)
      const record = state.records.find((candidate) => candidate.agentId === id)
      if (record?.artifact === undefined) throw new Error('The v3 source artifact is missing.')
      const { attempt: _attempt, ...legacyArtifact } = record.artifact
      harness.pi.appendEntry('pi-subagent-state', {
        ownerSessionId: state.ownerSessionId,
        records: [{ ...record, artifact: legacyArtifact }],
        runs: [],
        version: 3,
      })
      harness.runtime.restore(harness.context())
      const migrated = latestState(harness).records.find((candidate) => candidate.agentId === id)
      if (migrated?.artifact === undefined) throw new Error('The migrated artifact is missing.')
      expect(migrated.artifact.attempt).toBe(record.runGeneration)
      expect(await readFile(new URL(migrated.artifact.uri), 'utf8')).toBe('child:first')
    } finally {
      await harness.close()
    }
  })

  it('upgrades a legacy v1 execution contract on resume', async () => {
    const harness = await createHarness()
    try {
      const id = agentId(await runTask(harness, baseInput))
      const state = latestState(harness)
      const record = state.records.find((candidate) => candidate.agentId === id)
      if (record?.execution?.version !== 5) throw new Error('The v5 execution contract is missing.')
      const execution = record.execution
      harness.pi.appendEntry('pi-subagent-state', {
        ownerSessionId: state.ownerSessionId,
        records: [
          {
            ...record,
            execution: {
              agentDescription: execution.agentDescription,
              agentName: execution.agentName,
              agentSource: execution.agentSource,
              cwd: execution.logicalCwd,
              effort: execution.effort,
              fast: execution.fast,
              model: execution.model,
              modelSelector: execution.modelSelector,
              readonly: execution.readonly,
              systemPrompt: execution.systemPrompt,
              tools: execution.tools,
              version: 1,
            },
          },
        ],
        version: 4,
      })
      harness.runtime.restore(harness.context())

      const resumed = await runTask(harness, { ...baseInput, prompt: 'second', resume: id })
      expect(resumed).toContain('child:first|second')
      expect(harness.runtime.getRecord(id)?.execution).toMatchObject({ version: 5 })
    } finally {
      await harness.close()
    }
  })

  it('upgrades a v2 execution contract before rendering a resumed child', async () => {
    const harness = await createHarness()
    try {
      const input: TaskToolInput = {
        description: 'Render the execution contract',
        gates: [{ expected: 'completed', type: 'status' }],
        outputSchema: { type: 'string' },
        prompt: 'first',
        readonly: true,
        schemaMode: 'permissive',
        subagent_type: 'explore',
        tools: ['read'],
      }
      const id = agentId(await runTask(harness, input))
      const state = latestState(harness)
      const record = state.records.find((candidate) => candidate.agentId === id)
      if (record?.execution?.version !== 5) throw new Error('The v4 execution contract is missing.')
      const {
        logicalCwd,
        relativeCwd: _relativeCwd,
        version: _version,
        workspaceIdentity: _workspaceIdentity,
        ...legacy
      } = record.execution
      harness.pi.appendEntry('pi-subagent-state', {
        ownerSessionId: state.ownerSessionId,
        records: [{ ...record, execution: { ...legacy, cwd: logicalCwd, version: 2 } }],
        version: 4,
      })
      harness.runtime.restore(harness.context())

      const resumed = await runTask(harness, {
        ...input,
        prompt: 'second',
        resume: id,
      })
      expect(resumed).toContain('child:first|second')
      const executionContext = harness.state.childSystemPrompts.at(-1)
      expect(executionContext).toContain(
        '# Execution contract\nMode: permissive.\nEffective tools: read.\nOutput schema: {"type":"string"}.\nOutput gates: [{"expected":"completed","type":"status"}].',
      )
    } finally {
      await harness.close()
    }
  })

  it('upgrades a v3 execution contract before rendering a resumed child', async () => {
    const harness = await createHarness()
    try {
      const input: TaskToolInput = {
        description: 'Render the execution contract',
        gates: [{ expected: 'completed', type: 'status' }],
        outputSchema: { type: 'string' },
        prompt: 'first',
        readonly: true,
        schemaMode: 'permissive',
        subagent_type: 'explore',
        tools: ['read'],
      }
      const id = agentId(await runTask(harness, input))
      const state = latestState(harness)
      const record = state.records.find((candidate) => candidate.agentId === id)
      if (record?.execution?.version !== 5) throw new Error('The v4 execution contract is missing.')
      const {
        version: _version,
        workspaceIdentity: _workspaceIdentity,
        ...legacy
      } = record.execution
      harness.pi.appendEntry('pi-subagent-state', {
        ownerSessionId: state.ownerSessionId,
        records: [{ ...record, execution: { ...legacy, version: 3 } }],
        version: 4,
      })
      harness.runtime.restore(harness.context())

      const resumed = await runTask(harness, {
        ...input,
        prompt: 'second',
        resume: id,
      })
      expect(resumed).toContain('child:first|second')
      const executionContext = harness.state.childSystemPrompts.at(-1)
      expect(executionContext).toContain(
        '# Execution contract\nMode: permissive.\nEffective tools: read.\nOutput schema: {"type":"string"}.\nOutput gates: [{"expected":"completed","type":"status"}].',
      )
    } finally {
      await harness.close()
    }
  })

  it('upgrades a legacy v4 execution contract on resume', async () => {
    const harness = await createHarness()
    try {
      const id = agentId(await runTask(harness, baseInput))
      const state = latestState(harness)
      const record = state.records.find((candidate) => candidate.agentId === id)
      if (record?.execution?.version !== 5) throw new Error('The v5 execution contract is missing.')
      const { version: _version, ...legacy } = record.execution
      harness.pi.appendEntry('pi-subagent-state', {
        ...state,
        records: [{ ...record, execution: { ...legacy, version: 4 } }],
      })
      harness.runtime.restore(harness.context())

      const resumed = await runTask(harness, { ...baseInput, prompt: 'second', resume: id })
      expect(resumed).toContain('child:first|second')
      expect(harness.runtime.getRecord(id)?.execution).toMatchObject({ version: 5 })
    } finally {
      await harness.close()
    }
  })

  it('resumes a retained v5 record that still carries a retired delivery binding', async () => {
    const harness = await createHarness()
    try {
      const id = agentId(await runTask(harness, baseInput))
      const state = latestState(harness)
      const record = state.records.find((candidate) => candidate.agentId === id)
      if (record?.execution?.version !== 5) throw new Error('The v5 execution contract is missing.')
      harness.pi.appendEntry('pi-subagent-state', {
        ...state,
        records: [
          {
            ...record,
            execution: { ...record.execution, delivery: { issue: 'retired', kind: 'managed' } },
          },
        ],
      })
      harness.runtime.restore(harness.context())

      const resumed = await runTask(harness, { ...baseInput, prompt: 'second', resume: id })
      expect(resumed).toContain('child:first|second')
      expect(harness.state.childSystemPrompts.at(-1)).not.toContain('Delivery binding')
    } finally {
      await harness.close()
    }
  })

  it('reports malformed persisted state instead of dropping records', async () => {
    const harness = await createHarness()
    try {
      await runTask(harness, baseInput)
      harness.pi.appendEntry('pi-subagent-state', {
        ownerSessionId: harness.session.sessionManager.getSessionId(),
        records: 'invalid',
        version: 2,
      })
      expect(() => harness.runtime.restore(harness.context())).toThrow(
        'The persisted subagent state is invalid.',
      )
    } finally {
      await harness.close()
    }
  })

  it('caps oversized restored state by update recency', async () => {
    const harness = await createHarness(258)
    try {
      await runTask(harness, baseInput)
      const state = latestState(harness)
      expect(state.records).toHaveLength(256)
      expect(state.records.some((record) => record.agentId === 'interrupted-child')).toBe(true)
      expect(state.records.some((record) => record.agentId === 'restored-child-257')).toBe(false)
      expect(state.records.some((record) => record.agentId === 'restored-child-256')).toBe(false)
    } finally {
      await harness.close()
    }
  }, 180_000)
})
