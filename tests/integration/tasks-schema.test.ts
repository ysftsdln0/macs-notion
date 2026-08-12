import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/reset-db'

let user: { id: string }
let channelId: string

beforeEach(async () => {
  await resetDb()
  user = await db.user.create({ data: { name: 'Efe' } })
  const channel = await db.channel.create({
    data: { name: 'Etkinlik', slug: 'etkinlik', createdById: user.id },
  })
  channelId = channel.id
})

describe('görev ve etkinlik şeması', () => {
  it('varsayılanlar yerinde: TODO, MEDIUM, rank dolu', async () => {
    const task = await db.task.create({
      data: { title: 'Afiş tasarla', channelId, createdById: user.id },
    })
    expect(task.status).toBe('TODO')
    expect(task.priority).toBe('MEDIUM')
    expect(task.rank.length).toBeGreaterThan(0)
    expect(task.archivedAt).toBeNull()
  })

  it('aynı kişi bir göreve iki kez atanamaz', async () => {
    const task = await db.task.create({
      data: { title: 'Sunum', channelId, createdById: user.id },
    })
    await db.assignee.create({ data: { taskId: task.id, userId: user.id } })
    await expect(
      db.assignee.create({ data: { taskId: task.id, userId: user.id } }),
    ).rejects.toThrow()
  })

  it('etkinlik silinince bağlı görev silinmez, bağlantısı kopar', async () => {
    const event = await db.event.create({
      data: { title: 'Kongre', startsAt: new Date(), channelId, createdById: user.id },
    })
    const task = await db.task.create({
      data: { title: 'Standı kur', channelId, eventId: event.id, createdById: user.id },
    })
    await db.event.delete({ where: { id: event.id } })

    const remaining = await db.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(remaining.eventId).toBeNull()
  })

  it('görev silinince atamalar da silinir (cascade)', async () => {
    const task = await db.task.create({
      data: { title: 'Geçici', channelId, createdById: user.id },
    })
    await db.assignee.create({ data: { taskId: task.id, userId: user.id } })
    await db.task.delete({ where: { id: task.id } })
    expect(await db.assignee.count()).toBe(0)
  })

  it('Task ve Event tsvector kolonları aranabilir', async () => {
    await db.task.create({
      data: { title: 'Otobüs kiralama', notes: 'ulaşım bütçesi', channelId, createdById: user.id },
    })
    await db.event.create({
      data: {
        title: 'Bahar Şenliği', description: 'kampüs içi etkinlik',
        startsAt: new Date(), channelId, createdById: user.id,
      },
    })

    const tasks = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Task"
      WHERE "searchVector" @@ plainto_tsquery('turkish', 'ulaşım')
    `
    expect(tasks).toHaveLength(1)

    const events = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Event"
      WHERE "searchVector" @@ plainto_tsquery('turkish', 'kampüs')
    `
    expect(events).toHaveLength(1)
  })

  it('endsAt opsiyonel; startsAt zorunlu', async () => {
    const event = await db.event.create({
      data: { title: 'Toplantı', startsAt: new Date('2026-09-01T10:00:00Z'), channelId, createdById: user.id },
    })
    expect(event.endsAt).toBeNull()
    expect(event.status).toBe('PLANNED')
  })
})
