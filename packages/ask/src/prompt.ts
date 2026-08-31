import type { Theme } from '@earendil-works/pi-coding-agent'
import {
  Input,
  Key,
  matchesKey,
  stripTerminalSequences,
  type Component,
  type Focusable,
  type TUI,
  visibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui'

import {
  type AskAnswer,
  type AskQuestionInput,
  AskSession,
  type DisplayOption,
  normalizedTitle,
  OtherOptionId,
} from './domain.ts'

export type AskPromptResult =
  | { kind: 'answered'; answers: AskAnswer[] }
  | { kind: 'skipped'; reason: string }

type PromptOptions = {
  input: AskQuestionInput
  theme: Theme
  tui: TUI
  done: (result: AskPromptResult) => void
}

function clean(value: string): string {
  return stripTerminalSequences(value)
    .replaceAll('\n', ' ')
    .replaceAll('\r', ' ')
    .replaceAll('\t', ' ')
}

function selectionPrefix(active: boolean, selected: boolean): string {
  if (active && selected) {
    return '› [x]'
  }
  if (active) {
    return '› [ ]'
  }
  return selected ? '  [x]' : '  [ ]'
}

export class AskQuestionPrompt implements Component, Focusable {
  private readonly input: AskQuestionInput
  private readonly theme: Theme
  private readonly tui: TUI
  private readonly done: (result: AskPromptResult) => void
  private readonly session: AskSession
  private readonly freeformInput = new Input()
  private inputQuestionId: string | undefined
  private complete = false
  private cachedWidth: number | undefined
  private cachedLines: string[] | undefined
  private _focused = false

  constructor(options: PromptOptions) {
    this.input = options.input
    this.theme = options.theme
    this.tui = options.tui
    this.done = options.done
    this.session = new AskSession(options.input.questions)
  }

  get focused(): boolean {
    return this._focused
  }

  set focused(value: boolean) {
    this._focused = value
    this.freeformInput.focused = value
  }

  handleInput(data: string): void {
    if (this.complete) {
      return
    }
    if (matchesKey(data, Key.escape)) {
      this.finish({ kind: 'skipped', reason: 'Questions skipped by user' })
      return
    }

    const active = this.session.activeOption()
    if (active?.kind === 'other') {
      if (matchesKey(data, Key.left) || matchesKey(data, Key.shift('tab'))) {
        this.session.moveQuestion(-1)
        this.syncFreeformInput()
        this.refresh()
        return
      }
      if (matchesKey(data, Key.right) || matchesKey(data, Key.tab)) {
        this.session.moveQuestion(1)
        this.syncFreeformInput()
        this.refresh()
        return
      }
      if (matchesKey(data, Key.up)) {
        this.session.moveOption(-1)
        this.syncFreeformInput()
        this.refresh()
        return
      }
      if (matchesKey(data, Key.down)) {
        this.session.moveOption(1)
        this.syncFreeformInput()
        this.refresh()
        return
      }
      if (matchesKey(data, Key.enter)) {
        this.selectAndAdvance()
        return
      }
      this.syncFreeformInput()
      this.freeformInput.handleInput(data)
      this.session.setActiveFreeform(this.freeformInput.getValue())
      this.refresh()
      return
    }

    if (matchesKey(data, Key.left)) {
      this.session.moveQuestion(-1)
      this.syncFreeformInput()
      this.refresh()
      return
    }
    if (matchesKey(data, Key.right)) {
      this.session.moveQuestion(1)
      this.syncFreeformInput()
      this.refresh()
      return
    }
    if (matchesKey(data, Key.up)) {
      this.session.moveOption(-1)
      this.syncFreeformInput()
      this.refresh()
      return
    }
    if (matchesKey(data, Key.down)) {
      this.session.moveOption(1)
      this.syncFreeformInput()
      this.refresh()
      return
    }
    if (matchesKey(data, Key.space)) {
      this.session.toggleActive()
      this.refresh()
      return
    }
    if (matchesKey(data, Key.enter)) {
      this.selectAndAdvance()
    }
  }

  render(width: number): string[] {
    const renderWidth = Math.max(1, width)
    if (this.cachedWidth === renderWidth && this.cachedLines !== undefined) {
      return this.cachedLines
    }
    this.syncFreeformInput()
    const lines: string[] = [this.theme.fg('borderAccent', '─'.repeat(renderWidth))]
    this.addWrapped(
      lines,
      ' ',
      this.theme.fg('accent', this.theme.bold(normalizedTitle(this.input.title))),
      renderWidth,
    )
    lines.push('')

    const question = this.session.activeQuestion()
    if (question !== undefined) {
      this.addWrapped(
        lines,
        ' ',
        this.theme.fg(
          'dim',
          `Question ${this.session.questionIndex() + 1} of ${this.input.questions.length}`,
        ),
        renderWidth,
      )
      lines.push('')
      const suffix = question.allowMultiple ? ' (multi-select)' : ''
      this.addWrapped(
        lines,
        ' ',
        this.theme.fg(
          'text',
          `${this.session.questionIndex() + 1}. ${clean(question.prompt)}${suffix}`,
        ),
        renderWidth,
      )
      lines.push('')
      const selected = this.session.selectedIds(question.id)
      const options = this.session.activeOptions()
      options.forEach((option, index) => {
        const isActive = index === this.session.optionIndex()
        const isSelected = selected.includes(option.id)
        this.renderOption(lines, option, isActive, isSelected, renderWidth)
      })
    }

    lines.push('')
    this.addWrapped(
      lines,
      ' ',
      this.theme.fg(
        'dim',
        '↑/↓ option · ←/→ question · Space select · Enter next/submit · Esc to skip',
      ),
      renderWidth,
    )
    lines.push(this.theme.fg('borderAccent', '─'.repeat(renderWidth)))
    this.cachedWidth = renderWidth
    this.cachedLines = lines
    return lines
  }

  invalidate(): void {
    this.cachedWidth = undefined
    this.cachedLines = undefined
    this.freeformInput.invalidate()
  }

  private renderOption(
    lines: string[],
    option: DisplayOption,
    active: boolean,
    selected: boolean,
    width: number,
  ): void {
    const prefix = `  ${selectionPrefix(active, selected)} `
    if (option.kind === 'other' && active) {
      const label = this.theme.fg('accent', this.theme.bold('Other:'))
      const available = Math.max(1, width - visibleWidth(prefix) - visibleWidth('Other: '))
      const renderedInput = this.freeformInput.render(available + 2)[0] ?? ''
      const inputLine = renderedInput.startsWith('> ') ? renderedInput.slice(2) : renderedInput
      this.addWrapped(lines, prefix, `${label} ${inputLine}`, width)
      return
    }
    const color = active ? 'accent' : selected ? 'success' : 'dim'
    const label = option.kind === 'other' ? 'Other: (type to answer)' : clean(option.label)
    this.addWrapped(lines, prefix, this.theme.fg(color, label), width)
  }

  private addWrapped(lines: string[], prefix: string, text: string, width: number): void {
    const prefixWidth = visibleWidth(prefix)
    if (prefixWidth >= width) {
      lines.push(...wrapTextWithAnsi(`${prefix}${text}`, width))
      return
    }
    const wrapped = wrapTextWithAnsi(text, width - prefixWidth)
    const continuation = ' '.repeat(prefixWidth)
    wrapped.forEach((line, index) => {
      lines.push(`${index === 0 ? prefix : continuation}${line}`)
    })
  }

  private selectAndAdvance(): void {
    this.session.selectActive()
    if (this.session.isLastQuestion()) {
      if (this.session.allAnswered()) {
        this.finish({ kind: 'answered', answers: this.session.answers() })
      } else {
        this.refresh()
      }
      return
    }
    this.session.moveQuestion(1)
    this.syncFreeformInput()
    this.refresh()
  }

  private syncFreeformInput(): void {
    const question = this.session.activeQuestion()
    const option = this.session.activeOption()
    const questionId = option?.id === OtherOptionId ? question?.id : undefined
    if (questionId === this.inputQuestionId) {
      return
    }
    this.inputQuestionId = questionId
    this.freeformInput.setValue(
      questionId === undefined ? '' : this.session.freeformText(questionId),
    )
  }

  private refresh(): void {
    this.invalidate()
    this.tui.requestRender()
  }

  private finish(result: AskPromptResult): void {
    this.complete = true
    this.done(result)
  }
}
