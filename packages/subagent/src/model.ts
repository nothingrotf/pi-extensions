import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Model, Api } from '@earendil-works/pi-ai'
import type { ExtensionContext, ModelRuntime } from '@earendil-works/pi-coding-agent'
import { getFastSupport } from '@nothingrotf/fast-mode/policy'
import { Value } from 'typebox/value'

import type { RoleDefinition } from './roles.ts'
import { EffortSchema, type Effort } from './schema.ts'

const FAST_SUFFIX = ' [fast]'
const RESERVED_SELECTORS = new Set(['auto', 'default', 'inherit'])

export interface ResolvedModel {
  effort: Effort
  fast: boolean
  model: Model<Api>
  modelRef: string
  selector: string
}

interface ParsedSelector {
  effort: Effort | undefined
  fast: boolean
  modelRef: string
}

function modelRef(model: Model<Api>): string {
  return `${model.provider}/${model.id}`
}

function parseEffort(value: string): Effort | undefined {
  try {
    return Value.Decode(EffortSchema, value)
  } catch {
    return undefined
  }
}

function splitEffort(selector: string): { effort: Effort | undefined; modelRef: string } {
  const separator = selector.lastIndexOf(':')
  if (separator < 0) return { effort: undefined, modelRef: selector }

  const effort = parseEffort(selector.slice(separator + 1))
  if (effort === undefined) return { effort: undefined, modelRef: selector }
  return { effort, modelRef: selector.slice(0, separator) }
}

function parseSelector(selector: string, runtime: ModelRuntime): ParsedSelector {
  const trimmed = selector.trim()
  if (trimmed.length === 0) throw new Error('The model selector is empty.')

  const fast = trimmed.endsWith(FAST_SUFFIX)
  const withoutFast = fast ? trimmed.slice(0, -FAST_SUFFIX.length).trimEnd() : trimmed
  if (withoutFast.includes('[fast]')) {
    throw new Error('The [fast] marker must be the final model selector token.')
  }

  const exactModel = runtime.getModels().some((model) => modelRef(model) === withoutFast)
  const parsed = exactModel
    ? { effort: undefined, modelRef: withoutFast }
    : splitEffort(withoutFast)
  return { ...parsed, fast }
}

function findExactModel(runtime: ModelRuntime, reference: string): Model<Api> {
  const model = runtime.getModels().find((candidate) => modelRef(candidate) === reference)
  if (model === undefined) {
    throw new Error(`Model "${reference}" is not available in the active Pi runtime.`)
  }
  return model
}

function validateFast(model: Model<Api>, fast: boolean): void {
  if (!fast) return
  const support = getFastSupport(model)
  if (!support.supported) {
    throw new Error(
      `Model "${modelRef(model)}" does not support the [fast] selector. ${support.reason}`,
    )
  }
}

function validateEffort(model: Model<Api>, effort: Effort): void {
  if (!model.reasoning && effort !== 'off') {
    throw new Error(`Model "${modelRef(model)}" does not support reasoning effort "${effort}".`)
  }

  const mapped = model.thinkingLevelMap?.[effort]
  if (mapped === null) {
    throw new Error(`Model "${modelRef(model)}" does not support reasoning effort "${effort}".`)
  }
}

function inheritedModel(ctx: ExtensionContext, runtime: ModelRuntime): Model<Api> {
  if (ctx.model === undefined) throw new Error('The parent session has no active model.')
  return findExactModel(runtime, modelRef(ctx.model))
}

function selectEffort(parsed: ParsedSelector, role: RoleDefinition, ctx: ExtensionContext): Effort {
  return parsed.effort ?? role.effort ?? ctx.thinkingLevel ?? 'off'
}

function normalizeEffort(model: Model<Api>, effort: Effort, explicit: boolean): Effort {
  if (!model.reasoning && !explicit) return 'off'
  validateEffort(model, effort)
  return effort
}

export function resolveStoredModel(
  reference: string,
  effort: Effort,
  fast: boolean,
  runtime: ModelRuntime,
): ResolvedModel {
  const model = findExactModel(runtime, reference)
  validateEffort(model, effort)
  validateFast(model, fast)
  return {
    effort,
    fast,
    model,
    modelRef: reference,
    selector: `${reference}:${effort}${fast ? FAST_SUFFIX : ''}`,
  }
}

export function resolveModel(
  selector: string | undefined,
  role: RoleDefinition,
  ctx: ExtensionContext,
  runtime: ModelRuntime,
): ResolvedModel {
  const parsed = parseSelector(selector ?? 'inherit', runtime)
  const reserved = RESERVED_SELECTORS.has(parsed.modelRef)
  if (reserved && parsed.fast) {
    throw new Error('[fast] requires an explicit provider/model-id selector.')
  }
  if (!reserved && !parsed.modelRef.includes('/')) {
    throw new Error('The model selector must use provider/model-id syntax.')
  }

  const model = reserved ? inheritedModel(ctx, runtime) : findExactModel(runtime, parsed.modelRef)
  const reference = modelRef(model)
  const effort = normalizeEffort(
    model,
    selectEffort(parsed, role, ctx),
    parsed.effort !== undefined,
  )
  validateFast(model, parsed.fast)

  const normalized = `${reference}:${effort}${parsed.fast ? FAST_SUFFIX : ''}`
  return {
    effort,
    fast: parsed.fast,
    model,
    modelRef: reference,
    selector: normalized,
  }
}

export function toThinkingLevel(effort: Effort): ThinkingLevel {
  return effort
}
