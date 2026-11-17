import { randomUUID } from 'node:crypto'
import { readFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { withFileMutationQueue } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import type { Speed } from './policy.ts'

const StateSchema = Type.Object(
  {
    speed: Type.Union([Type.Literal('standard'), Type.Literal('fast'), Type.Literal('ultrafast')]),
  },
  { additionalProperties: false },
)
const LegacyStateSchema = Type.Object({ enabled: Type.Boolean() }, { additionalProperties: false })
const FileErrorSchema = Type.Object({ code: Type.Literal('ENOENT') })

export async function loadSpeed(path: string): Promise<Speed> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (Value.Check(FileErrorSchema, error)) return 'standard'
    throw error
  }
  const parsed: unknown = JSON.parse(text)
  if (Value.Check(StateSchema, parsed)) return parsed.speed
  if (Value.Check(LegacyStateSchema, parsed)) return parsed.enabled ? 'fast' : 'standard'
  throw new Error('The Fast Mode state is invalid.')
}

export async function saveSpeed(path: string, speed: Speed): Promise<void> {
  await withFileMutationQueue(path, async () => {
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify({ speed }, null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, path)
    } finally {
      await rm(temporary, { force: true })
    }
  })
}
