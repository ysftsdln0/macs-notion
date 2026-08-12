import Link from 'next/link'
import { db } from '@/lib/db'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { listVisibleChannels } from '@/server/channels-query'
import { listTasks } from '@/server/tasks-query'
import { listEvents } from '@/server/events-query'
import { EmptyState } from '@/components/state/empty-state'
import { CreateTaskDialog } from './create-task-dialog'
import { TaskBoard } from './board'
import { TaskList } from './task-list'

type SearchParams = Promise<{ view?: string; channelId?: string; assigneeId?: string }>

export default async function TasksPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireActor()
  const params = await searchParams
  const view = params.view === 'list' ? 'list' : 'board'

  const channels = await listVisibleChannels()
  const visibleChannelIds = new Set(channels.map((c) => c.id))
  // Geçersiz ya da görülemeyen bir channelId sessizce yok sayılır: filtreyi
  // olduğu gibi sorguya geçirmek, o kanalın var olduğunu doğrulardı.
  const channelFilter =
    params.channelId && visibleChannelIds.has(params.channelId) ? params.channelId : undefined

  const [tasks, events, members] = await Promise.all([
    listTasks(actor, {
      ...(channelFilter ? { channelId: channelFilter } : {}),
      ...(params.assigneeId ? { assigneeId: params.assigneeId } : {}),
    }),
    listEvents(actor),
    db.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const writableChannels = channels
    .filter((c) =>
      can(actor, 'content:write', {
        kind: 'content',
        channelId: c.id,
        channelVisibility: c.visibility,
        channelArchivedAt: c.archivedAt,
      }),
    )
    .map((c) => ({ id: c.id, name: c.name }))

  const eventOptions = events.map((e) => ({
    id: e.id, title: e.title, channelId: e.channel.id,
  }))

  function withParam(key: string, value: string | undefined) {
    const next = new URLSearchParams()
    if (view === 'list') next.set('view', 'list')
    if (channelFilter) next.set('channelId', channelFilter)
    if (params.assigneeId) next.set('assigneeId', params.assigneeId)
    if (value === undefined) next.delete(key)
    else next.set(key, value)
    const query = next.toString()
    return query === '' ? '/tasks' : `/tasks?${query}`
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Görevler</h1>
        <div className="flex items-center gap-2">
          <Link
            href={withParam('view', view === 'board' ? 'list' : undefined)}
            className="text-sm text-primary hover:underline"
          >
            {view === 'board' ? 'Liste görünümü' : 'Board görünümü'}
          </Link>
          <CreateTaskDialog channels={writableChannels} members={members} />
        </div>
      </header>

      <form className="flex flex-wrap items-end gap-2" method="get">
        {view === 'list' && <input type="hidden" name="view" value="list" />}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="filter-channel">Kanal</label>
          <select
            id="filter-channel"
            name="channelId"
            defaultValue={channelFilter ?? ''}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          >
            <option value="">Tümü</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="filter-assignee">Atanan</label>
          <select
            id="filter-assignee"
            name="assigneeId"
            defaultValue={params.assigneeId ?? ''}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          >
            <option value="">Herkes</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="h-8 rounded-lg border px-3 text-sm hover:bg-muted">
          Filtrele
        </button>
      </form>

      {tasks.length === 0 ? (
        <EmptyState
          title="Görev yok"
          description="Bu filtrelerle görünen bir görev bulunmuyor."
          action={
            <CreateTaskDialog
              channels={writableChannels}
              members={members}
              triggerLabel="İlk görevi oluştur"
            />
          }
        />
      ) : view === 'board' ? (
        <TaskBoard tasks={tasks} members={members} events={eventOptions} />
      ) : (
        <TaskList tasks={tasks} members={members} events={eventOptions} />
      )}
    </div>
  )
}
