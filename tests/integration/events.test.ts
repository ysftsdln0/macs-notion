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

const { archiveEvent, createEvent, restoreEvent, updateEvent } = await import('@/server/events')
const { canReadEvent, listEvents } = await import('@/server/events-query')
const { createTask, linkTaskToEvent } = await import('@/server/tasks')

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

const START = new Date('2026-09-10T10:00:00Z')
const END = new Date('2026-09-10T14:00:00Z')

beforeEach(async () => {
  await resetDb()
  admin = await db.user.create({ data: { name: 'Admin', globalRole: 'ADMIN' } })
  lead = await db.user.create({ data: { name: 'Lider' } })
  member = await db.user.create({ data: { name: 'Üye' } })
  outsider = await db.user.create({ data: { name: 'Dışarıdaki' } })

  openChannel = await db.channel.create({
    data: {
      name: 'Etkinlik', slug: 'etkinlik', visibility: 'OPEN', createdById: lead.id,
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

describe('createEvent', () => {
  it('kanal üyesi etkinlik oluşturur', async () => {
    actorRef.current = { id: member.id }
    const r = await createEvent({ title: 'Kongre', channelId: openChannel.id, startsAt: START })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const event = await db.event.findUniqueOrThrow({ where: { id: r.data.id } })
    expect(event.status).toBe('PLANNED')
    expect(event.endsAt).toBeNull()
  })

  it('bitiş başlangıçtan önceyse reddedilir', async () => {
    actorRef.current = { id: member.id }
    const r = await createEvent({
      title: 'Ters', channelId: openChannel.id, startsAt: END, endsAt: START,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('VALIDATION')
      expect(r.error.fields?.endsAt).toBeDefined()
    }
  })

  it('PRIVATE kanalda üye olmayan etkinlik açamaz', async () => {
    actorRef.current = { id: member.id }
    const r = await createEvent({ title: 'Gizli', channelId: privateChannel.id, startsAt: START })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })
})

describe('updateEvent', () => {
  it('yalnızca bitişi güncelleyen istek de kayıtlı başlangıca karşı doğrulanır', async () => {
    actorRef.current = { id: member.id }
    const created = await createEvent({
      title: 'Toplantı', channelId: openChannel.id, startsAt: END,
    })
    if (!created.ok) throw new Error('beklenmedik hata')

    const r = await updateEvent({ id: created.data.id, endsAt: START })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('VALIDATION')
      expect(r.error.fields?.endsAt).toBeDefined()
    }
  })

  it('gönderilmeyen alanları silmez', async () => {
    actorRef.current = { id: member.id }
    const created = await createEvent({
      title: 'Tanıtım', channelId: openChannel.id, startsAt: START, location: 'Kampüs',
    })
    if (!created.ok) throw new Error('beklenmedik hata')

    await updateEvent({ id: created.data.id, status: 'CONFIRMED' })
    const event = await db.event.findUniqueOrThrow({ where: { id: created.data.id } })
    expect(event.title).toBe('Tanıtım')
    expect(event.location).toBe('Kampüs')
    expect(event.status).toBe('CONFIRMED')
  })

  it('kanal dışından biri güncelleyemez', async () => {
    actorRef.current = { id: lead.id }
    const created = await createEvent({
      title: 'Korunan', channelId: privateChannel.id, startsAt: START,
    })
    if (!created.ok) throw new Error('beklenmedik hata')

    actorRef.current = { id: outsider.id }
    const r = await updateEvent({ id: created.data.id, title: 'Ele geçirildi' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })
})

describe('görünürlük ve arşiv', () => {
  it('PRIVATE kanaldaki etkinlik üye olmayana görünmez', async () => {
    actorRef.current = { id: lead.id }
    const created = await createEvent({
      title: 'Gizli görüşme', channelId: privateChannel.id, startsAt: START,
    })
    if (!created.ok) throw new Error('beklenmedik hata')

    expect(await canReadEvent(await actorOf(member.id), created.data.id)).toBe(false)
    expect(await canReadEvent(await actorOf(lead.id), created.data.id)).toBe(true)
    expect(await canReadEvent(await actorOf(admin.id), created.data.id)).toBe(true)
    expect((await listEvents(await actorOf(member.id))).map((e) => e.title)).not.toContain('Gizli görüşme')
  })

  it('LEAD arşivler, düz üye arşivleyemez, admin geri yükler', async () => {
    actorRef.current = { id: lead.id }
    const created = await createEvent({
      title: 'Eski etkinlik', channelId: openChannel.id, startsAt: START,
    })
    if (!created.ok) throw new Error('beklenmedik hata')

    actorRef.current = { id: member.id }
    const denied = await archiveEvent({ id: created.data.id })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN')

    actorRef.current = { id: lead.id }
    expect((await archiveEvent({ id: created.data.id })).ok).toBe(true)
    expect(await canReadEvent(await actorOf(lead.id), created.data.id)).toBe(false)

    actorRef.current = { id: admin.id }
    expect((await restoreEvent({ id: created.data.id })).ok).toBe(true)
    expect(await canReadEvent(await actorOf(lead.id), created.data.id)).toBe(true)
  })

  it('ay aralığı filtresi yalnızca o aydakileri döner', async () => {
    actorRef.current = { id: member.id }
    await createEvent({ title: 'Eylül', channelId: openChannel.id, startsAt: START })
    await createEvent({
      title: 'Ekim', channelId: openChannel.id, startsAt: new Date('2026-10-05T10:00:00Z'),
    })

    const september = await listEvents(await actorOf(member.id), {
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-10-01T00:00:00Z'),
    })
    expect(september.map((e) => e.title)).toEqual(['Eylül'])
  })
})

describe('etkinlik-görev bağlantısı', () => {
  it('görev etkinliğe bağlanır ve etkinlik sahibine bildirim gider', async () => {
    actorRef.current = { id: lead.id }
    const event = await createEvent({
      title: 'Bahar Şenliği', channelId: openChannel.id, startsAt: START,
    })
    if (!event.ok) throw new Error('beklenmedik hata')

    actorRef.current = { id: member.id }
    const task = await createTask({ title: 'Standı kur', channelId: openChannel.id })
    if (!task.ok) throw new Error('beklenmedik hata')

    const linked = await linkTaskToEvent({ id: task.data.id, eventId: event.data.id })
    expect(linked.ok).toBe(true)

    const notification = await db.notification.findFirstOrThrow({
      where: { userId: lead.id, kind: 'event.link' },
    })
    expect(notification.entityId).toBe(event.data.id)
  })

  it('başka kanaldaki etkinliğe bağlanamaz', async () => {
    actorRef.current = { id: lead.id }
    const event = await createEvent({
      title: 'Gizli etkinlik', channelId: privateChannel.id, startsAt: START,
    })
    if (!event.ok) throw new Error('beklenmedik hata')

    actorRef.current = { id: member.id }
    const task = await createTask({ title: 'Açık görev', channelId: openChannel.id })
    if (!task.ok) throw new Error('beklenmedik hata')

    const r = await linkTaskToEvent({ id: task.data.id, eventId: event.data.id })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('VALIDATION')
  })

  it('bağlantı kaldırılabilir', async () => {
    actorRef.current = { id: member.id }
    const event = await createEvent({
      title: 'Kaldırılacak', channelId: openChannel.id, startsAt: START,
    })
    if (!event.ok) throw new Error('beklenmedik hata')
    const task = await createTask({
      title: 'Bağlı görev', channelId: openChannel.id, eventId: event.data.id,
    })
    if (!task.ok) throw new Error('beklenmedik hata')

    expect((await linkTaskToEvent({ id: task.data.id, eventId: null })).ok).toBe(true)
    const updated = await db.task.findUniqueOrThrow({ where: { id: task.data.id } })
    expect(updated.eventId).toBeNull()
  })
})
