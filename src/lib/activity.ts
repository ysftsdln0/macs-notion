import type { Prisma, PrismaClient } from '@prisma/client'

type Client = PrismaClient | Prisma.TransactionClient

export async function recordActivity(
  client: Client,
  entry: {
    actorId: string
    verb: string
    entityType: string
    entityId: string
    meta?: Prisma.InputJsonValue
  },
): Promise<void> {
  await client.activity.create({ data: entry })
}
