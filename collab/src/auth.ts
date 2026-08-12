import { PrismaClient } from '../generated/prisma/client.js'

const db = new PrismaClient()

export type CollabActor = {
  id: string
  globalRole: 'ADMIN' | 'MEMBER'
  isActive: boolean
  memberships: { channelId: string; channelRole: 'LEAD' | 'MEMBER' }[]
}

/**
 * Auth.js DB oturumunda sessionToken == httpOnly çerez değeridir.
 * Provider, `token` seçeneğini websocket handshake'inde gönderir;
 * burada karşılığı Session tablosunda aranır.
 */
export async function resolveActor(token: string | null): Promise<CollabActor | null> {
  if (!token) return null
  const session = await db.session.findUnique({
    where: { sessionToken: token },
    include: { user: { include: { memberships: true } } },
  })
  if (!session || session.expires < new Date() || !session.user.isActive) return null
  return {
    id: session.user.id,
    globalRole: session.user.globalRole,
    isActive: session.user.isActive,
    memberships: session.user.memberships.map((m) => ({
      channelId: m.channelId,
      channelRole: m.channelRole,
    })),
  }
}
