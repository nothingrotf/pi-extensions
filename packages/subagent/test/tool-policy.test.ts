import { describe, expect, it } from 'vite-plus/test'

import { resolveTools } from '../src/execution.ts'

describe('Task capability tool selection', () => {
  const agent = { name: 'workflow', tools: undefined }
  const planning = ['todo_read', 'todo_write']

  it('includes approved capabilities only when no narrower allowlist exists', () => {
    expect(resolveTools(agent, undefined, true, planning)).toEqual([
      'read',
      'grep',
      'find',
      'ls',
      ...planning,
    ])
    expect(resolveTools(agent, ['read'], true, planning)).toEqual(['read'])
    expect(resolveTools(agent, [], true, planning)).toEqual([])
    expect(resolveTools(agent, ['read', 'todo_read'], true, planning)).toEqual([
      'read',
      'todo_read',
    ])
  })

  it('preserves agent allowlists and rejects unapproved capability names', () => {
    const restricted = { name: 'restricted', tools: ['read', 'todo_read'] }
    expect(resolveTools(restricted, undefined, true, planning)).toEqual(['read', 'todo_read'])
    expect(() => resolveTools(restricted, ['todo_write'], true, planning)).toThrow(/not permitted/)
    expect(() => resolveTools(agent, ['todo_read'], true)).toThrow(/unknown/)
    expect(() => resolveTools(agent, ['ask_parent'], true, planning)).toThrow(/private/)
    expect(() => resolveTools(agent, ['todo_read', 'todo_read'], true, planning)).toThrow(
      /duplicated/,
    )
  })

  it('rejects capability collisions and preserves built-in read-only filtering', () => {
    expect(() => resolveTools(agent, undefined, false, ['read'])).toThrow(/conflicts/)
    expect(() => resolveTools(agent, undefined, false, ['todo_read', 'todo_read'])).toThrow(
      /conflicts/,
    )
    expect(resolveTools(agent, ['bash', 'write', 'todo_read'], true, planning)).toEqual([
      'todo_read',
    ])
  })
})
