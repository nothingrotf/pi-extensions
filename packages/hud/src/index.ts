import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

import { AnimationClock } from './animation-clock.ts'
import { sweepEditors } from './editor-border.ts'
import { buildContextLabel, contextPercent, prettyEffort, prettyModel } from './format.ts'
import { emptyGitStatus, readGitStatus } from './git.ts'
import { hudCommandCompletions, parseHudCommand, resolveToggle } from './hud-command.ts'
import {
  builtInRailToolNames,
  decodeRailAction,
  decodeRailTools,
  defaultRailIcon,
  defaultRailLabel,
  type RailActionReport,
  railActionChannel,
  railEnabledChannel,
  railToolsChannel,
} from './rail-channel.ts'
import { decodeRailEntry, railEntryType, RailComponent, RailUsageLine } from './rail-entry.ts'
import { railStateEntryType } from './rail-state-entry.ts'
import { applyRailTools, mapSessionRails, railPatchForCall } from './rail-tools.ts'
import { RailVoice } from './rail-voice.ts'
import { isPseudo, type RailAction, RailStore, showsPendingNarration } from './rail.ts'
import { renderHud, type HudState } from './render.ts'
import {
  choiceValue,
  defaultSoundSettings,
  FocusTracker,
  focusChoiceRows,
  isAskTool,
  isFocusMode,
  loadSoundSettings,
  normalizeSoundValue,
  parseSoundCommand,
  playSound,
  previewSound,
  saveSoundSettings,
  soundChoiceRows,
  type SoundFocusMode,
  type SoundSettings,
  stopSoundPlayback,
} from './sound.ts'
import { speakerMotionEnabled } from './speaker-header.ts'
import { installSpeakerSpacingFix, type SpeakerSpacingFix } from './speaker-spacing.ts'
import { installThinkingSpacerFix, type ThinkingSpacerFix } from './thinking-spacer.ts'
import { registerTimestamps, type LiveHeader, type LiveUsage } from './timestamp.ts'
import { frameTranscriptLine, speakerBodyIndent } from './transcript-geometry.ts'
import { installTranscriptLayoutFix, type TranscriptLayoutFix } from './transcript-layout.ts'
import { fetchUsageForProvider } from './usage.ts'
import { decodeWorkingMessage, WorkingDock, workingMessageChannel } from './working.ts'

const gitRefreshMs = 30_000
const usageRefreshMs = 5 * 60_000

function start(task: Promise<void>): void {
  task.catch(() => undefined)
}

type HiddenTextBlocks = Map<number, Set<number>>

function mergeHiddenTextBlocks(target: HiddenTextBlocks, source: HiddenTextBlocks): void {
  for (const [timestamp, sourceIndices] of source) {
    const indices = target.get(timestamp) ?? new Set<number>()
    for (const index of sourceIndices) indices.add(index)
    target.set(timestamp, indices)
  }
}

