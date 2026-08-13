'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { archiveEvent, updateEvent } from '@/server/events'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDateInput, formatTimeInput, joinDateTime } from '@/lib/calendar'
import { EVENT_STATUS_ORDER, describeEventStatus } from '@/lib/task-labels'
import type { EventStatus } from '@prisma/client'

function toDateInput(value: Date | null): string {
  return value ? formatDateInput(value) : ''
}

function toTimeInput(value: Date | null): string {
  return value ? formatTimeInput(value) : ''
}

export function EventHeader({
  event, canWrite, canDelete,
}: {
  event: {
    id: string
    title: string
    description: string | null
    startsAt: Date
    endsAt: Date | null
    location: string | null
    status: EventStatus
    channelName: string
  }
  canWrite: boolean
  canDelete: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(event.title)
  const [description, setDescription] = useState(event.description ?? '')
  const [date, setDate] = useState(toDateInput(event.startsAt))
  const [startTime, setStartTime] = useState(toTimeInput(event.startsAt))
  const [endTime, setEndTime] = useState(toTimeInput(event.endsAt))
  // Kayıtlı bitiş başka bir gündeyse çok günlük moda açılır.
  const [multiDay, setMultiDay] = useState(
    event.endsAt !== null && toDateInput(event.endsAt) !== toDateInput(event.startsAt),
  )
  const [endDate, setEndDate] = useState(toDateInput(event.endsAt))
  const [location, setLocation] = useState(event.location ?? '')
  const [error, setError] = useState<string | null>(null)

  function handleSave() {
    setError(null)

    const startsAt = joinDateTime(date, startTime)
    if (!startsAt) {
      setError('Etkinlik tarihi seçilmeli.')
      return
    }
    const endsAt =
      multiDay || endTime !== ''
        ? joinDateTime(multiDay ? endDate : date, multiDay && endTime === '' ? '23:59' : endTime)
        : null
    if (multiDay && !endsAt) {
      setError('Bitiş tarihi seçilmeli.')
      return
    }

    startTransition(async () => {
      const result = await updateEvent({
        id: event.id, title, startsAt, endsAt,
        description: description.trim() === '' ? null : description,
        location: location.trim() === '' ? null : location,
      })
      if (!result.ok) {
        setError(result.error.fields?.endsAt ?? result.error.message)
        return
      }
      toast.success('Etkinlik güncellendi.')
      setEditing(false)
      router.refresh()
    })
  }

  function handleStatus(next: EventStatus) {
    startTransition(async () => {
      const result = await updateEvent({ id: event.id, status: next })
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      router.refresh()
    })
  }

  function handleArchive() {
    startTransition(async () => {
      const result = await archiveEvent({ id: event.id })
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      toast.success('Etkinlik arşivlendi.')
      router.push('/events')
    })
  }

  if (editing) {
    return (
      <div className="space-y-3 border-b pb-4">
        <div className="space-y-1">
          <Label htmlFor="edit-title">Ad</Label>
          <Input id="edit-title" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit-date">Tarih</Label>
          <Input id="edit-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex gap-3">
          <div className="flex-1 space-y-1">
            <Label htmlFor="edit-start-time">Başlangıç saati</Label>
            <Input id="edit-start-time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div className="flex-1 space-y-1">
            <Label htmlFor="edit-end-time">Bitiş saati</Label>
            <Input id="edit-end-time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 rounded border-input accent-primary"
              checked={multiDay}
              onChange={(e) => setMultiDay(e.target.checked)}
            />
            Başka bir günde bitiyor
          </label>
          {multiDay && (
            <div className="space-y-1">
              <Label htmlFor="edit-end-date">Bitiş tarihi</Label>
              <Input
                id="edit-end-date"
                type="date"
                value={endDate}
                min={date}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit-location">Konum</Label>
          <Input id="edit-location" value={location} maxLength={200} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit-description">Açıklama</Label>
          <textarea
            id="edit-description"
            className="min-h-24 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
            value={description}
            maxLength={4000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button size="sm" disabled={pending} onClick={handleSave}>
            {pending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Vazgeç</Button>
        </div>
      </div>
    )
  }

  return (
    <header className="space-y-2 border-b pb-4">
      <h1 className="text-2xl font-semibold">{event.title}</h1>
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <time>{event.startsAt.toLocaleString('tr-TR')}</time>
        {event.endsAt && <time>→ {event.endsAt.toLocaleString('tr-TR')}</time>}
        {event.location && <span>· {event.location}</span>}
        <span>· {event.channelName}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canWrite ? (
          <>
            <Label htmlFor="event-status-select" className="text-xs font-normal text-muted-foreground">
              Durum
            </Label>
            <select
              id="event-status-select"
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
              value={event.status}
              disabled={pending}
              onChange={(e) => handleStatus(e.target.value as EventStatus)}
            >
              {EVENT_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>{describeEventStatus(s)}</option>
              ))}
            </select>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Düzenle</Button>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">{describeEventStatus(event.status)}</span>
        )}
        {canDelete && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={handleArchive}>
            Arşivle
          </Button>
        )}
      </div>
      {event.description && (
        <p className="whitespace-pre-wrap text-sm">{event.description}</p>
      )}
    </header>
  )
}
