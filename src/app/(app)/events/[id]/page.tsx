import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { loadEventContext } from '@/server/events-query'
import { listTasks } from '@/server/tasks-query'
import { listComments } from '@/server/comments-query'
import { listUsersWithAccess } from '@/server/entity-access'
import { listSponsors } from '@/server/sponsors-query'
import { canReadBudgetOfChannel, listBudgetEntries, summarizeBudget } from '@/server/budget-query'
import { CreateTaskDialog } from '@/app/(app)/tasks/create-task-dialog'
import { BudgetEntryDialog } from '@/app/(app)/budget/entry-dialog'
import { BudgetSummaryCards } from '@/components/budget/summary-cards'
import { BudgetEntryTable } from '@/components/budget/entry-table'
import { CommentThread } from '@/components/comments/comment-thread'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/state/empty-state'
import { PageContainer, SectionHeading } from '@/components/layout/page'
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
  const [tasks, comments, mentionCandidates, canReadBudget, members] = await Promise.all([
    listTasks(actor, { eventId: id }),
    listComments(actor, 'Event', id),
    listUsersWithAccess('Event', id),
    canReadBudgetOfChannel(actor, context.event.channel.id),
    db.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  // Bütçe içerikten daha kapalı: etkinliği görebilmek kalemleri görmeye
  // yetmez, bölüm yalnızca budget:read olanlara render edilir.
  const [budgetEntries, budgetSummary] = canReadBudget
    ? await Promise.all([
        listBudgetEntries(actor, { eventId: id }),
        summarizeBudget(actor, { eventId: id }),
      ])
    : [[], []]
  const canWriteBudget = can(actor, 'budget:write', {
    kind: 'budget',
    channelId: context.event.channel.id,
    channelVisibility: context.resource.channelVisibility,
    channelArchivedAt: context.resource.channelArchivedAt,
  })
  const budgetWritableChannelIds = canWriteBudget ? [context.event.channel.id] : []

  const channelOption = { id: context.event.channel.id, name: context.event.channel.name }
  // Sponsor listesi yalnızca kalem eklenebiliyorsa çekilir — okuma için gereksiz.
  const sponsorOptions = canWriteBudget
    ? (await listSponsors(actor))
        .filter((s) => s.channel.id === context.event.channel.id)
        .map((s) => ({ id: s.id, title: s.name, channelId: s.channel.id }))
    : []

  // Her bölümde tek örnek render edilir (boşsa boş durumda, doluysa başlıkta):
  // iki kopya aynı anda dursaydı form alanlarının id'leri çakışırdı.
  const taskDialog = canWrite ? (
    <CreateTaskDialog
      channels={[channelOption]}
      members={members}
      triggerLabel="Görev ekle"
      defaultChannelId={channelOption.id}
      eventId={context.event.id}
      eventTitle={context.event.title}
    />
  ) : null

  const budgetDialog = canWriteBudget ? (
    <BudgetEntryDialog
      channels={[channelOption]}
      events={[{
        id: context.event.id, title: context.event.title, channelId: channelOption.id,
      }]}
      sponsors={sponsorOptions}
      defaultChannelId={channelOption.id}
      defaultEventId={context.event.id}
      triggerLabel="Bütçe kalemi ekle"
    />
  ) : null

  return (
    <PageContainer>
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
        <div className="flex items-center justify-between gap-3">
          <SectionHeading>Bağlı görevler</SectionHeading>
          {tasks.length > 0 && taskDialog}
        </div>
        {tasks.length === 0 ? (
          <EmptyState
            title="Bağlı görev yok"
            description={
              canWrite
                ? 'Bu etkinlik için buradan görev açabilir ya da görev panosundaki bir kartı sonradan bağlayabilirsin.'
                : 'Görev panosundaki bir kartın detayından bu etkinliğe bağlayabilirsin.'
            }
            action={taskDialog}
          />
        ) : (
          <ul className="divide-y overflow-hidden rounded-lg border bg-card text-sm">
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
          <div className="flex items-center justify-between gap-3">
            <SectionHeading>Bütçe</SectionHeading>
            {budgetEntries.length > 0 && budgetDialog}
          </div>
          {budgetEntries.length === 0 ? (
            <EmptyState
              title="Bu etkinliğe bağlı bütçe kalemi yok"
              description={
                canWriteBudget
                  ? 'Bu etkinliğin gelir ve giderlerini buradan ekleyebilirsin.'
                  : 'Bütçe sayfasından yeni bir kalem eklerken bu etkinliği seçebilirsin.'
              }
              action={budgetDialog}
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
    </PageContainer>
  )
}
