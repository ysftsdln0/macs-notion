'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { actionError, defineAction } from '@/lib/action'
import { getActor } from '@/lib/auth/session'
import { can, has, type Actor } from '@/lib/auth/policy'
import { recordActivity } from '@/lib/activity'
import { recordNotification } from '@/lib/notifications'
import { rankBetween, rebalanceRanks } from '@/lib/rank'
import { loadTaskContext } from '@/server/tasks-query'

const statusEnum = z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'DONE'])
const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])

async function requireChannel(channelId: string) {
  const channel = await db.channel.findUnique({ where: { id: channelId } })
  if (!channel) throw actionError('NOT_FOUND')
  return channel
}

/**
 * Görev üzerinde `content:*` kararı. `loadTaskContext` atananları da
 * getirdiği için, OPEN kanalda üye olmayan ama göreve atanmış kişinin
 * yazma hakkı doğru değerlendirilir.
 */
function authorizeOnTask(action: 'content:write' | 'content:delete') {
  return async ({ actor, input }: { actor: Actor; input: { id: string } }) => {
    const context = await loadTaskContext(input.id)
    if (!context) return { allowed: false as const, code: 'NOT_FOUND' as const }
    return { allowed: can(actor, action, context.resource) }
  }
}

/** Bir kanalın belirli sütunundaki son sıraya yerleştirir. */
async function rankAtEnd(channelId: string, status: z.infer<typeof statusEnum>): Promise<string> {
  const last = await db.task.findFirst({
    where: { channelId, status, archivedAt: null },
    orderBy: { rank: 'desc' },
    select: { rank: true },
  })
  return rankBetween(last?.rank ?? '', '')
}

export const createTask = defineAction({
  input: z.object({
    title: z.string().trim().min(1, 'Görev başlığı boş olamaz.').max(160),
    channelId: z.string().cuid(),
    notes: z.string().trim().max(4000).nullable().default(null),
    status: statusEnum.default('TODO'),
    priority: priorityEnum.default('MEDIUM'),
    dueDate: z.coerce.date().nullable().default(null),
    eventId: z.string().cuid().nullable().default(null),
    assigneeIds: z.array(z.string().cuid()).max(20).default([]),
  }),
  getActor,
  authorize: async ({ actor, input }) => {
    const channel = await requireChannel(input.channelId)
    return {
      allowed: can(actor, 'content:write', {
        kind: 'content',
        channelId: channel.id,
        channelVisibility: channel.visibility,
        channelArchivedAt: channel.archivedAt,
      }),
    }
  },
  handler: async ({ actor, input }) => {
    if (input.eventId) {
      const event = await db.event.findUnique({ where: { id: input.eventId } })
      if (!event || event.archivedAt) throw actionError('NOT_FOUND')
      if (event.channelId !== input.channelId) {
        throw actionError('VALIDATION', { eventId: 'Etkinlik başka bir kanalda.' })
      }
    }
    const assignees = await assertAssignableUsers(input.assigneeIds)

    const task = await db.task.create({
      data: {
        title: input.title,
        channelId: input.channelId,
        notes: input.notes,
        status: input.status,
        priority: input.priority,
        dueDate: input.dueDate,
        eventId: input.eventId,
        createdById: actor.id,
        rank: await rankAtEnd(input.channelId, input.status),
        assignees: { create: assignees.map((userId) => ({ userId })) },
      },
    })

    for (const userId of assignees) {
      await recordNotification(db, {
        userId, kind: 'task.assigned', entityType: 'Task', entityId: task.id, actorId: actor.id,
      })
    }
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'task.created',
      entityType: 'Task',
      entityId: task.id,
      channelId: input.channelId,
      meta: { title: task.title },
    })
    return { id: task.id }
  },
})

async function assertAssignableUsers(userIds: string[]): Promise<string[]> {
  const unique = [...new Set(userIds)]
  if (unique.length === 0) return []
  const users = await db.user.findMany({
    where: { id: { in: unique }, isActive: true },
    select: { id: true },
  })
  // Var olmayan ya da pasif kullanıcıyı sessizce atlamak yerine reddet:
  // aksi halde arayüz "atandı" der, veritabanında kimse atanmamış olur.
  if (users.length !== unique.length) throw actionError('NOT_FOUND')
  return unique
}

export const updateTask = defineAction({
  input: z.object({
    id: z.string().cuid(),
    title: z.string().trim().min(1, 'Görev başlığı boş olamaz.').max(160).optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    status: statusEnum.optional(),
    priority: priorityEnum.optional(),
    dueDate: z.coerce.date().nullable().optional(),
  }),
  getActor,
  authorize: authorizeOnTask('content:write'),
  handler: async ({ actor, input }) => {
    const task = await db.task.update({
      where: { id: input.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      },
    })
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'task.updated',
      entityType: 'Task',
      entityId: task.id,
      channelId: task.channelId,
    })
    return { id: task.id }
  },
})

export const moveTask = defineAction({
  input: z.object({
    id: z.string().cuid(),
    status: statusEnum,
    // Kartın bırakıldığı yerdeki komşuların rank'ları. Boş dize "kenar"
    // demektir (listenin başı ya da sonu).
    rankBefore: z.string().max(120).default(''),
    rankAfter: z.string().max(120).default(''),
  }),
  getActor,
  authorize: authorizeOnTask('content:write'),
  handler: async ({ actor, input }) => {
    const context = await loadTaskContext(input.id)
    if (!context) throw actionError('NOT_FOUND')

    let rank = rankBetween(input.rankBefore, input.rankAfter)

    // Aynı rank'a düşen kart varsa (kopya anahtar ya da aşırı uzamış
    // dize) sütun yeniden dengelenir; sıra her koşulda kesin olmalı.
    const collision = await db.task.findFirst({
      where: {
        channelId: context.task.channelId,
        status: input.status,
        rank,
        archivedAt: null,
        NOT: { id: input.id },
      },
      select: { id: true },
    })
    if (collision) {
      rank = await rebalanceColumn(context.task.channelId, input.status, input.id, input.rankBefore)
    }

    const task = await db.task.update({
      where: { id: input.id },
      data: { status: input.status, rank },
    })
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'task.moved',
      entityType: 'Task',
      entityId: task.id,
      channelId: task.channelId,
      meta: { status: task.status },
    })
    return { id: task.id, rank: task.rank, status: task.status }
  },
})

