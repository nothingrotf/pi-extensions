import {
  createBashToolDefinition,
  createLocalBashOperations,
  type BashOperations,
  type InlineExtension,
} from '@earendil-works/pi-coding-agent'

import { prepareSandboxLaunch } from './verification-sandbox.ts'

const permittedTools = new Set([
  'read',
  'grep',
  'find',
  'ls',
  'bash',
  'pstack_gate',
  'codemode',
  'todo_read',
  'todo_write',
  'request_parent',
  'ask_parent',
  'notify_parent',
  'update_progress',
  'send_peer',
  'receive_peers',
  'TaskControl',
])

const sandboxOperations: BashOperations = {
  async exec(command, cwd, options) {
    options.signal?.throwIfAborted()
    const launch = await prepareSandboxLaunch(command, cwd)
    try {
      options.signal?.throwIfAborted()
      const quoted = [launch.executable, ...launch.args]
        .map((value) => `'${value.replaceAll("'", "'\\''")}'`)
        .join(' ')
      return await createLocalBashOperations({ shellPath: '/bin/bash' }).exec(
        `exec ${quoted}`,
        launch.cwd,
        { ...options, env: launch.env, timeout: options.timeout ?? 600 },
      )
    } finally {
      await launch.dispose()
    }
  },
}

export function createSandboxBashTools(): ReturnType<typeof createBashToolDefinition>[] {
  const definition = createBashToolDefinition('.', {
    operations: sandboxOperations,
    exposeSessionEnvironment: false,
  })
  return [
    {
      ...definition,
      description: `${definition.description} Commands run in a required OS sandbox: no network and no writes outside the effective workspace and private temporary directory.`,
      execute(id, params, signal, onUpdate, ctx) {
        return createBashToolDefinition(ctx.cwd, {
          operations: sandboxOperations,
          exposeSessionEnvironment: false,
        }).execute(id, params, signal, onUpdate, ctx)
      },
    } satisfies typeof definition,
  ]
}

export const verificationSandboxExtension: InlineExtension = {
  name: 'pstack-verification-sandbox',
  hidden: true,
  factory(pi) {
    pi.on('tool_call', (event) => {
      if (!permittedTools.has(event.toolName))
        return {
          block: true,
          reason:
            'Verification sandbox: use read-only inspection tools, sandboxed bash, or pstack_gate. Direct mutation and unsandboxed capability tools are blocked.',
        }
      return undefined
    })
    pi.on('before_agent_start', (event) => ({
      systemPrompt: `${event.systemPrompt}\n\n# Verification sandbox\nUse bash and pstack_gate for executable checks. Both require an OS sandbox that denies network and writes outside this workspace and a private temporary directory. Direct edit, write, patch, and other execution tools are blocked. Missing sandbox support is a blocker, never permission to retry unsandboxed. Read access, the agent process, trusted extensions, and model-provider requests remain outside this containment boundary.`,
    }))
  },
}
