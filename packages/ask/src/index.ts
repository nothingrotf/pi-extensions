import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'
import { stripTerminalSequences, Text } from '@earendil-works/pi-tui'

import {
  type AskAnswer,
  type AskQuestionDetails,
  type AskQuestionInput,
  type AskQuestionItem,
  AskQuestionSchema,
  asyncDetails,
  decodeAskQuestionDetails,
  errorDetails,
  formatAnswers,
  normalizedTitle,
  rejectedDetails,
  successDetails,
  validateQuestions,
} from './domain.ts'
import { AskQuestionPrompt, type AskPromptResult } from './prompt.ts'
import { emptyRailComponent, RailBridge, type RailStatus } from './rail.ts'

export {
  type AskAnswer,
  type AskQuestionDetails,
  type AskQuestionInput,
  AskQuestionSchema,
} from './domain.ts'

const description = `Ask the user one or more clarifying questions in one form. Each question supports single selection, multiple selection, and a freeform Other answer.

Use this tool when the user's choice materially changes the result and the answer is not available from the current context or other tools.

Keep questions concise. Use stable IDs. Give two to four distinct options when possible. Do not ask for confirmation when the request is already clear.`

const asyncMessageType = 'ask-question-completion'

type AsyncTask = () => Promise<void>

class AsyncQuestionQueue {
  private readonly tasks: AsyncTask[] = []
  private active: Promise<void> | undefined

  enqueue(task: AsyncTask): void {
    this.tasks.push(task)
    this.startNext()
  }

  clear(): void {
    this.tasks.length = 0
  }

  private startNext(): void {
    if (this.active !== undefined) {
      return
    }
    const task = this.tasks.shift()
    if (task === undefined) {
      return
    }
    this.active = task().then(
      () => {
        this.active = undefined
        this.startNext()
      },
      () => {
        this.active = undefined
        this.startNext()
      },
    )
  }
}

async function promptUser(
  input: AskQuestionInput,
  ctx: ExtensionContext,
  signal: AbortSignal,
): Promise<AskPromptResult> {
  const skipped: AskPromptResult = { kind: 'skipped', reason: 'Questions cancelled' }
  if (signal.aborted) return skipped
  let cancel: (() => void) | undefined
  try {
    return await ctx.ui.custom<AskPromptResult>((tui, theme, _keybindings, done) => {
      cancel = () => done(skipped)
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) cancel()
      return new AskQuestionPrompt({ input, theme, tui, done })
    })
  } finally {
    if (cancel !== undefined) signal.removeEventListener('abort', cancel)
  }
}

function resultFromPrompt(input: AskQuestionInput, result: AskPromptResult): AskQuestionDetails {
  if (result.kind === 'skipped') {
    return rejectedDetails(input.title, input.questions, result.reason)
  }
  return successDetails(input.title, input.questions, result.answers)
}

function resultText(details: AskQuestionDetails): string {
  switch (details.status) {
    case 'success':
      return formatAnswers(details.questions, details.answers)
    case 'rejected':
      return details.reason
    case 'error':
      return `Error: ${details.errorMessage}`
    case 'async':
      return 'The questions are open. The answers will arrive in a later session message.'
  }
}

function answerForQuestion(
  questionId: string,
  answers: readonly AskAnswer[],
): AskAnswer | undefined {
  return answers.find((answer) => answer.questionId === questionId)
}

const ASK_ICON = '?'

function cleanLine(value: string): string {
  return stripTerminalSequences(value).replace(/[\r\n\t]/gu, ' ')
}

interface AskRenderState {
  hasResult?: boolean
}

function askStatusLine(
  options: { icon: string; meta?: readonly string[]; title?: string },
  theme: Theme,
): string {
  const meta = (options.meta ?? []).map(cleanLine).filter((part) => part.length > 0)
  const suffix = meta.length > 0 ? ` ${theme.fg('dim', meta.join(' · '))}` : ''
  return `${options.icon} ${theme.fg('accent', cleanLine(options.title ?? 'Ask'))}${suffix}`
}

