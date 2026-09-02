import { execFile, type ChildProcess } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { Type } from 'typebox'
import type { Static } from 'typebox'
import { Value } from 'typebox/value'

import { agentDir } from './usage.ts'

export const builtinSounds: readonly string[] = ['fx-ok01', 'fx-ack01']
export const soundChoices: readonly string[] = ['off', 'bell', ...builtinSounds]
export const focusModes: readonly string[] = ['always', 'focused', 'unfocused']

const SoundFocusModeSchema = Type.Union([
  Type.Literal('always'),
  Type.Literal('focused'),
  Type.Literal('unfocused'),
])

export type SoundFocusMode = Static<typeof SoundFocusModeSchema>

const SoundSettingsSchema = Type.Object({
  completionSound: Type.Optional(Type.String()),
  awaitingInputSound: Type.Optional(Type.String()),
  soundFocusMode: Type.Optional(SoundFocusModeSchema),
})

export type SoundSettings = {
  completionSound: string
  awaitingInputSound: string
  soundFocusMode: SoundFocusMode
}

export const defaultSoundSettings: SoundSettings = {
  completionSound: 'fx-ok01',
  awaitingInputSound: 'fx-ack01',
  soundFocusMode: 'always',
}

export function describeSound(id: string): string {
  switch (id) {
    case 'off':
      return 'No sound'
    case 'bell':
      return 'Terminal bell'
    case 'fx-ok01':
      return 'Soft success bloop'
    case 'fx-ack01':
      return 'Tactile ripple feedback'
    default:
      return id
  }
}

export function describeFocusMode(mode: SoundFocusMode): string {
  switch (mode) {
    case 'always':
      return 'Play regardless of terminal focus'
    case 'focused':
      return 'Play only when the terminal is focused'
    case 'unfocused':
      return 'Play only when the terminal is not focused'
  }
}

export function isFocusMode(value: string): value is SoundFocusMode {
  return Value.Check(SoundFocusModeSchema, value)
}

export function isAskTool(name: string): boolean {
  return /(^|_)ask(_|user|$)|question/iu.test(name)
}

function isPlayableFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile()
  } catch {
    return false
  }
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\')
}

export function normalizeSoundValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }
  if (soundChoices.includes(value)) {
    return value
  }
  if (!isAbsolutePath(value)) {
    return undefined
  }
  return isPlayableFile(value) ? value : undefined
}

export function soundSettingsPath(): string {
  return join(agentDir(), 'hud.json')
}

export async function loadSoundSettings(): Promise<SoundSettings> {
  try {
    const content = await readFile(soundSettingsPath(), { encoding: 'utf8' })
    const parsed = Value.Decode(SoundSettingsSchema, JSON.parse(content))
    return {
      completionSound:
        normalizeSoundValue(parsed.completionSound) ?? defaultSoundSettings.completionSound,
      awaitingInputSound:
        normalizeSoundValue(parsed.awaitingInputSound) ?? defaultSoundSettings.awaitingInputSound,
      soundFocusMode: parsed.soundFocusMode ?? defaultSoundSettings.soundFocusMode,
    }
  } catch {
    return { ...defaultSoundSettings }
  }
}

export async function saveSoundSettings(settings: SoundSettings): Promise<void> {
  const path = soundSettingsPath()
  await mkdir(agentDir(), { recursive: true })
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8' })
}

export type SoundCommand =
  | { kind: 'preview' }
  | { kind: 'pickCompletion' }
  | { kind: 'setCompletion'; value: string }
  | { kind: 'pickAwaiting' }
  | { kind: 'setAwaiting'; value: string }
  | { kind: 'pickFocus' }
  | { kind: 'setFocus'; mode: SoundFocusMode }

export function parseSoundCommand(args: string): SoundCommand {
  const raw = args.trim()
  if (!raw) {
    return { kind: 'pickCompletion' }
  }
  const [head = '', ...rest] = raw.split(/\s+/u)
  const keyword = head.toLowerCase()
  if (keyword === 'test') {
    return { kind: 'preview' }
  }
  if (keyword === 'ask') {
    const value = rest.join(' ').trim()
    return value ? { kind: 'setAwaiting', value } : { kind: 'pickAwaiting' }
  }
  if (keyword === 'focus') {
    const mode = (rest[0] ?? '').toLowerCase()
    return isFocusMode(mode) ? { kind: 'setFocus', mode } : { kind: 'pickFocus' }
  }
  return { kind: 'setCompletion', value: raw }
}

export function soundCompletions(prefix: string): { value: string; label: string }[] {
  const trimmed = prefix.trim()
  const values = [...soundChoices, 'ask', 'focus', 'test']
  return values
    .filter((value) => value.startsWith(trimmed))
    .map((value) => ({ value, label: value }))
}

export function soundChoiceRows(current: string): string[] {
  return soundChoices.map(
    (id) => `${id} - ${describeSound(id)}${id === current ? ' (current)' : ''}`,
  )
}

