import { fileURLToPath } from 'node:url'

import { Type } from 'typebox'
import { describe, expect, it } from 'vite-plus/test'

import { measureDeclarations } from '../src/tool-cost-session.ts'
import { formatDeclarationCosts, formatToolCostReport, toolCostReport } from '../src/tool-cost.ts'

const tools = [
  {
    description: 'Short tool.',
    name: 'small',
    parameters: Type.Object({ path: Type.String() }),
  },
  {
    description: 'A much longer description that repeats itself on every model request.',
    name: 'large',
    parameters: Type.Object({
      files: Type.Array(Type.Object({ content: Type.String(), path: Type.String() })),
    }),
    promptGuidelines: ['Use large for several files.'],
    promptSnippet: 'Edit several files',
  },
]

describe('toolCostReport', () => {
  it('ranks tools by the characters they add to every request', () => {
    const report = toolCostReport(tools)

    expect(report.tools.map((tool) => tool.name)).toEqual(['large', 'small'])
    expect(report.totalChars).toBe(report.totalDefinitionChars + report.totalPromptChars)
    expect(report.totalPromptChars).toBe(
      'Use large for several files.'.length + 'Edit several files'.length,
    )
    const largest = report.tools[0]
    if (largest === undefined) throw new Error('The report is empty.')
    expect(largest.totalChars).toBe(largest.definitionChars + largest.promptChars)
  })

  it('renders a table that names the totals', () => {
    const output = formatToolCostReport(toolCostReport(tools))

    expect(output).toContain('tools 2')
    expect(output).toContain('definition chars')
    expect(output).toContain('large')
    expect(output.indexOf('large')).toBeLessThan(output.indexOf('small'))
  })

  it('reports an empty registry as zero', () => {
    expect(toolCostReport([])).toEqual({
      tools: [],
      totalChars: 0,
      totalDefinitionChars: 0,
      totalPromptChars: 0,
    })
  })
})

describe('measureDeclarations', () => {
  it('measures what each codemode mode declares to the model', async () => {
    const extension = fileURLToPath(new URL('../../filetools/src/index.ts', import.meta.url))
    const off = await measureDeclarations([extension], 'off')
    const on = await measureDeclarations([extension], 'on')
    const only = await measureDeclarations([extension], 'only')

    expect(off.declaredTools).toEqual(expect.arrayContaining(['read', 'patch']))
    expect(off.declaredTools).not.toContain('codemode')
    expect([...on.declaredTools].sort()).toEqual([...off.declaredTools, 'codemode'].sort())
    expect(on.declarationChars).toBeGreaterThan(off.declarationChars)
    expect(only.declaredTools).toEqual(['codemode'])
    expect(formatDeclarationCosts([off, on, only])).toContain('only')
  })
})
