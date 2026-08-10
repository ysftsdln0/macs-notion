import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { signInAs } from './helpers/session'

const db = new PrismaClient()

/**
 * C2 regresyon testi: `/onboarding`, `(app)/layout.tsx`'in HER onboard
 * edilmemiş kullanıcıyı yönlendirdiği tek sayfa. Düzeltilmemiş kodda
 * `cookies().delete()` render sırasında çağrıldığı için (Server Action/Route
 * Handler fazı dışında yasak — Next 16 bunu istisna olarak fırlatır) bu
 * sayfa HER istekte 500 döner ve uygulamanın tamamı erişilemez hale gelir.
 * Bu test hem `next dev` hem `pnpm build && pnpm start:standalone` (bkz.
 * playwright.config.ts) altında gerçek bir HTTP isteğiyle çalışır.
 */
test('/onboarding, onboard edilmemiş oturum açmış kullanıcı için 200 döner ve profil formunu gösterir', async ({
  page,
  context,
}) => {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const user = await db.user.create({
    data: { name: 'Google Adı', email: `onboard-${stamp}@x.com` },
  })

  await signInAs(context, user.id)

  const response = await page.goto('/onboarding')

  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Profilini tamamla' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Tamamla|Kaydet|Devam/ })).toBeAttached()
})

test('zaten onboard edilmiş kullanıcı /onboarding\'e gidince ana sayfaya yönlenir', async ({
  page,
  context,
}) => {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const user = await db.user.create({
    data: { name: 'Zaten Hazır', email: `done-${stamp}@x.com`, onboardedAt: new Date() },
  })

  await signInAs(context, user.id)

  const response = await page.goto('/onboarding')

  expect(response?.status()).not.toBe(500)
  await expect(page).toHaveURL(/\/$/)
})
