import { symlink } from 'node:fs/promises'
import { join } from 'node:path'

import { SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vite-plus/test'

import { agentId, baseInput, createHarness, runTask } from './integration-harness.ts'

describe('owned Task transcript navigation', () => {
  it.each([false, true])(
    'keeps a completed worker in its owner context (symlink: %s)',
    async (alias) => {
      const harness = await createHarness()
      try {
        const first = await runTask(harness, baseInput)
        const id = agentId(first)
        const record = harness.runtime.getRecord(id)
        if (record === undefined) throw new Error('The Task record is missing.')
        const generation = harness.runtime.currentOwnerGeneration
        const target = alias ? join(harness.dir, 'worker-alias.jsonl') : record.sessionFile
        if (alias) await symlink(record.sessionFile, target)
        const navigation = await harness.session.extensionRunner.emit({
          type: 'session_before_switch',
          reason: 'resume',
          targetSessionFile: target,
        })
        expect(navigation).toMatchObject({ cancel: true })
        expect(harness.runtime.currentOwnerGeneration).toBe(generation)
        expect(harness.runtime.ownerSessionId).toBe(harness.session.sessionId)
        const resumed = await runTask(harness, {
          ...baseInput,
          prompt: 'continued safely',
          resume: id,
        })
        expect(agentId(resumed)).toBe(id)
        expect(resumed).toContain('child:first|continued safely')
      } finally {
        await harness.close()
      }
    },
  )

  it('does not abort an active worker when its transcript is selected', async () => {
    const harness = await createHarness()
    try {
      await runTask(harness, baseInput)
      const receipt = await harness.controller.start({
        ctx: harness.context(),
        input: { ...baseInput, prompt: 'BLOCK', readonly: true },
      })
      await harness.state.blockedReady.promise
      const record = harness.runtime.getRecord(receipt.handle.agentId)
      if (record === undefined) throw new Error('The active Task record is missing.')
      const navigation = harness.session.extensionRunner.emit({
        type: 'session_before_switch',
        reason: 'resume',
        targetSessionFile: record.sessionFile,
      })
      for (const release of harness.state.blocked.splice(0)) release()
      expect(await navigation).toMatchObject({ cancel: true })
      expect((await harness.controller.wait(receipt.handle)).status).toBe('completed')
    } finally {
      for (const release of harness.state.blocked.splice(0)) release()
      await harness.close()
    }
  })

  it('keeps an active worker when a later extension cancels navigation', async () => {
    const harness = await createHarness()
    try {
      await runTask(harness, baseInput)
      const receipt = await harness.controller.start({
        ctx: harness.context(),
        input: { ...baseInput, prompt: 'BLOCK', readonly: true },
      })
      await harness.state.blockedReady.promise
      harness.pi.on('session_before_switch', () => ({ cancel: true }))
      const navigation = harness.session.extensionRunner.emit({
        type: 'session_before_switch',
        reason: 'new',
      })
      for (const release of harness.state.blocked.splice(0)) release()
      expect(await navigation).toMatchObject({ cancel: true })
      expect((await harness.controller.wait(receipt.handle)).status).toBe('completed')
    } finally {
      for (const release of harness.state.blocked.splice(0)) release()
      await harness.close()
    }
  })

  it('cancels navigation without stopping a worker when ownership history is invalid', async () => {
    const harness = await createHarness()
    try {
      await runTask(harness, baseInput)
      const receipt = await harness.controller.start({
        ctx: harness.context(),
        input: { ...baseInput, prompt: 'BLOCK', readonly: true },
      })
      await harness.state.blockedReady.promise
      const source = harness.session.sessionFile
      if (source === undefined) throw new Error('The root transcript is missing.')
      const fork = SessionManager.forkFrom(source, harness.dir, join(harness.dir, 'forks'))
      const targetSessionFile = fork.getSessionFile()
      if (targetSessionFile === undefined) throw new Error('The fork transcript is missing.')
      harness.pi.appendEntry('pi-subagent-state', { version: 7, records: 'invalid' })
      const before = structuredClone(harness.session.sessionManager.getBranch())
      const generation = harness.runtime.currentOwnerGeneration
      const navigation = await harness.session.extensionRunner.emit({
        type: 'session_before_switch',
        reason: 'resume',
        targetSessionFile,
      })
      expect(navigation).toMatchObject({ cancel: true })
      expect(harness.runtime.currentOwnerGeneration).toBe(generation)
      expect(harness.session.sessionManager.getBranch()).toEqual(before)
      expect(harness.runtime.getRecord(receipt.handle.agentId)?.status).toBe('running')
      for (const release of harness.state.blocked.splice(0)) release()
      expect((await harness.controller.wait(receipt.handle)).status).toBe('completed')
    } finally {
      for (const release of harness.state.blocked.splice(0)) release()
      await harness.close()
    }
  })

  it('protects direct and symlink transcripts beyond terminal record retention', async () => {
    const harness = await createHarness()
    try {
      const first = await runTask(harness, baseInput)
      const id = agentId(first)
      const record = harness.runtime.getRecord(id)
      if (record === undefined) throw new Error('The Task record is missing.')
      for (let index = 0; index < 256; index += 1) {
        const result = await harness.runtime.run({
          ctx: harness.context(),
          input: baseInput,
          signal: undefined,
        })
        expect(result.kind).toBe('completed')
      }
      expect(harness.runtime.getRecord(id)).toBeUndefined()
      const alias = join(harness.dir, 'pruned-worker-alias.jsonl')
      await symlink(record.sessionFile, alias)
      for (const phase of ['valid', 'corrupt']) {
        if (phase === 'corrupt')
          harness.pi.appendEntry('pi-subagent-state', { version: 7, records: 'invalid' })
        const leaf = harness.session.sessionManager.getLeafId()
        const generation = harness.runtime.currentOwnerGeneration
        for (const target of [record.sessionFile, alias]) {
          const navigation = await harness.session.extensionRunner.emit({
            type: 'session_before_switch',
            reason: 'resume',
            targetSessionFile: target,
          })
          expect.soft(navigation).toMatchObject({ cancel: true })
        }
        expect(harness.session.sessionManager.getLeafId()).toBe(leaf)
        expect(harness.runtime.currentOwnerGeneration).toBe(generation)
      }
    } finally {
      await harness.close()
    }
  }, 120_000)

  it('allows navigation to an ordinary fork with copied Task state', async () => {
    const harness = await createHarness()
    try {
      await runTask(harness, baseInput)
      const source = harness.session.sessionFile
      if (source === undefined) throw new Error('The root transcript is missing.')
      const fork = SessionManager.forkFrom(source, harness.dir, join(harness.dir, 'forks'))
      const targetSessionFile = fork.getSessionFile()
      if (targetSessionFile === undefined) throw new Error('The fork transcript is missing.')
      const navigation = await harness.session.extensionRunner.emit({
        type: 'session_before_switch',
        reason: 'resume',
        targetSessionFile,
      })
      expect(navigation?.cancel).not.toBe(true)
    } finally {
      await harness.close()
    }
  })

  it('allows navigation to an unrelated root session', async () => {
    const current = await createHarness()
    const other = await createHarness()
    try {
      await runTask(current, baseInput)
      await runTask(other, baseInput)
      const targetSessionFile = other.session.sessionFile
      if (targetSessionFile === undefined) throw new Error('The root transcript is missing.')
      const navigation = await current.session.extensionRunner.emit({
        type: 'session_before_switch',
        reason: 'resume',
        targetSessionFile,
      })
      expect(navigation?.cancel).not.toBe(true)
    } finally {
      await current.close()
      await other.close()
    }
  })
})
