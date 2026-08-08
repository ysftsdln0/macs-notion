import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { signInAs } from './helpers/session'

const db = new PrismaClient()

test("oturumsuz kullanıcı uygulamaya giremez, login'e yönlenir", async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('button', { name: 'Google ile devam et' })).toBeVisible()
})

test('PRIVATE kanal üye olmayana 404 döner ve bilinmeyen kanaldan ayırt edilemez', async ({ page, context }) => {
  // Date.now() tek başına yeterli değil: Playwright iki worker'ı paralel
  // çalıştırıyor, aynı milisaniyede farklı worker'ların üreteceği e-posta
  // User.email tekil kısıtına çarpabilirdi. randomUUID eki bunu imkansız kılar.
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const owner = await db.user.create({
    data: { name: 'Sahip', email: `o-${stamp}@x.com`, onboardedAt: new Date() },
  })
  const outsider = await db.user.create({
    data: { name: 'Yabancı', email: `x-${stamp}@x.com`, onboardedAt: new Date() },
  })
  const channelName = `Gizli ${stamp}`
  const channelSlug = `gizli-${stamp}`
  await db.channel.create({
    data: {
      name: channelName, slug: channelSlug, visibility: 'PRIVATE',
      createdById: owner.id, members: { create: { userId: owner.id, channelRole: 'LEAD' } },
    },
  })

  await signInAs(context, outsider.id)

  // Erişimi olmayan (var olan) bir kanal ile hiç var olmayan bir slug aynı
  // yanıtı üretmeli: aksi halde durum kodu veya gövde farkı, kanalın var
  // olup olmadığını dışarıdan (yalnızca istek göndererek) sızdırırdı.
  // (Not: slug'ın kendisi RSC hydration payload'ında her /c/[slug] isteğinde
  // -bilinen ya da bilinmeyen- geri yansır; bu istemcinin zaten gönderdiği
  // URL parçasıdır, sızıntı değildir. Asıl kontrol edilmesi gereken, sunucu
  // tarafından türetilen ve isteyenin bilmediği veri: kanal adı.)
  const forbiddenResponse = await page.goto(`/c/${channelSlug}`)
  expect(forbiddenResponse?.status()).toBe(404)
  const forbiddenBody = (await forbiddenResponse?.text()) ?? ''
  expect(forbiddenBody).not.toContain(channelName)

  const unknownResponse = await page.goto(`/c/bilinmeyen-${stamp}`)
  expect(unknownResponse?.status()).toBe(404)

  expect(forbiddenResponse?.status()).toBe(unknownResponse?.status())
})
