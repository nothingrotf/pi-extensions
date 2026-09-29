/**
 * Measure the per-request overhead of registered tools.
 *
 * Every tool definition is serialized into each model request, so a verbose description or a large
 * parameter schema is paid on every turn of every session. The report ranks that fixed cost.
 */
export interface ToolCostInput {
  description: string
  name: string
  parameters: unknown
  promptGuidelines?: readonly string[]
  promptSnippet?: string
}

export interface ToolCost {
  /** Characters of the serialized name, description, and parameter schema. */
  definitionChars: number
  name: string
  /** Characters contributed to the system prompt by the snippet and guidelines. */
  promptChars: number
  totalChars: number
}

export interface ToolCostReport {
  tools: readonly ToolCost[]
  totalChars: number
  totalDefinitionChars: number
  totalPromptChars: number
}

function costOf(tool: ToolCostInput): ToolCost {
  const definitionChars = JSON.stringify({
    description: tool.description,
    name: tool.name,
    parameters: tool.parameters,
  }).length
  const guidelines = (tool.promptGuidelines ?? []).reduce((total, line) => total + line.length, 0)
  const promptChars = guidelines + (tool.promptSnippet ?? '').length
  return {
    definitionChars,
    name: tool.name,
    promptChars,
    totalChars: definitionChars + promptChars,
  }
}

export function toolCostReport(tools: readonly ToolCostInput[]): ToolCostReport {
  const costs = tools.map(costOf).sort((left, right) => right.totalChars - left.totalChars)
  let totalDefinitionChars = 0
  let totalPromptChars = 0
  for (const cost of costs) {
    totalDefinitionChars += cost.definitionChars
    totalPromptChars += cost.promptChars
  }
  return {
    tools: costs,
    totalChars: totalDefinitionChars + totalPromptChars,
    totalDefinitionChars,
    totalPromptChars,
  }
}

export type CodemodeMode = 'off' | 'on' | 'only'

export interface DeclaredTool {
  description: string
  name: string
  parameters: unknown
}

export interface DeclarationCost {
  declarationChars: number
  declaredTools: readonly string[]
  mode: CodemodeMode
  systemPromptChars: number
  totalChars: number
}

export function declarationCost(
  mode: CodemodeMode,
  tools: readonly DeclaredTool[],
  systemPrompt: string,
): DeclarationCost {
  const declarationChars = tools.reduce(
    (total, tool) =>
      total +
      JSON.stringify({
        description: tool.description,
        name: tool.name,
        parameters: tool.parameters,
      }).length,
    0,
  )
  return {
    declarationChars,
    declaredTools: tools.map((tool) => tool.name),
    mode,
    systemPromptChars: systemPrompt.length,
    totalChars: declarationChars + systemPrompt.length,
  }
}

export function formatDeclarationCosts(costs: readonly DeclarationCost[]): string {
  const lines = ['codemode  tools  declaration  system prompt    total']
  for (const cost of costs) {
    lines.push(
      `${cost.mode.padEnd(8)} ${pad(cost.declaredTools.length, 6)} ${pad(cost.declarationChars, 12)} ${pad(cost.systemPromptChars, 14)} ${pad(cost.totalChars, 8)}`,
    )
  }
  return lines.join('\n')
}

function pad(value: number, width: number): string {
  return String(value).padStart(width)
}

export function formatToolCostReport(report: ToolCostReport): string {
  const lines = [
    `tools ${report.tools.length}`,
    `definition chars ${report.totalDefinitionChars}`,
    `prompt chars ${report.totalPromptChars}`,
    `total chars ${report.totalChars}`,
    '',
    '  total   definition  prompt  tool',
  ]
  for (const tool of report.tools) {
    lines.push(
      `${pad(tool.totalChars, 7)} ${pad(tool.definitionChars, 11)} ${pad(tool.promptChars, 7)}  ${tool.name}`,
    )
  }
  return lines.join('\n')
}
