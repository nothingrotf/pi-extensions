import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { type Static, Type } from 'typebox'
import { Value } from 'typebox/value'

import {
  type ArtifactRef,
  type GateDefinition,
  type GateResult,
  decodeJsonValue,
  isJsonBoolean,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  type JsonObject,
  type JsonValue,
  type SchemaMode,
  type StructuredOutput,
} from './schema.ts'

const StringArraySchema = Type.Array(Type.String())
type StringArray = Static<typeof StringArraySchema>

type ParsedSchema =
  | { kind: 'any' }
  | { kind: 'all'; schemas: readonly ParsedSchema[] }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'enum'; values: readonly JsonValue[] }
  | {
      kind: 'typed'
      schemaType: 'array' | 'boolean' | 'integer' | 'null' | 'number' | 'object' | 'string'
      items?: ParsedSchema
      properties: ReadonlyMap<string, ParsedSchema>
      required: ReadonlySet<string>
      additionalProperties: boolean
    }

export interface OutputPolicyResult {
  artifact: ArtifactRef | undefined
  gateResults: GateResult[]
  output: string
  structuredOutput: StructuredOutput | undefined
  succeeded: boolean
  error: string | undefined
}

function entries(value: JsonObject): [string, JsonValue][] {
  return Object.entries(value)
}

function field(value: JsonObject, name: string): JsonValue | undefined {
  return entries(value).find(([key]) => key === name)?.[1]
}

function parseStringArray(value: JsonValue, label: string): StringArray {
  try {
    return Value.Decode(StringArraySchema, value)
  } catch {
    throw new Error(`${label} must be an array of strings.`)
  }
}

function parseSchema(value: JsonValue): ParsedSchema {
  if (isJsonBoolean(value)) return { kind: 'boolean', value }
  if (!isJsonObject(value)) {
    throw new Error('The output schema must be a JSON Schema object or boolean.')
  }
  const supported = new Set([
    'additionalProperties',
    'enum',
    'items',
    'properties',
    'required',
    'type',
  ])
  for (const [key] of entries(value)) {
    if (!supported.has(key)) throw new Error(`The output schema keyword "${key}" is unsupported.`)
  }
  const constraints: ParsedSchema[] = []
  const enumValue = field(value, 'enum')
  if (enumValue !== undefined) {
    if (!Array.isArray(enumValue) || enumValue.length === 0) {
      throw new Error('The output schema enum must be a non-empty array.')
    }
    constraints.push({ kind: 'enum', values: enumValue })
  }
  const typeValue = field(value, 'type')
  if (typeValue === undefined) {
    if (
      field(value, 'additionalProperties') !== undefined ||
      field(value, 'items') !== undefined ||
      field(value, 'properties') !== undefined ||
      field(value, 'required') !== undefined
    ) {
      throw new Error('The output schema requires type for structural constraints.')
    }
    if (constraints.length === 0) return { kind: 'any' }
    const only = constraints[0]
    if (only === undefined) throw new Error('The output schema constraint is unavailable.')
    return only
  }
  if (
    typeValue !== 'array' &&
    typeValue !== 'boolean' &&
    typeValue !== 'integer' &&
    typeValue !== 'null' &&
    typeValue !== 'number' &&
    typeValue !== 'object' &&
    typeValue !== 'string'
  ) {
    throw new Error(`The output schema type ${JSON.stringify(typeValue)} is unsupported.`)
  }
  const properties = new Map<string, ParsedSchema>()
  const propertiesValue = field(value, 'properties')
  if (propertiesValue !== undefined) {
    if (typeValue !== 'object') {
      throw new Error('The output schema properties keyword requires object type.')
    }
    if (!isJsonObject(propertiesValue)) {
      throw new Error('The output schema properties value must be an object.')
    }
    for (const [key, propertySchema] of entries(propertiesValue)) {
      properties.set(key, parseSchema(propertySchema))
    }
  }
  const requiredValue = field(value, 'required')
  if (requiredValue !== undefined && typeValue !== 'object') {
    throw new Error('The output schema required keyword requires object type.')
  }
  const requiredItems =
    requiredValue === undefined
      ? []
      : parseStringArray(requiredValue, 'The output schema required value')
  const required = new Set(requiredItems)
  if (required.size !== requiredItems.length) {
    throw new Error('The output schema required value contains a duplicate property.')
  }
  const additionalValue = field(value, 'additionalProperties')
  if (additionalValue !== undefined && typeValue !== 'object') {
    throw new Error('The output schema additionalProperties keyword requires object type.')
  }
  if (additionalValue !== undefined && !isJsonBoolean(additionalValue)) {
    throw new Error('The output schema additionalProperties value must be boolean.')
  }
  const itemsValue = field(value, 'items')
  if (itemsValue !== undefined && typeValue !== 'array') {
    throw new Error('The output schema items keyword requires array type.')
  }
  const items = itemsValue === undefined ? undefined : parseSchema(itemsValue)
  const parsed: ParsedSchema = {
    additionalProperties: additionalValue !== false,
    kind: 'typed',
    properties,
    required,
    schemaType: typeValue,
  }
  if (items !== undefined) parsed.items = items
  constraints.push(parsed)
  return constraints.length === 1 ? parsed : { kind: 'all', schemas: constraints }
}

