/**
 * Bu dosya BİLEREK 'use server' taşımaz — `Actor` parametresi alır
 * (bkz. `channels-query.ts`'teki gerekçe).
 */

import { db } from '@/lib/db'
import type { Actor } from '@/lib/auth/policy'
import { resolveEntityAccess } from '@/server/entity-access'

export type CommentView = {
  id: string
  body: string
  createdAt: Date
  editedAt: Date | null
  deletedAt: Date | null
  author: { id: string; name: string; image: string | null }
}

export async function listComments(
  actor: Actor,
  entityType: string,
  entityId: string,
): Promise<CommentView[]> {
  const access = await resolveEntityAccess(actor, entityType, entityId)
  if (!access?.canRead) return []
  return db.comment.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      body: true,
      createdAt: true,
      editedAt: true,
      deletedAt: true,
      author: { select: { id: true, name: true, image: true } },
    },
  })
}
