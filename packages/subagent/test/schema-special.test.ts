import { describe, expect, it } from 'vite-plus/test'

import {
  decodeBatchTaskInput,
  decodeJsonValue,
  decodeSingleTaskInput,
  isJsonObject,
} from '../src/schema.ts'

describe('JSON data decoding', () => {
  it('preserves JSON schemas and gate values across Task dispatch decoding', () => {
    const schema = decodeJsonValue(
      JSON.parse('{"properties":{"__proto__":{"type":"string"},"constructor":{"type":"null"}}}'),
    )
    const value = decodeJsonValue(JSON.parse('{"__proto__":"safe","constructor":null}'))
    const input = {
      description: 'Special keys',
      prompt: 'Return JSON',
      subagent_type: 'explore',
      outputSchema: schema,
      gates: [{ type: 'json-pointer', op: 'eq', path: '', value }],
    }
    expect(decodeSingleTaskInput(input).outputSchema).toEqual(schema)
    expect(decodeSingleTaskInput(input).gates).toEqual(input.gates)
    const batch = decodeBatchTaskInput({ tasks: [{ ...input, id: 'special' }] })
    expect(batch.tasks[0]?.outputSchema).toEqual(schema)
    expect(batch.tasks[0]?.gates).toEqual(input.gates)
  })
  it('preserves special own keys without changing the object prototype', () => {
    const raw =
      '{"__proto__":{"sentinel":true},"constructor":null,"toString":false,"nested":[{"__proto__":"value"}]}'
    const decoded = decodeJsonValue(JSON.parse(raw))
    expect(JSON.stringify(decoded)).toBe(raw)
    if (!isJsonObject(decoded)) throw new Error('The decoded object is missing.')
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype)
    expect(Object.hasOwn(decoded, '__proto__')).toBe(true)
    expect(Object.hasOwn(decoded, 'constructor')).toBe(true)
  })
})
