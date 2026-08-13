import type { Actor } from '@/lib/auth/policy'

/**
 * Testlerde aktör kurmanın tek yolu. `Actor` yeni bir alan kazandığında
 * yüzlerce test nesnesi değil, yalnızca bu varsayılan güncellenir.
 */
export function makeActor(overrides: Partial<Actor> & { id: string }): Actor {
  return {
    globalRole: 'MEMBER',
    isActive: true,
    memberships: [],
    permissions: [],
    ...overrides,
  }
}
