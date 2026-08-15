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

const { createTask, linkTaskToEvent, setAssignees } = await import('@/server/tasks')
const { createEvent } = await import('@/server/events')
const { markNotificationsRead } = await import('@/server/notifications')
const {
  countUnreadNotifications, listNotifications,
} = await import('@/server/notifications-query')

let lead: { id: string }
let member: { id: string }
let channelId: string

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
  lead = await db.user.create({ data: { name: 'Lider' } })
  member = await db.user.create({ data: { name: 'Üye' } })
  const channel = await db.channel.create({
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
  channelId = channel.id
})

describe('bildirimler', () => {
  it('atama bildirimi okunmamış gelir ve varlığın başlığını taşır', async () => {
    actorRef.current = { id: lead.id }
    const task = await createTask({
      title: 'Afiş tasarla', channelId, assigneeIds: [member.id],
    })
    if (!task.ok) throw new Error('beklenmedik hata')

    const list = await listNotifications(await actorOf(member.id))
    expect(list).toHaveLength(1)
    expect(list[0]?.kind).toBe('task.assigned')
    expect(list[0]?.readAt).toBeNull()
    expect(list[0]?.entityTitle).toBe('Afiş tasarla')
    expect(list[0]?.actor.name).toBe('Lider')
    expect(await countUnreadNotifications(await actorOf(member.id))).toBe(1)
  })

  it('markNotificationsRead tümünü işaretler', async () => {
    actorRef.current = { id: lead.id }
    const first = await createTask({ title: 'Bir', channelId, assigneeIds: [member.id] })
    const second = await createTask({ title: 'İki', channelId, assigneeIds: [member.id] })
    if (!first.ok || !second.ok) throw new Error('beklenmedik hata')

    actorRef.current = { id: member.id }
    const r = await markNotificationsRead({})
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.count).toBe(2)
    expect(await countUnreadNotifications(await actorOf(member.id))).toBe(0)
  })

  it('tek bildirim okundu işaretlenebilir', async () => {
    actorRef.current = { id: lead.id }
    const first = await createTask({ title: 'Bir', channelId, assigneeIds: [member.id] })
    await createTask({ title: 'İki', channelId, assigneeIds: [member.id] })
    if (!first.ok) throw new Error('beklenmedik hata')

    const notifications = await listNotifications(await actorOf(member.id))
    const target = notifications.find((n) => n.entityTitle === 'Bir')
    if (!target) throw new Error('bildirim bulunamadı')

    actorRef.current = { id: member.id }
    await markNotificationsRead({ ids: [target.id] })
    expect(await countUnreadNotifications(await actorOf(member.id))).toBe(1)
  })

  it('başkasının bildirimi okundu işaretlenemez', async () => {
    actorRef.current = { id: member.id }
    const task = await createTask({ title: 'Ters', channelId, assigneeIds: [lead.id] })
    if (!task.ok) throw new Error('beklenmedik hata')

    const leadNotifications = await listNotifications(await actorOf(lead.id))
    const id = leadNotifications[0]?.id
    if (!id) throw new Error('bildirim bulunamadı')

    // member, lead'in bildirimini işaretlemeye çalışır: hiçbir satır
    // güncellenmez, bildirim okunmamış kalır.
    const r = await markNotificationsRead({ ids: [id] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.count).toBe(0)
    expect(await countUnreadNotifications(await actorOf(lead.id))).toBe(1)
  })

  it('kişi kendine bildirim almaz', async () => {
    actorRef.current = { id: member.id }
    await createTask({ title: 'Kendi işim', channelId, assigneeIds: [member.id] })
    expect(await countUnreadNotifications(await actorOf(member.id))).toBe(0)
  })

  it('etkinliğe görev bağlanınca etkinlik sahibine event.link bildirimi gider', async () => {
    actorRef.current = { id: lead.id }
    const event = await createEvent({
      title: 'Kongre', channelId, startsAt: new Date('2026-10-01T09:00:00Z'),
    })
    if (!event.ok) throw new Error('beklenmedik hata')

    actorRef.current = { id: member.id }
    const task = await createTask({ title: 'Stand kur', channelId })
    if (!task.ok) throw new Error('beklenmedik hata')
    await linkTaskToEvent({ id: task.data.id, eventId: event.data.id })

    const list = await listNotifications(await actorOf(lead.id))
    const link = list.find((n) => n.kind === 'event.link')
    expect(link?.entityType).toBe('Event')
    expect(link?.entityTitle).toBe('Kongre')
  })

  it('bildirimi olan varlık silinirse bildirim kaybolmaz', async () => {
    actorRef.current = { id: lead.id }
    const task = await createTask({ title: 'Silinecek', channelId, assigneeIds: [member.id] })
    if (!task.ok) throw new Error('beklenmedik hata')
    await db.assignee.deleteMany({ where: { taskId: task.data.id } })
    await db.task.delete({ where: { id: task.data.id } })

    const list = await listNotifications(await actorOf(member.id))
    expect(list).toHaveLength(1)
    expect(list[0]?.entityTitle).toBe('Silinmiş içerik')
  })

  it('okunmamışlar listenin başında gelir', async () => {
    actorRef.current = { id: lead.id }
    const first = await createTask({ title: 'Eski', channelId, assigneeIds: [member.id] })
    if (!first.ok) throw new Error('beklenmedik hata')

    actorRef.current = { id: member.id }
    const notifications = await listNotifications(await actorOf(member.id))
    await markNotificationsRead({ ids: [notifications[0]?.id as string] })

    actorRef.current = { id: lead.id }
    await createTask({ title: 'Yeni', channelId, assigneeIds: [member.id] })

    const list = await listNotifications(await actorOf(member.id))
    expect(list[0]?.entityTitle).toBe('Yeni')
    expect(list[0]?.readAt).toBeNull()
  })

  it('yorumda bahsedilen kişi mention bildirimi alır ve doküman başlığını görür', async () => {
    const doc = await db.document.create({
      data: { title: 'Toplantı notları', channelId, createdById: lead.id },
    })
    const { addComment } = await import('@/server/comments')

    actorRef.current = { id: lead.id }
    await addComment({ entityType: 'Document', entityId: doc.id, body: '@Üye bakar mısın' })

    const list = await listNotifications(await actorOf(member.id))
    expect(list[0]?.kind).toBe('mention')
    expect(list[0]?.entityType).toBe('Document')
    expect(list[0]?.entityTitle).toBe('Toplantı notları')
  })

  it('setAssignees ile eklenen kişi bildirim alır', async () => {
    actorRef.current = { id: lead.id }
    const task = await createTask({ title: 'Sonradan atanan', channelId })
    if (!task.ok) throw new Error('beklenmedik hata')
    expect(await countUnreadNotifications(await actorOf(member.id))).toBe(0)

    await setAssignees({ id: task.data.id, userIds: [member.id] })
    expect(await countUnreadNotifications(await actorOf(member.id))).toBe(1)
  })
})
