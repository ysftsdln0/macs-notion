import { createHash, randomBytes } from 'node:crypto'

/**
 * Token 32 byte kriptografik rastgeledir; base64url ile 43 karaktere düşer.
 * Yüksek entropili olduğu için SHA-256 yeterlidir — bcrypt/argon2 gerekmez,
 * onlar düşük entropili parolalar içindir.
 */
export function createInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashInviteToken(token) }
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Davetin ömrü. Davet üreten her yol (seed, admin action, CLI script) bunu
 * kullanır — süre tek yerden değişsin diye.
 */
export const INVITE_TTL_DAYS = 7

export function inviteExpiry(): Date {
  return new Date(Date.now() + INVITE_TTL_DAYS * 864e5)
}
