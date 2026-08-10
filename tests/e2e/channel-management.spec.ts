import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { signInAs } from './helpers/session'

const db = new PrismaClient()

/**
 * I2 regresyon testi: `createChannel`, `addChannelMember` ve
 * `removeChannelMember` sunucu action'ları tam test edilmiş ama hiçbir
 * arayüzden çağrılmıyordu — production build'in server-reference-manifest'i
 * bunları hiç kaydetmiyordu. Bu testler o arayüzün var olduğunu ve gerçek
 * bir tarayıcı isteğiyle çalıştığını doğrular.
 */

test('admin sidebar\'daki "Yeni kanal" ile kanal açar, kurucu otomatik Lider olur', async ({ page, context }) => {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const admin = await db.user.create({
    data: { name: 'Kurucu Admin', email: `founder-${stamp}@x.com`, globalRole: 'ADMIN', onboardedAt: new Date() },
  })

  await signInAs(context, admin.id)
  await page.goto('/')

  await page.getByRole('link', { name: 'Yeni kanal' }).click()
  await expect(page).toHaveURL(/\/channels\/new$/)

  const channelName = `Medya Ekibi ${stamp}`
  await page.getByLabel('Kanal adı').fill(channelName)
  await page.getByRole('button', { name: 'Oluştur' }).click()

  await expect(page).toHaveURL(/\/c\/medya-ekibi-/)
  await expect(page.getByRole('heading', { name: channelName })).toBeVisible()
  // "Lider" metni kanal rolü <select>'inin bir <option>'ında da geçer; üye
  // satırının kendisini (LEAD etiketiyle birlikte) hedeflemek için listitem'a
  // scope ediyoruz.
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Kurucu Admin' }),
  ).toContainText('Kurucu Admin · Lider')
})

test('düz üye (LEAD değil) sidebar\'da "Yeni kanal" görmez ve /channels/new 404 döner', async ({ page, context }) => {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const plain = await db.user.create({
    data: { name: 'Sade Üye', email: `plain-${stamp}@x.com`, onboardedAt: new Date() },
  })

  await signInAs(context, plain.id)
  await page.goto('/')

  await expect(page.getByRole('link', { name: 'Yeni kanal' })).toHaveCount(0)

  const response = await page.goto('/channels/new')
  expect(response?.status()).toBe(404)
})

test('kanal LEAD\'i kanal sayfasından yeni üye ekler ve çıkarır', async ({ page, context }) => {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const lead = await db.user.create({
    data: { name: 'Kanal Lideri', email: `lead-${stamp}@x.com`, onboardedAt: new Date() },
  })
  const candidate = await db.user.create({
    data: { name: `Aday Üye ${stamp}`, email: `cand-${stamp}@x.com`, onboardedAt: new Date() },
  })
  const channel = await db.channel.create({
    data: {
      name: `Etkinlik ${stamp}`, slug: `etkinlik-${stamp}`, visibility: 'OPEN',
      createdById: lead.id, members: { create: { userId: lead.id, channelRole: 'LEAD' } },
    },
  })

  await signInAs(context, lead.id)
  await page.goto(`/c/${channel.slug}`)

  await page.getByLabel('Eklenecek üye').selectOption({ label: candidate.name })
  await page.getByRole('button', { name: 'Üye ekle' }).click()

  const memberList = page.getByRole('list').first()
  await expect(memberList.getByRole('listitem').filter({ hasText: candidate.name })).toBeVisible()

  const memberCountAfterAdd = await db.channelMember.count({ where: { channelId: channel.id } })
  expect(memberCountAfterAdd).toBe(2)

  page.once('dialog', (dialog) => dialog.accept())
  await memberList
    .getByRole('listitem')
    .filter({ hasText: candidate.name })
    .getByRole('button', { name: 'Çıkar' })
    .click()

  // Kaldırılan kişi aday havuzuna geri döner (add-form'un "Eklenecek üye"
  // seçeneği olarak yeniden görünmesi doğrudur) — bu yüzden sayfa genelinde
  // metin arama yerine üye <ul>'una scope ediyoruz.
  await expect(memberList.getByRole('listitem').filter({ hasText: candidate.name })).toHaveCount(0)
  const memberCountAfterRemove = await db.channelMember.count({ where: { channelId: channel.id } })
  expect(memberCountAfterRemove).toBe(1)
})
