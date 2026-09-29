import { type TObject, type TProperties, type TSchema, type TUnion, Type } from 'typebox'

function variantsByProperty(members: readonly TObject[]): Map<string, TSchema[]> {
  const variants = new Map<string, TSchema[]>()
  for (const member of members) {
    for (const [name, schema] of Object.entries(member.properties)) {
      const known = variants.get(name) ?? []
      const encoded = JSON.stringify(schema)
      if (!known.some((candidate) => JSON.stringify(candidate) === encoded)) known.push(schema)
      variants.set(name, known)
    }
  }
  return variants
}

function mergedProperties(variants: ReadonlyMap<string, readonly TSchema[]>): TProperties {
  const properties: TProperties = {}
  for (const [name, schemas] of variants) {
    const [only] = schemas
    properties[name] = schemas.length === 1 && only !== undefined ? only : Type.Union([...schemas])
  }
  return properties
}

function memberConstraint(member: TObject, variants: ReadonlyMap<string, readonly TSchema[]>) {
  const properties: TProperties = {}
  for (const [name, schema] of Object.entries(member.properties)) {
    properties[name] = (variants.get(name)?.length ?? 0) > 1 ? schema : Type.Unknown()
  }
  return Type.Object(properties, {
    additionalProperties: !(
      'additionalProperties' in member && member.additionalProperties === false
    ),
    required: member.required,
  })
}

function commonRequired(members: readonly TObject[]): string[] {
  const [first, ...rest] = members
  if (first === undefined) return []
  return first.required.filter((name) => rest.every((member) => member.required.includes(name)))
}

export function toolInputUnion<const Types extends TObject[]>(members: [...Types]): TUnion<Types> {
  const variants = variantsByProperty(members)
  return Type.Union(members, {
    anyOf: members.map((member) => memberConstraint(member, variants)),
    properties: mergedProperties(variants),
    required: commonRequired(members),
    type: 'object',
  })
}
