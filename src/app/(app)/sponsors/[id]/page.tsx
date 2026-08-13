import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { loadSponsorContext } from '@/server/sponsors-query'
import { listEvents } from '@/server/events-query'
import { listComments } from '@/server/comments-query'
import { listUsersWithAccess } from '@/server/entity-access'
import { CommentThread } from '@/components/comments/comment-thread'
import { PageContainer, PageHeader } from '@/components/layout/page'
import { SponsorDetailForm } from './sponsor-detail-form'

export default async function SponsorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor()
  const { id } = await params

  const context = await loadSponsorContext(id)
  // Yetki kontrolü veriyi göstermeden önce; erişim yoksa varlığı sızdırılmaz.
  if (!context || context.sponsor.archivedAt) notFound()
  if (!can(actor, 'content:read', context.resource)) notFound()

  const canWrite = can(actor, 'content:write', context.resource)
  const canDelete = can(actor, 'content:delete', context.resource)

  const [events, members, comments, mentionCandidates] = await Promise.all([
    listEvents(actor),
    db.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    listComments(actor, 'Sponsor', id),
    listUsersWithAccess('Sponsor', id),
  ])

  // Etkinlik seçimi aynı kanalla sınırlı: action başka kanaldaki etkinliği
  // VALIDATION ile reddediyor, listede hiç göstermemek daha doğru.
  const channelEvents = events
    .filter((e) => e.channel.id === context.sponsor.channel.id)
    .map((e) => ({ id: e.id, title: e.title }))

  return (
    <PageContainer>
      <PageHeader title={context.sponsor.name} description={context.sponsor.channel.name} />

      <SponsorDetailForm
        sponsor={context.sponsor}
        events={channelEvents}
        members={members}
        canWrite={canWrite}
        canDelete={canDelete}
      />

      <CommentThread
        entityType="Sponsor"
        entityId={context.sponsor.id}
        comments={comments}
        currentUserId={actor.id}
        isAdmin={actor.globalRole === 'ADMIN'}
        mentionCandidates={mentionCandidates.filter((c) => c.id !== actor.id)}
      />
    </PageContainer>
  )
}
