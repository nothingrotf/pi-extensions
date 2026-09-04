import { soundCompletions } from './sound.ts'

export type ToggleMode = 'off' | 'on' | 'toggle'

export type HudCommand =
  | { kind: 'invalid' }
  | { kind: 'pick' }
  | { args: string; kind: 'sound' }
  | { kind: 'rail'; mode: ToggleMode }
  | { kind: 'thinking'; mode: 'inline' | 'rail' | 'toggle' }
  | { kind: 'timestamps'; mode: ToggleMode }

function toggleMode(value: string): ToggleMode | undefined {
  if (value === 'off' || value === 'on' || value === 'toggle') return value
  return undefined
}

export function parseHudCommand(args: string): HudCommand {
  const raw = args.trim()
  if (raw.length === 0) return { kind: 'pick' }
  const [head = '', ...tail] = raw.split(/\s+/u)
  const command = head.toLowerCase()
  const rest = tail.join(' ')
  if (command === 'sound') return { args: rest, kind: 'sound' }
  if (command === 'rail' || command === 'timestamps') {
    const mode = rest.length === 0 ? 'toggle' : toggleMode(rest.toLowerCase())
    return mode === undefined ? { kind: 'invalid' } : { kind: command, mode }
  }
  if (command === 'thinking') {
    const mode = rest.length === 0 ? 'toggle' : rest.toLowerCase()
    if (mode === 'inline' || mode === 'rail' || mode === 'toggle') {
      return { kind: 'thinking', mode }
    }
  }
  return { kind: 'invalid' }
}

export function resolveToggle(current: boolean, mode: ToggleMode): boolean {
  if (mode === 'on') return true
  if (mode === 'off') return false
  return !current
}

function completions(
  command: string,
  prefix: string,
  values: readonly string[],
): { label: string; value: string }[] {
  return values
    .filter((value) => value.startsWith(prefix))
    .map((value) => ({ label: value, value: `${command} ${value}` }))
}

export function hudCommandCompletions(prefix: string): { label: string; value: string }[] {
  const input = prefix.trimStart()
  const separator = input.indexOf(' ')
  if (separator < 0) {
    return ['rail', 'thinking', 'timestamps', 'sound']
      .filter((value) => value.startsWith(input.toLowerCase()))
      .map((value) => ({ label: value, value }))
  }
  const command = input.slice(0, separator).toLowerCase()
  const argument = input
    .slice(separator + 1)
    .trimStart()
    .toLowerCase()
  if (command === 'sound') {
    return soundCompletions(argument).map((item) => ({
      label: item.label,
      value: `sound ${item.value}`,
    }))
  }
  if (command === 'thinking') {
    return completions(command, argument, ['rail', 'inline', 'toggle'])
  }
  if (command === 'rail' || command === 'timestamps') {
    return completions(command, argument, ['on', 'off', 'toggle'])
  }
  return []
}
