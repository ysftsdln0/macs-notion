/**
 * Bu dosya BİLEREK 'use server' taşımaz — `channels-query.ts`'teki gerekçenin
 * aynısı geçerlidir: burada export edilen fonksiyonların bir kısmı `Actor`
 * parametresi alır. 'use server' olsaydı her biri herkese açık bir RPC uç
 * noktası olurdu ve çağıran kendi `actor` nesnesini uydurup admin gibi
 * davranabilirdi.
 */

import { db } from '@/lib/db'
import { getActor } from '@/lib/auth/session'
import { can, type Actor, type DocumentVisibility, type Resource, type Visibility } from '@/lib/auth/policy'

type DocLike = {
  channelId: string
  visibility: DocumentVisibility
  createdById: string
}

type ChannelLike = {
  visibility: Visibility
  archivedAt: Date | null
}

type ShareLike = { permission: 'VIEW' | 'EDIT' } | null

/**
 * `can()`'in beklediği document resource'unu tek yerden üretir. Paylaşım
 * satırı opsiyonel değil BİLEREK zorunlu: unutulduğunda EDIT paylaşımı
 * sessizce yok sayılır ve yetkili kullanıcı kendi dokümanını düzenleyemez.
 */
export function documentResource(
  doc: DocLike,
  channel: ChannelLike,
  share: ShareLike,
): Extract<Resource, { kind: 'document' }> {
  return {
    kind: 'document',
    channelId: doc.channelId,
    channelVisibility: channel.visibility,
    channelArchivedAt: channel.archivedAt,
    documentVisibility: doc.visibility,
    ownerId: doc.createdById,
    shared: share !== null,
    sharedEdit: share?.permission === 'EDIT',
  }
}

export type DocumentContext = {
  doc: {
    id: string
    title: string
    icon: string | null
    parentId: string | null
    channelId: string
    visibility: DocumentVisibility
    createdById: string
    archivedAt: Date | null
    updatedAt: Date
  }
  channel: { id: string; name: string; slug: string; visibility: Visibility; archivedAt: Date | null }
  share: ShareLike
  resource: Extract<Resource, { kind: 'document' }>
}

/**
 * Dokümanı, kanalını ve aktörün o dokümandaki paylaşım satırını tek seferde
 * getirir; yetki kararı için gereken her şeyi hazırlar. Arşivlenmiş doküman
 * da döner — arşiv kararı çağırana aittir (çöp kutusu onları görmek ister).
 */
export async function loadDocumentContext(
  actor: Actor,
  documentId: string,
): Promise<DocumentContext | null> {
  const doc = await db.document.findUnique({
    where: { id: documentId },
    include: {
      channel: { select: { id: true, name: true, slug: true, visibility: true, archivedAt: true } },
    },
  })
  if (!doc) return null
  const share = await db.documentShare.findUnique({
    where: { documentId_userId: { documentId, userId: actor.id } },
    select: { permission: true },
  })
  return {
    doc,
    channel: doc.channel,
    share,
    resource: documentResource(doc, doc.channel, share),
  }
}

export async function canReadDocument(actor: Actor, documentId: string): Promise<boolean> {
  const context = await loadDocumentContext(actor, documentId)
  if (!context || context.doc.archivedAt) return false
  return can(actor, 'document:read', context.resource)
}

export type VisibleDocument = {
  id: string
  title: string
  icon: string | null
  parentId: string | null
  visibility: DocumentVisibility
  updatedAt: Date
  channel: { id: string; name: string; slug: string }
}

/**
 * Aktörün okuyabildiği arşivlenmemiş dokümanlar. Filtre `can(document:read)`
 * ile BİREBİR aynı dalları uygular — "liste yaklaşıktır, detay doğrular"
 * yaklaşımı burada bilerek kullanılmaz: yaklaşık bir liste ya PRIVATE başlık
 * sızdırır ya da yetkili kullanıcıdan dokümanı gizler.
 */
export async function listVisibleDocuments(actor?: Actor): Promise<VisibleDocument[]> {
  const resolved = actor ?? (await getActor())
  if (!resolved) return []

  const select = {
    id: true,
    title: true,
    icon: true,
    parentId: true,
    visibility: true,
    updatedAt: true,
    channel: { select: { id: true, name: true, slug: true } },
  } as const

  const base = { archivedAt: null, channel: { archivedAt: null } }

  if (resolved.globalRole === 'ADMIN') {
    return db.document.findMany({ where: base, select, orderBy: { updatedAt: 'desc' } })
  }

  const memberChannelIds = resolved.memberships.map((m) => m.channelId)
  return db.document.findMany({
    where: {
      ...base,
      OR: [
        { visibility: 'PUBLIC' },
        { visibility: 'CHANNEL', channelId: { in: memberChannelIds } },
        { visibility: 'PRIVATE', createdById: resolved.id },
        { visibility: 'PRIVATE', shares: { some: { userId: resolved.id } } },
      ],
    },
    select,
    orderBy: { updatedAt: 'desc' },
  })
}

export type DocumentNode = VisibleDocument & { children: DocumentNode[] }

/**
 * Düz listeyi ağaca çevirir. Ebeveyni listede OLMAYAN doküman (ebeveyni
 * PRIVATE ve paylaşılmamış olabilir) kaybolmaz, kök seviyesine çıkar —
 * aksi halde okuma yetkisi olan bir alt sayfa arayüzden tamamen silinirdi.
 */
export function buildDocumentTree(docs: VisibleDocument[]): DocumentNode[] {
  const nodes = new Map<string, DocumentNode>()
  for (const doc of docs) nodes.set(doc.id, { ...doc, children: [] })

  const roots: DocumentNode[] = []
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

export async function getDocumentTree(actor?: Actor): Promise<DocumentNode[]> {
  return buildDocumentTree(await listVisibleDocuments(actor))
}

export async function listArchivedDocuments(): Promise<
  (VisibleDocument & { archivedAt: Date | null })[]
> {
  const actor = await getActor()
  if (!actor || actor.globalRole !== 'ADMIN') return []
  return db.document.findMany({
    where: { archivedAt: { not: null } },
    select: {
      id: true,
      title: true,
      icon: true,
      parentId: true,
      visibility: true,
      updatedAt: true,
      archivedAt: true,
      channel: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { archivedAt: 'desc' },
  })
}
