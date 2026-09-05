import { join } from 'node:path'

import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent'

import { applyFastTier, getFastSupport } from './policy.ts'
import { loadFastMode, saveFastMode } from './state.ts'

interface FastModeOptions {
  agentDir?: string
  catalogPath?: string
}

export function createFastModeExtension(options: FastModeOptions = {}) {
  return function fastMode(pi: ExtensionAPI): void {
    const statePath = join(options.agentDir ?? getAgentDir(), 'state', 'fast-mode.json')
    let stateErrorReported = false

    const status = async (ctx: ExtensionContext): Promise<string> => {
      const enabled = await loadFastMode(statePath)
      const support = getFastSupport(ctx.model, options.catalogPath)
      const label = enabled ? 'ON' : 'OFF'
      if (!support.supported) {
        ctx.ui.setStatus('fast-mode', enabled ? 'Fast unavailable' : undefined)
        return `Fast Mode: ${label}. ${support.reason}`
      }
      ctx.ui.setStatus('fast-mode', enabled ? 'Fast requested' : undefined)
      return `Fast Mode: ${label}. ${ctx.model?.id}: service_tier=${support.tier} (${support.source}).`
    }

    const refresh = async (ctx: ExtensionContext): Promise<void> => {
      try {
        await status(ctx)
        stateErrorReported = false
      } catch {
        ctx.ui.setStatus('fast-mode', 'Fast state error')
        if (!stateErrorReported) {
          ctx.ui.notify(`Cannot read Fast Mode state: ${statePath}`, 'error')
          stateErrorReported = true
        }
      }
    }

    pi.on('session_start', async (_event, ctx) => {
      await refresh(ctx)
    })
    pi.on('model_select', async (_event, ctx) => {
      await refresh(ctx)
    })
    pi.on('session_shutdown', (_event, ctx) => {
      ctx.ui.setStatus('fast-mode', undefined)
    })
    pi.on('before_provider_request', async (event, ctx) => {
      const support = getFastSupport(ctx.model, options.catalogPath)
      if (!support.supported) return
      try {
        if (!(await loadFastMode(statePath))) return
      } catch {
        await refresh(ctx)
        return
      }
      return applyFastTier(event.payload, support.tier)
    })

    const command = {
      description: 'Set or inspect Codex Fast Mode: /fast on, off, or status.',
      getArgumentCompletions(prefix: string) {
        const items = ['on', 'off', 'status']
          .filter((value) => value.startsWith(prefix))
          .map((value) => ({ value, label: value }))
        return items.length === 0 ? null : items
      },
      async handler(args: string, ctx: ExtensionContext) {
        const action = args.trim().toLowerCase() || 'status'
        if (action !== 'on' && action !== 'off' && action !== 'status') {
          ctx.ui.notify('Usage: /fast [on|off|status]', 'info')
          return
        }
        if (action === 'on') {
          const support = getFastSupport(ctx.model, options.catalogPath)
          if (!support.supported) {
            ctx.ui.notify(support.reason, 'warning')
            return
          }
        }
        if (action !== 'status') await saveFastMode(statePath, action === 'on')
        stateErrorReported = false
        ctx.ui.notify(await status(ctx), 'info')
      },
    }
    pi.registerCommand('fast', command)
    pi.registerCommand('codex-fast', command)
  }
}

export default createFastModeExtension()
