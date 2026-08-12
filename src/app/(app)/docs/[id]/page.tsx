import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { loadDocumentContext } from '@/server/documents-query'
import { listComments } from '@/server/comments-query'
import { listUsersWithAccess } from '@/server/entity-access'
import { signCollabToken } from '@/lib/auth/collab-token'
import { COLLAB_URL } from '@/lib/constants'
import { CommentThread } from '@/components/comments/comment-thread'
import { DocHeader } from './doc-header'
import { EditorLoader } from './editor-loader'
import { ShareDialog } from './share-dialog'

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor()
  const { id } = await params

  const context = await loadDocumentContext(actor, id)
  // Yetki kontrolü veriyi göstermeden önce. Erişim yoksa varlığı da
  // sızdırılmaz — arşivlenmiş doküman da (çöp kutusu hariç) yok sayılır.
  if (!context || context.doc.archivedAt) notFound()
  if (!can(actor, 'document:read', context.resource)) notFound()

  const canWrite = can(actor, 'document:write', context.resource)
  const canShare = can(actor, 'document:share', context.resource)
  const canDelete = can(actor, 'document:delete', context.resource)

  const [state, user, comments, mentionCandidates, shares] = await Promise.all([
    db.docState.findUnique({ where: { documentId: id } }),
    db.user.findUniqueOrThrow({ where: { id: actor.id }, select: { id: true, name: true } }),
    listComments(actor, 'Document', id),
    listUsersWithAccess('Document', id),
    canShare
      ? db.documentShare.findMany({
          where: { documentId: id },
          select: { userId: true, permission: true, user: { select: { name: true } } },
          orderBy: { user: { name: 'asc' } },
        })
      : Promise.resolve([]),
  ])

  const candidates = canShare
    ? await db.user.findMany({
        where: {
          isActive: true,
          id: { notIn: [...shares.map((s) => s.userId), context.doc.createdById] },
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      })
    : []

  // Salt-okur görünüm sunucudan gelen ydoc ile render edilir; websocket
  // yalnızca yazabilenler için açılır (collab sunucusu da aynı kararı
  // bağımsız olarak tekrar verir).
  const initialYdoc = !canWrite && state ? Buffer.from(state.ydoc).toString('base64') : null

  // AUTH_SECRET olmadan Auth.js zaten çalışmaz; yine de token imzalamadan
  // önce açıkça kontrol edilir — sessizce imzasız bir token üretmek, her
  // websocket bağlantısının anlaşılmaz biçimde reddedilmesi demek olurdu.
  const secret = process.env.AUTH_SECRET
  const collabToken = canWrite && secret ? signCollabToken(actor.id, secret) : null

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <DocHeader
        documentId={context.doc.id}
        initialTitle={context.doc.title}
        initialIcon={context.doc.icon}
        initialVisibility={context.doc.visibility}
        channelName={context.channel.name}
        canWrite={canWrite}
        canShare={canShare}
        canDelete={canDelete}
        shareSlot={
          canShare ? (
            <ShareDialog
              documentId={context.doc.id}
              shares={shares.map((s) => ({
                userId: s.userId, name: s.user.name, permission: s.permission,
              }))}
              candidates={candidates}
            />
          ) : null
        }
      />
      <EditorLoader
        documentId={context.doc.id}
        canWrite={canWrite}
        collabUrl={COLLAB_URL}
        collabToken={collabToken}
        initialYdoc={initialYdoc}
        currentUser={user}
      />
      <CommentThread
        entityType="Document"
        entityId={context.doc.id}
        comments={comments}
        currentUserId={actor.id}
        isAdmin={actor.globalRole === 'ADMIN'}
        mentionCandidates={mentionCandidates.filter((c) => c.id !== actor.id)}
      />
    </div>
  )
}
