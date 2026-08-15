'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { defineAction, actionError } from '@/lib/action'
import { getActor } from '@/lib/auth/session'
import { can, has, type Actor } from '@/lib/auth/policy'
import { recordActivity } from '@/lib/activity'
import { loadDocumentContext } from '@/server/documents-query'

const visibilityEnum = z.enum(['PUBLIC', 'CHANNEL', 'PRIVATE'])

async function requireChannel(channelId: string) {
  const channel = await db.channel.findUnique({ where: { id: channelId } })
  if (!channel) throw actionError('NOT_FOUND')
  return channel
}

/**
 * archive/updateMeta/share action'larının hepsi aynı üç adımı yapar: dokümanı
 * kanalı ve aktörün paylaşım satırıyla birlikte yükle, yoksa NOT_FOUND, varsa
 * verilen action için `can()` çalıştır. Tek yerde tutulur — dokümanın
 * paylaşım satırını yüklemeyi unutan bir authorize, EDIT paylaşımını sessizce
 * yok sayardı.
 */
function authorizeOnDocument(action: 'document:write' | 'document:share' | 'document:delete') {
  return async ({ actor, input }: { actor: Actor; input: { id: string } | { documentId: string } }) => {
    const id = 'id' in input ? input.id : input.documentId
    const context = await loadDocumentContext(actor, id)
    if (!context) return { allowed: false as const, code: 'NOT_FOUND' as const }
    return { allowed: can(actor, action, context.resource) }
  }
}

export const createDocument = defineAction({
  input: z.object({
    title: z.string().trim().max(120).default(''),
    channelId: z.string().cuid(),
    visibility: visibilityEnum.default('PUBLIC'),
    parentId: z.string().cuid().nullable().default(null),
  }),
  getActor,
  authorize: async ({ actor, input }) => {
    const channel = await requireChannel(input.channelId)
    return {
      allowed: can(actor, 'document:create', {
        kind: 'document:new',
        channelId: input.channelId,
        channelVisibility: channel.visibility,
      }),
    }
  },
  handler: async ({ actor, input }) => {
    // parentId istemciden gelir: var olduğu ve aynı kanala ait olduğu garanti
    // değil. Kontrol edilmezse FK ihlali (P2003) opak bir INTERNAL'a düşer,
    // ya da doküman başka bir kanalın ağacına asılıp o kanalın yetkisiyle
    // listelenirken bu kanalın yetkisiyle yazılabilir hale gelirdi.
    if (input.parentId) {
      const parent = await db.document.findUnique({ where: { id: input.parentId } })
      if (!parent || parent.archivedAt) throw actionError('NOT_FOUND')
      if (parent.channelId !== input.channelId) {
        throw actionError('VALIDATION', { parentId: 'Üst doküman başka bir kanalda.' })
      }
    }

    const doc = await db.document.create({
      data: {
        title: input.title,
        channelId: input.channelId,
        visibility: input.visibility,
        parentId: input.parentId,
        createdById: actor.id,
      },
    })
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'document.created',
      entityType: 'Document',
      entityId: doc.id,
      channelId: input.channelId,
      meta: { title: doc.title },
    })
    return { id: doc.id }
  },
})

export const archiveDocument = defineAction({
  input: z.object({ id: z.string().cuid() }),
  getActor,
  authorize: authorizeOnDocument('document:delete'),
  handler: async ({ actor, input }) => {
    const doc = await db.document.update({
      where: { id: input.id },
      data: { archivedAt: new Date() },
    })
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'document.archived',
      entityType: 'Document',
      entityId: input.id,
      channelId: doc.channelId,
    })
    return { id: input.id }
  },
})

export const restoreDocument = defineAction({
  input: z.object({ id: z.string().cuid() }),
  getActor,
  // Çöp kutusu yalnızca admin ekranı: geri alma da admin yetkisi.
  authorize: async ({ actor }) => ({ allowed: has(actor, 'TRASH_MANAGE') }),
  handler: async ({ actor, input }) => {
    const doc = await db.document.findUnique({ where: { id: input.id } })
    if (!doc) throw actionError('NOT_FOUND')
    await db.document.update({ where: { id: input.id }, data: { archivedAt: null } })
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'document.restored',
      entityType: 'Document',
      entityId: input.id,
      channelId: doc.channelId,
    })
    return { id: input.id }
  },
})

