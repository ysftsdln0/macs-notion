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

const {
  archiveSponsor, createSponsor, moveSponsor, restoreSponsor, updateSponsor,
} = await import('@/server/sponsors')
const { canReadSponsor, listSponsors } = await import('@/server/sponsors-query')
const { createEvent } = await import('@/server/events')

let admin: { id: string }
let lead: { id: string }
let member: { id: string }
let outsider: { id: string }
let openChannel: { id: string }
let privateChannel: { id: string }

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
  lead = await db.user.create({ data: { name: 'Lider' } })
  member = await db.user.create({ data: { name: 'Üye' } })
  outsider = await db.user.create({ data: { name: 'Dışarıdaki' } })

  openChannel = await db.channel.create({
    data: {
      name: 'Sponsorluk', slug: 'sponsorluk', visibility: 'OPEN', createdById: lead.id,
      members: {
        create: [
          { userId: lead.id, channelRole: 'LEAD' },
          { userId: member.id, channelRole: 'MEMBER' },
        ],
      },
    },
  })
  privateChannel = await db.channel.create({
    data: {
      name: 'Gizli', slug: 'gizli', visibility: 'PRIVATE', createdById: lead.id,
      members: { create: { userId: lead.id, channelRole: 'LEAD' } },
    },
  })
})

