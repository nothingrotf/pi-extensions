import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'

import {
  createReadToolDefinition,
  defineTool,
  type AgentToolResult,
  type ReadToolInput,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { Type, type Static } from 'typebox'

import { selectJson, SelectorError } from './json-select.ts'
import { FULL_READ_BYTES, fileOutline, HEAD_LINES, outlineNotice } from './outline.ts'

/** Maximum files one read call accepts. */
export const MAX_READ_PATHS = 32
/** Maximum characters returned by one multi-path read. */
export const MULTI_READ_BUDGET = 60_000
/** Maximum bytes accepted for a JSON projection. */
export const MAX_JSON_BYTES = 16 * 1024 * 1024

export const ReadSchema = Type.Object(
  {
    path: Type.Optional(
      Type.String({ description: 'Path to the file to read (relative or absolute)' }),
    ),
    paths: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Read several files in one call, in order. Use it instead of one read call per file. An optional limit caps the lines returned per file.',
        maxItems: MAX_READ_PATHS,
        minItems: 1,
      }),
    ),
    offset: Type.Optional(
      Type.Number({ description: 'Line number to start reading from (1-indexed)' }),
    ),
    limit: Type.Optional(Type.Number({ description: 'Maximum number of lines to read' })),
    json: Type.Optional(
      Type.Union([Type.String(), Type.Array(Type.String(), { maxItems: 16, minItems: 1 })], {
        description:
          'Select part of a JSON file before any truncation, for example ".items[0:10]", ".report.total", or ".items.length".',
      }),
    ),
  },
  { additionalProperties: false },
)

export type ReadInput = Static<typeof ReadSchema>

const ReadFileOutputSchema = Type.Object(
  {
    path: Type.String(),
    text: Type.String({
      description: 'Text returned to the model for the file, including any continuation notice.',
    }),
    images: Type.Number({ description: 'Image blocks returned to the model for the file.' }),
    bounded: Type.Boolean({
      description: 'Whether a large file returned only its head and a declaration map.',
    }),
  },
  { additionalProperties: false },
)

export const ReadOutputSchema = Type.Object(
  {
    files: Type.Array(ReadFileOutputSchema),
    unread: Type.Array(Type.String(), {
      description: 'Paths left unread because the multi-path budget was reached.',
    }),
    value: Type.Optional(
      Type.Unknown({
        description:
          'Selected JSON value. One selector returns its value, several return an array of values.',
      }),
    ),
  },
  { additionalProperties: false },
)

type JsonValue = Exclude<AgentToolResult['structuredContent'], undefined>
type ReadFileOutput = Static<typeof ReadFileOutputSchema>
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

export class ReadInputError extends Error {}

/** Reject option combinations that would otherwise produce a silently wrong result. */
export function assertReadInput(input: ReadInput): void {
  if ((input.path === undefined) === (input.paths === undefined)) {
    throw new ReadInputError('Pass either path or paths, not both.')
  }
  if (input.paths !== undefined) {
    if (input.offset !== undefined) {
      throw new ReadInputError(
        'A multi-path read takes no offset, because one offset cannot address several files. Pass limit for a per-file cap, or read one path for a window.',
      )
    }
    if (input.json !== undefined) {
      throw new ReadInputError(
        'A multi-path read takes no json selector. Read one file for a projection.',
      )
    }
    if (new Set(input.paths).size !== input.paths.length) {
      throw new ReadInputError('A multi-path read lists each path once.')
    }
  }
  if (input.json !== undefined && (input.offset !== undefined || input.limit !== undefined)) {
    throw new ReadInputError('A json selector takes no offset or limit.')
  }
}

