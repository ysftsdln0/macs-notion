import { describe, expect, it } from 'vitest'
import { COLLAB_TOKEN_TTL_MS, signCollabToken, verifyCollabToken } from '@/lib/auth/collab-token'

const SECRET = 'test-secret-not-a-real-one'

describe('collab token', () => {
  it('imzalanan token aynı sırla doğrulanır', () => {
    const token = signCollabToken('user-1', SECRET)
    expect(verifyCollabToken(token, SECRET)).toBe('user-1')
  })

  it('başka bir sırla imzalanmış token reddedilir', () => {
    const token = signCollabToken('user-1', 'baska-sir')
    expect(verifyCollabToken(token, SECRET)).toBeNull()
  })

  it('kullanıcı kimliği değiştirilmiş token reddedilir', () => {
    const token = signCollabToken('user-1', SECRET)
    const forged = token.replace('user-1', 'user-2')
    expect(verifyCollabToken(forged, SECRET)).toBeNull()
  })

  it('süresi geçen token reddedilir', () => {
    const now = Date.now()
    const token = signCollabToken('user-1', SECRET, 1000, now)
    expect(verifyCollabToken(token, SECRET, now + 500)).toBe('user-1')
    expect(verifyCollabToken(token, SECRET, now + 1001)).toBeNull()
  })

  it('son kullanma tarihi uzatılmış token reddedilir', () => {
    const now = Date.now()
    const token = signCollabToken('user-1', SECRET, 1000, now)
    const parts = token.split('.')
    const forged = `${parts[0]}.${parts[1]}.${now + COLLAB_TOKEN_TTL_MS}.${parts[3]}`
    expect(verifyCollabToken(forged, SECRET, now + 2000)).toBeNull()
  })

  it('bozuk ve boş girdiler null döner', () => {
    expect(verifyCollabToken(null, SECRET)).toBeNull()
    expect(verifyCollabToken('', SECRET)).toBeNull()
    expect(verifyCollabToken('v1.user-1', SECRET)).toBeNull()
    expect(verifyCollabToken('v2.user-1.9999999999999.abc', SECRET)).toBeNull()
    expect(verifyCollabToken('v1.user-1.abc.def', SECRET)).toBeNull()
  })
})
