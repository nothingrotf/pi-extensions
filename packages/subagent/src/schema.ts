import { Codec, type StaticDecode, Type } from 'typebox'
import { Value } from 'typebox/value'

export const SUBAGENT_NAME_PATTERN = '^[A-Za-z0-9_-]+(?: [A-Za-z0-9_-]+)*$'

export const SubagentTypeSchema = Type.String({ minLength: 1, pattern: SUBAGENT_NAME_PATTERN })

export const EffortSchema = Type.Union([
  Type.Literal('off'),
  Type.Literal('minimal'),
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
  Type.Literal('xhigh'),
  Type.Literal('max'),
])

export const SchemaModeSchema = Type.Union([Type.Literal('permissive'), Type.Literal('strict')])

export const IsolationIntegrationSchema = Type.Union([
  Type.Literal('apply'),
  Type.Literal('branch'),
  Type.Literal('manual'),
])

export const WorkspaceLifecycleSchema = Type.Union([
  Type.Literal('allocating'),
  Type.Literal('active'),
  Type.Literal('closing'),
  Type.Literal('captured'),
  Type.Literal('staged'),
  Type.Literal('integrating'),
  Type.Literal('integrated'),
  Type.Literal('cleanup-pending'),
  Type.Literal('cleaned'),
  Type.Literal('aborted'),
  Type.Literal('capture-conflict'),
  Type.Literal('conflict'),
  Type.Literal('recovery-required'),
  Type.Literal('cleanup-debt'),
])

export const RootVisibilitySchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('visible'),
  Type.Literal('blocked'),
  Type.Literal('not-requested'),
])

export const OwnerStatusSchema = Type.Union([
  Type.Literal('live'),
  Type.Literal('dead'),
  Type.Literal('ambiguous'),
])

export const HeadStateSchema = Type.Union([Type.Literal('committed'), Type.Literal('unborn')])

export const DependencyModeSchema = Type.Union([
  Type.Literal('copy-on-write'),
  Type.Literal('copy'),
  Type.Literal('omitted'),
  Type.Literal('none'),
])

export const TransactionPhaseSchema = Type.Union([
  Type.Literal('planned'),
  Type.Literal('applied'),
  Type.Literal('verified'),
  Type.Literal('rolled-back'),
  Type.Literal('failed'),
])

export const IsolationRequestSchema = Type.Object(
  {
    integration: Type.Optional(IsolationIntegrationSchema),
    mode: Type.Literal('worktree'),
  },
  { additionalProperties: false },
)

const JsonNullSchema = Type.Null()
const JsonBooleanSchema = Type.Boolean()
const JsonNumberSchema = Type.Number()
const JsonStringSchema = Type.String()
const JsonArrayInputSchema = Type.Array(Type.Unknown())
const JsonObjectInputSchema = Type.Record(Type.String(), Type.Unknown())

export interface JsonObject {
  [key: string]: JsonValue
}

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject

function decodeJsonValue<Input>(input: Input): JsonValue {
  if (Value.Check(JsonNullSchema, input)) return Value.Decode(JsonNullSchema, input)
  if (Value.Check(JsonBooleanSchema, input)) return Value.Decode(JsonBooleanSchema, input)
  if (Value.Check(JsonNumberSchema, input)) return Value.Decode(JsonNumberSchema, input)
  if (Value.Check(JsonStringSchema, input)) return Value.Decode(JsonStringSchema, input)
  if (Value.Check(JsonArrayInputSchema, input)) {
    return Value.Decode(JsonArrayInputSchema, input).map((item) => decodeJsonValue(item))
  }
  const source = Value.Decode(JsonObjectInputSchema, input)
  const output: JsonObject = {}
  for (const [key, item] of Object.entries(source)) output[key] = decodeJsonValue(item)
  return output
}

export const JsonValueSchema = Codec(Type.Unknown())
  .Decode((input) => decodeJsonValue(input))
  .Encode((value) => value)

export function isJsonBoolean(value: JsonValue): value is boolean {
  return Value.Check(JsonBooleanSchema, value)
}

export function isJsonNumber(value: JsonValue): value is number {
  return Value.Check(JsonNumberSchema, value)
}

