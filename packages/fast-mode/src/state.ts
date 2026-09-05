import { randomUUID } from 'node:crypto'
import { readFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { withFileMutationQueue } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

const StateSchema = Type.Object({ enabled: Type.Boolean() }, { additionalProperties: false })
const FileErrorSchema = Type.Object({ code: Type.Literal('ENOENT') })

export async function loadFastMode(path: string): Promise<boolean> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (Value.Check(FileErrorSchema, error)) return false
    throw error
  }
  const parsed: unknown = JSON.parse(text)
  if (!Value.Check(StateSchema, parsed)) throw new Error('The Fast Mode state is invalid.')
  return parsed.enabled
}

export async function saveFastMode(path: string, enabled: boolean): Promise<void> {
  await withFileMutationQueue(path, async () => {
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify({ enabled }, null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, path)
    } finally {
      await rm(temporary, { force: true })
    }
  })
}
