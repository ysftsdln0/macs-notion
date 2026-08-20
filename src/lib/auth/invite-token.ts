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
 * Davetin yaşayabileceği süreler. Tek kaynak: davet üreten her yol (form,
 * seed, CLI script) buradan geçer. `null` = süresiz.
 */
export const INVITE_DURATIONS = {
  HOUR: 36e5,
  DAY: 864e5,
  WEEK: 7 * 864e5,
  MONTH: 30 * 864e5,
  FOREVER: null,
} as const

export type InviteDuration = keyof typeof INVITE_DURATIONS

export const INVITE_DURATION_LABELS: Record<InviteDuration, string> = {
  HOUR: '1 saat',
  DAY: '1 gün',
  WEEK: '7 gün',
  MONTH: '30 gün',
  FOREVER: 'Süresiz',
}

export const DEFAULT_INVITE_DURATION: InviteDuration = 'WEEK'

/**
 * Kademe (ADMIN/SUPERADMIN) daveti bundan uzun yaşayamaz. Sızan bir kademe
 * bağlantısı tek gün ve tek hesapla sınırlı kalsın diye.
 */
export const ELEVATED_MAX_DURATION_MS = 24 * 36e5

export function inviteExpiry(duration: InviteDuration = DEFAULT_INVITE_DURATION): Date | null {
  const ms = INVITE_DURATIONS[duration]
  return ms === null ? null : new Date(Date.now() + ms)
}

/**
 * Formda sunulan kullanım limitleri. `null` = sınırsız. Sunucu bu listeyle
 * sınırlı değildir (pozitif tam sayı yeter) — liste yalnızca arayüzün seçim
 * kümesi ve etiketleri.
 */
export const INVITE_USE_LIMITS = [1, 5, 25, null] as const

export const INVITE_USE_LIMIT_LABELS = new Map<number | null, string>([
  [1, '1 kişi'],
  [5, '5 kişi'],
  [25, '25 kişi'],
  [null, 'Sınırsız'],
])
