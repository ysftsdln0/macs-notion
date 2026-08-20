import { describe, expect, it } from 'vitest'
import {
  createInviteToken,
  DEFAULT_INVITE_DURATION,
  hashInviteToken,
  INVITE_DURATIONS,
  INVITE_DURATION_LABELS,
  inviteExpiry,
} from '@/lib/auth/invite-token'

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

describe('inviteExpiry', () => {
  it('varsayılan süre bir haftadır', () => {
    const expiry = inviteExpiry()
    expect(expiry).not.toBeNull()
    expect(expiry!.getTime() - Date.now()).toBeGreaterThan(6.9 * 864e5)
    expect(expiry!.getTime() - Date.now()).toBeLessThan(7.1 * 864e5)
  })

  it('FOREVER süresiz davet üretir', () => {
    expect(inviteExpiry('FOREVER')).toBeNull()
  })

  it('her süre seçeneğinin Türkçe etiketi vardır', () => {
    for (const key of Object.keys(INVITE_DURATIONS)) {
      expect(INVITE_DURATION_LABELS[key as keyof typeof INVITE_DURATIONS]).toBeTruthy()
    }
  })

  it('varsayılan süre tanımlı seçeneklerden biridir', () => {
    expect(Object.keys(INVITE_DURATIONS)).toContain(DEFAULT_INVITE_DURATION)
  })
})
