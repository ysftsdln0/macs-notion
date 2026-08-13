'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  WEEKDAY_LABELS, formatDateInput, isSameDay, monthGrid, type MonthKey,
} from '@/lib/calendar'
import type { EventView } from '@/server/events-query'
import { CreateEventDialog } from './create-event-dialog'

export function MonthCalendar({
  monthKey, events, channels,
}: {
  monthKey: MonthKey
  events: EventView[]
  /** Boşsa kullanıcı hiçbir kanala yazamıyor: günler tıklanmaz. */
  channels: { id: string; name: string }[]
}) {
  const weeks = monthGrid(monthKey)
  const today = new Date()
  const [newEventDate, setNewEventDate] = useState<string | null>(null)
  const canCreate = channels.length > 0

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
                className={`group relative min-h-24 space-y-1 bg-background p-1 ${
                  inMonth ? '' : 'opacity-50'
                }`}
              >
                {/* Hücrenin tamamı tıklanır olsun diye altta duran katman:
                    etkinlik linklerini <button> içine almak geçersiz olurdu. */}
                {canCreate && (
                  <button
                    type="button"
                    onClick={() => setNewEventDate(formatDateInput(day))}
                    className="absolute inset-0 cursor-pointer rounded-sm transition-colors duration-150 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <span className="sr-only">
                      {day.toLocaleDateString('tr-TR', {
                        day: 'numeric', month: 'long', year: 'numeric',
                      })}{' '}
                      için etkinlik ekle
                    </span>
                  </button>
                )}
                <div className="pointer-events-none relative space-y-1">
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
                      className="pointer-events-auto block truncate rounded-md bg-muted px-1 py-0.5 text-xs hover:bg-muted/70"
                      title={event.title}
                    >
                      {event.startsAt.toLocaleTimeString('tr-TR', {
                        hour: '2-digit', minute: '2-digit',
                      })}{' '}
                      {event.title}
                    </Link>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {canCreate && (
        <CreateEventDialog
          channels={channels}
          defaultDate={newEventDate ?? undefined}
          open={newEventDate !== null}
          onOpenChange={(open) => {
            if (!open) setNewEventDate(null)
          }}
        />
      )}
    </div>
  )
}
