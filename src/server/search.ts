/**
 * Bu dosya BİLEREK 'use server' taşımaz — `Actor` parametresi alır
 * (bkz. `channels-query.ts`'teki gerekçe). Arayüzden çağrılabilir sarmalayıcı
 * `src/server/search-actions.ts` içindedir ve aktörü kendisi çözer.
 */

import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { Actor } from '@/lib/auth/policy'
import { listVisibleDocuments } from '@/server/documents-query'

export type DocumentSearchHit = {
  id: string
  title: string
  channelName: string
  updatedAt: Date
}

/**
 * `Document.searchVector` generated tsvector kolonunda (migration'a elle
 * eklenen raw SQL, GIN index'li) `plainto_tsquery` ile arar.
 *
 * Ham sorgu yalnızca ADAYLARI bulur; hangi dokümanın gösterileceğine
 * `listVisibleDocuments` karar verir — yani yetki kararı yine tek yerde,
 * `can(document:read)` dallarını birebir yansıtan sorguda kalır. Aday
 * limiti istenenden geniş tutulur, çünkü görünmeyenler elendikten sonra
 * yine `limit` kadar sonuç kalması istenir.
 */
export async function searchDocuments(
  query: string,
  actor: Actor,
  limit = 20,
): Promise<DocumentSearchHit[]> {
  const trimmed = query.trim()
  if (trimmed.length === 0) return []

  const candidates = await db.$queryRaw<{ id: string; rank: number }[]>`
    SELECT id, ts_rank("searchVector", plainto_tsquery('turkish', ${trimmed})) AS rank
    FROM "Document"
    WHERE "searchVector" @@ plainto_tsquery('turkish', ${trimmed})
      AND "archivedAt" IS NULL
    ORDER BY rank DESC
    LIMIT ${Prisma.raw(String(limit * 5))}
  `
  if (candidates.length === 0) return []

  const visible = await listVisibleDocuments(
    actor,
    candidates.map((c) => c.id),
  )
  const byId = new Map(visible.map((d) => [d.id, d]))

  const hits: DocumentSearchHit[] = []
  for (const candidate of candidates) {
    const doc = byId.get(candidate.id)
    if (!doc) continue
    hits.push({
      id: doc.id,
      title: doc.title || 'Adsız doküman',
      channelName: doc.channel.name,
      updatedAt: doc.updatedAt,
    })
    if (hits.length === limit) break
  }
  return hits
}