export function focusChoiceRows(current: SoundFocusMode): string[] {
  return focusModes.map((mode) => {
    const description = isFocusMode(mode) ? describeFocusMode(mode) : mode
    return `${mode} - ${description}${mode === current ? ' (current)' : ''}`
  })
}

export function choiceValue(pick: string | undefined): string {
  return (pick ?? '').trim().split(/\s+/u)[0] ?? ''
}

function builtinPath(id: string): string {
  return fileURLToPath(new URL(`./sounds/${id}.wav`, import.meta.url))
}

const execFileAsync = promisify(execFile)
const playerCache = new Map<string, string | undefined>()

async function commandExists(command: string): Promise<boolean> {
  try {
    const probe = process.platform === 'win32' ? 'where' : 'which'
    await execFileAsync(probe, [command], { timeout: 1000 })
    return true
  } catch {
    return false
  }
}

export function terminalBell(): void {
  try {
    if (process.stdout.isTTY) {
      process.stdout.write('\x07')
    }
  } catch {}
}

type Player = { command: string; args: string[] }

async function resolvePlayerCommand(): Promise<string | undefined> {
  const platform = process.platform
  if (playerCache.has(platform)) {
    return playerCache.get(platform)
  }
  let command: string | undefined
  if (platform === 'darwin') {
    command = 'afplay'
  } else if (platform === 'win32') {
    command = 'powershell'
  } else if (platform === 'linux') {
    for (const candidate of ['paplay', 'aplay', 'ffplay']) {
      if (await commandExists(candidate)) {
        command = candidate
        break
      }
    }
  }
  playerCache.set(platform, command)
  return command
}

async function playerFor(file: string): Promise<Player | undefined> {
  const command = await resolvePlayerCommand()
  if (command === undefined) {
    return undefined
  }
  if (command === 'aplay') {
    return { command, args: ['-q', file] }
  }
  if (command === 'ffplay') {
    return { command, args: ['-nodisp', '-autoexit', file] }
  }
  if (command === 'powershell') {
    const escaped = file.replace(/'/gu, "''")
    return {
      command,
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-c',
        `Add-Type -AssemblyName System.Windows.Forms; (New-Object Media.SoundPlayer '${escaped}').PlaySync()`,
      ],
    }
  }
  return { command, args: [file] }
}

const activePlayers = new Map<ChildProcess, () => void>()
let playbackGeneration = 0

export function stopSoundPlayback(): void {
  playbackGeneration += 1
  for (const [child, settle] of activePlayers) {
    settle()
    try {
      child.kill('SIGTERM')
    } catch {}
  }
  activePlayers.clear()
}

async function playFile(file: string): Promise<boolean> {
  const generation = playbackGeneration
  if (!isPlayableFile(file)) {
    terminalBell()
    return false
  }
  const player = await playerFor(file)
  if (generation !== playbackGeneration) {
    return false
  }
  if (player === undefined) {
    terminalBell()
    return false
  }
  return new Promise((resolve) => {
    let settled = false
    let child: ChildProcess | undefined
    const settle = (success: boolean, notify: boolean) => {
      if (settled) {
        return
      }
      settled = true
      if (child !== undefined) {
        activePlayers.delete(child)
      }
      if (!success && notify) {
        terminalBell()
      }
      resolve(success)
    }
    child = execFile(
      player.command,
      player.args,
      { timeout: 2000, killSignal: 'SIGTERM' },
      (error) => {
        settle(error === null, true)
      },
    )
    activePlayers.set(child, () => settle(false, false))
    child.on('error', () => settle(false, true))
  })
}

export async function playSound(
  sound: string,
  focusMode: SoundFocusMode,
  isFocused: boolean,
): Promise<void> {
  if (!sound || sound === 'off') {
    return
  }
  if (focusMode === 'focused' && !isFocused) {
    return
  }
  if (focusMode === 'unfocused' && isFocused) {
    return
  }
  if (sound === 'bell') {
    terminalBell()
    return
  }
  await playFile(builtinSounds.includes(sound) ? builtinPath(sound) : sound)
}

export function previewSound(sound: string): Promise<void> {
  return playSound(sound, 'always', true)
}

const enableFocusReporting = '\x1b[?1004h'
const disableFocusReporting = '\x1b[?1004l'

export class FocusTracker {
  private focused = true
  private enabled = false

  get isFocused(): boolean {
    return this.focused
  }

  enable(): void {
    if (this.enabled) {
      return
    }
    try {
      if (process.stdout.isTTY) {
        process.stdout.write(enableFocusReporting)
        this.enabled = true
      }
    } catch {}
  }

  disable(): void {
    if (!this.enabled) {
      return
    }
    try {
      if (process.stdout.isTTY) {
        process.stdout.write(disableFocusReporting)
      }
    } catch {}
    this.enabled = false
  }

  handleInput(data: string): void {
    if (!data) {
      return
    }
    if (data.includes('\x1b[I')) {
      this.focused = true
    }
    if (data.includes('\x1b[O')) {
      this.focused = false
    }
  }
}