export function jsonEquals(left: JsonValue, right: JsonValue): boolean {
  if (left === null || right === null) return left === right
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((item, index) => {
      const candidate = right[index]
      return candidate !== undefined && jsonEquals(item, candidate)
    })
  }
  if (isJsonObject(left) || isJsonObject(right)) {
    if (!isJsonObject(left) || !isJsonObject(right)) return false
    const leftEntries = entries(left)
    const rightEntries = new Map(entries(right))
    if (leftEntries.length !== rightEntries.size) return false
    return leftEntries.every(([key, item]) => {
      const candidate = rightEntries.get(key)
      return candidate !== undefined && jsonEquals(item, candidate)
    })
  }
  return left === right
}

function validateParsed(schema: ParsedSchema, value: JsonValue, path: string): string | undefined {
  if (schema.kind === 'any') return undefined
  if (schema.kind === 'all') {
    for (const constraint of schema.schemas) {
      const error = validateParsed(constraint, value, path)
      if (error !== undefined) return error
    }
    return undefined
  }
  if (schema.kind === 'boolean')
    return schema.value ? undefined : `${path} is rejected by the schema.`
  if (schema.kind === 'enum') {
    return schema.values.some((candidate) => jsonEquals(candidate, value))
      ? undefined
      : `${path} is not an allowed enum value.`
  }
  if (schema.schemaType === 'null') return value === null ? undefined : `${path} must be null.`
  if (schema.schemaType === 'array') {
    if (!Array.isArray(value)) return `${path} must be an array.`
    if (schema.items === undefined) return undefined
    for (const [index, item] of value.entries()) {
      const error = validateParsed(schema.items, item, `${path}/${index}`)
      if (error !== undefined) return error
    }
    return undefined
  }
  if (schema.schemaType === 'object') {
    if (!isJsonObject(value)) {
      return `${path} must be an object.`
    }
    const valueEntries = entries(value)
    const valueKeys = new Set(valueEntries.map(([key]) => key))
    for (const required of schema.required) {
      if (!valueKeys.has(required)) return `${path}/${required} is required.`
    }
    for (const [key, item] of valueEntries) {
      const propertySchema = schema.properties.get(key)
      if (propertySchema === undefined) {
        if (!schema.additionalProperties) return `${path}/${key} is not allowed.`
        continue
      }
      const error = validateParsed(propertySchema, item, `${path}/${key}`)
      if (error !== undefined) return error
    }
    return undefined
  }
  if (schema.schemaType === 'string') {
    return isJsonString(value) ? undefined : `${path} must be a string.`
  }
  if (schema.schemaType === 'boolean') {
    return isJsonBoolean(value) ? undefined : `${path} must be boolean.`
  }
  if (schema.schemaType === 'integer') {
    return isJsonNumber(value) && Number.isInteger(value)
      ? undefined
      : `${path} must be an integer.`
  }
  return isJsonNumber(value) && Number.isFinite(value) ? undefined : `${path} must be a number.`
}

export function validateOutputSchema(schema: JsonValue): void {
  parseSchema(schema)
}

function stripJsonFence(output: string): string {
  const trimmed = output.trim()
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return match?.[1] ?? trimmed
}

