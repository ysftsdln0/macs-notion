'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { defineAction } from '@/lib/action'
import { getActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import {
  createInviteToken,
  DEFAULT_INVITE_DURATION,
  ELEVATED_MAX_DURATION_MS,
  INVITE_DURATIONS,
  inviteExpiry,
  type InviteDuration,
} from '@/lib/auth/invite-token'
import { recordActivity } from '@/lib/activity'

export const createInvite = defineAction({
  input: z.object({
    globalRole: z.enum(['SUPERADMIN', 'ADMIN', 'MEMBER']).default('MEMBER'),
    channelId: z.string().cuid().nullable().default(null),
    channelRole: z.enum(['LEAD', 'MEMBER']).default('MEMBER'),
    duration: z
      .enum(Object.keys(INVITE_DURATIONS) as [InviteDuration, ...InviteDuration[]])
      .default(DEFAULT_INVITE_DURATION),
    maxUses: z.number().int().positive().nullable().default(1),
    label: z.string().trim().max(60, 'Etiket en fazla 60 karakter olabilir.').nullable().default(null),
  })
    /**
     * Davet, kademe dağıtmanın ikinci kapısıdır: `/invite/<token>` sayfası
     * oturum açmış kullanıcıya daveti KENDİSİ için uygular. Bu yüzden
     * kademe taşıyan bir bağlantı ne çok kullanımlı ne de uzun ömürlü
     * olabilir — sızarsa tek hesapla ve tek günle sınırlı kalmalı.
     */
    .superRefine((value, ctx) => {
      if (value.globalRole === 'MEMBER') return

      if (value.maxUses !== 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['maxUses'],
          message: 'Kademe daveti yalnızca tek kişilik olabilir.',
        })
      }

      const ms = INVITE_DURATIONS[value.duration]
      if (ms === null || ms > ELEVATED_MAX_DURATION_MS) {
        ctx.addIssue({
          code: 'custom',
          path: ['duration'],
          message: 'Kademe daveti en fazla 24 saat geçerli olabilir.',
        })
      }
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
        expiresAt: inviteExpiry(input.duration),
        createdById: actor.id,
        maxUses: input.maxUses,
        // Boş/boşluk-dolu etiket null'a düşer: listede "· ·" gibi boş bir
        // ayraç yerine hiç etiket olmaması doğru.
        label: input.label || null,
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

/**
 * Daveti kapatır ya da yeniden açar. Kalıcı iptal DEĞİL: çok kullanımlı bir
 * bağlantıyı geçici olarak durdurup devam ettirmek gerekiyor. Kullanılmış
 * slotlar geri gelmez — devam ettirilen davet kalan kontenjanından sürer.
 */
export const setInviteDisabled = defineAction({
  input: z.object({ inviteId: z.string().cuid(), disabled: z.boolean() }),
  getActor,
  authorize: async ({ actor }) => ({ allowed: can(actor, 'invite:revoke', { kind: 'invite' }) }),
  handler: async ({ actor, input }) => {
    await db.invite.update({
      where: { id: input.inviteId },
      data: { disabledAt: input.disabled ? new Date() : null },
    })
    await recordActivity(db, {
      actorId: actor.id,
      verb: input.disabled ? 'invite.disabled' : 'invite.enabled',
      entityType: 'Invite', entityId: input.inviteId,
    })
    return { id: input.inviteId, disabled: input.disabled }
  },
})
