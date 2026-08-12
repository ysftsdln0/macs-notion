import Link from 'next/link'
import {
  WEEKDAY_LABELS, isSameDay, monthGrid, type MonthKey,
} from '@/lib/calendar'
import type { EventView } from '@/server/events-query'

export function MonthCalendar({
  monthKey, events,
}: { monthKey: MonthKey; events: EventView[] }) {
  const weeks = monthGrid(monthKey)
  const today = new Date()

  return (
    <div className="overflow-x-auto">
      <div className="min-w-2xl">
        <div className="grid grid-cols-7 gap-px text-xs font-medium text-muted-foreground">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="px-2 py-1">{label}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
          {weeks.flat().map((day) => {
            const dayEvents = events.filter((e) => isSameDay(e.startsAt, day))
            const inMonth = day.getMonth() === monthKey.month - 1
            return (
              <div
                key={day.toISOString()}
                className={`min-h-24 space-y-1 bg-background p-1 ${inMonth ? '' : 'opacity-50'}`}
              >
                <div
                  className={`px-1 text-xs ${
                    isSameDay(day, today) ? 'font-semibold text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {day.getDate()}
                </div>
                {dayEvents.map((event) => (
                  <Link
                    key={event.id}
                    href={`/events/${event.id}`}
                    className="block truncate rounded bg-muted px-1 py-0.5 text-xs hover:bg-muted/70"
                    title={event.title}
                  >
                    {event.startsAt.toLocaleTimeString('tr-TR', {
                      hour: '2-digit', minute: '2-digit',
                    })}{' '}
                    {event.title}
                  </Link>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
