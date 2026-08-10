import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/reset-db'
import { seedBootstrapInvite } from '../../prisma/seed'

beforeEach(resetDb)

describe('seedBootstrapInvite', () => {
  it('boş veritabanında ADMIN yetkili, sahipsiz bir davet üretir', async () => {
    const result = await seedBootstrapInvite()

    expect(result.ok).toBe(true)
    const invite = await db.invite.findFirstOrThrow()
    expect(invite.globalRole).toBe('ADMIN')
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
})
