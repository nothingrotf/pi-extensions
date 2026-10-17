import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { afterEach, describe, expect, it } from 'vite-plus/test'

const exec = promisify(execFile)
const repoRoot = resolve(import.meta.dirname, '..')
const script = join(repoRoot, 'tools/pi-local.ts')
const roots: string[] = []
const StringSchema = Type.String()
const SettingsSchema = Type.Object(
  {
    packages: Type.Array(
      Type.Union([
        Type.String(),
        Type.Object({ source: Type.String() }, { additionalProperties: true }),
      ]),
    ),
  },
  { additionalProperties: true },
)

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'pi-local-bundle-'))
  roots.push(directory)
  return directory
}

async function readSettings(directory: string) {
  const value: unknown = JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8'))
  return Value.Decode(SettingsSchema, value)
}

async function run(command: string, directory: string, sourceDirectory = directory) {
  return exec('bun', [script, command, directory], {
    cwd: repoRoot,
    env: { ...process.env, PI_CODING_AGENT_DIR: sourceDirectory, PI_OFFLINE: '1' },
  })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('local Pi bundle commands', () => {
  it('migrates relative, absolute, and filtered local sources while preserving external packages and settings', async () => {
    const directory = await fixture()
    const external = { source: 'npm:external-fixture', extensions: ['tool.ts'] }
    const original = {
      theme: 'light',
      custom: { keep: true },
      packages: [
        external,
        'npm:another-external-fixture',
        { source: relative(directory, join(repoRoot, 'packages/ask')), skills: [] },
        join(repoRoot, 'packages/subagent'),
      ],
    }
    const text = JSON.stringify(original, null, 2)
    await writeFile(join(directory, 'settings.json'), text)
    await run('install', directory)
    const updated = await readSettings(directory)
    expect(updated).toMatchObject({ theme: 'light', custom: { keep: true } })
    expect(updated.packages.slice(0, 2)).toEqual([external, 'npm:another-external-fixture'])
    expect(updated.packages).toHaveLength(3)
    const bundle = updated.packages[2]
    if (!Value.Check(StringSchema, bundle)) throw new Error('Missing bundle source')
    expect(resolve(directory, bundle)).toBe(repoRoot)
    const backup = (await readdir(directory)).find((name) => name.endsWith('.bak'))
    if (backup === undefined) throw new Error('Missing settings backup')
    expect(await readFile(join(directory, backup), 'utf8')).toBe(text)
    await run('install', directory)
    expect(await readSettings(directory)).toEqual(updated)
  }, 30_000)

  it('removes the bundle and legacy entries without removing external packages', async () => {
    const directory = await fixture()
    await writeFile(
      join(directory, 'settings.json'),
      JSON.stringify({
        theme: 'dark',
        packages: ['npm:external-fixture', repoRoot, join(repoRoot, 'packages/cloak')],
      }),
    )
    await run('remove', directory)
    expect(await readSettings(directory)).toEqual({
      theme: 'dark',
      packages: ['npm:external-fixture'],
    })
    await run('remove', directory)
    expect((await readSettings(directory)).packages).toEqual(['npm:external-fixture'])
  }, 30_000)

  it('creates isolated profiles with one repository source', async () => {
    const source = await fixture()
    const profile = await fixture()
    await writeFile(
      join(source, 'settings.json'),
      JSON.stringify({ theme: 'light', packages: [join(repoRoot, 'packages/ask')] }),
    )
    await run('profile', profile, source)
    expect(await readSettings(profile)).toMatchObject({
      theme: 'light',
      packages: [repoRoot],
      subagents: { disableBuiltins: true },
    })
    expect(await readSettings(source)).toEqual({
      theme: 'light',
      packages: [join(repoRoot, 'packages/ask')],
    })
  })

  it('rejects malformed package lists without changing settings', async () => {
    const directory = await fixture()
    const text = '{"theme":"light","packages":{"unexpected":true}}'
    await writeFile(join(directory, 'settings.json'), text)
    await expect(run('install', directory)).rejects.toMatchObject({ code: 1 })
    expect(await readFile(join(directory, 'settings.json'), 'utf8')).toBe(text)
    expect(await readdir(directory)).toEqual(['settings.json'])
  })
})
