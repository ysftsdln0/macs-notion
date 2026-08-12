/**
 * Bu dosya BİLEREK 'use server' taşımaz — `Actor` parametresi alır
 * (bkz. `channels-query.ts`'teki gerekçe).
 */

import { db } from '@/lib/db'
import type { Actor } from '@/lib/auth/policy'

export type NotificationView = {
  id: string
  kind: string
  entityType: string
  entityId: string
  entityTitle: string
  readAt: Date | null
  createdAt: Date
  actor: { id: string; name: string }
}

/**
 * Bildirimler yalnızca sahibine gösterilir; `userId` filtresi yetki
 * kontrolünün kendisidir.
 *
 * Varlık başlıkları TÜR BAŞINA TEK sorguyla çözülür — bildirim başına ayrı
 * sorgu, 30 bildirimlik bir Inbox'ta 30 round-trip demek olurdu.
 */
export async function listNotifications(
  actor: Actor,
  limit = 50,
): Promise<NotificationView[]> {
  const rows = await db.notification.findMany({
    where: { userId: actor.id },
    // `nulls: 'first'` şart: Postgres ASC sıralamada NULL'ları SONA koyar,
    // yani okunmamışlar (readAt IS NULL) listenin dibine düşerdi.
    orderBy: [{ readAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
    take: limit,
    select: {
      id: true,
      kind: true,
      entityType: true,
      entityId: true,
      readAt: true,
      createdAt: true,
      actor: { select: { id: true, name: true } },
    },
  })

  const idsByType = new Map<string, string[]>()
  for (const row of rows) {
    idsByType.set(row.entityType, [...(idsByType.get(row.entityType) ?? []), row.entityId])
  }

  const titles = new Map<string, string>()
  const collect = (entityType: string, items: { id: string; title: string }[]) => {
    for (const item of items) titles.set(`${entityType}:${item.id}`, item.title)
  }

  const documentIds = idsByType.get('Document') ?? []
  const taskIds = idsByType.get('Task') ?? []
  const eventIds = idsByType.get('Event') ?? []

  const [documents, tasks, events] = await Promise.all([
    documentIds.length > 0
      ? db.document.findMany({ where: { id: { in: documentIds } }, select: { id: true, title: true } })
      : Promise.resolve([]),
    taskIds.length > 0
      ? db.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, title: true } })
      : Promise.resolve([]),
    eventIds.length > 0
      ? db.event.findMany({ where: { id: { in: eventIds } }, select: { id: true, title: true } })
      : Promise.resolve([]),
  ])
  collect('Document', documents)
  collect('Task', tasks)
  collect('Event', events)

  return rows.map((row) => ({
    ...row,
    // Varlık silinmiş olabilir (polimorfik bağ, FK yok — şema kararı):
    // bildirim kaybolmaz, başlığı yerine genel bir metin gösterilir.
    entityTitle: titles.get(`${row.entityType}:${row.entityId}`) ?? 'Silinmiş içerik',
  }))
}

export async function countUnreadNotifications(actor: Actor): Promise<number> {
  return db.notification.count({ where: { userId: actor.id, readAt: null } })
}
