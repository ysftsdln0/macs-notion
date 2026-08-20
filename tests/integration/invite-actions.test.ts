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

  // Kademe dağıtmak SUPERADMIN kapısıdır. Davet ikinci kapıdır ve kapalı
  // tutulmazsa birincisini anlamsız kılar: /invite/<token> sayfası oturum açmış
  // kullanıcıya daveti KENDİSİ için uygulatır, yani INVITE_MANAGE taşıyan düz
  // bir üye kendine ADMIN daveti üretip iki tıkta ADMIN olabilirdi.
  it('INVITE_MANAGE taşıyan düz üye ADMIN daveti üretemez', async () => {
    actorRef.current = hr.id

    const r = await createInvite({
      globalRole: 'ADMIN', channelId: null, channelRole: 'MEMBER', duration: 'DAY',
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
    expect(await db.invite.count()).toBe(0)
  })

  it('ADMIN bile ADMIN daveti üretemez — kademe dağıtımı SUPERADMIN’de', async () => {
    actorRef.current = admin.id

    const r = await createInvite({
      globalRole: 'ADMIN', channelId: null, channelRole: 'MEMBER', duration: 'DAY',
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
    expect(await db.invite.count()).toBe(0)
  })

  it('SUPERADMIN, ADMIN daveti üretebilir', async () => {
    actorRef.current = superadmin.id

    const r = await createInvite({
      globalRole: 'ADMIN', channelId: null, channelRole: 'MEMBER', duration: 'DAY',
    })

    expect(r.ok).toBe(true)
    const invite = await db.invite.findFirstOrThrow()
    expect(invite.globalRole).toBe('ADMIN')
  })

  it('SUPERADMIN olmayan, SUPERADMIN daveti üretemez', async () => {
    actorRef.current = hr.id

    const r = await createInvite({
      globalRole: 'SUPERADMIN', channelId: null, channelRole: 'MEMBER', duration: 'DAY',
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
    expect(await db.invite.count()).toBe(0)
  })

  it('ADMIN da SUPERADMIN daveti üretemez', async () => {
    actorRef.current = admin.id

    const r = await createInvite({
      globalRole: 'SUPERADMIN', channelId: null, channelRole: 'MEMBER', duration: 'DAY',
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
    expect(await db.invite.count()).toBe(0)
  })

  it('SUPERADMIN, SUPERADMIN daveti üretebilir', async () => {
    actorRef.current = superadmin.id

    const r = await createInvite({
      globalRole: 'SUPERADMIN', channelId: null, channelRole: 'MEMBER', duration: 'DAY',
    })

    expect(r.ok).toBe(true)
    const invite = await db.invite.findFirstOrThrow()
    expect(invite.globalRole).toBe('SUPERADMIN')
  })

  it('seçilen süre daveti o kadar yaşatır', async () => {
    actorRef.current = admin.id

    const r = await createInvite({
      globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER', duration: 'HOUR',
    })

    expect(r.ok).toBe(true)
    const invite = await db.invite.findFirstOrThrow()
    expect(invite.expiresAt!.getTime() - Date.now()).toBeLessThan(61 * 60 * 1000)
    expect(invite.expiresAt!.getTime() - Date.now()).toBeGreaterThan(59 * 60 * 1000)
  })

  it('FOREVER süresiz davet üretir', async () => {
    actorRef.current = admin.id

    await createInvite({
      globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER', duration: 'FOREVER',
    })

    const invite = await db.invite.findFirstOrThrow()
    expect(invite.expiresAt).toBeNull()
  })

  it('süre verilmezse 7 gündür', async () => {
    actorRef.current = admin.id

    await createInvite({ globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER' })

    const invite = await db.invite.findFirstOrThrow()
    expect(invite.expiresAt!.getTime() - Date.now()).toBeGreaterThan(6.9 * 864e5)
  })

  it('kullanım limiti davete yazılır', async () => {
    actorRef.current = admin.id

    await createInvite({
      globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER', maxUses: 25,
    })

    expect((await db.invite.findFirstOrThrow()).maxUses).toBe(25)
  })

  it('null limit sınırsız davet üretir', async () => {
    actorRef.current = admin.id

    await createInvite({
      globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER', maxUses: null,
    })

    expect((await db.invite.findFirstOrThrow()).maxUses).toBeNull()
  })

  it('limit verilmezse tek kullanımlıktır', async () => {
    actorRef.current = admin.id

    await createInvite({ globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER' })

    expect((await db.invite.findFirstOrThrow()).maxUses).toBe(1)
  })

  it('etiket davete yazılır', async () => {
    actorRef.current = admin.id

    await createInvite({
      globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER', label: 'Bahar standı',
    })

    expect((await db.invite.findFirstOrThrow()).label).toBe('Bahar standı')
  })

  it('boş etiket null olarak saklanır', async () => {
    actorRef.current = admin.id

    await createInvite({
      globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER', label: '   ',
    })

    expect((await db.invite.findFirstOrThrow()).label).toBeNull()
  })

  it('60 karakterden uzun etiket reddedilir', async () => {
    actorRef.current = admin.id

    const r = await createInvite({
      globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER', label: 'a'.repeat(61),
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('VALIDATION')
  })

  it('sıfır veya negatif limit reddedilir', async () => {
    actorRef.current = admin.id

    const r = await createInvite({
      globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER', maxUses: 0,
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('VALIDATION')
  })
})

describe('createInvite — kademe daveti sınırları', () => {
  it('ADMIN daveti çok kullanımlı olamaz', async () => {
    actorRef.current = superadmin.id

    const r = await createInvite({
      globalRole: 'ADMIN', channelId: null, channelRole: 'MEMBER', maxUses: 5, duration: 'DAY',
    })

    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('VALIDATION')
      expect(r.error.fields?.maxUses).toBeTruthy()
    }
    expect(await db.invite.count()).toBe(0)
  })

  it('ADMIN daveti sınırsız olamaz', async () => {
    actorRef.current = superadmin.id

    const r = await createInvite({
      globalRole: 'ADMIN', channelId: null, channelRole: 'MEMBER', maxUses: null, duration: 'DAY',
    })

    expect(r.ok).toBe(false)
  })

  it('SUPERADMIN daveti 24 saatten uzun yaşayamaz', async () => {
    actorRef.current = superadmin.id

    const r = await createInvite({
      globalRole: 'SUPERADMIN', channelId: null, channelRole: 'MEMBER', maxUses: 1, duration: 'WEEK',
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.fields?.duration).toBeTruthy()
  })

  it('ADMIN daveti süresiz olamaz', async () => {
    actorRef.current = superadmin.id

    const r = await createInvite({
      globalRole: 'ADMIN', channelId: null, channelRole: 'MEMBER', maxUses: 1, duration: 'FOREVER',
    })

    expect(r.ok).toBe(false)
  })

  it('sınırlar içindeki ADMIN daveti kabul edilir', async () => {
    actorRef.current = superadmin.id

    const r = await createInvite({
      globalRole: 'ADMIN', channelId: null, channelRole: 'MEMBER', maxUses: 1, duration: 'DAY',
    })

    expect(r.ok).toBe(true)
  })

  it('MEMBER daveti sınırsız ve süresiz olabilir', async () => {
    actorRef.current = admin.id

    const r = await createInvite({
      globalRole: 'MEMBER', channelId: null, channelRole: 'MEMBER', maxUses: null, duration: 'FOREVER',
    })

    expect(r.ok).toBe(true)
  })
})
