import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

import { entryText, messageText, type Message } from './content.ts'
import { compactText, type Category, type Fact, WorkingState } from './state.ts'

const ToolInputSchema = Type.Object({
  path: Type.Optional(Type.String()),
  file_path: Type.Optional(Type.String()),
  filePath: Type.Optional(Type.String()),
  command: Type.Optional(Type.String()),
  oldText: Type.Optional(Type.String()),
  newText: Type.Optional(Type.String()),
  old_string: Type.Optional(Type.String()),
  new_string: Type.Optional(Type.String()),
  edits: Type.Optional(Type.Array(Type.Object({ oldText: Type.String(), newText: Type.String() }))),
})

const PlanSchema = Type.Object({
  todos: Type.Array(
    Type.Object({
      id: Type.String(),
      content: Type.String(),
      status: Type.String(),
      blocker: Type.Optional(Type.String()),
    }),
  ),
})

type ToolInput = Static<typeof ToolInputSchema>
interface PendingCall {
  name: string
  source: string
  input: ToolInput
}

const readTools = new Set(['read', 'grep', 'find', 'ls', 'read_file'])
const editTools = new Set(['edit', 'edit_file', 'multi_edit', 'write', 'write_file', 'create_file'])

function fact(category: Category, source: string, key: string, text: string): Fact {
  return { category, source, key: compactText(key, 600), text: compactText(text, 900) }
}

function changeText(input: ToolInput): string {
  const changes = input.edits ?? [
    {
      oldText: input.oldText ?? input.old_string ?? '',
      newText: input.newText ?? input.new_string ?? '',
    },
  ]
  return compactText(
    changes
      .slice(0, 3)
      .filter((change) => change.oldText || change.newText)
      .map((change) => `${compactText(change.oldText, 120)} -> ${compactText(change.newText, 160)}`)
      .join('\n'),
    500,
  )
}

export class Extractor {
  private readonly calls = new Map<string, PendingCall>()
  readonly state: WorkingState

  constructor(state: WorkingState) {
    this.state = state
  }

  entry(entry: SessionEntry): void {
    if (entry.type === 'message') this.message(entry.message, entry.id)
    else if (entry.type === 'custom_message' || entry.type === 'branch_summary') {
      this.state.add(fact('context', entry.id, entry.id, entryText(entry)))
    }
  }

  message(message: Message, source: string): void {
    switch (message.role) {
      case 'user':
        this.state.add(fact('request', source, source, messageText(message)))
        break
      case 'assistant': {
        const text = message.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n')
        this.state.add(fact('note', source, source, text))
        for (const part of message.content) {
          if (part.type !== 'toolCall' || part.name === 'compact_recall') continue
          const input = Value.Check(ToolInputSchema, part.arguments) ? part.arguments : {}
          this.calls.set(part.id, { name: part.name, source, input })
        }
        break
      }
      case 'toolResult': {
        if (message.toolName === 'compact_recall') break
        const call = this.calls.get(message.toolCallId)
        this.calls.delete(message.toolCallId)
        const output = compactText(messageText(message), 600)
        const label =
          call?.input.command ??
          call?.input.path ??
          call?.input.file_path ??
          call?.input.filePath ??
          ''
        const category = message.isError ? 'failure' : 'result'
        const status = message.isError ? 'error reported' : 'success reported'
        this.state.add(
          fact(
            category,
            source,
            source,
            `${message.toolName}: ${status}${label ? ` (${compactText(label, 200)})` : ''}\n${output}`,
          ),
        )
        if (message.isError) break
        if (message.toolName === 'todo_write' && Value.Check(PlanSchema, message.details)) {
          this.state.clear('plan')
          for (const todo of message.details.todos) {
            this.state.add(
              fact(
                'plan',
                source,
                todo.id,
                `[${todo.status}] ${todo.id}: ${todo.content}${todo.blocker ? ` (blocked: ${todo.blocker})` : ''}`,
              ),
            )
          }
        }
        if (!call || call.name !== message.toolName) break
        const path = call.input.path ?? call.input.file_path ?? call.input.filePath
        if (!path) break
        const operation = editTools.has(call.name)
          ? 'modified'
          : readTools.has(call.name)
            ? 'read'
            : undefined
        if (!operation) break
        const change = operation === 'modified' ? changeText(call.input) : ''
        this.state.add(
          fact(
            'file',
            source,
            `${operation}:${path}`,
            `${operation}: ${path}${change ? `\n${change}` : ''}`,
          ),
        )
        break
      }
      case 'bashExecution':
        if (!message.excludeFromContext) {
          this.state.add(
            fact(
              message.exitCode === 0 && !message.cancelled ? 'result' : 'failure',
              source,
              source,
              messageText(message),
            ),
          )
        }
        break
      case 'custom':
      case 'branchSummary':
      case 'compactionSummary':
        this.state.add(fact('context', source, source, messageText(message)))
        break
    }
  }

  unfinished(): void {
    for (const call of this.calls.values()) {
      const target =
        call.input.command ?? call.input.path ?? call.input.file_path ?? call.input.filePath ?? ''
      this.state.add(
        fact(
          'context',
          call.source,
          call.source,
          `${call.name}: call recorded without a matching result${target ? ` (${target})` : ''}`,
        ),
      )
    }
    this.calls.clear()
  }
}