describe('createSponsor', () => {
  it('kanal üyesi sponsor ekler; varsayılanlar yerinde', async () => {
    actorRef.current = { id: member.id }
    const r = await createSponsor({ name: 'ACME', channelId: openChannel.id })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const sponsor = await db.sponsor.findUniqueOrThrow({ where: { id: r.data.id } })
    expect(sponsor.status).toBe('PROSPECT')
    expect(sponsor.currency).toBe('TRY')
    expect(sponsor.amount).toBeNull()
  })

  it('tutar Decimal olarak kuruşuna kadar saklanır', async () => {
    actorRef.current = { id: member.id }
    const r = await createSponsor({
      name: 'Kuruşlu', channelId: openChannel.id, amount: '12345.67',
    })
    if (!r.ok) throw new Error('beklenmedik hata')
    const sponsor = await db.sponsor.findUniqueOrThrow({ where: { id: r.data.id } })
    expect(sponsor.amount?.toString()).toBe('12345.67')
  })

  it('virgüllü tutar da kabul edilir', async () => {
    actorRef.current = { id: member.id }
    const r = await createSponsor({
      name: 'Virgül', channelId: openChannel.id, amount: '1500,50',
    })
    if (!r.ok) throw new Error('beklenmedik hata')
    const sponsor = await db.sponsor.findUniqueOrThrow({ where: { id: r.data.id } })
    expect(sponsor.amount?.toString()).toBe('1500.5')
  })

  it('negatif, sıfır ve üç ondalıklı tutar reddedilir', async () => {
    actorRef.current = { id: member.id }
    for (const amount of ['-100', '0', '10.005', 'abc']) {
      const r = await createSponsor({ name: `Hatalı ${amount}`, channelId: openChannel.id, amount })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('VALIDATION')
    }
  })

  it('geçersiz e-posta reddedilir', async () => {
    actorRef.current = { id: member.id }
    const r = await createSponsor({
      name: 'Postasız', channelId: openChannel.id, contactEmail: 'bu-bir-eposta-degil',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('VALIDATION')
  })

  it('PRIVATE kanalda üye olmayan sponsor ekleyemez', async () => {
    actorRef.current = { id: member.id }
    const r = await createSponsor({ name: 'Sızıntı', channelId: privateChannel.id })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  it('başka kanaldaki etkinliğe bağlanamaz', async () => {
    actorRef.current = { id: lead.id }
    const event = await createEvent({
      title: 'Gizli etkinlik', channelId: privateChannel.id, startsAt: new Date('2026-10-01T09:00:00Z'),
    })
    if (!event.ok) throw new Error('beklenmedik hata')

    actorRef.current = { id: member.id }
    const r = await createSponsor({
      name: 'Bağlantı', channelId: openChannel.id, eventId: event.data.id,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('VALIDATION')
  })
})

describe('updateSponsor / moveSponsor', () => {
  it('durum board hareketiyle değişir', async () => {
    actorRef.current = { id: member.id }
    const created = await createSponsor({ name: 'Taşınan', channelId: openChannel.id })
    if (!created.ok) throw new Error('beklenmedik hata')

    const r = await moveSponsor({ id: created.data.id, status: 'NEGOTIATING' })
    expect(r.ok).toBe(true)
    const sponsor = await db.sponsor.findUniqueOrThrow({ where: { id: created.data.id } })
    expect(sponsor.status).toBe('NEGOTIATING')
  })

  it('gönderilmeyen alanlar korunur', async () => {
    actorRef.current = { id: member.id }
    const created = await createSponsor({
      name: 'Korunan', channelId: openChannel.id, contactName: 'Ali', amount: '500.00',
    })
    if (!created.ok) throw new Error('beklenmedik hata')

    await updateSponsor({ id: created.data.id, status: 'SIGNED' })
    const sponsor = await db.sponsor.findUniqueOrThrow({ where: { id: created.data.id } })
    expect(sponsor.contactName).toBe('Ali')
    expect(sponsor.amount?.toString()).toBe('500')
    expect(sponsor.status).toBe('SIGNED')
  })

  it('tutar açıkça null verilerek silinebilir', async () => {
    actorRef.current = { id: member.id }
    const created = await createSponsor({
      name: 'Silinen tutar', channelId: openChannel.id, amount: '500.00',
    })
    if (!created.ok) throw new Error('beklenmedik hata')

    await updateSponsor({ id: created.data.id, amount: null })
    const sponsor = await db.sponsor.findUniqueOrThrow({ where: { id: created.data.id } })
    expect(sponsor.amount).toBeNull()
  })

  it('kanal dışından biri güncelleyemez', async () => {
    actorRef.current = { id: lead.id }
    const created = await createSponsor({ name: 'Gizli sponsor', channelId: privateChannel.id })
    if (!created.ok) throw new Error('beklenmedik hata')

    actorRef.current = { id: outsider.id }
    const r = await updateSponsor({ id: created.data.id, status: 'SIGNED' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })
})

describe('görünürlük ve arşiv', () => {
  it('PRIVATE kanaldaki sponsor üye olmayana görünmez', async () => {
    actorRef.current = { id: lead.id }
    const created = await createSponsor({ name: 'Gizli kurum', channelId: privateChannel.id })
    if (!created.ok) throw new Error('beklenmedik hata')

    expect(await canReadSponsor(await actorOf(member.id), created.data.id)).toBe(false)
    expect(await canReadSponsor(await actorOf(lead.id), created.data.id)).toBe(true)
    expect(await canReadSponsor(await actorOf(admin.id), created.data.id)).toBe(true)
    expect((await listSponsors(await actorOf(member.id))).map((s) => s.name)).not.toContain('Gizli kurum')
  })

  it('LEAD arşivler, düz üye başkasının kaydını arşivleyemez, admin geri yükler', async () => {
    actorRef.current = { id: lead.id }
    const created = await createSponsor({ name: 'Eski kurum', channelId: openChannel.id })
    if (!created.ok) throw new Error('beklenmedik hata')

    actorRef.current = { id: member.id }
    const denied = await archiveSponsor({ id: created.data.id })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN')

    actorRef.current = { id: lead.id }
    expect((await archiveSponsor({ id: created.data.id })).ok).toBe(true)
    expect((await listSponsors(await actorOf(lead.id))).map((s) => s.name)).not.toContain('Eski kurum')

    actorRef.current = { id: admin.id }
    expect((await restoreSponsor({ id: created.data.id })).ok).toBe(true)
    expect((await listSponsors(await actorOf(lead.id))).map((s) => s.name)).toContain('Eski kurum')
  })

  it('arşivlenmiş sponsor güncellenemez', async () => {
    actorRef.current = { id: lead.id }
    const created = await createSponsor({ name: 'Arşivli', channelId: openChannel.id })
    if (!created.ok) throw new Error('beklenmedik hata')
    await archiveSponsor({ id: created.data.id })

    const r = await updateSponsor({ id: created.data.id, status: 'SIGNED' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND')
  })

  it('tutar listede dize olarak döner — Decimal istemciye geçmez', async () => {
    actorRef.current = { id: member.id }
    await createSponsor({ name: 'Dizeli', channelId: openChannel.id, amount: '999.99' })
    const list = await listSponsors(await actorOf(member.id))
    expect(typeof list[0]?.amount).toBe('string')
    expect(list[0]?.amount).toBe('999.99')
  })
})
