import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/reset-db'

const actorRef: { current: { id: string } | null } = { current: null }

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

const { searchDocuments } = await import('@/server/search')

let admin: { id: string }
let member: { id: string }
let outsider: { id: string }
let channelId: string

async function actorOf(id: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id }, include: { memberships: true } })
  return {
    id: user.id, globalRole: user.globalRole, isActive: user.isActive,
    memberships: user.memberships.map((m) => ({ channelId: m.channelId, channelRole: m.channelRole })),
  }
}

beforeEach(async () => {
  await resetDb()
  admin = await db.user.create({ data: { name: 'Admin', globalRole: 'ADMIN' } })
  member = await db.user.create({ data: { name: 'Üye' } })
  outsider = await db.user.create({ data: { name: 'Dışarıdaki' } })
  const channel = await db.channel.create({
    data: {
      name: 'Sponsorluk', slug: 'sponsorluk', createdById: member.id,
      members: { create: { userId: member.id, channelRole: 'LEAD' } },
    },
  })
  channelId = channel.id
})

describe('searchDocuments', () => {
  it('başlıktan bulur', async () => {
    await db.document.create({
      data: { title: 'Kongre bütçe planı', channelId, createdById: member.id },
    })
    const hits = await searchDocuments('kongre', await actorOf(member.id))
    expect(hits.map((h) => h.title)).toEqual(['Kongre bütçe planı'])
    expect(hits[0]?.channelName).toBe('Sponsorluk')
  })

  it('gövde metninden (searchText) bulur — tsvector kolonu gerçekten dolduruluyor', async () => {
    await db.document.create({
      data: {
        title: 'Adsız', channelId, createdById: member.id,
        searchText: 'Ulaşım için otobüs kiralanacak',
      },
    })
    const hits = await searchDocuments('otobüs', await actorOf(member.id))
    expect(hits).toHaveLength(1)
  })

  it('PRIVATE doküman başkasının aramasında çıkmaz, sahibinde çıkar', async () => {
    await db.document.create({
      data: {
        title: 'Gizli sponsor görüşmesi', channelId,
        createdById: member.id, visibility: 'PRIVATE',
      },
    })
    expect(await searchDocuments('sponsor', await actorOf(outsider.id))).toEqual([])
    expect(await searchDocuments('sponsor', await actorOf(member.id))).toHaveLength(1)
    expect(await searchDocuments('sponsor', await actorOf(admin.id))).toHaveLength(1)
  })

  it('CHANNEL doküman yalnızca kanal üyesinin aramasında çıkar', async () => {
    await db.document.create({
      data: {
        title: 'Kanal içi toplantı notu', channelId,
        createdById: member.id, visibility: 'CHANNEL',
      },
    })
    expect(await searchDocuments('toplantı', await actorOf(outsider.id))).toEqual([])
    expect(await searchDocuments('toplantı', await actorOf(member.id))).toHaveLength(1)
  })

  it('arşivlenmiş doküman sonuçlarda çıkmaz', async () => {
    await db.document.create({
      data: {
        title: 'Eski afiş çalışması', channelId,
        createdById: member.id, archivedAt: new Date(),
      },
    })
    expect(await searchDocuments('afiş', await actorOf(member.id))).toEqual([])
  })

  it('boş sorgu ve sonuçsuz sorgu boş liste döner', async () => {
    await db.document.create({
      data: { title: 'Bir şey', channelId, createdById: member.id },
    })
    expect(await searchDocuments('   ', await actorOf(member.id))).toEqual([])
    expect(await searchDocuments('kesinlikleyokboylebirkelime', await actorOf(member.id))).toEqual([])
  })

  it('tek tırnak gibi karakterler sorguyu kırmaz', async () => {
    await db.document.create({
      data: { title: "Bütçe'nin özeti", channelId, createdById: member.id },
    })
    const hits = await searchDocuments("bütçe'nin", await actorOf(member.id))
    expect(hits).toHaveLength(1)
  })
})
