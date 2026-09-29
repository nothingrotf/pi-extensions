import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  DefaultResourceLoader,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'

import { measureDeclarations } from './tool-cost-session.ts'
import {
  formatDeclarationCosts,
  formatToolCostReport,
  toolCostReport,
  type ToolCostInput,
} from './tool-cost.ts'

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const paths = args.filter((entry) => entry !== '--json').map((entry) => resolve(entry))

if (paths.length === 0) {
  process.stderr.write('Usage: bun src/tool-cost-cli.ts [--json] <extension.ts> [more.ts]\n')
  process.exitCode = 2
} else {
  const root = await mkdtemp(join(tmpdir(), 'pstack-tool-cost-'))
  try {
    const loader = new DefaultResourceLoader({
      additionalExtensionPaths: paths,
      agentDir: join(root, 'agent'),
      cwd: root,
      noContextFiles: true,
      noPromptTemplates: true,
      noSkills: true,
      noThemes: true,
      settingsManager: SettingsManager.inMemory(),
    })
    await loader.reload()
    const result = loader.getExtensions()
    for (const error of result.errors) {
      process.stderr.write(`Cannot load ${error.path}: ${error.error}\n`)
      process.exitCode = 1
    }
    const tools = new Map<string, ToolCostInput>()
    const record = (definition: ToolCostInput) => tools.set(definition.name, definition)
    for (const definition of [
      createReadToolDefinition(root),
      createWriteToolDefinition(root),
      createEditToolDefinition(root),
      createBashToolDefinition(root),
      createGrepToolDefinition(root),
      createFindToolDefinition(root),
      createLsToolDefinition(root),
    ]) {
      record(definition)
    }
    for (const extension of result.extensions) {
      for (const tool of extension.tools.values()) record(tool.definition)
    }
    const report = toolCostReport([...tools.values()])
    const codemode = []
    for (const mode of ['off', 'on', 'only'] as const) {
      codemode.push(await measureDeclarations(paths, mode))
    }
    process.stdout.write(
      asJson
        ? `${JSON.stringify({ ...report, codemode }, null, 2)}\n`
        : `${formatToolCostReport(report)}\n\n${formatDeclarationCosts(codemode)}\n`,
    )
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}
