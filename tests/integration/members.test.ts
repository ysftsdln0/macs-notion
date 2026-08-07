import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'

const actorRef: { current: string | null } = { current: null }
vi.mock('@/lib/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/session')>()),
  getActor: async () => {
    if (!actorRef.current) return null
    const user = await db.user.findUniqueOrThrow({
      where: { id: actorRef.current }, include: { memberships: true },
    })
    return {
      id: user.id, globalRole: user.globalRole, isActive: user.isActive,
      memberships: user.memberships.map((m) => ({ channelId: m.channelId, channelRole: m.channelRole })),
    }
  },
}))

const { deactivateMember, updateMemberRole } = await import('@/server/members')

let admin: { id: string }
let target: { id: string }

beforeEach(async () => {
  await db.activity.deleteMany()
  await db.session.deleteMany()
  await db.channelMember.deleteMany()
  await db.invite.deleteMany()
  await db.channel.deleteMany()
  await db.user.deleteMany()
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

  it('rol değişince Activity kaydı bırakır', async () => {
    actorRef.current = admin.id
    await updateMemberRole({ userId: target.id, globalRole: 'ADMIN' })
    const activity = await db.activity.findFirstOrThrow()
    expect(activity.verb).toBe('member.roleChanged')
    expect(activity.actorId).toBe(admin.id)
    expect(activity.entityId).toBe(target.id)
  })
})
