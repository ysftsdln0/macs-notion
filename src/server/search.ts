/**
 * Bu dosya BİLEREK 'use server' taşımaz — `Actor` parametresi alır
 * (bkz. `channels-query.ts`'teki gerekçe). Arayüzden çağrılabilir sarmalayıcı
 * `src/server/search-actions.ts` içindedir ve aktörü kendisi çözer.
 */

import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { can, type Actor } from '@/lib/auth/policy'
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

export type SearchHitType = 'document' | 'task' | 'event' | 'sponsor'

export type SearchHit = {
  type: SearchHitType
  id: string
  title: string
  subtitle: string
}

type ContentCandidate = { id: string; title: string; channelId: string; rank: number }

/**
 * Task/Event/Sponsor adayları için ORTAK yetki süzgeci. Her satır için ayrı
 * sorgu atmak yerine kanallar tek seferde çekilir, karar yine
 * `can(actor, 'content:read', …)` ile verilir — arama kendi yetki mantığını
 * yazmaz, policy'yi çağırır.
 */
async function filterContentCandidates(
  candidates: ContentCandidate[],
  actor: Actor,
  type: SearchHitType,
): Promise<(SearchHit & { rank: number })[]> {
  if (candidates.length === 0) return []

  const channels = await db.channel.findMany({
    where: { id: { in: [...new Set(candidates.map((c) => c.channelId))] } },
    select: { id: true, name: true, visibility: true, archivedAt: true },
  })
  const byId = new Map(channels.map((c) => [c.id, c]))

  const hits: (SearchHit & { rank: number })[] = []
  for (const candidate of candidates) {
    const channel = byId.get(candidate.channelId)
    if (!channel || channel.archivedAt) continue
    const allowed = can(actor, 'content:read', {
      kind: 'content',
      channelId: channel.id,
      channelVisibility: channel.visibility,
      channelArchivedAt: channel.archivedAt,
    })
    if (!allowed) continue
    hits.push({
      type,
      id: candidate.id,
      title: candidate.title,
      subtitle: channel.name,
      rank: candidate.rank,
    })
  }
  return hits
}

/**
 * Dört tabloda birleşik arama. Her tablo kendi generated tsvector'ünde
 * `plainto_tsquery` ile taranır; ham sorgular yalnızca ADAY üretir, neyin
 * gösterileceğine policy karar verir (doküman tarafında
 * `listVisibleDocuments`, diğerlerinde `can(content:read)`).
 *
 * Aday limiti istenenin katı tutulur: yetkisizler elendikten sonra da
 * `limit` kadar sonuç kalabilmeli.
 */
export async function globalSearch(
  query: string,
  actor: Actor,
  limit = 15,
): Promise<SearchHit[]> {
  const trimmed = query.trim()
  if (trimmed.length === 0) return []
  const candidateLimit = Prisma.raw(String(limit * 3))

  const [documents, tasks, events, sponsors] = await Promise.all([
    searchDocuments(trimmed, actor, limit),
    db.$queryRaw<ContentCandidate[]>`
      SELECT id, title, "channelId", ts_rank("searchVector", plainto_tsquery('turkish', ${trimmed})) AS rank
      FROM "Task"
      WHERE "searchVector" @@ plainto_tsquery('turkish', ${trimmed})
        AND "archivedAt" IS NULL
      ORDER BY rank DESC
      LIMIT ${candidateLimit}
    `,
    db.$queryRaw<ContentCandidate[]>`
      SELECT id, title, "channelId", ts_rank("searchVector", plainto_tsquery('turkish', ${trimmed})) AS rank
      FROM "Event"
      WHERE "searchVector" @@ plainto_tsquery('turkish', ${trimmed})
        AND "archivedAt" IS NULL
      ORDER BY rank DESC
      LIMIT ${candidateLimit}
    `,
    db.$queryRaw<ContentCandidate[]>`
      SELECT id, name AS title, "channelId", ts_rank("searchVector", plainto_tsquery('turkish', ${trimmed})) AS rank
      FROM "Sponsor"
      WHERE "searchVector" @@ plainto_tsquery('turkish', ${trimmed})
        AND "archivedAt" IS NULL
      ORDER BY rank DESC
      LIMIT ${candidateLimit}
    `,
  ])

  const [taskHits, eventHits, sponsorHits] = await Promise.all([
    filterContentCandidates(tasks, actor, 'task'),
    filterContentCandidates(events, actor, 'event'),
    filterContentCandidates(sponsors, actor, 'sponsor'),
  ])

  const documentHits: SearchHit[] = documents.map((doc) => ({
    type: 'document',
    id: doc.id,
    title: doc.title,
    subtitle: doc.channelName,
  }))
  const sortByRank = (hits: (SearchHit & { rank: number })[]): SearchHit[] =>
    [...hits]
      .sort((a, b) => b.rank - a.rank || a.title.localeCompare(b.title, 'tr'))
      .map((hit) => ({ type: hit.type, id: hit.id, title: hit.title, subtitle: hit.subtitle }))

  // Türler arası birleştirme sırayla (round-robin) yapılır: tek bir tablonun
  // yüksek `ts_rank` değerleri limiti doldurup diğer türleri tamamen
  // eleyebilirdi ve palette her türden sonuç göstermeli. Tür İÇİNDE sıra
  // yine rank'e göredir.
  const groups = [documentHits, sortByRank(taskHits), sortByRank(eventHits), sortByRank(sponsorHits)]
  const merged: SearchHit[] = []
  const longest = Math.max(...groups.map((g) => g.length))
  for (let i = 0; i < longest && merged.length < limit; i += 1) {
    for (const group of groups) {
      const hit = group[i]
      if (hit && merged.length < limit) merged.push(hit)
    }
  }
  return merged
}
