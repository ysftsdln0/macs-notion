import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/reset-db'

const actorRef: { current: string | null } = { current: null }
vi.mock('@/lib/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/session')>()),
  getActor: async () => {
    if (!actorRef.current) return null
    const user = await db.user.findUniqueOrThrow({
      where: { id: actorRef.current },
      include: {
        memberships: true,
        roles: { select: { role: { select: { permissions: true } } } },
      },
    })
    return {
      id: user.id, globalRole: user.globalRole, isActive: user.isActive,
      memberships: user.memberships.map((m) => ({ channelId: m.channelId, channelRole: m.channelRole })),
      permissions: [...new Set(user.roles.flatMap((r) => r.role.permissions))],
    }
  },
}))

const { listVisibleChannels } = await import('@/server/channels-query')
const { budgetChannelIds } = await import('@/server/budget-query')
const { getActor } = await import('@/lib/auth/session')

let boardMember: { id: string }
let plainMember: { id: string }
let boardChannelId: string

beforeEach(async () => {
  await resetDb()
  const owner = await db.user.create({ data: { name: 'Sahip', globalRole: 'SUPERADMIN' } })
  const role = await db.role.create({
    data: {
      name: 'Yönetim Kurulu', slug: 'yonetim-kurulu', position: 1, isSystem: true,
      permissions: ['CONTENT_READ_ALL', 'CONTENT_WRITE_ALL', 'BUDGET_READ_ALL'],
    },
  })
  boardMember = await db.user.create({ data: { name: 'YK Üyesi' } })
  await db.userRole.create({ data: { userId: boardMember.id, roleId: role.id } })
  plainMember = await db.user.create({ data: { name: 'Düz Üye' } })

  const channel = await db.channel.create({
    data: {
      name: 'Yönetim Kurulu', slug: 'yonetim-kurulu-kanali',
      visibility: 'PRIVATE', createdById: owner.id,
    },
  })
  boardChannelId = channel.id
})

describe('yönetime özel kanal', () => {
  it('YK rolü olan kanalı üye olmadan görür', async () => {
    actorRef.current = boardMember.id
    const channels = await listVisibleChannels()
    expect(channels.map((c) => c.id)).toContain(boardChannelId)
  })

  it('düz üye kanalı hiç görmez', async () => {
    actorRef.current = plainMember.id
    const channels = await listVisibleChannels()
    expect(channels).toEqual([])
  })
})

describe('bütçe kapsamı', () => {
  it('BUDGET_READ_ALL taşıyan tüm bütçeyi görür', async () => {
    actorRef.current = boardMember.id
    const actor = await getActor()
    expect(actor && budgetChannelIds(actor)).toBe('all')
  })

  it('izinsiz üye hiçbir kanalın bütçesini görmez', async () => {
    actorRef.current = plainMember.id
    const actor = await getActor()
    expect(actor && budgetChannelIds(actor)).toEqual([])
  })
})
