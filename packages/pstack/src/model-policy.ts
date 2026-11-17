import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { CapabilityModelPolicy, RoleModelPolicyEntry } from '@nothingrotf/subagent'

interface PstackRole {
  role: string
  aliases: readonly string[]
}

export const pstackRoles: readonly PstackRole[] = [
  { role: 'feature', aliases: [] },
  { role: 'refactoring', aliases: [] },
  { role: 'bug-fix', aliases: [] },
  { role: 'perf-issue', aliases: [] },
  { role: 'hillclimb', aliases: [] },
  { role: 'judgment and prose', aliases: [] },
  { role: 'arena runners', aliases: [] },
  { role: 'arena cross-judge pool', aliases: [] },
  { role: 'swarm workers', aliases: [] },
  { role: 'interrogate reviewers', aliases: [] },
]

const legacyPstackRoles: readonly PstackRole[] = [
  { role: 'hardest tasks', aliases: [] },
  { role: 'how explorer', aliases: [] },
  { role: 'how explainer', aliases: [] },
  { role: 'why investigators', aliases: [] },
  { role: 'why synthesizer', aliases: [] },
  { role: 'reflect tooling', aliases: [] },
  { role: 'reflect judgment', aliases: [] },
  { role: 'reflect divergent', aliases: ['divergent'] },
  { role: 'reflect synthesizer', aliases: ['synthesizer'] },
  { role: 'architect runners', aliases: [] },
  { role: 'how critics', aliases: [] },
  { role: 'code review', aliases: [] },
  { role: 'runtime verification', aliases: [] },
  { role: 'publication', aliases: [] },
]

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
  let commentStart: number | undefined
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? ''
    if (commentStart === undefined && line.startsWith('<!--')) commentStart = index
    if (commentStart !== undefined) {
      if (line.endsWith('-->') && (index > commentStart || line.length >= 7))
        commentStart = undefined
      continue
    }
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
          !/^(?:auto|inherit-parent|[A-Za-z0-9_.-]+\/[A-Za-z0-9_./:-]+:(?:off|minimal|low|medium|high|xhigh|max)(?: \[(?:fast|ultrafast)\])?)$/.test(
            selector,
          ),
      )
    )
      return invalid(
        `pstack-models.md line ${index + 1} has an invalid model selector. Use provider/model-id:effort [fast], provider/model-id:effort [ultrafast], auto, or inherit-parent.`,
      )
    for (const label of labels) {
      const role = [...pstackRoles, ...legacyPstackRoles].find(
        (entry) => entry.role === label || entry.aliases.includes(label),
      )
      if (role === undefined)
        return invalid(`pstack-models.md line ${index + 1} has an unknown role.`)
      if (configured.has(role.role)) return invalid(`pstack-models.md repeats role "${role.role}".`)
      configured.set(role.role, selectors)
    }
  }
  if (commentStart !== undefined)
    return invalid(`pstack-models.md line ${commentStart + 1} opens an unterminated comment.`)
  const roles: RoleModelPolicyEntry[] = pstackRoles.map(({ role }) => ({
    role,
    selectors: [...(configured.get(role) ?? [])],
  }))
  return { status: 'valid', enforcement: 'configured', roles }
}

export async function loadPstackModelPolicy(
  options: PstackModelPolicyOptions = {},
): Promise<CapabilityModelPolicy> {
  const configured = process.env['PSTACK_MODEL_POLICY']
  const path =
    options.modelPolicyPath ??
    (configured !== undefined && configured.length > 0
      ? configured
      : join(homedir(), '.agents', 'rules', 'pstack-models.md'))
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
    'Every pstack Task must pass an exact role below and capability_profile pstack-leaf, pstack-sandbox for an OS-sandboxed verifier, or pstack-nested for a delegating owner. Registered pstack agents default to pstack-leaf.',
    'The configured role is mandatory. Task.model must match a configured selector, including effort and the [fast] or [ultrafast] speed marker. Unknown or missing Task.role fails for pstack capabilities. Other capabilities are unaffected.',
    'openai/ and openai-codex/ selectors match each other for the same model, effort, and speed marker. When one of these providers has no login, dispatch uses the same model on the other provider if it has a ChatGPT subscription login.',
    'When a role has one selector, omit Task.model to use it. When it lists several, pass the entry whose effort fits the job. Unconfigured roles fall back to the agent default, then the parent. auto and inherit-parent select the parent model.',
    'Lists never create Tasks automatically. Follow the skill for counts. For distinct choices, pass the selected entry explicitly as Task.model, including inherit-parent for an inherited entry. Never silently pick the first entry.',
    'Never substitute skill defaults for configured models. Select list entries only from the configured list. For different-family reviews, choose a configured entry or ask the user to update the policy.',
    'A second opinion is the same review against a different model: use one entry of arena cross-judge pool from another family than the implementation. Use swarm workers for verification, and judgment and prose only for prose or evidence synthesis. The implementation owner commits, pushes, and opens its own PR.',
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
