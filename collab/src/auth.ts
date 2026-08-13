import { verifyCollabToken } from '../../src/lib/auth/collab-token.ts'
import { PrismaClient } from '../generated/prisma/client.js'

const db = new PrismaClient()

export type CollabActor = {
  id: string
  globalRole: 'SUPERADMIN' | 'ADMIN' | 'MEMBER'
  isActive: boolean
  memberships: { channelId: string; channelRole: 'LEAD' | 'MEMBER' }[]
}

function authSecret(): string {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET tanımlı değil — collab token doğrulanamaz')
  return secret
}

/**
 * Provider, websocket handshake'inde `token` olarak sayfanın imzaladığı
 * kısa ömürlü collab token'ını gönderir (`src/lib/auth/collab-token.ts`).
 * Auth.js'in httpOnly oturum çerezi BİLEREK kabul edilmez: onu istemci
 * JavaScript'ine taşımak httpOnly'nin tek amacını ortadan kaldırırdı.
 *
 * Token yalnızca kimliği taşır; kullanıcının hâlâ aktif olup olmadığı ve
 * kanal üyelikleri her bağlantıda veritabanından tazelenir — pasife alınan
 * bir üye token'ı süresi dolmasa bile bağlanamaz.
 */
export async function resolveActor(token: string | null): Promise<CollabActor | null> {
  const userId = verifyCollabToken(token, authSecret())
  if (!userId) return null

  const user = await db.user.findUnique({
    where: { id: userId },
    include: { memberships: true },
  })
  if (!user || !user.isActive) return null

  return {
    id: user.id,
    globalRole: user.globalRole,
    isActive: user.isActive,
    memberships: user.memberships.map((m) => ({
      channelId: m.channelId,
      channelRole: m.channelRole,
    })),
  }
}
