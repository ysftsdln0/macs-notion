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

const { globalSearch, searchDocuments } = await import('@/server/search')

let admin: { id: string }
let member: { id: string }
let outsider: { id: string }
let channelId: string
let privateChannelId: string

async function actorOf(id: string) {
  const user = await db.user.findUniqueOrThrow({
    where: { id },
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
  const privateChannel = await db.channel.create({
    data: {
      name: 'Gizli', slug: 'gizli', visibility: 'PRIVATE', createdById: member.id,
      members: { create: { userId: member.id, channelRole: 'LEAD' } },
    },
  })
  privateChannelId = privateChannel.id
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

describe('globalSearch', () => {
  async function seedAllTypes(targetChannelId: string, word: string) {
    // Doküman görünürlüğü BİLEREK CHANNEL: varsayılan PUBLIC, kanal PRIVATE
    // olsa bile kulüp geneline açıktır (policy kararı), o yüzden kanal
    // sızıntısını sınayan test için uygun değil.
    await db.document.create({
      data: {
        title: `${word} dokümanı`, channelId: targetChannelId,
        createdById: member.id, visibility: 'CHANNEL',
      },
    })
    await db.task.create({
      data: { title: `${word} görevi`, channelId: targetChannelId, createdById: member.id },
    })
    await db.event.create({
      data: {
        title: `${word} etkinliği`, channelId: targetChannelId, createdById: member.id,
        startsAt: new Date('2026-12-01T09:00:00Z'),
      },
    })
    await db.sponsor.create({
      data: { name: `${word} sponsoru`, channelId: targetChannelId, createdById: member.id },
    })
  }

  it('dört türü de bulur ve her türden sonuç döndürür', async () => {
    await seedAllTypes(channelId, 'kongre')
    const hits = await globalSearch('kongre', await actorOf(member.id))

    expect(new Set(hits.map((h) => h.type))).toEqual(
      new Set(['document', 'task', 'event', 'sponsor']),
    )
    expect(hits.every((h) => h.subtitle === 'Sponsorluk')).toBe(true)
  })

  it('görev/etkinlik/sponsor gövde metninden de bulunur', async () => {
    await db.task.create({
      data: {
        title: 'Adsız görev', notes: 'Otobüs kiralama teklifi alınacak',
        channelId, createdById: member.id,
      },
    })
    const hits = await globalSearch('otobüs', await actorOf(member.id))
    expect(hits.map((h) => h.type)).toEqual(['task'])
  })

  it('PRIVATE kanaldaki içerik üye olmayanın sonuçlarında çıkmaz', async () => {
    await seedAllTypes(privateChannelId, 'gizlikelime')

    expect(await globalSearch('gizlikelime', await actorOf(outsider.id))).toEqual([])
    expect(await globalSearch('gizlikelime', await actorOf(member.id))).toHaveLength(4)
    expect(await globalSearch('gizlikelime', await actorOf(admin.id))).toHaveLength(4)
  })

  it('arşivlenmiş kayıtlar sonuçlara girmez', async () => {
    await db.task.create({
      data: {
        title: 'Eski afiş görevi', channelId, createdById: member.id, archivedAt: new Date(),
      },
    })
    await db.sponsor.create({
      data: {
        name: 'Eski afiş sponsoru', channelId, createdById: member.id, archivedAt: new Date(),
      },
    })
    expect(await globalSearch('afiş', await actorOf(member.id))).toEqual([])
  })

  it('arşivlenmiş kanalın içeriği sonuçlara girmez', async () => {
    const archived = await db.channel.create({
      data: {
        name: 'Kapanmış', slug: 'kapanmis', createdById: member.id,
        archivedAt: new Date(),
        members: { create: { userId: member.id, channelRole: 'LEAD' } },
      },
    })
    await db.event.create({
      data: {
        title: 'Kapanmış kanal etkinliği', channelId: archived.id, createdById: member.id,
        startsAt: new Date('2026-12-01T09:00:00Z'),
      },
    })
    expect(await globalSearch('kapanmış', await actorOf(member.id))).toEqual([])
  })

  it('boş sorgu ve sonuçsuz sorgu boş liste döner', async () => {
    await seedAllTypes(channelId, 'kongre')
    expect(await globalSearch('   ', await actorOf(member.id))).toEqual([])
    expect(await globalSearch('kesinlikleyokboylebirkelime', await actorOf(member.id))).toEqual([])
  })

  it('limit aşıldığında her türden sonuç kalır — tek tablo listeyi doldurmaz', async () => {
    for (let i = 0; i < 10; i += 1) {
      await db.document.create({
        data: { title: `Ortak kelime dokümanı ${i}`, channelId, createdById: member.id },
      })
    }
    await db.sponsor.create({
      data: { name: 'Ortak kelime sponsoru', channelId, createdById: member.id },
    })

    const hits = await globalSearch('ortak kelime', await actorOf(member.id), 5)
    expect(hits).toHaveLength(5)
    expect(hits.map((h) => h.type)).toContain('sponsor')
  })
})
