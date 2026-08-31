import { visibleWidth } from '@earendil-works/pi-tui'
import { describe, expect, it } from 'vite-plus/test'

import { AskQuestionPrompt } from '../src/prompt.ts'

const input = {
  title: 'Implementation choices',
  questions: [
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
  ],
}

function harness(value = input) {
  const results = []
  let renders = 0
  const prompt = new AskQuestionPrompt({
    input: value,
    theme: {
      bold(text) {
        return text
      },
      fg(_color, text) {
        return text
      },
    },
    tui: {
      requestRender() {
        renders += 1
      },
    },
    done(result) {
      results.push(result)
    },
  })
  return { prompt, results, renderCount: () => renders }
}

describe('AskQuestionPrompt', () => {
  it('renders the question layout within the terminal width', () => {
    const instance = harness()
    const lines = instance.prompt.render(48)
    expect(lines.join('\n')).toContain('Implementation choices')
    expect(lines.join('\n')).toContain('Question 1 of 2')
    expect(lines.join('\n')).toContain('› [ ] TypeScript')
    expect(lines.join('\n')).toContain('[ ] Other: (type to answer)')
    expect(lines.every((line) => visibleWidth(line) <= 48)).toBe(true)
  })

  it('selects single and multiple answers before submission', () => {
    const instance = harness()
    instance.prompt.handleInput('\r')
    instance.prompt.handleInput(' ')
    instance.prompt.handleInput('\x1b[B')
    instance.prompt.handleInput(' ')
    instance.prompt.handleInput('\r')
    expect(instance.results).toEqual([
      {
        kind: 'answered',
        answers: [
          { questionId: 'language', selectedOptionIds: ['ts'], freeformText: '' },
          {
            questionId: 'features',
            selectedOptionIds: ['tests', 'docs'],
            freeformText: '',
          },
        ],
      },
    ])
  })

  it('captures inline freeform text', () => {
    const instance = harness({ ...input, questions: [input.questions[0]] })
    instance.prompt.handleInput('\x1b[B')
    instance.prompt.handleInput('\x1b[B')
    for (const character of 'Rust') {
      instance.prompt.handleInput(character)
    }
    const rendered = instance.prompt.render(80).join('\n')
    expect(rendered).toContain('Other: Rust')
    expect(rendered).not.toContain('Other: > Rust')
    instance.prompt.handleInput('\r')
    expect(instance.results).toEqual([
      {
        kind: 'answered',
        answers: [{ questionId: 'language', selectedOptionIds: [], freeformText: 'Rust' }],
      },
    ])
  })

  it('skips the complete form with Escape', () => {
    const instance = harness()
    instance.prompt.handleInput('\x1b')
    expect(instance.results).toEqual([{ kind: 'skipped', reason: 'Questions skipped by user' }])
    expect(instance.renderCount()).toBe(0)
  })
})
