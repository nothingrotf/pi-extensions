import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { SubagentRuntime, type RuntimeFailedResult } from './runtime.ts'
import { TaskInputSchema } from './schema.ts'

function failedContent(result: RuntimeFailedResult): string {
  const agent = 'agentId' in result.details ? `\n\nAgent ID: ${result.details.agentId}` : ''
  return `Task failed: ${result.details.error}${agent}`
}

export function registerSubagent(pi: ExtensionAPI, runTimeoutMs?: number): SubagentRuntime {
  const runtime = new SubagentRuntime(pi, runTimeoutMs)

  pi.on('session_start', (_event, ctx) => {
    runtime.restore(ctx)
  })
  pi.on('session_before_switch', async () => {
    await runtime.shutdown('The parent session switched.')
  })
  pi.on('session_before_fork', async () => {
    await runtime.shutdown('The parent session forked.')
  })
  pi.on('session_before_tree', async () => {
    await runtime.shutdown('The parent session tree changed.')
  })
  pi.on('session_tree', (_event, ctx) => {
    runtime.restore(ctx)
  })
  pi.on('session_shutdown', async () => {
    await runtime.shutdown()
  })

  pi.registerTool({
    description:
      'Run an isolated subagent with a persistent transcript. Use resume with the returned Agent ID to continue it. Foreground is the default. Set run_in_background only for independent work.',
    execute: async (_callId, input, signal, _onUpdate, ctx) => {
      const result = await runtime.run({ ctx, input, signal })

      if (result.kind === 'background') {
        return {
          content: [
            {
              text: `Task started in the background.\nAgent ID: ${result.details.agentId}`,
              type: 'text',
            },
          ],
          details: result.details,
        }
      }

      if (result.kind === 'failed') {
        return {
          content: [{ text: failedContent(result), type: 'text' }],
          details: result.details,
          isError: true,
        }
      }

      return {
        content: [
          { text: `Agent ID: ${result.details.agentId}\n\n${result.content}`, type: 'text' },
        ],
        details: result.details,
      }
    },
    executionMode: 'parallel',
    label: 'Task',
    name: 'Task',
    parameters: TaskInputSchema,
  })

  return runtime
}

export default function subagentExtension(pi: ExtensionAPI): void {
  registerSubagent(pi)
}
