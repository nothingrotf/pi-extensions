import { createServer } from 'node:http'

import { type Model, normalizeContext, type TSchema } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/api/anthropic-messages'
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { describe, expect, test } from 'vite-plus/test'

import { TaskControlInputSchema } from '../src/control.ts'
import { TaskInputSchema } from '../src/schema.ts'
import { toolInputUnion } from '../src/tool-schema.ts'

const AnthropicToolSchema = Type.Object({
  name: Type.String(),
  input_schema: Type.Object({
    properties: Type.Record(Type.String(), Type.Unknown()),
    required: Type.Array(Type.String()),
  }),
})
const AnthropicRequestSchema = Type.Object({ tools: Type.Array(AnthropicToolSchema) })

async function anthropicToolSchemas(tools: { name: string; parameters: TSchema }[]) {
  let request: unknown
  const server = createServer((incoming, response) => {
    const chunks: Buffer[] = []
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
    incoming.on('end', () => {
      request = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end('{"type":"error","error":{"type":"invalid_request_error","message":"captured"}}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = Value.Parse(Type.Object({ port: Type.Integer() }), server.address())
    const model: Model<'anthropic-messages'> = {
      api: 'anthropic-messages',
      baseUrl: `http://127.0.0.1:${port}`,
      contextWindow: 200_000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: 'claude-schema-test',
      input: ['text'],
      maxTokens: 1_000,
      name: 'Claude schema test',
      provider: 'anthropic',
      reasoning: false,
    }
    const context = normalizeContext({
      messages: [{ content: 'Inspect the tools.', role: 'user', timestamp: 1 }],
      systemPrompt: 'Use the tools.',
      tools: tools.map((tool) => ({ ...tool, description: tool.name })),
    })
    for await (const _event of streamSimple(model, context, { apiKey: 'sk-ant-api-test' })) {
      continue
    }
  } finally {
    server.close()
  }
  const decoded = Value.Parse(AnthropicRequestSchema, request)
  return new Map(decoded.tools.map((tool) => [tool.name, tool.input_schema]))
}

describe('tool input unions', () => {
  test('send every Task and TaskControl field to Anthropic models', async () => {
    const schemas = await anthropicToolSchemas([
      { name: 'Task', parameters: TaskInputSchema },
      { name: 'TaskControl', parameters: TaskControlInputSchema },
    ])
    const task = schemas.get('Task')
    expect(Object.keys(task?.properties ?? {})).toEqual(
      expect.arrayContaining([
        'delivery',
        'description',
        'isolation',
        'prompt',
        'resume',
        'run_in_background',
        'subagent_type',
        'tasks',
      ]),
    )
    expect(task?.properties['run_in_background']).toMatchObject({ type: 'boolean' })
    expect(task?.properties['isolation']).toMatchObject({ type: 'object' })
    const control = schemas.get('TaskControl')
    expect(control?.required).toEqual(['action'])
    expect(Object.keys(control?.properties ?? {})).toEqual(
      expect.arrayContaining(['action', 'agent_id', 'cursor', 'message', 'request_id']),
    )
    expect(JSON.stringify(control?.properties['action'])).toContain('"const":"reply"')
  })

  test('keep each variant contract exact', () => {
    const schema = toolInputUnion([
      Type.Object(
        { action: Type.Literal('page'), limit: Type.Integer({ minimum: 1, maximum: 5 }) },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          action: Type.Literal('reply'),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
          message: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
    ])
    expect(Value.Check(schema, { action: 'page', limit: 5 })).toBe(true)
    expect(Value.Check(schema, { action: 'page', limit: 6 })).toBe(false)
    expect(Value.Check(schema, { action: 'page' })).toBe(false)
    expect(Value.Check(schema, { action: 'page', limit: 1, message: 'x' })).toBe(false)
    expect(Value.Check(schema, { action: 'reply', limit: 50, message: 'x' })).toBe(true)
    expect(Value.Check(schema, { action: 'reply', message: '' })).toBe(false)
    expect(Value.Check(schema, { action: 'other' })).toBe(false)
    expect(
      Value.Parse(Type.Object({ required: Type.Array(Type.String()) }), schema).required,
    ).toEqual(['action'])
  })

  test('reject a TaskControl reply without its request identifier', () => {
    expect(
      Value.Check(TaskControlInputSchema, { action: 'reply', agent_id: 'a', message: 'Yes.' }),
    ).toBe(false)
    expect(
      Value.Check(TaskControlInputSchema, {
        action: 'reply',
        agent_id: 'a',
        message: 'Yes.',
        request_id: 'r',
      }),
    ).toBe(true)
  })
})
