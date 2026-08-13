import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { signInAs } from './helpers/session'

const db = new PrismaClient()

/**
 * ⌘K dinleyicisi hidrasyondan SONRA bağlanır; sayfa yüklendiği anda
 * basılan tuş sessizce kaybolur (ve testi kararsız yapar). Tuş, palet
 * açılana kadar tekrar denenir.
 */
async function openPalette(page: Page) {
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
}

test('⌘K paleti kullanıcının görebildiği içeriği bulur, göremediğini göstermez', async ({
  page, context,
}) => {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const word = `palet${stamp.replace(/[^a-z0-9]/gi, '')}`

  const owner = await db.user.create({
    data: { name: 'Palet Sahibi', email: `palette-${stamp}@x.com`, onboardedAt: new Date() },
  })
  const stranger = await db.user.create({
    data: { name: 'Palet Yabancı', email: `palette-out-${stamp}@x.com`, onboardedAt: new Date() },
  })
  const channel = await db.channel.create({
    data: {
      name: `Palet ${stamp}`, slug: `palet-${stamp}`, visibility: 'OPEN',
      createdById: owner.id, members: { create: { userId: owner.id, channelRole: 'LEAD' } },
    },
  })

  await db.document.create({
    data: {
      title: `${word} dokümanı`, channelId: channel.id, createdById: owner.id,
      // Kanal içi görünürlük: yabancı üye olmadığı için sonuçlarında çıkmamalı.
      visibility: 'CHANNEL',
    },
  })
  await db.event.create({
    data: {
      title: `${word} etkinliği`, channelId: channel.id, createdById: owner.id,
      startsAt: new Date('2026-12-01T09:00:00Z'),
    },
  })

  await signInAs(context, owner.id)
  await page.goto('/')

  await openPalette(page)
  const palette = page.getByRole('dialog')
  // Sorgu yokken kısayollar görünür.
  await expect(palette.getByRole('button', { name: 'Yeni görev' })).toBeVisible()

  await palette.getByLabel('Ara').fill(word)
  await expect(palette.getByRole('button', { name: `${word} dokümanı` })).toBeVisible()
  await expect(palette.getByRole('button', { name: `${word} etkinliği` })).toBeVisible()

  await palette.getByRole('button', { name: `${word} etkinliği` }).click()
  await expect(page).toHaveURL(/\/events\/[a-z0-9]+$/)

  // Aynı sorgu, kanala üye olmayan kullanıcıda CHANNEL dokümanını
  // getirmemeli; OPEN kanaldaki etkinlik ise herkese açık.
  await signInAs(context, stranger.id)
  await page.goto('/')
  await openPalette(page)
  const strangerPalette = page.getByRole('dialog')
  await strangerPalette.getByLabel('Ara').fill(word)
  await expect(strangerPalette.getByRole('button', { name: `${word} etkinliği` })).toBeVisible()
  await expect(strangerPalette.getByRole('button', { name: `${word} dokümanı` })).toHaveCount(0)
})
