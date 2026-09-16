import { describe, expect, it } from 'vite-plus/test'

import { isDeliveryRole, isImplementationRole } from '../src/delivery-roles.ts'
import { pstackRoles } from '../src/model-policy.ts'

describe('pstack delivery role classification', () => {
  it('classifies every registered role and alias from one registry', () => {
    for (const entry of pstackRoles) {
      for (const role of [entry.role, ...entry.aliases]) {
        const implementation = entry.delivery === 'implementation'
        expect(isImplementationRole(role), role).toBe(implementation)
        expect(isDeliveryRole(role, false), role).toBe(entry.delivery !== 'none')
        expect(isDeliveryRole(role, true), role).toBe(entry.delivery !== 'none')
      }
    }
  })

  it('preserves legacy and unknown-role compatibility without granting known support roles', () => {
    expect(isImplementationRole('how critics')).toBe(false)
    expect(isImplementationRole('hardest tasks')).toBe(false)
    expect(isImplementationRole('architect runners')).toBe(false)
    expect(isImplementationRole('legacy implementation role')).toBe(true)
    expect(isDeliveryRole('legacy implementation role', false)).toBe(true)
    expect(isDeliveryRole('legacy implementation role', true)).toBe(false)
  })
})
