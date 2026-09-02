import type { Theme } from '@earendil-works/pi-coding-agent'

export type ShimmerTheme = Pick<Theme, 'getFgAnsi'>

const SPEED_CELLS_PER_SECOND = 30
const PADDING = 10
const BAND_HALF_WIDTH = 6
const TIER_HIGH = 0.65
const TIER_MID = 0.22
const FG_RESET = '\x1b[39m'
const BOLD_OPEN = '\x1b[1m'
const BOLD_CLOSE = '\x1b[22m'

type Tier = 'high' | 'low' | 'mid'

interface TierSequence {
  close: string
  open: string
}

interface TierSequences {
  high: TierSequence
  low: TierSequence
  mid: TierSequence
}

function intensity(time: number, index: number, length: number): number {
  const period = length + PADDING * 2
  const position = ((time / 1000) * SPEED_CELLS_PER_SECOND) % period
  const distance = Math.abs(index + PADDING - position)
  if (distance >= BAND_HALF_WIDTH) return 0
  return 0.5 * (1 + Math.cos((Math.PI * distance) / BAND_HALF_WIDTH))
}

function tierFor(value: number): Tier {
  if (value >= TIER_HIGH) return 'high'
  if (value >= TIER_MID) return 'mid'
  return 'low'
}

export function shimmerText(text: string, theme: ShimmerTheme, time = Date.now()): string {
  const characters = Array.from(text)
  if (characters.length === 0) return ''
  const sequences: TierSequences = {
    high: { close: `${BOLD_CLOSE}${FG_RESET}`, open: `${BOLD_OPEN}${theme.getFgAnsi('accent')}` },
    low: { close: FG_RESET, open: theme.getFgAnsi('dim') },
    mid: { close: FG_RESET, open: theme.getFgAnsi('muted') },
  }
  let output = ''
  let runTier: Tier | undefined
  let run = ''
  characters.forEach((character, index) => {
    const tier = tierFor(intensity(time, index, characters.length))
    if (tier !== runTier) {
      if (runTier !== undefined && run.length > 0) {
        output += `${sequences[runTier].open}${run}${sequences[runTier].close}`
      }
      runTier = tier
      run = ''
    }
    run += character
  })
  if (runTier !== undefined && run.length > 0) {
    output += `${sequences[runTier].open}${run}${sequences[runTier].close}`
  }
  return output
}
