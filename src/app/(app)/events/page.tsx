import Link from 'next/link'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { listVisibleChannels } from '@/server/channels-query'
import { listEvents } from '@/server/events-query'
import { EmptyState } from '@/components/state/empty-state'
import { PageContainer, PageHeader } from '@/components/layout/page'
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
    <PageContainer width="wide">
      <PageHeader
        title="Etkinlikler"
        action={
          <>
            <Link
              href={view === 'calendar' ? '/events?view=list' : `/events?month=${formatMonthKey(monthKey)}`}
              className="text-sm text-primary hover:underline"
            >
              {view === 'calendar' ? 'Liste görünümü' : 'Takvim görünümü'}
            </Link>
            <CreateEventDialog channels={writableChannels} />
          </>
        }
      />

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

      {/* Takvim boş ayda da çizilir: gün hücresine tıklamak etkinlik açmanın
          yolu, boş durum ekranı bu girişi saklardı. */}
      {view === 'calendar' ? (
        <>
          <MonthCalendar monthKey={monthKey} events={events} channels={writableChannels} />
          {events.length === 0 && (
            <p className="text-center text-sm text-muted-foreground">
              Bu ayda etkinlik yok. Bir güne tıklayarak o gün için etkinlik oluşturabilirsin.
            </p>
          )}
        </>
      ) : events.length === 0 ? (
        <EmptyState
          title="Henüz etkinlik yok"
          description="Kongre, toplantı ve tanıtım günlerini burada planlayın."
          action={
            <CreateEventDialog channels={writableChannels} triggerLabel="İlk etkinliği oluştur" />
          }
        />
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card text-sm">
          {events.map((event) => (
            <li key={event.id}>
              <Link
                href={`/events/${event.id}`}
                className="flex items-center justify-between gap-3 px-3 py-2 transition-colors duration-150 hover:bg-muted/60"
              >
                <span className="min-w-0 truncate font-medium">{event.title}</span>
                {/* Dar ekranda kanal adı düşer, durum ve tarih kalır. */}
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{describeEventStatus(event.status)}</Badge>
                  <span className="hidden sm:inline">{event.channel.name}</span>
                  <time className="font-mono">{event.startsAt.toLocaleString('tr-TR')}</time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  )
}
