import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/reset-db'
import { seedBootstrapInvite, seedSystemRoles } from '../../prisma/seed'

beforeEach(resetDb)

describe('seedBootstrapInvite', () => {
  // Kurulum daveti sistemin sahibini üretir: rol paneli SUPERADMIN kapısında
  // durduğu için ADMIN yetkili bir davet kimseye rol yönetimi açmaz.
  it('boş veritabanında SUPERADMIN yetkili, sahipsiz bir davet üretir', async () => {
    const result = await seedBootstrapInvite()

    expect(result.ok).toBe(true)
    const invite = await db.invite.findFirstOrThrow()
    expect(invite.globalRole).toBe('SUPERADMIN')
    expect(invite.createdById).toBeNull()
    expect(invite.channelId).toBeNull()
    expect(await db.user.count()).toBe(0)
  })

  it('ham token veritabanına yazılmaz', async () => {
    const result = await seedBootstrapInvite()
    if (!result.ok) throw new Error('beklenmedik')
    const invite = await db.invite.findFirstOrThrow()
    expect(invite.tokenHash).not.toBe(result.token)
    expect(result.url).toContain(result.token)
  })

  it('sistemde kullanıcı varsa çalışmayı reddeder', async () => {
    await db.user.create({ data: { name: 'Var Olan', email: 'a@x.com' } })
    const result = await seedBootstrapInvite()
    expect(result.ok).toBe(false)
    expect(await db.invite.count()).toBe(0)
  })

  it('art arda çalıştırıldığında ikinci seferde reddeder, tek davet kalır', async () => {
    const first = await seedBootstrapInvite()
    expect(first.ok).toBe(true)

    const second = await seedBootstrapInvite()
    expect(second.ok).toBe(false)

    expect(await db.invite.count()).toBe(1)
  })

  it('bekleyen davet süresi dolmuş veya iptal edilmişse yeniden üretime izin verir', async () => {
    const first = await seedBootstrapInvite()
    expect(first.ok).toBe(true)

    await db.invite.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })

    const second = await seedBootstrapInvite()
    expect(second.ok).toBe(true)

    expect(await db.invite.count()).toBe(2)
  })

  it('eş zamanlı iki çağrı yarış durumunda tek davet üretir', async () => {
    const [first, second] = await Promise.all([seedBootstrapInvite(), seedBootstrapInvite()])

    const results = [first, second]
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(await db.invite.count()).toBe(1)
  })
})

describe('seedSystemRoles', () => {
  it('üç sistem rolünü izinleriyle birlikte kurar', async () => {
    await seedSystemRoles()

    const roles = await db.role.findMany({ orderBy: { position: 'asc' } })
    expect(roles.map((r) => r.name)).toEqual([
      'Yönetim Kurulu', 'Genel Sekreter', 'İnsan Kaynakları',
    ])
    expect(roles.every((r) => r.isSystem)).toBe(true)

    // Yönetim Kurulu her şeye erişir; rol yönetimi hariç, o bir izin değil.
    const board = roles[0]!
    expect(board.permissions).toContain('CONTENT_READ_ALL')
    expect(board.permissions).toContain('CONTENT_WRITE_ALL')
    expect(board.permissions).toContain('BUDGET_WRITE_ALL')
    expect(board.permissions).toContain('TRASH_MANAGE')
  })

  it('ikinci kez çalıştırılınca kopya üretmez', async () => {
    await seedSystemRoles()
    await seedSystemRoles()

    expect(await db.role.count()).toBe(3)
  })

  // Panelden yapılan her ayar bir sonraki deploy'da geri alınmamalı.
  it('var olan rolün izinlerini ezmez', async () => {
    await seedSystemRoles()
    const board = await db.role.findUniqueOrThrow({ where: { slug: 'yonetim-kurulu' } })
    await db.role.update({
      where: { id: board.id },
      data: { permissions: ['CONTENT_READ_ALL'] },
    })

    await seedSystemRoles()

    const after = await db.role.findUniqueOrThrow({ where: { slug: 'yonetim-kurulu' } })
    expect(after.permissions).toEqual(['CONTENT_READ_ALL'])
  })
})