export const permanentlyDeleteDocument = defineAction({
  input: z.object({ id: z.string().cuid() }),
  getActor,
  authorize: async ({ actor }) => ({ allowed: has(actor, 'TRASH_MANAGE') }),
  handler: async ({ actor, input }) => {
    const doc = await db.document.findUnique({ where: { id: input.id } })
    if (!doc) throw actionError('NOT_FOUND')
    // DocState ve DocumentShare cascade ile gider; alt sayfalar parentId
    // SetNull ile kök seviyesine çıkar (şema kararı) — ağaç silinmez.
    await db.document.delete({ where: { id: input.id } })
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'document.permanentlyDeleted',
      entityType: 'Document',
      entityId: input.id,
      channelId: doc.channelId,
    })
    return { id: input.id }
  },
})

export const updateDocumentMeta = defineAction({
  input: z.object({
    id: z.string().cuid(),
    // Hepsi optional: yalnızca görünürlüğü değiştiren bir çağrı, gönderilmeyen
    // başlığı ve ikonu SİLMEMELİ. `.default('')` olsaydı tam olarak bunu
    // yapardı.
    title: z.string().trim().max(120).optional(),
    icon: z.string().trim().max(8).nullable().optional(),
    visibility: visibilityEnum.optional(),
  }),
  getActor,
  authorize: async ({ actor, input }) => {
    const context = await loadDocumentContext(actor, input.id)
    if (!context) return { allowed: false as const, code: 'NOT_FOUND' as const }
    if (!can(actor, 'document:write', context.resource)) return { allowed: false as const }
    // Görünürlük değişimi bir erişim kararıdır, içerik düzenlemesi değil:
    // PUBLIC bir dokümanı PRIVATE'a çeviren kişi onu kanaldan koparır.
    // Bu yüzden paylaşımla aynı yetkiyi (sahip / LEAD / admin) ister.
    const changesVisibility =
      input.visibility !== undefined && input.visibility !== context.doc.visibility
    if (changesVisibility && !can(actor, 'document:share', context.resource)) {
      return { allowed: false as const }
    }
    return { allowed: true as const }
  },
  handler: async ({ actor, input }) => {
    const doc = await db.document.update({
      where: { id: input.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      },
    })
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'document.updated',
      entityType: 'Document',
      entityId: input.id,
      channelId: doc.channelId,
    })
    return { id: input.id }
  },
})

export const upsertShare = defineAction({
  input: z.object({
    documentId: z.string().cuid(),
    userId: z.string().cuid(),
    permission: z.enum(['VIEW', 'EDIT']),
  }),
  getActor,
  authorize: authorizeOnDocument('document:share'),
  handler: async ({ actor, input }) => {
    const target = await db.user.findUnique({ where: { id: input.userId } })
    if (!target || !target.isActive) throw actionError('NOT_FOUND')

    const share = await db.documentShare.upsert({
      where: {
        documentId_userId: { documentId: input.documentId, userId: input.userId },
      },
      create: {
        documentId: input.documentId,
        userId: input.userId,
        permission: input.permission,
      },
      update: { permission: input.permission },
    })
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'document.shared',
      entityType: 'Document',
      entityId: input.documentId,
      meta: { userId: input.userId, permission: input.permission },
    })
    return { id: share.id }
  },
})

export const removeShare = defineAction({
  input: z.object({ documentId: z.string().cuid(), userId: z.string().cuid() }),
  getActor,
  authorize: authorizeOnDocument('document:share'),
  handler: async ({ actor, input }) => {
    await db.documentShare.deleteMany({
      where: { documentId: input.documentId, userId: input.userId },
    })
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'document.unshared',
      entityType: 'Document',
      entityId: input.documentId,
      meta: { userId: input.userId },
    })
    return { ok: true as const }
  },
})
