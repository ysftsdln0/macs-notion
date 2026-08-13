'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createTask } from '@/server/tasks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  TASK_PRIORITY_ORDER, TASK_STATUS_ORDER,
  describeTaskPriority, describeTaskStatus,
} from '@/lib/task-labels'
import type { TaskPriority, TaskStatus } from '@prisma/client'

export type TaskChannelOption = { id: string; name: string }
export type TaskMemberOption = { id: string; name: string }

export function CreateTaskDialog({
  channels, members, triggerLabel = 'Yeni görev', defaultChannelId, defaultStatus = 'TODO',
  eventId, eventTitle,
}: {
  channels: TaskChannelOption[]
  members: TaskMemberOption[]
  triggerLabel?: string
  defaultChannelId?: string
  defaultStatus?: TaskStatus
  /** Verilirse görev bu etkinliğe bağlı açılır (etkinlik detay sayfası). */
  eventId?: string
  eventTitle?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [title, setTitle] = useState('')
  const [channelId, setChannelId] = useState(defaultChannelId ?? channels[0]?.id ?? '')
  const [status, setStatus] = useState<TaskStatus>(defaultStatus)
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM')
  const [dueDate, setDueDate] = useState('')
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await createTask({
        title, channelId, status, priority, assigneeIds,
        dueDate: dueDate === '' ? null : dueDate,
        eventId: eventId ?? null,
      })
      if (!result.ok) {
        setError(result.error.fields?.eventId ?? result.error.fields?.title ?? result.error.message)
        return
      }
      toast.success('Görev oluşturuldu.')
      setOpen(false)
      setTitle('')
      setAssigneeIds([])
      setDueDate('')
      router.refresh()
    })
  }

  if (channels.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Görev açabilmek için önce bir kanala üye olman gerekiyor.
      </p>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">{triggerLabel}</Button>} />
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Yeni görev</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1">
              <Label htmlFor="task-title">Başlık</Label>
              <Input
                id="task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={160}
              />
            </div>
            {/* Etkinliğe bağlı açılışta kanal seçilemez: `createTask`, görevin
                kanalı etkinliğinkinden farklıysa VALIDATION döndürüyor. */}
            {eventId ? (
              <p className="text-xs text-muted-foreground">
                {eventTitle ? <>“{eventTitle}” etkinliğine bağlanacak</> : 'Etkinliğe bağlanacak'}
                {channels[0] ? ` · ${channels[0].name}` : ''}
              </p>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="task-channel">Kanal</Label>
                <select
                  id="task-channel"
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                >
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <Label htmlFor="task-status">Durum</Label>
                <select
                  id="task-status"
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TaskStatus)}
                >
                  {TASK_STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>{describeTaskStatus(s)}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1 space-y-1">
                <Label htmlFor="task-priority">Öncelik</Label>
                <select
                  id="task-priority"
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                >
                  {TASK_PRIORITY_ORDER.map((p) => (
                    <option key={p} value={p}>{describeTaskPriority(p)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="task-due">Teslim tarihi (opsiyonel)</Label>
              <Input
                id="task-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="task-assignees">Atananlar</Label>
              <select
                id="task-assignees"
                multiple
                className="min-h-24 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
                value={assigneeIds}
                onChange={(e) =>
                  setAssigneeIds([...e.target.selectedOptions].map((o) => o.value))
                }
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
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
