import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

import { buildContextLabel, contextPercent, prettyEffort, prettyModel } from './format.ts'
import { emptyGitStatus, readGitStatus } from './git.ts'
import { renderHud, type HudState } from './render.ts'
import { fetchUsageForProvider } from './usage.ts'

const gitRefreshMs = 30_000
const usageRefreshMs = 5 * 60_000

function start(task: Promise<void>): void {
  task.catch(() => undefined)
}

export default function hud(pi: ExtensionAPI): void {
  const state: HudState = {
    cwd: process.cwd(),
    git: emptyGitStatus(),
    providerLabel: '',
    modelLabel: 'no-model',
    effortLabel: '',
    contextLabel: '--',
    contextPercent: null,
    usage: null,
  }
  let active = false
  let generation = 0
  let gitRevision = 0
  let usageRevision = 0
  let requestRender: (() => void) | undefined
  let footerOwned = false
  let gitTimer: ReturnType<typeof setInterval> | undefined
  let usageTimer: ReturnType<typeof setTimeout> | undefined
  let gitController: AbortController | undefined
  let usageController: AbortController | undefined

  const render = () => requestRender?.()

  const sync = (ctx: ExtensionContext) => {
    state.cwd = ctx.cwd
    state.providerLabel = ctx.model?.provider ?? ''
    state.modelLabel = prettyModel(ctx.model?.id)
    state.effortLabel = ctx.model?.reasoning ? prettyEffort(pi.getThinkingLevel()) : ''
    state.contextLabel = buildContextLabel(ctx)
    state.contextPercent = contextPercent(ctx)
    render()
  }

  const refreshGit = async (ctx: ExtensionContext, life: number): Promise<void> => {
    const revision = ++gitRevision
    gitController?.abort()
    const controller = new AbortController()
    gitController = controller
    const cwd = ctx.cwd
    const git = await readGitStatus(cwd, controller.signal)
    if (
      active &&
      life === generation &&
      revision === gitRevision &&
      !controller.signal.aborted &&
      cwd === ctx.cwd
    ) {
      state.git = git
      render()
    }
    if (gitController === controller) {
      gitController = undefined
    }
  }

  const scheduleUsage = (ctx: ExtensionContext, life: number) => {
    if (usageTimer !== undefined) {
      clearTimeout(usageTimer)
    }
    usageTimer = setTimeout(() => {
      usageTimer = undefined
      if (active && life === generation) {
        refreshUsage(ctx, life)
      }
    }, usageRefreshMs)
  }

  const refreshUsage = (ctx: ExtensionContext, life: number) => {
    const revision = ++usageRevision
    usageController?.abort()
    const controller = new AbortController()
    usageController = controller
    const provider = ctx.model?.provider
    const task = fetchUsageForProvider(provider, controller.signal)
    if (task === null) {
      state.usage = null
      render()
      return
    }
    start(
      task
        .then((snapshot) => {
          if (
            active &&
            life === generation &&
            revision === usageRevision &&
            !controller.signal.aborted &&
            provider === ctx.model?.provider
          ) {
            if (snapshot.windows.length > 0 || state.usage?.windows.length === undefined) {
              state.usage = snapshot
              render()
            }
          }
        })
        .finally(() => {
          if (active && life === generation && revision === usageRevision) {
            scheduleUsage(ctx, life)
          }
        }),
    )
  }

  const stop = () => {
    if (gitTimer !== undefined) {
      clearInterval(gitTimer)
    }
    if (usageTimer !== undefined) {
      clearTimeout(usageTimer)
    }
    gitController?.abort()
    usageController?.abort()
    gitTimer = undefined
    usageTimer = undefined
    gitController = undefined
    usageController = undefined
    gitRevision += 1
    usageRevision += 1
  }

  pi.on('session_start', (_event, ctx) => {
    if (!ctx.hasUI || ctx.mode !== 'tui') {
      return
    }
    stop()
    active = true
    generation += 1
    const life = generation
    sync(ctx)
    ctx.ui.setFooter((tui, theme, footerData) => {
      footerOwned = true
      requestRender = () => tui.requestRender()
      const unsubscribe = footerData.onBranchChange(() => {
        start(refreshGit(ctx, life))
      })
      return {
        dispose() {
          footerOwned = false
          requestRender = undefined
          unsubscribe()
          active = false
          stop()
        },
        invalidate() {},
        render(width: number): string[] {
          return renderHud(theme, state, footerData.getExtensionStatuses(), width)
        },
      }
    })
    start(refreshGit(ctx, life))
    refreshUsage(ctx, life)
    gitTimer = setInterval(() => start(refreshGit(ctx, life)), gitRefreshMs)
  })

  pi.on('model_select', (_event, ctx) => {
    if (!active) {
      return
    }
    sync(ctx)
    refreshUsage(ctx, generation)
  })

  pi.on('thinking_level_select', (_event, ctx) => {
    if (active) {
      sync(ctx)
    }
  })

  pi.on('message_end', (_event, ctx) => {
    if (active) {
      sync(ctx)
    }
  })

  pi.on('tool_execution_end', (_event, ctx) => {
    if (active) {
      sync(ctx)
      start(refreshGit(ctx, generation))
    }
  })

  pi.on('agent_end', (_event, ctx) => {
    if (active) {
      sync(ctx)
      start(refreshGit(ctx, generation))
    }
  })

  pi.on('session_compact', (_event, ctx) => {
    if (active) {
      sync(ctx)
    }
  })

  pi.on('session_shutdown', (_event, ctx) => {
    active = false
    generation += 1
    stop()
    if (ctx.hasUI && ctx.mode === 'tui' && footerOwned) {
      ctx.ui.setFooter(undefined)
    }
    footerOwned = false
    requestRender = undefined
  })
}
