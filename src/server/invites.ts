'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { defineAction } from '@/lib/action'
import { getActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { createInviteToken, inviteExpiry } from '@/lib/auth/invite-token'
import { recordActivity } from '@/lib/activity'

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
        expiresAt: inviteExpiry(),
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
