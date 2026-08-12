import type { Prisma, PrismaClient } from '@prisma/client'

type Client = PrismaClient | Prisma.TransactionClient

export type NotificationKind = 'comment' | 'mention' | 'task.assigned' | 'event.link'

export async function recordNotification(
  client: Client,
  entry: {
    userId: string
    kind: NotificationKind
    entityType: string
    entityId: string
    actorId: string
  },
): Promise<void> {
  // Kendi kendine bildirim üretme.
  if (entry.userId === entry.actorId) return
  await client.notification.create({ data: entry })
}
