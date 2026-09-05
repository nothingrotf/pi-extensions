import { describe, expect, it } from 'vite-plus/test'

import {
  type AskQuestionItem,
  AskSession,
  decodeAskQuestionDetails,
  displayOptions,
  formatAnswers,
  isOtherLabel,
  OtherOptionId,
  successDetails,
  validateQuestions,
} from '../src/domain.ts'

const questions: [AskQuestionItem, AskQuestionItem] = [
  {
    id: 'language',
    prompt: 'Which language?',
    options: [
      { id: 'ts', label: 'TypeScript' },
      { id: 'py', label: 'Python' },
    ],
    allowMultiple: false,
  },
  {
    id: 'features',
    prompt: 'Which features?',
    options: [
      { id: 'tests', label: 'Tests' },
      { id: 'docs', label: 'Documentation' },
    ],
    allowMultiple: true,
  },
]

describe('display options', () => {
  it('always appends the freeform Other option', () => {
    expect(displayOptions(questions[0])).toEqual([
      { kind: 'option', id: 'ts', label: 'TypeScript' },
      { kind: 'option', id: 'py', label: 'Python' },
      { kind: 'other', id: OtherOptionId, label: 'Other' },
    ])
  })

  it('removes only a matching final option', () => {
    const question: AskQuestionItem = {
      id: 'scope',
      prompt: 'Scope?',
      options: [
        { id: 'early', label: 'Other' },
        { id: 'main', label: 'Main' },
        { id: 'last', label: 'Something else (describe)' },
      ],
      allowMultiple: false,
    }
    expect(displayOptions(question)).toEqual([
      { kind: 'option', id: 'early', label: 'Other' },
      { kind: 'option', id: 'main', label: 'Main' },
      { kind: 'other', id: OtherOptionId, label: 'Other' },
    ])
  })

  it('matches every recovered label form', () => {
    expect(
      [
        'Other',
        'Something else',
        'Other: describe',
        'Other - describe',
        'Other (describe)',
        'Something else: describe',
        'Something else - describe',
        'Something else (describe)',
      ].every(isOtherLabel),
    ).toBe(true)
    expect(isOtherLabel('Another choice')).toBe(false)
  })
})

describe('AskSession', () => {
  it('selects one option and advances across questions', () => {
    const session = new AskSession(questions)
    session.selectActive()
    expect(session.answers()[0]).toEqual({
      questionId: 'language',
      selectedOptionIds: ['ts'],
      freeformText: '',
    })
    session.moveQuestion(1)
    expect(session.questionIndex()).toBe(1)
    expect(session.optionIndex()).toBe(0)
  })

  it('toggles multiple options and preserves both selections', () => {
    const session = new AskSession(questions)
    session.selectActive()
    session.moveQuestion(1)
    session.toggleActive()
    session.moveOption(1)
    session.toggleActive()
    expect(session.allAnswered()).toBe(true)
    expect(session.answers()[1]).toEqual({
      questionId: 'features',
      selectedOptionIds: ['tests', 'docs'],
      freeformText: '',
    })
  })

  it('uses freeform text without exposing the sentinel', () => {
    const session = new AskSession([questions[0]])
    session.moveOption(2)
    session.setActiveFreeform('  Rust  ')
    expect(session.allAnswered()).toBe(true)
    expect(session.answers()).toEqual([
      {
        questionId: 'language',
        selectedOptionIds: [],
        freeformText: 'Rust',
      },
    ])
  })

  it('maps a selected blank Other value to its label', () => {
    const session = new AskSession([questions[1]])
    session.toggleActive()
    session.moveOption(2)
    session.selectActive()
    expect(session.allAnswered()).toBe(true)
    expect(session.answers()[0]).toEqual({
      questionId: 'features',
      selectedOptionIds: ['tests'],
      freeformText: 'Other',
    })
  })
})

describe('validation and results', () => {
  it('rejects duplicate IDs and the reserved option ID', () => {
    expect(validateQuestions([questions[0], questions[0]])).toBe('Duplicate question ID: language')
    expect(
      validateQuestions([
        {
          ...questions[0],
          options: [{ id: OtherOptionId, label: 'Reserved' }],
        },
      ]),
    ).toBe(`Option ID ${OtherOptionId} is reserved`)
  })

  it('rejects empty option labels', () => {
    expect(
      validateQuestions([
        {
          ...questions[0],
          options: [{ id: 'blank', label: '   ' }],
        },
      ]),
    ).toBe('Question language has an empty option label')
  })

  it('formats selected IDs, labels, and freeform text for the model', () => {
    expect(
      formatAnswers(questions, [
        { questionId: 'language', selectedOptionIds: ['ts'], freeformText: '' },
        {
          questionId: 'features',
          selectedOptionIds: ['tests'],
          freeformText: 'Benchmarks',
        },
      ]),
    ).toBe(
      'User answered the questions:\n- language: ts (TypeScript)\n- features: tests (Tests), Other (Benchmarks)',
    )
  })

  it('decodes complete details and rejects malformed details', () => {
    const details = successDetails(' Choices ', questions, [
      { questionId: 'language', selectedOptionIds: ['ts'], freeformText: '' },
      { questionId: 'features', selectedOptionIds: ['tests'], freeformText: '' },
    ])
    expect(decodeAskQuestionDetails(details)).toEqual(details)
    expect(decodeAskQuestionDetails({ status: 'success', answers: [] })).toBeNull()
  })
})
