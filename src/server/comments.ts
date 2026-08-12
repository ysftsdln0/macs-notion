'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { actionError, defineAction } from '@/lib/action'
import { getActor } from '@/lib/auth/session'
import { recordActivity } from '@/lib/activity'
import { recordNotification } from '@/lib/notifications'
import { findMentionedNames } from '@/lib/mentions'
import {
  COMMENTABLE_ENTITY_TYPES,
  listUsersWithAccess,
  resolveEntityAccess,
} from '@/server/entity-access'

const entityTypeEnum = z.enum(COMMENTABLE_ENTITY_TYPES)
const bodySchema = z.string().trim().min(1, 'Yorum boş olamaz.').max(4000)

export const addComment = defineAction({
  input: z.object({
    entityType: entityTypeEnum,
    entityId: z.string().cuid(),
    body: bodySchema,
  }),
  getActor,
  authorize: async ({ actor, input }) => {
    const access = await resolveEntityAccess(actor, input.entityType, input.entityId)
    if (!access) return { allowed: false as const, code: 'NOT_FOUND' as const }
    // Yorum yazmak için okuma yetkisi yeter: bir dokümanı görebilen herkes
    // tartışmaya katılabilir, düzenleme yetkisi ayrı bir karardır.
    return { allowed: access.canRead }
  },
  handler: async ({ actor, input }) => {
    const comment = await db.comment.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        body: input.body,
        authorId: actor.id,
      },
    })

    // Bahsedilenler yalnızca varlığı GERÇEKTEN okuyabilenler arasından
    // seçilir. Aksi halde bildirim, erişimi olmayan birine dokümanın var
    // olduğunu (ve başlığını) sızdırırdı.
    const audience = await listUsersWithAccess(input.entityType, input.entityId)
    const mentioned = findMentionedNames(
      input.body,
      audience.map((u) => u.name),
    )
    for (const name of mentioned) {
      const user = audience.find((u) => u.name === name)
      if (!user) continue
      await recordNotification(db, {
        userId: user.id,
        kind: 'mention',
        entityType: input.entityType,
        entityId: input.entityId,
        actorId: actor.id,
      })
    }

    const access = await resolveEntityAccess(actor, input.entityType, input.entityId)
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'comment.added',
      entityType: input.entityType,
      entityId: input.entityId,
      channelId: access?.channelId ?? null,
    })

    return { id: comment.id }
  },
})

export const editComment = defineAction({
  input: z.object({ id: z.string().cuid(), body: bodySchema }),
  getActor,
  authorize: async ({ actor, input }) => {
    const comment = await db.comment.findUnique({ where: { id: input.id } })
    if (!comment || comment.deletedAt) return { allowed: false as const, code: 'NOT_FOUND' as const }
    // Düzenleme yalnızca yazarın: admin bile başkasının ağzından
    // konuşamaz. (Silme farklı — aşağıya bakınız.)
    return { allowed: comment.authorId === actor.id }
  },
  handler: async ({ input }) => {
    await db.comment.update({
      where: { id: input.id },
      data: { body: input.body, editedAt: new Date() },
    })
    return { id: input.id }
  },
})

export const deleteComment = defineAction({
  input: z.object({ id: z.string().cuid() }),
  getActor,
  authorize: async ({ actor, input }) => {
    const comment = await db.comment.findUnique({ where: { id: input.id } })
    if (!comment || comment.deletedAt) return { allowed: false as const, code: 'NOT_FOUND' as const }
    // Yazar kendi yorumunu siler; admin moderasyon için silebilir.
    return { allowed: comment.authorId === actor.id || actor.globalRole === 'ADMIN' }
  },
  handler: async ({ input }) => {
    // Soft delete: satır kalır, gövde arayüzde gizlenir. Yorum akışındaki
    // sıra ve "silinmiş yorum" izi korunur.
    const comment = await db.comment.update({
      where: { id: input.id },
      data: { deletedAt: new Date() },
    })
    if (!comment) throw actionError('NOT_FOUND')
    return { id: input.id }
  },
})