export default function hud(pi: ExtensionAPI): void {
  const animationClock = new AnimationClock()
  const liveUsage: LiveUsage = { row: () => undefined }
  let agentWorking = false
  let liveHeaderAt: number | undefined
  let liveHeaderMessageAt: number | undefined
  let liveHeaderClosed = true
  const liveHeader: LiveHeader = {
    onClose: () => {
      liveHeaderClosed = true
    },
    onMessage: (timestamp) => {
      if (liveHeaderAt !== undefined && liveHeaderMessageAt === undefined) {
        liveHeaderMessageAt = timestamp
      }
    },
    onOpen: (timestamp) => {
      liveHeaderAt = timestamp
      liveHeaderMessageAt = undefined
      liveHeaderClosed = false
    },
    source: (timestamp) => {
      const current = timestamp === liveHeaderAt
      return {
        active: current && agentWorking && !liveHeaderClosed,
        motion: speakerMotionEnabled(),
        tick: animationClock.tick(),
        timestamp: current
          ? (liveHeaderMessageAt ?? (agentWorking ? Date.now() : timestamp))
          : timestamp,
      }
    },
  }
  const timestamps = registerTimestamps(pi, liveUsage, liveHeader)
  const timestampsEnabled = timestamps.enabled

  const state: HudState = {
    cwd: process.cwd(),
    git: emptyGitStatus(),
    providerLabel: '',
    modelLabel: 'no-model',
    effortLabel: '',
    effortLevel: '',
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
  let sound: SoundSettings = { ...defaultSoundSettings }
  let unsubscribeAnimation: (() => void) | undefined
  let unsubscribeInput: (() => void) | undefined
  const focus = new FocusTracker()
  const dock = new WorkingDock(() => animationClock.tick())
  let rail = new RailStore()
  let railTurn = 0
  let railTurnPending = false
  let railsByToolCallId = new Map<string, RailStore>()
  let railsByTurn = new Map<number, RailStore>()
  const railOpeningAt = new Map<number, number>()
  const railFor = (toolCallId: string) => railsByToolCallId.get(toolCallId) ?? rail
  let railEnabled = true
  let railPendingNarration = false
  let liveUsageAssistantAt: number | undefined
  let assistantUsageLines = new Map<number, RailUsageLine>()
  let railCwd: string | undefined
  const railTools = new Set(builtInRailToolNames)
  const railVoice = new RailVoice()
  let railPseudoIds = new Set<string>()
  let persistedRailReports = new Map<string, string>()
  let hiddenNarrationBlocks: HiddenTextBlocks = new Map()
  let currentHiddenNarrationBlocks: HiddenTextBlocks = new Map()
  let quietThinking = true

  const assistantVisible = (timestamp: number | undefined, contentIndex?: number) => {
    if (!railEnabled || timestamp === undefined) return true
    const historical = hiddenNarrationBlocks.get(timestamp)
    const current = currentHiddenNarrationBlocks.get(timestamp)
    if (contentIndex === undefined) return historical === undefined && current === undefined
    return historical?.has(contentIndex) !== true && current?.has(contentIndex) !== true
  }
  const thinkingQuiet = () => quietThinking && railEnabled
  const persistRailReport = (report: RailActionReport) => {
    const signature = JSON.stringify(report)
    if (persistedRailReports.get(report.toolCallId) === signature) return
    persistedRailReports.set(report.toolCallId, signature)
    pi.appendEntry(railStateEntryType, { report, turn: railTurn })
  }
  const persistRailAction = (action: RailAction, parentToolCallId?: string): void => {
    if (isPseudo(action.kind)) return
    const report: RailActionReport = {
      argGlyphs: [...action.argGlyphs],
      category: action.category,
      detail: action.detail,
      doneLabel: action.doneLabel,
      iconKey: action.iconKey,
      output: action.output,
      runningLabel: action.runningLabel,
      status: action.status,
      summary: action.summary,
      toolCallId: action.toolCallId,
    }
    if (action.durationMs !== undefined) report.durationMs = action.durationMs
    if (parentToolCallId !== undefined) report.parentToolCallId = parentToolCallId
    persistRailReport(report)
    for (const child of action.children ?? []) persistRailAction(child, action.toolCallId)
  }
  let spacerFix: ThinkingSpacerFix | undefined
  let speakerSpacingFix: SpeakerSpacingFix | undefined
  let transcriptLayoutFix: TranscriptLayoutFix | undefined
  let dimEditorBorder: (() => void) | undefined

  const applyThinkingLabel = (ctx: ExtensionContext) => {
    ctx.ui.setHiddenThinkingLabel(thinkingQuiet() ? '' : undefined)
  }

  pi.registerMarkdownTransformer((markdown, context) => {
    if (context.messageType !== 'assistant-thinking') return markdown
    return thinkingQuiet() ? '' : markdown
  })

  railCwd = process.cwd()
  applyRailTools(pi, railFor, railCwd, railEnabled)

  const restoreRails = (ctx: ExtensionContext) => {
    const session = mapSessionRails(ctx.sessionManager.getBranch(), ctx.cwd)
    railsByToolCallId = session.byToolCallId
    railsByTurn = session.byEntryTurn
    railOpeningAt.clear()
    for (const [turn, timestamp] of session.openingAssistantTimestamps) {
      railOpeningAt.set(turn, timestamp)
    }
    railTurn = session.maxTurn
    hiddenNarrationBlocks = session.hiddenAssistantTextBlocks
    currentHiddenNarrationBlocks = new Map()
    rail = new RailStore()
    railVoice.reset()
    railPseudoIds = new Set<string>()
    persistedRailReports = new Map<string, string>()
    requestRender?.()
  }

  pi.events.on(workingMessageChannel, (data) => {
    const message = decodeWorkingMessage(data)
    if (message !== undefined) dock.setMessage(message ?? undefined)
  })

  const render = () => requestRender?.()

  const syncFocusReporting = () => {
    if (sound.soundFocusMode === 'always') {
      focus.disable()
    } else {
      focus.enable()
    }
  }

  const play = (ctx: ExtensionContext, value: string) => {
    if (active && ctx.hasUI && ctx.mode === 'tui') {
      start(playSound(value, sound.soundFocusMode, focus.isFocused))
    }
  }

  const applySoundSettings = (ctx: ExtensionContext, next: SoundSettings, message: string) => {
    sound = next
    syncFocusReporting()
    start(saveSoundSettings(next))
    ctx.ui.notify(`hud: ${message}`, 'info')
  }

  const sync = (ctx: ExtensionContext) => {
    state.cwd = ctx.cwd
    state.providerLabel = ctx.model?.provider ?? ''
    state.modelLabel = prettyModel(ctx.model?.id)
    state.effortLevel = ctx.model?.reasoning ? pi.getThinkingLevel() : ''
    state.effortLabel = prettyEffort(state.effortLevel)
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
    unsubscribeAnimation?.()
    unsubscribeAnimation = undefined
    unsubscribeInput?.()
    unsubscribeInput = undefined
    focus.disable()
    stopSoundPlayback()
  }

  pi.on('session_start', (_event, ctx) => {
    stop()
    dock.dispose(ctx.hasUI && ctx.mode === 'tui' ? ctx.ui : undefined)
    active = false
    if (!ctx.hasUI || ctx.mode !== 'tui') {
      footerOwned = false
      requestRender = undefined
      dimEditorBorder = undefined
      spacerFix?.dispose()
      spacerFix = undefined
      speakerSpacingFix?.dispose()
      speakerSpacingFix = undefined
      transcriptLayoutFix?.dispose()
      transcriptLayoutFix = undefined
    }
    restoreRails(ctx)
    applyThinkingLabel(ctx)
    if (railCwd !== ctx.cwd) {
      railCwd = ctx.cwd
      applyRailTools(pi, railFor, ctx.cwd, railEnabled)
    }
    if (!ctx.hasUI || ctx.mode !== 'tui') return
    generation += 1
    const life = generation
    ctx.ui.setWorkingVisible(false)
    sync(ctx)
    ctx.ui.setFooter((tui, theme, footerData) => {
      footerOwned = true
      assistantUsageLines = new Map<number, RailUsageLine>()
      const assistantUsage = (timestamp: number | undefined, width: number): readonly string[] => {
        if (
          !footerOwned ||
          !agentWorking ||
          timestamp === undefined ||
          timestamp !== liveUsageAssistantAt
        )
          return []
        let line = assistantUsageLines.get(timestamp)
        if (line === undefined) {
          line = new RailUsageLine(theme)
          assistantUsageLines.set(timestamp, line)
        }
        const rendered = line.render({
          row: liveUsage.row(),
          shimmer: true,
          tick: animationClock.tick(),
        })
        return rendered === undefined
          ? []
          : ['', frameTranscriptLine(rendered, width, speakerBodyIndent)]
      }
      spacerFix = installThinkingSpacerFix(tui, thinkingQuiet, assistantVisible, assistantUsage)
      speakerSpacingFix = installSpeakerSpacingFix(tui, timestampsEnabled)
      transcriptLayoutFix = installTranscriptLayoutFix(tui, railOpeningAt)
      requestRender = () => tui.requestRender()
      dimEditorBorder = () => sweepEditors(tui, theme, () => agentWorking)
      dimEditorBorder()
      const unsubscribe = footerData.onBranchChange(() => {
        start(refreshGit(ctx, life))
      })
      return {
        dispose() {
          footerOwned = false
          requestRender = undefined
          dimEditorBorder = undefined
          spacerFix?.dispose()
          spacerFix = undefined
          speakerSpacingFix?.dispose()
          speakerSpacingFix = undefined
          transcriptLayoutFix?.dispose()
          transcriptLayoutFix = undefined
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
    active = true
    start(refreshGit(ctx, life))
    refreshUsage(ctx, life)
    gitTimer = setInterval(() => start(refreshGit(ctx, life)), gitRefreshMs)
    unsubscribeInput = ctx.ui.onTerminalInput((data) => {
      focus.handleInput(data)
      return undefined
    })
    start(
      loadSoundSettings().then((settings) => {
        if (active && life === generation) {
          sound = settings
          syncFocusReporting()
        }
      }),
    )
  })

  pi.on('agent_start', () => {
    agentWorking = true
    railPendingNarration = false
    liveUsageAssistantAt = undefined
    assistantUsageLines.clear()
    dimEditorBorder?.()
    requestRender?.()
    dock.reset()
    if (!railTurnPending) {
      mergeHiddenTextBlocks(hiddenNarrationBlocks, currentHiddenNarrationBlocks)
    }
    rail = new RailStore()
    railVoice.reset()
    railPseudoIds = new Set<string>()
    persistedRailReports = new Map<string, string>()
    currentHiddenNarrationBlocks = new Map()
    railTurn += 1
    railTurnPending = true
    railsByTurn.set(railTurn, rail)
  })

  pi.registerEntryRenderer(railEntryType, (entry, options, theme) => {
    const turn = decodeRailEntry(entry.data)
    if (turn === undefined) {
      return undefined
    }
    return new RailComponent(
      () => railsByTurn.get(turn),
      theme,
      options.expanded,
      () => turn === railTurn && agentWorking && railPendingNarration,
      () => {
        const live = turn === railTurn && agentWorking
        const placedInRail = live && liveUsageAssistantAt === undefined
        return {
          row: placedInRail ? liveUsage.row() : undefined,
          shimmer: placedInRail,
          tick: animationClock.tick(),
        }
      },
      undefined,
      () => railEnabled,
      () => turn === railTurn && agentWorking,
    )
  })

  pi.registerEntryRenderer(railStateEntryType, () => undefined)

  pi.on('session_tree', (_event, ctx) => {
    transcriptLayoutFix?.markDirty()
    restoreRails(ctx)
    spacerFix?.markDirty()
    speakerSpacingFix?.markDirty()
  })

  pi.on('turn_start', (_event, ctx) => {
    if (!active || !ctx.hasUI || ctx.mode !== 'tui') return
    unsubscribeAnimation ??= animationClock.subscribe(() => requestRender?.())
    dock.start(ctx.ui)
  })

  pi.events.on(railToolsChannel, (data) => {
    const announcement = decodeRailTools(data)
    if (announcement === undefined) return
    for (const name of announcement.tools) railTools.add(name)
    pi.events.emit(railEnabledChannel, { enabled: railEnabled })
  })

  pi.events.on(railActionChannel, (data) => {
    const report = decodeRailAction(data)
    if (report === undefined || !railEnabled || !agentWorking) return
    const { parentToolCallId, toolCallId, toolName, ...patch } = report
    const targetId = parentToolCallId ?? toolCallId
    const target = railFor(targetId)
    if (railsByToolCallId.has(targetId) && target !== rail) return
    const targetStatus = target.status(toolCallId)
    if (report.status === 'pending' && (targetStatus === 'ok' || targetStatus === 'error')) return
    const fallback = toolName === undefined ? undefined : defaultRailLabel(toolName)
    const resolved = {
      ...patch,
      doneLabel: patch.doneLabel ?? fallback ?? 'Tool',
      iconKey: patch.iconKey ?? (toolName === undefined ? 'tool' : defaultRailIcon(toolName)),
      runningLabel: patch.runningLabel ?? patch.doneLabel ?? fallback ?? 'Tool',
    }
    const actionPatch = { ...resolved, measureDuration: false, resetDerived: true }
    openRailEntry()
    if (parentToolCallId === undefined) target.report(toolCallId, actionPatch)
    else target.reportChild(parentToolCallId, toolCallId, actionPatch)
    const persistedReport: RailActionReport = { ...resolved, toolCallId }
    if (parentToolCallId !== undefined) persistedReport.parentToolCallId = parentToolCallId
    if (toolName !== undefined) persistedReport.toolName = toolName
    persistRailReport(persistedReport)
    if (toolName !== undefined) railTools.add(toolName)
    reconcileRailVoice()
  })

  const refreshPendingNarration = (hasFinalText: boolean, reasoningActive: boolean) => {
    const actions = rail.groups().flatMap((group) => group.actions)
    railPendingNarration = showsPendingNarration({
      actions,
      hasFinalText,
      reasoningActive,
      streaming: agentWorking,
    })
    requestRender?.()
  }

  const openRailEntry = () => {
    if (!railEnabled || !railTurnPending) return
    railTurnPending = false
    transcriptLayoutFix?.markDirty()
    pi.appendEntry(railEntryType, { turn: railTurn })
  }

  const reconcileRailVoice = () => {
    const projection = railVoice.projection()
    liveUsageAssistantAt = projection.hasTrailingText
      ? projection.trailingTextMessageTimestamp
      : undefined
    if (
      projection.openingMessageTimestamp !== undefined &&
      railOpeningAt.get(railTurn) !== projection.openingMessageTimestamp
    ) {
      railOpeningAt.set(railTurn, projection.openingMessageTimestamp)
      transcriptLayoutFix?.markDirty()
    }
    currentHiddenNarrationBlocks = projection.hiddenTextBlocks
    const nextIds = new Set(projection.rows.map((row) => row.id))
    for (const id of railPseudoIds) {
      if (!nextIds.has(id)) rail.remove(id)
    }
    for (const row of projection.rows) rail.report(row.id, row.patch)
    rail.reorder(projection.order)
    railPseudoIds = nextIds
    if (projection.rows.length > 0 || rail.size() > 0) openRailEntry()
    if (!railEnabled) {
      railPendingNarration = false
      requestRender?.()
      return
    }
    refreshPendingNarration(projection.hasTrailingText, projection.reasoningActive)
  }

  pi.on('tool_execution_start', (event, ctx) => {
    railPendingNarration = false
    if (railTools.has(event.toolName)) {
      const target = railFor(event.toolCallId)
      if (!target.has(event.toolCallId)) {
        target.report(
          event.toolCallId,
          railPatchForCall({ arguments: event.args, toolName: event.toolName }, ctx.cwd),
        )
      }
      openRailEntry()
      reconcileRailVoice()
      railPendingNarration = false
      requestRender?.()
    }
    if (isAskTool(event.toolName)) {
      play(ctx, sound.awaitingInputSound)
    }
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

  pi.on('message_start', (event) => {
    if (event.message.role === 'assistant') {
      railVoice.start(event.message)
      spacerFix?.markDirty()
      reconcileRailVoice()
    }
    if (event.message.role === 'assistant' || event.message.role === 'user') {
      speakerSpacingFix?.markDirty()
    }
  })

  pi.on('message_update', (event) => {
    if (event.message.role !== 'assistant') return
    railVoice.update(event.message, event.assistantMessageEvent)
    reconcileRailVoice()
  })

  pi.on('message_end', (event, ctx) => {
    if (event.message.role === 'user') speakerSpacingFix?.markDirty()
    if (event.message.role === 'assistant') {
      railVoice.finish(event.message)
      reconcileRailVoice()
    }
    if (active) {
      sync(ctx)
    }
  })

  pi.on('tool_execution_end', (event, ctx) => {
    const target = railFor(event.toolCallId)
    if (target.has(event.toolCallId)) {
      target.report(event.toolCallId, { status: event.isError ? 'error' : 'ok' })
    }
    reconcileRailVoice()
    if (active) {
      sync(ctx)
      start(refreshGit(ctx, generation))
    }
  })

  pi.on('agent_end', (_event, ctx) => {
    agentWorking = false
    liveUsageAssistantAt = undefined
    assistantUsageLines.clear()
    if (!railTurnPending) {
      for (const action of rail.values()) persistRailAction(action)
      mergeHiddenTextBlocks(hiddenNarrationBlocks, currentHiddenNarrationBlocks)
    }
    unsubscribeAnimation?.()
    unsubscribeAnimation = undefined
    railPendingNarration = false
    speakerSpacingFix?.markDirty()
    requestRender?.()
    dock.stop()
    if (active) {
      sync(ctx)
      start(refreshGit(ctx, generation))
      play(ctx, sound.completionSound)
    }
  })

  const setRail = (enabled: boolean, ctx: ExtensionContext) => {
    railEnabled = enabled
    applyRailTools(pi, railFor, railCwd ?? ctx.cwd, railEnabled)
    pi.events.emit(railEnabledChannel, { enabled: railEnabled })
    applyThinkingLabel(ctx)
    reconcileRailVoice()
    ctx.ui.notify(`hud: rail ${railEnabled ? 'enabled' : 'disabled'}`, 'info')
  }

  const setThinking = (railOnly: boolean, ctx: ExtensionContext) => {
    quietThinking = railOnly
    applyThinkingLabel(ctx)
    requestRender?.()
    ctx.ui.notify(
      `hud: thinking ${quietThinking ? 'shown in the rail only' : 'shown inline and in the rail'}`,
      'info',
    )
  }

  const setTimestamps = (enabled: boolean, ctx: ExtensionContext) => {
    if (timestamps.enabled() !== enabled) timestamps.toggle()
    speakerSpacingFix?.markDirty()
    requestRender?.()
    ctx.ui.notify(`hud: timestamps ${enabled ? 'enabled' : 'disabled'}`, 'info')
  }

  const runSoundCommand = async (args: string, ctx: ExtensionContext) => {
    const command = parseSoundCommand(args)
    const rejectSound = () => {
      ctx.ui.notify('hud: invalid sound, use a known id or an absolute file path', 'error')
    }
    const setCompletion = (raw: string) => {
      const value = normalizeSoundValue(raw)
      if (value === undefined) {
        rejectSound()
        return
      }
      applySoundSettings(ctx, { ...sound, completionSound: value }, `completion sound = ${value}`)
      start(previewSound(value))
    }
    const setAwaiting = (raw: string) => {
      const value = normalizeSoundValue(raw)
      if (value === undefined) {
        rejectSound()
        return
      }
      applySoundSettings(
        ctx,
        { ...sound, awaitingInputSound: value },
        `awaiting-input sound = ${value}`,
      )
      start(previewSound(value))
    }
    const setFocus = (mode: SoundFocusMode) => {
      applySoundSettings(ctx, { ...sound, soundFocusMode: mode }, `sound focus mode = ${mode}`)
    }
    switch (command.kind) {
      case 'preview':
        start(previewSound(sound.completionSound))
        ctx.ui.notify(`hud: playing ${sound.completionSound}`, 'info')
        return
      case 'setCompletion':
        setCompletion(command.value)
        return
      case 'setAwaiting':
        setAwaiting(command.value)
        return
      case 'setFocus':
        setFocus(command.mode)
        return
      case 'pickCompletion': {
        const pick = choiceValue(
          await ctx.ui.select('Select completion sound', soundChoiceRows(sound.completionSound)),
        )
        if (pick) setCompletion(pick)
        return
      }
      case 'pickAwaiting': {
        const pick = choiceValue(
          await ctx.ui.select(
            'Select awaiting-input sound',
            soundChoiceRows(sound.awaitingInputSound),
          ),
        )
        if (pick) setAwaiting(pick)
        return
      }
      case 'pickFocus': {
        const pick = choiceValue(
          await ctx.ui.select('Select sound focus mode', focusChoiceRows(sound.soundFocusMode)),
        )
        if (isFocusMode(pick)) setFocus(pick)
        return
      }
    }
  }

  const pickSoundSetting = async (ctx: ExtensionContext) => {
    const pick = choiceValue(
      await ctx.ui.select('Sound settings', [
        `completion - Completion sound (${sound.completionSound})`,
        `ask - Awaiting-input sound (${sound.awaitingInputSound})`,
        `focus - Focus policy (${sound.soundFocusMode})`,
        'test - Preview the completion sound',
      ]),
    )
    if (pick === 'completion') await runSoundCommand('', ctx)
    else if (pick === 'ask') await runSoundCommand('ask', ctx)
    else if (pick === 'focus') await runSoundCommand('focus', ctx)
    else if (pick === 'test') await runSoundCommand('test', ctx)
  }

  const pickHudSetting = async (ctx: ExtensionContext) => {
    const pick = choiceValue(
      await ctx.ui.select('HUD settings', [
        `rail - Action rail (${railEnabled ? 'enabled' : 'disabled'})`,
        `thinking - Thinking text (${quietThinking ? 'rail only' : 'inline'})`,
        `timestamps - Speaker headers (${timestamps.enabled() ? 'enabled' : 'disabled'})`,
        'sound - Sound settings',
      ]),
    )
    if (pick === 'rail') setRail(!railEnabled, ctx)
    else if (pick === 'thinking') setThinking(!quietThinking, ctx)
    else if (pick === 'timestamps') setTimestamps(!timestamps.enabled(), ctx)
    else if (pick === 'sound') await pickSoundSetting(ctx)
  }

  pi.registerCommand('hud', {
    description: 'Configure the action rail, thinking text, speaker headers, and sounds',
    getArgumentCompletions: hudCommandCompletions,
    async handler(args, ctx) {
      const command = parseHudCommand(args)
      switch (command.kind) {
        case 'pick':
          await pickHudSetting(ctx)
          return
        case 'rail':
          setRail(resolveToggle(railEnabled, command.mode), ctx)
          return
        case 'thinking':
          setThinking(command.mode === 'toggle' ? !quietThinking : command.mode === 'rail', ctx)
          return
        case 'timestamps':
          setTimestamps(resolveToggle(timestamps.enabled(), command.mode), ctx)
          return
        case 'sound':
          await runSoundCommand(command.args, ctx)
          return
        case 'invalid':
          ctx.ui.notify('hud: use rail, thinking, timestamps, or sound', 'error')
      }
    },
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
    dock.dispose(ctx.hasUI && ctx.mode === 'tui' ? ctx.ui : undefined)
    if (ctx.hasUI && ctx.mode === 'tui' && footerOwned) {
      ctx.ui.setFooter(undefined)
    }
    footerOwned = false
    requestRender = undefined
  })
}
