import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth/config'
import { db } from '@/lib/db'
import type { Actor } from '@/lib/auth/policy'

type UserWithMemberships = {
  id: string
  globalRole: 'ADMIN' | 'MEMBER'
  isActive: boolean
  memberships: { channelId: string; channelRole: 'LEAD' | 'MEMBER' }[]
}

export function toActor(user: UserWithMemberships): Actor {
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

export async function getActor(): Promise<Actor | null> {
  const session = await auth()
  if (!session?.user?.id) return null
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: { memberships: true },
  })
  if (!user || !user.isActive) return null
  return toActor(user)
}

export async function requireActor(): Promise<Actor> {
  const actor = await getActor()
  if (!actor) redirect('/login')
  return actor
}
