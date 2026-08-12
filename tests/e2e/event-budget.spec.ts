import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { signInAs } from './helpers/session'

const db = new PrismaClient()

/**
 * Etkinliğin takvimde göründüğünü ve detayında görev + bütçe bölümlerinin
 * bağlı kayıtları listelediğini uçtan uca doğrular (plan Task 32
 * tamamlanma kriteri). Bütçe bölümü içerikten daha kapalı olduğu için
 * ikinci yarıda düz üyenin onu GÖRMEDİĞİ de sınanır.
 */
test('etkinlik takvimde görünür, detayında görev ve bütçe bağlı kayıtları listeler', async ({
  page, context,
}) => {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const admin = await db.user.create({
    data: {
      name: 'Bütçe Yöneticisi', email: `budgetadmin-${stamp}@x.com`,
      globalRole: 'ADMIN', onboardedAt: new Date(),
    },
  })
  const member = await db.user.create({
    data: { name: 'Düz Üye', email: `budgetmember-${stamp}@x.com`, onboardedAt: new Date() },
  })
  const channel = await db.channel.create({
    data: {
      name: `Etkinlik ${stamp}`, slug: `etkinlik-${stamp}`, visibility: 'OPEN',
      createdById: admin.id,
      members: {
        create: [
          { userId: admin.id, channelRole: 'LEAD' },
          { userId: member.id, channelRole: 'MEMBER' },
        ],
      },
    },
  })

  // Takvim varsayılan olarak içinde bulunulan ayı gösterir.
  const startsAt = new Date()
  startsAt.setDate(15)
  startsAt.setHours(10, 0, 0, 0)

  const event = await db.event.create({
    data: {
      title: `Kongre ${stamp}`, channelId: channel.id, createdById: admin.id, startsAt,
    },
  })
  await db.task.create({
    data: {
      title: `Afiş tasarımı ${stamp}`, channelId: channel.id,
      eventId: event.id, createdById: admin.id,
    },
  })
  await db.budgetEntry.create({
    data: {
      kind: 'EXPENSE', title: `Salon kirası ${stamp}`, amount: '1250.50',
      category: 'Mekan', channelId: channel.id, eventId: event.id,
      createdById: admin.id, date: startsAt,
    },
  })

  await signInAs(context, admin.id)
  await page.goto('/events')
  await page.getByRole('link', { name: new RegExp(`Kongre ${stamp}`) }).click()

  await expect(page.getByRole('heading', { name: `Kongre ${stamp}` })).toBeVisible()
  await expect(page.getByText(`Afiş tasarımı ${stamp}`)).toBeVisible()
  await expect(page.getByText(`Salon kirası ${stamp}`, { exact: true })).toBeVisible()
  // Decimal kuruşuna kadar biçimlenir (tr-TR ondalık ayırıcısı virgül).
  await expect(page.getByText('1.250,50 ₺').first()).toBeVisible()

  // Düz üye etkinliği görür ama bütçe bölümünü görmez.
  await signInAs(context, member.id)
  await page.goto(`/events/${event.id}`)
  await expect(page.getByText(`Afiş tasarımı ${stamp}`)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Bütçe' })).toHaveCount(0)
  await expect(page.getByText(`Salon kirası ${stamp}`, { exact: true })).toHaveCount(0)
})
