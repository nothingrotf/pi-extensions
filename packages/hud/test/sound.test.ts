import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  choiceValue,
  defaultSoundSettings,
  FocusTracker,
  focusChoiceRows,
  isAskTool,
  loadSoundSettings,
  normalizeSoundValue,
  parseSoundCommand,
  saveSoundSettings,
  soundChoiceRows,
  soundCompletions,
  soundSettingsPath,
} from '../src/sound.ts'

describe('HUD sound values', () => {
  test('accepts known ids and rejects relative or missing paths', () => {
    expect(normalizeSoundValue('off')).toBe('off')
    expect(normalizeSoundValue('bell')).toBe('bell')
    expect(normalizeSoundValue('fx-ok01')).toBe('fx-ok01')
    expect(normalizeSoundValue('fx-ack01')).toBe('fx-ack01')
    expect(normalizeSoundValue('')).toBeUndefined()
    expect(normalizeSoundValue(undefined)).toBeUndefined()
    expect(normalizeSoundValue('sounds/x.wav')).toBeUndefined()
    expect(normalizeSoundValue('/definitely/missing/file.wav')).toBeUndefined()
  })

  test('accepts an absolute path to an existing file', () => {
    const file = new URL('../src/sounds/fx-ok01.wav', import.meta.url).pathname
    expect(normalizeSoundValue(file)).toBe(file)
  })

  test('detects ask style tools', () => {
    expect(isAskTool('AskQuestion')).toBe(true)
    expect(isAskTool('ask_user')).toBe(true)
    expect(isAskTool('ask')).toBe(true)
    expect(isAskTool('bash')).toBe(false)
    expect(isAskTool('task')).toBe(false)
  })
})

describe('HUD sound command', () => {
  test('parses every subcommand', () => {
    expect(parseSoundCommand('')).toEqual({ kind: 'pickCompletion' })
    expect(parseSoundCommand('test')).toEqual({ kind: 'preview' })
    expect(parseSoundCommand('fx-ok01')).toEqual({ kind: 'setCompletion', value: 'fx-ok01' })
    expect(parseSoundCommand('ask')).toEqual({ kind: 'pickAwaiting' })
    expect(parseSoundCommand('ask bell')).toEqual({ kind: 'setAwaiting', value: 'bell' })
    expect(parseSoundCommand('focus')).toEqual({ kind: 'pickFocus' })
    expect(parseSoundCommand('focus nope')).toEqual({ kind: 'pickFocus' })
    expect(parseSoundCommand('focus unfocused')).toEqual({ kind: 'setFocus', mode: 'unfocused' })
  })

  test('builds completions and picker rows', () => {
    expect(soundCompletions('f').map((item) => item.value)).toEqual([
      'fx-ok01',
      'fx-ack01',
      'focus',
    ])
    expect(soundChoiceRows('bell')).toContain('bell - Terminal bell (current)')
    expect(focusChoiceRows('always')[0]).toBe(
      'always - Play regardless of terminal focus (current)',
    )
    expect(choiceValue('fx-ok01 - Soft success bloop')).toBe('fx-ok01')
    expect(choiceValue(undefined)).toBe('')
  })
})

describe('HUD sound settings', () => {
  let directory = ''
  let previous: string | undefined

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'hud-sound-'))
    previous = process.env.PI_CODING_AGENT_DIR
    process.env.PI_CODING_AGENT_DIR = directory
  })

  afterEach(async () => {
    if (previous === undefined) {
      delete process.env.PI_CODING_AGENT_DIR
    } else {
      process.env.PI_CODING_AGENT_DIR = previous
    }
    await rm(directory, { recursive: true, force: true })
  })

  test('falls back to defaults when the file is missing', async () => {
    expect(soundSettingsPath()).toBe(join(directory, 'hud.json'))
    expect(await loadSoundSettings()).toEqual(defaultSoundSettings)
  })

  test('round trips saved settings and repairs invalid values', async () => {
    await saveSoundSettings({
      completionSound: 'bell',
      awaitingInputSound: 'off',
      soundFocusMode: 'unfocused',
    })
    const raw = JSON.parse(await readFile(soundSettingsPath(), 'utf8'))
    expect(raw).toEqual({
      completionSound: 'bell',
      awaitingInputSound: 'off',
      soundFocusMode: 'unfocused',
    })
    expect(await loadSoundSettings()).toEqual({
      completionSound: 'bell',
      awaitingInputSound: 'off',
      soundFocusMode: 'unfocused',
    })
    await saveSoundSettings({
      completionSound: 'relative.wav',
      awaitingInputSound: 'fx-ack01',
      soundFocusMode: 'focused',
    })
    expect(await loadSoundSettings()).toEqual({
      completionSound: 'fx-ok01',
      awaitingInputSound: 'fx-ack01',
      soundFocusMode: 'focused',
    })
  })
})

describe('HUD focus tracker', () => {
  test('follows focus in and focus out sequences', () => {
    const tracker = new FocusTracker()
    expect(tracker.isFocused).toBe(true)
    tracker.handleInput('\x1b[O')
    expect(tracker.isFocused).toBe(false)
    tracker.handleInput('abc\x1b[I')
    expect(tracker.isFocused).toBe(true)
    tracker.handleInput('')
    expect(tracker.isFocused).toBe(true)
  })
})
