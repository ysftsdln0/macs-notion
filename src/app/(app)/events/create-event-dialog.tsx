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
import { EVENT_STATUS_ORDER, describeEventStatus } from '@/lib/task-labels'
import type { EventStatus } from '@prisma/client'

export function CreateEventDialog({
  channels, triggerLabel = 'Yeni etkinlik',
}: {
  channels: { id: string; name: string }[]
  triggerLabel?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [title, setTitle] = useState('')
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [location, setLocation] = useState('')
  const [status, setStatus] = useState<EventStatus>('PLANNED')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await createEvent({
        title, channelId, status,
        startsAt,
        endsAt: endsAt === '' ? null : endsAt,
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
      setOpen(false)
      setTitle('')
      setEndsAt('')
      setLocation('')
      router.refresh()
    })
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
      <DialogTrigger render={<Button size="sm">{triggerLabel}</Button>} />
      <DialogContent>
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
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <Label htmlFor="event-start">Başlangıç</Label>
                <Input
                  id="event-start"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  required
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label htmlFor="event-end">Bitiş (opsiyonel)</Label>
                <Input
                  id="event-end"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                />
              </div>
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
      </DialogContent>
    </Dialog>
  )
}
