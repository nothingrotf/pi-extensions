import { Type } from 'typebox'
import { Value } from 'typebox/value'

export class SelectorError extends Error {}

/** A parsed JSON document or any value selected from one. */
export interface JsonDocument {
  value: unknown
}

type Step =
  | { key: string; kind: 'key' }
  | { index: number; kind: 'index' }
  | { end: number; kind: 'slice'; start: number }
  | { kind: 'length' }

const ArraySchema = Type.Array(Type.Unknown())
const StringSchema = Type.String()

function parseSteps(selector: string): readonly Step[] {
  if (selector === '.') return []
  if (!selector.startsWith('.')) {
    throw new SelectorError(`Selector "${selector}" must start with ".".`)
  }
  const steps: Step[] = []
  let position = 1
  while (position < selector.length) {
    if (selector[position] === '[') {
      const close = selector.indexOf(']', position)
      if (close < 0) throw new SelectorError(`Selector "${selector}" has an unclosed bracket.`)
      const inner = selector.slice(position + 1, close)
      position = close + 1
      if (selector[position] === '.') position += 1
      const quoted = /^"(.*)"$/.exec(inner)
      if (quoted !== null) {
        steps.push({ key: quoted[1] ?? '', kind: 'key' })
        continue
      }
      const slice = /^(\d+):(\d+)$/.exec(inner)
      if (slice !== null) {
        steps.push({ end: Number(slice[2]), kind: 'slice', start: Number(slice[1]) })
        continue
      }
      if (!/^\d+$/.test(inner)) {
        throw new SelectorError(
          `Selector "${selector}" supports an index, a start:end slice, or a quoted key, not "${inner}".`,
        )
      }
      steps.push({ index: Number(inner), kind: 'index' })
      continue
    }
    const match = /^[A-Za-z_$][\w$:@/-]*/.exec(selector.slice(position))
    if (match === null) {
      throw new SelectorError(
        `Selector "${selector}" has an invalid field at position ${position}. Wrap an unusual key as .["key"].`,
      )
    }
    const field = match[0]
    position += field.length
    if (selector[position] === '.') position += 1
    else if (position < selector.length && selector[position] !== '[') {
      throw new SelectorError(
        `Selector "${selector}" has an invalid field at position ${position}. Wrap an unusual key as .["key"].`,
      )
    }
    steps.push(field === 'length' ? { kind: 'length' } : { key: field, kind: 'key' })
  }
  return steps
}

function selectKey(document: JsonDocument, key: string, selector: string): JsonDocument {
  const schema = Type.Object({ [key]: Type.Unknown() }, { additionalProperties: true })
  if (!Value.Check(schema, document.value)) {
    throw new SelectorError(`Selector "${selector}" has no key "${key}".`)
  }
  return { value: document.value[key] }
}

function selectLength(document: JsonDocument, selector: string): JsonDocument {
  if (Value.Check(ArraySchema, document.value)) return { value: document.value.length }
  if (Value.Check(StringSchema, document.value)) return { value: document.value.length }
  throw new SelectorError(`Selector "${selector}" reads length from a value that has none.`)
}

function selectArray(document: JsonDocument, step: Step, selector: string): JsonDocument {
  if (!Value.Check(ArraySchema, document.value)) {
    throw new SelectorError(`Selector "${selector}" indexes a value that is not an array.`)
  }
  const items = document.value
  if (step.kind === 'index') {
    if (step.index >= items.length) {
      throw new SelectorError(`Selector "${selector}" is beyond the array length ${items.length}.`)
    }
    return { value: items[step.index] }
  }
  if (step.kind !== 'slice') throw new SelectorError(`Selector "${selector}" is invalid.`)
  if (step.end < step.start) {
    throw new SelectorError(`Selector "${selector}" has an end before its start.`)
  }
  return { value: items.slice(step.start, Math.min(step.end, items.length)) }
}

/**
 * Select a bounded part of a parsed JSON document.
 *
 * The selector language stays small on purpose: a field, an index, a start:end slice, a quoted
 * key, and the array length. Anything else fails instead of returning a silently wrong value.
 */
export function selectJson(document: JsonDocument, selector: string): JsonDocument {
  let current = document
  for (const step of parseSteps(selector)) {
    if (step.kind === 'length') current = selectLength(current, selector)
    else if (step.kind === 'key') current = selectKey(current, step.key, selector)
    else current = selectArray(current, step, selector)
  }
  return current
}
