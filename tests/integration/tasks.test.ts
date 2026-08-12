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
  archiveTask, createTask, moveTask, restoreTask, setAssignees, updateTask,
} = await import('@/server/tasks')
const { listTasks } = await import('@/server/tasks-query')

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

describe('createTask', () => {
  it('kanal üyesi görev açar; varsayılanlar ve rank yerinde', async () => {
    actorRef.current = { id: member.id }
    const r = await createTask({ title: 'Afiş tasarla', channelId: openChannel.id })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const task = await db.task.findUniqueOrThrow({ where: { id: r.data.id } })
    expect(task.status).toBe('TODO')
    expect(task.priority).toBe('MEDIUM')
    expect(task.rank.length).toBeGreaterThan(0)
    expect(task.createdById).toBe(member.id)
  })

  it('art arda açılan görevler sütunun sonuna, sırayla eklenir', async () => {
    actorRef.current = { id: member.id }
    const first = await createTask({ title: 'Bir', channelId: openChannel.id })
    const second = await createTask({ title: 'İki', channelId: openChannel.id })
    if (!first.ok || !second.ok) throw new Error('beklenmedik hata')

    const rows = await db.task.findMany({ orderBy: { rank: 'asc' }, select: { title: true } })
    expect(rows.map((r) => r.title)).toEqual(['Bir', 'İki'])
  })

  it('PRIVATE kanalda üye olmayan görev açamaz', async () => {
    actorRef.current = { id: member.id }
    const r = await createTask({ title: 'Sızıntı', channelId: privateChannel.id })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  it('var olmayan kullanıcı atanamaz', async () => {
    actorRef.current = { id: member.id }
    const r = await createTask({
      title: 'Hayalet', channelId: openChannel.id, assigneeIds: ['cnonexistentuser000000'],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND')
  })

  it('atama bildirimi üretir; kişi kendine atarsa üretmez', async () => {
    actorRef.current = { id: member.id }
    const r = await createTask({
      title: 'Sunum', channelId: openChannel.id, assigneeIds: [lead.id, member.id],
    })
    if (!r.ok) throw new Error('beklenmedik hata')

    expect(await db.notification.count({ where: { userId: lead.id, kind: 'task.assigned' } })).toBe(1)
    expect(await db.notification.count({ where: { userId: member.id } })).toBe(0)
  })
})

describe('yetki', () => {
  it('atanan kişi kanal üyesi olmasa da OPEN kanalda durumu değiştirebilir', async () => {
    actorRef.current = { id: member.id }
    const created = await createTask({
      title: 'Devret', channelId: openChannel.id, assigneeIds: [outsider.id],
    })
    if (!created.ok) throw new Error('beklenmedik hata')

    actorRef.current = { id: outsider.id }
    const r = await updateTask({ id: created.data.id, status: 'IN_PROGRESS' })
    expect(r.ok).toBe(true)
  })

  it('kanal dışından ve atanmamış biri görevi değiştiremez', async () => {
    actorRef.current = { id: lead.id }
    const created = await createTask({ title: 'Korunan', channelId: privateChannel.id })
    if (!created.ok) throw new Error('beklenmedik hata')

    actorRef.current = { id: outsider.id }
    const r = await updateTask({ id: created.data.id, title: 'Ele geçirildi' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  it('LEAD olmayan üye başkasının görevini silemez, LEAD siler', async () => {
    actorRef.current = { id: lead.id }
    const created = await createTask({ title: 'Liderin görevi', channelId: openChannel.id })
    if (!created.ok) throw new Error('beklenmedik hata')

    actorRef.current = { id: member.id }
    const denied = await archiveTask({ id: created.data.id })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN')

    actorRef.current = { id: lead.id }
    expect((await archiveTask({ id: created.data.id })).ok).toBe(true)
  })

  it('arşivlenen görev listeden düşer; admin geri yükler', async () => {
    actorRef.current = { id: member.id }
    const created = await createTask({ title: 'Eski', channelId: openChannel.id })
    if (!created.ok) throw new Error('beklenmedik hata')
    await archiveTask({ id: created.data.id })

    expect((await listTasks(await actorOf(member.id))).map((t) => t.title)).not.toContain('Eski')

    const denied = await restoreTask({ id: created.data.id })
    expect(denied.ok).toBe(false)

    actorRef.current = { id: admin.id }
    expect((await restoreTask({ id: created.data.id })).ok).toBe(true)
    expect((await listTasks(await actorOf(member.id))).map((t) => t.title)).toContain('Eski')
  })
})

describe('moveTask', () => {
  it('iki kartın arasına yerleşir ve sıra korunur', async () => {
    actorRef.current = { id: member.id }
    const a = await createTask({ title: 'A', channelId: openChannel.id })
    const b = await createTask({ title: 'B', channelId: openChannel.id })
    const c = await createTask({ title: 'C', channelId: openChannel.id })
    if (!a.ok || !b.ok || !c.ok) throw new Error('beklenmedik hata')

    const rankA = (await db.task.findUniqueOrThrow({ where: { id: a.data.id } })).rank
    const rankB = (await db.task.findUniqueOrThrow({ where: { id: b.data.id } })).rank

    // C'yi A ile B'nin arasına taşı.
    const moved = await moveTask({
      id: c.data.id, status: 'TODO', rankBefore: rankA, rankAfter: rankB,
    })
    expect(moved.ok).toBe(true)

    const order = await db.task.findMany({
      where: { status: 'TODO' }, orderBy: { rank: 'asc' }, select: { title: true },
    })
    expect(order.map((t) => t.title)).toEqual(['A', 'C', 'B'])
  })

  it('başka sütuna taşıyınca durum kalıcı olur', async () => {
    actorRef.current = { id: member.id }
    const created = await createTask({ title: 'Taşınan', channelId: openChannel.id })
    if (!created.ok) throw new Error('beklenmedik hata')

    const r = await moveTask({ id: created.data.id, status: 'IN_PROGRESS' })
    expect(r.ok).toBe(true)
    const task = await db.task.findUniqueOrThrow({ where: { id: created.data.id } })
    expect(task.status).toBe('IN_PROGRESS')
  })

  it('rank çakışması sütunu yeniden dengeleyerek çözülür', async () => {
    actorRef.current = { id: member.id }
    const a = await createTask({ title: 'A', channelId: openChannel.id })
    const b = await createTask({ title: 'B', channelId: openChannel.id })
    const c = await createTask({ title: 'C', channelId: openChannel.id })
    if (!a.ok || !b.ok || !c.ok) throw new Error('beklenmedik hata')

    // Hesaplanan ara değerin var olan bir anahtara DENK gelmesini kur:
    // rankBetween('a', 'c') === 'b' ve 'b' zaten B'nin anahtarı.
    await db.task.update({ where: { id: a.data.id }, data: { rank: 'a' } })
    await db.task.update({ where: { id: b.data.id }, data: { rank: 'b' } })
    await db.task.update({ where: { id: c.data.id }, data: { rank: 'x' } })

    const moved = await moveTask({
      id: c.data.id, status: 'TODO', rankBefore: 'a', rankAfter: 'c',
    })
    expect(moved.ok).toBe(true)

    const ordered = await db.task.findMany({
      where: { status: 'TODO' }, orderBy: { rank: 'asc' }, select: { title: true, rank: true },
    })
    // Sütun yeniden dengelenir: anahtarlar benzersiz ve istenen sıra korunur.
    expect(new Set(ordered.map((r) => r.rank)).size).toBe(3)
    expect(ordered.map((r) => r.title)).toEqual(['A', 'C', 'B'])
  })
})

describe('setAssignees', () => {
  it('yeni atananlara bildirim gider, mevcut olanlara tekrar gitmez', async () => {
    actorRef.current = { id: member.id }
    const created = await createTask({
      title: 'Paylaşılan iş', channelId: openChannel.id, assigneeIds: [lead.id],
    })
    if (!created.ok) throw new Error('beklenmedik hata')
    expect(await db.notification.count({ where: { userId: lead.id } })).toBe(1)

    const r = await setAssignees({ id: created.data.id, userIds: [lead.id, outsider.id] })
    expect(r.ok).toBe(true)

    expect(await db.notification.count({ where: { userId: lead.id } })).toBe(1)
    expect(await db.notification.count({ where: { userId: outsider.id } })).toBe(1)
    expect(await db.assignee.count({ where: { taskId: created.data.id } })).toBe(2)
  })

  it('listeden çıkarılan kişinin ataması silinir', async () => {
    actorRef.current = { id: member.id }
    const created = await createTask({
      title: 'Devir', channelId: openChannel.id, assigneeIds: [lead.id, outsider.id],
    })
    if (!created.ok) throw new Error('beklenmedik hata')

    await setAssignees({ id: created.data.id, userIds: [outsider.id] })
    const remaining = await db.assignee.findMany({ where: { taskId: created.data.id } })
    expect(remaining.map((a) => a.userId)).toEqual([outsider.id])
  })

  it('tüm atamalar kaldırılabilir', async () => {
    actorRef.current = { id: member.id }
    const created = await createTask({
      title: 'Boşalt', channelId: openChannel.id, assigneeIds: [lead.id],
    })
    if (!created.ok) throw new Error('beklenmedik hata')

    await setAssignees({ id: created.data.id, userIds: [] })
    expect(await db.assignee.count({ where: { taskId: created.data.id } })).toBe(0)
  })
})

describe('listTasks', () => {
  it('PRIVATE kanaldaki görev üye olmayana görünmez, üyeye ve admine görünür', async () => {
    actorRef.current = { id: lead.id }
    await createTask({ title: 'Gizli iş', channelId: privateChannel.id })

    expect((await listTasks(await actorOf(member.id))).map((t) => t.title)).not.toContain('Gizli iş')
    expect((await listTasks(await actorOf(lead.id))).map((t) => t.title)).toContain('Gizli iş')
    expect((await listTasks(await actorOf(admin.id))).map((t) => t.title)).toContain('Gizli iş')
  })

  it('kanal ve atanan filtreleri çalışır', async () => {
    actorRef.current = { id: member.id }
    await createTask({ title: 'Filtreli', channelId: openChannel.id, assigneeIds: [lead.id] })
    await createTask({ title: 'Filtresiz', channelId: openChannel.id })

    const byAssignee = await listTasks(await actorOf(member.id), { assigneeId: lead.id })
    expect(byAssignee.map((t) => t.title)).toEqual(['Filtreli'])

    const byChannel = await listTasks(await actorOf(member.id), { channelId: openChannel.id })
    expect(byChannel).toHaveLength(2)
  })
})
