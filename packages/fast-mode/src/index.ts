import { join } from 'node:path'

import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent'

import {
  applyServiceTier,
  getSpeedSupport,
  isSpeedTier,
  reportedServiceTier,
  speedLabel,
  type Speed,
} from './policy.ts'
import { loadSpeed, saveSpeed } from './state.ts'

interface FastModeOptions {
  agentDir?: string
  catalogPath?: string
}

const actions = new Map<string, Speed | 'status'>([
  ['on', 'fast'],
  ['ultra', 'ultrafast'],
  ['ultrafast', 'ultrafast'],
  ['off', 'standard'],
  ['status', 'status'],
])

const modeLabels = new Map<Speed, string>([
  ['standard', 'OFF'],
  ['fast', 'ON'],
  ['ultrafast', 'ULTRAFAST'],
])

export function createFastModeExtension(options: FastModeOptions = {}) {
  return function fastMode(pi: ExtensionAPI): void {
    const statePath = join(options.agentDir ?? getAgentDir(), 'state', 'fast-mode.json')
    let stateErrorReported = false
    let lastTier: string | undefined

    const status = async (ctx: ExtensionContext): Promise<string> => {
      const speed = await loadSpeed(statePath)
      const mode = `Fast Mode: ${modeLabels.get(speed)}.`
      if (speed === 'standard') {
        ctx.ui.setStatus('fast-mode', undefined)
        return mode
      }
      const label = speedLabel(speed)
      const support = getSpeedSupport(ctx.model, speed, options.catalogPath)
      if (!support.supported) {
        ctx.ui.setStatus('fast-mode', `${label} unavailable`)
        return `${mode} ${support.reason}`
      }
      const applied = lastTier === undefined || isSpeedTier(speed, lastTier)
      ctx.ui.setStatus('fast-mode', `${label} ${applied ? 'requested' : 'not applied'}`)
      const observed = lastTier === undefined ? '' : ` Last response: service_tier=${lastTier}.`
      return `${mode} ${ctx.model?.id}: service_tier=${support.tier} (${support.source}).${observed}`
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
      lastTier = undefined
      await refresh(ctx)
    })
    pi.on('provider_stream_event', async (event, ctx) => {
      const tier = reportedServiceTier(event)
      if (tier === undefined) return
      lastTier = tier
      await refresh(ctx)
    })
    pi.on('session_shutdown', (_event, ctx) => {
      ctx.ui.setStatus('fast-mode', undefined)
    })
    pi.on('before_provider_request', async (event, ctx) => {
      let speed: Speed
      try {
        speed = await loadSpeed(statePath)
      } catch {
        await refresh(ctx)
        return
      }
      if (speed === 'standard') return
      const support = getSpeedSupport(ctx.model, speed, options.catalogPath)
      if (!support.supported) return
      return applyServiceTier(event.payload, support.tier)
    })

    const command = {
      description: 'Set or inspect OpenAI Fast Mode: /fast on, ultra, off, or status.',
      getArgumentCompletions(prefix: string) {
        const items = ['on', 'ultra', 'off', 'status']
          .filter((value) => value.startsWith(prefix))
          .map((value) => ({ value, label: value }))
        return items.length === 0 ? null : items
      },
      async handler(args: string, ctx: ExtensionContext) {
        const action = actions.get(args.trim().toLowerCase() || 'status')
        if (action === undefined) {
          ctx.ui.notify('Usage: /fast [on|ultra|off|status]', 'info')
          return
        }
        if (action === 'fast' || action === 'ultrafast') {
          const support = getSpeedSupport(ctx.model, action, options.catalogPath)
          if (!support.supported) {
            ctx.ui.notify(support.reason, 'warning')
            return
          }
        }
        if (action !== 'status') {
          await saveSpeed(statePath, action)
          lastTier = undefined
        }
        stateErrorReported = false
        ctx.ui.notify(await status(ctx), 'info')
      },
    }
    pi.registerCommand('fast', command)
    pi.registerCommand('codex-fast', command)
  }
}

export default createFastModeExtension()
