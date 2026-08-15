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
import { can, flattenPermissions, type Actor } from '@/lib/auth/policy'
import { loadDocumentContext } from '@/server/documents-query'
import { loadTaskContext } from '@/server/tasks-query'
import { loadEventContext } from '@/server/events-query'

export const COMMENTABLE_ENTITY_TYPES = ['Document', 'Task', 'Event', 'Sponsor'] as const
export type CommentableEntityType = (typeof COMMENTABLE_ENTITY_TYPES)[number]

export const ATTACHABLE_ENTITY_TYPES = [
  'Document', 'Task', 'Event', 'Sponsor', 'BudgetEntry',
] as const
export type AttachableEntityType = (typeof ATTACHABLE_ENTITY_TYPES)[number]

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

    case 'Task': {
      const context = await loadTaskContext(entityId)
      if (!context || context.task.archivedAt) return null
      const task = await db.task.findUniqueOrThrow({
        where: { id: entityId },
        select: { title: true },
      })
      return {
        channelId: context.task.channelId,
        canRead: can(actor, 'content:read', context.resource),
        canWrite: can(actor, 'content:write', context.resource),
        title: task.title,
      }
    }

    case 'Event': {
      const context = await loadEventContext(entityId)
      if (!context || context.event.archivedAt) return null
      return {
        channelId: context.event.channel.id,
        canRead: can(actor, 'content:read', context.resource),
        canWrite: can(actor, 'content:write', context.resource),
        title: context.event.title,
      }
    }

    case 'Sponsor': {
      const sponsor = await db.sponsor.findUnique({
        where: { id: entityId },
        select: {
          name: true, createdById: true, archivedAt: true,
          channel: { select: { id: true, visibility: true, archivedAt: true } },
        },
      })
      if (!sponsor || sponsor.archivedAt) return null
      const resource = {
        kind: 'content' as const,
        channelId: sponsor.channel.id,
        channelVisibility: sponsor.channel.visibility,
        channelArchivedAt: sponsor.channel.archivedAt,
        ownerId: sponsor.createdById,
      }
      return {
        channelId: sponsor.channel.id,
        canRead: can(actor, 'content:read', resource),
        canWrite: can(actor, 'content:write', resource),
        title: sponsor.name,
      }
    }

    case 'BudgetEntry': {
      const entry = await db.budgetEntry.findUnique({
        where: { id: entityId },
        select: {
          title: true, archivedAt: true,
          channel: { select: { id: true, visibility: true, archivedAt: true } },
        },
      })
      if (!entry || entry.archivedAt) return null
      // Para kalemleri content:* değil budget:* kurallarına tabi.
      const resource = {
        kind: 'budget' as const,
        channelId: entry.channel.id,
        channelVisibility: entry.channel.visibility,
        channelArchivedAt: entry.channel.archivedAt,
      }
      return {
        channelId: entry.channel.id,
        canRead: can(actor, 'budget:read', resource),
        canWrite: can(actor, 'budget:write', resource),
        title: entry.title,
      }
    }

    default:
      return null
  }
}

/**
 * Bir varlığı okuyabilecek aktif kullanıcılar — mention önerileri ve
 * bahsedilen kişinin gerçekten erişimi olup olmadığı kontrolü için.
 * Erişimi olmayan birine bildirim göndermek, ona göremeyeceği bir içeriğin
 * başlığını sızdırmak demektir.
 */
export async function listUsersWithAccess(
  entityType: string,
  entityId: string,
): Promise<{ id: string; name: string }[]> {
  const users = await db.user.findMany({
    where: { isActive: true },
    select: {
      id: true, name: true, globalRole: true, isActive: true, memberships: true,
      roles: { select: { role: { select: { permissions: true } } } },
    },
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
      permissions: flattenPermissions(user.roles),
    }
    const access = await resolveEntityAccess(actor, entityType, entityId)
    if (access?.canRead) allowed.push({ id: user.id, name: user.name })
  }
  return allowed
}
