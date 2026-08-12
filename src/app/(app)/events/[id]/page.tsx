import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { loadEventContext } from '@/server/events-query'
import { listTasks } from '@/server/tasks-query'
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
  const tasks = await listTasks(actor, { eventId: id })

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
    </div>
  )
}
