import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

export const OtherOptionId = '__freeform_other__'

export const AskOptionSchema = Type.Object(
  {
    id: Type.String({ description: 'Stable identifier for this option' }),
    label: Type.String({ description: 'Text shown to the user' }),
  },
  { additionalProperties: false },
)

export const AskQuestionItemSchema = Type.Object(
  {
    id: Type.String({ description: 'Stable identifier for this question' }),
    prompt: Type.String({ description: 'Question text shown to the user' }),
    options: Type.Array(AskOptionSchema, {
      description: 'Selectable answers for this question',
      minItems: 1,
    }),
    allowMultiple: Type.Boolean({
      description: 'Allow the user to select more than one option',
    }),
  },
  { additionalProperties: false },
)

export const AskQuestionSchema = Type.Object(
  {
    title: Type.String({ description: 'Short title for the question form' }),
    questions: Type.Array(AskQuestionItemSchema, {
      description: 'Questions to show in one form',
      minItems: 1,
    }),
    runAsync: Type.Optional(
      Type.Boolean({
        description: 'Return immediately and deliver the answers in a later session message',
      }),
    ),
  },
  { additionalProperties: false },
)

export const AskAnswerSchema = Type.Object(
  {
    questionId: Type.String(),
    selectedOptionIds: Type.Array(Type.String()),
    freeformText: Type.String(),
  },
  { additionalProperties: false },
)

const AskSuccessDetailsSchema = Type.Object(
  {
    status: Type.Literal('success'),
    title: Type.String(),
    questions: Type.Array(AskQuestionItemSchema),
    answers: Type.Array(AskAnswerSchema),
  },
  { additionalProperties: false },
)

const AskRejectedDetailsSchema = Type.Object(
  {
    status: Type.Literal('rejected'),
    title: Type.String(),
    questions: Type.Array(AskQuestionItemSchema),
    reason: Type.String(),
  },
  { additionalProperties: false },
)

const AskErrorDetailsSchema = Type.Object(
  {
    status: Type.Literal('error'),
    title: Type.String(),
    questions: Type.Array(AskQuestionItemSchema),
    errorMessage: Type.String(),
  },
  { additionalProperties: false },
)

const AskAsyncDetailsSchema = Type.Object(
  {
    status: Type.Literal('async'),
    title: Type.String(),
    questions: Type.Array(AskQuestionItemSchema),
    originalToolCallId: Type.String(),
  },
  { additionalProperties: false },
)

const AskQuestionDetailsSchema = Type.Union([
  AskSuccessDetailsSchema,
  AskRejectedDetailsSchema,
  AskErrorDetailsSchema,
  AskAsyncDetailsSchema,
])

export type AskQuestionInput = Static<typeof AskQuestionSchema>
export type AskQuestionItem = Static<typeof AskQuestionItemSchema>
export type AskOption = Static<typeof AskOptionSchema>
export type AskAnswer = Static<typeof AskAnswerSchema>
export type AskQuestionDetails = Static<typeof AskQuestionDetailsSchema>

export type DisplayOption =
  | { kind: 'option'; id: string; label: string }
  | { kind: 'other'; id: typeof OtherOptionId; label: 'Other' }

function cloneQuestion(question: AskQuestionItem): AskQuestionItem {
  return {
    id: question.id,
    prompt: question.prompt,
    options: question.options.map((option) => ({ ...option })),
    allowMultiple: question.allowMultiple,
  }
}

export function cloneQuestions(questions: readonly AskQuestionItem[]): AskQuestionItem[] {
  return questions.map(cloneQuestion)
}

export function normalizedTitle(title: string): string {
  const trimmed = title.trim()
  return trimmed.length === 0 ? 'Clarifying Questions' : trimmed
}

export function isOtherLabel(label: string): boolean {
  const value = label.toLowerCase().trim()
  return (
    value === 'other' ||
    value === 'something else' ||
    value.startsWith('other:') ||
    value.startsWith('other -') ||
    value.startsWith('other (') ||
    value.startsWith('something else:') ||
    value.startsWith('something else -') ||
    value.startsWith('something else (')
  )
}

