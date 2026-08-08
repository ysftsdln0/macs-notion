import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { createInviteToken } from '../../src/lib/auth/invite-token'

const db = new PrismaClient()

test('süresi dolmuş davet reddedilir', async ({ page }) => {
  const admin = await db.user.create({
    data: { name: 'Admin', email: `a-${Date.now()}@x.com`, globalRole: 'ADMIN', onboardedAt: new Date() },
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
