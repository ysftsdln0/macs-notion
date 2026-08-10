import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/reset-db'

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

const { addChannelMember, createChannel, removeChannelMember } = await import('@/server/channels')
const { listVisibleChannels } = await import('@/server/channels-query')

let admin: { id: string }
let plain: { id: string }

beforeEach(async () => {
  await resetDb()
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

  it('bir kanalda LEAD olan düz kullanıcı yeni kanal açabilir', async () => {
    actorRef.current = { id: admin.id, globalRole: 'ADMIN' }
    const first = await createChannel({ name: 'Ana Kanal', visibility: 'OPEN' })
    if (!first.ok) throw new Error('beklenmedik hata')
    const promoted = await addChannelMember({
      channelId: first.data.id, userId: plain.id, channelRole: 'LEAD',
    })
    expect(promoted.ok).toBe(true)

    actorRef.current = { id: plain.id, globalRole: 'MEMBER' }
    const r = await createChannel({ name: 'İkinci Kanal', visibility: 'OPEN' })
    expect(r.ok).toBe(true)
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

  it('kanal üyesi ama LEAD olmayan biri başkasını ekleyemez', async () => {
    actorRef.current = { id: admin.id, globalRole: 'ADMIN' }
    const created = await createChannel({ name: 'Dernek', visibility: 'PRIVATE' })
    if (!created.ok) throw new Error('beklenmedik hata')
    const addPlain = await addChannelMember({
      channelId: created.data.id, userId: plain.id, channelRole: 'MEMBER',
    })
    if (!addPlain.ok) throw new Error('beklenmedik hata')

    const outsider = await db.user.create({ data: { name: 'Yeni' } })
    actorRef.current = { id: plain.id, globalRole: 'MEMBER' }
    const r = await addChannelMember({
      channelId: created.data.id, userId: outsider.id, channelRole: 'MEMBER',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  // M21 regresyon testi: addChannelMember, eklenecek userId'nin gerçekten
  // var olduğunu hiç kontrol etmiyordu — upsert'in FK kısıtına (P2003)
  // çarpıp defineAction'ın genel catch-all'ında opak bir INTERNAL'a
  // dönüşüyordu. Üye ekleme artık UI'dan erişilebilir (a1a7bc5, üye seçici
  // formu), bu yüzden bugün canlı: forged bir userId veya silinen/asla var
  // olmamış bir cuid ile POST edilen bir form aynı sonucu üretirdi.
  it('var olmayan bir kullanıcı kanala eklenemez', async () => {
    actorRef.current = { id: admin.id, globalRole: 'ADMIN' }
    const created = await createChannel({ name: 'Hayalet', visibility: 'OPEN' })
    if (!created.ok) throw new Error('beklenmedik hata')

    const r = await addChannelMember({
      channelId: created.data.id, userId: 'cnonexistentuser000000', channelRole: 'MEMBER',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND')
  })

  it('kanalın son liderini MEMBER\'a düşürmek reddedilir', async () => {
    actorRef.current = { id: admin.id, globalRole: 'ADMIN' }
    const created = await createChannel({ name: 'Tek Lider', visibility: 'OPEN' })
    if (!created.ok) throw new Error('beklenmedik hata')

    const r = await addChannelMember({
      channelId: created.data.id, userId: admin.id, channelRole: 'MEMBER',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('CONFLICT')
  })
})

describe('removeChannelMember', () => {
  it('LEAD bir üyeyi kanaldan çıkarabilir', async () => {
    actorRef.current = { id: admin.id, globalRole: 'ADMIN' }
    const created = await createChannel({ name: 'Etkinlik', visibility: 'OPEN' })
    if (!created.ok) throw new Error('beklenmedik hata')
    const added = await addChannelMember({
      channelId: created.data.id, userId: plain.id, channelRole: 'MEMBER',
    })
    if (!added.ok) throw new Error('beklenmedik hata')

    const r = await removeChannelMember({ channelId: created.data.id, userId: plain.id })
    expect(r.ok).toBe(true)
  })

  it('düz üye başka birini kanaldan çıkaramaz', async () => {
    actorRef.current = { id: admin.id, globalRole: 'ADMIN' }
    const created = await createChannel({ name: 'Etkinlik 2', visibility: 'OPEN' })
    if (!created.ok) throw new Error('beklenmedik hata')
    const other = await db.user.create({ data: { name: 'Diğer' } })
    await addChannelMember({ channelId: created.data.id, userId: plain.id, channelRole: 'MEMBER' })
    await addChannelMember({ channelId: created.data.id, userId: other.id, channelRole: 'MEMBER' })

    actorRef.current = { id: plain.id, globalRole: 'MEMBER' }
    const r = await removeChannelMember({ channelId: created.data.id, userId: other.id })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  it('kanalın son liderini çıkarmak reddedilir (admin de dahil)', async () => {
    actorRef.current = { id: admin.id, globalRole: 'ADMIN' }
    const created = await createChannel({ name: 'Tek Lider 2', visibility: 'OPEN' })
    if (!created.ok) throw new Error('beklenmedik hata')

    const r = await removeChannelMember({ channelId: created.data.id, userId: admin.id })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('CONFLICT')
  })

  it('iki eş zamanlı istek aynı iki-LEAD\'li kanalın farklı LEAD\'lerini çıkarmaya çalışırsa yalnızca biri başarılı olur', async () => {
    actorRef.current = { id: admin.id, globalRole: 'ADMIN' }
    const created = await createChannel({ name: 'Çift Lider', visibility: 'OPEN' })
    if (!created.ok) throw new Error('beklenmedik hata')
    const promoted = await addChannelMember({
      channelId: created.data.id, userId: plain.id, channelRole: 'LEAD',
    })
    if (!promoted.ok) throw new Error('beklenmedik hata')

    // Aktör her iki çağrı için de admin (global ADMIN, üyelikten bağımsız
    // yetkili) — testin kendi mock'u tek bir paylaşılan actorRef kullanıyor,
    // Promise.all ile eş zamanlı iki farklı aktör simüle edilemez. Yarış,
    // gerçek hedef (userId) farklılığında: admin'in kendisini ve plain'i aynı
    // anda kanalın son iki LEAD'inden çıkarmaya çalışması.
    const [r1, r2] = await Promise.all([
      removeChannelMember({ channelId: created.data.id, userId: admin.id }),
      removeChannelMember({ channelId: created.data.id, userId: plain.id }),
    ])

    const successCount = [r1, r2].filter((r) => r.ok).length
    expect(successCount).toBe(1)
    const failedResult = r1.ok ? r2 : r1
    expect(failedResult.ok).toBe(false)
    if (!failedResult.ok) expect(failedResult.error.code).toBe('CONFLICT')

    const remainingLeads = await db.channelMember.count({
      where: { channelId: created.data.id, channelRole: 'LEAD' },
    })
    expect(remainingLeads).toBeGreaterThanOrEqual(1)
    expect(remainingLeads).toBe(1)
  })
})

describe('listVisibleChannels', () => {
  it('PRIVATE kanal üye olmayana görünmez, OPEN görünür', async () => {
    actorRef.current = { id: admin.id, globalRole: 'ADMIN' }
    await createChannel({ name: 'Herkese Açık', visibility: 'OPEN' })
    await createChannel({ name: 'Gizli', visibility: 'PRIVATE' })

    actorRef.current = { id: plain.id, globalRole: 'MEMBER' }
    const forPlain = await listVisibleChannels()
    expect(forPlain.map((c) => c.name)).toEqual(['Herkese Açık'])
  })

  it('üye olduğu PRIVATE kanalı görür', async () => {
    actorRef.current = { id: admin.id, globalRole: 'ADMIN' }
    const created = await createChannel({ name: 'Özel Kulüp', visibility: 'PRIVATE' })
    if (!created.ok) throw new Error('beklenmedik hata')
    const added = await addChannelMember({
      channelId: created.data.id, userId: plain.id, channelRole: 'MEMBER',
    })
    if (!added.ok) throw new Error('beklenmedik hata')

    actorRef.current = { id: plain.id, globalRole: 'MEMBER' }
    const forPlain = await listVisibleChannels()
    expect(forPlain.map((c) => c.name)).toContain('Özel Kulüp')
  })

  it('admin tüm PRIVATE kanalları görür', async () => {
    actorRef.current = { id: admin.id, globalRole: 'ADMIN' }
    await createChannel({ name: 'Gizli 2', visibility: 'PRIVATE' })
    await createChannel({ name: 'Gizli 3', visibility: 'PRIVATE' })

    const forAdmin = await listVisibleChannels()
    expect(forAdmin.map((c) => c.name)).toEqual(expect.arrayContaining(['Gizli 2', 'Gizli 3']))
  })

  it('oturum yoksa boş liste döner', async () => {
    actorRef.current = null
    const forNobody = await listVisibleChannels()
    expect(forNobody).toEqual([])
  })
})
