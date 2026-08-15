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

  // I4 regresyon testi: her iki durum da Next'in İngilizce yerleşik 404
  // sayfası yerine projenin kendi Türkçe not-found.tsx'ini göstermeli — ve
  // ikisi birebir aynı metni göstermeli (aksi halde metin farkı, durum kodu
  // eşitliğinin gizlediği aynı sızıntıyı geri açardı).
  const unknownBody = (await unknownResponse?.text()) ?? ''
  expect(forbiddenBody).toContain('Sayfa bulunamadı')
  expect(forbiddenBody).not.toContain('This page could not be found')
  expect(unknownBody).toContain('Sayfa bulunamadı')
  expect(unknownBody).not.toContain('This page could not be found')
})

test('tamamen bilinmeyen bir rota da Türkçe not-found sayfasını gösterir', async ({ page }) => {
  const response = await page.goto('/hic-var-olmayan-bir-rota-xyz')
  expect(response?.status()).toBe(404)
  const body = (await response?.text()) ?? ''
  expect(body).toContain('Sayfa bulunamadı')
  expect(body).not.toContain('This page could not be found')
})

/**
 * I1 regresyon testi: `/admin` bir admin olmayana 200 dönüyordu çünkü
 * `admin/loading.tsx`'in Suspense sınırı, sayfa `notFound()` çağırmadan önce
 * yanıtı 200 olarak akıtıyordu (gövde doğru — Next'in not-found içeriği —
 * ama durum kodu yanlıştı). Task 13 bu tuzağı `members/` ve `admin/`'e
 * taşıyarak "düzeltmişti"; asıl kırılan route buydu. Sınıfın bir daha
 * sessizce dönmemesi için durum kodunu doğrudan pinliyoruz.
 */
test("düz üye için /admin 404 döner (gövde değil, durum kodu regresyonu)", async ({ page, context }) => {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const plain = await db.user.create({
    data: { name: 'Sade Üye', email: `plain-admin-${stamp}@x.com`, onboardedAt: new Date() },
  })

  await signInAs(context, plain.id)
  const response = await page.goto('/admin')
  expect(response?.status()).toBe(404)
  const body = (await response?.text()) ?? ''
  expect(body).not.toContain('Yönetim')
  expect(body).not.toContain('Yeni davet')
})

/**
 * Bu takımın en kritik testi. Rol sisteminde başka her şey yanlışsa fazla
 * yetki verilir; bu yanlışsa gizli içerik sızar.
 *
 * "Yönetime özel kanal" ayrı bir mekanizma değildir: YK rolü CONTENT_READ_ALL
 * taşıdığı için PRIVATE bir kanal ona kendiliğinden açılır, kanala üye
 * eklenmesine gerek kalmaz. Düz üyeye ise kanal hiç var olmamış gibi görünür.
 */
test('YK rolü yönetime özel kanalı açar, düz üye kanalı hiç göremez', async ({ page, context, browser }) => {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const owner = await db.user.create({
    data: {
      name: 'Sahip', email: `s-${stamp}@x.com`,
      globalRole: 'SUPERADMIN', onboardedAt: new Date(),
    },
  })
  const role = await db.role.create({
    data: {
      name: `Yönetim Kurulu ${stamp}`,
      slug: `yonetim-kurulu-${stamp}`,
      // position tekil DEĞİL (bkz. src/server/roles.ts) — sabit bir değer
      // güvenli, Playwright worker'ları paralel koşsa da çakışma riski yok.
      position: 1,
      permissions: ['CONTENT_READ_ALL', 'CONTENT_WRITE_ALL'],
    },
  })
  const boardMember = await db.user.create({
    data: { name: 'YK Üyesi', email: `y-${stamp}@x.com`, onboardedAt: new Date() },
  })
  await db.userRole.create({ data: { userId: boardMember.id, roleId: role.id } })
  const plainMember = await db.user.create({
    data: { name: 'Düz Üye', email: `d-${stamp}@x.com`, onboardedAt: new Date() },
  })

  const channelName = `Yönetim ${stamp}`
  const channelSlug = `yonetim-${stamp}`
  await db.channel.create({
    data: {
      name: channelName, slug: channelSlug, visibility: 'PRIVATE',
      createdById: owner.id, members: { create: { userId: owner.id, channelRole: 'LEAD' } },
    },
  })

  // YK üyesi: kanala ÜYE OLMADAN erişebilmeli — erişim rolden geliyor.
  await signInAs(context, boardMember.id)
  const allowed = await page.goto(`/c/${channelSlug}`)
  expect(allowed?.status()).toBe(200)
  // Sayfa BAŞLIĞI hedeflenir (PageHeader'ın h1'i). Düz metin araması sidebar'daki
  // kopyayı da yakalıyor ve o dar görünümde gizli olduğu için testi düşürüyordu.
  await expect(page.getByRole('heading', { name: channelName })).toBeVisible()

  // Düz üye: aynı kanal 404, ve kanalın ADI yanıtın hiçbir yerinde geçmemeli.
  const plainContext = await browser.newContext()
  const plainPage = await plainContext.newPage()
  await signInAs(plainContext, plainMember.id)
  const forbidden = await plainPage.goto(`/c/${channelSlug}`)
  expect(forbidden?.status()).toBe(404)
  expect((await forbidden?.text()) ?? '').not.toContain(channelName)
  await plainContext.close()
})
