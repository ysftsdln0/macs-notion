import Link from 'next/link'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { listVisibleChannels } from '@/server/channels-query'
import { listEvents } from '@/server/events-query'
import { EmptyState } from '@/components/state/empty-state'
import { Badge } from '@/components/ui/badge'
import { describeEventStatus } from '@/lib/task-labels'
import {
  describeMonth, formatMonthKey, monthRange, parseMonthKey, shiftMonth,
} from '@/lib/calendar'
import { CreateEventDialog } from './create-event-dialog'
import { MonthCalendar } from './calendar'

type SearchParams = Promise<{ month?: string; view?: string }>

export default async function EventsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireActor()
  const params = await searchParams
  const view = params.view === 'list' ? 'list' : 'calendar'
  const monthKey = parseMonthKey(params.month)
  const range = monthRange(monthKey)

  const [channels, events] = await Promise.all([
    listVisibleChannels(),
    // Liste görünümü ay sınırını yok sayar: yaklaşan tüm etkinlikler.
    listEvents(actor, view === 'calendar' ? range : {}),
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

  const previous = formatMonthKey(shiftMonth(monthKey, -1))
  const next = formatMonthKey(shiftMonth(monthKey, 1))

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Etkinlikler</h1>
        <div className="flex items-center gap-2">
          <Link
            href={view === 'calendar' ? '/events?view=list' : `/events?month=${formatMonthKey(monthKey)}`}
            className="text-sm text-primary hover:underline"
          >
            {view === 'calendar' ? 'Liste görünümü' : 'Takvim görünümü'}
          </Link>
          <CreateEventDialog channels={writableChannels} />
        </div>
      </header>

      {view === 'calendar' && (
        <div className="flex items-center justify-between">
          <Link href={`/events?month=${previous}`} className="text-sm text-primary hover:underline">
            ← Önceki ay
          </Link>
          <h2 className="text-sm font-medium">{describeMonth(monthKey)}</h2>
          <Link href={`/events?month=${next}`} className="text-sm text-primary hover:underline">
            Sonraki ay →
          </Link>
        </div>
      )}

      {events.length === 0 ? (
        <EmptyState
          title={view === 'calendar' ? 'Bu ayda etkinlik yok' : 'Henüz etkinlik yok'}
          description="Kongre, toplantı ve tanıtım günlerini burada planlayın."
          action={
            <CreateEventDialog channels={writableChannels} triggerLabel="İlk etkinliği oluştur" />
          }
        />
      ) : view === 'calendar' ? (
        <MonthCalendar monthKey={monthKey} events={events} />
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {events.map((event) => (
            <li key={event.id}>
              <Link
                href={`/events/${event.id}`}
                className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-muted"
              >
                <span className="min-w-0 truncate font-medium">{event.title}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{describeEventStatus(event.status)}</Badge>
                  <span>{event.channel.name}</span>
                  <time>{event.startsAt.toLocaleString('tr-TR')}</time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
