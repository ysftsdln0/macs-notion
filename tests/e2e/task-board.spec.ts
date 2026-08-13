import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { signInAs } from './helpers/session'

const db = new PrismaClient()

test('üye görev oluşturur, kartı sürükleyerek taşır ve durum yenilemeden sonra kalır', async ({ page, context }) => {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const user = await db.user.create({
    data: { name: 'Görev Sahibi', email: `tasks-${stamp}@x.com`, onboardedAt: new Date() },
  })
  const channel = await db.channel.create({
    data: {
      name: `Görev Kanalı ${stamp}`, slug: `gorev-${stamp}`, visibility: 'OPEN',
      createdById: user.id, members: { create: { userId: user.id, channelRole: 'LEAD' } },
    },
  })

  await signInAs(context, user.id)
  // Pano KANALA FİLTRELİ açılır. Filtresiz pano, veritabanında biriken tüm
  // OPEN kanal görevlerini gösterir; sütunlar ekranı taşınca sürükleme
  // hedefinin merkezi görünür alanın dışına düşer ve bırakma hiç
  // gerçekleşmez (testi veri birikimine bağımlı kılan gerçek sebep).
  await page.goto(`/tasks?channelId=${channel.id}`)

  await page.getByRole('button', { name: /görev/i }).first().click()
  // "Kanal" etiketi sayfada iki kez geçiyor (filtre çubuğu + dialog);
  // seçiciyi dialog'a scope ediyoruz.
  const dialog = page.getByRole('dialog')
  const title = `Afiş ${stamp}`
  await dialog.getByLabel('Başlık').fill(title)
  await dialog.getByLabel('Kanal').selectOption({ label: channel.name })
  await dialog.getByRole('button', { name: 'Oluştur' }).click()

  const card = page.locator(`[data-task-title="${title}"]`)
  await expect(card).toBeVisible()
  // Dialog kapanma animasyonu bitmeden sürüklemeye başlarsak, arka plan
  // katmanı pointerdown'u yutar ve dnd-kit sürüklemeyi hiç başlatmaz.
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // "Yapılacak" sütunundan "Devam eden" sütununa sürükle. dnd-kit pointer
  // olaylarını dinliyor ve 4px'lik bir başlatma eşiği var; Playwright'ın
  // dragTo()'su tek sıçramada hareket ettiği için sürükleme hiç başlamıyor.
  // Bu yüzden fare adım adım sürülür.
  const handle = card.getByRole('button', { name: `${title} kartını taşı` })
  const target = page.locator('[data-column="IN_PROGRESS"]')

  async function dragOnce() {
    await handle.scrollIntoViewIfNeeded()
    const from = await handle.boundingBox()
    const to = await target.boundingBox()
    if (!from || !to) throw new Error('sürükleme hedefleri görünür değil')

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 5 })
    // Sütunun ORTASI değil üst şeridi hedeflenir: sütun uzunsa merkez
    // görünür alanın dışında kalabilir.
    await page.mouse.move(to.x + to.width / 2, to.y + 48, { steps: 12 })
    await page.mouse.up()
  }

  // Sürükleme, oluşturmadan sonraki router.refresh() panoyu yeniden
  // render ederken denk gelirse pointerdown kopmuş bir düğüme gider ve
  // dnd-kit sürüklemeyi hiç başlatmaz. Tek atış kararsız; sonuç veritabanında
  // görünene kadar tekrarlanır (başarılı sürüklemenin tekrarı da zararsız:
  // kart aynı sütuna bırakılır).
  await expect(async () => {
    await dragOnce()
    const task = await db.task.findFirst({ where: { title } })
    expect(task?.status).toBe('IN_PROGRESS')
  }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000] })

  await page.reload()
  await expect(
    page.locator('[data-column="IN_PROGRESS"]').locator(`[data-task-title="${title}"]`),
  ).toBeVisible()
})

test('PRIVATE kanaldaki görev üye olmayanın panosunda görünmez', async ({ page, context }) => {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const owner = await db.user.create({
    data: { name: 'Kanal Sahibi', email: `owner-${stamp}@x.com`, onboardedAt: new Date() },
  })
  const stranger = await db.user.create({
    data: { name: 'Yabancı', email: `stranger-t-${stamp}@x.com`, onboardedAt: new Date() },
  })
  const channel = await db.channel.create({
    data: {
      name: `Gizli ${stamp}`, slug: `gizli-${stamp}`, visibility: 'PRIVATE',
      createdById: owner.id, members: { create: { userId: owner.id, channelRole: 'LEAD' } },
    },
  })
  const title = `Gizli görev ${stamp}`
  await db.task.create({
    data: { title, channelId: channel.id, createdById: owner.id },
  })

  await signInAs(context, stranger.id)
  await page.goto('/tasks')
  await expect(page.locator(`[data-task-title="${title}"]`)).toHaveCount(0)
})
