import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Websocket handshake'inde collab sunucusuna gönderilen kimlik kanıtı.
 *
 * Plan (Task 20) Auth.js'in `authjs.session-token` çerezini doğrudan
 * istemciye verip provider'a `token` olarak geçirmeyi öngörüyordu. Bu çerez
 * BİLEREK httpOnly'dir: değerini JavaScript'e taşımak, tek bir XSS'in tam
 * oturum token'ını dışarı sızdırabilmesi demektir — ve o token'la saldırgan
 * websocket'e değil, doğrudan uygulamaya kullanıcı olarak girer.
 *
 * Bunun yerine sayfa render'ında, o kullanıcıya özel, kısa ömürlü ve
 * yalnızca collab sunucusunun kabul ettiği bir token imzalanır. Sızsa bile
 * elde edilen şey süreli bir düzenleme yetkisidir, oturumun kendisi değil.
 *
 * Biçim: `v1.<userId>.<expiresAtMs>.<hmac>` — HMAC, imzasız önekin
 * tamamı üzerinden AUTH_SECRET ile alınır. Doküman yetkisi bu token'ın
 * İÇİNDE taşınmaz: collab sunucusu her bağlantıda `can()`'i yeniden
 * çalıştırır, yani token yalnızca "bu kişi kim" sorusunu yanıtlar.
 */
const VERSION = 'v1'
export const COLLAB_TOKEN_TTL_MS = 12 * 60 * 60 * 1000

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function signCollabToken(
  userId: string,
  secret: string,
  ttlMs: number = COLLAB_TOKEN_TTL_MS,
  now: number = Date.now(),
): string {
  const payload = `${VERSION}.${userId}.${now + ttlMs}`
  return `${payload}.${sign(payload, secret)}`
}

/**
 * Geçerliyse token'ın taşıdığı kullanıcı kimliğini, değilse null döner.
 * Kullanıcının hâlâ var ve aktif olup olmadığını doğrulamak çağıranın işi —
 * token bir iddiadır, yetki değil.
 */
export function verifyCollabToken(
  token: string | null | undefined,
  secret: string,
  now: number = Date.now(),
): string | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 4) return null
  const [version, userId, expiresAt, signature] = parts
  if (version !== VERSION || !userId || !expiresAt || !signature) return null

  const expires = Number(expiresAt)
  if (!Number.isFinite(expires) || expires <= now) return null

  const expected = sign(`${version}.${userId}.${expiresAt}`, secret)
  // Uzunluk farkı timingSafeEqual'ı fırlatır; önce eşitliği kontrol et.
  if (expected.length !== signature.length) return null
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null

  return userId
}
