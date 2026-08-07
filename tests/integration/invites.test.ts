import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { consumeInvite } from '@/server/invites'
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

async function seedInvite(overrides: Partial<{ expiresAt: Date; revokedAt: Date }> = {}) {
  const { token, tokenHash } = createInviteToken()
  await db.invite.create({
    data: {
      tokenHash,
      channelId,
      channelRole: 'MEMBER',
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 7 * 864e5),
      revokedAt: overrides.revokedAt ?? null,
      createdById: adminId,
    },
  })
  return token
}

describe('consumeInvite', () => {
  it('geçerli daveti kullanır, kanala üye yapar ve daveti işaretler', async () => {
    const token = await seedInvite()
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
    const token = await seedInvite()
    const first = await db.user.create({ data: { name: 'A', email: 'a@x.com' } })
    const second = await db.user.create({ data: { name: 'B', email: 'b@x.com' } })

    await consumeInvite(token, first.id)
    const r = await consumeInvite(token, second.id)

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('CONFLICT')
  })

  it('süresi dolmuş daveti reddeder', async () => {
    const token = await seedInvite({ expiresAt: new Date(Date.now() - 1000) })
    const user = await db.user.create({ data: { name: 'C', email: 'c@x.com' } })
    const r = await consumeInvite(token, user.id)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('CONFLICT')
  })

  it('iptal edilmiş daveti reddeder', async () => {
    const token = await seedInvite({ revokedAt: new Date() })
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
    const token = await seedInvite()
    const user = await db.user.create({ data: { name: 'F', email: 'f@x.com' } })
    await consumeInvite(token, user.id)
    const activity = await db.activity.findFirstOrThrow()
    expect(activity.verb).toBe('invite.accepted')
    expect(activity.actorId).toBe(user.id)
  })
})
