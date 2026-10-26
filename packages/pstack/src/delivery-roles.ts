import { pstackRoles, type PstackDeliveryClass } from './model-policy.ts'

function classified(
  role: string,
  delivery: PstackDeliveryClass,
): readonly [string, PstackDeliveryClass] {
  return [role, delivery]
}

const classifications = new Map<string, PstackDeliveryClass>([
  ...pstackRoles.flatMap((entry) =>
    [entry.role, ...entry.aliases].map((role) => classified(role, entry.delivery)),
  ),
  classified('how critics', 'none'),
])

function classification(role: string | undefined): PstackDeliveryClass | undefined {
  return role === undefined ? undefined : classifications.get(role)
}

export function isImplementationRole(role: string | undefined): boolean {
  const delivery = classification(role)
  return delivery === undefined || delivery === 'implementation'
}
