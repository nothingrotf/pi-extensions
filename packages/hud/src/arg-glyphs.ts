import { type Static, Type } from 'typebox'
import { Value } from 'typebox/value'

import { usesNerdIcons } from './icons.ts'

const eligibleTools = new Set([
  'analyze',
  'ast_edit',
  'edit',
  'edit_file',
  'editor',
  'editor_edit',
  'editor_read',
  'genome_impact',
  'multi_edit',
  'read',
  'refactor',
  'structural_edit',
  'undo_edit',
  'write',
])

const extensionTypes = new Map<string, string>([
  ['astro', 'astro'],
  ['avif', 'img'],
  ['bash', 'sh'],
  ['c', 'c'],
  ['cc', 'cpp'],
  ['cfg', 'cfg'],
  ['cjs', 'js'],
  ['conf', 'cfg'],
  ['cpp', 'cpp'],
  ['cs', 'cs'],
  ['css', 'css'],
  ['cts', 'ts'],
  ['csv', 'plain'],
  ['cxx', 'cpp'],
  ['diff', 'diff'],
  ['env', 'env'],
  ['fish', 'sh'],
  ['gif', 'img'],
  ['go', 'go'],
  ['gql', 'gql'],
  ['graphql', 'gql'],
  ['h', 'c'],
  ['hh', 'cpp'],
  ['hpp', 'cpp'],
  ['htm', 'html'],
  ['html', 'html'],
  ['ico', 'img'],
  ['ini', 'cfg'],
  ['java', 'java'],
  ['jpeg', 'img'],
  ['jpg', 'img'],
  ['js', 'js'],
  ['json', 'json'],
  ['json5', 'json'],
  ['jsonc', 'json'],
  ['jsx', 'jsx'],
  ['kt', 'kt'],
  ['kts', 'kt'],
  ['less', 'css'],
  ['lock', 'lock'],
  ['log', 'plain'],
  ['lua', 'lua'],
  ['md', 'md'],
  ['mdx', 'md'],
  ['mjs', 'js'],
  ['mts', 'ts'],
  ['patch', 'diff'],
  ['pcss', 'css'],
  ['php', 'php'],
  ['png', 'img'],
  ['proto', 'proto'],
  ['ps1', 'ps'],
  ['py', 'py'],
  ['pyi', 'py'],
  ['rb', 'rb'],
  ['rs', 'rs'],
  ['rst', 'md'],
  ['sass', 'css'],
  ['scss', 'css'],
  ['sh', 'sh'],
  ['sql', 'sql'],
  ['svelte', 'svelte'],
  ['svg', 'svg'],
  ['swift', 'swift'],
  ['toml', 'toml'],
  ['ts', 'ts'],
  ['tsx', 'tsx'],
  ['txt', 'plain'],
  ['vue', 'vue'],
  ['webp', 'img'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
  ['zsh', 'sh'],
])

const filenameTypes = new Map<string, string>([
  ['dockerfile', 'docker'],
  ['gitattributes', 'git'],
  ['gitignore', 'git'],
  ['license', 'plain'],
  ['makefile', 'make'],
])

const typeGlyphs = new Map<string, string>([
  ['astro', '\uE6B3'],
  ['c', '\uE61E'],
  ['cfg', '\uE615'],
  ['cpp', '\uE61D'],
  ['cs', '\u{F031B}'],
  ['css', '\uE749'],
  ['diff', '\uE728'],
  ['dir', '\uE5FF'],
  ['docker', '\uE650'],
  ['env', '\uE615'],
  ['git', '\uE702'],
  ['go', '\uE627'],
  ['gql', '\uE662'],
  ['html', '\uE736'],
  ['img', '\uF03E'],
  ['java', '\uE738'],
  ['js', '\uE781'],
  ['json', '\uE60B'],
  ['jsx', '\uE7BA'],
  ['kt', '\uE634'],
  ['lock', '\uF023'],
  ['lua', '\uE620'],
  ['make', '\uE673'],
  ['md', '\uE73E'],
  ['php', '\uE73D'],
  ['plain', '\uF0F6'],
  ['proto', '\uE60B'],
  ['ps', '\uEBC7'],
  ['py', '\uE73C'],
  ['rb', '\uE739'],
  ['rs', '\uE7A8'],
  ['sh', '\uE795'],
  ['sql', '\uE706'],
  ['svelte', '\uE697'],
  ['svg', '\uE60D'],
  ['swift', '\uE755'],
  ['toml', '\uE6B2'],
  ['ts', '\uE628'],
  ['tsx', '\uE7BA'],
  ['vue', '\uE6A0'],
  ['yaml', '\u{F0219}'],
])

const supportedArgumentGlyphs = new Set(typeGlyphs.values())

export function isArgumentGlyph(value: string): boolean {
  return supportedArgumentGlyphs.has(value)
}

const StringSchema = Type.String()
const PathObjectSchema = Type.Partial(
  Type.Object({
    file: Type.String(),
    filename: Type.String(),
    filePath: Type.String(),
    from: Type.String(),
    path: Type.String(),
    to: Type.String(),
  }),
)
const PathItemSchema = Type.Union([StringSchema, PathObjectSchema])
const PathListSchema = Type.Array(PathItemSchema)
const PathListInputSchema = Type.Union([StringSchema, PathListSchema])
const ArgumentsObjectSchema = Type.Partial(
  Type.Object({
    file: Type.String(),
    filePath: Type.String(),
    files: PathListInputSchema,
    from: Type.String(),
    path: Type.String(),
    paths: PathListInputSchema,
    to: Type.String(),
  }),
)

type PathObject = Static<typeof PathObjectSchema>
type PathItem = Static<typeof PathItemSchema>

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0
    if (point <= 31 || point === 127) return true
  }
  return false
}

