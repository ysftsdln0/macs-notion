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
    globalRole: z.enum(['SUPERADMIN', 'ADMIN', 'MEMBER']).default('MEMBER'),
    channelId: z.string().cuid().nullable().default(null),
    channelRole: z.enum(['LEAD', 'MEMBER']).default('MEMBER'),
  }),
  getActor,
  authorize: async ({ actor, input }) => {
    if (!can(actor, 'invite:create', { kind: 'invite' })) return { allowed: false }
    // Kademe dağıtmak SUPERADMIN kapısıdır — `member:updateRole` ile AYNI kural.
    //
    // Davet, kademe dağıtmanın ikinci kapısıdır ve kapalı tutulmazsa birincisini
    // anlamsız kılar: `/invite/<token>` sayfası oturum açmış kullanıcıya daveti
    // KENDİSİ için uygulatır (invite/[token]/page.tsx:51-66). Yani INVITE_MANAGE
    // taşıyan düz bir üye (ör. seed'deki "İnsan Kaynakları" rolü) kendine ADMIN
    // daveti üretip bağlantıyı açar ve iki tıkta ADMIN olurdu — `has()` ona
    // ondan sonra her izni verir. Spec'in "İK'ya üye pasife alma yetkisi vermek,
    // ona Başkan üretme yetkisi vermek anlamına gelmemeli" kuralı tam da budur.
    if (input.globalRole !== 'MEMBER' && actor.globalRole !== 'SUPERADMIN') {
      return { allowed: false }
    }
    return { allowed: true }
  },
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
        // Bugünkü davranış açıkça yazılır: davet hâlâ tek kullanımlık.
        // Girdi olarak seçilebilir hâle gelmesi Task 3'te.
        maxUses: 1,
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
      data: { disabledAt: new Date() },
    })
    await recordActivity(db, {
      actorId: actor.id, verb: 'invite.revoked',
      entityType: 'Invite', entityId: input.inviteId,
    })
    return { id: input.inviteId }
  },
})
