import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/reset-db'

const actorRef: { current: string | null } = { current: null }
vi.mock('@/lib/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/session')>()),
  getActor: async () => {
    if (!actorRef.current) return null
    const user = await db.user.findUniqueOrThrow({
      where: { id: actorRef.current },
      include: {
        memberships: true,
        roles: { select: { role: { select: { permissions: true } } } },
      },
    })
    return {
      id: user.id,
      globalRole: user.globalRole,
      isActive: user.isActive,
      memberships: user.memberships.map((m) => ({ channelId: m.channelId, channelRole: m.channelRole })),
      permissions: [...new Set(user.roles.flatMap((r) => r.role.permissions))],
    }
  },
}))

const { createInvite } = await import('@/server/invites')

let superadmin: { id: string }
let admin: { id: string }
let hr: { id: string }

beforeEach(async () => {
  await resetDb()
  superadmin = await db.user.create({ data: { name: 'Sahip', globalRole: 'SUPERADMIN' } })
  admin = await db.user.create({ data: { name: 'Başkan', globalRole: 'ADMIN' } })

  const role = await db.role.create({
    data: {
      name: 'İnsan Kaynakları', slug: 'insan-kaynaklari', position: 1,
      permissions: ['INVITE_MANAGE'],
    },
  })
  hr = await db.user.create({ data: { name: 'İK' } })
  await db.userRole.create({ data: { userId: hr.id, roleId: role.id } })
})

describe('createInvite', () => {
  it('INVITE_MANAGE taşıyan düz üye davet üretir', async () => {
    actorRef.current = hr.id

    const r = await createInvite({ globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER' })

    expect(r.ok).toBe(true)
    expect(await db.invite.count()).toBe(1)
  })

  it('izinsiz üye davet üretemez', async () => {
    const plain = await db.user.create({ data: { name: 'Düz' } })
    actorRef.current = plain.id

    const r = await createInvite({ globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER' })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
    expect(await db.invite.count()).toBe(0)
  })

  // Aksi halde INVITE_MANAGE taşıyan biri kendine sistem sahibi daveti üretip
  // bağlantıyı kendi açarak sınırsız yetkiye çıkardı.
  it('SUPERADMIN olmayan, SUPERADMIN daveti üretemez', async () => {
    actorRef.current = hr.id

    const r = await createInvite({
      globalRole: 'SUPERADMIN', channelId: null, channelRole: 'MEMBER',
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
    expect(await db.invite.count()).toBe(0)
  })

  it('ADMIN da SUPERADMIN daveti üretemez', async () => {
    actorRef.current = admin.id

    const r = await createInvite({
      globalRole: 'SUPERADMIN', channelId: null, channelRole: 'MEMBER',
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
    expect(await db.invite.count()).toBe(0)
  })

  it('SUPERADMIN, SUPERADMIN daveti üretebilir', async () => {
    actorRef.current = superadmin.id

    const r = await createInvite({
      globalRole: 'SUPERADMIN', channelId: null, channelRole: 'MEMBER',
    })

    expect(r.ok).toBe(true)
    const invite = await db.invite.findFirstOrThrow()
    expect(invite.globalRole).toBe('SUPERADMIN')
  })
})
