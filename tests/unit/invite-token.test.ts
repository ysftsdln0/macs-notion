import { describe, expect, it } from 'vitest'
import { createInviteToken, hashInviteToken } from '@/lib/auth/invite-token'

describe('davet token', () => {
  it('URL-güvenli ve yeterince uzun token üretir', () => {
    const { token } = createInviteToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('her çağrıda farklı token üretir', () => {
    expect(createInviteToken().token).not.toBe(createInviteToken().token)
  })

  it("hash deterministiktir ve ham token'ı içermez", () => {
    const { token, tokenHash } = createInviteToken()
    expect(hashInviteToken(token)).toBe(tokenHash)
    expect(tokenHash).not.toContain(token)
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/)
  })
})
