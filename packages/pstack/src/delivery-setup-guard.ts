import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import {
  isToolCallEventType,
  type ExtensionAPI,
  type InlineExtension,
} from '@earendil-works/pi-coding-agent'
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

export const SETUP_MARKER = 'pstack-setup.json'
export const SETUP_RERUN_VARIABLE = 'PSTACK_SETUP_RERUN'

export const SetupMarkerSchema = Type.Object(
  {
    version: Type.Literal(1),
    status: Type.Enum(['passed', 'failed']),
    script: Type.String({ minLength: 1, maxLength: 4096 }),
    commands: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 256 }),
    log: Type.String({ minLength: 1, maxLength: 4096 }),
    finishedAt: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
)

export type SetupMarker = Static<typeof SetupMarkerSchema>

const shellKeyword =
  /^(?:if|then|else|elif|fi|for|do|done|while|until|case|esac|function|return|exit|set|export|local|readonly|shift|trap|cd|echo|printf|true|false|source|\.)(?:\s|;|$)/

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function setupCommands(script: string): string[] {
  const commands = new Set<string>()
  for (const raw of script.replace(/\\\r?\n/g, ' ').split('\n')) {
    const line = normalize(raw)
    if (line.length < 4 || /^[#{}()-]/.test(line)) continue
    if (shellKeyword.test(line) || /^[A-Za-z_][A-Za-z0-9_]*=\S*$/.test(line)) continue
    commands.add(line)
  }
  return [...commands].slice(0, 256)
}

function escapeExpression(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function setupRerun(command: string, marker: SetupMarker): string | undefined {
  const normalized = normalize(command)
  if (new RegExp(`(?:^|[\\s;&|(])${SETUP_RERUN_VARIABLE}=1(?:\\s|$)`).test(normalized)) {
    return undefined
  }
  return [marker.script, ...marker.commands].find((line) =>
    new RegExp(`(?:^|[\\s;&|(/])${escapeExpression(line)}(?=$|[\\s;&|)])`).test(normalized),
  )
}

async function linkedGitDirectory(start: string): Promise<string | undefined> {
  let current = resolve(start)
  for (;;) {
    const dotGit = join(current, '.git')
    const kind = await stat(dotGit).then(
      (entry) => (entry.isFile() ? 'file' : 'other'),
      () => 'missing',
    )
    if (kind === 'other') return undefined
    if (kind === 'file') {
      const pointer = /^gitdir: (.+)$/m.exec(await readFile(dotGit, 'utf8'))
      return pointer?.[1] === undefined ? undefined : resolve(current, pointer[1].trim())
    }
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

export async function readSetupMarker(cwd: string): Promise<SetupMarker | undefined> {
  const gitDir = await linkedGitDirectory(cwd)
  if (gitDir === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(await readFile(join(gitDir, SETUP_MARKER), 'utf8'))
    return Value.Check(SetupMarkerSchema, parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export async function setupGuardVerdict(
  cwd: string,
  command: string,
): Promise<{ block: true; reason: string } | undefined> {
  const marker = await readSetupMarker(cwd)
  if (marker === undefined || marker.status !== 'passed') return undefined
  const matched = setupRerun(command, marker)
  if (matched === undefined) return undefined
  return {
    block: true,
    reason: `This issue workspace already ran its setup: ${marker.script} passed, and its log is ${marker.log}. \`${matched}\` repeats that setup. Reuse the prepared environment. If a check fails because the environment is missing or a dependency changed, rerun the command with ${SETUP_RERUN_VARIABLE}=1 at its start and state why in your report.`,
  }
}

export const setupGuardExtension: InlineExtension = {
  factory: (pi: ExtensionAPI) => {
    pi.on('tool_call', async (event, ctx) => {
      if (!isToolCallEventType('bash', event)) return undefined
      return setupGuardVerdict(ctx.cwd, event.input.command)
    })
  },
  hidden: true,
  name: 'pstack-setup-guard',
}
