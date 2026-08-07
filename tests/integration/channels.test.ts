import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'

const actorRef: { current: { id: string; globalRole: 'ADMIN' | 'MEMBER' } | null } = { current: null }

vi.mock('@/lib/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/session')>()),
  getActor: async () => {
    if (!actorRef.current) return null
    const user = await db.user.findUniqueOrThrow({
      where: { id: actorRef.current.id },
      include: { memberships: true },
    })
    return {
      id: user.id, globalRole: user.globalRole, isActive: user.isActive,
      memberships: user.memberships.map((m) => ({ channelId: m.channelId, channelRole: m.channelRole })),
    }
  },
}))

const { addChannelMember, createChannel, listVisibleChannels } = await import('@/server/channels')

let admin: { id: string }
let plain: { id: string }

beforeEach(async () => {
  await db.activity.deleteMany()
  await db.channelMember.deleteMany()
  await db.channel.deleteMany()
  await db.user.deleteMany()
  admin = await db.user.create({ data: { name: 'Admin', globalRole: 'ADMIN' } })
  plain = await db.user.create({ data: { name: 'Üye' } })
})

describe('createChannel', () => {
  it('admin kanal açar ve slug üretilir', async () => {
    actorRef.current = { id: admin.id, globalRole: 'ADMIN' }
    const r = await createChannel({ name: 'Proje Koordinatörlüğü', visibility: 'OPEN' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.slug).toBe('proje-koordinatorlugu')
  })

  it('aynı isimde ikinci kanalda slug çakışmaz', async () => {
    actorRef.current = { id: admin.id, globalRole: 'ADMIN' }
    await createChannel({ name: 'Medya', visibility: 'OPEN' })
    const second = await createChannel({ name: 'Medya', visibility: 'OPEN' })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.data.slug).toBe('medya-2')
  })

  it('kanalı açan kişi otomatik LEAD olur', async () => {
    actorRef.current = { id: admin.id, globalRole: 'ADMIN' }
    const r = await createChannel({ name: 'Tasarım', visibility: 'OPEN' })
    if (!r.ok) throw new Error('beklenmedik hata')
    const member = await db.channelMember.findUniqueOrThrow({
      where: { channelId_userId: { channelId: r.data.id, userId: admin.id } },
    })
    expect(member.channelRole).toBe('LEAD')
  })

  it('düz üye kanal açamaz', async () => {
    actorRef.current = { id: plain.id, globalRole: 'MEMBER' }
    const r = await createChannel({ name: 'Yasak', visibility: 'OPEN' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })
})

describe('addChannelMember', () => {
  it('kanal dışından biri üye ekleyemez', async () => {
    actorRef.current = { id: admin.id, globalRole: 'ADMIN' }
    const created = await createChannel({ name: 'Sponsorluk', visibility: 'PRIVATE' })
    if (!created.ok) throw new Error('beklenmedik hata')

    actorRef.current = { id: plain.id, globalRole: 'MEMBER' }
    const r = await addChannelMember({
      channelId: created.data.id, userId: plain.id, channelRole: 'MEMBER',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })
})

describe('listVisibleChannels', () => {
  it('PRIVATE kanal üye olmayana görünmez, OPEN görünür', async () => {
    actorRef.current = { id: admin.id, globalRole: 'ADMIN' }
    await createChannel({ name: 'Herkese Açık', visibility: 'OPEN' })
    await createChannel({ name: 'Gizli', visibility: 'PRIVATE' })

    const forPlain = await listVisibleChannels({
      id: plain.id, globalRole: 'MEMBER', isActive: true, memberships: [],
    })
    expect(forPlain.map((c) => c.name)).toEqual(['Herkese Açık'])
  })
})
