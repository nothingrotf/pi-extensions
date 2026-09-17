import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'

import { createReadToolDefinition, type ReadToolInput } from '@earendil-works/pi-coding-agent'

import { FULL_READ_BYTES, fileOutline, HEAD_LINES, outlineNotice } from './outline.ts'

function absolutePath(path: string, cwd: string): string {
  const expanded = path.startsWith('~/') ? `${homedir()}/${path.slice(2)}` : path
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded)
}

interface BoundedPlan {
  bytes: number
  content: string
}

/**
 * Decide whether a read needs bounding. An explicit window is always honored, and a small file is
 * always returned whole, so the tool never hides content the model deliberately asked for.
 */
export async function boundedReadPlan(
  input: ReadToolInput,
  cwd: string,
): Promise<BoundedPlan | undefined> {
  if (input.offset !== undefined || input.limit !== undefined) return undefined
  const path = absolutePath(input.path, cwd)
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size <= FULL_READ_BYTES) return undefined
    const content = await readFile(path, 'utf8')
    if (content.includes('\u0000')) return undefined
    return { bytes: info.size, content }
  } catch {
    return undefined
  }
}

/**
 * Replace the native read tool with a bounded reader.
 *
 * A large file without an explicit window returns its head plus a map of declarations instead of
 * the whole text. The tool keeps the native name, schema, and renderers, so recorded `read`
 * receipts and existing prompts stay valid.
 */
export function createBoundedReadTool(cwd: string): ReturnType<typeof createReadToolDefinition> {
  const native = createReadToolDefinition(cwd)
  return {
    ...native,
    description: `${native.description} Large files return a bounded head plus a map of declarations; pass offset and limit for another window.`,
    promptGuidelines: [
      ...(native.promptGuidelines ?? []),
      'Search before reading, and read a bounded window of a large file.',
      'After a bounded head and file map, request the exact window with offset and limit.',
      'Read a whole file only when the work depends on its full content.',
    ],
    async execute(toolCallId, input, signal, onUpdate, ctx) {
      const plan = await boundedReadPlan(input, ctx.cwd)
      if (plan === undefined) return native.execute(toolCallId, input, signal, onUpdate, ctx)
      const outline = fileOutline(plan.content)
      const returnedLines = Math.min(HEAD_LINES, outline.lines)
      const result = await native.execute(
        toolCallId,
        { ...input, limit: HEAD_LINES, offset: 1 },
        signal,
        onUpdate,
        ctx,
      )
      return {
        ...result,
        content: [
          ...result.content,
          { text: outlineNotice(input.path, outline, returnedLines, plan.bytes), type: 'text' },
        ],
      }
    },
  }
}
