const openers = new Map([
  ['{', '}'],
  ['[', ']'],
  ['(', ')'],
])
const closers = new Set(['}', ']', ')'])

const codeExtensions = new Set([
  '.c',
  '.cc',
  '.cjs',
  '.cpp',
  '.cs',
  '.css',
  '.cts',
  '.go',
  '.h',
  '.hpp',
  '.java',
  '.js',
  '.jsx',
  '.kt',
  '.mjs',
  '.mts',
  '.rs',
  '.scss',
  '.swift',
  '.ts',
  '.tsx',
])

const regexPreceders = new Set([
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '<',
  '>',
  '~',
  '^',
  'return',
  'typeof',
  'case',
  'do',
  'else',
  'in',
  'of',
  'yield',
  'await',
])

export interface StructureProblem {
  kind: 'balance' | 'json'
  message: string
}

function lineOf(text: string, index: number): number {
  let line = 1
  for (let position = 0; position < index && position < text.length; position += 1) {
    if (text[position] === '\n') line += 1
  }
  return line
}

function skipString(text: string, start: number, quote: string): number {
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index]
    if (character === '\\') {
      index += 1
      continue
    }
    if (character === quote) return index + 1
    if (character === '\n') return -1
  }
  return -1
}

function skipTemplate(text: string, start: number): number {
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index]
    if (character === '\\') {
      index += 1
      continue
    }
    if (character === '`') return index + 1
    if (character === '$' && text[index + 1] === '{') {
      let depth = 1
      let inner = index + 2
      while (inner < text.length && depth > 0) {
        const next = text[inner]
        if (next === '{') depth += 1
        else if (next === '}') depth -= 1
        else if (next === '"' || next === "'") {
          const end = skipString(text, inner, next)
          if (end < 0) return -1
          inner = end - 1
        } else if (next === '`') {
          const end = skipTemplate(text, inner)
          if (end < 0) return -1
          inner = end - 1
        }
        inner += 1
      }
      if (depth > 0) return -1
      index = inner - 1
    }
  }
  return -1
}

function skipComment(text: string, start: number): number {
  if (text[start + 1] === '/') {
    const newline = text.indexOf('\n', start)
    return newline < 0 ? text.length : newline
  }
  const end = text.indexOf('*/', start + 2)
  return end < 0 ? -1 : end + 2
}

function skipRegex(text: string, start: number): number {
  let inClass = false
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index]
    if (character === '\\') {
      index += 1
      continue
    }
    if (character === '\n') return -1
    if (character === '[') inClass = true
    else if (character === ']') inClass = false
    else if (character === '/' && !inClass) return index + 1
  }
  return -1
}

function identifierEnd(text: string, start: number): number {
  let index = start + 1
  while (index < text.length && /[\w$]/.test(text[index] ?? '')) index += 1
  return index
}

function balanceProblem(text: string): StructureProblem | undefined {
  const stack: { at: number; character: string }[] = []
  let previous = ''
  let index = 0
  while (index < text.length) {
    const character = text[index] ?? ''
    if (character === '"' || character === "'") {
      const end = skipString(text, index, character)
      if (end < 0) {
        return { kind: 'balance', message: `unterminated string at line ${lineOf(text, index)}` }
      }
      index = end
      previous = 'value'
      continue
    }
    if (character === '`') {
      const end = skipTemplate(text, index)
      if (end < 0) {
        return {
          kind: 'balance',
          message: `unterminated template literal at line ${lineOf(text, index)}`,
        }
      }
      index = end
      previous = 'value'
      continue
    }
    if (character === '/' && (text[index + 1] === '/' || text[index + 1] === '*')) {
      const end = skipComment(text, index)
      if (end < 0) {
        return { kind: 'balance', message: `unterminated comment at line ${lineOf(text, index)}` }
      }
      index = end
      continue
    }
    if (character === '/' && regexPreceders.has(previous)) {
      const end = skipRegex(text, index)
      if (end > 0) {
        index = end
        previous = 'value'
        continue
      }
    }
    if (/[A-Za-z_$]/.test(character)) {
      const end = identifierEnd(text, index)
      previous = text.slice(index, end)
      index = end
      continue
    }
    if (openers.has(character)) {
      stack.push({ at: index, character })
    } else if (closers.has(character)) {
      const top = stack.pop()
      if (top === undefined || openers.get(top.character) !== character) {
        return {
          kind: 'balance',
          message: `unexpected "${character}" at line ${lineOf(text, index)}`,
        }
      }
    }
    if (!/\s/.test(character)) previous = character
    index += 1
  }
  const unclosed = stack.at(-1)
  if (unclosed !== undefined) {
    return {
      kind: 'balance',
      message: `unclosed "${unclosed.character}" opened at line ${lineOf(text, unclosed.at)}`,
    }
  }
  return undefined
}

/** Files above this size skip the check, because the scan is linear in the file length. */
export const STRUCTURE_CHECK_MAX_CHARS = 512_000

/**
 * Report the edit failures that a type check would catch minutes later.
 *
 * The scan is textual and skips strings, templates, comments, and regular expressions. It never
 * replaces a compiler, so it reports a problem and stays silent when the language is unknown.
 */
export function structureProblem(text: string, extension: string): StructureProblem | undefined {
  const normalized = extension.toLowerCase()
  if (text.length > STRUCTURE_CHECK_MAX_CHARS) return undefined
  if (normalized === '.json') {
    try {
      JSON.parse(text)
      return undefined
    } catch (error) {
      return { kind: 'json', message: error instanceof Error ? error.message : String(error) }
    }
  }
  if (!codeExtensions.has(normalized)) return undefined
  return balanceProblem(text)
}
