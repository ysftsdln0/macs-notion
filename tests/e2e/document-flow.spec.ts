import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { signInAs } from './helpers/session'

const db = new PrismaClient()

async function makeChannel(stamp: string, ownerId: string) {
  return db.channel.create({
    data: {
      name: `Proje ${stamp}`, slug: `proje-${stamp}`, visibility: 'OPEN',
      createdById: ownerId, members: { create: { userId: ownerId, channelRole: 'LEAD' } },
    },
  })
}

test('üye /docs\'tan doküman oluşturur, yazar ve içerik yenilemeden sonra kalır', async ({ page, context }) => {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const author = await db.user.create({
    data: { name: 'Doküman Yazarı', email: `author-${stamp}@x.com`, onboardedAt: new Date() },
  })
  await makeChannel(stamp, author.id)

  await signInAs(context, author.id)
  await page.goto('/docs')

  await page.getByRole('button', { name: /doküman|Yeni doküman/i }).first().click()
  await page.getByLabel('Başlık').fill(`Toplantı ${stamp}`)
  await page.getByRole('button', { name: 'Oluştur' }).click()

  await expect(page).toHaveURL(/\/docs\/[a-z0-9]+$/)
  await expect(page.getByLabel('Doküman başlığı')).toHaveValue(`Toplantı ${stamp}`)

  // Canlı bağlantı kurulana kadar editör salt-okur davranır; bağlantı
  // kurulduğunda uyarı şeridi kaybolur.
  await expect(page.getByText('Canlı düzenlemeye bağlanılıyor…')).toHaveCount(0, { timeout: 20_000 })

  const editorBody = page.locator('.bn-editor')
  await editorBody.click()
  await page.keyboard.type('Ajanda: bütçe görüşmesi')

  // Hocuspocus varsayılan debounce'u ile DocState'e yazılır.
  await expect
    .poll(async () => {
      const doc = await db.document.findFirst({ where: { title: `Toplantı ${stamp}` } })
      if (!doc) return ''
      const state = await db.docState.findUnique({ where: { documentId: doc.id } })
      return state ? (await db.document.findUniqueOrThrow({ where: { id: doc.id } })).searchText : ''
    }, { timeout: 20_000 })
    .toContain('Ajanda')

  await page.reload()
  await expect(editorBody).toContainText('Ajanda: bütçe görüşmesi')
})

test('PRIVATE doküman sahibinden başkasına 404 döner', async ({ page, context }) => {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const owner = await db.user.create({
    data: { name: 'Sahip', email: `owner-${stamp}@x.com`, onboardedAt: new Date() },
  })
  const stranger = await db.user.create({
    data: { name: 'Yabancı', email: `stranger-${stamp}@x.com`, onboardedAt: new Date() },
  })
  const channel = await makeChannel(stamp, owner.id)
  const doc = await db.document.create({
    data: {
      title: `Kişisel ${stamp}`, channelId: channel.id,
      visibility: 'PRIVATE', createdById: owner.id,
    },
  })

  await signInAs(context, stranger.id)
  const response = await page.goto(`/docs/${doc.id}`)
  expect(response?.status()).toBe(404)
})

test('VIEW paylaşımı salt-okur editör gösterir', async ({ page, context }) => {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const owner = await db.user.create({
    data: { name: 'Sahip', email: `viewowner-${stamp}@x.com`, onboardedAt: new Date() },
  })
  const reader = await db.user.create({
    data: { name: 'Okuyucu', email: `reader-${stamp}@x.com`, onboardedAt: new Date() },
  })
  const channel = await makeChannel(stamp, owner.id)
  const doc = await db.document.create({
    data: {
      title: `Paylaşılan ${stamp}`, channelId: channel.id,
      visibility: 'PRIVATE', createdById: owner.id,
      shares: { create: { userId: reader.id, permission: 'VIEW' } },
    },
  })

  await signInAs(context, reader.id)
  await page.goto(`/docs/${doc.id}`)

  await expect(page.getByText('Bu dokümanı yalnızca görüntüleyebilirsin.')).toBeVisible()
  await expect(page.getByLabel('Doküman başlığı')).toBeDisabled()
})
