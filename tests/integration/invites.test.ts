import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { applyInvite, claimInvite, consumeInvite } from '@/server/invite-service'
import { createInviteToken } from '@/lib/auth/invite-token'

let adminId: string
let channelId: string

beforeEach(async () => {
  await db.activity.deleteMany()
  await db.invite.deleteMany()
  await db.channelMember.deleteMany()
  await db.channel.deleteMany()
  await db.user.deleteMany()

  const admin = await db.user.create({ data: { name: 'Admin', globalRole: 'ADMIN' } })
  adminId = admin.id
  const channel = await db.channel.create({
    data: { name: 'Proje', slug: 'proje', createdById: admin.id },
  })
  channelId = channel.id
})

async function seedInvite(
  overrides: Partial<{
    expiresAt: Date
    revokedAt: Date
    channelId: string | null
    globalRole: 'ADMIN' | 'MEMBER'
  }> = {},
) {
  const { token, tokenHash } = createInviteToken()
  const invite = await db.invite.create({
    data: {
      tokenHash,
      globalRole: overrides.globalRole ?? 'MEMBER',
      channelId: 'channelId' in overrides ? overrides.channelId : channelId,
      channelRole: 'MEMBER',
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 7 * 864e5),
      revokedAt: overrides.revokedAt ?? null,
      createdById: adminId,
    },
  })
  return { token, tokenHash, inviteId: invite.id }
}

describe('consumeInvite', () => {
  it('geçerli daveti kullanır, kanala üye yapar ve daveti işaretler', async () => {
    const { token } = await seedInvite()
    const user = await db.user.create({ data: { name: 'Yeni', email: 'y@x.com' } })

    const r = await consumeInvite(token, user.id)

    expect(r).toEqual({ ok: true, data: { channelId } })
    const membership = await db.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: user.id } },
    })
    expect(membership?.channelRole).toBe('MEMBER')
    const invite = await db.invite.findFirstOrThrow()
    expect(invite.usedByUserId).toBe(user.id)
    expect(invite.usedAt).not.toBeNull()
  })

  it('aynı davet ikinci kez kullanılamaz', async () => {
    const { token } = await seedInvite()
    const first = await db.user.create({ data: { name: 'A', email: 'a@x.com' } })
    const second = await db.user.create({ data: { name: 'B', email: 'b@x.com' } })

    await consumeInvite(token, first.id)
    const r = await consumeInvite(token, second.id)

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('CONFLICT')
  })

  it('süresi dolmuş daveti reddeder', async () => {
    const { token } = await seedInvite({ expiresAt: new Date(Date.now() - 1000) })
    const user = await db.user.create({ data: { name: 'C', email: 'c@x.com' } })
    const r = await consumeInvite(token, user.id)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('CONFLICT')
  })

  it('iptal edilmiş daveti reddeder', async () => {
    const { token } = await seedInvite({ revokedAt: new Date() })
    const user = await db.user.create({ data: { name: 'D', email: 'd@x.com' } })
    const r = await consumeInvite(token, user.id)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('CONFLICT')
  })

  it('bilinmeyen token için NOT_FOUND döner', async () => {
    const user = await db.user.create({ data: { name: 'E', email: 'e@x.com' } })
    const r = await consumeInvite('bilinmeyen-token', user.id)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND')
  })

  it('daveti kullanınca Activity kaydı düşer', async () => {
    const { token } = await seedInvite()
    const user = await db.user.create({ data: { name: 'F', email: 'f@x.com' } })
    await consumeInvite(token, user.id)
    const activity = await db.activity.findFirstOrThrow()
    expect(activity.verb).toBe('invite.accepted')
    expect(activity.actorId).toBe(user.id)
  })

  it('aynı token ikinci kez consumeInvite çağrılırsa CONFLICT döner', async () => {
    const { token } = await seedInvite()
    const user = await db.user.create({ data: { name: 'G', email: 'g@x.com' } })

    const first = await consumeInvite(token, user.id)
    const second = await consumeInvite(token, user.id)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.code).toBe('CONFLICT')
  })

  it('mevcut kullanıcı ikinci bir daveti başarıyla kullanabilir (usedByUserId artık benzersiz değil)', async () => {
    const secondChannel = await db.channel.create({
      data: { name: 'İkinci', slug: 'ikinci', createdById: adminId },
    })
    const { token: tokenA } = await seedInvite()
    const { token: tokenB } = await seedInvite({ channelId: secondChannel.id })
    const user = await db.user.create({ data: { name: 'H', email: 'h@x.com' } })

    const first = await consumeInvite(tokenA, user.id)
    const second = await consumeInvite(tokenB, user.id)

    expect(first).toEqual({ ok: true, data: { channelId } })
    expect(second).toEqual({ ok: true, data: { channelId: secondChannel.id } })

    const usedInvites = await db.invite.findMany({ where: { usedByUserId: user.id } })
    expect(usedInvites).toHaveLength(2)
  })

  it('sahiplenme başarısız olunca applyInvite hiç çalışmaz: ikinci kullanıcı üyelik veya rol kazanmaz', async () => {
    const { token } = await seedInvite({ globalRole: 'ADMIN' })
    const first = await db.user.create({ data: { name: 'K', email: 'k@x.com' } })
    const second = await db.user.create({ data: { name: 'L', email: 'l@x.com' } })

    const firstResult = await consumeInvite(token, first.id)
    const secondResult = await consumeInvite(token, second.id)

    expect(firstResult.ok).toBe(true)
    expect(secondResult.ok).toBe(false)
    if (!secondResult.ok) expect(secondResult.error.code).toBe('CONFLICT')

    const secondMembership = await db.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: second.id } },
    })
    expect(secondMembership).toBeNull()
    const secondUser = await db.user.findUniqueOrThrow({ where: { id: second.id } })
    expect(secondUser.globalRole).toBe('MEMBER')
  })
})

