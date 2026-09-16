import { Type, type StaticDecode } from 'typebox'
import { Value } from 'typebox/value'

const TimestampSchema = Type.Number({ minimum: 0 })
const DurationSchema = Type.Number({ minimum: 0 })
const TokenCountSchema = Type.Integer({ minimum: 0 })
const UsdSchema = Type.Number({ minimum: 0 })

const DeliveryFields = {
  issue: Type.String({ minLength: 1 }),
  cohort: Type.Union([Type.Literal('baseline'), Type.Literal('candidate')]),
  complexity: Type.Union([
    Type.Literal('bounded'),
    Type.Literal('integration'),
    Type.Literal('architecture'),
  ]),
  implementationModel: Type.String({ minLength: 1 }),
  startedAt: TimestampSchema,
  blockingMs: DurationSchema,
}

const AcceptedDeliveryFields = {
  ...DeliveryFields,
  state: Type.Literal('accepted'),
  acceptedAt: TimestampSchema,
  correctiveWorkMs: DurationSchema,
  firstReviewFindings: Type.Integer({ minimum: 0 }),
  artifact: Type.String({ minLength: 1 }),
  reviewEvidence: Type.String({ minLength: 1 }),
  checksEvidence: Type.String({ minLength: 1 }),
}

const IncompleteDeliveryFields = {
  ...DeliveryFields,
  state: Type.Union([Type.Literal('open'), Type.Literal('blocked')]),
  observedAt: TimestampSchema,
}

