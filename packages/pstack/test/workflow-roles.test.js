import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

import { pstackRoles } from '../src/model-policy.ts'
import { workflowCases } from './workflow-cases.js'

const roles = new Set(pstackRoles.map((entry) => entry.role))

function literalRoles(text) {
  const declarations = []
  const lines = text.split('\n')
  let roleColumn = -1
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(/(?:\bTask\.)?\brole["'`]?\s*[:=]\s*(["'`])([^"'`\n]+)\1/g)) {
      declarations.push({ role: match[2], line: index + 1 })
    }
    const assignment = line.match(/`Task\.role` to ((?:`[^`]+`(?:,? (?:or )?)?)+)/)
    if (assignment !== null) {
      for (const match of assignment[1].matchAll(/`([^`]+)`/g)) {
        declarations.push({ role: match[1], line: index + 1 })
      }
    }
    if (!line.startsWith('|')) {
      roleColumn = -1
      continue
    }
    const columns = line.split('|').map((column) => column.trim())
    if (columns.includes('Role')) roleColumn = columns.indexOf('Role')
    if (roleColumn >= 0) {
      const match = columns[roleColumn]?.match(/^`([^`]+)`$/)
      if (match !== undefined && match !== null)
        declarations.push({ role: match[1], line: index + 1 })
    }
  }
  return declarations
}

function unknownRoles(declarations) {
  return declarations.filter((entry) => !roles.has(entry.role))
}

describe('pstack executable workflow roles', () => {
  it('checks literal Task declarations throughout skills and playbooks', async () => {
    const root = fileURLToPath(new URL('../skills/', import.meta.url))
    const paths = (await readdir(root, { recursive: true })).filter((path) => path.endsWith('.md'))
    const declarations = []
    for (const path of paths) {
      const text = await readFile(join(root, path), 'utf8')
      declarations.push(...literalRoles(text).map((entry) => ({ path, ...entry })))
    }
    expect(declarations.some((entry) => entry.path.includes('/playbooks/'))).toBe(true)
    expect(declarations.some((entry) => entry.path.endsWith('/SKILL.md'))).toBe(true)
    expect(unknownRoles(declarations)).toEqual([])
  })

  it('checks resolved roles in runnable workflow fixtures', () => {
    expect(workflowCases.length).toBeGreaterThan(0)
    expect(unknownRoles(workflowCases)).toEqual([])
  })

  it('rejects misspelled literals and config aliases only when used as Task roles', () => {
    const text = [
      'reflect judgment, divergent, synthesizer: inherit-parent',
      'Pass `role: "how explorerr"`.',
      '- `role`: `divergent`',
      '{ "role": "synthesizer" }',
      'Set `Task.role` to `reflect judgment`, `reflect toolng`, or `reflect synthesizer`.',
      '| Lens | Role |',
      '| Tooling | `reflect toolng` |',
    ].join('\n')
    expect(unknownRoles(literalRoles(text)).map((entry) => entry.role)).toEqual([
      'how explorerr',
      'divergent',
      'synthesizer',
      'reflect toolng',
      'reflect toolng',
    ])
  })
})
