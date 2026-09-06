import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { SessionManager } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { createChildSessionManager } from '../../subagent/src/child.ts'
import { SessionHistoryStore } from '../src/sessions.ts'

const directories: string[] = []
const git = promisify(execFile)

function sessionFile(manager: SessionManager): string {
  const path = manager.getSessionFile()
  if (path === undefined) throw new Error('Expected a persistent session.')
  return path
}

function recordActivity(manager: SessionManager, toolName = 'read'): string {
  manager.appendMessage({ role: 'user', content: 'child audit evidence', timestamp: 1 })
  const entryId = manager.appendMessage({
    role: 'assistant',
    content: [
      { type: 'toolCall', id: 'audit-call', name: toolName, arguments: { path: 'file.txt' } },
    ],
    api: 'openai-responses',
    provider: 'fixture',
    model: 'fixture',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'toolUse',
    timestamp: 2,
  })
  manager.appendMessage({
    role: 'toolResult',
    toolCallId: 'audit-call',
    toolName,
    content: [{ type: 'text', text: 'child audit evidence' }],
    isError: false,
    timestamp: 3,
  })
  return entryId
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'child-history-'))
  directories.push(root)
  const project = join(root, 'project')
  await mkdir(project)
  await initializeRepository(project)
  const parent = SessionManager.create(project, join(root, 'sessions'))
  recordActivity(parent)
  const managed = join(project, '.git', 'pi-subagent', 'worktrees', 'workspace', 'root')
  return { root, project, parent, managed }
}

async function initializeRepository(project: string): Promise<void> {
  await git('git', ['init', '-q', project])
  await git('git', [
    '-C',
    project,
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-qm',
    'fixture',
    '--allow-empty',
  ])
}

function linkedChild(parent: SessionManager, cwd: string): SessionManager {
  const child = createChildSessionManager({ sessionManager: parent }, cwd, undefined)
  recordActivity(child, 'write')
  return child
}