export function isJsonObject(value: JsonValue): value is JsonObject {
  return !Array.isArray(value) && Value.Check(JsonObjectInputSchema, value)
}

export function isJsonString(value: JsonValue): value is string {
  return Value.Check(JsonStringSchema, value)
}

export const GateDefinitionSchema = Type.Union([
  Type.Object(
    { expected: Type.Literal('completed'), type: Type.Literal('status') },
    { additionalProperties: false },
  ),
  Type.Object({ type: Type.Literal('schema-valid') }, { additionalProperties: false }),
  Type.Object(
    {
      mediaType: Type.Optional(Type.String({ minLength: 1 })),
      type: Type.Literal('artifact-present'),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      op: Type.Literal('exists'),
      path: Type.String(),
      type: Type.Literal('json-pointer'),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      op: Type.Literal('eq'),
      path: Type.String(),
      type: Type.Literal('json-pointer'),
      value: JsonValueSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      op: Type.Literal('in'),
      path: Type.String(),
      type: Type.Literal('json-pointer'),
      values: Type.Array(JsonValueSchema),
    },
    { additionalProperties: false },
  ),
])

const SingleTaskFields = {
  capability_profile: Type.Optional(Type.String({ minLength: 1 })),
  cwd: Type.Optional(Type.String({ minLength: 1 })),
  description: Type.String({ minLength: 1 }),
  gates: Type.Optional(Type.Array(GateDefinitionSchema)),
  isolation: Type.Optional(IsolationRequestSchema),
  model: Type.Optional(Type.String({ minLength: 1 })),
  outputSchema: Type.Optional(JsonValueSchema),
  prompt: Type.String({ minLength: 1 }),
  readonly: Type.Optional(Type.Boolean()),
  schemaMode: Type.Optional(SchemaModeSchema),
  subagent_type: SubagentTypeSchema,
  tools: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 64 })),
}

