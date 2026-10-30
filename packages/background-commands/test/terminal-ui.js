import { getKeybindings, TuiMainScreen } from '@earendil-works/pi-tui'

const terminal = {
  columns: 100,
  rows: 30,
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
  setProgramStatus() {},
}

export function terminalUI() {
  const tui = new TuiMainScreen(terminal)
  const widgets = new Map()
  const notices = []
  const overlays = []
  let pane
  return {
    wrap(base) {
      return {
        ...base,
        get theme() {
          return base.theme
        },
        notify(message) {
          notices.push(message)
        },
        setWidget(key, content, options) {
          if (content === undefined) widgets.delete(key)
          else
            widgets.set(key, {
              component: content(tui, base.theme),
              placement: options?.placement,
            })
        },
        custom(factory, options) {
          overlays.push(options)
          return new Promise((resolve, reject) => {
            Promise.resolve(
              factory(tui, base.theme, getKeybindings(), (result) => {
                pane?.dispose?.()
                pane = undefined
                resolve(result)
              }),
            )
              .then((component) => {
                pane = component
              })
              .catch(reject)
          })
        },
      }
    },
    widget(key) {
      return widgets.get(key)
    },
    notices,
    overlays,
    pane(width) {
      return pane?.render(width)
    },
    press(key) {
      if (pane === undefined) throw new Error('No pane is open')
      pane.handleInput?.(key)
    },
    close() {
      pane?.dispose?.()
      tui.stop()
    },
  }
}
