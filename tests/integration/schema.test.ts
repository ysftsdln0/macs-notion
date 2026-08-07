import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'

beforeEach(async () => {
  await db.activity.deleteMany()
  await db.channelMember.deleteMany()
  await db.invite.deleteMany()
  await db.channel.deleteMany()
  await db.user.deleteMany()
})

describe('şema', () => {
  it('kullanıcıyı kanala üye yapar ve rolünü saklar', async () => {
    const user = await db.user.create({ data: { name: 'Efe' } })
    const channel = await db.channel.create({
      data: { name: 'Sponsorluk', slug: 'sponsorluk', createdById: user.id },
    })
    await db.channelMember.create({
      data: { userId: user.id, channelId: channel.id, channelRole: 'LEAD' },
    })

    const loaded = await db.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { memberships: true },
    })

    expect(loaded.globalRole).toBe('MEMBER')
    expect(loaded.isActive).toBe(true)
    expect(loaded.memberships[0]?.channelRole).toBe('LEAD')
    expect(channel.visibility).toBe('OPEN')
  })

  it('aynı kullanıcıyı aynı kanala iki kez ekleyemez', async () => {
    const user = await db.user.create({ data: { name: 'Efe' } })
    const channel = await db.channel.create({
      data: { name: 'Medya', slug: 'medya', createdById: user.id },
    })
    await db.channelMember.create({ data: { userId: user.id, channelId: channel.id } })

    await expect(
      db.channelMember.create({ data: { userId: user.id, channelId: channel.id } }),
    ).rejects.toThrow()
  })
})
