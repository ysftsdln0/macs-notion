import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { toActor } from '@/lib/auth/session'

beforeEach(async () => {
  await db.channelMember.deleteMany()
  await db.channel.deleteMany()
  await db.user.deleteMany()
})

describe('toActor', () => {
  it('kullanıcı ve üyeliklerinden Actor üretir', async () => {
    const user = await db.user.create({
      data: { name: 'Efe', globalRole: 'ADMIN' },
    })
    const channel = await db.channel.create({
      data: { name: 'Proje', slug: 'proje', createdById: user.id },
    })
    await db.channelMember.create({
      data: { userId: user.id, channelId: channel.id, channelRole: 'LEAD' },
    })

    const loaded = await db.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { memberships: true },
    })

    expect(toActor(loaded)).toEqual({
      id: user.id,
      globalRole: 'ADMIN',
      isActive: true,
      memberships: [{ channelId: channel.id, channelRole: 'LEAD' }],
    })
  })
})