export const SingleTaskInputSchema = Type.Object(
  {
    ...SingleTaskFields,
    resume: Type.Optional(Type.String({ minLength: 1 })),
    run_in_background: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
)

export const TaskNodeInputSchema = Type.Object(
  {
    ...SingleTaskFields,
    id: Type.String({ minLength: 1, pattern: '^[A-Za-z0-9_-]+$' }),
    needs: Type.Optional(Type.Array(Type.String({ minLength: 1, pattern: '^[A-Za-z0-9_-]+$' }))),
  },
  { additionalProperties: false },
)

export const BatchTaskInputSchema = Type.Object(
  {
    context: Type.Optional(Type.String()),
    tasks: Type.Array(TaskNodeInputSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
)

export const TaskInputSchema = Type.Union([SingleTaskInputSchema, BatchTaskInputSchema])

export const RunStatusSchema = Type.Union([
  Type.Literal('running'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('aborted'),
])

export const RunUsageSchema = Type.Object({
  cacheRead: Type.Number({ minimum: 0 }),
  cacheWrite: Type.Number({ minimum: 0 }),
  cost: Type.Number({ minimum: 0 }),
  durationMs: Type.Number({ minimum: 0 }),
  input: Type.Number({ minimum: 0 }),
  output: Type.Number({ minimum: 0 }),
  toolCalls: Type.Number({ minimum: 0 }),
  turns: Type.Number({ minimum: 0 }),
})

export const ContextStateSchema = Type.Object({
  contextWindow: Type.Number({ minimum: 0 }),
  percent: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  tokens: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
})

export const RetryStateSchema = Type.Object({
  attempt: Type.Number({ minimum: 1 }),
  delayMs: Type.Number({ minimum: 0 }),
  errorMessage: Type.String(),
  maxAttempts: Type.Number({ minimum: 1 }),
  startedAt: Type.Number({ minimum: 0 }),
})

export const RetryFailureSchema = Type.Object({
  attempt: Type.Number({ minimum: 1 }),
  errorMessage: Type.String(),
})

export const LegacyArtifactRefSchema = Type.Object({
  byteLength: Type.Number({ minimum: 0 }),
  id: Type.String({ minLength: 1 }),
  lineCount: Type.Number({ minimum: 0 }),
  mediaType: Type.String({ minLength: 1 }),
  runId: Type.String({ minLength: 1 }),
  sha256: Type.String({ minLength: 64, maxLength: 64 }),
  taskId: Type.String({ minLength: 1 }),
  uri: Type.String({ minLength: 1 }),
})

export const ArtifactRefSchema = Type.Object({
  attempt: Type.Number({ minimum: 1 }),
  byteLength: Type.Number({ minimum: 0 }),
  id: Type.String({ minLength: 1 }),
  lineCount: Type.Number({ minimum: 0 }),
  mediaType: Type.String({ minLength: 1 }),
  runId: Type.String({ minLength: 1 }),
  sha256: Type.String({ minLength: 64, maxLength: 64 }),
  taskId: Type.String({ minLength: 1 }),
  uri: Type.String({ minLength: 1 }),
})

export const StructuredOutputSchema = Type.Object({
  data: Type.Optional(JsonValueSchema),
  error: Type.Optional(Type.String()),
  mode: SchemaModeSchema,
  source: Type.Union([Type.Literal('caller'), Type.Literal('none')]),
  status: Type.Union([Type.Literal('valid'), Type.Literal('invalid'), Type.Literal('unavailable')]),
})

export const GateResultSchema = Type.Object({
  error: Type.Optional(Type.String()),
  gate: GateDefinitionSchema,
  passed: Type.Boolean(),
})

export const IsolationPatchRefSchema = Type.Object({
  byteLength: Type.Number({ minimum: 0 }),
  sha256: Type.String({ minLength: 64, maxLength: 64 }),
  uri: Type.String({ minLength: 1 }),
})

export const IsolationChangedFileSchema = Type.Object({
  path: Type.String({ minLength: 1 }),
  status: Type.String({ minLength: 1 }),
})

export const MergeArtifactsSchema = Type.Object({
  baseTree: Type.String({ minLength: 1 }),
  currentRef: Type.Optional(Type.String({ minLength: 1 })),
  currentTree: Type.String({ minLength: 1 }),
  resultTree: Type.String({ minLength: 1 }),
  mergedRef: Type.Optional(Type.String({ minLength: 1 })),
  mergedTree: Type.Optional(Type.String({ minLength: 1 })),
  patch: Type.Optional(IsolationPatchRefSchema),
  mergeMessage: Type.Optional(Type.String()),
  unmergedPaths: Type.Array(Type.String({ minLength: 1 })),
  stageEntries: Type.Array(
    Type.Object({
      mode: Type.String(),
      oid: Type.String(),
      path: Type.String(),
      stage: Type.Number(),
    }),
  ),
  destinationHead: Type.Optional(Type.String({ minLength: 1 })),
  journalUri: Type.Optional(Type.String({ minLength: 1 })),
})

export const IsolationRepositoryReceiptSchema = Type.Object({
  baselineCommit: Type.String({ minLength: 1 }),
  baselineTree: Type.String({ minLength: 1 }),
  branch: Type.Optional(Type.String({ minLength: 1 })),
  changedFiles: Type.Array(IsolationChangedFileSchema),
  destinationHeadAfter: Type.Optional(Type.String()),
  destinationHeadBefore: Type.String(),
  diffstat: Type.String(),
  error: Type.Optional(Type.String()),
  patch: IsolationPatchRefSchema,
  relativePath: Type.String(),
  repoRoot: Type.String({ minLength: 1 }),
  resultCommit: Type.String({ minLength: 1 }),
  resultTree: Type.String({ minLength: 1 }),
  status: Type.Union([
    Type.Literal('captured'),
    Type.Literal('integrated'),
    Type.Literal('conflict'),
    Type.Literal('recovery-required'),
  ]),
  repositoryId: Type.Optional(Type.String({ minLength: 1 })),
  durableRef: Type.Optional(Type.String({ minLength: 1 })),
  headState: Type.Optional(HeadStateSchema),
  currentTree: Type.Optional(Type.String({ minLength: 1 })),
  mergedTree: Type.Optional(Type.String({ minLength: 1 })),
  mergeArtifacts: Type.Optional(MergeArtifactsSchema),
  transactionPhase: Type.Optional(TransactionPhaseSchema),
})

export const IsolationReceiptSchema = Type.Object({
  attemptId: Type.String({ minLength: 1 }),
  cleanupDebt: Type.Boolean(),
  error: Type.Optional(Type.String()),
  integration: IsolationIntegrationSchema,
  repositories: Type.Array(IsolationRepositoryReceiptSchema),
  retainedPath: Type.Optional(Type.String({ minLength: 1 })),
  status: Type.Union([
    Type.Literal('captured'),
    Type.Literal('integrated'),
    Type.Literal('partial'),
    Type.Literal('conflict'),
  ]),
  writerId: Type.String({ minLength: 1 }),
  workspaceId: Type.Optional(Type.String({ minLength: 1 })),
  rootWorkspaceId: Type.Optional(Type.String({ minLength: 1 })),
  parentWorkspaceId: Type.Optional(Type.String({ minLength: 1 })),
  destinationWorkspaceId: Type.Optional(Type.String({ minLength: 1 })),
  captureStatus: Type.Optional(Type.Union([Type.Literal('captured'), Type.Literal('failed')])),
  integrationStatus: Type.Optional(
    Type.Union([
      Type.Literal('not-requested'),
      Type.Literal('staged'),
      Type.Literal('integrated'),
      Type.Literal('conflict'),
      Type.Literal('blocked'),
    ]),
  ),
  rootVisibility: Type.Optional(RootVisibilitySchema),
  dependencyMode: Type.Optional(DependencyModeSchema),
  manifestUri: Type.Optional(Type.String({ minLength: 1 })),
  journalUri: Type.Optional(Type.String({ minLength: 1 })),
})

export const WorkspaceRecordSchema = Type.Object({
  version: Type.Literal(6),
  workspaceId: Type.String({ minLength: 1 }),
  rootWorkspaceId: Type.String({ minLength: 1 }),
  parentWorkspaceId: Type.String({ minLength: 1 }),
  scopeId: Type.String({ minLength: 1 }),
  writerId: Type.String({ minLength: 1 }),
  attemptId: Type.String({ minLength: 1 }),
  logicalCwd: Type.String({ minLength: 1 }),
  relativeCwd: Type.String(),
  repositoryIds: Type.Array(Type.String({ minLength: 1 })),
  spawnOrdinal: Type.Number({ minimum: 0 }),
  lifecycleState: WorkspaceLifecycleSchema,
  rootVisibility: RootVisibilitySchema,
  ownerStatus: Type.Optional(OwnerStatusSchema),
  recoveryStatus: Type.Optional(Type.String({ minLength: 1 })),
  manifestUri: Type.Optional(Type.String({ minLength: 1 })),
  journalUri: Type.Optional(Type.String({ minLength: 1 })),
  createdAt: Type.Number({ minimum: 0 }),
  updatedAt: Type.Number({ minimum: 0 }),
})

export type WorkspaceRecord = StaticDecode<typeof WorkspaceRecordSchema>
export type RootVisibility = StaticDecode<typeof RootVisibilitySchema>
export type WorkspaceLifecycle = StaticDecode<typeof WorkspaceLifecycleSchema>
export type MergeArtifacts = StaticDecode<typeof MergeArtifactsSchema>

export const AgentSourceSchema = Type.Union([
  Type.Object({ kind: Type.Literal('bundled') }),
  Type.Object({ id: Type.String({ minLength: 1 }), kind: Type.Literal('extension') }),
  Type.Object({ kind: Type.Literal('project'), path: Type.String({ minLength: 1 }) }),
  Type.Object({ kind: Type.Literal('user'), path: Type.String({ minLength: 1 }) }),
])

export const CapabilityRegistrationContractSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  version: Type.String({ minLength: 1 }),
})

export const NestedPolicySchema = Type.Union([
  Type.Object({ enabled: Type.Literal(false) }),
  Type.Object({ enabled: Type.Literal(true), maxDepth: Type.Number({ minimum: 1 }) }),
])

export const CapabilityContractSchema = Type.Object({
  extensions: Type.Array(CapabilityRegistrationContractSchema),
  nested: NestedPolicySchema,
  profileId: Type.Optional(Type.String({ minLength: 1 })),
  registrations: Type.Array(CapabilityRegistrationContractSchema),
  tools: Type.Array(Type.String({ minLength: 1 })),
})

export const ExecutionContractV1Schema = Type.Object({
  agentDescription: Type.String(),
  agentName: Type.String({ minLength: 1 }),
  agentSource: AgentSourceSchema,
  cwd: Type.String({ minLength: 1 }),
  effort: EffortSchema,
  fast: Type.Boolean(),
  model: Type.String({ minLength: 1 }),
  modelSelector: Type.String({ minLength: 1 }),
  readonly: Type.Boolean(),
  systemPrompt: Type.String({ minLength: 1 }),
  tools: Type.Array(Type.String({ minLength: 1 })),
  version: Type.Literal(1),
})

export const LineageContractSchema = Type.Object({
  depth: Type.Number({ minimum: 1 }),
  parentAgentId: Type.Optional(Type.String({ minLength: 1 })),
  parentSessionId: Type.String({ minLength: 1 }),
  rootAgentId: Type.String({ minLength: 1 }),
  rootOwnerSessionId: Type.String({ minLength: 1 }),
})

export const ExecutionContractSchema = Type.Object({
  agentDescription: Type.String(),
  agentName: Type.String({ minLength: 1 }),
  agentSource: AgentSourceSchema,
  backgroundDefault: Type.Optional(Type.Boolean()),
  capability: Type.Optional(CapabilityContractSchema),
  cwd: Type.String({ minLength: 1 }),
  effort: EffortSchema,
  fast: Type.Boolean(),
  gates: Type.Array(GateDefinitionSchema),
  isolation: Type.Optional(IsolationRequestSchema),
  lineage: Type.Optional(LineageContractSchema),
  model: Type.String({ minLength: 1 }),
  modelSelector: Type.String({ minLength: 1 }),
  outputSchema: Type.Optional(JsonValueSchema),
  readonly: Type.Boolean(),
  schemaMode: SchemaModeSchema,
  systemPrompt: Type.String({ minLength: 1 }),
  tools: Type.Array(Type.String({ minLength: 1 })),
  version: Type.Literal(2),
})

const ExecutionContractV3Base = Type.Omit(ExecutionContractSchema, ['cwd'])

export const ExecutionContractV3Schema = Type.Object({
  ...ExecutionContractV3Base.properties,
  logicalCwd: Type.String({ minLength: 1 }),
  relativeCwd: Type.String(),
  version: Type.Literal(3),
})

export const ExecutionContractAnySchema = Type.Union([
  ExecutionContractV1Schema,
  ExecutionContractSchema,
  ExecutionContractV3Schema,
])

const RunRecordFields = {
  agentId: Type.String({ minLength: 1 }),
  artifact: Type.Optional(ArtifactRefSchema),
  background: Type.Boolean(),
  contextState: Type.Optional(ContextStateSchema),
  createdAt: Type.Number({ minimum: 0 }),
  depth: Type.Optional(Type.Number({ minimum: 1 })),
  description: Type.String({ minLength: 1 }),
  durationMs: Type.Optional(Type.Number({ minimum: 0 })),
  effort: EffortSchema,
  error: Type.Optional(Type.String()),
  fast: Type.Boolean(),
  gateResults: Type.Optional(Type.Array(GateResultSchema)),
  intercomUsage: Type.Optional(RunUsageSchema),
  isolation: Type.Optional(IsolationReceiptSchema),
  isolationAttempts: Type.Optional(Type.Array(IsolationReceiptSchema)),
  itemId: Type.Optional(Type.String({ minLength: 1 })),
  model: Type.String({ minLength: 1 }),
  modelSelector: Type.String({ minLength: 1 }),
  output: Type.Optional(Type.String()),
  ownerSessionId: Type.String({ minLength: 1 }),
  parentAgentId: Type.Optional(Type.String({ minLength: 1 })),
  parentSessionId: Type.Optional(Type.String({ minLength: 1 })),
  readonly: Type.Boolean(),
  retryFailure: Type.Optional(RetryFailureSchema),
  rootAgentId: Type.Optional(Type.String({ minLength: 1 })),
  runGeneration: Type.Optional(Type.Number({ minimum: 1 })),
  runId: Type.Optional(Type.String({ minLength: 1 })),
  sessionFile: Type.String({ minLength: 1 }),
  status: RunStatusSchema,
  structuredOutput: Type.Optional(StructuredOutputSchema),
  subagentType: SubagentTypeSchema,
  updatedAt: Type.Number({ minimum: 0 }),
  usage: Type.Optional(RunUsageSchema),
}

export const RunRecordV1Schema = Type.Object(RunRecordFields)
export const RunRecordV2Schema = Type.Object({
  ...RunRecordFields,
  execution: Type.Optional(ExecutionContractV1Schema),
})
export const RunRecordSchema = Type.Object({
  ...RunRecordFields,
  execution: Type.Optional(ExecutionContractAnySchema),
})

export const RunRecordV3Schema = Type.Object({
  ...RunRecordFields,
  artifact: Type.Optional(LegacyArtifactRefSchema),
  execution: Type.Optional(ExecutionContractAnySchema),
})

export const RuntimeStateV1Schema = Type.Object({
  ownerSessionId: Type.String({ minLength: 1 }),
  records: Type.Array(RunRecordV1Schema),
  version: Type.Literal(1),
})

export const RuntimeStateV2Schema = Type.Object({
  ownerSessionId: Type.String({ minLength: 1 }),
  records: Type.Array(RunRecordV2Schema),
  version: Type.Literal(2),
})

export const CoordinationTaskStateSchema = Type.Object({
  agentId: Type.Optional(Type.String({ minLength: 1 })),
  artifact: Type.Optional(ArtifactRefSchema),
  error: Type.Optional(Type.String()),
  isolation: Type.Optional(IsolationReceiptSchema),
  needs: Type.Array(Type.String({ minLength: 1 })),
  status: Type.Union([
    Type.Literal('pending'),
    Type.Literal('running'),
    Type.Literal('completed'),
    Type.Literal('failed'),
    Type.Literal('aborted'),
    Type.Literal('blocked'),
  ]),
  taskId: Type.String({ minLength: 1 }),
})

export const CoordinationTaskStateV3Schema = Type.Object({
  agentId: Type.Optional(Type.String({ minLength: 1 })),
  artifact: Type.Optional(LegacyArtifactRefSchema),
  error: Type.Optional(Type.String()),
  needs: Type.Array(Type.String({ minLength: 1 })),
  status: Type.Union([
    Type.Literal('pending'),
    Type.Literal('running'),
    Type.Literal('completed'),
    Type.Literal('failed'),
    Type.Literal('aborted'),
    Type.Literal('blocked'),
  ]),
  taskId: Type.String({ minLength: 1 }),
})

export const CoordinationRunStateSchema = Type.Object({
  createdAt: Type.Number({ minimum: 0 }),
  ownerSessionId: Type.String({ minLength: 1 }),
  runId: Type.String({ minLength: 1 }),
  status: Type.Union([
    Type.Literal('running'),
    Type.Literal('completed'),
    Type.Literal('failed'),
    Type.Literal('aborted'),
  ]),
  tasks: Type.Array(CoordinationTaskStateSchema),
  updatedAt: Type.Number({ minimum: 0 }),
})

export const CoordinationRunStateV3Schema = Type.Object({
  createdAt: Type.Number({ minimum: 0 }),
  ownerSessionId: Type.String({ minLength: 1 }),
  runId: Type.String({ minLength: 1 }),
  status: Type.Union([
    Type.Literal('running'),
    Type.Literal('completed'),
    Type.Literal('failed'),
    Type.Literal('aborted'),
  ]),
  tasks: Type.Array(CoordinationTaskStateV3Schema),
  updatedAt: Type.Number({ minimum: 0 }),
})

export const RuntimeStateV3Schema = Type.Object({
  ownerSessionId: Type.String({ minLength: 1 }),
  records: Type.Array(RunRecordV3Schema),
  runs: Type.Optional(Type.Array(CoordinationRunStateV3Schema)),
  version: Type.Literal(3),
})

export const RuntimeStateV4Schema = Type.Object({
  ownerSessionId: Type.String({ minLength: 1 }),
  records: Type.Array(RunRecordSchema),
  runs: Type.Optional(Type.Array(CoordinationRunStateSchema)),
  version: Type.Literal(4),
})

export const RuntimeStateV5Schema = Type.Object({
  ownerSessionId: Type.String({ minLength: 1 }),
  records: Type.Array(RunRecordSchema),
  runs: Type.Optional(Type.Array(CoordinationRunStateSchema)),
  version: Type.Literal(5),
})

export const RuntimeStateSchema = Type.Object({
  ownerSessionId: Type.String({ minLength: 1 }),
  records: Type.Array(RunRecordSchema),
  rootStores: Type.Array(Type.String({ minLength: 1 })),
  runs: Type.Array(CoordinationRunStateSchema),
  version: Type.Literal(6),
  workspaces: Type.Array(WorkspaceRecordSchema),
})

export type ExecutionContractV3 = StaticDecode<typeof ExecutionContractV3Schema>

export type AgentSource = StaticDecode<typeof AgentSourceSchema>
export type ArtifactRef = StaticDecode<typeof ArtifactRefSchema>
export type BatchTaskInput = StaticDecode<typeof BatchTaskInputSchema>
export type CapabilityContract = StaticDecode<typeof CapabilityContractSchema>
export type ContextState = StaticDecode<typeof ContextStateSchema>
export type CoordinationRunState = StaticDecode<typeof CoordinationRunStateSchema>
export type CoordinationTaskState = StaticDecode<typeof CoordinationTaskStateSchema>
export type CoordinationTaskStateV3 = StaticDecode<typeof CoordinationTaskStateV3Schema>
export type Effort = StaticDecode<typeof EffortSchema>
export type ExecutionContract = StaticDecode<typeof ExecutionContractSchema>
export type ExecutionContractV1 = StaticDecode<typeof ExecutionContractV1Schema>
export type GateDefinition = StaticDecode<typeof GateDefinitionSchema>
export type GateResult = StaticDecode<typeof GateResultSchema>
export type DependencyMode = StaticDecode<typeof DependencyModeSchema>
export type HeadState = StaticDecode<typeof HeadStateSchema>
export type IsolationChangedFile = StaticDecode<typeof IsolationChangedFileSchema>
export type IsolationIntegration = StaticDecode<typeof IsolationIntegrationSchema>
export type IsolationPatchRef = StaticDecode<typeof IsolationPatchRefSchema>
export type IsolationReceipt = StaticDecode<typeof IsolationReceiptSchema>
export type IsolationRepositoryReceipt = StaticDecode<typeof IsolationRepositoryReceiptSchema>
export type IsolationRequest = StaticDecode<typeof IsolationRequestSchema>
export type LegacyArtifactRef = StaticDecode<typeof LegacyArtifactRefSchema>
export type RuntimeStateV3 = StaticDecode<typeof RuntimeStateV3Schema>
export type RuntimeStateV4 = StaticDecode<typeof RuntimeStateV4Schema>
export type RuntimeStateV5 = StaticDecode<typeof RuntimeStateV5Schema>
export type TransactionPhase = StaticDecode<typeof TransactionPhaseSchema>
export type OwnerStatus = StaticDecode<typeof OwnerStatusSchema>
export type RetryFailure = StaticDecode<typeof RetryFailureSchema>
export type RetryState = StaticDecode<typeof RetryStateSchema>
export type RunRecord = StaticDecode<typeof RunRecordSchema>
export type RunRecordV3 = StaticDecode<typeof RunRecordV3Schema>
export type RunStatus = StaticDecode<typeof RunStatusSchema>
export type RunUsage = StaticDecode<typeof RunUsageSchema>
export type RuntimeState = StaticDecode<typeof RuntimeStateSchema>
export type SchemaMode = StaticDecode<typeof SchemaModeSchema>
export type SingleTaskInput = StaticDecode<typeof SingleTaskInputSchema>
export type StructuredOutput = StaticDecode<typeof StructuredOutputSchema>
export type SubagentType = StaticDecode<typeof SubagentTypeSchema>
export type TaskInput = StaticDecode<typeof SingleTaskInputSchema>
export type TaskToolInput = StaticDecode<typeof TaskInputSchema>
export type TaskNodeInput = StaticDecode<typeof TaskNodeInputSchema>
