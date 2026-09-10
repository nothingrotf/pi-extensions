import { Type, type StaticDecode } from 'typebox'
import { Value } from 'typebox/value'

const DeliveryFields = {
  issue: Type.String({ minLength: 1 }),
  cohort: Type.Union([Type.Literal('baseline'), Type.Literal('candidate')]),
  complexity: Type.Union([
    Type.Literal('bounded'),
    Type.Literal('integration'),
    Type.Literal('architecture'),
  ]),
  implementationModel: Type.String({ minLength: 1 }),
  startedAt: Type.Number({ minimum: 0 }),
  blockingMs: Type.Number({ minimum: 0 }),
}

const DeliverySchema = Type.Union([
  Type.Object(
    {
      ...DeliveryFields,
      state: Type.Literal('accepted'),
      acceptedAt: Type.Number({ minimum: 0 }),
      correctiveWorkMs: Type.Number({ minimum: 0 }),
      firstReviewFindings: Type.Integer({ minimum: 0 }),
      artifact: Type.String({ minLength: 1 }),
      reviewEvidence: Type.String({ minLength: 1 }),
      checksEvidence: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...DeliveryFields,
      state: Type.Union([Type.Literal('open'), Type.Literal('blocked')]),
      observedAt: Type.Number({ minimum: 0 }),
    },
    { additionalProperties: false },
  ),
])

const MeasurementsSchema = Type.Object(
  {
    version: Type.Literal(1),
    deliveries: Type.Array(DeliverySchema),
  },
  { additionalProperties: false },
)

type Measurements = StaticDecode<typeof MeasurementsSchema>
type Delivery = Measurements['deliveries'][number]
type AcceptedDelivery = Extract<Delivery, { state: 'accepted' }>

type ParseResult = { ok: true; measurements: Measurements } | { ok: false; error: string }

export function parseMeasurements(text: string): ParseResult {
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Measurements must contain valid JSON.' }
  }
  if (!Value.Check(MeasurementsSchema, input)) {
    return { ok: false, error: 'Measurements do not match the version 1 delivery schema.' }
  }
  const measurements = Value.Decode(MeasurementsSchema, input)
  const issues = new Set<string>()
  for (const delivery of measurements.deliveries) {
    if (issues.has(delivery.issue)) {
      return { ok: false, error: 'Each issue must appear exactly once.' }
    }
    issues.add(delivery.issue)
    const end = delivery.state === 'accepted' ? delivery.acceptedAt : delivery.observedAt
    const duration = end - delivery.startedAt
    if (
      duration < 0 ||
      delivery.blockingMs > duration ||
      (delivery.state === 'accepted' && delivery.correctiveWorkMs > duration - delivery.blockingMs)
    ) {
      return {
        ok: false,
        error: 'Delivery durations must fit within their recorded observation interval.',
      }
    }
  }
  return { ok: true, measurements }
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const upper = sorted[Math.floor(sorted.length / 2)]
  if (upper === undefined) return null
  const lower = sorted[Math.floor((sorted.length - 1) / 2)] ?? upper
  return (lower + upper) / 2
}

function summarize(deliveries: readonly Delivery[]) {
  const accepted = deliveries.filter(
    (delivery): delivery is AcceptedDelivery => delivery.state === 'accepted',
  )
  return {
    accepted: accepted.length,
    open: deliveries.filter((delivery) => delivery.state === 'open').length,
    blocked: deliveries.filter((delivery) => delivery.state === 'blocked').length,
    medianTimeToAcceptanceMs: median(
      accepted.map((delivery) => delivery.acceptedAt - delivery.startedAt),
    ),
    medianUnblockedWallMs: median(
      accepted.map((delivery) => delivery.acceptedAt - delivery.startedAt - delivery.blockingMs),
    ),
    medianCorrectiveWorkMs: median(accepted.map((delivery) => delivery.correctiveWorkMs)),
    firstPassAcceptanceRate:
      accepted.length === 0
        ? null
        : accepted.filter((delivery) => delivery.firstReviewFindings === 0).length /
          accepted.length,
  }
}

export function reportThroughput(measurements: Measurements) {
  const baseline = measurements.deliveries.filter((delivery) => delivery.cohort === 'baseline')
  const candidate = measurements.deliveries.filter((delivery) => delivery.cohort === 'candidate')
  const baselineSummary = summarize(baseline)
  const candidateSummary = summarize(candidate)
  const complexityMixMatches = ['bounded', 'integration', 'architecture'].every(
    (complexity) =>
      baseline.filter((delivery) => delivery.complexity === complexity).length ===
      candidate.filter((delivery) => delivery.complexity === complexity).length,
  )
  const complete = measurements.deliveries.every((delivery) => delivery.state === 'accepted')
  const comparable =
    complete && baseline.length >= 2 && candidate.length >= 2 && complexityMixMatches
  const before = baselineSummary.medianTimeToAcceptanceMs
  const after = candidateSummary.medianTimeToAcceptanceMs
  const groups = new Map<string, Delivery[]>()
  for (const delivery of measurements.deliveries) {
    const key = JSON.stringify([delivery.cohort, delivery.complexity, delivery.implementationModel])
    const group = groups.get(key) ?? []
    group.push(delivery)
    groups.set(key, group)
  }
  return {
    baseline: baselineSummary,
    candidate: candidateSummary,
    pilot: {
      candidateIssuesAccepted: candidateSummary.accepted,
      minimumTwoCandidatesAccepted: candidateSummary.accepted >= 2,
      complexityMixMatches,
      comparable,
      descriptiveReductionPercent:
        comparable && before !== null && before > 0 && after !== null
          ? (1 - after / before) * 100
          : null,
      interpretation:
        'Recorded wall-clock evidence, not a causal model benchmark. Open and blocked issues are not accepted deliveries. Evidence references require external verification.',
    },
    byImplementationModel: [...groups.values()].flatMap((deliveries) => {
      const first = deliveries[0]
      return first === undefined
        ? []
        : [
            {
              cohort: first.cohort,
              complexity: first.complexity,
              implementationModel: first.implementationModel,
              ...summarize(deliveries),
            },
          ]
    }),
  }
}
