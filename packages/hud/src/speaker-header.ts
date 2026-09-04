import type { Theme } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'

import {
  ansiForeground,
  ansiReset,
  assistantAnsi,
  empryoBrand,
  empryoBrandAlt,
  empryoBrandDim,
  empryoTextFaint,
  empryoTextPrimary,
  userAnsi,
} from './colors.ts'
import { pulseFrame } from './pulse.ts'
import { shimmerTextAtTick } from './shimmer.ts'
import { frameTranscriptLine } from './transcript-geometry.ts'

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
}

export type SpeakerHeaderSource = (timestamp: number) => SpeakerHeaderFrame

export type SpeakerHeaderTheme = Pick<Theme, 'bold'>

const brandAnsi = assistantAnsi()
const brandAltAnsi = ansiForeground(empryoBrandAlt)
const brandDimAnsi = ansiForeground(empryoBrandDim)
const textFaintAnsi = ansiForeground(empryoTextFaint)
const textPrimaryAnsi = ansiForeground(empryoTextPrimary)

export function formatSpeakerClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function speakerMotionEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return !environment.NO_MOTION && environment.EMPRYO_NO_MOTION !== '1'
}

function staticSpeakerLine(
  data: SpeakerHeaderData,
  theme: SpeakerHeaderTheme,
  timestamp: number,
): string {
  const tone = data.assistant ? brandAnsi : userAnsi()
  return `${tone}${data.glyph}${ansiReset}${theme.bold(`${textPrimaryAnsi} ${data.label}${ansiReset}`)}${textFaintAnsi} · ${formatSpeakerClock(timestamp)}${ansiReset}`
}

function initialLiveLine(
  data: SpeakerHeaderData,
  theme: SpeakerHeaderTheme,
  timestamp: number,
): string {
  return `${brandDimAnsi}·${ansiReset}${theme.bold(`${textPrimaryAnsi} ${data.label}${ansiReset}`)}${textFaintAnsi} · ${formatSpeakerClock(timestamp)}${ansiReset}`
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
  const pulse = pulseFrame(frame.tick, empryoBrandDim, empryoBrand)
  const glyph = `${ansiForeground(pulse.color)}${pulse.glyph}${ansiReset}`
  const name = theme.bold(
    shimmerTextAtTick(
      ` ${data.label}`,
      { baseAnsi: textPrimaryAnsi, tintAnsi: brandAltAnsi },
      frame.tick,
    ),
  )
  return `${glyph}${name}${textFaintAnsi} · ${formatSpeakerClock(frame.timestamp)}${ansiReset}`
}

export class SpeakerHeaderComponent implements Component {
  private readonly initialTick: number

  constructor(
    private readonly data: SpeakerHeaderData,
    private readonly theme: SpeakerHeaderTheme,
    private readonly source?: SpeakerHeaderSource,
    private readonly visible: () => boolean = () => true,
  ) {
    this.initialTick = source?.(data.timestamp).tick ?? 0
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (!this.visible()) return []
    const line = speakerHeaderLine(
      this.data,
      this.theme,
      this.source?.(this.data.timestamp),
      this.initialTick,
    )
    return [frameTranscriptLine(line, width)]
  }
}
