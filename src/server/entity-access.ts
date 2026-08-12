/**
 * Bu dosya BİLEREK 'use server' taşımaz — `Actor` parametresi alır
 * (bkz. `channels-query.ts`'teki gerekçe).
 *
 * Yorumlar, bildirimler ve ekler polimorfiktir: `entityType` + `entityId`
 * ile herhangi bir içerik varlığına bağlanırlar ve FK taşımazlar (şema
 * kararı). Yetki kararını her çağıranın kendi switch'iyle tekrar yazması,
 * yeni bir varlık türü eklendiğinde birinin unutulması demekti. Erişim
 * çözümü burada, tek yerde durur.
 */

import { db } from '@/lib/db'
import { can, type Actor } from '@/lib/auth/policy'
import { loadDocumentContext } from '@/server/documents-query'

export const COMMENTABLE_ENTITY_TYPES = ['Document'] as const
export type CommentableEntityType = (typeof COMMENTABLE_ENTITY_TYPES)[number]

export type EntityAccess = {
  channelId: string | null
  canRead: boolean
  canWrite: boolean
  title: string
}

export async function resolveEntityAccess(
  actor: Actor,
  entityType: string,
  entityId: string,
): Promise<EntityAccess | null> {
  switch (entityType) {
    case 'Document': {
      const context = await loadDocumentContext(actor, entityId)
      if (!context || context.doc.archivedAt) return null
      return {
        channelId: context.doc.channelId,
        canRead: can(actor, 'document:read', context.resource),
        canWrite: can(actor, 'document:write', context.resource),
        title: context.doc.title || 'Adsız doküman',
      }
    }
    default:
      return null
  }
}

/**
 * Bir varlığın yorumlarını okuyabilecek aktif kullanıcılar — mention
 * önerileri ve bahsedilen kişinin gerçekten erişimi olup olmadığı
 * kontrolü için. Erişimi olmayan birine bildirim göndermek, ona
 * göremeyeceği bir dokümanın başlığını sızdırmak demektir.
 */
export async function listUsersWithAccess(
  entityType: string,
  entityId: string,
): Promise<{ id: string; name: string }[]> {
  const users = await db.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, globalRole: true, isActive: true, memberships: true },
    orderBy: { name: 'asc' },
  })

  const allowed: { id: string; name: string }[] = []
  for (const user of users) {
    const actor: Actor = {
      id: user.id,
      globalRole: user.globalRole,
      isActive: user.isActive,
      memberships: user.memberships.map((m) => ({
        channelId: m.channelId,
        channelRole: m.channelRole,
      })),
    }
    const access = await resolveEntityAccess(actor, entityType, entityId)
    if (access?.canRead) allowed.push({ id: user.id, name: user.name })
  }
  return allowed
}
