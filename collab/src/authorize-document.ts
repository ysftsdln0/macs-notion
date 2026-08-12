import { can } from '../../src/lib/auth/policy.ts'
import type { Actor, Resource, Visibility } from '../../src/lib/auth/policy.ts'
import { PrismaClient } from '../generated/prisma/client.js'
import { resolveActor } from './auth.js'

const db = new PrismaClient()

export type DocumentRow = {
  id: string
  channelId: string
  visibility: string
  createdById: string
  archivedAt: Date | null
}

export type ChannelRow = {
  visibility: Visibility
  archivedAt: Date | null
}

export type SharePermission = 'VIEW' | 'EDIT' | null

export function docResource(
  doc: DocumentRow,
  channel: ChannelRow,
  share: SharePermission,
): Resource {
  return {
    kind: 'document',
    channelId: doc.channelId,
    channelVisibility: channel.visibility,
    channelArchivedAt: channel.archivedAt,
    documentVisibility: doc.visibility as 'PUBLIC' | 'CHANNEL' | 'PRIVATE',
    ownerId: doc.createdById,
    // `shared` gerçek paylaşım satırından gelir. Sabit `true` yazmak
    // document:write için sonucu değiştirmez (o dal yalnızca sharedEdit'e
    // bakar) ama aynı resource document:read'e verildiğinde PRIVATE bir
    // dokümanı herkese açardı.
    shared: share !== null,
    sharedEdit: share === 'EDIT',
  }
}

/**
 * Websocket açma yetkisi: yalnızca YAZABİLENLER bağlanır. VIEW paylaşımı
 * ayrı akıştır (editör sayfası sunucu verisiyle salt-okur render eder).
 */
export function canEditDocument(
  actor: Actor,
  doc: DocumentRow,
  channel: ChannelRow,
  share: SharePermission,
): boolean {
  return can(actor, 'document:write', docResource(doc, channel, share))
}

export type Authorization =
  | { ok: true; actorId: string }
  | { ok: false; reason: 'session' | 'document' | 'permission' }

/**
 * Collab sunucusunun onAuthenticate mantığı: oturum → doküman → yetki.
 * server.ts ve entegrasyon testi aynı kodu çağırır.
 */
export async function authorizeDocument(
  token: string | null,
  documentName: string,
): Promise<Authorization> {
  const actor = await resolveActor(token)
  if (!actor) return { ok: false, reason: 'session' }

  const doc = await db.document.findUnique({ where: { id: documentName } })
  if (!doc || doc.archivedAt) return { ok: false, reason: 'document' }
  const channel = await db.channel.findUniqueOrThrow({ where: { id: doc.channelId } })
  const share = await db.documentShare.findUnique({
    where: { documentId_userId: { documentId: doc.id, userId: actor.id } },
  })

  if (!canEditDocument(actor, doc, channel, share?.permission ?? null)) {
    return { ok: false, reason: 'permission' }
  }
  return { ok: true, actorId: actor.id }
}