/** Apply every selector to one parsed JSON document. */
export function projectJson(content: string, json: string | readonly string[]): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    throw new ReadInputError(
      `The file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const selectors = Array.isArray(json) ? json : [json]
  try {
    const selected = selectors.map((selector) => selectJson({ value: parsed }, selector).value)
    return JSON.stringify(selectors.length === 1 ? selected[0] : selected, null, 2) ?? 'undefined'
  } catch (error) {
    if (error instanceof SelectorError) throw new ReadInputError(error.message)
    throw error
  }
}

type ReadDefinition = ReturnType<typeof createReadToolDefinition>
type Block = Awaited<ReturnType<ReadDefinition['execute']>>['content'][number]

function readFileOutput(path: string, blocks: readonly Block[], bounded: boolean): ReadFileOutput {
  let images = 0
  const text: string[] = []
  for (const block of blocks) {
    if (block.type === 'text') text.push(block.text)
    else images += 1
  }
  return { bounded, images, path, text: text.join('\n') }
}

function parseProjection(text: string): JsonValue {
  const value: JsonValue = JSON.parse(text)
  return value
}

/**
 * Replace the native read tool with a bounded reader.
 *
 * The tool keeps the native name and the native single-file behavior, so recorded `read` receipts
 * stay valid. It adds three bounded extensions: a head plus a file map for a large file, several
 * paths in one call, and a JSON projection applied before any truncation.
 */
export function createBoundedReadTool(cwd: string): ToolDefinition<typeof ReadSchema> {
  const native = createReadToolDefinition(cwd)
  const readOne = async (
    toolCallId: string,
    input: ReadToolInput,
    signal: AbortSignal | undefined,
    onUpdate: Parameters<typeof native.execute>[3],
    ctx: Parameters<typeof native.execute>[4],
  ): Promise<{ blocks: readonly Block[]; bounded: boolean }> => {
    const plan = await boundedReadPlan(input, ctx.cwd)
    if (plan === undefined) {
      const result = await native.execute(toolCallId, input, signal, onUpdate, ctx)
      return { blocks: result.content, bounded: false }
    }
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
      blocks: [
        ...result.content,
        { text: outlineNotice(input.path, outline, returnedLines, plan.bytes), type: 'text' },
      ],
      bounded: true,
    }
  }
  return defineTool({
    annotations: { openWorldHint: false, readOnlyHint: true },
    description: `${native.description} Large files return a bounded head plus a map of declarations. Pass paths to read several files in one call, or json to select part of a JSON document before truncation.`,
    async execute(toolCallId, input, signal, onUpdate, ctx) {
      assertReadInput(input)
      if (input.json !== undefined && input.path !== undefined) {
        const target = absolutePath(input.path, ctx.cwd)
        const info = await stat(target)
        if (info.size > MAX_JSON_BYTES) {
          throw new ReadInputError(
            `The file is ${info.size} bytes, above the ${MAX_JSON_BYTES} byte JSON limit. Use bash with a streaming parser.`,
          )
        }
        const text = projectJson(await readFile(target, 'utf8'), input.json)
        return {
          content: [{ text, type: 'text' }],
          details: { path: input.path },
          structuredContent: {
            files: [{ bounded: false, images: 0, path: input.path, text }],
            unread: [],
            value: parseProjection(text),
          },
        }
      }
      if (input.path !== undefined) {
        const result = await readOne(
          toolCallId,
          { ...input, path: input.path },
          signal,
          onUpdate,
          ctx,
        )
        return {
          content: [...result.blocks],
          details: { path: input.path },
          structuredContent: {
            files: [readFileOutput(input.path, result.blocks, result.bounded)],
            unread: [],
          },
        }
      }
      const paths = input.paths ?? []
      const blocks: Block[] = []
      const files: ReadFileOutput[] = []
      let used = 0
      let readPaths = 0
      for (const path of paths) {
        if (used >= MULTI_READ_BUDGET) break
        let result: { blocks: readonly Block[]; bounded: boolean }
        const window =
          input.limit === undefined ? { path } : { limit: input.limit, offset: 1, path }
        try {
          result = await readOne(toolCallId, window, signal, onUpdate, ctx)
        } catch (error) {
          throw new Error(
            `Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        files.push(readFileOutput(path, result.blocks, result.bounded))
        blocks.push({ text: `===== ${path} =====`, type: 'text' })
        for (const block of result.blocks) {
          blocks.push(block)
          if (block.type === 'text') used += block.text.length
        }
        readPaths += 1
      }
      if (readPaths < paths.length) {
        const remaining = paths.slice(readPaths)
        blocks.push({
          text: `[read budget reached after ${readPaths} of ${paths.length} files. Read these separately: ${remaining.join(', ')}]`,
          type: 'text',
        })
      }
      return {
        content: blocks,
        details: { paths: paths.slice(0, readPaths) },
        structuredContent: { files, unread: paths.slice(readPaths) },
      }
    },
    label: 'read',
    name: 'read',
    outputSchema: ReadOutputSchema,
    parameters: ReadSchema,
    promptGuidelines: [
      ...(native.promptGuidelines ?? []),
      'Search before reading, and read a bounded window of a large file.',
      'After a bounded head and file map, continue at the offset the result names.',
      'Read several files in one call with paths instead of one read call per file.',
      'Select fields of a large JSON file with json instead of reading the whole document.',
    ],
    promptSnippet: native.promptSnippet ?? 'Read file contents',
  })
}