async function expectHidden(store: SessionHistoryStore, child: SessionManager) {
  const id = child.getSessionId()
  expect((await store.execute({ action: 'list', include_children: true })).data).not.toContainEqual(
    expect.objectContaining({ sessionId: id }),
  )
  const actions: Array<'read' | 'timeline' | 'tool_activity'> = [
    'read',
    'timeline',
    'tool_activity',
  ]
  for (const action of actions) {
    await expect(store.execute({ action, session_id: id })).rejects.toMatchObject({
      code: expect.stringMatching(/^(OUT_OF_SCOPE|MALFORMED_SESSION)$/u),
    })
  }
  await expect(
    store.execute({
      action: 'search',
      query: 'evidence',
      session_ids: [id],
      include_children: true,
    }),
  ).rejects.toMatchObject({ code: expect.stringMatching(/^(OUT_OF_SCOPE|MALFORMED_SESSION)$/u) })
  await expect(
    store.readContent({ session_id: id, entry_id: child.getEntries()[0]?.id ?? '' }),
  ).rejects.toMatchObject({ code: expect.stringMatching(/^(OUT_OF_SCOPE|MALFORMED_SESSION)$/u) })
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('SDK child history in a custom session store', () => {
  it.each(['managed-owner', 'linked-root'])(
    'audits managed sibling descendants from a %s with a gitfile',
    async (mode) => {
      const state = await fixture()
      const ownerCwd = mode === 'managed-owner' ? state.managed : join(state.root, 'linked-root')
      const childCwd = join(dirname(dirname(state.managed)), 'child', 'root')
      const siblingCwd = join(dirname(dirname(state.managed)), 'unrelated', 'root')
      for (const cwd of [ownerCwd, childCwd, siblingCwd]) {
        await git('git', ['-C', state.project, 'worktree', 'add', '--detach', cwd])
      }
      expect((await stat(join(ownerCwd, '.git'))).isFile()).toBe(true)
      const owner =
        mode === 'managed-owner'
          ? linkedChild(state.parent, ownerCwd)
          : SessionManager.create(ownerCwd, state.parent.getSessionDir())
      if (mode === 'linked-root') recordActivity(owner)
      const child = linkedChild(owner, childCwd)
      const unrelated = linkedChild(state.parent, siblingCwd)
      const orphan = SessionManager.create(ownerCwd, owner.getSessionDir(), {
        parentSession: join(owner.getSessionDir(), 'missing.jsonl'),
      })
      recordActivity(orphan)
      const orphanChild = linkedChild(orphan, siblingCwd)
      const store = new SessionHistoryStore(owner)
      const audit = async () => {
        expect(
          (await store.execute({ action: 'tool_activity', session_id: child.getSessionId() })).data,
        ).toEqual([
          expect.objectContaining({
            sessionId: child.getSessionId(),
            parentSessionId: owner.getSessionId(),
            status: 'completed',
          }),
        ])
        expect(
          (
            await store.execute({
              action: 'timeline',
              session_id: owner.getSessionId(),
              include_children: true,
            })
          ).data,
        ).toContainEqual(
          expect.objectContaining({ type: 'child_session', sessionId: child.getSessionId() }),
        )
        await expectHidden(store, unrelated)
        await expectHidden(store, orphanChild)
      }
      await audit()
      await git('git', ['-C', state.project, 'worktree', 'remove', childCwd])
      await audit()
      if (mode === 'managed-owner') {
        await git('git', ['-C', state.project, 'worktree', 'remove', ownerCwd])
        expect(
          (
            await new SessionHistoryStore(state.parent).execute({
              action: 'tool_activity',
              session_id: child.getSessionId(),
            })
          ).data,
        ).toHaveLength(1)
      }
    },
  )

  it('does not use inherited Git directory selectors to widen the managed boundary', async () => {
    const state = await fixture()
    const foreign = await fixture()
    const child = linkedChild(state.parent, state.managed)
    const unrelated = linkedChild(state.parent, foreign.managed)
    vi.stubEnv('GIT_DIR', join(foreign.project, '.git'))
    vi.stubEnv('GIT_COMMON_DIR', join(foreign.project, '.git'))
    vi.stubEnv('GIT_WORK_TREE', foreign.project)
    const store = new SessionHistoryStore(state.parent)
    expect(
      (await store.execute({ action: 'tool_activity', session_id: child.getSessionId() })).data,
    ).toHaveLength(1)
    await expectHidden(store, unrelated)
  })

  it('fails closed for managed paths without resolvable Git metadata', async () => {
    const state = await fixture()
    await rm(join(state.project, '.git'), { force: true, recursive: true })
    const child = linkedChild(state.parent, state.managed)
    const store = new SessionHistoryStore(state.parent)
    await expectHidden(store, child)
    expect(
      (await store.execute({ action: 'read', session_id: state.parent.getSessionId() })).data,
    ).not.toHaveLength(0)
  })

  it.each(['readonly', 'mutable'])('audits a %s child and its descendants', async (mode) => {
    const state = await fixture()
    if (mode === 'mutable') {
      await git('git', ['-C', state.project, 'worktree', 'add', '--detach', state.managed])
    }
    const child = createChildSessionManager(
      { sessionManager: state.parent },
      mode === 'readonly' ? state.project : state.managed,
      undefined,
    )
    const entryId = recordActivity(child, mode === 'readonly' ? 'read' : 'write')
    const grandchild = linkedChild(child, state.managed)
    expect(child.getSessionDir()).toBe(state.parent.getSessionDir())
    expect(child.getHeader()?.parentSession).toBe(sessionFile(state.parent))
    const store = new SessionHistoryStore(state.parent)
    const audit = async () => {
      const activity = await store.execute({
        action: 'tool_activity',
        session_id: child.getSessionId(),
      })
      expect(activity.data).toEqual([
        expect.objectContaining({
          sessionId: child.getSessionId(),
          parentSessionId: state.parent.getSessionId(),
          mainSessionId: state.parent.getSessionId(),
          toolName: mode === 'readonly' ? 'read' : 'write',
          status: 'completed',
          result: 'child audit evidence',
        }),
      ])
      expect((await store.execute({ action: 'list' })).data).toEqual([])
      expect((await store.execute({ action: 'list', include_children: true })).data).toHaveLength(2)
      expect(
        (await store.execute({ action: 'search', query: 'evidence', include_children: true })).data,
      ).toHaveLength(4)
      expect(
        (await store.execute({ action: 'read', session_id: child.getSessionId() })).data,
      ).not.toHaveLength(0)
      expect(
        (
          await store.readContent({
            session_id: child.getSessionId(),
            entry_id: entryId,
            include_tool_payloads: true,
          })
        ).data[0].content,
      ).toContain('file.txt')
      expect(
        (
          await store.execute({
            action: 'timeline',
            session_id: state.parent.getSessionId(),
            include_children: true,
          })
        ).data,
      ).toContainEqual(
        expect.objectContaining({ type: 'child_session', sessionId: grandchild.getSessionId() }),
      )
      expect(
        (
          await store.execute({
            action: 'tool_activity',
            session_id: state.parent.getSessionId(),
            include_children: true,
          })
        ).data,
      ).toHaveLength(3)
    }
    await audit()
    if (mode === 'mutable') {
      await git('git', ['-C', state.project, 'worktree', 'remove', state.managed])
      await audit()
    }
  })

  it('preserves the resume file, identity, parent header, and original store', async () => {
    const state = await fixture()
    const oldStore = join(state.root, 'old-sessions')
    const old = SessionManager.create(state.managed, oldStore, {
      parentSession: sessionFile(state.parent),
    })
    recordActivity(old)
    const before = await readFile(sessionFile(old), 'utf8')
    const resumed = createChildSessionManager(
      { sessionManager: state.parent },
      state.project,
      sessionFile(old),
    )
    expect(resumed.getSessionId()).toBe(old.getSessionId())
    expect(resumed.getSessionFile()).toBe(sessionFile(old))
    expect(resumed.getSessionDir()).toBe(oldStore)
    expect(resumed.getCwd()).toBe(state.project)
    expect(resumed.getHeader()?.parentSession).toBe(sessionFile(state.parent))
    expect(await readFile(sessionFile(old), 'utf8')).toBe(before)
    await expectHidden(new SessionHistoryStore(state.parent), old)
  })

  it('keeps unrelated projects and forged managed-worktree lookalikes invisible', async () => {
    const state = await fixture()
    const store = new SessionHistoryStore(state.parent)
    const paths = [
      join(state.root, 'other-project'),
      join(state.project, 'ordinary-subdirectory'),
      join(state.project, '.git', 'pi-subagent', 'worktrees-other', 'workspace', 'root'),
      join(state.project, '.git', 'pi-subagent', 'worktrees', 'root'),
      join(state.project, '.git', 'pi-subagent', 'worktrees', 'workspace', 'not-root'),
    ]
    for (const path of paths) await expectHidden(store, linkedChild(state.parent, path))
    const traversal = linkedChild(state.parent, state.managed)
    await writeFile(
      sessionFile(traversal),
      (await readFile(sessionFile(traversal), 'utf8')).replace(
        JSON.stringify(state.managed),
        JSON.stringify(`${state.managed}/../root`),
      ),
    )
    await expectHidden(store, traversal)
    const unlinked = SessionManager.create(state.managed, state.parent.getSessionDir())
    recordActivity(unlinked)
    await expectHidden(store, unlinked)
  })

  it('rejects symlink escapes, including removed descendants and broken links', async () => {
    const state = await fixture()
    const other = join(state.root, 'other-project')
    await mkdir(other)
    await mkdir(dirname(state.managed), { recursive: true })
    await symlink(other, state.managed)
    const child = linkedChild(state.parent, state.managed)
    const removedDescendant = linkedChild(state.parent, join(state.managed, 'removed'))
    const store = new SessionHistoryStore(state.parent)
    await expectHidden(store, child)
    await expectHidden(store, removedDescendant)
    await rm(other, { recursive: true })
    await expectHidden(store, child)
    await expectHidden(store, removedDescendant)
  })

  it('resolves project and parent-store aliases after worktree cleanup', async () => {
    const state = await fixture()
    const projectAlias = join(state.root, 'project-alias')
    const storeAlias = join(state.root, 'store-alias')
    await symlink(state.project, projectAlias)
    await symlink(state.parent.getSessionDir(), storeAlias)
    const child = SessionManager.create(
      join(projectAlias, '.git', 'pi-subagent', 'worktrees', 'removed', 'root'),
      state.parent.getSessionDir(),
      { parentSession: join(storeAlias, basename(sessionFile(state.parent))) },
    )
    recordActivity(child)
    expect(
      (
        await new SessionHistoryStore(state.parent).execute({
          action: 'tool_activity',
          session_id: child.getSessionId(),
        })
      ).data,
    ).toHaveLength(1)
  })

  it('requires every ancestor to resolve inside the store and reach a project root', async () => {
    const state = await fixture()
    const store = new SessionHistoryStore(state.parent)
    const missingParent = SessionManager.create(state.managed, state.parent.getSessionDir(), {
      parentSession: join(state.parent.getSessionDir(), 'missing.jsonl'),
    })
    recordActivity(missingParent)
    await expectHidden(store, missingParent)
    await expectHidden(store, linkedChild(missingParent, state.managed))
    const orphan = SessionManager.create(state.project, state.parent.getSessionDir(), {
      parentSession: join(state.root, 'missing.jsonl'),
    })
    recordActivity(orphan)
    expect(
      (await store.execute({ action: 'read', session_id: orphan.getSessionId() })).data,
    ).not.toHaveLength(0)
    await expectHidden(store, linkedChild(orphan, state.managed))
    const externalParent = SessionManager.create(
      state.project,
      join(state.root, 'external-store'),
      {
        id: state.parent.getSessionId(),
      },
    )
    recordActivity(externalParent)
    const externalChild = SessionManager.create(state.managed, state.parent.getSessionDir(), {
      parentSession: sessionFile(externalParent),
    })
    recordActivity(externalChild)
    await expectHidden(store, externalChild)
    const foreignParent = linkedChild(state.parent, join(state.root, 'other-project'))
    await expectHidden(store, linkedChild(foreignParent, state.managed))
  })

  it('quarantines duplicate ancestry, cycles, and dependent managed children', async () => {
    const state = await fixture()
    const child = linkedChild(state.parent, state.managed)
    const grandchild = linkedChild(child, state.managed)
    const store = new SessionHistoryStore(state.parent)
    await writeFile(
      join(state.parent.getSessionDir(), 'duplicate.jsonl'),
      await readFile(sessionFile(child), 'utf8'),
    )
    await expectHidden(store, child)
    await expectHidden(store, grandchild)
    await rm(join(state.parent.getSessionDir(), 'duplicate.jsonl'))
    const original = await readFile(sessionFile(child), 'utf8')
    await writeFile(
      sessionFile(child),
      original.replace(
        JSON.stringify(sessionFile(state.parent)),
        JSON.stringify(sessionFile(grandchild)),
      ),
    )
    await expectHidden(store, child)
    await expectHidden(store, grandchild)
    await writeFile(
      sessionFile(child),
      original.replace(
        JSON.stringify(sessionFile(state.parent)),
        JSON.stringify(sessionFile(child)),
      ),
    )
    await expectHidden(store, child)
    await expectHidden(store, grandchild)
    await writeFile(sessionFile(child), original)
    expect(
      (await store.execute({ action: 'tool_activity', session_id: grandchild.getSessionId() }))
        .data,
    ).toHaveLength(1)
    await rm(sessionFile(child))
    await expectHidden(store, grandchild)
  })

  it('rejects a counterfeit live-parent identity in another transcript', async () => {
    const state = await fixture()
    await rm(sessionFile(state.parent))
    const counterfeit = SessionManager.create(state.managed, state.parent.getSessionDir(), {
      id: state.parent.getSessionId(),
    })
    recordActivity(counterfeit)
    const path = join(state.parent.getSessionDir(), 'counterfeit.jsonl')
    await rename(sessionFile(counterfeit), path)
    const child = linkedChild(SessionManager.open(path), state.managed)
    await expectHidden(new SessionHistoryStore(state.parent), child)
  })

  it('does not inspect symlinked files or crawl other session directories', async () => {
    const state = await fixture()
    const external = SessionManager.create(state.managed, join(state.root, 'external-store'), {
      parentSession: sessionFile(state.parent),
    })
    recordActivity(external)
    await symlink(sessionFile(external), join(state.parent.getSessionDir(), 'external.jsonl'))
    await symlink(
      dirname(sessionFile(external)),
      join(state.parent.getSessionDir(), 'directory.jsonl'),
    )
    const inspected: string[] = []
    const store = new SessionHistoryStore(state.parent, async (path) => {
      inspected.push(path)
      return stat(path)
    })
    await expectHidden(store, external)
    expect(new Set(inspected)).toEqual(new Set([sessionFile(state.parent)]))
  })
})
