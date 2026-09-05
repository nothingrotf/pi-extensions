import { Type, type Static } from 'typebox'

import { SemanticStateSchema, type SemanticState } from './semantic.ts'

export { compactText, excerpt } from './text.ts'

export const FactSchema = Type.Object({
  category: Type.Union([
    Type.Literal('request'),
    Type.Literal('file'),
    Type.Literal('result'),
    Type.Literal('failure'),
    Type.Literal('plan'),
    Type.Literal('note'),
    Type.Literal('context'),
  ]),
  source: Type.String({ minLength: 1, maxLength: 256 }),
  key: Type.String({ maxLength: 600 }),
  text: Type.String({ maxLength: 900 }),
})

export type Fact = Static<typeof FactSchema>
export type Category = Fact['category']

export const CheckpointSchema = Type.Object({
  compactor: Type.Literal('@nothingrotf/compact'),
  version: Type.Literal(1),
  facts: Type.Array(FactSchema, { maxItems: 160 }),
  dropped: Type.Integer({ minimum: 0 }),
  semantic: Type.Optional(SemanticStateSchema),
})

export type Checkpoint = Static<typeof CheckpointSchema>

const limits: { [K in Category]: number } = {
  request: 20,
  file: 32,
  result: 24,
  failure: 16,
  plan: 32,
  note: 20,
  context: 8,
}

export class WorkingState {
  private facts: Fact[]
  private dropped: number
  private semantic: SemanticState | undefined

  constructor(checkpoint?: Checkpoint) {
    this.facts = checkpoint ? [...checkpoint.facts] : []
    this.dropped = checkpoint?.dropped ?? 0
    this.semantic = checkpoint?.semantic
  }

  add(fact: Fact): void {
    if (!fact.text.trim()) return
    const existing = this.facts.findIndex(
      (item) => item.category === fact.category && item.key === fact.key,
    )
    if (existing >= 0) this.facts.splice(existing, 1)
    this.facts.push(fact)
    const matching = this.facts.filter((item) => item.category === fact.category)
    if (matching.length > limits[fact.category]) {
      const oldest = fact.category === 'request' ? matching[1] : matching[0]
      if (oldest) {
        this.facts.splice(this.facts.indexOf(oldest), 1)
        this.dropped++
      }
    }
  }

  clear(category: Category): void {
    this.facts = this.facts.filter((fact) => fact.category !== category)
  }

  snapshot(): Checkpoint {
    const checkpoint: Checkpoint = {
      compactor: '@nothingrotf/compact',
      version: 1,
      facts: [...this.facts],
      dropped: this.dropped,
    }
    if (this.semantic) checkpoint.semantic = this.semantic
    return checkpoint
  }
}
