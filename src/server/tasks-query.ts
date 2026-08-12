/**
 * Bu dosya BİLEREK 'use server' taşımaz — `Actor` parametresi alır
 * (bkz. `channels-query.ts`'teki gerekçe).
 */

import type { Prisma, TaskPriority, TaskStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { can, type Actor, type Visibility } from '@/lib/auth/policy'

export type TaskView = {
  id: string
  title: string
  notes: string | null
  status: TaskStatus
  priority: TaskPriority
  dueDate: Date | null
  rank: string
  channel: { id: string; name: string }
  event: { id: string; title: string } | null
  createdById: string
  assignees: { id: string; name: string }[]
}

const taskSelect = {
  id: true,
  title: true,
  notes: true,
  status: true,
  priority: true,
  dueDate: true,
  rank: true,
  createdById: true,
  channel: { select: { id: true, name: true } },
  event: { select: { id: true, title: true } },
  assignees: { select: { user: { select: { id: true, name: true } } } },
} satisfies Prisma.TaskSelect

type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>

function toView(row: TaskRow): TaskView {
  return { ...row, assignees: row.assignees.map((a) => a.user) }
}

/**
 * `can(actor, 'content:read', …)` dallarını sorguya çevirir: OPEN kanallar
 * herkese, PRIVATE kanallar yalnızca üyelerine, admin'e hepsi.
 */
function readableChannelFilter(actor: Actor): Prisma.TaskWhereInput {
  if (actor.globalRole === 'ADMIN') return {}
  return {
    OR: [
      { channel: { visibility: 'OPEN' } },
      { channelId: { in: actor.memberships.map((m) => m.channelId) } },
    ],
  }
}

export async function listTasks(
  actor: Actor,
  filters: { channelId?: string; assigneeId?: string; eventId?: string } = {},
): Promise<TaskView[]> {
  const rows = await db.task.findMany({
    where: {
      archivedAt: null,
      channel: { archivedAt: null },
      ...(filters.channelId ? { channelId: filters.channelId } : {}),
      ...(filters.eventId ? { eventId: filters.eventId } : {}),
      ...(filters.assigneeId ? { assignees: { some: { userId: filters.assigneeId } } } : {}),
      ...readableChannelFilter(actor),
    },
    select: taskSelect,
    orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
  })
  return rows.map(toView)
}

export type TaskContext = {
  task: {
    id: string
    channelId: string
    createdById: string
    status: TaskStatus
    rank: string
    archivedAt: Date | null
  }
  channel: { id: string; visibility: Visibility; archivedAt: Date | null }
  assigneeIds: string[]
  resource: {
    kind: 'content'
    channelId: string
    channelVisibility: Visibility
    channelArchivedAt: Date | null
    ownerId: string
    assigneeIds: string[]
  }
}

/**
 * Görevi, kanalını ve atananlarını tek seferde getirir. `content:write`
 * kararı atananları görmeden verilemez (atanan kişi, OPEN kanalda üye
 * olmasa bile durumu değiştirebilir), bu yüzden hep birlikte yüklenirler.
 */
export async function loadTaskContext(taskId: string): Promise<TaskContext | null> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: {
      channel: { select: { id: true, visibility: true, archivedAt: true } },
      assignees: { select: { userId: true } },
    },
  })
  if (!task) return null
  const assigneeIds = task.assignees.map((a) => a.userId)
  return {
    task,
    channel: task.channel,
    assigneeIds,
    resource: {
      kind: 'content',
      channelId: task.channelId,
      channelVisibility: task.channel.visibility,
      channelArchivedAt: task.channel.archivedAt,
      ownerId: task.createdById,
      assigneeIds,
    },
  }
}

export async function canReadTask(actor: Actor, taskId: string): Promise<boolean> {
  const context = await loadTaskContext(taskId)
  if (!context || context.task.archivedAt) return false
  return can(actor, 'content:read', context.resource)
}