export function resolveStructuredOutput(
  output: string,
  schema: JsonValue | undefined,
  mode: SchemaMode,
): StructuredOutput | undefined {
  if (schema === undefined) return undefined
  let data: JsonValue
  try {
    data = decodeJsonValue(JSON.parse(stripJsonFence(output)))
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      mode,
      source: 'caller',
      status: 'unavailable',
    }
  }
  const validationError = validateParsed(parseSchema(schema), data, '#')
  if (validationError === undefined) {
    return { data, mode, source: 'caller', status: 'valid' }
  }
  return { data, error: validationError, mode, source: 'caller', status: 'invalid' }
}

function pointerValue(
  data: JsonValue | undefined,
  pointer: string,
): { found: false } | { found: true; value: JsonValue } {
  if (pointer === '') return data === undefined ? { found: false } : { found: true, value: data }
  if (!pointer.startsWith('/') || data === undefined) return { found: false }
  let current: JsonValue = data
  for (const encoded of pointer.slice(1).split('/')) {
    const segment = encoded.replaceAll('~1', '/').replaceAll('~0', '~')
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { found: false }
      }
      const item = current[index]
      if (item === undefined) return { found: false }
      current = item
      continue
    }
    if (!isJsonObject(current)) return { found: false }
    const match = entries(current).find(([key]) => key === segment)
    if (match === undefined) return { found: false }
    current = match[1]
  }
  return current === undefined ? { found: false } : { found: true, value: current }
}

function evaluateGate(
  gate: GateDefinition,
  status: 'completed' | 'failed' | 'aborted',
  structuredOutput: StructuredOutput | undefined,
  artifact: ArtifactRef | undefined,
): GateResult {
  if (gate.type === 'status') {
    return { gate, passed: status === gate.expected }
  }
  if (gate.type === 'schema-valid') {
    const result: GateResult = { gate, passed: structuredOutput?.status === 'valid' }
    if (structuredOutput === undefined) result.error = 'No structured output exists.'
    else if (structuredOutput.error !== undefined) result.error = structuredOutput.error
    return result
  }
  if (gate.type === 'artifact-present') {
    const passed =
      artifact !== undefined &&
      (gate.mediaType === undefined || artifact.mediaType === gate.mediaType)
    return { gate, passed }
  }
  const pointed = pointerValue(structuredOutput?.data, gate.path)
  if (gate.op === 'exists') return { gate, passed: pointed.found }
  if (gate.op === 'eq')
    return { gate, passed: pointed.found && jsonEquals(pointed.value, gate.value) }
  return {
    gate,
    passed: pointed.found && gate.values.some((candidate) => jsonEquals(candidate, pointed.value)),
  }
}

export function evaluateGates(
  gates: readonly GateDefinition[],
  status: 'completed' | 'failed' | 'aborted',
  structuredOutput: StructuredOutput | undefined,
  artifact: ArtifactRef | undefined,
): GateResult[] {
  return gates.map((gate) => evaluateGate(gate, status, structuredOutput, artifact))
}

export async function publishOutputArtifact(options: {
  attempt: number
  output: string
  runId: string
  sessionFile: string
  taskId: string
}): Promise<ArtifactRef> {
  const directory = join(dirname(options.sessionFile), 'subagent-artifacts')
  await mkdir(directory, { recursive: true })
  const id = `${options.runId}-${options.taskId}-attempt-${options.attempt}-${randomUUID()}-output`
  const destination = join(directory, `${id}.md`)
  const temporary = join(directory, `.${id}-${randomUUID()}.tmp`)
  await writeFile(temporary, options.output, 'utf8')
  await rename(temporary, destination)
  const metadata = await stat(destination)
  const byteLength = Buffer.byteLength(options.output, 'utf8')
  if (metadata.size !== byteLength)
    throw new Error('The output artifact byte count does not match.')
  return {
    attempt: options.attempt,
    byteLength,
    id,
    lineCount: options.output.length === 0 ? 0 : options.output.split('\n').length,
    mediaType: 'text/markdown',
    runId: options.runId,
    sha256: createHash('sha256').update(options.output).digest('hex'),
    taskId: options.taskId,
    uri: pathToFileURL(destination).href,
  }
}

export async function readArtifact(artifact: ArtifactRef): Promise<string> {
  const content = await readFile(fileURLToPath(artifact.uri), 'utf8')
  const digest = createHash('sha256').update(content).digest('hex')
  if (digest !== artifact.sha256)
    throw new Error(`Artifact "${artifact.id}" failed digest verification.`)
  return content
}