function optionMarker(multi: boolean, selected: boolean): string {
  if (multi) return selected ? '☑' : '☐'
  return selected ? '◉' : '○'
}

function questionLabel(question: AskQuestionItem, theme: Theme): string {
  const meta: string[] = []
  if (question.allowMultiple) meta.push('multi')
  meta.push(`options:${question.options.length}`)
  return `${theme.fg('dim', `[${cleanLine(question.id)}]`)} ${theme.fg('dim', meta.join(' · '))}`
}

export function renderQuestionLines(question: AskQuestionItem, theme: Theme): string[] {
  const lines = [questionLabel(question, theme), theme.fg('accent', cleanLine(question.prompt))]
  for (const option of question.options) {
    lines.push(
      ` ${theme.fg('dim', optionMarker(question.allowMultiple, false))} ${theme.fg('muted', cleanLine(option.label))}`,
    )
  }
  return lines
}

function renderAnswerLines(
  question: AskQuestionItem,
  answer: { freeformText: string; selectedOptionIds: readonly string[] } | undefined,
  theme: Theme,
): string[] {
  const selected = new Set(answer?.selectedOptionIds ?? [])
  const custom = answer !== undefined && answer.freeformText.length > 0
  if (selected.size === 0 && !custom) {
    return [` ${theme.fg('warning', '⚠')} ${theme.fg('warning', 'Cancelled')}`]
  }
  const lines: string[] = []
  for (const option of question.options) {
    const isSelected = selected.has(option.id)
    const marker = optionMarker(question.allowMultiple, isSelected)
    lines.push(
      ` ${theme.fg(isSelected ? 'success' : 'dim', marker)} ${theme.fg(isSelected ? 'toolOutput' : 'muted', cleanLine(option.label))}`,
    )
  }
  if (custom) {
    const [first = '', ...rest] = stripTerminalSequences(answer.freeformText).split('\n')
    lines.push(` ${theme.fg('success', '✔')} ${theme.fg('toolOutput', cleanLine(first))}`)
    for (const line of rest) lines.push(`   ${theme.fg('toolOutput', cleanLine(line))}`)
  }
  return lines
}

export function renderCallLines(
  args: { questions: readonly AskQuestionItem[]; title: string },
  theme: Theme,
): string[] {
  const count = args.questions.length
  const lines = [
    askStatusLine(
      {
        icon: theme.fg('muted', '⏳'),
        meta: [normalizedTitle(args.title), `${count} question${count === 1 ? '' : 's'}`],
      },
      theme,
    ),
  ]
  args.questions.forEach((question) => {
    lines.push('', ...renderQuestionLines(question, theme))
  })
  return lines
}

function renderSuccess(details: AskQuestionDetails, theme: Theme): Text {
  if (details.status !== 'success') {
    return new Text('', 0, 0)
  }
  const answered = details.answers.some(
    (answer) => answer.selectedOptionIds.length > 0 || answer.freeformText.length > 0,
  )
  const count = details.questions.length
  const lines = [
    askStatusLine(
      {
        icon: answered ? theme.fg('accent', ASK_ICON) : theme.fg('warning', '⚠'),
        meta: [`${count} question${count === 1 ? '' : 's'}`],
      },
      theme,
    ),
  ]
  details.questions.forEach((question) => {
    lines.push('', questionLabel(question, theme), theme.fg('accent', cleanLine(question.prompt)))
    lines.push(
      ...renderAnswerLines(question, answerForQuestion(question.id, details.answers), theme),
    )
  })
  return new Text(lines.join('\n'), 0, 0)
}

