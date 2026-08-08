import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { signInAs } from './helpers/session'

const db = new PrismaClient()

test("oturumsuz kullanıcı uygulamaya giremez, login'e yönlenir", async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('button', { name: 'Google ile devam et' })).toBeVisible()
})

test('PRIVATE kanal üye olmayana 404 döner', async ({ page, context }) => {
  const stamp = Date.now()
  const owner = await db.user.create({
    data: { name: 'Sahip', email: `o-${stamp}@x.com`, onboardedAt: new Date() },
  })
  const outsider = await db.user.create({
    data: { name: 'Yabancı', email: `x-${stamp}@x.com`, onboardedAt: new Date() },
  })
  const channel = await db.channel.create({
    data: {
      name: `Gizli ${stamp}`, slug: `gizli-${stamp}`, visibility: 'PRIVATE',
      createdById: owner.id, members: { create: { userId: owner.id, channelRole: 'LEAD' } },
    },
  })

  await signInAs(context, outsider.id)

  const response = await page.goto(`/c/${channel.slug}`)
  expect(response?.status()).toBe(404)
})
