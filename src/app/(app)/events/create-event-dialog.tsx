'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createEvent } from '@/server/events'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { formatDateInput, joinDateTime } from '@/lib/calendar'
import { EVENT_STATUS_ORDER, describeEventStatus } from '@/lib/task-labels'
import type { EventStatus } from '@prisma/client'

const DEFAULT_START_TIME = '09:00'

export function CreateEventDialog({
  channels,
  triggerLabel = 'Yeni etkinlik',
  defaultDate,
  open: controlledOpen,
  onOpenChange,
}: {
  channels: { id: string; name: string }[]
  triggerLabel?: string
  /** `YYYY-MM-DD` — takvimde tıklanan gün. */
  defaultDate?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const controlled = controlledOpen !== undefined
  const open = controlled ? controlledOpen : uncontrolledOpen

  function setOpen(next: boolean) {
    if (controlled) onOpenChange?.(next)
    else setUncontrolledOpen(next)
  }

  if (channels.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Etkinlik açabilmek için önce bir kanala üye olman gerekiyor.
      </p>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlled && <DialogTrigger render={<Button size="sm">{triggerLabel}</Button>} />}
      <DialogContent>
        {/* Form yalnızca açıkken monte edilir: alanlar her açılışta sıfırlanır
            ve "bugün" varsayılanı sunucuda değil istemcide hesaplanır. */}
        {open && (
          <CreateEventForm
            key={defaultDate ?? 'today'}
            channels={channels}
            defaultDate={defaultDate}
            onCreated={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CreateEventForm({
  channels, defaultDate, onCreated,
}: {
  channels: { id: string; name: string }[]
  defaultDate?: string
  onCreated: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [title, setTitle] = useState('')
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '')
  const [date, setDate] = useState(defaultDate ?? formatDateInput(new Date()))
  const [startTime, setStartTime] = useState(DEFAULT_START_TIME)
  const [endTime, setEndTime] = useState('')
  const [multiDay, setMultiDay] = useState(false)
  const [endDate, setEndDate] = useState('')
  const [location, setLocation] = useState('')
  const [status, setStatus] = useState<EventStatus>('PLANNED')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const startsAt = joinDateTime(date, startTime)
    if (!startsAt) {
      setError('Etkinlik tarihi seçilmeli.')
      return
    }
    // Tek günlük etkinlikte bitiş, başlangıçla aynı güne bağlanır; çok günlükte
    // saat verilmediyse günün sonuna sabitlenir ki `endsAt > startsAt` tutsun.
    const endsAt =
      multiDay || endTime !== ''
        ? joinDateTime(multiDay ? endDate : date, multiDay && endTime === '' ? '23:59' : endTime)
        : null
    if (multiDay && !endsAt) {
      setError('Bitiş tarihi seçilmeli.')
      return
    }

    startTransition(async () => {
      const result = await createEvent({
        title, channelId, status, startsAt, endsAt,
        location: location.trim() === '' ? null : location,
      })
      if (!result.ok) {
        setError(
          result.error.fields?.endsAt ?? result.error.fields?.title ??
          result.error.fields?.startsAt ?? result.error.message,
        )
        return
      }
      toast.success('Etkinlik oluşturuldu.')
      onCreated()
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>Yeni etkinlik</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-1">
          <Label htmlFor="event-title">Ad</Label>
          <Input
            id="event-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={160}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="event-channel">Kanal</Label>
          <select
            id="event-channel"
            className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="event-date">Tarih</Label>
          <Input
            id="event-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>
        <div className="flex gap-3">
          <div className="flex-1 space-y-1">
            <Label htmlFor="event-start-time">Başlangıç saati</Label>
            <Input
              id="event-start-time"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
            />
          </div>
          <div className="flex-1 space-y-1">
            <Label htmlFor="event-end-time">Bitiş saati (opsiyonel)</Label>
            <Input
              id="event-end-time"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
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
              <Label htmlFor="event-end-date">Bitiş tarihi</Label>
              <Input
                id="event-end-date"
                type="date"
                value={endDate}
                min={date}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="event-location">Konum (opsiyonel)</Label>
          <Input
            id="event-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={200}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="event-status">Durum</Label>
          <select
            id="event-status"
            className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as EventStatus)}
          >
            {EVENT_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>{describeEventStatus(s)}</option>
            ))}
          </select>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? 'Oluşturuluyor…' : 'Oluştur'}
        </Button>
      </DialogFooter>
    </form>
  )
}