function renderDetails(details: AskQuestionDetails, theme: Theme): Text {
  switch (details.status) {
    case 'success':
      return renderSuccess(details, theme)
    case 'rejected':
      return new Text(
        `${askStatusLine({ icon: theme.fg('warning', '⚠'), meta: ['rejected'] }, theme)}\n  ${theme.fg('warning', details.reason)}`,
        0,
        0,
      )
    case 'error':
      return new Text(
        `${askStatusLine({ icon: theme.fg('error', '✘') }, theme)}\n  ${theme.fg('error', details.errorMessage)}`,
        0,
        0,
      )
    case 'async':
      return new Text(
        askStatusLine({ icon: theme.fg('muted', '⏳'), meta: ['awaiting async responses'] }, theme),
        0,
        0,
      )
  }
}

export function railDetail(questions: readonly AskQuestionItem[]): string {
  return questions.map((question) => cleanLine(question.prompt)).join(' · ')
}

export function railSummary(details: AskQuestionDetails): string {
  if (details.status !== 'success') return ''
  const parts: string[] = []
  for (const question of details.questions) {
    const answer = answerForQuestion(question.id, details.answers)
    if (answer === undefined) continue
    const labels = question.options
      .filter((option) => answer.selectedOptionIds.includes(option.id))
      .map((option) => cleanLine(option.label))
    if (answer.freeformText.length > 0) {
      labels.push(cleanLine(answer.freeformText.split('\n')[0] ?? ''))
    }
    if (labels.length > 0) parts.push(labels.join(', '))
  }
  return parts.join(' · ')
}

