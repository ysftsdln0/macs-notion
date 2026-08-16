import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { signInAs } from './helpers/session'

const db = new PrismaClient()

// Not: paylaşılan bir storage state yok — her spec kendi oturum token'ını
// yaratır (bkz. helpers/session.ts). Bu yüzden burada oturumu gerçekten
// kapatmak başka spec'leri etkilemez.
test("çıkış yap butonu oturumu kapatır ve login'e döndürür", async ({ page, context }) => {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const user = await db.user.create({
    data: { name: 'Üye', email: `cikis-${stamp}@x.com`, onboardedAt: new Date() },
  })
  await signInAs(context, user.id)

  await page.goto('/')
  // Masaüstü görünümünde tek "Çıkış yap" butonu erişilebilirlik ağacında:
  // mobil üst çubuktaki ikizi `md:hidden` ile display:none olduğundan
  // getByRole onu görmez.
  await page.getByRole('button', { name: 'Çıkış yap' }).click()
  await expect(page).toHaveURL(/\/login/)

  // Oturum gerçekten kapandı: korumalı sayfa yeniden login'e düşmeli
  // (yalnızca yönlendirme değil, session kaydının da tüketildiğinin kanıtı).
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})