export function displayOptions(question: AskQuestionItem): DisplayOption[] {
  const finalOption = question.options.at(-1)
  const options = question.options.filter(
    (_option, index) =>
      index !== question.options.length - 1 ||
      finalOption === undefined ||
      !isOtherLabel(finalOption.label),
  )
  const regular: DisplayOption[] = options.map((option) => ({
    kind: 'option',
    id: option.id,
    label: option.label,
  }))
  return [...regular, { kind: 'other', id: OtherOptionId, label: 'Other' }]
}

export function validateQuestions(questions: readonly AskQuestionItem[]): string | null {
  if (questions.length === 0) {
    return 'No questions provided'
  }
  const questionIds = new Set<string>()
  for (const question of questions) {
    if (question.id.trim().length === 0) {
      return 'Question IDs must not be empty'
    }
    if (questionIds.has(question.id)) {
      return `Duplicate question ID: ${question.id}`
    }
    questionIds.add(question.id)
    if (question.prompt.trim().length === 0) {
      return `Question ${question.id} has an empty prompt`
    }
    if (question.options.length === 0) {
      return `Question ${question.id} has no options`
    }
    const optionIds = new Set<string>()
    for (const option of question.options) {
      if (option.id.trim().length === 0) {
        return `Question ${question.id} has an empty option ID`
      }
      if (option.id === OtherOptionId) {
        return `Option ID ${OtherOptionId} is reserved`
      }
      if (optionIds.has(option.id)) {
        return `Question ${question.id} has duplicate option ID: ${option.id}`
      }
      optionIds.add(option.id)
    }
  }
  return null
}

export class AskSession {
  private activeQuestionIndex = 0
  private activeOptionIndex = 0
  private readonly selections = new Map<string, string[]>()
  private readonly freeformTexts = new Map<string, string>()
  readonly questions: readonly AskQuestionItem[]

  constructor(questions: readonly AskQuestionItem[]) {
    this.questions = questions
    for (const question of questions) {
      this.selections.set(question.id, [])
      this.freeformTexts.set(question.id, '')
    }
  }

  questionIndex(): number {
    return this.activeQuestionIndex
  }

  optionIndex(): number {
    return this.activeOptionIndex
  }

  activeQuestion(): AskQuestionItem | undefined {
    return this.questions.at(this.activeQuestionIndex)
  }

  activeOptions(): DisplayOption[] {
    const question = this.activeQuestion()
    return question === undefined ? [] : displayOptions(question)
  }

  activeOption(): DisplayOption | undefined {
    return this.activeOptions().at(this.activeOptionIndex)
  }

  selectedIds(questionId: string): readonly string[] {
    return this.selections.get(questionId) ?? []
  }

  freeformText(questionId: string): string {
    return this.freeformTexts.get(questionId) ?? ''
  }

  moveQuestion(offset: number): void {
    if (this.questions.length === 0) {
      return
    }
    this.activeQuestionIndex = Math.max(
      0,
      Math.min(this.questions.length - 1, this.activeQuestionIndex + offset),
    )
    this.activeOptionIndex = 0
  }

  moveOption(offset: number): void {
    const options = this.activeOptions()
    if (options.length === 0) {
      return
    }
    this.activeOptionIndex = Math.max(
      0,
      Math.min(options.length - 1, this.activeOptionIndex + offset),
    )
  }

  toggleActive(): void {
    const question = this.activeQuestion()
    const option = this.activeOption()
    if (question === undefined || option === undefined) {
      return
    }
    const selected = this.selectedIds(question.id)
    if (option.kind === 'other') {
      if (selected.includes(OtherOptionId)) {
        this.selections.set(
          question.id,
          selected.filter((id) => id !== OtherOptionId),
        )
        return
      }
      this.selections.set(
        question.id,
        question.allowMultiple ? [...selected, OtherOptionId] : [OtherOptionId],
      )
      return
    }
    if (!question.allowMultiple) {
      this.selections.set(question.id, [option.id])
      return
    }
    this.selections.set(
      question.id,
      selected.includes(option.id)
        ? selected.filter((id) => id !== option.id)
        : [...selected, option.id],
    )
  }