export default function ask(pi: ExtensionAPI): void {
  const queue = new AsyncQuestionQueue()
  const rail = new RailBridge(pi, ['AskQuestion'])
  const asyncResults = new Map<string, AskQuestionDetails>()
  const asyncInvalidators = new Map<string, () => void>()
  const pending = new Map<string, AbortController>()
  let paused = false

  const publishState = () => {
    pi.events.emit('ask:state', { version: 1, pending: pending.size, paused })
  }
  const reset = () => {
    queue.clear()
    for (const controller of pending.values()) controller.abort()
    pending.clear()
    paused = false
    asyncResults.clear()
    asyncInvalidators.clear()
    publishState()
  }
  const unsubscribe = pi.events.on('ask:state:request', publishState)
  pi.on('session_start', reset)
  pi.on('session_tree', reset)
  pi.on('session_shutdown', () => {
    reset()
    unsubscribe()
  })
  pi.on('message_start', (event) => {
    if (event.message.role !== 'user') return
    paused = false
    publishState()
  })

  pi.registerTool<typeof AskQuestionSchema, AskQuestionDetails, AskRenderState>({
    name: 'AskQuestion',
    label: 'Ask question',
    description,
    promptSnippet: 'Ask the user one or more questions with selectable and freeform answers',
    promptGuidelines: [
      'Use AskQuestion when a user choice materially changes the result and context does not contain the answer.',
      'Do not use AskQuestion for information that another tool can discover.',
      'Use concise prompts, stable IDs, and distinct options.',
    ],
    parameters: AskQuestionSchema,
    executionMode: 'sequential',
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      const validationError = validateQuestions(params.questions)
      if (validationError !== null) {
        const details = errorDetails(params.title, params.questions, validationError)
        return {
          content: [{ type: 'text', text: resultText(details) }],
          details,
          isError: true,
        }
      }
      if (ctx.mode !== 'tui') {
        const details = rejectedDetails(
          params.title,
          params.questions,
          'Questions skipped in headless mode',
        )
        return {
          content: [{ type: 'text', text: resultText(details) }],
          details,
        }
      }
      const controller = new AbortController()
      const abort = () => {
        paused = true
        controller.abort()
        pending.delete(toolCallId)
        publishState()
      }
      signal?.addEventListener('abort', abort, { once: true })
      controller.signal.addEventListener(
        'abort',
        () => signal?.removeEventListener('abort', abort),
        { once: true },
      )
      pending.set(toolCallId, controller)
      if (signal?.aborted) abort()
      publishState()
      const finish = () => {
        signal?.removeEventListener('abort', abort)
        if (pending.get(toolCallId) === controller) {
          pending.delete(toolCallId)
          publishState()
        }
      }
      const resolveQuestion = async () => {
        const result = await promptUser(params, ctx, controller.signal)
        if (!controller.signal.aborted && result.kind === 'skipped') paused = true
        return resultFromPrompt(params, result)
      }
      if (params.runAsync === true) {
        queue.enqueue(async () => {
          let details: AskQuestionDetails
          try {
            details = await resolveQuestion()
          } catch (error) {
            details = errorDetails(
              params.title,
              params.questions,
              error instanceof Error ? error.message : String(error),
            )
          }
          try {
            if (controller.signal.aborted) return
            asyncResults.set(toolCallId, details)
            if (rail.active) {
              rail.report({
                detail: railDetail(params.questions),
                doneLabel: 'Ask',
                runningLabel: 'Ask',
                summary: railSummary(details),
                status: details.status === 'error' ? 'error' : 'ok',
                toolCallId,
                iconKey: 'ask',
                toolName: 'AskQuestion',
              })
            }
            asyncInvalidators.get(toolCallId)?.()
            asyncInvalidators.delete(toolCallId)
            pi.sendMessage(
              {
                customType: asyncMessageType,
                content: resultText(details),
                display: false,
                details,
              },
              {
                triggerTurn: details.status !== 'rejected',
                deliverAs: details.status === 'rejected' ? 'nextTurn' : 'followUp',
              },
            )
          } finally {
            finish()
          }
        })
        const details = asyncDetails(params.title, params.questions, toolCallId)
        return {
          content: [{ type: 'text', text: resultText(details) }],
          details,
        }
      }
      try {
        const details = await resolveQuestion()
        return {
          content: [{ type: 'text', text: resultText(details) }],
          details,
        }
      } finally {
        finish()
      }
    },
    renderShell: 'self',
    renderCall(args, theme, context) {
      if (rail.active) {
        rail.report({
          detail: railDetail(args.questions),
          doneLabel: 'Ask',
          runningLabel: 'Ask',
          status: 'pending',
          toolCallId: context.toolCallId,
          iconKey: 'ask',
          toolName: 'AskQuestion',
        })
        return emptyRailComponent
      }
      const lines =
        context.state.hasResult === true
          ? [renderCallLines(args, theme)[0] ?? '']
          : renderCallLines(args, theme)
      return new Text(lines.join('\n'), 0, 0)
    },
    renderResult(result, options, theme, context) {
      context.state.hasResult = true
      const details = decodeAskQuestionDetails(result.details)
      if (rail.active) {
        const status: RailStatus =
          context.isError || details?.status === 'error'
            ? 'error'
            : options.isPartial || details?.status === 'async'
              ? 'pending'
              : 'ok'
        rail.report({
          detail: railDetail(context.args.questions),
          doneLabel: 'Ask',
          runningLabel: 'Ask',
          summary: details === null ? '' : railSummary(details),
          status,
          toolCallId: context.toolCallId,
          iconKey: 'ask',
          toolName: 'AskQuestion',
        })
        return emptyRailComponent
      }
      if (details?.status === 'async') {
        const completed = asyncResults.get(context.toolCallId)
        if (completed !== undefined) {
          return renderDetails(completed, theme)
        }
        asyncInvalidators.set(context.toolCallId, context.invalidate)
      }
      if (details !== null) {
        return renderDetails(details, theme)
      }
      const text = result.content.find((item) => item.type === 'text')
      return new Text(
        `${askStatusLine({ icon: theme.fg('error', '✘') }, theme)}\n  ${theme.fg('error', text?.type === 'text' ? text.text : 'Unknown AskQuestion error')}`,
        0,
        0,
      )
    },
  })
}
