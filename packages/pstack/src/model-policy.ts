import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { CapabilityModelPolicy, RoleModelPolicyEntry } from '@nothingrotf/subagent'

interface PstackRole {
  role: string
  panel: boolean
  aliases: readonly string[]
}

export const pstackRoles: readonly PstackRole[] = [
  { role: 'feature', panel: false, aliases: [] },
  { role: 'refactoring', panel: false, aliases: [] },
  { role: 'bug-fix', panel: false, aliases: [] },
  { role: 'perf-issue', panel: false, aliases: [] },
  { role: 'hillclimb', panel: false, aliases: [] },
  { role: 'judgment and prose', panel: false, aliases: [] },
  { role: 'hardest tasks', panel: false, aliases: [] },
  { role: 'how explorer', panel: false, aliases: [] },
  { role: 'how explainer', panel: false, aliases: [] },
  { role: 'why investigators', panel: false, aliases: [] },
  { role: 'why synthesizer', panel: false, aliases: [] },
  { role: 'reflect tooling', panel: false, aliases: [] },
  { role: 'reflect judgment', panel: false, aliases: [] },
  { role: 'reflect divergent', panel: false, aliases: ['divergent'] },
  { role: 'reflect synthesizer', panel: false, aliases: ['synthesizer'] },
  { role: 'arena runners', panel: true, aliases: [] },
  { role: 'arena cross-judge pool', panel: true, aliases: [] },
  { role: 'swarm workers', panel: false, aliases: [] },
  { role: 'architect runners', panel: true, aliases: [] },
  { role: 'interrogate reviewers', panel: true, aliases: [] },
]

const legacyPstackRoles: readonly PstackRole[] = [{ role: 'how critics', panel: true, aliases: [] }]

export interface PstackModelPolicyOptions {
  modelPolicyPath?: string
}

function invalid(error: string): CapabilityModelPolicy {
  return { status: 'invalid', error }
}

export function parsePstackModelPolicy(content: string): CapabilityModelPolicy {
  if (content.length > 64 * 1024) return invalid('pstack-models.md exceeds 64 KiB.')
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/)
  let start = 0
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
    if (end < 0) return invalid('pstack-models.md has unterminated frontmatter.')
    start = end + 1
  }
  const configured = new Map<string, readonly string[]>()
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? ''
    if (line === '' || line.startsWith('#')) continue
    const separator = line.indexOf(':')
    if (separator < 1) return invalid(`pstack-models.md line ${index + 1} requires role: selector.`)
    const labels = line
      .slice(0, separator)
      .split(',')
      .map((label) => label.trim())
    const selectors = line
      .slice(separator + 1)
      .split(',')
      .map((selector) => selector.trim())
    if (
      selectors.length > 64 ||
      selectors.some(
        (selector) =>
          selector.length > 1024 ||
          !/^(?:auto|inherit-parent|[A-Za-z0-9_.-]+\/[A-Za-z0-9_./:-]+:(?:off|minimal|low|medium|high|xhigh|max)(?: \[fast\])?)$/.test(
            selector,
          ),
      )
    )
      return invalid(
        `pstack-models.md line ${index + 1} has an invalid model selector. Use provider/model-id:effort [fast], auto, or inherit-parent.`,
      )
    for (const label of labels) {
      const role = [...pstackRoles, ...legacyPstackRoles].find(
        (entry) => entry.role === label || entry.aliases.includes(label),
      )
      if (role === undefined)
        return invalid(`pstack-models.md line ${index + 1} has an unknown role.`)
      if (configured.has(role.role)) return invalid(`pstack-models.md repeats role "${role.role}".`)
      if (!role.panel && selectors.length !== 1)
        return invalid(`pstack-models.md role "${role.role}" requires one selector.`)
      configured.set(role.role, selectors)
    }
  }
  const roles: RoleModelPolicyEntry[] = pstackRoles.map(({ role }) => ({
    role,
    selectors: configured.get(role) ?? [],
  }))
  return { status: 'valid', enforcement: 'configured', roles }
}

export async function loadPstackModelPolicy(
  options: PstackModelPolicyOptions = {},
): Promise<CapabilityModelPolicy> {
  const path = options.modelPolicyPath ?? join(homedir(), '.agents', 'rules', 'pstack-models.md')
  try {
    return parsePstackModelPolicy(await readFile(path, 'utf8'))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return parsePstackModelPolicy('')
    return invalid(
      'Cannot read pstack-models.md. Check the configured policy path and file permissions.',
    )
  }
}

export function renderPstackModelPolicy(policy: CapabilityModelPolicy): string {
  const instructions = [
    '# Pstack runtime model policy',
    'Every pstack Task must pass an exact role below and capability_profile pstack-leaf, or pstack-nested for a delegating owner. Registered pstack agents default to pstack-leaf.',
    'The configured role is mandatory. Task.model must match a configured selector, including effort and fast mode. Unknown or missing Task.role fails for pstack capabilities. Other capabilities are unaffected.',
    'For a scalar role, omit Task.model to use its policy. Unconfigured roles fall back to the agent default, then the parent. auto and inherit-parent select the parent model.',
    'Panel and pool lists never create Tasks automatically. Follow the skill for counts. For distinct choices, pass the selected entry explicitly as Task.model, including inherit-parent for an inherited entry. Never silently pick the first entry.',
    'Never substitute skill defaults for configured models. Select panel and pool entries only from the configured list. For different-family reviews, choose a configured entry or ask the user to update the policy.',
    'The extension reads ~/.agents/rules/pstack-models.md automatically before each root prompt and root Task call. No manual read or alwaysApply support is required. Invalid policies block fresh pstack dispatches. Resume preserves its stored model.',
  ]
  if (policy.status === 'invalid')
    return [...instructions, `Policy unavailable. ${policy.error}`].join('\n')
  return [
    ...instructions,
    ...policy.roles.map(
      (entry) =>
        `${entry.role}: ${entry.selectors.length === 0 ? 'unconfigured; agent default then parent; skill owns count' : entry.selectors.join(', ')}`,
    ),
  ].join('\n')
}
