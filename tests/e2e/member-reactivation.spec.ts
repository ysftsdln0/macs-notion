import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { signInAs } from './helpers/session'

const db = new PrismaClient()

/**
 * I3 regresyon testi: `deactivateMember` uygulanabilir ama tersi
 * (`reactivateMember`) yoktu — pasife alınan bir üyenin tek kurtarma yolu
 * VPS'te elle psql çalıştırmaktı. Bu testler hem geri dönüş yolunun var
 * olduğunu hem de her iki onay diyaloğunun ismi geçirdiğini doğrular
 * (yanlış satırda tıklayan bir admin artık kimi etkilediğini görmeden
 * geri dönüşü olmayan bir işlem tetiklemiyor).
 */

test('admin bir üyeyi pasifleştirir (isim onayla geçer) ve ardından yeniden etkinleştirir (isim onayla geçer)', async ({
  page, context,
}) => {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const admin = await db.user.create({
    data: { name: 'Yönetici', email: `admin-${stamp}@x.com`, globalRole: 'ADMIN', onboardedAt: new Date() },
  })
  const targetName = `Devre Dışı Aday ${stamp}`
  const target = await db.user.create({
    data: { name: targetName, email: `target-${stamp}@x.com`, onboardedAt: new Date() },
  })

  await signInAs(context, admin.id)
  await page.goto('/members')

  const targetRow = page.getByRole('row', { name: new RegExp(targetName) })
  await expect(targetRow).toBeVisible()

  // `window.confirm()` render sürecini onaylanana kadar bloklar; click()
  // promise'i de dialog kapanana kadar resolve olmaz. Bu yüzden dialog'u
  // BEKLEMEK yerine, tetiklenir tetiklenmez kabul eden bir dinleyici click'ten
  // ÖNCE kaydedilir (aksi halde click() ile dialog.accept() birbirini bekler
  // ve test asla ilerlemez).
  let deactivateMessage = ''
  page.once('dialog', (dialog) => {
    deactivateMessage = dialog.message()
    void dialog.accept()
  })
  await targetRow.getByRole('button', { name: 'Pasifleştir' }).click()
  // "Pasif" metni "Pasifleştir" düğmesinin bir alt dizesi olduğu için
  // toContainText('Pasif') deaktivasyon tamamlanmadan da (düğme her zaman
  // ekranda olduğundan) anında geçerdi. Bunun yerine yalnızca isActive:false
  // olduğunda render edilen "Etkinleştir" düğmesini bekliyoruz — bu, sunucu
  // action'ının gerçekten tamamlandığının güvenilir bir işareti.
  await expect(targetRow.getByRole('button', { name: 'Etkinleştir' })).toBeVisible()
  expect(deactivateMessage).toContain(targetName)
  const afterDeactivate = await db.user.findUniqueOrThrow({ where: { id: target.id } })
  expect(afterDeactivate.isActive).toBe(false)

  let reactivateMessage = ''
  page.once('dialog', (dialog) => {
    reactivateMessage = dialog.message()
    void dialog.accept()
  })
  await targetRow.getByRole('button', { name: 'Etkinleştir' }).click()
  await expect(targetRow.getByRole('button', { name: 'Pasifleştir' })).toBeVisible()
  expect(reactivateMessage).toContain(targetName)

  await expect(targetRow).toContainText('Aktif')
  const afterReactivate = await db.user.findUniqueOrThrow({ where: { id: target.id } })
  expect(afterReactivate.isActive).toBe(true)
})

test('düz üye pasif üyeleri görmez, admin görür', async ({ page, context }) => {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const admin = await db.user.create({
    data: { name: 'Görünürlük Admin', email: `visadmin-${stamp}@x.com`, globalRole: 'ADMIN', onboardedAt: new Date() },
  })
  const bystander = await db.user.create({
    data: { name: 'Görünürlük Üyesi', email: `visplain-${stamp}@x.com`, onboardedAt: new Date() },
  })
  const inactiveName = `Gizli Pasif ${stamp}`
  await db.user.create({
    data: { name: inactiveName, email: `inactive-${stamp}@x.com`, onboardedAt: new Date(), isActive: false },
  })

  await signInAs(context, bystander.id)
  await page.goto('/members')
  await expect(page.getByText(inactiveName)).toHaveCount(0)

  await signInAs(context, admin.id)
  await page.goto('/members')
  await expect(page.getByText(inactiveName)).toBeVisible()
})
