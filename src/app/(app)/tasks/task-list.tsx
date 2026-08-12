'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { describeTaskPriority, describeTaskStatus } from '@/lib/task-labels'
import type { TaskView } from '@/server/tasks-query'
import { TaskDetailDrawer } from './task-detail-drawer'

export function TaskList({
  tasks, members, events,
}: {
  tasks: TaskView[]
  members: { id: string; name: string }[]
  events: { id: string; title: string; channelId: string }[]
}) {
  const [selected, setSelected] = useState<TaskView | null>(null)

  return (
    <>
      <ul className="divide-y rounded-lg border text-sm">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
              onClick={() => setSelected(task)}
            >
              {task.title}
            </button>
            <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{describeTaskStatus(task.status)}</Badge>
              <span>{describeTaskPriority(task.priority)}</span>
              <span>{task.channel.name}</span>
              {task.dueDate && <time>{task.dueDate.toLocaleDateString('tr-TR')}</time>}
            </span>
          </li>
        ))}
      </ul>

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
