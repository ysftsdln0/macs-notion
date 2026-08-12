'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { archiveTask, linkTaskToEvent, setAssignees, updateTask } from '@/server/tasks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  TASK_PRIORITY_ORDER, TASK_STATUS_ORDER,
  describeTaskPriority, describeTaskStatus,
} from '@/lib/task-labels'
import type { TaskView } from '@/server/tasks-query'
import type { TaskPriority, TaskStatus } from '@prisma/client'

function toDateInput(value: Date | null): string {
  if (!value) return ''
  return value.toISOString().slice(0, 10)
}

export function TaskDetailDrawer({
  task, members, events, onClose,
}: {
  task: TaskView
  members: { id: string; name: string }[]
  events: { id: string; title: string; channelId: string }[]
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes ?? '')
  const [status, setStatus] = useState<TaskStatus>(task.status)
  const [priority, setPriority] = useState<TaskPriority>(task.priority)
  const [dueDate, setDueDate] = useState(toDateInput(task.dueDate))
  const [assigneeIds, setAssigneeIds] = useState(task.assignees.map((a) => a.id))
  const [eventId, setEventId] = useState(task.event?.id ?? '')

  const channelEvents = events.filter((e) => e.channelId === task.channel.id)

  function run(label: string, fn: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    startTransition(async () => {
      const result = await fn()
      if (!result.ok) {
        toast.error(result.error?.message ?? 'İşlem başarısız.')
        return
      }
      toast.success(label)
      router.refresh()
    })
  }

  function handleSave() {
    run('Görev güncellendi.', async () =>
      updateTask({
        id: task.id, title, status, priority,
        notes: notes.trim() === '' ? null : notes,
        dueDate: dueDate === '' ? null : dueDate,
      }),
    )
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Görev detayı</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="detail-title">Başlık</Label>
            <Input
              id="detail-title"
              value={title}
              maxLength={160}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="detail-notes">Notlar</Label>
            <textarea
              id="detail-notes"
              className="min-h-24 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
              value={notes}
              maxLength={4000}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1 space-y-1">
              <Label htmlFor="detail-status">Durum</Label>
              <select
                id="detail-status"
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
              <Label htmlFor="detail-priority">Öncelik</Label>
              <select
                id="detail-priority"
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
            <Label htmlFor="detail-due">Teslim tarihi</Label>
            <Input
              id="detail-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="detail-assignees">Atananlar</Label>
            <select
              id="detail-assignees"
              multiple
              className="min-h-24 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
              value={assigneeIds}
              onChange={(e) => setAssigneeIds([...e.target.selectedOptions].map((o) => o.value))}
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run('Atamalar güncellendi.', async () =>
                setAssignees({ id: task.id, userIds: assigneeIds }),
              )}
            >
              Atamaları kaydet
            </Button>
          </div>

          <div className="space-y-1">
            <Label htmlFor="detail-event">Bağlı etkinlik</Label>
            <select
              id="detail-event"
              className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
              value={eventId}
              disabled={pending}
              onChange={(e) => {
                const next = e.target.value
                setEventId(next)
                run('Etkinlik bağlantısı güncellendi.', async () =>
                  linkTaskToEvent({ id: task.id, eventId: next === '' ? null : next }),
                )
              }}
            >
              <option value="">— Yok —</option>
              {channelEvents.map((e) => (
                <option key={e.id} value={e.id}>{e.title}</option>
              ))}
            </select>
            {channelEvents.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Bu kanalda henüz etkinlik yok.
              </p>
            )}
          </div>

          <div className="flex justify-between gap-2 border-t pt-3">
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                run('Görev arşivlendi.', async () => {
                  const result = await archiveTask({ id: task.id })
                  if (result.ok) onClose()
                  return result
                })
              }
            >
              Arşivle
            </Button>
            <Button size="sm" disabled={pending} onClick={handleSave}>
              {pending ? 'Kaydediliyor…' : 'Kaydet'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
