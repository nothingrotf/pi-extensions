import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'

import {
  type AskAnswer,
  type AskQuestionDetails,
  type AskQuestionInput,
  AskQuestionSchema,
  asyncDetails,
  decodeAskQuestionDetails,
  displayOptions,
  errorDetails,
  formatAnswers,
  normalizedTitle,
  rejectedDetails,
  successDetails,
  validateQuestions,
} from './domain.ts'
import { AskQuestionPrompt, type AskPromptResult } from './prompt.ts'

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

function promptUser(input: AskQuestionInput, ctx: ExtensionContext): Promise<AskPromptResult> {
  return ctx.ui.custom<AskPromptResult>((tui, theme, _keybindings, done) => {
    return new AskQuestionPrompt({ input, theme, tui, done })
  })
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

function renderSuccess(details: AskQuestionDetails, theme: Theme): Text {
  if (details.status !== 'success') {
    return new Text('', 0, 0)
  }
  const lines: string[] = []
  details.questions.forEach((question, index) => {
    const answer = answerForQuestion(question.id, details.answers)
    const selected = answer?.selectedOptionIds ?? []
    const suffix = question.allowMultiple ? theme.fg('dim', ' (multi-select)') : ''
    lines.push(`${index + 1}. ${question.prompt}${suffix}`)
    for (const option of displayOptions(question)) {
      if (option.kind === 'other') {
        continue
      }
      const checked = selected.includes(option.id)
      lines.push(
        `  ${theme.fg(checked ? 'success' : 'dim', checked ? '[x]' : '[ ]')} ${theme.fg(checked ? 'success' : 'dim', option.label)}`,
      )
    }
    if (answer !== undefined && answer.freeformText.length > 0) {
      lines.push(
        `  ${theme.fg('success', '[x]')} ${theme.fg('success', `Other: ${answer.freeformText}`)}`,
      )
    }
    if (index < details.questions.length - 1) {
      lines.push('')
    }
  })
  return new Text(lines.join('\n'), 0, 0)
}

function renderDetails(details: AskQuestionDetails, theme: Theme): Text {
  switch (details.status) {
    case 'success':
      return renderSuccess(details, theme)
    case 'rejected':
      return new Text(theme.fg('warning', details.reason), 0, 0)
    case 'error':
      return new Text(theme.fg('error', `Error: ${details.errorMessage}`), 0, 0)
    case 'async':
      return new Text(theme.fg('warning', 'Awaiting async responses'), 0, 0)
  }
}

export default function ask(pi: ExtensionAPI): void {
  const queue = new AsyncQuestionQueue()
  const asyncResults = new Map<string, AskQuestionDetails>()
  const asyncInvalidators = new Map<string, () => void>()

  pi.registerTool({
    name: 'ask_question',
    label: 'Ask question',
    description,
    promptSnippet: 'Ask the user one or more questions with selectable and freeform answers',
    promptGuidelines: [
      'Use ask_question when a user choice materially changes the result and context does not contain the answer.',
      'Do not use ask_question for information that another tool can discover.',
      'Use concise prompts, stable IDs, and distinct options.',
    ],
    parameters: AskQuestionSchema,
    executionMode: 'sequential',
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
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
      if (params.runAsync === true) {
        queue.enqueue(async () => {
          const result = await promptUser(params, ctx)
          const details = resultFromPrompt(params, result)
          asyncResults.set(toolCallId, details)
          asyncInvalidators.get(toolCallId)?.()
          asyncInvalidators.delete(toolCallId)
          pi.sendMessage(
            {
              customType: asyncMessageType,
              content: resultText(details),
              display: false,
              details,
            },
            { triggerTurn: true, deliverAs: 'followUp' },
          )
        })
        const details = asyncDetails(params.title, params.questions, toolCallId)
        return {
          content: [{ type: 'text', text: resultText(details) }],
          details,
        }
      }
      const result = await promptUser(params, ctx)
      const details = resultFromPrompt(params, result)
      return {
        content: [{ type: 'text', text: resultText(details) }],
        details,
      }
    },
    renderCall(args, theme) {
      const title = normalizedTitle(args.title)
      return new Text(
        `${theme.fg('toolTitle', theme.bold('ask_question'))} ${theme.fg('muted', `${title} (${args.questions.length})`)}`,
        0,
        0,
      )
    },
    renderResult(result, _options, theme, context) {
      const details = decodeAskQuestionDetails(result.details)
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
        theme.fg('error', text?.type === 'text' ? text.text : 'Unknown ask_question error'),
        0,
        0,
      )
    },
  })
}
