import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth/config'
import { db } from '@/lib/db'
import { flattenPermissions, type Actor, type ChannelRole, type GlobalRole, type Permission } from '@/lib/auth/policy'

type UserWithRoles = {
  id: string
  globalRole: GlobalRole
  isActive: boolean
  memberships: { channelId: string; channelRole: ChannelRole }[]
  roles: { role: { permissions: Permission[] } }[]
}

export function toActor(user: UserWithRoles): Actor {
  return {
    id: user.id,
    globalRole: user.globalRole,
    isActive: user.isActive,
    memberships: user.memberships.map((m) => ({
      channelId: m.channelId,
      channelRole: m.channelRole,
    })),
    permissions: flattenPermissions(user.roles),
  }
}

export async function getActor(): Promise<Actor | null> {
  const session = await auth()
  if (!session?.user?.id) return null
  // İzinler token'da DEĞİL, her istekte veritabanından okunur: geri alınan
  // bir rol anında etkisini gösterir, oturum ömrü boyunca geçerli kalmaz.
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: {
      memberships: true,
      roles: { select: { role: { select: { permissions: true } } } },
    },
  })
  if (!user || !user.isActive) return null
  return toActor(user)
}

export async function requireActor(): Promise<Actor> {
  const actor = await getActor()
  if (!actor) redirect('/login')
  return actor
}
