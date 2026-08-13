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
      id: user.id, globalRole: user.globalRole, isActive: user.isActive,
      memberships: user.memberships.map((m) => ({ channelId: m.channelId, channelRole: m.channelRole })),
      permissions: [...new Set(user.roles.flatMap((r) => r.role.permissions))],
    }
  },
}))

const { deactivateMember, reactivateMember, updateMemberRole } = await import('@/server/members')

let admin: { id: string }
let target: { id: string }

beforeEach(async () => {
  await resetDb()
  admin = await db.user.create({ data: { name: 'Admin', globalRole: 'ADMIN' } })
  target = await db.user.create({ data: { name: 'Ayrılan' } })
})

describe('deactivateMember', () => {
  it('üyeyi pasife alır ve tüm oturumlarını siler', async () => {
    await db.session.create({
      data: { sessionToken: 'tok', userId: target.id, expires: new Date(Date.now() + 864e5) },
    })
    actorRef.current = admin.id

    const r = await deactivateMember({ userId: target.id })

    expect(r.ok).toBe(true)
    const updated = await db.user.findUniqueOrThrow({ where: { id: target.id } })
    expect(updated.isActive).toBe(false)
    expect(await db.session.count({ where: { userId: target.id } })).toBe(0)
  })

  it('düz üye başkasını pasife alamaz', async () => {
    actorRef.current = target.id
    const r = await deactivateMember({ userId: admin.id })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  it('admin kendini pasife alamaz', async () => {
    actorRef.current = admin.id
    const r = await deactivateMember({ userId: admin.id })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  it('pasife alma Activity kaydı bırakır', async () => {
    actorRef.current = admin.id
    await deactivateMember({ userId: target.id })
    const activity = await db.activity.findFirstOrThrow()
    expect(activity.verb).toBe('member.deactivated')
    expect(activity.actorId).toBe(admin.id)
    expect(activity.entityId).toBe(target.id)
  })

  it('var olmayan kullanıcı için NOT_FOUND döner', async () => {
    actorRef.current = admin.id
    const r = await deactivateMember({ userId: 'clxxxxxxxxxxxxxxxxxxxxxxx' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND')
  })

  // "Tek diğer admin"i pasifleştirmek çağıranı tek kalan admin yapar —
  // bu, tavan (>=1 aktif admin) korunduğu sürece İZİN VERİLMESİ gereken bir
  // durum: kendi kendini pasifleştirme zaten policy katmanında engellendiği
  // için (bkz. "admin kendini pasife alamaz"), çağıran her zaman ayrı ve
  // aktif bir admin olarak kalır — dolayısıyla tek bir (eş zamanlı olmayan)
  // çağrıda kalan aktif admin sayısı asla 0'a düşemez, bu senaryoda 1'e
  // düşer ve başarılı olmalı. updateMemberRole'deki simetriğiyle aynı
  // mantık ("ikinci admin varken biri MEMBER'a düşürülebilir").
  it('tek diğer admin\'i pasifleştirmek, çağıranı tek aktif admin bırakarak başarılı olur', async () => {
    const secondAdmin = await db.user.create({ data: { name: 'İkinci Admin', globalRole: 'ADMIN' } })
    actorRef.current = admin.id

    const r = await deactivateMember({ userId: secondAdmin.id })

    expect(r.ok).toBe(true)
    const remainingActiveAdmins = await db.user.count({ where: { globalRole: 'ADMIN', isActive: true } })
    expect(remainingActiveAdmins).toBe(1)
  })

  it('iki eş zamanlı deactivateMember isteği aynı iki admin birbirini hedef alırsa yalnızca biri başarılı olur, en az biri aktif kalır', async () => {
    const secondAdmin = await db.user.create({ data: { name: 'İkinci Admin', globalRole: 'ADMIN' } })

    actorRef.current = admin.id
    const call1 = deactivateMember({ userId: secondAdmin.id })
    actorRef.current = secondAdmin.id
    const call2 = deactivateMember({ userId: admin.id })
    const [r1, r2] = await Promise.all([call1, call2])

    const successCount = [r1, r2].filter((r) => r.ok).length
    expect(successCount).toBe(1)
    const failedResult = r1.ok ? r2 : r1
    expect(failedResult.ok).toBe(false)
    if (!failedResult.ok) expect(failedResult.error.code).toBe('CONFLICT')

    const remainingActiveAdmins = await db.user.count({ where: { globalRole: 'ADMIN', isActive: true } })
    expect(remainingActiveAdmins).toBeGreaterThanOrEqual(1)
    expect(remainingActiveAdmins).toBe(1)
  })
})

describe('reactivateMember', () => {
  it('pasif üyeyi yeniden etkinleştirir', async () => {
    await db.user.update({ where: { id: target.id }, data: { isActive: false } })
    actorRef.current = admin.id

    const r = await reactivateMember({ userId: target.id })

    expect(r.ok).toBe(true)
    const updated = await db.user.findUniqueOrThrow({ where: { id: target.id } })
    expect(updated.isActive).toBe(true)
  })

  it('düz üye başkasını yeniden etkinleştiremez', async () => {
    const bystander = await db.user.create({ data: { name: 'Yoldan Geçen' } })
    await db.user.update({ where: { id: target.id }, data: { isActive: false } })
    actorRef.current = bystander.id

    const r = await reactivateMember({ userId: target.id })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
    const unchanged = await db.user.findUniqueOrThrow({ where: { id: target.id } })
    expect(unchanged.isActive).toBe(false)
  })

  it('var olmayan kullanıcı için NOT_FOUND döner', async () => {
    actorRef.current = admin.id
    const r = await reactivateMember({ userId: 'clxxxxxxxxxxxxxxxxxxxxxxx' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND')
  })

  it('zaten aktif bir üyeyi etkinleştirmek de başarılı olur (idempotent)', async () => {
    actorRef.current = admin.id
    const r = await reactivateMember({ userId: target.id })
    expect(r.ok).toBe(true)
    const unchanged = await db.user.findUniqueOrThrow({ where: { id: target.id } })
    expect(unchanged.isActive).toBe(true)
  })

  it('etkinleştirme Activity kaydı bırakır', async () => {
    await db.user.update({ where: { id: target.id }, data: { isActive: false } })
    actorRef.current = admin.id
    await reactivateMember({ userId: target.id })
    const activity = await db.activity.findFirstOrThrow()
    expect(activity.verb).toBe('member.reactivated')
    expect(activity.actorId).toBe(admin.id)
    expect(activity.entityId).toBe(target.id)
  })
})

describe('karma yarış: deactivateMember ile updateMemberRole aynı admin havuzunu paylaşır', () => {
  it('updateMemberRole(B→MEMBER) ile deactivateMember(A) eş zamanlı çalışırsa en az bir aktif admin kalır', async () => {
    const adminB = await db.user.create({ data: { name: 'B Admin', globalRole: 'ADMIN' } })

    actorRef.current = admin.id
    const demoteB = updateMemberRole({ userId: adminB.id, globalRole: 'MEMBER' })
    actorRef.current = adminB.id
    const deactivateA = deactivateMember({ userId: admin.id })
    const [r1, r2] = await Promise.all([demoteB, deactivateA])

    const successCount = [r1, r2].filter((r) => r.ok).length
    expect(successCount).toBe(1)
    const failedResult = r1.ok ? r2 : r1
    expect(failedResult.ok).toBe(false)
    if (!failedResult.ok) expect(failedResult.error.code).toBe('CONFLICT')

    const remainingActiveAdmins = await db.user.count({ where: { globalRole: 'ADMIN', isActive: true } })
    expect(remainingActiveAdmins).toBeGreaterThanOrEqual(1)
  })
})

describe('updateMemberRole', () => {
  it('admin bir üyeyi ADMIN yapabilir', async () => {
    actorRef.current = admin.id
    const r = await updateMemberRole({ userId: target.id, globalRole: 'ADMIN' })
    expect(r.ok).toBe(true)
    const updated = await db.user.findUniqueOrThrow({ where: { id: target.id } })
    expect(updated.globalRole).toBe('ADMIN')
  })

  it('düz üye rol değiştiremez', async () => {
    actorRef.current = target.id
    const r = await updateMemberRole({ userId: admin.id, globalRole: 'MEMBER' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  it('sistemde tek admin varsa kendisi MEMBER\'a düşürülemez', async () => {
    actorRef.current = admin.id
    const r = await updateMemberRole({ userId: admin.id, globalRole: 'MEMBER' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('CONFLICT')
    const unchanged = await db.user.findUniqueOrThrow({ where: { id: admin.id } })
    expect(unchanged.globalRole).toBe('ADMIN')
  })

  it('ikinci admin varken biri MEMBER\'a düşürülebilir', async () => {
    const secondAdmin = await db.user.create({ data: { name: 'İkinci Admin', globalRole: 'ADMIN' } })
    actorRef.current = admin.id
    const r = await updateMemberRole({ userId: secondAdmin.id, globalRole: 'MEMBER' })
    expect(r.ok).toBe(true)
    const updated = await db.user.findUniqueOrThrow({ where: { id: secondAdmin.id } })
    expect(updated.globalRole).toBe('MEMBER')
  })

  it('pasif admin sayılmaz: tek aktif admin kalıyorsa düşürme reddedilir', async () => {
    await db.user.create({ data: { name: 'Pasif Admin', globalRole: 'ADMIN', isActive: false } })
    actorRef.current = admin.id
    const r = await updateMemberRole({ userId: admin.id, globalRole: 'MEMBER' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('CONFLICT')
  })

  it('iki eş zamanlı istek aynı iki admin birbirini düşürmeye çalışırsa yalnızca biri başarılı olur', async () => {
    const secondAdmin = await db.user.create({ data: { name: 'İkinci Admin', globalRole: 'ADMIN' } })
    actorRef.current = admin.id

    const [r1, r2] = await Promise.all([
      updateMemberRole({ userId: admin.id, globalRole: 'MEMBER' }),
      updateMemberRole({ userId: secondAdmin.id, globalRole: 'MEMBER' }),
    ])

    const successCount = [r1, r2].filter((r) => r.ok).length
    expect(successCount).toBe(1)
    const failedResult = r1.ok ? r2 : r1
    expect(failedResult.ok).toBe(false)
    if (!failedResult.ok) expect(failedResult.error.code).toBe('CONFLICT')

    const remainingActiveAdmins = await db.user.count({ where: { globalRole: 'ADMIN', isActive: true } })
    expect(remainingActiveAdmins).toBeGreaterThanOrEqual(1)
    expect(remainingActiveAdmins).toBe(1)
  })

  it('var olmayan kullanıcı için NOT_FOUND döner', async () => {
    actorRef.current = admin.id
    const r = await updateMemberRole({ userId: 'clxxxxxxxxxxxxxxxxxxxxxxx', globalRole: 'ADMIN' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND')
  })

  it('rol değişince Activity kaydı bırakır', async () => {
    actorRef.current = admin.id
    await updateMemberRole({ userId: target.id, globalRole: 'ADMIN' })
    const activity = await db.activity.findFirstOrThrow()
    expect(activity.verb).toBe('member.roleChanged')
    expect(activity.actorId).toBe(admin.id)
    expect(activity.entityId).toBe(target.id)
  })
})