const ReadEventSchema = Type.Object(
  {
    at: TimestampSchema,
    kind: Type.Literal('read'),
    target: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)

const EditEventSchema = Type.Object(
  {
    at: TimestampSchema,
    kind: Type.Literal('edit'),
  },
  { additionalProperties: false },
)

const CompactionEventSchema = Type.Object(
  {
    at: TimestampSchema,
    kind: Type.Literal('compaction'),
  },
  { additionalProperties: false },
)

const RuntimePreflightEventSchema = Type.Object(
  {
    at: TimestampSchema,
    kind: Type.Literal('runtime-preflight'),
    outcome: Type.Union([Type.Literal('passed'), Type.Literal('failed')]),
  },
  { additionalProperties: false },
)

const ToolEventSchema = Type.Union([
  ReadEventSchema,
  EditEventSchema,
  CompactionEventSchema,
  RuntimePreflightEventSchema,
])

const AttemptEvidenceSchema = Type.Object(
  {
    events: Type.Array(ToolEventSchema),
    executionStartedAt: Type.Optional(TimestampSchema),
    requestedAt: Type.Optional(TimestampSchema),
    sessionSetupMs: Type.Optional(DurationSchema),
    workspaceSetupMs: Type.Optional(DurationSchema),
  },
  { additionalProperties: false },
)

const SessionEvidenceSchema = Type.Object(
  {
    attempts: Type.Array(AttemptEvidenceSchema),
    source: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)

const CorrectionClassificationSchema = Type.Union([
  Type.Literal('omitted-requirement'),
  Type.Literal('introduced-regression'),
  Type.Literal('environment'),
  Type.Literal('execution-contract'),
  Type.Literal('context'),
  Type.Literal('external-decision'),
])

const CorrectionEvidenceSchema = Type.Object(
  {
    classification: CorrectionClassificationSchema,
    endedAt: TimestampSchema,
    startedAt: TimestampSchema,
  },
  { additionalProperties: false },
)

const VersionOneDeliverySchema = Type.Union([
  Type.Object(AcceptedDeliveryFields, { additionalProperties: false }),
  Type.Object(IncompleteDeliveryFields, { additionalProperties: false }),
])

const VersionTwoFields = {
  correctionEvidence: Type.Optional(Type.Array(CorrectionEvidenceSchema)),
  gates: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  scenarios: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  sessionEvidence: Type.Optional(SessionEvidenceSchema),
}

const VersionTwoDeliverySchema = Type.Union([
  Type.Object({ ...AcceptedDeliveryFields, ...VersionTwoFields }, { additionalProperties: false }),
  Type.Object(
    { ...IncompleteDeliveryFields, ...VersionTwoFields },
    { additionalProperties: false },
  ),
])

const ModelUsageRoleSchema = Type.Union([
  Type.Literal('coordinator'),
  Type.Literal('implementation'),
  Type.Literal('review'),
  Type.Literal('retry'),
  Type.Literal('publication'),
  Type.Literal('advisory'),
])

const ModelUsageSchema = Type.Object(
  {
    agent: Type.String({ minLength: 1 }),
    attempt: Type.String({ minLength: 1 }),
    cacheTokens: TokenCountSchema,
    costUsd: Type.Optional(UsdSchema),
    endedAt: TimestampSchema,
    inputTokens: TokenCountSchema,
    model: Type.String({ minLength: 1 }),
    outputTokens: TokenCountSchema,
    usageRole: ModelUsageRoleSchema,
    startedAt: TimestampSchema,
  },
  { additionalProperties: false },
)

const ModelUsageEvidenceSchema = Type.Object(
  {
    coveredRoles: Type.Array(ModelUsageRoleSchema, { minItems: 1 }),
    entries: Type.Array(ModelUsageSchema),
    zeroUsageRoles: Type.Optional(Type.Array(ModelUsageRoleSchema)),
    source: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)

const VersionThreeFields = {
  ...VersionTwoFields,
  coordinatorModel: Type.Optional(Type.String({ minLength: 1 })),
  modelUsageEvidence: Type.Optional(ModelUsageEvidenceSchema),
  reviewerModel: Type.Optional(Type.String({ minLength: 1 })),
}

const VersionThreeDeliverySchema = Type.Union([
  Type.Object(
    { ...AcceptedDeliveryFields, ...VersionThreeFields },
    { additionalProperties: false },
  ),
  Type.Object(
    { ...IncompleteDeliveryFields, ...VersionThreeFields },
    { additionalProperties: false },
  ),
])

const VersionThreeMeasurementsSchema = Type.Object(
  {
    deliveries: Type.Array(VersionThreeDeliverySchema),
    deliveryLedgerEvidence: Type.Optional(Type.String({ minLength: 1 })),
    operationalPilotEvidence: Type.Optional(Type.String({ minLength: 1 })),
    version: Type.Literal(3),
  },
  { additionalProperties: false },
)

const MeasurementsSchema = Type.Union([
  Type.Object(
    {
      deliveries: Type.Array(VersionOneDeliverySchema),
      version: Type.Literal(1),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      deliveries: Type.Array(VersionTwoDeliverySchema),
      deliveryLedgerEvidence: Type.Optional(Type.String({ minLength: 1 })),
      operationalPilotEvidence: Type.Optional(Type.String({ minLength: 1 })),
      version: Type.Literal(2),
    },
    { additionalProperties: false },
  ),
  VersionThreeMeasurementsSchema,
])

type Measurements = StaticDecode<typeof MeasurementsSchema>
type Delivery = Measurements['deliveries'][number]
type AcceptedDelivery = Extract<Delivery, { state: 'accepted' }>
type VersionTwoMeasurements = Extract<Measurements, { version: 2 }>
type VersionTwoDelivery = Extract<Delivery, { gates: readonly string[] }>
type VersionThreeMeasurements = StaticDecode<typeof VersionThreeMeasurementsSchema>
type VersionThreeDelivery = VersionThreeMeasurements['deliveries'][number]
type CorrectionClassification = StaticDecode<typeof CorrectionClassificationSchema>
type ParseResult = { ok: true; measurements: Measurements } | { ok: false; error: string }

const correctionClassifications: readonly CorrectionClassification[] = [
  'omitted-requirement',
  'introduced-regression',
  'environment',
  'execution-contract',
  'context',
  'external-decision',
]

function isVersionTwoMeasurements(
  measurements: Measurements,
): measurements is VersionTwoMeasurements {
  return measurements.version === 2
}

function isVersionThreeMeasurements(
  measurements: Measurements,
): measurements is VersionThreeMeasurements {
  return measurements.version === 3
}

function isVersionTwoDelivery(delivery: Delivery): delivery is VersionTwoDelivery {
  return 'gates' in delivery
}

function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join('\u0000') === [...right].sort().join('\u0000')
}

function validateSessionEvidence(delivery: VersionTwoDelivery): string | null {
  const end = delivery.state === 'accepted' ? delivery.acceptedAt : delivery.observedAt
  for (const correction of delivery.correctionEvidence ?? []) {
    if (
      correction.startedAt < delivery.startedAt ||
      correction.endedAt < correction.startedAt ||
      correction.endedAt > end
    ) {
      return 'Correction evidence must fit within its delivery observation interval.'
    }
  }
  for (const attempt of delivery.sessionEvidence?.attempts ?? []) {
    if (
      attempt.requestedAt !== undefined &&
      attempt.executionStartedAt !== undefined &&
      attempt.executionStartedAt < attempt.requestedAt
    ) {
      return 'Attempt execution cannot start before it was requested.'
    }
    const executionStartedAt = attempt.executionStartedAt
    if (
      executionStartedAt !== undefined &&
      attempt.events.some((event) => event.at < executionStartedAt)
    ) {
      return 'Tool evidence cannot precede its model execution start.'
    }
  }
  return null
}

function validateModelUsageEvidence(deliveries: readonly VersionThreeDelivery[]): string | null {
  const sources = new Set<string>()
  const attempts = new Set<string>()
  for (const delivery of deliveries) {
    const evidence = delivery.modelUsageEvidence
    if (evidence === undefined) continue
    if (!hasUniqueValues(evidence.coveredRoles)) {
      return 'Model usage accounting roles must not repeat.'
    }
    const zeroUsageRoles = evidence.zeroUsageRoles ?? []
    if (
      !hasUniqueValues(zeroUsageRoles) ||
      zeroUsageRoles.some(
        (role) =>
          !evidence.coveredRoles.includes(role) ||
          evidence.entries.some((usage) => usage.usageRole === role),
      )
    ) {
      return 'Zero-usage roles must be unique, covered, and absent from usage entries.'
    }
    if (sources.has(evidence.source)) {
      return 'Model usage accounting sources must be scoped to one delivery.'
    }
    sources.add(evidence.source)
    for (const usage of evidence.entries) {
      if (!evidence.coveredRoles.includes(usage.usageRole)) {
        return 'Model usage entries must use a declared accounting role.'
      }
      if (usage.endedAt < usage.startedAt) {
        return 'Model usage cannot end before it starts.'
      }
      const identity = JSON.stringify([usage.agent, usage.attempt])
      if (attempts.has(identity)) {
        return 'Model usage accounting cannot repeat an agent attempt.'
      }
      attempts.add(identity)
    }
  }
  return null
}

export function parseMeasurements(text: string): ParseResult {
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Measurements must contain valid JSON.' }
  }
  if (!Value.Check(MeasurementsSchema, input)) {
    return { ok: false, error: 'Measurements do not match a supported delivery schema.' }
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
    if (isVersionTwoDelivery(delivery)) {
      if (!hasUniqueValues(delivery.gates) || !hasUniqueValues(delivery.scenarios)) {
        return { ok: false, error: 'Version 2 gates and scenarios must not repeat.' }
      }
      const evidenceError = validateSessionEvidence(delivery)
      if (evidenceError !== null) return { ok: false, error: evidenceError }
    }
  }
  if (isVersionThreeMeasurements(measurements)) {
    const accountingError = validateModelUsageEvidence(measurements.deliveries)
    if (accountingError !== null) return { ok: false, error: accountingError }
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

function p90(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.ceil(values.length * 0.9) - 1] ?? null
}

function summarize(deliveries: readonly Delivery[]) {
  const accepted = deliveries.filter(
    (delivery): delivery is AcceptedDelivery => delivery.state === 'accepted',
  )
  const open = deliveries.filter((delivery) => delivery.state === 'open').length
  const blocked = deliveries.filter((delivery) => delivery.state === 'blocked').length
  const total = deliveries.length
  const timeToAcceptance = accepted.map((delivery) => delivery.acceptedAt - delivery.startedAt)
  return {
    accepted: accepted.length,
    blocked,
    blockedRate: total === 0 ? null : blocked / total,
    incomplete: open + blocked,
    incompleteRate: total === 0 ? null : (open + blocked) / total,
    medianTimeToAcceptanceMs: median(timeToAcceptance),
    medianUnblockedWallMs: median(
      accepted.map((delivery) => delivery.acceptedAt - delivery.startedAt - delivery.blockingMs),
    ),
    medianCorrectiveWorkMs: median(accepted.map((delivery) => delivery.correctiveWorkMs)),
    open,
    p90TimeToAcceptanceMs: p90(timeToAcceptance),
    p90TimeToAcceptanceSampleSize: timeToAcceptance.length,
    firstPassAcceptanceRate:
      accepted.length === 0
        ? null
        : accepted.filter((delivery) => delivery.firstReviewFindings === 0).length /
          accepted.length,
    total,
  }
}

function sameEvidenceSets(
  deliveries: readonly VersionTwoDelivery[],
  field: 'gates' | 'scenarios',
): boolean {
  const first = deliveries[0]
  if (first === undefined) return false
  return deliveries.every((delivery) => sameValues(delivery[field], first[field]))
}

function summarizeSessionEvidence(deliveries: readonly Delivery[]) {
  const attempts = deliveries.flatMap((delivery) =>
    isVersionTwoDelivery(delivery) ? (delivery.sessionEvidence?.attempts ?? []) : [],
  )
  let withinAttemptRepeatedReads = 0
  let crossAttemptRepeatedReads = 0
  let compactions = 0
  let runtimePreflightFailures = 0
  let runtimePreflightFailuresAfterModelStart = 0
  let runtimePreflightFailuresWithoutModelStart = 0
  const preparationDurations: number[] = []
  const sessionSetupDurations: number[] = []
  const workspaceSetupDurations: number[] = []
  const firstEditDurations: number[] = []
  for (const delivery of deliveries) {
    if (!isVersionTwoDelivery(delivery)) continue
    const attemptsForDelivery = delivery.sessionEvidence?.attempts ?? []
    const attemptReadsByTarget = new Map<string, number>()
    for (const attempt of attemptsForDelivery) {
      const readTargets = new Set<string>()
      for (const event of attempt.events) {
        if (event.kind === 'read') {
          if (readTargets.has(event.target)) withinAttemptRepeatedReads += 1
          else readTargets.add(event.target)
        }
        if (event.kind === 'compaction') compactions += 1
        if (event.kind === 'runtime-preflight' && event.outcome === 'failed') {
          runtimePreflightFailures += 1
          if (attempt.executionStartedAt === undefined)
            runtimePreflightFailuresWithoutModelStart += 1
          else runtimePreflightFailuresAfterModelStart += 1
        }
      }
      for (const target of readTargets) {
        attemptReadsByTarget.set(target, (attemptReadsByTarget.get(target) ?? 0) + 1)
      }
      if (attempt.requestedAt !== undefined && attempt.executionStartedAt !== undefined) {
        preparationDurations.push(attempt.executionStartedAt - attempt.requestedAt)
      }
      if (attempt.sessionSetupMs !== undefined) sessionSetupDurations.push(attempt.sessionSetupMs)
      if (attempt.workspaceSetupMs !== undefined)
        workspaceSetupDurations.push(attempt.workspaceSetupMs)
      if (attempt.executionStartedAt !== undefined) {
        const firstEditAt = attempt.events.reduce<number | null>(
          (first, event) =>
            event.kind === 'edit' && (first === null || event.at < first) ? event.at : first,
          null,
        )
        if (firstEditAt !== null) firstEditDurations.push(firstEditAt - attempt.executionStartedAt)
      }
    }
    for (const readAttempts of attemptReadsByTarget.values()) {
      crossAttemptRepeatedReads += Math.max(0, readAttempts - 1)
    }
  }
  return {
    attempts: attempts.length,
    compactions,
    crossAttemptRepeatedReads,
    deliveriesWithSessionEvidence: deliveries.filter(
      (delivery) => isVersionTwoDelivery(delivery) && delivery.sessionEvidence !== undefined,
    ).length,
    deliveriesWithoutSessionEvidence: deliveries.filter(
      (delivery) => !isVersionTwoDelivery(delivery) || delivery.sessionEvidence === undefined,
    ).length,
    medianPreparationDurationMs: median(preparationDurations),
    medianSessionSetupMs: median(sessionSetupDurations),
    medianTimeToFirstEditMs: median(firstEditDurations),
    medianWorkspaceSetupMs: median(workspaceSetupDurations),
    preparationDurationObservedAttempts: preparationDurations.length,
    repeatedReads: withinAttemptRepeatedReads,
    runtimePreflightFailures,
    runtimePreflightFailuresAfterModelStart,
    runtimePreflightFailuresWithoutModelStart,
    sessionSetupObservedAttempts: sessionSetupDurations.length,
    timeToFirstEditObservedAttempts: firstEditDurations.length,
    withinAttemptRepeatedReads,
    workspaceSetupObservedAttempts: workspaceSetupDurations.length,
  }
}

function summarizeCorrections(deliveries: readonly Delivery[]) {
  const corrections = deliveries.flatMap((delivery) =>
    isVersionTwoDelivery(delivery) ? (delivery.correctionEvidence ?? []) : [],
  )
  return correctionClassifications.map((classification) => ({
    classification,
    count: corrections.filter((correction) => correction.classification === classification).length,
  }))
}

function comparisonModel(
  delivery: Delivery,
  field: 'coordinatorModel' | 'reviewerModel',
): string | null {
  if (field === 'coordinatorModel') {
    return 'coordinatorModel' in delivery ? (delivery.coordinatorModel ?? null) : null
  }
  return 'reviewerModel' in delivery ? (delivery.reviewerModel ?? null) : null
}

function comparisonProfile(delivery: Delivery): string {
  return JSON.stringify([
    delivery.complexity,
    delivery.implementationModel,
    comparisonModel(delivery, 'coordinatorModel'),
    comparisonModel(delivery, 'reviewerModel'),
  ])
}

function matchingComparisonProfiles(
  baseline: readonly Delivery[],
  candidate: readonly Delivery[],
): boolean {
  const countProfiles = (deliveries: readonly Delivery[]) => {
    const profiles = new Map<string, number>()
    for (const delivery of deliveries) {
      const profile = comparisonProfile(delivery)
      profiles.set(profile, (profiles.get(profile) ?? 0) + 1)
    }
    return profiles
  }
  const baselineProfiles = countProfiles(baseline)
  const candidateProfiles = countProfiles(candidate)
  return (
    baselineProfiles.size === candidateProfiles.size &&
    [...baselineProfiles.entries()].every(
      ([profile, count]) => candidateProfiles.get(profile) === count,
    )
  )
}

function modelUsageEvidence(delivery: Delivery) {
  return 'modelUsageEvidence' in delivery ? delivery.modelUsageEvidence : undefined
}

const accountingRoles: readonly StaticDecode<typeof ModelUsageRoleSchema>[] = [
  'coordinator',
  'implementation',
  'review',
  'retry',
  'publication',
  'advisory',
]

function stateCostSummary(deliveries: readonly Delivery[], state: Delivery['state']) {
  const matchingDeliveries = deliveries.filter((delivery) => delivery.state === state)
  const entries = matchingDeliveries.flatMap(
    (delivery) => modelUsageEvidence(delivery)?.entries ?? [],
  )
  const knownEntries = entries.filter((entry) => entry.costUsd !== undefined)
  return {
    deliveries: matchingDeliveries.length,
    observedCostUsd:
      knownEntries.length === 0
        ? null
        : knownEntries.reduce((total, entry) => total + (entry.costUsd ?? 0), 0),
    usageEntriesWithKnownCost: knownEntries.length,
    usageEntriesWithUnknownCost: entries.length - knownEntries.length,
  }
}

function summarizeModelUsage(deliveries: readonly Delivery[]) {
  const evidence = deliveries.flatMap((delivery) => {
    const source = modelUsageEvidence(delivery)
    return source === undefined ? [] : [source]
  })
  const firstEvidence = evidence[0]
  const declaredRoles = firstEvidence === undefined ? null : firstEvidence.coveredRoles
  const sameCoverage =
    firstEvidence !== undefined &&
    evidence.every((entry) => sameValues(entry.coveredRoles, firstEvidence.coveredRoles))
  const entries = evidence.flatMap((entry) => entry.entries)
  const knownEntries = entries.filter((entry) => entry.costUsd !== undefined)
  const accountingComplete =
    deliveries.length > 0 &&
    evidence.length === deliveries.length &&
    sameCoverage &&
    declaredRoles !== null &&
    accountingRoles.every((role) => declaredRoles.includes(role)) &&
    evidence.every(
      (source) =>
        source.entries.length > 0 &&
        source.coveredRoles.every(
          (role) =>
            source.entries.some((entry) => entry.usageRole === role) ||
            (source.zeroUsageRoles ?? []).includes(role),
        ),
    ) &&
    knownEntries.length === entries.length
  const totalObservedCostUsd =
    knownEntries.length === 0
      ? null
      : knownEntries.reduce((total, entry) => total + (entry.costUsd ?? 0), 0)
  const accepted = stateCostSummary(deliveries, 'accepted')
  const blocked = stateCostSummary(deliveries, 'blocked')
  const open = stateCostSummary(deliveries, 'open')
  return {
    accepted,
    accountingComplete,
    blocked,
    costPerAcceptedDeliveryUsd:
      accountingComplete && accepted.deliveries > 0 && totalObservedCostUsd !== null
        ? totalObservedCostUsd / accepted.deliveries
        : null,
    declaredRoles,
    deliveriesWithAccounting: evidence.length,
    deliveriesWithoutAccounting: deliveries.length - evidence.length,
    open,
    totalObservedCostUsd,
    tokens:
      evidence.length === 0
        ? null
        : {
            input: entries.reduce((total, entry) => total + entry.inputTokens, 0),
            output: entries.reduce((total, entry) => total + entry.outputTokens, 0),
            cache: entries.reduce((total, entry) => total + entry.cacheTokens, 0),
          },
    usageEntriesWithKnownCost: knownEntries.length,
    usageEntriesWithUnknownCost: entries.length - knownEntries.length,
  }
}

function recommendations(sessionEvidence: ReturnType<typeof summarizeSessionEvidence>): string[] {
  const result: string[] = []
  if (
    sessionEvidence.withinAttemptRepeatedReads > 0 ||
    sessionEvidence.crossAttemptRepeatedReads > 0
  ) {
    result.push(
      'Reuse an accepted owner and API inventory only when policy permits. Keep every explicitly mandated reading.',
    )
  }
  if (sessionEvidence.compactions > 0) {
    result.push(
      'Put open criteria and their necessary sources in the correction brief. Keep every explicitly mandated reading.',
    )
  }
  return result
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
  const comparisonProfileMixMatches = matchingComparisonProfiles(baseline, candidate)
  const versionTwoDeliveries: VersionTwoDelivery[] = []
  for (const delivery of measurements.deliveries) {
    if (isVersionTwoDelivery(delivery)) versionTwoDeliveries.push(delivery)
  }
  const gatesMatch =
    versionTwoDeliveries.length === measurements.deliveries.length &&
    sameEvidenceSets(versionTwoDeliveries, 'gates')
  const scenariosMatch =
    versionTwoDeliveries.length === measurements.deliveries.length &&
    sameEvidenceSets(versionTwoDeliveries, 'scenarios')
  const complete = measurements.deliveries.every((delivery) => delivery.state === 'accepted')
  const comparisonInputsMatch =
    !isVersionTwoMeasurements(measurements) && !isVersionThreeMeasurements(measurements)
      ? true
      : gatesMatch && scenariosMatch
  const comparable =
    complete &&
    baseline.length >= 2 &&
    candidate.length >= 2 &&
    comparisonProfileMixMatches &&
    comparisonInputsMatch
  const before = baselineSummary.medianTimeToAcceptanceMs
  const after = candidateSummary.medianTimeToAcceptanceMs
  const sessionEvidence = summarizeSessionEvidence(measurements.deliveries)
  const modelUsage = summarizeModelUsage(measurements.deliveries)
  const operationalEvidenceAvailable =
    (isVersionTwoMeasurements(measurements) || isVersionThreeMeasurements(measurements)) &&
    measurements.deliveryLedgerEvidence !== undefined &&
    measurements.operationalPilotEvidence !== undefined
  const limitations: string[] = []
  if (
    (!isVersionTwoMeasurements(measurements) && !isVersionThreeMeasurements(measurements)) ||
    measurements.deliveryLedgerEvidence === undefined
  ) {
    limitations.push('No delivery ledger evidence was supplied.')
  }
  if (
    (!isVersionTwoMeasurements(measurements) && !isVersionThreeMeasurements(measurements)) ||
    measurements.operationalPilotEvidence === undefined
  ) {
    limitations.push('No operational pilot evidence was supplied.')
  }
  if (sessionEvidence.deliveriesWithoutSessionEvidence > 0) {
    limitations.push('Some deliveries have no session tool evidence.')
  }
  if (!isVersionThreeMeasurements(measurements)) {
    limitations.push('No model usage accounting was supplied.')
  } else {
    if (modelUsage.deliveriesWithoutAccounting > 0) {
      limitations.push('Model usage accounting does not cover every delivery.')
    }
    if (!modelUsage.accountingComplete && modelUsage.deliveriesWithAccounting > 0) {
      limitations.push('Model usage accounting is incomplete across the declared delivery cohort.')
    }
    if (modelUsage.usageEntriesWithUnknownCost > 0) {
      limitations.push('Some model usage costs are unknown.')
    }
  }
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
    byCorrectionClassification: summarizeCorrections(measurements.deliveries),
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
    contextRecommendations: recommendations(sessionEvidence),
    limitations,
    modelUsage,
    modelUsageByCohort: {
      baseline: summarizeModelUsage(baseline),
      candidate: summarizeModelUsage(candidate),
    },
    pilot: {
      candidateIssuesAccepted: candidateSummary.accepted,
      comparisonProfileMixMatches,
      complexityMixMatches,
      comparable,
      descriptiveReductionPercent:
        comparable &&
        operationalEvidenceAvailable &&
        before !== null &&
        before > 0 &&
        after !== null
          ? (1 - after / before) * 100
          : null,
      gatesMatch:
        isVersionTwoMeasurements(measurements) || isVersionThreeMeasurements(measurements)
          ? gatesMatch
          : null,
      interpretation:
        'Recorded wall-clock evidence, not a causal model benchmark. Open and blocked issues are not accepted deliveries. Evidence references require external verification.',
      minimumTwoCandidatesAccepted: candidateSummary.accepted >= 2,
      operationalEvidenceAvailable,
      scenariosMatch:
        isVersionTwoMeasurements(measurements) || isVersionThreeMeasurements(measurements)
          ? scenariosMatch
          : null,
    },
    sessionEvidence,
  }
}