  selectActive(): void {
    const question = this.activeQuestion()
    const option = this.activeOption()
    if (question === undefined || option === undefined) {
      return
    }
    const selected = this.selectedIds(question.id)
    if (option.kind === 'other') {
      this.selections.set(
        question.id,
        question.allowMultiple
          ? selected.includes(OtherOptionId)
            ? [...selected]
            : [...selected, OtherOptionId]
          : [OtherOptionId],
      )
      return
    }
    this.selections.set(
      question.id,
      question.allowMultiple
        ? selected.includes(option.id)
          ? [...selected]
          : [...selected, option.id]
        : [option.id],
    )
  }

  setActiveFreeform(text: string): void {
    const question = this.activeQuestion()
    const option = this.activeOption()
    if (question === undefined || option?.kind !== 'other') {
      return
    }
    this.freeformTexts.set(question.id, text)
    const selected = this.selectedIds(question.id)
    this.selections.set(
      question.id,
      question.allowMultiple
        ? selected.includes(OtherOptionId)
          ? [...selected]
          : [...selected, OtherOptionId]
        : [OtherOptionId],
    )
  }

  isAnswered(question: AskQuestionItem): boolean {
    const selected = this.selectedIds(question.id)
    const regular = selected.filter((id) => id !== OtherOptionId)
    const hasFreeform =
      selected.includes(OtherOptionId) && this.freeformText(question.id).trim().length > 0
    return regular.length > 0 || hasFreeform
  }

  allAnswered(): boolean {
    return this.questions.every((question) => this.isAnswered(question))
  }

  isLastQuestion(): boolean {
    return this.activeQuestionIndex === this.questions.length - 1
  }

  answers(): AskAnswer[] {
    return this.questions.map((question) => {
      const selected = this.selectedIds(question.id)
      const includesOther = selected.includes(OtherOptionId)
      const freeform = includesOther ? this.freeformText(question.id).trim() : ''
      return {
        questionId: question.id,
        selectedOptionIds: selected.filter((id) => id !== OtherOptionId),
        freeformText: includesOther && freeform.length === 0 ? 'Other' : freeform,
      }
    })
  }
}

export function successDetails(
  title: string,
  questions: readonly AskQuestionItem[],
  answers: readonly AskAnswer[],
): AskQuestionDetails {
  return {
    status: 'success',
    title: normalizedTitle(title),
    questions: cloneQuestions(questions),
    answers: answers.map((answer) => ({
      questionId: answer.questionId,
      selectedOptionIds: [...answer.selectedOptionIds],
      freeformText: answer.freeformText,
    })),
  }
}

export function rejectedDetails(
  title: string,
  questions: readonly AskQuestionItem[],
  reason: string,
): AskQuestionDetails {
  return {
    status: 'rejected',
    title: normalizedTitle(title),
    questions: cloneQuestions(questions),
    reason,
  }
}

export function errorDetails(
  title: string,
  questions: readonly AskQuestionItem[],
  errorMessage: string,
): AskQuestionDetails {
  return {
    status: 'error',
    title: normalizedTitle(title),
    questions: cloneQuestions(questions),
    errorMessage,
  }
}

export function asyncDetails(
  title: string,
  questions: readonly AskQuestionItem[],
  originalToolCallId: string,
): AskQuestionDetails {
  return {
    status: 'async',
    title: normalizedTitle(title),
    questions: cloneQuestions(questions),
    originalToolCallId,
  }
}

export function decodeAskQuestionDetails<Input>(value: Input): AskQuestionDetails | null {
  try {
    return Value.Decode(AskQuestionDetailsSchema, value)
  } catch {
    return null
  }
}

function optionLabel(question: AskQuestionItem, optionId: string): string {
  return question.options.find((option) => option.id === optionId)?.label ?? optionId
}

export function formatAnswers(
  questions: readonly AskQuestionItem[],
  answers: readonly AskAnswer[],
): string {
  const lines = ['User answered the questions:']
  for (const answer of answers) {
    const question = questions.find((item) => item.id === answer.questionId)
    if (question === undefined) {
      continue
    }
    const selected = answer.selectedOptionIds.map((id) => `${id} (${optionLabel(question, id)})`)
    if (answer.freeformText.length > 0) {
      selected.push(`Other (${answer.freeformText})`)
    }
    lines.push(`- ${answer.questionId}: ${selected.join(', ')}`)
  }
  return lines.join('\n')
}
