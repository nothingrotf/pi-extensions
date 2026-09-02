import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vite-plus/test'

import { SubagentResolver } from '../src/agents.ts'

const roots: string[] = []

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'subagent-resolver-'))
  roots.push(path)
  return path
}

async function agentFile(
  base: string,
  directory: '.agents' | '.pi',
  name: string,
  prompt: string,
): Promise<string> {
  const agents = join(base, directory, 'agents')
  await mkdir(agents, { recursive: true })
  const path = join(agents, `${name}.md`)
  await writeFile(path, `---\ndescription: ${name}\n---\n${prompt}`)
  return path
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (path) => rm(path, { force: true, recursive: true })))
})

describe('SubagentResolver', () => {
  it('uses the nearest project definition before extension definitions', async () => {
    const base = await root()
    const nested = join(base, 'nested')
    await mkdir(nested)
    await agentFile(base, '.pi', 'reviewer', 'root prompt')
    await agentFile(nested, '.pi', 'reviewer', 'nested prompt')
    const resolver = new SubagentResolver()
    resolver.register('extension', [
      {
        description: 'extension reviewer',
        name: 'reviewer',
        systemPrompt: 'extension prompt',
      },
    ])

    const definition = await resolver.resolve('reviewer', nested)
    expect(definition?.systemPrompt).toBe('nested prompt')
    expect(definition?.source.kind).toBe('project')
  })

  it('uses project definitions before user definitions', async () => {
    const base = await root()
    const project = join(base, 'project')
    const userAgents = join(base, 'user-definitions')
    await mkdir(project)
    await mkdir(userAgents)
    await writeFile(
      join(userAgents, 'shared.md'),
      '---\ndescription: user definition\n---\nuser prompt',
    )
    const resolver = new SubagentResolver([userAgents])
    expect((await resolver.resolve('shared', project))?.source.kind).toBe('user')

    await agentFile(project, '.pi', 'shared', 'project prompt')
    resolver.invalidateCache()
    const projectDefinition = await resolver.resolve('shared', project)
    expect(projectDefinition?.source.kind).toBe('project')
    expect(projectDefinition?.systemPrompt).toBe('project prompt')
  })

  it('discovers compatible Claude agent files', async () => {
    const base = await root()
    const agents = join(base, '.claude', 'agents')
    await mkdir(agents, { recursive: true })
    await writeFile(join(agents, 'claude-agent.md'), '---\ndescription: Claude agent\n---\nprompt')
    expect((await new SubagentResolver().resolve('claude-agent', base))?.systemPrompt).toBe(
      'prompt',
    )
  })

  it('reads the background default from agent frontmatter', async () => {
    const base = await root()
    const path = await agentFile(base, '.pi', 'background-agent', 'prompt')
    await writeFile(path, '---\ndescription: Background agent\nis_background: true\n---\nprompt')
    expect((await new SubagentResolver().resolve('background-agent', base))?.is_background).toBe(
      true,
    )
  })

  it('canonicalizes symlinked agent files', async () => {
    const base = await root()
    const target = join(base, 'target.md')
    await writeFile(target, '---\ndescription: linked\n---\nlinked prompt')
    const agents = join(base, '.pi', 'agents')
    await mkdir(agents, { recursive: true })
    await symlink(target, join(agents, 'linked.md'))

    const definition = await new SubagentResolver().resolve('linked', base)
    expect(definition?.source).toEqual({ kind: 'project', path: await realpath(target) })
  })

  it('rejects collisions and invalid frontmatter', async () => {
    const base = await root()
    await agentFile(base, '.pi', 'collision', 'one')
    await agentFile(base, '.agents', 'collision', 'two')
    await agentFile(base, '.pi', 'invalid', 'prompt')
    await writeFile(
      join(base, '.pi', 'agents', 'invalid.md'),
      '---\ndescription: invalid\nextra: value\n---\nprompt',
    )
    const resolver = new SubagentResolver()

    await expect(resolver.resolve('collision', base)).rejects.toThrow(
      'duplicate project definitions',
    )
    await expect(resolver.resolve('invalid', base)).rejects.toThrow('frontmatter is invalid')
  })

  it('does not fall back after an invalid winning project definition', async () => {
    const base = await root()
    const path = await agentFile(base, '.pi', 'winner', 'prompt')
    await writeFile(path, '---\ndescription: winner\nextra: invalid\n---\nprompt')
    const resolver = new SubagentResolver()
    resolver.register('fallback', [
      { description: 'fallback', name: 'winner', systemPrompt: 'fallback prompt' },
    ])
    await expect(resolver.resolve('winner', base)).rejects.toThrow('frontmatter is invalid')
  })

  it('rejects empty bodies, declared-name mismatches, and extension collisions', async () => {
    const base = await root()
    const empty = await agentFile(base, '.pi', 'empty', 'prompt')
    await writeFile(empty, '---\ndescription: empty\n---\n')
    const mismatch = await agentFile(base, '.pi', 'expected', 'prompt')
    await writeFile(mismatch, '---\nname: different\ndescription: mismatch\n---\nprompt')
    const resolver = new SubagentResolver()
    resolver.register('first', [
      { description: 'first', name: 'extension-collision', systemPrompt: 'first' },
    ])
    resolver.register('second', [
      { description: 'second', name: 'extension-collision', systemPrompt: 'second' },
    ])

    await expect(resolver.resolve('empty', base)).rejects.toThrow('no prompt body')
    await expect(resolver.resolve('expected', base)).rejects.toThrow('declares name "different"')
    await expect(resolver.resolve('extension-collision', base)).rejects.toThrow(
      'duplicate extension definitions',
    )
  })

  it('reports unreadable agent files', async () => {
    const base = await root()
    const path = await agentFile(base, '.pi', 'private', 'prompt')
    await chmod(path, 0)
    try {
      await expect(new SubagentResolver().resolve('private', base)).rejects.toThrow(
        /EACCES|permission denied/,
      )
    } finally {
      await chmod(path, 0o600)
    }
  })

  it('reports unreadable agent directories', async () => {
    const base = await root()
    const agents = join(base, '.pi', 'agents')
    await mkdir(agents, { recursive: true })
    await chmod(agents, 0)
    try {
      await expect(new SubagentResolver().resolve('private', base)).rejects.toThrow(
        'Agent directory is unreadable',
      )
    } finally {
      await chmod(agents, 0o700)
    }
  })

  it('rejects oversized agent files', async () => {
    const base = await root()
    const agents = join(base, '.pi', 'agents')
    await mkdir(agents, { recursive: true })
    await writeFile(join(agents, 'large.md'), 'x'.repeat(256 * 1024 + 1))
    await expect(new SubagentResolver().resolve('large', base)).rejects.toThrow(
      'Agent file exceeds 262144 bytes',
    )
  })

  it('keeps cached misses until explicit invalidation', async () => {
    const base = await root()
    const resolver = new SubagentResolver()
    expect(await resolver.resolve('late', base)).toBeUndefined()
    await agentFile(base, '.pi', 'late', 'late prompt')
    expect(await resolver.resolve('late', base)).toBeUndefined()
    resolver.invalidateCache()
    expect((await resolver.resolve('late', base))?.systemPrompt).toBe('late prompt')
  })

  it('invalidates the cache when extension definitions change', async () => {
    const base = await root()
    const resolver = new SubagentResolver()
    expect(await resolver.resolve('extension-agent', base)).toBeUndefined()
    const unregister = resolver.register('source', [
      {
        description: 'extension agent',
        name: 'extension-agent',
        systemPrompt: 'extension prompt',
      },
    ])
    expect((await resolver.resolve('extension-agent', base))?.systemPrompt).toBe('extension prompt')
    unregister()
    expect(await resolver.resolve('extension-agent', base)).toBeUndefined()
  })
})
