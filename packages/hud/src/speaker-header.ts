import type { Theme } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'

import {
  ansiForeground,
  ansiReset,
  assistantAnsi,
  type HudPalette,
  paletteFromTheme,
  userAnsi,
} from './colors.ts'
import { pulseFrame } from './pulse.ts'
import { shimmerTextAtTick } from './shimmer.ts'
import { frameTranscriptLine, speakerBodyIndent } from './transcript-geometry.ts'
import type { WorkingFrame } from './working.ts'

export type SpeakerHeaderData = {
  assistant: boolean
  glyph: '◆' | '●'
  label: string
  timestamp: number
}

export type SpeakerHeaderFrame = {
  active: boolean
  motion: boolean
  tick: number
  timestamp: number
  waiting?: WorkingFrame
}

export type SpeakerHeaderSource = (timestamp: number) => SpeakerHeaderFrame

export type SpeakerHeaderTheme = Pick<Theme, 'bold'> &
  Partial<Pick<Theme, 'getBgAnsi' | 'getFgAnsi'>>

type SpeakerTones = {
  brandAlt: string
  brandDim: string
  palette: HudPalette
  textFaint: string
  textMuted: string
  textPrimary: string
}

function speakerTones(theme: Partial<Pick<Theme, 'getBgAnsi' | 'getFgAnsi'>>): SpeakerTones {
  const getFgAnsi = theme.getFgAnsi?.bind(theme)
  const getBgAnsi = theme.getBgAnsi?.bind(theme)
  const source =
    getFgAnsi === undefined
      ? undefined
      : getBgAnsi === undefined
        ? { getFgAnsi }
        : { getBgAnsi, getFgAnsi }
  const palette = paletteFromTheme(source)
  return {
    brandAlt: ansiForeground(palette.brandAlt),
    brandDim: ansiForeground(palette.brandDim),
    palette,
    textFaint: ansiForeground(palette.textFaint),
    textMuted: ansiForeground(palette.textMuted),
    textPrimary: ansiForeground(palette.textPrimary),
  }
}

const clockFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

export function formatSpeakerClock(timestamp: number): string {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? date.toString() : clockFormatter.format(date)
}

export function speakerMotionEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return !environment.NO_MOTION
}

function staticSpeakerLine(
  data: SpeakerHeaderData,
  theme: SpeakerHeaderTheme,
  timestamp: number,
): string {
  const tones = speakerTones(theme)
  const tone = data.assistant ? assistantAnsi(tones.palette) : userAnsi(tones.palette)
  return `${tone}${data.glyph}${ansiReset}${theme.bold(`${tones.textPrimary} ${data.label}${ansiReset}`)}${tones.textFaint} · ${formatSpeakerClock(timestamp)}${ansiReset}`
}

function initialLiveLine(
  data: SpeakerHeaderData,
  theme: SpeakerHeaderTheme,
  timestamp: number,
): string {
  const tones = speakerTones(theme)
  return `${tones.brandDim}·${ansiReset}${theme.bold(`${tones.textPrimary} ${data.label}${ansiReset}`)}${tones.textFaint} · ${formatSpeakerClock(timestamp)}${ansiReset}`
}

export function speakerHeaderLine(
  data: SpeakerHeaderData,
  theme: SpeakerHeaderTheme,
  frame: SpeakerHeaderFrame | undefined,
  initialTick: number,
): string {
  if (!data.assistant || frame === undefined || !frame.active || !frame.motion) {
    return staticSpeakerLine(data, theme, frame?.timestamp ?? data.timestamp)
  }
  if (frame.tick === initialTick) return initialLiveLine(data, theme, frame.timestamp)
  const tones = speakerTones(theme)
  const pulse = pulseFrame(frame.tick, tones.palette.brandDim, tones.palette.brand)
  const glyph = `${ansiForeground(pulse.color)}${pulse.glyph}${ansiReset}`
  const name = theme.bold(
    shimmerTextAtTick(
      ` ${data.label}`,
      { baseAnsi: tones.textPrimary, tintAnsi: tones.brandAlt },
      frame.tick,
    ),
  )
  return `${glyph}${name}${tones.textFaint} · ${formatSpeakerClock(frame.timestamp)}${ansiReset}`
}

export function speakerWaitingLine(
  frame: WorkingFrame,
  theme: Partial<Pick<Theme, 'getBgAnsi' | 'getFgAnsi'>> = {},
): string {
  const tones = speakerTones(theme)
  const elapsed =
    frame.elapsed === undefined ? '' : `${tones.textFaint} · ${frame.elapsed}${ansiReset}`
  return `${tones.brandDim}${frame.spinner}${ansiReset}${tones.textMuted} ${frame.message}${ansiReset}${elapsed}`
}

export class SpeakerHeaderComponent implements Component {
  private readonly initialTick: number
  private cached: { key: string; lines: string[] } | undefined

  constructor(
    private readonly data: SpeakerHeaderData,
    private readonly theme: SpeakerHeaderTheme,
    private readonly source?: SpeakerHeaderSource,
    private readonly visible: () => boolean = () => true,
  ) {
    this.initialTick = source?.(data.timestamp).tick ?? 0
  }

  invalidate(): void {
    this.cached = undefined
  }

  render(width: number): string[] {
    if (!this.visible()) return []
    const frame = this.source?.(this.data.timestamp)
    const key = JSON.stringify([
      width,
      Math.floor((frame?.timestamp ?? this.data.timestamp) / 60_000),
      frame?.active === true && frame.motion ? frame.tick : undefined,
      frame?.waiting,
    ])
    if (this.cached?.key === key) return this.cached.lines
    const line = speakerHeaderLine(this.data, this.theme, frame, this.initialTick)
    const lines =
      frame?.waiting === undefined
        ? [frameTranscriptLine(line, width)]
        : [
            frameTranscriptLine(line, width),
            frameTranscriptLine(
              speakerWaitingLine(frame.waiting, this.theme),
              width,
              speakerBodyIndent,
            ),
            frameTranscriptLine('', width),
          ]
    this.cached = { key, lines }
    return lines
  }
}
