import { initTheme } from '@earendil-works/pi-coding-agent'
import { getKeybindings, TuiMainScreen } from '@earendil-works/pi-tui'

const terminal = {
  columns: 120,
  rows: 40,
  kittyProtocolActive: false,
  start() {},
  stop() {},
  async drainInput() {},
  write() {},
  moveBy() {},
  hideCursor() {},
  showCursor() {},
  clearLine() {},
  clearFromCursor() {},
  clearScreen() {},
  setTitle() {},
  setProgress() {},
}

export function questionUI(base) {
  initTheme('dark', false)
  const tui = new TuiMainScreen(terminal)
  let active
  const opened = []
  const ui = {
    ...base,
    custom(factory) {
      return new Promise((resolve, reject) => {
        Promise.resolve(factory(tui, base.theme, getKeybindings(), resolve))
          .then((component) => {
            active = component
            opened.push(component.render(120))
          })
          .catch(reject)
      })
    },
  }
  return {
    ui,
    opened,
    press(key) {
      if (active === undefined) throw new Error('No question is open')
      active.handleInput?.(key)
    },
    close() {
      tui.stop()
    },
  }
}
