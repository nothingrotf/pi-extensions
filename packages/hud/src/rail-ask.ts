import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { sanitizeScalar } from './format.ts'
import type { RailPatch } from './rail.ts'

const QuestionsSchema = Type.Object({
  questions: Type.Array(
    Type.Object({
      id: Type.String(),
      prompt: Type.String(),
      options: Type.Array(Type.Object({ id: Type.String(), label: Type.String() })),
    }),
  ),
})

const AnswersSchema = Type.Object({
  status: Type.Literal('success'),
  answers: Type.Array(
    Type.Object({
      questionId: Type.String(),
      selectedOptionIds: Type.Array(Type.String()),
      freeformText: Type.String(),
    }),
  ),
})

export function askRows<Input, Details>(input: Input, details?: Details): string[] | undefined {
  if (!Value.Check(QuestionsSchema, input)) return undefined
  const answers = Value.Check(AnswersSchema, details) ? details.answers : []
  return input.questions.flatMap((question) => {
    const answer = answers.find((item) => item.questionId === question.id)
    const options = question.options.map((option) => {
      const selected = answer?.selectedOptionIds.includes(option.id) === true
      return `  [${selected ? 'x' : ' '}] ${sanitizeScalar(option.label)}`
    })
    const freeform = sanitizeScalar(answer?.freeformText ?? '')
    options.push(
      `  [${freeform.length > 0 ? 'x' : ' '}] Other${freeform.length > 0 ? `: ${freeform}` : ''}`,
    )
    return [sanitizeScalar(question.prompt), ...options]
  })
}

export function askResultRows<Details>(toolName: string, details: Details): string[] | undefined {
  return toolName === 'AskQuestion' ? askRows(details, details) : undefined
}

function compactText(text: string, limit: number): string {
  const scalar = sanitizeScalar(text)
  return scalar.length > limit ? `${scalar.slice(0, limit - 3)}...` : scalar
}

export function normalizeAskPatch(
  patch: RailPatch,
): Pick<RailPatch, 'detail' | 'summary' | 'doneLabel' | 'runningLabel'> {
  if (patch.iconKey !== 'ask') return {}
  const normalized: Pick<RailPatch, 'detail' | 'summary' | 'doneLabel' | 'runningLabel'> = {
    doneLabel: 'Asked',
    runningLabel: 'Asking',
  }
  if (patch.detail !== undefined) normalized.detail = compactText(patch.detail, 50)
  if (patch.summary !== undefined) normalized.summary = compactText(patch.summary, 60)
  return normalized
}

export function askCallPatch<Input>(input: Input): RailPatch {
  const patch: RailPatch = {
    askRows: askRows(input),
    category: 'other',
    detail: Value.Check(QuestionsSchema, input)
      ? input.questions.map((question) => question.prompt).join(' · ')
      : '',
    iconKey: 'ask',
    status: 'pending',
  }
  return { ...patch, ...normalizeAskPatch(patch) }
}

const RejectedSchema = Type.Object({ status: Type.Literal('rejected') })

export function askResultPatch<Details>(toolName: string, details: Details): RailPatch {
  if (toolName !== 'AskQuestion') return {}
  const patch: RailPatch = { ...askCallPatch(details), askRows: askResultRows(toolName, details) }
  delete patch.status
  if (Value.Check(RejectedSchema, details)) patch.summary = 'skipped'
  if (Value.Check(QuestionsSchema, details) && Value.Check(AnswersSchema, details)) {
    patch.summary = details.questions
      .flatMap((question) => {
        const answer = details.answers.find((item) => item.questionId === question.id)
        if (answer === undefined) return []
        const labels = question.options
          .filter((option) => answer.selectedOptionIds.includes(option.id))
          .map((option) => option.label)
        if (answer.freeformText.length > 0) labels.push(answer.freeformText)
        return labels.length > 0 ? [labels.join(', ')] : []
      })
      .join(' · ')
  }
  return { ...patch, ...normalizeAskPatch(patch) }
}
