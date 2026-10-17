import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  DefaultPackageManager,
  DefaultResourceLoader,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { afterEach, describe, expect, it } from 'vite-plus/test'

const repoRoot = resolve(import.meta.dirname, '..')
const roots: string[] = []
const ManifestSchema = Type.Object(
  {
    pi: Type.Object({
      extensions: Type.Array(Type.String()),
      skills: Type.Array(Type.String()),
      prompts: Type.Array(Type.String()),
      themes: Type.Array(Type.String()),
    }),
  },
  { additionalProperties: true },
)

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'pi-bundle-discovery-'))
  roots.push(directory)
  const agentDir = join(directory, 'agent')
  const settingsManager = SettingsManager.inMemory()
  const manager = new DefaultPackageManager({ cwd: directory, agentDir, settingsManager })
  return { directory, agentDir, settingsManager, manager }
}

async function manifest() {
  const value: unknown = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
  return Value.Decode(ManifestSchema, value)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('repository Pi resource bundle', () => {
  it('resolves exactly the resources from all individual workspace manifests with Pi 1.1', async () => {
    const { manager } = await fixture()
    const packages = (await readdir(join(repoRoot, 'packages'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
      .map((entry) => join(repoRoot, 'packages', entry.name))
    const bundle = await manager.resolveExtensionSources([repoRoot], { temporary: true })
    const individual = await manager.resolveExtensionSources(packages, { temporary: true })
    for (const kind of ['extensions', 'skills', 'prompts', 'themes'] as const) {
      expect(
        bundle[kind]
          .filter((entry) => entry.enabled)
          .map((entry) => entry.path)
          .sort(),
      ).toEqual(
        individual[kind]
          .filter((entry) => entry.enabled)
          .map((entry) => entry.path)
          .sort(),
      )
    }
    expect(bundle.extensions).toHaveLength(packages.length)
    expect(
      bundle.extensions.some((entry) => entry.path.endsWith('/background-commands/src/index.ts')),
    ).toBe(true)
    expect(new Set(bundle.extensions.map((entry) => entry.path)).size).toBe(
      bundle.extensions.length,
    )
  })

  it('discovers newly added standard packages on the next resolution without changing settings', async () => {
    const { directory, manager } = await fixture()
    const bundleManifest = await manifest()
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ name: 'fixture-bundle', pi: bundleManifest.pi }),
    )
    const before = await manager.resolveExtensionSources([directory], { temporary: true })
    expect(before.extensions).toEqual([])
    const entry = join(directory, 'packages/future/src/index.ts')
    const skill = join(directory, 'packages/future/skills/future/SKILL.md')
    await mkdir(join(directory, 'packages/future/src'), { recursive: true })
    await mkdir(join(directory, 'packages/future/skills/future'), { recursive: true })
    await writeFile(entry, 'export default function () {}\n')
    await writeFile(skill, '---\nname: future\ndescription: Future fixture\n---\nFuture skill\n')
    const after = await manager.resolveExtensionSources([directory], { temporary: true })
    expect(after.extensions.map((resource) => resource.path)).toEqual([entry])
    expect(after.skills.map((resource) => resource.path)).toEqual([skill])
  })

  it('loads the aggregate extension factories and skills without duplicate or bootstrap errors', async () => {
    const { directory, agentDir, manager } = await fixture()
    const expected = await manager.resolveExtensionSources([repoRoot], { temporary: true })
    const resourceLoader = new DefaultResourceLoader({
      cwd: directory,
      agentDir,
      settingsManager: SettingsManager.inMemory({ packages: [repoRoot] }),
      noContextFiles: true,
      noPromptTemplates: true,
      noThemes: true,
    })
    await resourceLoader.reload()
    const loaded = resourceLoader.getExtensions()
    expect(loaded.errors).toEqual([])
    expect(
      loaded.extensions
        .filter((entry) => entry.path.startsWith(join(repoRoot, 'packages')))
        .map((entry) => entry.path)
        .sort(),
    ).toEqual(expected.extensions.map((entry) => entry.path).sort())
    const skills = resourceLoader.getSkills()
    expect(skills.diagnostics.filter((diagnostic) => diagnostic.type === 'error')).toEqual([])
    expect(skills.skills.map((skill) => skill.name)).toContain('poteto-mode')
    expect(skills.skills.map((skill) => skill.name)).toContain('loop')
  }, 30_000)
})
