import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

export const CONTEXT_FILE_NAMES = [
  'AGENTS.override.md',
  'AGENTS.md',
  'AGENTS.MD',
  'CLAUDE.md',
  'CLAUDE.MD',
] as const

const PathInput = Type.Object({ path: Type.String({ minLength: 1 }) })
const PathsInput = Type.Object({ paths: Type.Array(Type.String({ minLength: 1 })) })
const FilesInput = Type.Object({
  files: Type.Array(Type.Object({ path: Type.String({ minLength: 1 }) })),
})

const pathTools = new Set(['edit', 'find', 'grep', 'ls', 'read', 'write'])

/** Paths that one tool call touched, taken from its arguments, never from its output. */
export function touchedPaths<Input>(toolName: string, input: Input): string[] {
  const paths: string[] = []
  if (pathTools.has(toolName) && Value.Check(PathInput, input)) paths.push(input.path)
  if (toolName === 'read' && Value.Check(PathsInput, input)) paths.push(...input.paths)
  if (toolName === 'patch' && Value.Check(FilesInput, input)) {
    for (const file of input.files) paths.push(file.path)
  }
  return paths
}

export interface ContextFile {
  /** Path relative to the session root, with forward slashes. */
  path: string
  content: string
  sha256: string
}

export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function stripBom(content: string): string {
  return content.startsWith('\uFEFF') ? content.slice(1) : content
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** The first context file of a directory, in the same order Pi uses for project directories. */
export async function contextFileIn(directory: string): Promise<string | undefined> {
  for (const name of CONTEXT_FILE_NAMES) {
    const candidate = join(directory, name)
    if (await isFile(candidate)) return candidate
  }
  return undefined
}

/** Context files of a directory and its ancestors, the project files that Pi loads itself. */
export async function ancestorContextFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  let current = resolve(directory)
  while (true) {
    const file = await contextFileIn(current)
    if (file !== undefined) files.push(file)
    const parent = dirname(current)
    if (parent === current) return files
    current = parent
  }
}

/** The nearest existing path, so a write into a new directory still finds its parents. */
async function existingPath(path: string): Promise<string | undefined> {
  let current = path
  while (true) {
    try {
      return await realpath(current)
    } catch {
      const parent = dirname(current)
      if (parent === current) return undefined
      current = parent
    }
  }
}

function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`)
}

/**
 * Directories strictly below the root that lead to the touched path, outer first.
 *
 * Pi already loads the root and its ancestors. Symlinks resolve before the check, so a link
 * that leaves the root yields nothing.
 */
export async function directoryChain(root: string, touched: string): Promise<string[]> {
  const absolute = isAbsolute(touched) ? touched : resolve(root, touched)
  const real = await existingPath(absolute)
  if (real === undefined || !inside(root, real)) return []
  const target = (await isDirectory(real)) ? real : dirname(real)
  const chain: string[] = []
  let current = target
  while (current !== root && inside(root, current)) {
    chain.unshift(current)
    current = dirname(current)
  }
  return chain
}

function displayPath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}

/** Context files of the directories that the touched paths lead to, outer first, without repeats. */
export async function discoverContextFiles(
  root: string,
  touched: readonly string[],
): Promise<ContextFile[]> {
  const seen = new Set<string>()
  const files: ContextFile[] = []
  for (const path of touched) {
    for (const directory of await directoryChain(root, path)) {
      const file = await contextFileIn(directory)
      if (file === undefined || seen.has(file)) continue
      seen.add(file)
      const real = await realpath(file)
      if (!inside(root, real)) continue
      const content = stripBom(await readFile(real, 'utf8'))
      files.push({ content, path: displayPath(root, file), sha256: contentHash(content) })
    }
  }
  return files
}
