import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vite-plus/test'

import { loadPstackBootstrap } from '../src/bootstrap.ts'
import { pstackRoles } from '../src/model-policy.ts'
import { readLivePolicy } from './live-policy.js'
import {
  child,
  harness,
  initializeRepository,
  invoke,
  lastToolResult,
  policyInput,
  todoIds,
} from './sdk-harness.js'

describe('pstack SDK child bootstrap', () => {
  it.each([true, false])(
    'scopes root policy to explicit pstack activation in either load order (%s)',
    async (first) => {
      const h = await harness(first, new Map(), 'how explorer: pstack-test/configured:off')
      try {
        const prompt = h.inventories.find((entry) => entry.action === 'seed:parent').prompt
        expect(prompt).toContain('Pstack is opt-in, not the default workflow.')
        expect(prompt).toContain(
          'Only activate it when the user invokes poteto-mode or explicitly requests a pstack workflow.',
        )
        expect(prompt).toContain(
          'Ordinary coding requests, task complexity, and available tools do not authorize activation.',
        )
        expect(prompt).toContain(
          'Mentioning pstack in logs, examples, or a bug report is not an activation request.',
        )
        expect(prompt).toContain(
          'Without activation, do not open pstack deliveries or select pstack capability profiles.',
        )
        expect(prompt.indexOf('# Pstack activation')).toBeLessThan(
          prompt.indexOf('# Pstack runtime model policy'),
        )
        expect(h.runtime.listSnapshots()).toEqual([])
      } finally {
        await h.close()
      }
    },
  )

  it.each([true, false])(
    'applies configured omitted-model policy through runtime (%s)',
    async (first) => {
      const h = await harness(
        first,
        new Map(),
        '---\ndescription: RAW_METADATA_SENTINEL\nalwaysApply: true\n---\n# RAW_COMMENT_SENTINEL\nhow explorer: pstack-test/configured:off\n',
      )
      try {
        const result = await h.runtime.run({
          ctx: h.ctx,
          input: {
            description: 'Configured explorer',
            prompt: 'read:configured',
            role: 'how explorer',
            capability_profile: 'pstack-leaf',
            subagent_type: 'generalPurpose',
            readonly: true,
            run_in_background: false,
          },
        })
        expect(result.kind).toBe('completed')
        expect(h.inventories.find((entry) => entry.action === 'read:configured').model).toBe(
          'pstack-test/configured',
        )
        expect(h.inventories.find((entry) => entry.action === 'read:configured').tools).toContain(
          'codemode',
        )
        expect(
          h.inventories.find((entry) => entry.action === 'read:configured').tools,
        ).not.toContain('bash')
        expect(h.inventories.find((entry) => entry.action === 'seed:parent').prompt).toContain(
          'how explorer: pstack-test/configured:off',
        )
        expect(h.inventories.find((entry) => entry.action === 'seed:parent').prompt).not.toContain(
          'RAW_METADATA_SENTINEL',
        )
        expect(h.inventories.find((entry) => entry.action === 'seed:parent').prompt).not.toContain(
          'RAW_COMMENT_SENTINEL',
        )
      } finally {
        await h.close()
      }
    },
  )

  it.each([true, false])(
    'registers defaults in either extension load order (%s), with repeat discovery',
    async (pstackFirst) => {
      const h = await harness(pstackFirst)
      try {
        for (let repeat = 0; repeat < 2; repeat += 1) {
          h.api.events.emit('@nothingrotf/subagent/discover-capabilities', { version: 1 })
          h.api.events.emit('@nothingrotf/subagent/discover-capability-profiles', { version: 1 })
          h.api.events.emit('@nothingrotf/subagent/discover-agents', { version: 1 })
        }
        const result = await h.runtime.run({
          ctx: h.ctx,
          input: {
            description: 'Leaf default',
            role: 'feature',
            prompt: 'seed:leaf',
            subagent_type: 'poteto-agent',
            model: 'pstack-test/model',
            readonly: true,
            run_in_background: false,
          },
        })
        expect(result.kind).toBe('completed')
        const inventory = h.inventories.find((entry) => entry.action === 'seed:leaf')
        expect(inventory.tools).toEqual(
          expect.arrayContaining(['todo_read', 'todo_write', 'request_parent']),
        )
        expect(inventory.tools).not.toContain('Task')
        expect(inventory.tools).not.toContain('write')
        const bootstrap = await loadPstackBootstrap()
        expect(inventory.prompt).toContain(`${bootstrap.root}/poteto-mode/SKILL.md`)
        expect(inventory.prompt).toContain('principle-prove-it-works/SKILL.md')
        expect(inventory.prompt).toContain(
          'Resolve every skill pointer below against that canonical base',
        )
        expect(inventory.prompt).toContain(`${bootstrap.root}/poteto-mode/references/worker.md`)
        expect(inventory.prompt).toContain('ask_parent is advisory only')
        expect(inventory.prompt).not.toContain('{{PSTACK_SKILLS_ROOT}}')
        await h.session.prompt('read:parent')
        expect(todoIds(h.session)).toEqual(['parent'])
      } finally {
        await h.close()
      }
    },
  )

  it.each([{ tools: [] }, { tools: ['read'] }, { tools: ['read', 'todo_read'] }])(
    'honors the full explicit tool allowlist $tools without dropping canonical bootstrap',
    async ({ tools }) => {
      const h = await harness(true)
      try {
        const result = await h.runtime.run({
          ctx: h.ctx,
          input: {
            description: 'Explicit tools',
            role: 'why synthesizer',
            prompt: 'read:restricted',
            subagent_type: 'poteto-agent',
            tools,
            model: 'pstack-test/model',
            readonly: true,
            run_in_background: false,
          },
        })
        expect(result.kind).toBe('completed')
        const inventory = h.inventories.find((entry) => entry.action === 'read:restricted')
        expect(inventory.tools).toEqual([
          ...tools,
          'ask_parent',
          'notify_parent',
          'update_progress',
          'request_parent',
        ])
        expect(inventory.prompt).toContain((await loadPstackBootstrap()).root)
        expect(result.details.role).toBe('why synthesizer')
        const resumed = await h.runtime.run({
          ctx: h.ctx,
          input: {
            description: 'Resume restricted tools',
            prompt: 'read:resumed-restricted',
            resume: result.details.agentId,
            subagent_type: 'poteto-agent',
            tools,
            run_in_background: false,
          },
        })
        expect(resumed.kind).toBe('completed')
        expect(resumed.details.role).toBe('why synthesizer')
        expect(
          h.inventories.find((entry) => entry.action === 'read:resumed-restricted').tools,
        ).toEqual(inventory.tools)
        const widened = await h.runtime.run({
          ctx: h.ctx,
          input: {
            description: 'Reject expanded tools',
            prompt: 'read:expanded',
            resume: result.details.agentId,
            subagent_type: 'poteto-agent',
            tools: [...tools, 'todo_write'],
          },
        })
        expect(widened.kind).toBe('failed')
        expect(widened.details.error).toContain('not permitted')
        expect(h.inventories.some((entry) => entry.action === 'read:expanded')).toBe(false)
      } finally {
        await h.close()
      }
    },
  )

  it('does not grant unapproved planning tools to generic agents', async () => {
    const h = await harness(true)
    try {
      const result = await h.runtime.run({
        ctx: h.ctx,
        input: {
          description: 'Unapproved tool',
          prompt: 'read:generic',
          subagent_type: 'generalPurpose',
          tools: ['read', 'todo_read'],
          model: 'pstack-test/model',
          readonly: true,
          run_in_background: false,
        },
      })
      expect(result.kind).toBe('failed')
    } finally {
      await h.close()
    }
  })

  it('keeps a real nested owner equipped for planning and delegation', async () => {
    const h = await harness(true)
    try {
      const result = await h.runtime.run({
        ctx: h.ctx,
        input: {
          description: 'Nested owner',
          role: 'hardest tasks',
          prompt: 'seed:owner',
          subagent_type: 'generalPurpose',
          capability_profile: 'pstack-nested',
          model: 'pstack-test/model',
          readonly: true,
          run_in_background: false,
        },
      })
      expect(result.kind).toBe('completed')
      const inventory = h.inventories.find((entry) => entry.action === 'seed:owner')
      expect(inventory.tools).toEqual(
        expect.arrayContaining(['Task', 'todo_write', 'todo_read', 'request_parent']),
      )
      expect(inventory.tools).not.toContain('bash')
      expect(inventory.tools).not.toContain('write')
    } finally {
      await h.close()
    }
  })

  it('isolates parent, sibling, readonly and nested planning and restores only its own transcript', async () => {
    const h = await harness(true)
    const sessions = []
    try {
      const firstManager = SessionManager.create(h.dir, join(h.dir, 'sessions'))
      for (const [id, profile, readonly] of [
        ['first', 'pstack-leaf', false],
        ['sibling', 'pstack-leaf', false],
        ['readonly', 'pstack-leaf', true],
        ['nested', 'pstack-nested', true],
      ]) {
        const options = { readonly }
        if (id === 'first') options.sessionManager = firstManager
        const session = await child(h, profile, options)
        sessions.push(session)
        await session.prompt(`read:${id}`)
        expect(todoIds(session)).toEqual([])
        await session.prompt(`seed:${id}`)
        expect(todoIds(session)).toEqual([id])
      }
      const first = sessions[0]
      await first.prompt('read:first')
      expect(todoIds(first)).toEqual(['first'])
      const transcript = first.sessionFile
      expect(transcript).toBeDefined()
      first.dispose()
      const resumed = await child(h, 'pstack-leaf', {
        resumeFile: transcript,
        sessionManager: SessionManager.open(transcript),
      })
      sessions.push(resumed)
      await resumed.prompt('read:resumed')
      expect(todoIds(resumed)).toEqual(['first'])
      await h.session.prompt('read:parent')
      expect(todoIds(h.session)).toEqual(['parent'])
      expect(h.registry.resolve('pstack-nested', true).contract.nested).toEqual({
        enabled: true,
        maxDepth: 3,
      })
      const generic = await child(h, undefined)
      sessions.push(generic)
      expect(generic.agent.state.tools.map((tool) => tool.name)).not.toContain('todo_write')
    } finally {
      for (const session of sessions) session.dispose()
      await h.close()
    }
  })

  it('uses canonical pointers despite a stale copy and exposes effective workspace without claiming a sandbox', async () => {
    const h = await harness(true)
    let session
    try {
      const stale = join(h.dir, '.Trash', 'pstack-raw', 'skills', 'poteto-mode')
      await mkdir(stale, { recursive: true })
      await writeFile(join(stale, 'SKILL.md'), 'STALE_BOOTSTRAP')
      session = await child(h, 'pstack-leaf', { sourceCwd: '/logical/source' })
      await session.prompt('read:canonical')
      const inventory = h.inventories.find((entry) => entry.action === 'read:canonical')
      const root = await realpath(fileURLToPath(new URL('../skills/', import.meta.url)))
      expect(inventory.prompt).toContain(`active pstack skill base path is ${root}`)
      expect(inventory.prompt).toContain(`Effective working directory: ${h.dir}`)
      expect(inventory.prompt).toContain('Logical source directory: /logical/source')
      expect(inventory.prompt).toContain('not an operating-system sandbox')
      const tool = session.agent.state.tools.find((entry) => entry.name === 'read')
      const result = await tool.execute('canonical-read', {
        path: join(root, 'poteto-mode', 'SKILL.md'),
      })
      expect(result.content[0].text).toContain('# Poteto mode')
      expect(result.content[0].text).not.toContain('STALE_BOOTSTRAP')
      expect(await readFile(join(stale, 'SKILL.md'), 'utf8')).toBe('STALE_BOOTSTRAP')
    } finally {
      session?.dispose()
      await h.close()
    }
  })
})

