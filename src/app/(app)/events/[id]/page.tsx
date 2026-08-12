import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { loadEventContext } from '@/server/events-query'
import { listTasks } from '@/server/tasks-query'
import { listComments } from '@/server/comments-query'
import { listUsersWithAccess } from '@/server/entity-access'
import { canReadBudgetOfChannel, listBudgetEntries, summarizeBudget } from '@/server/budget-query'
import { BudgetSummaryCards } from '@/components/budget/summary-cards'
import { BudgetEntryTable } from '@/components/budget/entry-table'
import { CommentThread } from '@/components/comments/comment-thread'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/state/empty-state'
import { describeTaskPriority, describeTaskStatus } from '@/lib/task-labels'
import { EventHeader } from './event-header'

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor()
  const { id } = await params

  const context = await loadEventContext(id)
  // Yetki kontrolü veriyi göstermeden önce; erişim yoksa varlığı sızdırılmaz.
  if (!context || context.event.archivedAt) notFound()
  if (!can(actor, 'content:read', context.resource)) notFound()

  const canWrite = can(actor, 'content:write', context.resource)
  const canDelete = can(actor, 'content:delete', context.resource)
  const [tasks, comments, mentionCandidates, canReadBudget] = await Promise.all([
    listTasks(actor, { eventId: id }),
    listComments(actor, 'Event', id),
    listUsersWithAccess('Event', id),
    canReadBudgetOfChannel(actor, context.event.channel.id),
  ])

  // Bütçe içerikten daha kapalı: etkinliği görebilmek kalemleri görmeye
  // yetmez, bölüm yalnızca budget:read olanlara render edilir.
  const [budgetEntries, budgetSummary] = canReadBudget
    ? await Promise.all([
        listBudgetEntries(actor, { eventId: id }),
        summarizeBudget(actor, { eventId: id }),
      ])
    : [[], []]
  const budgetWritableChannelIds = can(actor, 'budget:write', {
    kind: 'budget',
    channelId: context.event.channel.id,
    channelVisibility: context.resource.channelVisibility,
    channelArchivedAt: context.resource.channelArchivedAt,
  })
    ? [context.event.channel.id]
    : []

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <EventHeader
        event={{
          id: context.event.id,
          title: context.event.title,
          description: context.event.description,
          startsAt: context.event.startsAt,
          endsAt: context.event.endsAt,
          location: context.event.location,
          status: context.event.status,
          channelName: context.event.channel.name,
        }}
        canWrite={canWrite}
        canDelete={canDelete}
      />

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase text-muted-foreground">Bağlı görevler</h2>
        {tasks.length === 0 ? (
          <EmptyState
            title="Bağlı görev yok"
            description="Görev panosundaki bir kartın detayından bu etkinliğe bağlayabilirsin."
          />
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate">{task.title}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{describeTaskStatus(task.status)}</Badge>
                  <span>{describeTaskPriority(task.priority)}</span>
                  {task.assignees.length > 0 && (
                    <span>{task.assignees.map((a) => a.name).join(', ')}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/tasks" className="text-sm text-primary hover:underline">
          Görev panosuna git →
        </Link>
      </section>

      {canReadBudget && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase text-muted-foreground">Bütçe</h2>
          {budgetEntries.length === 0 ? (
            <EmptyState
              title="Bu etkinliğe bağlı bütçe kalemi yok"
              description="Bütçe sayfasından yeni bir kalem eklerken bu etkinliği seçebilirsin."
            />
          ) : (
            <>
              <BudgetSummaryCards summary={budgetSummary} />
              <BudgetEntryTable
                entries={budgetEntries}
                writableChannelIds={budgetWritableChannelIds}
                showChannel={false}
              />
            </>
          )}
          <Link href={`/budget?eventId=${context.event.id}`} className="text-sm text-primary hover:underline">
            Bütçe sayfasına git →
          </Link>
        </section>
      )}

      <CommentThread
        entityType="Event"
        entityId={context.event.id}
        comments={comments}
        currentUserId={actor.id}
        isAdmin={actor.globalRole === 'ADMIN'}
        mentionCandidates={mentionCandidates.filter((c) => c.id !== actor.id)}
      />
    </div>
  )
}
