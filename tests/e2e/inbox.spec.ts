import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { signInAs } from './helpers/session'

const db = new PrismaClient()

test('atanan kişi gelen kutusunda bildirimi görür ve okundu işaretler', async ({ page, context }) => {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const assigner = await db.user.create({
    data: { name: 'Atayan', email: `assigner-${stamp}@x.com`, onboardedAt: new Date() },
  })
  const assignee = await db.user.create({
    data: { name: 'Atanan', email: `assignee-${stamp}@x.com`, onboardedAt: new Date() },
  })
  const channel = await db.channel.create({
    data: {
      name: `Inbox Kanal ${stamp}`, slug: `inbox-${stamp}`, visibility: 'OPEN',
      createdById: assigner.id, members: { create: { userId: assigner.id, channelRole: 'LEAD' } },
    },
  })
  const title = `Bildirimli görev ${stamp}`
  const task = await db.task.create({
    data: { title, channelId: channel.id, createdById: assigner.id },
  })
  await db.assignee.create({ data: { taskId: task.id, userId: assignee.id } })
  await db.notification.create({
    data: {
      userId: assignee.id, actorId: assigner.id,
      kind: 'task.assigned', entityType: 'Task', entityId: task.id,
    },
  })

  await signInAs(context, assignee.id)
  await page.goto('/')

  // Sidebar rozeti okunmamış sayısını gösterir.
  const inboxLink = page.getByRole('link', { name: /Gelen kutusu/ })
  await expect(inboxLink).toContainText('1')
  await inboxLink.click()

  await expect(page).toHaveURL(/\/inbox$/)
  const row = page.getByRole('listitem').filter({ hasText: title })
  await expect(row).toContainText('seni bir göreve atadı')

  await page.getByRole('button', { name: 'Tümünü okundu işaretle' }).click()
  await expect(page.getByRole('button', { name: 'Tümünü okundu işaretle' })).toHaveCount(0)

  await expect
    .poll(async () => db.notification.count({ where: { userId: assignee.id, readAt: null } }))
    .toBe(0)
})