describe('claimInvite', () => {
  it('bilinmeyen hash için false döner', async () => {
    await expect(claimInvite('bilinmeyen-hash')).resolves.toBe(false)
  })

  it('zaten kullanılmış davet için false döner', async () => {
    const { tokenHash } = await seedInvite()
    await expect(claimInvite(tokenHash)).resolves.toBe(true)
    await expect(claimInvite(tokenHash)).resolves.toBe(false)
  })

  it('iptal edilmiş davet için false döner', async () => {
    const { tokenHash } = await seedInvite({ revokedAt: new Date() })
    await expect(claimInvite(tokenHash)).resolves.toBe(false)
  })

  it('süresi dolmuş davet için false döner', async () => {
    const { tokenHash } = await seedInvite({ expiresAt: new Date(Date.now() - 1000) })
    await expect(claimInvite(tokenHash)).resolves.toBe(false)
  })

  it('geçerli davet için tam olarak bir kez true döner', async () => {
    const { tokenHash } = await seedInvite()
    await expect(claimInvite(tokenHash)).resolves.toBe(true)
    await expect(claimInvite(tokenHash)).resolves.toBe(false)
  })

  it('eşzamanlı iki çağrıdan yalnızca biri true döner', async () => {
    const { tokenHash } = await seedInvite()

    const [a, b] = await Promise.all([claimInvite(tokenHash), claimInvite(tokenHash)])

    expect([a, b].filter(Boolean)).toHaveLength(1)
  })
})

describe('applyInvite', () => {
  it('kanal üyeliği verir, ADMIN rolü uygular ve activity kaydeder', async () => {
    const { inviteId, tokenHash } = await seedInvite({ globalRole: 'ADMIN' })
    await claimInvite(tokenHash)
    const user = await db.user.create({ data: { name: 'I', email: 'i@x.com' } })

    const r = await applyInvite(inviteId, user.id)

    expect(r).toEqual({ ok: true, data: { channelId } })
    const membership = await db.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: user.id } },
    })
    expect(membership?.channelRole).toBe('MEMBER')
    const updatedUser = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(updatedUser.globalRole).toBe('ADMIN')
    const activity = await db.activity.findFirstOrThrow()
    expect(activity.verb).toBe('invite.accepted')
    expect(activity.actorId).toBe(user.id)
  })

  it('bilinmeyen davet id için NOT_FOUND döner', async () => {
    const user = await db.user.create({ data: { name: 'J', email: 'j@x.com' } })
    const r = await applyInvite('bilinmeyen-id', user.id)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND')
  })
})
