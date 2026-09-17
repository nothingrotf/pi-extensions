import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'

import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type, type Static } from 'typebox'

const EditSchema = Type.Object(
  {
    oldText: Type.String({
      description: 'Exact text to replace. It must occur exactly once in the current file.',
      minLength: 1,
    }),
    newText: Type.String({ description: 'Replacement text for this edit.' }),
  },
  { additionalProperties: false },
)

const FileSchema = Type.Object(
  {
    path: Type.String({ description: 'File path, relative or absolute.', minLength: 1 }),
    content: Type.Optional(
      Type.String({
        description: 'Full file content. Use it to create a file or to replace one completely.',
      }),
    ),
    edits: Type.Optional(
      Type.Array(EditSchema, {
        description: 'Replacements applied to this file in order.',
        maxItems: 64,
        minItems: 1,
      }),
    ),
  },
  { additionalProperties: false },
)

export const PatchSchema = Type.Object(
  {
    files: Type.Array(FileSchema, {
      description: 'Every file changed by this patch.',
      maxItems: 64,
      minItems: 1,
    }),
  },
  { additionalProperties: false },
)

export type PatchInput = Static<typeof PatchSchema>

export interface PatchFileResult {
  created: boolean
  edits: number
  lineDelta: number
  path: string
}

export interface PatchPlan {
  files: readonly { absolutePath: string; content: string; result: PatchFileResult }[]
}

export class PatchError extends Error {}

function absolutePath(path: string, cwd: string): string {
  const expanded = path.startsWith('~/') ? `${homedir()}/${path.slice(2)}` : path
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded)
}

function applyEdits(
  path: string,
  original: string,
  edits: readonly Static<typeof EditSchema>[],
): string {
  let content = original
  for (const [index, edit] of edits.entries()) {
    const first = content.indexOf(edit.oldText)
    if (first < 0) {
      throw new PatchError(
        `Edit ${index + 1} for ${path} does not match. The oldText must match exactly, including whitespace.`,
      )
    }
    if (content.indexOf(edit.oldText, first + 1) >= 0) {
      throw new PatchError(
        `Edit ${index + 1} for ${path} matches more than once. Extend oldText until it is unique.`,
      )
    }
    content = `${content.slice(0, first)}${edit.newText}${content.slice(first + edit.oldText.length)}`
  }
  return content
}

function lineCount(content: string): number {
  if (content.length === 0) return 0
  const lines = content.split('\n').length
  return content.endsWith('\n') ? lines - 1 : lines
}

/**
 * Resolve every file change before touching the disk.
 *
 * A patch is all or nothing: one failed match leaves the workspace untouched, so a partial edit can
 * never reach an isolated workspace or a captured artifact.
 */
export async function planPatch(input: PatchInput, cwd: string): Promise<PatchPlan> {
  const seen = new Set<string>()
  const files: { absolutePath: string; content: string; result: PatchFileResult }[] = []
  for (const file of input.files) {
    const target = absolutePath(file.path, cwd)
    if (seen.has(target)) {
      throw new PatchError(`File ${file.path} occurs more than once. Merge its edits.`)
    }
    seen.add(target)
    if ((file.content === undefined) === (file.edits === undefined)) {
      throw new PatchError(`File ${file.path} requires either content or edits, not both.`)
    }
    let original: string | undefined
    try {
      original = await readFile(target, 'utf8')
    } catch {
      original = undefined
    }
    if (file.edits !== undefined) {
      if (original === undefined) {
        throw new PatchError(`File ${file.path} does not exist. Use content to create it.`)
      }
      const content = applyEdits(file.path, original, file.edits)
      files.push({
        absolutePath: target,
        content,
        result: {
          created: false,
          edits: file.edits.length,
          lineDelta: lineCount(content) - lineCount(original),
          path: file.path,
        },
      })
      continue
    }
    const content = file.content ?? ''
    files.push({
      absolutePath: target,
      content,
      result: {
        created: original === undefined,
        edits: 1,
        lineDelta: lineCount(content) - lineCount(original ?? ''),
        path: file.path,
      },
    })
  }
  return { files }
}

/** Write a resolved plan. Callers plan first, so this step performs no validation. */
export async function writePatch(plan: PatchPlan): Promise<readonly PatchFileResult[]> {
  for (const file of plan.files) {
    await mkdir(dirname(file.absolutePath), { recursive: true })
    await writeFile(file.absolutePath, file.content, 'utf8')
  }
  return plan.files.map((file) => file.result)
}

export function formatPatchResults(results: readonly PatchFileResult[]): string {
  const lines = results.map((result) => {
    const delta = result.lineDelta > 0 ? `+${result.lineDelta}` : `${result.lineDelta}`
    const action = result.created
      ? 'created'
      : `${result.edits} edit${result.edits === 1 ? '' : 's'}`
    return `${result.path}: ${action}, ${delta} lines`
  })
  return [`Patched ${results.length} file${results.length === 1 ? '' : 's'}.`, ...lines].join('\n')
}

export function createPatchTool(): ToolDefinition<typeof PatchSchema> {
  return defineTool({
    description:
      'Apply edits across multiple files in one call. Each file takes either exact-match edits or full content. The patch is all or nothing: nothing is written when any edit fails to match uniquely. Prefer this tool over repeated single-file edits.',
    execute: async (_toolCallId, input, signal, _onUpdate, ctx) => {
      signal?.throwIfAborted()
      const plan = await planPatch(input, ctx.cwd)
      const results = await writePatch(plan)
      return {
        content: [{ text: formatPatchResults(results), type: 'text' }],
        details: { files: results },
      }
    },
    label: 'patch',
    name: 'patch',
    parameters: PatchSchema,
    promptGuidelines: [
      'Use patch to change several files in one call instead of one edit call per file.',
      'Give each file either exact-match edits or full content, never both.',
      'A patch writes nothing when any edit fails to match exactly once.',
    ],
    promptSnippet: 'Edit several files in one call',
  })
}