function pathCandidate<Input>(value: Input): string | undefined {
  if (!Value.Check(StringSchema, value)) return undefined
  const path = value.trim()
  if (path.length === 0 || path.length > 260 || hasControlCharacter(path)) return undefined
  return path
}

function strictPathCandidate<Input>(value: Input): string | undefined {
  const path = pathCandidate(value)
  if (path === undefined) return undefined
  return path.includes('/') || path.includes('\\') || /\.[A-Za-z0-9]{1,8}$/u.test(path)
    ? path
    : undefined
}

function arrayValue<Input>(value: Input): readonly PathItem[] | undefined {
  if (Value.Check(PathListSchema, value)) return value
  if (!Value.Check(StringSchema, value)) return undefined
  if (!value.trim().startsWith('[')) {
    const path = pathCandidate(value)
    return path === undefined ? undefined : [path]
  }
  try {
    return Value.Decode(PathListSchema, JSON.parse(value))
  } catch {
    return undefined
  }
}

function objectPath(value: PathObject): string | undefined {
  for (const candidate of [value.path, value.file, value.filePath, value.filename]) {
    const path = pathCandidate(candidate)
    if (path !== undefined) return path
  }
  return undefined
}

export function extractArgumentPaths<Input>(input: Input): string[] {
  if (Value.Check(StringSchema, input)) {
    const path = strictPathCandidate(input)
    return path === undefined ? [] : [path]
  }
  if (!Value.Check(ArgumentsObjectSchema, input)) return []
  const paths: string[] = []
  const add = (path: string | undefined) => {
    if (path !== undefined && !paths.includes(path)) paths.push(path)
  }
  for (const listed of [arrayValue(input.files), arrayValue(input.paths)]) {
    for (const value of listed ?? []) {
      if (Value.Check(StringSchema, value)) add(pathCandidate(value))
      else add(objectPath(value))
    }
  }
  if (paths.length === 0) {
    for (const value of [input.path, input.file, input.filePath, input.from, input.to]) {
      add(pathCandidate(value))
    }
  }
  return paths
}

export function fileTypeKey(path: string): string {
  if (/[/\\]$/u.test(path)) return 'dir'
  const trimmed = path.replace(/[/\\]+$/u, '')
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  const name = (separator < 0 ? trimmed : trimmed.slice(separator + 1)).toLowerCase()
  if (name.length === 0) return 'dir'
  const exact = filenameTypes.get(name) ?? filenameTypes.get(name.replace(/^\./u, ''))
  if (exact !== undefined) return exact
  const parts = name.split('.')
  for (let index = 1; index < parts.length; index += 1) {
    const type = extensionTypes.get(parts.slice(index).join('.'))
    if (type !== undefined) return type
  }
  if (parts[0] === '' && parts[1] !== undefined) return extensionTypes.get(parts[1]) ?? 'plain'
  return 'plain'
}

export function argumentGlyphs<Input>(toolName: string, args: Input): string[] {
  if (!usesNerdIcons() || !eligibleTools.has(toolName)) return []
  const glyphs: string[] = []
  for (const path of extractArgumentPaths(args)) {
    const glyph = typeGlyphs.get(fileTypeKey(path))
    if (glyph === undefined || glyphs.includes(glyph)) continue
    glyphs.push(glyph)
    if (glyphs.length === 3) break
  }
  return glyphs
}
