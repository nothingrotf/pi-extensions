import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { expect, test } from 'vite-plus/test'

import { registerDeliveryProtocol } from '../src/delivery-tools.ts'

const TopLevelSchema = Type.Object({
  properties: Type.Record(Type.String(), Type.Unknown()),
  required: Type.Array(Type.String()),
})

test('declares pstack_delivery fields at the top level for providers that drop unions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pstack-delivery-schema-'))
  try {
    const settingsManager = SettingsManager.inMemory()
    const resourceLoader = new DefaultResourceLoader({
      agentDir: join(dir, 'agent'),
      cwd: dir,
      extensionFactories: [registerDeliveryProtocol],
      noContextFiles: true,
      noExtensions: true,
      noPromptTemplates: true,
      noSkills: true,
      noThemes: true,
      settingsManager,
    })
    await resourceLoader.reload()
    const { session } = await createAgentSession({
      agentDir: join(dir, 'agent'),
      cwd: dir,
      resourceLoader,
      sessionManager: SessionManager.inMemory(dir),
      settingsManager,
    })
    try {
      const parameters = session.getToolDefinition('pstack_delivery')?.parameters
      if (parameters === undefined) throw new Error('pstack_delivery is not registered.')
      const topLevel = Value.Parse(TopLevelSchema, parameters)
      expect(topLevel.required).toEqual(['action', 'issue'])
      expect(topLevel.properties).toMatchObject({
        criteria: { type: 'array' },
        runtimeRequired: { type: 'boolean' },
      })
      const open = {
        action: 'open',
        criteria: [{ description: 'The contract compiles.', id: 'c1' }],
        issue: 'SPT-1',
        runtimeRequired: true,
      }
      expect(Value.Check(parameters, open)).toBe(true)
      expect(Value.Check(parameters, { ...open, runtimeRequired: 'true' })).toBe(false)
      expect(Value.Check(parameters, { action: 'record', issue: 'SPT-1' })).toBe(false)
    } finally {
      session.dispose()
    }
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
})
