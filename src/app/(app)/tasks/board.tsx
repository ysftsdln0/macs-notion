'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext, PointerSensor, closestCorners, useDroppable, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { toast } from 'sonner'
import { moveTask } from '@/server/tasks'
import { Badge } from '@/components/ui/badge'
import {
  TASK_STATUS_ORDER, describeTaskPriority, describeTaskStatus,
} from '@/lib/task-labels'
import type { TaskView } from '@/server/tasks-query'
import type { TaskStatus } from '@prisma/client'
import { TaskDetailDrawer } from './task-detail-drawer'

function isStatus(value: string): value is TaskStatus {
  return (TASK_STATUS_ORDER as string[]).includes(value)
}

function TaskCard({ task, onOpen }: { task: TaskView; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { status: task.status },
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`rounded-lg border bg-background p-2 text-sm ${isDragging ? 'opacity-50' : ''}`}
      data-task-title={task.title}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          className="flex-1 text-left font-medium hover:underline"
          onClick={onOpen}
        >
          {task.title}
        </button>
        {/* Sürükleme tutamağı ayrı: kartın tamamı sürüklenebilir olsaydı
            başlığa tıklayıp detay açmak imkânsızlaşırdı. */}
        <button
          type="button"
          aria-label={`${task.title} kartını taşı`}
          className="cursor-grab px-1 text-muted-foreground"
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <Badge variant="outline">{describeTaskPriority(task.priority)}</Badge>
        <span>{task.channel.name}</span>
        {task.dueDate && <span>· {task.dueDate.toLocaleDateString('tr-TR')}</span>}
        {task.assignees.length > 0 && (
          <span>· {task.assignees.map((a) => a.name).join(', ')}</span>
        )}
        {task.event && <span>· {task.event.title}</span>}
      </div>
    </li>
  )
}

function Column({
  status, tasks, onOpen,
}: { status: TaskStatus; tasks: TaskView[]; onOpen: (task: TaskView) => void }) {
  // Sütun bir SORTABLE değil, yalnızca DROPPABLE: kendisi sıralanmıyor,
  // sadece kart bırakılabilecek bir alan. useSortable ile kaydedildiğinde
  // boş sütuna bırakma hiç algılanmıyordu.
  const { setNodeRef } = useDroppable({ id: `column:${status}`, data: { status } })

  return (
    <section className="flex min-w-56 flex-1 flex-col gap-2 rounded-lg bg-muted/40 p-2">
      <h3 className="px-1 text-xs font-medium uppercase text-muted-foreground">
        {describeTaskStatus(status)} ({tasks.length})
      </h3>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className="flex min-h-16 flex-col gap-2" data-column={status}>
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onOpen={() => onOpen(task)} />
          ))}
        </ul>
      </SortableContext>
    </section>
  )
}

export function TaskBoard({
  tasks, members, events,
}: {
  tasks: TaskView[]
  members: { id: string; name: string }[]
  events: { id: string; title: string; channelId: string }[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [selected, setSelected] = useState<TaskView | null>(null)
  // Sürükleme sonucu sunucudan dönene kadar kartı yeni yerinde göstermek
  // için yerel bir üst katman: yenileme gelince temizlenir.
  const [optimistic, setOptimistic] = useState<Record<string, TaskStatus>>({})

  const sensors = useSensors(
    // 4px eşik: karta tıklamak (detay açmak) yanlışlıkla sürükleme
    // başlatmasın.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  const withOptimistic = tasks.map((t) =>
    optimistic[t.id] ? { ...t, status: optimistic[t.id] as TaskStatus } : t,
  )
  const byStatus = (status: TaskStatus) => withOptimistic.filter((t) => t.status === status)

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return

    const task = tasks.find((t) => t.id === active.id)
    if (!task) return

    const overId = String(over.id)
    const targetStatus = overId.startsWith('column:')
      ? overId.slice('column:'.length)
      : (over.data.current?.status as string | undefined)
    if (!targetStatus || !isStatus(targetStatus)) return

    const column = byStatus(targetStatus).filter((t) => t.id !== task.id)
    const overIndex = column.findIndex((t) => t.id === overId)
    const insertAt = overIndex === -1 ? column.length : overIndex

    const rankBefore = insertAt > 0 ? (column[insertAt - 1]?.rank ?? '') : ''
    const rankAfter = column[insertAt]?.rank ?? ''

    if (targetStatus === task.status && rankBefore === '' && rankAfter === '' ) return

    setOptimistic((current) => ({ ...current, [task.id]: targetStatus }))
    startTransition(async () => {
      const result = await moveTask({
        id: task.id, status: targetStatus, rankBefore, rankAfter,
      })
      if (!result.ok) {
        toast.error(result.error.message)
        setOptimistic((current) => {
          const next = { ...current }
          delete next[task.id]
          return next
        })
        return
      }
      setOptimistic({})
      router.refresh()
    })
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-wrap gap-3">
          {TASK_STATUS_ORDER.map((status) => (
            <Column
              key={status}
              status={status}
              tasks={byStatus(status)}
              onOpen={setSelected}
            />
          ))}
        </div>
      </DndContext>

      {selected && (
        <TaskDetailDrawer
          task={selected}
          members={members}
          events={events}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}
