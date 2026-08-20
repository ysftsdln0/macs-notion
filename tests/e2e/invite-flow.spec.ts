import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { createInviteToken } from '../../src/lib/auth/invite-token'
import { signInAs } from './helpers/session'

const db = new PrismaClient()

test('süresi dolmuş davet reddedilir', async ({ page }) => {
  // Date.now() tek başına yeterli değil: Playwright iki worker'ı paralel
  // çalıştırıyor, aynı milisaniyede farklı worker'ların üreteceği e-posta
  // User.email tekil kısıtına çarpabilirdi. randomUUID eki bunu imkansız kılar.
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const admin = await db.user.create({
    data: { name: 'Admin', email: `a-${stamp}@x.com`, globalRole: 'ADMIN', onboardedAt: new Date() },
  })
  const { token, tokenHash } = createInviteToken()
  await db.invite.create({
    data: { tokenHash, expiresAt: new Date(Date.now() - 1000), createdById: admin.id },
  })

  await page.goto(`/invite/${token}`)
  await expect(page.getByText('Davet geçersiz')).toBeVisible()
})

test("bilinmeyen davet token'ı geçersiz sayfası gösterir", async ({ page }) => {
  await page.goto('/invite/gecersiz-token-123')
  await expect(page.getByText('Davet geçersiz')).toBeVisible()
})

test('çok kullanımlı davet listede kullanım sayısıyla görünür', async ({ page }) => {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const admin = await db.user.create({
    data: { name: 'Admin', email: `a-${stamp}@x.com`, globalRole: 'ADMIN', onboardedAt: new Date() },
  })
  const { tokenHash } = createInviteToken()
  const invite = await db.invite.create({
    data: {
      tokenHash,
      label: `Stand ${stamp}`,
      maxUses: 2,
      expiresAt: new Date(Date.now() + 864e5),
      createdById: admin.id,
    },
  })
  const joined = await db.user.create({
    data: { name: `Katılan ${stamp}`, email: `k-${stamp}@x.com`, onboardedAt: new Date() },
  })
  await db.inviteRedemption.create({
    data: { inviteId: invite.id, userId: joined.id, redeemedAt: new Date() },
  })

  await signInAs(page.context(), admin.id)
  await page.goto('/admin')

  await expect(page.getByText(`Stand ${stamp}`)).toContainText('1/2 kullanıldı')
  await expect(page.getByText(`Katılan ${stamp}`)).toBeVisible()
})