describe('pstack runtime model policy', () => {
  it.each(['code review', 'runtime verification', 'publication'])(
    'selects and retains the %s model through a role-compatible Task policy probe',
    async (role) => {
      const plans = new Map()
      const h = await harness(
        true,
        plans,
        [
          'judgment and prose: pstack-test/model:off',
          'arena cross-judge pool: pstack-test/configured:high, openai-codex/gpt-5.4:low',
        ].join('\n'),
      )
      try {
        if (role === 'runtime verification') await initializeRepository(h)
        const input = policyInput({ role })
        if (role !== 'publication') input.model = 'pstack-test/configured:high'
        const result = await invoke(h, plans, 'delivery-role', 'Task', input)
        expect(result.status).toBe('completed')
        expect(h.runtime.listSnapshots()).toHaveLength(1)
        expect(h.runtime.getRecord(result.agentId)).toMatchObject({
          role,
          model: role === 'publication' ? 'pstack-test/model' : 'pstack-test/configured',
          execution: { role, readonly: role !== 'runtime verification' },
        })
        expect(h.inventories.find((entry) => entry.action === 'read:policy').tools).not.toContain(
          'Task',
        )
        expect(
          h.inventories.find((entry) => entry.action === 'read:policy').tools.includes('bash'),
        ).toBe(role === 'runtime verification')
        const resumed = await invoke(h, plans, 'resume-delivery', 'Task', {
          description: 'Continue the same scoped delivery role',
          prompt: 'read:delivery-resumed',
          subagent_type: 'generalPurpose',
          resume: result.agentId,
          run_in_background: false,
        })
        expect(resumed.status).toBe('completed')
        expect(resumed.agentId).toBe(result.agentId)
        expect(h.runtime.getRecord(result.agentId).role).toBe(role)
        expect(h.runtime.listSnapshots()).toHaveLength(1)
      } finally {
        await h.close()
      }
    },
    180_000,
  )

  it('rejects a read-only runtime verifier before allocating a child', async () => {
    const h = await harness(true)
    try {
      const result = await h.runtime.run({
        ctx: h.ctx,
        input: policyInput({ role: 'runtime verification', readonly: true }),
      })
      expect(result.kind).toBe('failed')
      expect(result.details.error).toContain('requires unavailable effective tools: bash')
      expect(h.runtime.listSnapshots()).toEqual([])
    } finally {
      await h.close()
    }
  })

  it('captures missing live policy evidence and dispatches through the SDK', async () => {
    const h = await harness(true)
    try {
      expect(await readLivePolicy(join(h.dir, 'pstack-models.md'))).toBeNull()
      const result = await h.runtime.run({ ctx: h.ctx, input: policyInput() })
      expect(result.kind).toBe('completed')
      expect(h.runtime.getRecord(result.details.agentId).model).toBe('pstack-test/model')
      await expect(readLivePolicy(h.dir)).rejects.toMatchObject({ code: 'EISDIR' })
      await writeFile(join(h.dir, 'pstack-models.md'), 'feature: auto')
      expect(await readLivePolicy(join(h.dir, 'pstack-models.md'))).toBe('feature: auto')
    } finally {
      await h.close()
    }
  })

  it.each([
    ['role', { role: 'how explorerr' }, 'Unknown model policy role'],
    ['model', { model: 'pstack-test/missing:off' }, 'not available'],
    ['panel', { role: 'arena runners' }, 'distinct choices'],
  ])(
    'rejects a mixed-validity Task batch before child starts (%s)',
    async (_label, invalid, error) => {
      const plans = new Map()
      const h = await harness(
        true,
        plans,
        'arena runners: pstack-test/configured:high, inherit-parent',
      )
      try {
        const tasks = [{}, invalid].map((overrides, index) => {
          const { run_in_background: _background, ...input } = policyInput({
            id: `entry-${index}`,
            prompt: index === 0 ? 'read:valid-child' : 'read:invalid-child',
            ...overrides,
          })
          return input
        })
        plans.set('read:mixed-batch', [{ name: 'Task', arguments: { tasks } }])
        await h.session.prompt('read:mixed-batch')
        await h.session.agent.waitForIdle()
        const result = h.session.messages.findLast(
          (message) => message.role === 'toolResult' && message.toolName === 'Task',
        )
        expect(result.isError).toBe(true)
        expect(JSON.stringify(result.content)).toContain(error)
        expect(h.runtime.listSnapshots()).toEqual([])
        expect(
          h.inventories.filter((entry) =>
            ['read:valid-child', 'read:invalid-child'].includes(entry.action),
          ),
        ).toEqual([])
      } finally {
        await h.close()
      }
    },
  )

  it.each(pstackRoles)(
    'selects every documented role $role',
    async ({ role }) => {
      const h = await harness(true, new Map(), `${role}: pstack-test/configured:high`)
      try {
        if (role === 'runtime verification') await initializeRepository(h)
        const result = await h.runtime.run({ ctx: h.ctx, input: policyInput({ role }) })
        expect(result.kind, JSON.stringify(result)).toBe('completed')
        const record = h.runtime.getRecord(result.details.agentId)
        expect(record.model).toBe('pstack-test/configured')
        expect(record.effort).toBe('high')
        expect(h.inventories.find((entry) => entry.action === 'read:policy').prompt).toContain(
          `${role}: pstack-test/configured:high`,
        )
      } finally {
        await h.close()
      }
    },
    180_000,
  )

  it.each([
    [undefined, undefined, 'pstack-test/model', 'off', false],
    ['', undefined, 'pstack-test/model', 'off', false],
    ['bug-fix: pstack-test/configured:high', undefined, 'pstack-test/model', 'off', false],
    ['how explorer: auto', undefined, 'pstack-test/model', 'off', false],
    ['how explorer: inherit-parent', undefined, 'pstack-test/model', 'off', false],
    ['how explorer: pstack-test/configured:max', undefined, 'pstack-test/configured', 'max', false],
    [
      'how explorer: openai-codex/gpt-5.4:high [fast]',
      undefined,
      'openai-codex/gpt-5.4',
      'high',
      true,
    ],
    [
      'how explorer: pstack-test/configured:low',
      'pstack-test/configured:low',
      'pstack-test/configured',
      'low',
      false,
    ],
    [
      'how explorer: openai-codex/gpt-5.4:high [fast]',
      'openai/gpt-5.4:high [fast]',
      'openai/gpt-5.4',
      'high',
      true,
    ],
  ])(
    'handles defaults aliases effort fast and overrides (%s, %s)',
    async (policy, model, expected, effort, fast) => {
      const h = await harness(true, new Map(), policy)
      try {
        const result = await h.runtime.run({ ctx: h.ctx, input: policyInput({ model }) })
        expect(result.kind, JSON.stringify(result)).toBe('completed')
        expect(h.runtime.getRecord(result.details.agentId)).toMatchObject({
          model: expected,
          effort,
          fast,
        })
        expect(h.inventories.find((entry) => entry.action === 'read:policy').model).toBe(expected)
      } finally {
        await h.close()
      }
    },
  )

  it.each([
    ['how explorer: pstack-test/configured:high', 'inherit-parent', 'configured'],
    ['how explorer: pstack-test/missing:high', 'pstack-test/configured:low', 'configured'],
    ['how explorer: nonsense', undefined, 'invalid'],
    ['how explorer: nonsense', 'inherit-parent', 'invalid'],
    ['how explorer: pstack-test/model', undefined, 'invalid'],
    ['how explorer: auto\nhow explorer: auto', undefined, 'repeats role'],
    ['feature, refactoring: auto\nfeature: auto', undefined, 'repeats role'],
    ['how typo: auto', undefined, 'unknown role'],
    ['how explorer: pstack-test/missing:off', undefined, 'not available'],
    ['how explorer: pstack-test/model:high', undefined, 'does not support reasoning'],
    ['how explorer: pstack-test/configured:high [fast]', undefined, 'does not support the [fast]'],
    ['---\nalwaysApply: true', undefined, 'unterminated'],
  ])(
    'fails affected dispatch without harming generic sessions (%s)',
    async (policy, model, error) => {
      const h = await harness(true, new Map(), policy)
      try {
        const result = await h.runtime.run({ ctx: h.ctx, input: policyInput({ model }) })
        expect(result.kind).toBe('failed')
        expect(result.details.error).toContain(error)
        expect(h.inventories.some((entry) => entry.action === 'read:policy')).toBe(false)
        const generic = await h.runtime.run({
          ctx: h.ctx,
          input: policyInput({ capability_profile: undefined, role: 'anything' }),
        })
        expect(generic.kind).toBe('completed')
        expect(h.runtime.getRecord(generic.details.agentId).model).toBe('pstack-test/model')
      } finally {
        await h.close()
      }
    },
  )

  it('uses configured roles before agent defaults and unconfigured explicit selections', async () => {
    const h = await harness(true, new Map(), 'how explorer: pstack-test/model:off')
    try {
      h.api.events.emit('@nothingrotf/subagent/register-agents', {
        sourceId: 'policy-agent-fixture',
        definitions: [
          {
            name: 'policy-agent',
            description: 'Agent model fallback',
            systemPrompt: 'Return a short result.',
            model: 'pstack-test/configured:low',
            capabilityProfile: 'pstack-leaf',
          },
        ],
      })
      for (const [role, model, expected] of [
        ['how explorer', undefined, 'pstack-test/model'],
        ['feature', 'pstack-test/configured:high', 'pstack-test/configured'],
        ['feature', undefined, 'pstack-test/configured'],
      ]) {
        const result = await h.runtime.run({
          ctx: h.ctx,
          input: policyInput({
            subagent_type: 'policy-agent',
            capability_profile: undefined,
            role,
            model,
          }),
        })
        expect(result.kind, JSON.stringify(result)).toBe('completed')
        expect(h.runtime.getRecord(result.details.agentId).model).toBe(expected)
      }
      const registered = await h.runtime.run({
        ctx: h.ctx,
        input: policyInput({ subagent_type: 'poteto-agent', capability_profile: undefined }),
      })
      expect(registered.kind).toBe('completed')
      expect(h.runtime.getRecord(registered.details.agentId).execution.capability.profileId).toBe(
        'pstack-leaf',
      )
    } finally {
      await h.close()
    }
  })

  it.each([undefined, 'how explorerr', 'divergent'])(
    'rejects missing and unknown dispatch roles (%s)',
    async (role) => {
      const h = await harness(true)
      try {
        const result = await h.runtime.run({
          ctx: h.ctx,
          input: policyInput({ role, model: 'inherit-parent' }),
        })
        expect(result.kind).toBe('failed')
        expect(result.details.error).toMatch(/Task.role|Unknown model policy role/)
      } finally {
        await h.close()
      }
    },
  )

  it.each(pstackRoles.filter((entry) => entry.panel))(
    'requires explicit distinct panel selection for $role',
    async ({ role }) => {
      const h = await harness(
        true,
        new Map(),
        `${role}: pstack-test/configured:high, inherit-parent`,
      )
      try {
        if (role === 'runtime verification') await initializeRepository(h)
        const omitted = await h.runtime.run({ ctx: h.ctx, input: policyInput({ role }) })
        expect(omitted.kind).toBe('failed')
        expect(omitted.details.error).toContain('distinct choices')
        const outside = await h.runtime.run({
          ctx: h.ctx,
          input: policyInput({ role, model: 'pstack-test/configured:low' }),
        })
        expect(outside.kind).toBe('failed')
        expect(outside.details.error).toContain('configured')
        for (const model of ['inherit-parent', 'pstack-test/configured:high']) {
          const selected = await h.runtime.run({ ctx: h.ctx, input: policyInput({ role, model }) })
          expect(selected.kind).toBe('completed')
          expect(h.runtime.getRecord(selected.details.agentId).model).toBe(
            model === 'inherit-parent' ? 'pstack-test/model' : 'pstack-test/configured',
          )
        }
      } finally {
        await h.close()
      }
    },
    180_000,
  )

  it.each(['auto, inherit-parent', 'pstack-test/configured:high, pstack-test/configured:high'])(
    'resolves identical panel choices without hidden fanout (%s)',
    async (choices) => {
      const h = await harness(true, new Map(), `arena runners: ${choices}`)
      try {
        const result = await h.runtime.run({
          ctx: h.ctx,
          input: policyInput({ role: 'arena runners' }),
        })
        expect(result.kind).toBe('completed')
        expect(h.runtime.listSnapshots()).toHaveLength(1)
      } finally {
        await h.close()
      }
    },
  )

  it('applies grouped keys and aliases through a real Task batch', async () => {
    const plans = new Map()
    const h = await harness(
      true,
      plans,
      'feature, refactoring: pstack-test/configured:low\nreflect judgment, divergent, synthesizer: pstack-test/configured:high',
    )
    try {
      const roles = [
        'feature',
        'refactoring',
        'reflect judgment',
        'reflect divergent',
        'reflect synthesizer',
      ]
      const result = await invoke(h, plans, 'policy-batch', 'Task', {
        tasks: roles.map((role, index) => {
          const { run_in_background: _background, ...input } = policyInput({
            role,
            id: `role-${index}`,
          })
          return input
        }),
      })
      expect(result.status).toBe('batch')
      expect(result.items).toHaveLength(roles.length)
      for (const item of result.items) {
        expect(item.status, JSON.stringify(item)).toBe('completed')
        expect(h.runtime.getRecord(item.agentId).model).toBe('pstack-test/configured')
      }
    } finally {
      await h.close()
    }
  })

  it.each([true, false])(
    'refreshes policy without reload in either extension order (%s)',
    async (pstackFirst) => {
      const plans = new Map()
      const h = await harness(pstackFirst, plans, 'how explorer: pstack-test/configured:high')
      try {
        const original = await invoke(h, plans, 'original-policy', 'Task', policyInput())
        expect(h.runtime.getRecord(original.agentId).model).toBe('pstack-test/configured')
        await writeFile(join(h.dir, 'pstack-models.md'), 'how explorer: inherit-parent')
        const fresh = await invoke(h, plans, 'fresh-policy', 'Task', policyInput())
        expect(h.runtime.getRecord(fresh.agentId).model).toBe('pstack-test/model')
        const prompt = h.inventories.find((entry) => entry.action === 'read:fresh-policy').prompt
        expect(prompt).toContain('how explorer: inherit-parent')
        expect(prompt).not.toContain('how explorer: pstack-test/configured:high')
      } finally {
        await h.close()
      }
    },
  )

  it('refreshes policy after a tool edits it within the same root prompt', async () => {
    const plans = new Map()
    const h = await harness(
      true,
      plans,
      'how explorer: pstack-test/configured:high',
      (pi, path) => {
        pi.registerTool({
          name: 'change_policy',
          label: 'Change policy',
          description: 'Change the fixture policy.',
          parameters: { type: 'object', properties: {} },
          async execute() {
            await writeFile(path, 'how explorer: inherit-parent')
            return { content: [{ type: 'text', text: 'Policy changed' }], details: {} }
          },
        })
      },
    )
    try {
      plans.set('read:edit-policy', [
        { name: 'change_policy', arguments: {} },
        { name: 'Task', arguments: policyInput() },
      ])
      await h.session.prompt('read:edit-policy')
      await h.session.agent.waitForIdle()
      expect(await readFile(join(h.dir, 'pstack-models.md'), 'utf8')).toBe(
        'how explorer: inherit-parent',
      )
      const result = lastToolResult(h.session, 'Task')
      expect(h.runtime.getRecord(result.agentId).model).toBe('pstack-test/model')
      expect(h.inventories.find((entry) => entry.action === 'read:policy').prompt).toContain(
        'how explorer: inherit-parent',
      )
    } finally {
      await h.close()
    }
  })

  it('fails closed on an invalid edit and recovers without reload', async () => {
    const plans = new Map()
    const h = await harness(true, plans, 'how explorer: pstack-test/configured:high')
    try {
      await writeFile(join(h.dir, 'pstack-models.md'), 'malformed policy')
      plans.set('read:invalid-policy', [{ name: 'Task', arguments: policyInput() }])
      await h.session.prompt('read:invalid-policy')
      await h.session.agent.waitForIdle()
      const result = h.session.messages.findLast(
        (message) => message.role === 'toolResult' && message.toolName === 'Task',
      )
      expect(result.details.status).toBe('error')
      expect(JSON.stringify(result.content)).toContain('invalid')
      expect(h.runtime.listSnapshots()).toEqual([])
      await writeFile(join(h.dir, 'pstack-models.md'), 'how explorer: inherit-parent')
      const recovered = await invoke(h, plans, 'recovered-policy', 'Task', policyInput())
      expect(h.runtime.getRecord(recovered.agentId).model).toBe('pstack-test/model')
    } finally {
      await h.close()
    }
  })

  it('rejects an explicit model outside the configured role before a child starts', async () => {
    const plans = new Map()
    const h = await harness(true, plans, 'how explorer: pstack-test/configured:high')
    try {
      plans.set('read:policy-conflict', [
        { name: 'Task', arguments: policyInput({ model: 'inherit-parent' }) },
      ])
      await h.session.prompt('read:policy-conflict')
      await h.session.agent.waitForIdle()
      const result = h.session.messages.findLast(
        (message) => message.role === 'toolResult' && message.toolName === 'Task',
      )
      expect(result.details.status).toBe('error')
      expect(JSON.stringify(result.content)).toContain('configured')
      expect(h.runtime.listSnapshots()).toEqual([])
      expect(h.inventories.some((entry) => entry.action === 'read:policy')).toBe(false)
    } finally {
      await h.close()
    }
  })

  it('reloads the actual extension policy while preserving stored resume models', async () => {
    const plans = new Map()
    const h = await harness(true, plans, 'how explorer: pstack-test/configured:high')
    try {
      await h.session.bindExtensions({ shutdownHandler: () => undefined })
      const original = await invoke(h, plans, 'before-reload', 'Task', policyInput())
      expect(h.runtime.getRecord(original.agentId).model).toBe('pstack-test/configured')
      await writeFile(join(h.dir, 'pstack-models.md'), 'how explorer: inherit-parent')
      await h.session.reload()
      const fresh = await invoke(h, plans, 'after-reload', 'Task', policyInput())
      expect(h.runtime.getRecord(fresh.agentId).model).toBe('pstack-test/model')
      expect(h.inventories.find((entry) => entry.action === 'read:after-reload').prompt).toContain(
        'how explorer: inherit-parent',
      )
      await writeFile(join(h.dir, 'pstack-models.md'), 'malformed file')
      await h.session.reload()
      const resumed = await invoke(h, plans, 'reload-resume', 'Task', {
        description: 'Resume with invalid new policy',
        prompt: 'read:reload-resumed',
        resume: original.agentId,
        subagent_type: 'generalPurpose',
        run_in_background: false,
      })
      expect(resumed.status).toBe('completed')
      expect(h.inventories.find((entry) => entry.action === 'read:reload-resumed').model).toBe(
        'pstack-test/configured',
      )
      const rejected = await h.runtime.run({ ctx: h.ctx, input: policyInput() })
      expect(rejected.kind).toBe('failed')
      expect(rejected.details.error).toContain('invalid')
    } finally {
      await h.close()
    }
  })

  it('enforces policy in background and nested Tasks and preserves resume', async () => {
    const plans = new Map()
    const h = await harness(
      true,
      plans,
      'feature: pstack-test/configured:high\nhow explorer: pstack-test/model:off',
    )
    try {
      plans.set('read:owner-policy', [
        { name: 'Task', arguments: policyInput({ prompt: 'read:nested-policy' }) },
      ])
      const started = await invoke(
        h,
        plans,
        'background-policy',
        'Task',
        policyInput({
          subagent_type: 'poteto-agent',
          role: 'feature',
          capability_profile: 'pstack-nested',
          prompt: 'read:owner-policy',
          run_in_background: true,
        }),
      )
      await invoke(h, plans, 'wait-policy', 'TaskControl', {
        action: 'wait',
        agent_ids: [started.agentId],
        timeout_ms: 10000,
      })
      expect(h.runtime.getRecord(started.agentId)).toMatchObject({
        status: 'completed',
        model: 'pstack-test/configured',
      })
      expect(h.inventories.find((entry) => entry.action === 'read:nested-policy').model).toBe(
        'pstack-test/model',
      )
      const resumed = await invoke(h, plans, 'resume-policy', 'Task', {
        description: 'Resume stored policy',
        prompt: 'read:resumed-policy',
        subagent_type: 'poteto-agent',
        resume: started.agentId,
        run_in_background: false,
      })
      expect(resumed.status).toBe('completed')
      expect(h.inventories.find((entry) => entry.action === 'read:resumed-policy').model).toBe(
        'pstack-test/configured',
      )
    } finally {
      await h.close()
    }
  })
})