/**
 * Sütundaki tüm görevleri eşit aralıklı anahtarlarla yeniden numaralar ve
 * taşınan görevin yeni anahtarını döner. `rankBefore` taşınan kartın
 * nereye gireceğini belirler.
 */
async function rebalanceColumn(
  channelId: string,
  status: z.infer<typeof statusEnum>,
  movingTaskId: string,
  rankBefore: string,
): Promise<string> {
  const others = await db.task.findMany({
    where: { channelId, status, archivedAt: null, NOT: { id: movingTaskId } },
    orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, rank: true },
  })
  const insertAt = rankBefore === ''
    ? 0
    : others.findIndex((t) => t.rank > rankBefore) === -1
      ? others.length
      : others.findIndex((t) => t.rank > rankBefore)

  const ordered = [
    ...others.slice(0, insertAt).map((t) => t.id),
    movingTaskId,
    ...others.slice(insertAt).map((t) => t.id),
  ]
  const ranks = rebalanceRanks(ordered.length)

  await db.$transaction(
    ordered.map((id, index) =>
      db.task.update({ where: { id }, data: { rank: ranks[index] as string } }),
    ),
  )
  return ranks[ordered.indexOf(movingTaskId)] as string
}

export const setAssignees = defineAction({
  input: z.object({ id: z.string().cuid(), userIds: z.array(z.string().cuid()).max(20) }),
  getActor,
  authorize: authorizeOnTask('content:write'),
  handler: async ({ actor, input }) => {
    const context = await loadTaskContext(input.id)
    if (!context) throw actionError('NOT_FOUND')
    const next = await assertAssignableUsers(input.userIds)
    const previous = new Set(context.assigneeIds)

    await db.$transaction([
      db.assignee.deleteMany({ where: { taskId: input.id, userId: { notIn: next.length > 0 ? next : ['-'] } } }),
      ...next
        .filter((userId) => !previous.has(userId))
        .map((userId) =>
          db.assignee.create({ data: { taskId: input.id, userId } }),
        ),
    ])

    // Bildirim yalnızca YENİ atananlara: aynı listeyi ikinci kez kaydetmek
    // kimseye tekrar bildirim göndermemeli.
    for (const userId of next.filter((id) => !previous.has(id))) {
      await recordNotification(db, {
        userId, kind: 'task.assigned', entityType: 'Task', entityId: input.id, actorId: actor.id,
      })
    }
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'task.assigned',
      entityType: 'Task',
      entityId: input.id,
      channelId: context.task.channelId,
    })
    return { id: input.id }
  },
})

export const linkTaskToEvent = defineAction({
  input: z.object({ id: z.string().cuid(), eventId: z.string().cuid().nullable() }),
  getActor,
  authorize: authorizeOnTask('content:write'),
  handler: async ({ actor, input }) => {
    const context = await loadTaskContext(input.id)
    if (!context) throw actionError('NOT_FOUND')

    if (input.eventId) {
      const event = await db.event.findUnique({ where: { id: input.eventId } })
      if (!event || event.archivedAt) throw actionError('NOT_FOUND')
      if (event.channelId !== context.task.channelId) {
        throw actionError('VALIDATION', { eventId: 'Etkinlik başka bir kanalda.' })
      }
      // Etkinliği açan kişi, kendi etkinliğine görev bağlandığını bilmeli.
      await recordNotification(db, {
        userId: event.createdById,
        kind: 'event.link',
        entityType: 'Event',
        entityId: event.id,
        actorId: actor.id,
      })
    }

    await db.task.update({ where: { id: input.id }, data: { eventId: input.eventId } })
    await recordActivity(db, {
      actorId: actor.id,
      verb: input.eventId ? 'task.linkedToEvent' : 'task.unlinkedFromEvent',
      entityType: 'Task',
      entityId: input.id,
      channelId: context.task.channelId,
    })
    return { id: input.id }
  },
})

export const archiveTask = defineAction({
  input: z.object({ id: z.string().cuid() }),
  getActor,
  authorize: authorizeOnTask('content:delete'),
  handler: async ({ actor, input }) => {
    const task = await db.task.update({
      where: { id: input.id },
      data: { archivedAt: new Date() },
    })
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'task.archived',
      entityType: 'Task',
      entityId: input.id,
      channelId: task.channelId,
    })
    return { id: input.id }
  },
})

export const restoreTask = defineAction({
  input: z.object({ id: z.string().cuid() }),
  getActor,
  authorize: async ({ actor }) => ({ allowed: has(actor, 'TRASH_MANAGE') }),
  handler: async ({ actor, input }) => {
    const task = await db.task.findUnique({ where: { id: input.id } })
    if (!task) throw actionError('NOT_FOUND')
    await db.task.update({ where: { id: input.id }, data: { archivedAt: null } })
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'task.restored',
      entityType: 'Task',
      entityId: input.id,
      channelId: task.channelId,
    })
    return { id: input.id }
  },
})
