import { stripVTControlCharacters } from 'node:util'

import { initTheme } from '@earendil-works/pi-coding-agent'
import { afterEach, expect, it } from 'vite-plus/test'

import { nodeCommand, start, waitForCommand } from './helpers.ts'
import { sessionFixture } from './session-harness.ts'
import { terminalUI } from './terminal-ui.js'

const closers: Array<() => void> = []
afterEach(() => {
  for (const close of closers.splice(0)) close()
})

it('docks running commands above the editor and stops one from the /bg pane', async () => {
  initTheme('dark')
  const ui = terminalUI()
  closers.push(() => ui.close())
  const fixture = await sessionFixture(undefined, 'injected', undefined, (base) => ui.wrap(base))
  const runner = fixture.session.extensionRunner
  const dock = ui.widget('background-commands')
  if (dock === undefined) throw new Error('Missing background command dock')
  expect(dock.placement).toBe('aboveEditor')
  expect(dock.component.render(100)).toEqual([])
  expect([...runner.getShortcuts({}).keys()]).toContain('ctrl+shift+b')

  const command = runner.getCommand('bg')
  if (command === undefined) throw new Error('Missing /bg command')
  await command.handler('', runner.createCommandContext())
  expect(ui.notices).toEqual(['No background commands in this session.'])

  const handle = start(fixture.service, {
    command: nodeCommand(
      'process.stdout.write("listening on 4173\\n"); setInterval(() => {}, 1000)',
    ),
    name: 'Preview',
  })
  const dockText = () => stripVTControlCharacters(dock.component.render(100).join('\n'))
  await expect.poll(dockText).toContain('Preview  0s  listening on 4173')
  expect(dockText()).toContain('ctrl+shift+b')

  const opened = command.handler('', runner.createCommandContext())
  await expect.poll(() => ui.pane(100)?.join('\n')).toContain('Preview')
  expect(ui.overlays).toEqual([
    {
      overlay: true,
      overlayOptions: { anchor: 'center', margin: 1, maxHeight: '85%', width: '90%' },
    },
  ])
  ui.press('\r')
  expect(stripVTControlCharacters(ui.pane(100)?.join('\n') ?? '')).toContain('listening on 4173')
  ui.press('x')
  ui.press('y')
  expect(ui.notices.at(-1)).toBe('Stop requested for Preview.')
  expect(await waitForCommand(fixture.service, handle)).toMatchObject({ status: 'stopped' })
  ui.press('\u001b')
  ui.press('\u001b')
  await opened

  await expect.poll(dockText, { timeout: 4000 }).toBe('')
  await runner.emit({ type: 'session_shutdown', reason: 'quit' })
  expect(ui.widget('background-commands')).toBeUndefined()
})
