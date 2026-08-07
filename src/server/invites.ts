'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { defineAction } from '@/lib/action'
import { getActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { createInviteToken, hashInviteToken } from '@/lib/auth/invite-token'
import { recordActivity } from '@/lib/activity'
import { fail, ok, type Result } from '@/lib/result'

const INVITE_TTL_DAYS = 7

export const createInvite = defineAction({
  input: z.object({
    globalRole: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
    channelId: z.string().cuid().nullable().default(null),
    channelRole: z.enum(['LEAD', 'MEMBER']).default('MEMBER'),
  }),
  getActor,
  authorize: async ({ actor }) => ({ allowed: can(actor, 'invite:create', { kind: 'invite' }) }),
  handler: async ({ actor, input }) => {
    const { token, tokenHash } = createInviteToken()
    const invite = await db.invite.create({
      data: {
        tokenHash,
        globalRole: input.globalRole,
        channelId: input.channelId,
        channelRole: input.channelRole,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 864e5),
        createdById: actor.id,
      },
    })
    await recordActivity(db, {
      actorId: actor.id, verb: 'invite.created',
      entityType: 'Invite', entityId: invite.id,
    })
    // Ham token yalnızca burada, bir kez döner. Veritabanında hash'i durur.
    return { url: `${process.env.AUTH_URL}/invite/${token}`, id: invite.id }
  },
})

export const revokeInvite = defineAction({
  input: z.object({ inviteId: z.string().cuid() }),
  getActor,
  authorize: async ({ actor }) => ({ allowed: can(actor, 'invite:revoke', { kind: 'invite' }) }),
  handler: async ({ actor, input }) => {
    await db.invite.update({
      where: { id: input.inviteId },
      data: { revokedAt: new Date() },
    })
    await recordActivity(db, {
      actorId: actor.id, verb: 'invite.revoked',
      entityType: 'Invite', entityId: input.inviteId,
    })
    return { id: input.inviteId }
  },
})

/**
 * Davet kullanımı. Action değildir: kullanıcı bu noktada yeni oturum açmıştır,
 * yetki kontrolü token'ın kendisidir.
 */
export async function consumeInvite(
  token: string,
  userId: string,
): Promise<Result<{ channelId: string | null }>> {
  const invite = await db.invite.findUnique({ where: { tokenHash: hashInviteToken(token) } })
  if (!invite) return fail('NOT_FOUND')
  if (invite.usedAt || invite.revokedAt || invite.expiresAt < new Date()) return fail('CONFLICT')

  await db.$transaction(async (tx) => {
    await tx.invite.update({
      where: { id: invite.id, usedAt: null },
      data: { usedAt: new Date(), usedByUserId: userId },
    })
    if (invite.globalRole === 'ADMIN') {
      await tx.user.update({ where: { id: userId }, data: { globalRole: 'ADMIN' } })
    }
    if (invite.channelId) {
      await tx.channelMember.upsert({
        where: { channelId_userId: { channelId: invite.channelId, userId } },
        create: { channelId: invite.channelId, userId, channelRole: invite.channelRole },
        update: {},
      })
    }
    await recordActivity(tx, {
      actorId: userId, verb: 'invite.accepted',
      entityType: 'Invite', entityId: invite.id,
    })
  })

  return ok({ channelId: invite.channelId })
}
