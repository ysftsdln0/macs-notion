import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/reset-db'

beforeEach(async () => {
  await resetDb()
})

describe('rol şeması', () => {
  it('rolü izinleriyle birlikte saklar', async () => {
    const role = await db.role.create({
      data: {
        name: 'Yönetim Kurulu',
        slug: 'yonetim-kurulu',
        position: 1,
        isSystem: true,
        permissions: ['CONTENT_READ_ALL', 'BUDGET_READ_ALL'],
      },
    })

    expect(role.permissions).toEqual(['CONTENT_READ_ALL', 'BUDGET_READ_ALL'])
    expect(role.color).toBeNull()
    expect(role.isSystem).toBe(true)
  })

  it('izinsiz rol boş dizi ile açılır', async () => {
    const role = await db.role.create({
      data: { name: 'Aktif Üye', slug: 'aktif-uye', position: 2 },
    })
    expect(role.permissions).toEqual([])
    expect(role.isSystem).toBe(false)
  })

  it('aynı kullanıcıya aynı rolü iki kez veremez', async () => {
    const user = await db.user.create({ data: { name: 'Efe' } })
    const role = await db.role.create({
      data: { name: 'Yönetim Kurulu', slug: 'yonetim-kurulu', position: 1 },
    })
    await db.userRole.create({ data: { userId: user.id, roleId: role.id } })

    await expect(
      db.userRole.create({ data: { userId: user.id, roleId: role.id } }),
    ).rejects.toThrow()
  })

  it('kullanıcı silinince rol ataması da silinir', async () => {
    const user = await db.user.create({ data: { name: 'Efe' } })
    const role = await db.role.create({
      data: { name: 'Yönetim Kurulu', slug: 'yonetim-kurulu', position: 1 },
    })
    await db.userRole.create({ data: { userId: user.id, roleId: role.id } })

    await db.user.delete({ where: { id: user.id } })

    expect(await db.userRole.count()).toBe(0)
  })

  it('rolü veren kişi silinince atama kalır, grantedById boşalır', async () => {
    const user = await db.user.create({ data: { name: 'Efe' } })
    const granter = await db.user.create({ data: { name: 'Başkan' } })
    const role = await db.role.create({
      data: { name: 'Yönetim Kurulu', slug: 'yonetim-kurulu', position: 1 },
    })
    await db.userRole.create({
      data: { userId: user.id, roleId: role.id, grantedById: granter.id },
    })

    await db.user.delete({ where: { id: granter.id } })

    const assignment = await db.userRole.findFirstOrThrow({ where: { userId: user.id } })
    expect(assignment.grantedById).toBeNull()
  })

  it('SUPERADMIN global rolünü kabul eder', async () => {
    const user = await db.user.create({ data: { name: 'Sahip', globalRole: 'SUPERADMIN' } })
    expect(user.globalRole).toBe('SUPERADMIN')
  })

  // Sıralamayı değiştiren bir arayüz yok; `position` yalnızca rozet sırası.
  // Unique kısıt, sabit pozisyonlu sistem rolü eklemeyi (ve e2e'de rastgele
  // pozisyon üretmeyi) zorunlu kılıyordu, karşılığında hiçbir şey korumuyordu.
  it('iki rol aynı pozisyonu paylaşabilir', async () => {
    await db.role.create({ data: { name: 'Bir', slug: 'bir', position: 1 } })

    await expect(
      db.role.create({ data: { name: 'İki', slug: 'iki', position: 1 } }),
    ).resolves.toMatchObject({ position: 1 })
  })
})
